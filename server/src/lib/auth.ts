/**
 * Better Auth configuration with Prisma adapter.
 * Exported `auth` is used both as the request handler and to extract sessions.
 */
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from './prisma.js';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3001',
  // The auth router is mounted at /auth (see routes/auth.ts), so Better
  // Auth's internal router must use the same basePath. Its default is
  // /api/auth, which would 404 against our /auth/* mount.
  basePath: '/auth',
  trustedOrigins: [process.env.FRONTEND_URL || 'http://localhost:5173'],

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // flip to true in prod after Resend is configured
    sendResetPassword: async ({ user, url }) => {
      await resend.emails.send({
        from:    process.env.EMAIL_FROM || 'StudyWorks <noreply@studyworks.app>',
        to:      user.email,
        subject: 'Reset your StudyWorks password',
        text:    `Click the link to reset your password:\n\n${url}\n\nThis link expires in 1 hour.`,
      });
    },
  },

  // ── Social sign-in ──────────────────────────────────────────────────────────
  // Google OAuth. Only enabled when both env vars are present so a missing
  // config degrades to email/password rather than crashing at boot.
  // Redirect URI to register in Google Cloud Console:
  //   {BETTER_AUTH_URL}/auth/callback/google
  //   (dev: http://localhost:3001/auth/callback/google)
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
      await resend.emails.send({
        from:    process.env.EMAIL_FROM || 'StudyWorks <noreply@studyworks.app>',
        to:      user.email,
        subject: 'Verify your StudyWorks account',
        text:    `Welcome to StudyWorks! Verify your email:\n\n${url}`,
      });
    },
  },
});

export type Auth = typeof auth;
