/**
 * /api/grades — the grade tracker's API.
 *
 * The server stores the raw numbers (title, course, weight, mark); every
 * weighted calculation happens on the client in `src/utils/grades.ts`, so
 * the student sees the maths update instantly as they type a mark.
 */
import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { GradeAssignment } from '../utils/grades';

/** What the server sends back — dates arrive as ISO strings. */
export type GradeAssignmentDTO = Omit<
  GradeAssignment,
  'createdAt' | 'updatedAt' | 'dueDate'
> & {
  dueDate?: string | null;
  createdAt: string;
  updatedAt: string;
};

export function listAssignments(): Promise<GradeAssignmentDTO[]> {
  return apiGet<GradeAssignmentDTO[]>('/api/grades');
}

export function createAssignment(body: {
  title: string;
  course: string;
  category: string;
  weight: number;
  score?: number | null;
  maxScore: number;
  dueDate?: string | null;
  notes?: string | null;
}): Promise<GradeAssignmentDTO> {
  return apiPost<GradeAssignmentDTO>('/api/grades', body);
}

export function updateAssignment(
  id: string,
  body: Partial<{
    title: string;
    course: string;
    category: string;
    weight: number;
    score: number | null;
    maxScore: number;
    dueDate: string | null;
    notes: string | null;
  }>,
): Promise<GradeAssignmentDTO> {
  return apiPatch<GradeAssignmentDTO>(`/api/grades/${encodeURIComponent(id)}`, body);
}

export function deleteAssignment(id: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/api/grades/${encodeURIComponent(id)}`);
}
