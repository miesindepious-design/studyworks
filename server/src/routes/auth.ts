/**
 * Auth router — delegates everything to Better Auth.
 * Better Auth handles: sign-up, sign-in, sign-out, session, email verify, password reset.
 */
import { Hono } from 'hono';
import { auth } from '../lib/auth.js';

export const authRouter = new Hono();

// Pass all /auth/* requests through to Better Auth
authRouter.all('/*', c => auth.handler(c.req.raw));
