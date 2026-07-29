/**
 * attachments.ts — client-side helper for file uploads.
 *
 * Tries to use the server's presign endpoint + direct-to-R2 upload. If the
 * server reports that R2 is not configured (503 / storageEnabled: false),
 * falls back to the legacy base64-in-IDB path so the dev experience works
 * without R2 setup.
 */

import { apiPost, apiDelete } from './client';
import type { FileAttachment } from '../types';

const PDF = 'application/pdf';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const IMG_PREFIX = 'image/';
const AUDIO_PREFIX = 'audio/';

function detectType(file: File | { type: string; name?: string }): 'pdf' | 'pptx' | 'image' | 'audio' | null {
  const { type, name } = file;
  if (type === PDF || name?.toLowerCase().endsWith('.pdf')) return 'pdf';
  if (type === PPTX || name?.toLowerCase().endsWith('.pptx')) return 'pptx';
  if (type.startsWith(IMG_PREFIX)) return 'image';
  if (type.startsWith(AUDIO_PREFIX)) return 'audio';
  return null;
}

export interface UploadResult {
  attachment: FileAttachment;
  storageMode: 'cloud' | 'local';
}

/**
 * Upload a file. Returns the FileAttachment to add to a note's `files[]`.
 * If the server doesn't have R2 configured, stores a data URL in `url`
 * (the legacy IDB base64 behaviour). The result is wrapped with
 * `storageMode` so the UI can show a small badge.
 */
export async function uploadFile(opts: {
  file:        File;
  noteId:      string;
}): Promise<UploadResult> {
  const type = detectType(opts.file);
  if (!type) throw new Error('Unsupported file type. Use PDF, PPTX, image, or audio.');

  // ── Try cloud path ────────────────────────────────────────────────────────
  try {
    const presign = await apiPost<{
      uploadUrl?: string;
      storageKey?: string;
      publicUrl?: string;
      storageEnabled?: boolean;
    }>('/api/attachments/presign', {
      filename:    opts.file.name,
      contentType: opts.file.type,
      size:        opts.file.size,
    });
    if (presign.storageEnabled && presign.uploadUrl && presign.storageKey && presign.publicUrl) {
      // Direct PUT to R2.
      const put = await fetch(presign.uploadUrl, {
        method:  'PUT',
        headers: { 'Content-Type': opts.file.type },
        body:    opts.file,
      });
      if (!put.ok) throw new Error(`Upload to storage failed: ${put.status}`);

      // Register the attachment on the note (server side, so the
      // cloud sync round-trip knows about it).
      const reg = await apiPost<{ attachment: any }>(
        `/api/attachments/notes/${opts.noteId}/attachments`,
        {
          storageKey: presign.storageKey,
          url:        presign.publicUrl,
          name:       opts.file.name,
          type,
          size:       opts.file.size,
        }
      );

      return {
        attachment: {
          id:         reg.attachment.id,
          name:       opts.file.name,
          type,
          url:        presign.publicUrl,
          size:       opts.file.size,
          uploadedAt: new Date(),
        },
        storageMode: 'cloud',
      };
    }
  } catch (err: any) {
    // 401 (unauthenticated), 403 (not Pro), 503 (no R2) — all fall through
    // to the local path. Anything else is rethrown.
    if (err && (err.status === 401 || err.status === 403 || err.status === 503 || err.status === 413)) {
      // fall through
    } else {
      throw err;
    }
  }

  // ── Local fallback (base64 in IDB) ────────────────────────────────────────
  const dataUrl = await readAsDataURL(opts.file);
  return {
    attachment: {
      id:         crypto.randomUUID(),
      name:       opts.file.name,
      type,
      url:        dataUrl,
      size:       opts.file.size,
      uploadedAt: new Date(),
    },
    storageMode: 'local',
  };
}

/** Delete a server-side attachment by id. Local-only attachments are
 *  just removed from the note's files[] without a server call. */
export async function deleteRemoteAttachment(id: string): Promise<void> {
  await apiDelete(`/api/attachments/${id}`);
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}
