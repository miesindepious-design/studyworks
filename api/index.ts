import { app } from '../server/src/app.js';

export default async (req: Request, ev: unknown) => app.fetch(req, ev as any);
