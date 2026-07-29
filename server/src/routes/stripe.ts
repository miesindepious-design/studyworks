/**
 * /api/stripe  — Checkout, customer portal, and webhook handler.
 *
 * Webhook events handled:
 *   checkout.session.completed        → set tier = PRO
 *   customer.subscription.updated     → update period end
 *   customer.subscription.deleted     → downgrade to FREE
 *   invoice.payment_failed             → (logged, optional email)
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import Stripe from 'stripe';
import { requireAuth } from '../lib/session.js';
import { prisma } from '../lib/prisma.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

export const stripeRouter = new Hono();

// ── Price ID manifest ─────────────────────────────────────────────────────────
// Returns the configured Stripe price IDs so the frontend can render the
// "Upgrade" button without hardcoding them. Env-driven; falls back to
// empty strings when not configured (the UI will then show a friendly
// "Stripe not configured" message instead of a broken checkout).
stripeRouter.get('/prices', async c => {
  return c.json({
    monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID ?? '',
    yearly:  process.env.STRIPE_PRO_YEARLY_PRICE_ID  ?? '',
  });
});

// ── Create Checkout session ────────────────────────────────────────────────────
stripeRouter.post('/checkout', requireAuth, zValidator('json', z.object({
  priceId: z.string().min(1),
})), async c => {
  const user = c.get('user');
  const { priceId } = c.req.valid('json');

  // Get or create Stripe customer
  let customerId: string | undefined;
  const dbUser = await prisma.user.findUnique({
    where:  { id: user.id },
    select: { stripeCustomerId: true, email: true, name: true },
  });

  if (dbUser?.stripeCustomerId) {
    customerId = dbUser.stripeCustomerId;
  } else {
    const customer = await stripe.customers.create({
      email:    dbUser?.email,
      name:     dbUser?.name ?? undefined,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await prisma.user.update({
      where: { id: user.id },
      data:  { stripeCustomerId: customer.id },
    });
  }

  const session = await stripe.checkout.sessions.create({
    customer:             customerId,
    mode:                 'subscription',
    payment_method_types: ['card'],
    line_items:           [{ price: priceId, quantity: 1 }],
    success_url:          `${FRONTEND_URL}/?checkout=success`,
    cancel_url:           `${FRONTEND_URL}/?checkout=cancel`,
    metadata:             { userId: user.id },
    subscription_data:    { metadata: { userId: user.id } },
  });

  return c.json({ url: session.url });
});

// ── Customer portal ────────────────────────────────────────────────────────────
stripeRouter.post('/portal', requireAuth, async c => {
  const user  = c.get('user');
  const dbUser = await prisma.user.findUnique({
    where:  { id: user.id },
    select: { stripeCustomerId: true },
  });

  if (!dbUser?.stripeCustomerId) {
    return c.json({ error: 'No Stripe customer found' }, 400);
  }

  const session = await stripe.billingPortal.sessions.create({
    customer:   dbUser.stripeCustomerId,
    return_url: FRONTEND_URL,
  });

  return c.json({ url: session.url });
});

// ── Webhook ────────────────────────────────────────────────────────────────────
// NOTE: This route reads the raw body — must be before any body-parsing middleware.
stripeRouter.post('/webhook', async c => {
  const signature = c.req.header('stripe-signature');
  if (!signature) return c.json({ error: 'Missing stripe-signature' }, 400);

  const rawBody = await c.req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('[Stripe webhook] signature verification failed:', err);
    return c.json({ error: 'Webhook signature invalid' }, 400);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId  = session.metadata?.userId;
        if (!userId) break;

        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        await prisma.user.update({
          where: { id: userId },
          data: {
            tier:                  'PRO',
            stripeSubscriptionId:  sub.id,
            stripePriceId:         sub.items.data[0]?.price.id,
            stripeCurrentPeriodEnd: new Date((sub as any).current_period_end * 1000),
          },
        });
        break;
      }

      case 'customer.subscription.updated': {
        const sub    = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (!userId) break;

        await prisma.user.update({
          where: { id: userId },
          data: {
            stripePriceId:         sub.items.data[0]?.price.id,
            stripeCurrentPeriodEnd: new Date((sub as any).current_period_end * 1000),
          },
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub    = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (!userId) break;

        await prisma.user.update({
          where: { id: userId },
          data: {
            tier:                  'FREE',
            stripeSubscriptionId:  null,
            stripePriceId:         null,
            stripeCurrentPeriodEnd: null,
          },
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        console.warn('[Stripe] Payment failed for customer:', invoice.customer);
        // Could trigger a Resend email here
        break;
      }
    }
  } catch (err) {
    console.error('[Stripe webhook] handler error:', err);
    return c.json({ error: 'Webhook handler error' }, 500);
  }

  return c.json({ received: true });
});
