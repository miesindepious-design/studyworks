/**
 * questionGen.ts — build multiple-choice questions from shared study files.
 *
 * The same generator serves two features:
 *   • a multiplayer quiz battle seeded from the files a group shared
 *   • an asynchronous duel seeded from the same files
 *
 * The files arrive as text (the browser extracts it — pdfjs for PDFs, jszip
 * for DOCX/PPTX, OCR for photos) and are stored on the RoomFile row, so the
 * material the questions are built from is exactly the material the group
 * sees in the lobby.
 */

import { SYSTEM_BASE, loadAIConfig, callProvider } from './aiProvider.js';
import { studentProfileBits, studentPromptContext } from './studentProfile.js';
import { prisma } from './prisma.js';

export interface GeneratedQuestion {
  prompt: string;
  options: string[];
  answerIdx: number;
}

export interface DocumentInput {
  name: string;
  text: string;
}

/**
 * Load the text of the files a lobby holds.
 *
 * `fileIds` narrows it to the files the user picked; without it every file in
 * the lobby is used. Files without extracted text are skipped — there is
 * nothing for the model to read.
 */
export async function loadLobbyDocuments(
  lobbyCode: string,
  fileIds?: string[],
): Promise<{ lobbyId: string | null; documents: DocumentInput[]; label: string; fileNames: string[] }> {
  const lobby = await prisma.lobby.findUnique({
    where: { code: lobbyCode.toUpperCase() },
    include: { roomFiles: { orderBy: { createdAt: 'asc' } } },
  });
  if (!lobby) return { lobbyId: null, documents: [], label: lobbyCode, fileNames: [] };

  const wanted = fileIds?.length ? lobby.roomFiles.filter(f => fileIds.includes(f.id)) : lobby.roomFiles;
  const withText = wanted.filter(f => f.text && f.text.trim().length > 0);
  const documents: DocumentInput[] = withText.map(f => ({ name: f.name, text: f.text! }));
  const fileNames = withText.map(f => f.name);

  return {
    lobbyId: lobby.id,
    documents,
    label: fileNames.length === 1 ? fileNames[0] : `${lobby.title} (${fileNames.length} files)`,
    fileNames,
  };
}

/**
 * Ask the model for multiple-choice questions grounded in the shared files.
 *
 * Returns fewer than requested if the model could not find that many good
 * questions — the caller decides whether that is enough to play.
 */
export async function generateQuestionsFromDocuments(opts: {
  userId: string;
  user: any;
  documents: DocumentInput[];
  count: number;
  topicLabel?: string;
}): Promise<GeneratedQuestion[]> {
  const cfg = await loadAIConfig(opts.userId);
  const profileBits = studentProfileBits(opts.user);
  const audience = profileBits.length > 0 ? profileBits.join(', ') : 'a general student';
  const studentCtx = studentPromptContext(profileBits);

  // Keep the request under control — several chapters still fit comfortably.
  const budget = 120_000;
  let used = 0;
  const sources: string[] = [];
  for (const doc of opts.documents) {
    if (used >= budget) break;
    const room = budget - used;
    const slice = doc.text.slice(0, room);
    used += slice.length;
    sources.push(`--- ${doc.name} ---\n${slice}`);
  }

  const topic = opts.topicLabel?.trim() || 'the shared study material';

  const raw = await callProvider({
    provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey,
    messages: [
      { role: 'system', content: `${SYSTEM_BASE}${studentCtx}` },
      {
        role: 'user',
        content: `Generate ${opts.count} multiple-choice quiz questions on "${topic}" for ${audience}, using ONLY the study material below.
Rules:
- Each question has exactly 4 options and exactly one correct answer.
- Ground every question in the material; never invent facts that are not in it.
- Cover the breadth of the material: definitions, application, reasoning and exam-style traps.
- Distractors must be plausible but clearly wrong on careful reading.
- Write questions the way an exam would phrase them.
Return JSON: { "questions": [ { "prompt": "...", "options": ["...","...","...","..."], "answerIdx": 0 } ] } where answerIdx is the 0-based index of the correct option.

Material:
${sources.join('\n\n')}`,
      },
    ],
    temperature: 0.6, maxTokens: 8192, jsonMode: true, thinking: 'low',
  });

  return parseQuestions(raw).slice(0, opts.count);
}

/** Normalise the model's JSON into clean questions. */
export function parseQuestions(raw: string): GeneratedQuestion[] {
  let obj: any = null;
  try {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    obj = JSON.parse(candidate);
  } catch {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      obj = match ? JSON.parse(match[0]) : null;
    } catch {
      obj = null;
    }
  }

  const list: any[] = Array.isArray(obj) ? obj : (obj?.questions ?? []);
  if (!Array.isArray(list)) return [];

  return list
    .filter((q: any) =>
      typeof q?.prompt === 'string' && q.prompt.trim() &&
      Array.isArray(q.options) && q.options.length >= 2 &&
      Number.isInteger(q.answerIdx) && q.answerIdx >= 0 && q.answerIdx < q.options.length)
    .map((q: any) => ({
      prompt:  String(q.prompt).trim(),
      options: q.options.map((o: any) => String(o)),
      answerIdx: q.answerIdx,
    }));
}
