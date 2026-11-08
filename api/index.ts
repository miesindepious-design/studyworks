import { app } from '../server/src/app.js';

// Vercel Web fetch API: export a single-parameter handler that takes a
// standard Request and returns a Response. Exporting the Hono app directly
// makes Vercel invoke it Node-style (req, res) with a plain req.headers
// object, which crashes Hono middleware ("this.raw.headers.get is not a
// function") and leaves requests hanging until the 300s timeout.
export default (req: Request): Promise<Response> => app.fetch(req);
