import { app } from '../server/src/app.js';

// Vercel Web fetch handler: a named `fetch` export receives a standard
// Request and returns a Response for every method. A default export is
// invoked Node-style (req, res) with a plain req.headers object, which
// crashes Hono middleware ("this.raw.headers.get is not a function") and
// leaves responses hanging until the 300s timeout.
export function fetch(req: Request) {
  return app.fetch(req);
}
