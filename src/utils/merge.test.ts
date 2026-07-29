/**
 * Tests for the LWW merge utility used by cloud-sync pull.
 */
import { describe, it, expect } from 'vitest';
import { mergeByLWW, mergeTier } from './merge';

describe('mergeByLWW', () => {
  it('keeps local when both have the same id and no updatedAt', () => {
    const a = { id: '1', value: 'local',  createdAt: new Date('2025-01-01') };
    const b = { id: '1', value: 'remote', createdAt: new Date('2025-01-01') };
    expect(mergeByLWW([a], [b])).toEqual([a]);
  });

  it('picks the remote when remote is newer', () => {
    const a = { id: '1', value: 'local',  createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-02') };
    const b = { id: '1', value: 'remote', createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-05') };
    expect(mergeByLWW([a], [b])[0]).toEqual(b);
  });

  it('keeps local when local is newer', () => {
    const a = { id: '1', value: 'local',  createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-05') };
    const b = { id: '1', value: 'remote', createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-02') };
    expect(mergeByLWW([a], [b])[0]).toEqual(a);
  });

  it('keeps records present only on one side', () => {
    const a = { id: '1', value: 'a', createdAt: new Date('2025-01-01') };
    const b = { id: '2', value: 'b', createdAt: new Date('2025-01-01') };
    const r = mergeByLWW([a], [b]);
    expect(r.map(x => x.id).sort()).toEqual(['1', '2']);
  });
});

describe('mergeTier', () => {
  it('prefers server (billing source of truth)', () => {
    expect(mergeTier('free', 'PRO')).toBe('pro');
    expect(mergeTier('PRO',  'free')).toBe('free');
  });
  it('falls back to local when server is missing', () => {
    expect(mergeTier('pro', null)).toBe('pro');
    expect(mergeTier(null, 'PRO')).toBe('pro');
  });
  it('defaults to free when both are missing', () => {
    expect(mergeTier(null, null)).toBe('free');
  });
});
