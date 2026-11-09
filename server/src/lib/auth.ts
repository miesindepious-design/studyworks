/**
 * Better Auth configuration with Prisma adapter.
 * Exported `auth` is used both as the request handler and to extract sessions.
 */
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from './prisma.js';
import { Resend } from 'resend';

// Lazy Resend client — only created when an email is actually sent.
// Prevents missing RESEND_API_KEY from crashing the app at startup.
function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set — cannot send email');
  return new Resend(key);
}

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
if (!BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET env var is required but not set');
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3001',
  // The auth router is mounted at /auth (see routes/auth.ts), so Better
  // Auth's internal router must use the same basePath. Its default is
  // /api/auth, which would 404 against our /auth/* mount.
  basePath: '/auth',
  trustedOrigins: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'https://studyworksfirst-git-master-miesindepious-designs-projects.vercel.app',
    'https://studyworks.vercel.app',
    'https://studyworks-miesindepious-designs-projects.vercel.app',
    'https://studyworks-eight.vercel.app',
    'https://studyworks-seven.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
  ],

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // flip to true in prod after Resend is configured
    sendResetPassword: async ({ user, url }) => {
      try {
        await getResend().emails.send({
          from:    process.env.EMAIL_FROM || 'StudyWorks <noreply@studyworks.app>',
          to:      user.email,
          subject: 'Reset your StudyWorks password',
          text:    `Click the link to reset your password:\n\n${url}\n\nThis link expires in 1 hour.`,
        });
      } catch (err) {
        console.error('[Auth] Password reset email failed:', err);
      }
    },
  },

  // ── Social sign-in ──────────────────────────────────────────────────────────
  ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        socialProviders: {
          google: {
            clientId:     process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        },
      }
    : {}),

  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      try {
        await getResend().emails.send({
          from:    process.env.EMAIL_FROM || 'StudyWorks <noreply@studyworks.app>',
          to:      user.email,
          subject: 'Verify your StudyWorks account',
          text:    `Welcome to StudyWorks! Verify your email:\n\n${url}`,
        });
      } catch (err) {
        console.error('[Auth] Verification email failed:', err);
      }
    },
  },
});

export type Auth = typeof auth;
