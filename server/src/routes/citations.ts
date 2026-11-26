/**
 * /api/citations — the student's bibliography.
 *
 * A source is stored as facts (who, when, what, where), never as a formatted
 * string. The reference list has to be re-formatted when the course switches
 * from APA to MLA, and re-typing twenty references to change a style is how
 * bibliographies end up half-converted.
 *
 * So the route stores the facts and lets `src/utils/citations.ts` do the
 * formatting on the client, where the student can watch the list change as
 * they pick a style.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/session.js';

export const citationsRouter = new Hono();
citationsRouter.use('*', requireAuth);

const SOURCE_TYPES = ['book', 'journal', 'website', 'chapter', 'video', 'report', 'thesis'] as const;

const CitationBody = z.object({
  type:      z.enum(SOURCE_TYPES).default('book'),
  authors:   z.array(z.string().max(120)).max(40).default([]),
  editor:    z.string().max(120).nullable().optional(),
  year:      z.string().max(20).default(''),
  title:     z.string().min(1).max(400),
  container: z.string().max(400).nullable().optional(),
  publisher: z.string().max(200).nullable().optional(),
  place:     z.string().max(120).nullable().optional(),
  volume:    z.string().max(40).nullable().optional(),
  issue:     z.string().max(40).nullable().optional(),
  pages:     z.string().max(60).nullable().optional(),
  url:       z.string().max(1000).nullable().optional(),
  doi:       z.string().max(200).nullable().optional(),
  accessed:  z.string().max(40).nullable().optional(),
});

const PatchBody = CitationBody.partial();

function shape(c: {
  id: string; type: string; authors: string[]; editor: string | null;
  year: string; title: string; container: string | null; publisher: string | null;
  place: string | null; volume: string | null; issue: string | null;
  pages: string | null; url: string | null; doi: string | null;
  accessed: string | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: c.id,
    type: c.type,
    authors: c.authors,
    editor: c.editor,
    year: c.year,
    title: c.title,
    container: c.container,
    publisher: c.publisher,
    place: c.place,
    volume: c.volume,
    issue: c.issue,
    pages: c.pages,
    url: c.url,
    doi: c.doi,
    accessed: c.accessed,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

citationsRouter.get('/', async c => {
  const user = c.get('user');
  const items = await prisma.citation.findMany({
    where: { userId: user.id },
    orderBy: [{ year: 'desc' }, { title: 'asc' }],
  });
  return c.json(items.map(shape));
});

citationsRouter.post('/', zValidator('json', CitationBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const created = await prisma.citation.create({
    data: {
      userId: user.id,
      type: body.type,
      authors: body.authors,
      editor: body.editor ?? null,
      year: body.year,
      title: body.title,
      container: body.container ?? null,
      publisher: body.publisher ?? null,
      place: body.place ?? null,
      volume: body.volume ?? null,
      issue: body.issue ?? null,
      pages: body.pages ?? null,
      url: body.url ?? null,
      doi: body.doi ?? null,
      accessed: body.accessed ?? null,
    },
  });
  return c.json(shape(created));
});

citationsRouter.patch('/:id', zValidator('json', PatchBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const id = c.req.param('id');

  const existing = await prisma.citation.findFirst({ where: { id, userId: user.id } });
  if (!existing) return c.json({ error: 'Source not found' }, 404);

  const updated = await prisma.citation.update({
    where: { id },
    data: {
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.authors !== undefined ? { authors: body.authors } : {}),
      ...(body.editor !== undefined ? { editor: body.editor } : {}),
      ...(body.year !== undefined ? { year: body.year } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.container !== undefined ? { container: body.container } : {}),
      ...(body.publisher !== undefined ? { publisher: body.publisher } : {}),
      ...(body.place !== undefined ? { place: body.place } : {}),
      ...(body.volume !== undefined ? { volume: body.volume } : {}),
      ...(body.issue !== undefined ? { issue: body.issue } : {}),
      ...(body.pages !== undefined ? { pages: body.pages } : {}),
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(body.doi !== undefined ? { doi: body.doi } : {}),
      ...(body.accessed !== undefined ? { accessed: body.accessed } : {}),
    },
  });
  return c.json(shape(updated));
});

citationsRouter.delete('/:id', async c => {
  const user = c.get('user');
  const id = c.req.param('id');
  const existing = await prisma.citation.findFirst({ where: { id, userId: user.id } });
  if (!existing) return c.json({ error: 'Source not found' }, 404);
  await prisma.citation.delete({ where: { id } });
  return c.json({ ok: true });
});
