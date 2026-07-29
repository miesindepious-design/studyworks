/**
 * storage.ts — S3 / R2 client for file attachments.
 *
 * The application uses Cloudflare R2 (S3-compatible) for object storage.
 * This module returns presigned PUT URLs so the browser can upload
 * directly to the bucket, then register the resulting URL on the
 * attachment record.
 *
 * If R2 env vars aren't configured (dev without S3), `isEnabled()` returns
 * false and the client falls back to the legacy base64-in-IDB path. This
 * keeps the dev experience working without requiring R2 setup.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_BASE_URL,
} = process.env;

let _client: S3Client | null = null;

export function isEnabled(): boolean {
  return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
}

function client(): S3Client {
  if (!isEnabled()) throw new Error('R2 storage is not configured');
  if (_client) return _client;
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     R2_ACCESS_KEY_ID!,
      secretAccessKey: R2_SECRET_ACCESS_KEY!,
    },
  });
  return _client;
}

export interface PresignedPut {
  uploadUrl: string;       // PUT here with the file body
  storageKey: string;      // the key the client should register on the attachment
  publicUrl: string;       // the URL the client should put in `url` for display
  expiresIn: number;       // seconds
}

export async function presignPut(opts: {
  userId: string;
  filename: string;
  contentType: string;
  size: number;
  // 50 MB cap. Free users can't upload at all; Pro users get up to 100 MB
  // per the Pricing page, but per-file is capped at 50 to keep requests sane.
  maxSize?: number;
}): Promise<PresignedPut> {
  if (!isEnabled()) throw new Error('R2 storage is not configured');
  const max = opts.maxSize ?? 50 * 1024 * 1024;
  if (opts.size > max) {
    const err: any = new Error(`File too large (max ${Math.floor(max / 1024 / 1024)} MB)`);
    err.statusCode = 413;
    throw err;
  }
  // Sanitise filename — strip directory components and characters that
  // break object keys. Use a cuid-style key under the user's namespace.
  const safeName = opts.filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  const storageKey = `attachments/${opts.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

  const cmd = new PutObjectCommand({
    Bucket:      R2_BUCKET!,
    Key:         storageKey,
    ContentType: opts.contentType,
    ContentLength: opts.size,
  });
  const expiresIn = 600; // 10 min
  const uploadUrl = await getSignedUrl(client(), cmd, { expiresIn });

  const publicUrl = R2_PUBLIC_BASE_URL
    ? `${R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${storageKey}`
    : `https://${R2_BUCKET}.r2.dev/${storageKey}`;

  return { uploadUrl, storageKey, publicUrl, expiresIn };
}

/**
 * Get a presigned GET URL for downloading. Not used by the current UI
 * (we use the publicUrl directly when R2_PUBLIC_BASE_URL is set) but
 * useful for private buckets.
 */
export async function presignGet(storageKey: string, expiresIn = 300): Promise<string> {
  if (!isEnabled()) throw new Error('R2 storage is not configured');
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET!, Key: storageKey });
  return getSignedUrl(client(), cmd, { expiresIn });
}

export async function deleteObject(storageKey: string): Promise<void> {
  if (!isEnabled()) return; // no-op when not configured
  await client().send(new DeleteObjectCommand({ Bucket: R2_BUCKET!, Key: storageKey }));
}
