/**
 * Tests for /api/citations — the bibliography's sources.
 *
 * What is proven here:
 *
 *   1. sources belong to the signed-in user and nobody else;
 *   2. the facts survive a round trip — especially the author list, because
 *      a dropped author is a wrong reference that looks right;
 *   3. the style is never stored, only the facts — so switching from APA to
 *      MLA does not have to re-save anything;
 *   4. somebody else's source cannot be edited or deleted.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, prismaMock } from './helpers.js';

const BASE = {
  id: 'c1',
  userId: 'u1',
  type: 'book',
  authors: ['Morrison, Toni'],
  editor: null,
  year: '1987',
  title: 'Beloved',
  container: null,
  publisher: 'Alfred A. Knopf',
  place: 'New York',
  volume: null,
  issue: null,
  pages: null,
  url: null,
  doi: null,
  accessed: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
};

describe('/api/citations', () => {
  beforeEach(() => {
    prismaMock.citation.findMany.mockResolvedValue([]);
    prismaMock.citation.findFirst.mockResolvedValue(null);
  });

  it('lists the signed-in user\'s sources', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    prismaMock.citation.findMany.mockResolvedValue([BASE] as any);
    const res = await request('/api/citations');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe('Beloved');
    expect(body[0].authors).toEqual(['Morrison, Toni']);
    expect(prismaMock.citation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
  });

  it('stores the facts of a source', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    prismaMock.citation.create.mockImplementation(async ({ data }: any) => ({ ...BASE, ...data }));
    const res = await request('/api/citations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'journal',
        authors: ['Smith, Jane A.', 'Doe, John'],
        year: '2024',
        title: 'On things',
        container: 'Journal of Examples',
        volume: '12',
        issue: '3',
        pages: '1-20',
        doi: '10.1234/joe.2024.001',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('On things');
    expect(body.authors).toEqual(['Smith, Jane A.', 'Doe, John']);
    expect(body.type).toBe('journal');
    expect(body.doi).toBe('10.1234/joe.2024.001');
  });

  it('does not store a style — the style is chosen at render time', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    prismaMock.citation.create.mockImplementation(async ({ data }: any) => ({ ...BASE, ...data }));
    const res = await request('/api/citations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'A book' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.style).toBeUndefined();
  });

  it('rejects a source with no title', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const res = await request('/api/citations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: '2020' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown source type', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const res = await request('/api/citations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'A book', type: 'podcast' }),
    });
    expect(res.status).toBe(400);
  });

  it('updates a source the student owns', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    prismaMock.citation.findFirst.mockResolvedValue(BASE as any);
    prismaMock.citation.update.mockImplementation(async ({ data }: any) => ({ ...BASE, ...data }));

    const res = await request('/api/citations/c1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: '1988' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.year).toBe('1988');
  });

  it('will not let one student edit another\'s source', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    prismaMock.citation.findFirst.mockResolvedValue(null);

    const res = await request('/api/citations/c9', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: '1988' }),
    });
    expect(res.status).toBe(404);
    expect(prismaMock.citation.update).not.toHaveBeenCalled();
  });

  it('will not let one student delete another\'s source', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    prismaMock.citation.findFirst.mockResolvedValue(null);

    const res = await request('/api/citations/c9', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(prismaMock.citation.delete).not.toHaveBeenCalled();
  });

  it('deletes a source the student owns', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    prismaMock.citation.findFirst.mockResolvedValue(BASE as any);
    prismaMock.citation.delete.mockResolvedValue({} as any);

    const res = await request('/api/citations/c1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(prismaMock.citation.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('refuses everything without a session', async () => {
    const { request } = await buildTestApp();

    const res = await request('/api/citations');
    expect(res.status).toBe(401);
  });
});
