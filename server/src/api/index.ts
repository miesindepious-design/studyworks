// Vercel serverless entry: export Hono app as a fetch handler.
// Vercel will call app.fetch(request, env, ctx) for each /api/* and /auth/* request.
export { app as default } from '../app.js';
