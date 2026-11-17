import { apiFetch, apiPatch, apiDelete } from './client';

export interface AdminUser {
  id:                     string;
  email:                  string;
  name:                   string | null;
  tier:                   'FREE' | 'PRO';
  emailVerified:          boolean;
  createdAt:              string;
  stripeSubscriptionId:   string | null;
  stripeCurrentPeriodEnd: string | null;
  stripePriceId:          string | null;
}

export interface AdminStats {
  total: number;
  pro:   number;
  free:  number;
}

export function getAdminStats(): Promise<AdminStats> {
  return apiFetch<AdminStats>('/api/admin/stats');
}

export function getAdminUsers(search?: string): Promise<{ users: AdminUser[] }> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  return apiFetch<{ users: AdminUser[] }>(`/api/admin/users${qs}`);
}

export function setUserTier(userId: string, tier: 'FREE' | 'PRO'): Promise<{ user: AdminUser }> {
  return apiPatch<{ user: AdminUser }>(`/api/admin/users/${userId}/tier`, { tier });
}

/** How much of a user's data would be removed with the account. */
export interface AdminUserCounts {
  notes:             number;
  folders:           number;
  contacts:          number;
  flashcards:        number;
  practiceQuestions: number;
  savedSearches:     number;
  attachments:       number;
  gameRooms:         number;
  supportTickets:    number;
}

export interface AdminUserDetail {
  user:   AdminUser;
  counts: AdminUserCounts;
}

export interface AdminDeleteResult {
  deleted: { id: string; email: string };
  /** Uploaded files removed from object storage. */
  filesRemoved: number;
  /** Things that did not go through cleanly (e.g. a subscription we could not cancel). */
  warnings: string[];
}

/** One user plus a count of everything that goes with them. */
export function getAdminUser(userId: string): Promise<AdminUserDetail> {
  return apiFetch<AdminUserDetail>(`/api/admin/users/${userId}`);
}

/**
 * Delete an account for good. The server checks that `confirmEmail` is the
 * account's exact email — it is the confirmation that the admin really
 * means to remove this person and not somebody else.
 */
export function deleteAdminUser(userId: string, confirmEmail: string): Promise<AdminDeleteResult> {
  return apiDelete<AdminDeleteResult>(`/api/admin/users/${userId}`, { confirmEmail });
}
