import { Hono } from 'hono';
import { requireAuth } from '../lib/session.js';

export const unfurlRouter = new Hono();
unfurlRouter.use('/*', requireAuth);
unfurlRouter.get('/og', c => {
  const url = c.req.query('url') || '';
  return c.json(
    { title: 'StudyWorks', url: url || null, description: 'Study smarter' },
    200
  );
});
