/**
 * Stripe billing client — calls the server's /api/stripe endpoints.
 *
 * The server (server/src/routes/stripe.ts) handles customer creation, the
 * Stripe Checkout session, the customer portal, and the webhook that
 * updates the user's tier. The client just kicks off the redirect and
 * refreshes the local session when the user returns.
 */

import { apiGet, apiPost } from './client';

export interface CheckoutResponse {
  url: string;
}

/**
 * Create a Stripe Checkout session for a Pro subscription and return the
 * Stripe-hosted URL. The browser should be redirected to it.
 */
export async function createCheckoutSession(priceId: string): Promise<string> {
  const res = await apiPost<CheckoutResponse>('/api/stripe/checkout', { priceId });
  if (!res.url) throw new Error('Stripe did not return a checkout URL');
  return res.url;
}

/**
 * Open the Stripe customer portal (manage subscription, update card,
 * cancel). Returns the URL to redirect to.
 */
export async function openBillingPortal(): Promise<string> {
  const res = await apiPost<CheckoutResponse>('/api/stripe/portal');
  if (!res.url) throw new Error('Stripe did not return a portal URL');
  return res.url;
}

/**
 * Price IDs are configured server-side via env. The client never hard-codes
 * them. For the demo / dev environment we look them up at the pricing view
 * via a small manifest endpoint.
 */
export async function getPriceIds(): Promise<{ monthly: string; yearly: string }> {
  return apiGet<{ monthly: string; yearly: string }>('/api/stripe/prices');
}
