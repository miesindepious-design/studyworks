/**
 * Tests for /api/grades — the grade tracker's assignments.
 *
 * What is proven here:
 *
 *   1. assignments belong to the signed-in user and nobody else;
 *   2. a mark can be left empty (not marked yet) and set later;
 *   3. the weight survives a round trip — it is the whole point of the
 *      tracker, and a silently-dropped weight would quietly lie to the
 *      student about their grade;
 *   4. somebody else's assignment cannot be edited or deleted.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, prismaMock } from './helpers.js';

const BASE = {
  id: 'a1',
  userId: 'u1',
  title: 'Photosynthesis quiz',
  course: 'Biology',
  category: 'Quiz',
  weight: 10,
  score: 8,
  maxScore: 10,
  dueDate: new Date('2026-12-01T00:00:00Z'),
  notes: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
};

describe('/api/grades', () => {
  beforeEach(() => {
    prismaMock.assignment.findMany.mockResolvedValue([]);
    prismaMock.assignment.findFirst.mockResolvedValue(null);
  });

  it('lists the signed-in user\'s assignments', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    prismaMock.assignment.findMany.mockResolvedValue([BASE] as any);
    const res = await request('/api/grades');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe('Photosynthesis quiz');
    expect(body[0].weight).toBe(10);
    expect(body[0].score).toBe(8);
    expect(prismaMock.assignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
  });

  it('creates an assignment with its weight', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    prismaMock.assignment.create.mockImplementation(async ({ data }: any) => ({ ...BASE, ...data }));
    const res = await request('/api/grades', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Essay',
        course: 'History',
        category: 'Homework',
        weight: 25,
        maxScore: 50,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.weight).toBe(25);
    expect(body.maxScore).toBe(50);
    expect(body.score).toBeNull();
  });

  it('accepts an assignment with no mark yet', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    prismaMock.assignment.create.mockImplementation(async ({ data }: any) => ({ ...BASE, ...data }));
    const res = await request('/api/grades', {
      method: 'POST',
      body: JSON.stringify({ title: 'Lab report', course: 'Chemistry', weight: 15 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.score).toBeNull();
  });

  it('rejects a negative weight', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const res = await request('/api/grades', {
      method: 'POST',
      body: JSON.stringify({ title: 'Bad', weight: -5 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a zero maximum score', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    const res = await request('/api/grades', {
      method: 'POST',
      body: JSON.stringify({ title: 'Bad', maxScore: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it('sets a mark on an existing assignment', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    prismaMock.assignment.findFirst.mockResolvedValue(BASE as any);
    prismaMock.assignment.update.mockImplementation(async ({ data }: any) => ({ ...BASE, ...data }));
    const res = await request('/api/grades/a1', {
      method: 'PATCH',
      body: JSON.stringify({ score: 9 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.score).toBe(9);
  });

  it('refuses to touch somebody else\'s assignment', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    prismaMock.assignment.findFirst.mockResolvedValue(null);
    const res = await request('/api/grades/someone-elses', {
      method: 'PATCH',
      body: JSON.stringify({ score: 100 }),
    });
    expect(res.status).toBe(404);
    expect(prismaMock.assignment.update).not.toHaveBeenCalled();
  });

  it('refuses to delete somebody else\'s assignment', async () => {
    const { request, login } = await buildTestApp();
    login({ id: 'u1', email: 'a@b.com', name: 'A', tier: 'FREE' });

    prismaMock.assignment.findFirst.mockResolvedValue(null);
    const res = await request('/api/grades/someone-elses', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(prismaMock.assignment.delete).not.toHaveBeenCalled();
  });

  it('needs a session', async () => {
    const { request } = await buildTestApp();
    const res = await request('/api/grades');
    expect(res.status).toBe(401);
  });
});
