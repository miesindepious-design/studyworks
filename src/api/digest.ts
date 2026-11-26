/**
 * /api/digest — the weekly email digest.
 *
 * Opt-in, and off until the student turns it on. The preferences live on the
 * server so they follow the student between devices.
 */
import { apiGet, apiPatch, apiPost } from './client';

export interface DigestPreferences {
  enabled: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  lastSentAt: string | null;
}

export const DIGEST_DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

export function getDigestPreferences(): Promise<DigestPreferences> {
  return apiGet<DigestPreferences>('/api/digest/preferences');
}

export function saveDigestPreferences(body: { enabled: boolean; day?: number }): Promise<{
  ok: boolean;
  enabled: boolean;
  day?: number;
}> {
  return apiPatch('/api/digest/preferences', body);
}

/** Send the digest to this student right now — a preview, not a schedule. */
export function sendDigestNow(): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>('/api/digest/send');
}
