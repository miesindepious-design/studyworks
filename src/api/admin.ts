import { apiFetch, apiPatch } from './client';

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
