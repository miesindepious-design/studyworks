/**
 * stripe.ts — the shared Stripe client.
 *
 * Lives in `lib/` rather than in the stripe route so other routes can use
 * it too: the admin dashboard needs it to cancel a subscription when an
 * account is deleted (otherwise the customer keeps being billed for an
 * account that no longer exists).
 *
 * The client is lazy — only built on the first call that needs it. A
 * missing or invalid STRIPE_SECRET_KEY must not crash the Hono app at
 * import time and take every unrelated route (auth, notes, sync) with it.
 */
import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  _stripe = new Stripe(key);
  return _stripe;
}

/** Returns true when Stripe is configured — used by routes to short-circuit gracefully. */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
