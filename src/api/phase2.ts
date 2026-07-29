/**
 * Phase 2 client API modules.
 *
 * Thin wrappers over the base apiFetch client for the new server routes:
 *   - streak sync
 *   - URL unfurl (Save from URL)
 *   - folder shares
 *   - support tickets
 *   - email-to-save address
 */
import { apiGet, apiPost, apiDelete } from './client';

// ── Streak sync ───────────────────────────────────────────────────────────────
export interface ServerStreak {
  userId: string;
  lastReviewDate: string | null;
  currentStreak: number;
  longestStreak: number;
  totalReviews: number;
  dailyCounts: Record<string, number>;
}

export function getServerStreak() {
  return apiGet<ServerStreak>('/api/streak');
}

/** Push local dailyCounts to the server; returns the merged server record. */
export function mergeStreak(dailyCounts: Record<string, number>) {
  return apiPost<ServerStreak>('/api/streak/merge', { dailyCounts });
}

// ── Unfurl (Save from URL) ────────────────────────────────────────────────────
export interface UnfurlResult {
  kind: 'youtube' | 'twitter' | 'article' | 'file';
  url: string;
  title: string;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

export function unfurlUrl(url: string) {
  return apiPost<UnfurlResult>('/api/unfurl', { url });
}

// ── Folder shares ─────────────────────────────────────────────────────────────
export interface FolderShare {
  id: string;
  token: string;
  folderId: string;
  createdAt: string;
  expiresAt: string | null;
  revoked: boolean;
}

export interface PublicShare {
  folderName: string;
  noteCount: number;
  notes: Array<{
    id: string; title: string; content: string;
    tags: string[]; type: string; createdAt: string; updatedAt: string;
  }>;
}

export function createShare(folderId: string, expiresInDays?: number) {
  return apiPost<FolderShare>('/api/shares', { folderId, expiresInDays });
}

export function listShares() {
  return apiGet<FolderShare[]>('/api/shares');
}

export function revokeShare(id: string) {
  return apiDelete<{ success: true }>(`/api/shares/${id}`);
}

/** Public — no auth. */
export function getPublicShare(token: string) {
  return apiGet<PublicShare>(`/api/shares/public/${token}`);
}

// ── Support ───────────────────────────────────────────────────────────────────
export interface SupportTicket {
  id: string;
  subject: string;
  body: string;
  status: 'open' | 'replied' | 'closed';
  reply: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createTicket(subject: string, body: string) {
  return apiPost<SupportTicket>('/api/support', { subject, body });
}

export function listTickets() {
  return apiGet<SupportTicket[]>('/api/support');
}

// ── Email-to-save ─────────────────────────────────────────────────────────────
export interface InboundAddress {
  enabled: boolean;
  address: string | null;
  reason?: string;
}

export function getInboundAddress() {
  return apiGet<InboundAddress>('/api/email-save/address');
}
