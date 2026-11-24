/**
 * /api/sync  — bidirectional sync between client IndexedDB and Postgres.
 *
 * GET  /api/sync   — pull all user data (used on login / first boot)
 * POST /api/sync   — bulk upsert from client (offline-first catch-up)
 *
 * Concurrency strategy: last-write-wins (LWW) keyed by `(id, updatedAt)`.
 * When the client pushes, we only overwrite a server record if the incoming
 * `updatedAt` is strictly newer than the server's. This prevents the classic
 * "device A syncs old data after device B already wrote newer data" bug.
 *
 * The client is the source of truth *for the user's recent edits*. The server
 * is the source of truth *for data integrity*. The combination is LWW.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../lib/session.js';
import { prisma } from '../lib/prisma.js';
import { computeEffectiveTier } from '../lib/tier.js';

export const syncRouter = new Hono();
syncRouter.use('/*', requireAuth);

const FREE_ITEM_LIMIT = 50;

// ── Pull ────────────────────────────────────────────────────────────────────────
syncRouter.get('/', async c => {
  const user = c.get('user');

  const [notes, contacts, flashcards, folders, practiceQuestions, savedSearches, aiSettings] =
    await Promise.all([
      prisma.note.findMany({
        where:   { userId: user.id },
        include: { highlights: true, personalNotes: true, attachments: true },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.contact.findMany({
        where:   { userId: user.id },
        orderBy: { name: 'asc' },
      }),
      prisma.flashcard.findMany({
        where:   { userId: user.id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.folder.findMany({
        where:   { userId: user.id },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.practiceQuestion.findMany({
        where:   { userId: user.id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.savedSearch.findMany({
        where:   { userId: user.id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.aISettings.findUnique({ where: { userId: user.id } }),
    ]);

  // Return user tier alongside data. `tier` stays the raw billing tier;
  // `effectiveTier` adds the 7-day trial window so the client can unlock
  // Pro features without a second round-trip.
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { tier: true, trialStartsAt: true, trialEndsAt: true, schoolStage: true, schoolClass: true, universityYear: true, department: true },
  });
  const effective = computeEffectiveTier({
    tier: dbUser?.tier ?? 'FREE',
    trialStartsAt: dbUser?.trialStartsAt ?? null,
    trialEndsAt: dbUser?.trialEndsAt ?? null,
  });

  return c.json({
    tier: dbUser?.tier ?? 'FREE',
    effectiveTier: effective,
    trialStartsAt: dbUser?.trialStartsAt ?? null,
    trialEndsAt: dbUser?.trialEndsAt ?? null,
    studentProfile: {
      schoolStage:    dbUser?.schoolStage ?? null,
      schoolClass:    dbUser?.schoolClass ?? null,
      universityYear: dbUser?.universityYear ?? null,
      department:     dbUser?.department ?? null,
    },
    notes,
    contacts,
    flashcards,
    folders,
    practiceQuestions,
    savedSearches,
    aiSettings: aiSettings
      ? {
          provider:              aiSettings.provider,
          model:                 aiSettings.model,
          enabled:               aiSettings.enabled,
          hasApiKey:             !!aiSettings.encryptedApiKey,
          customSummaryPrompt:   aiSettings.customSummaryPrompt,
          customFlashcardPrompt: aiSettings.customFlashcardPrompt,
          customQAPrompt:        aiSettings.customQAPrompt,
        }
      : null,
  });
});

// ── Push (LWW bulk upsert) ─────────────────────────────────────────────────────
const NoteInput = z.object({
  id:          z.string(),
  title:       z.string(),
  content:     z.string(),
  type:        z.string().default('note'),
  tags:        z.array(z.string()).default([]),
  summary:     z.string().optional().nullable(),
  folderId:    z.string().optional().nullable(),
  nextReminder: z.string().datetime().optional().nullable(),
  // Highlights and personal notes are pulled from the server (the note query
  // includes both relations) but were never written back to it, so anything
  // the student highlighted or annotated on one device was missing on every
  // other device. They are replaced wholesale on each push: the client
  // always sends the complete list for the note.
  highlights: z.array(z.object({
    id:        z.string(),
    text:      z.string(),
    color:     z.string(),
    note:      z.string().optional().nullable(),
    createdAt: z.string().datetime(),
  })).optional(),
  personalNotes: z.array(z.object({
    id:        z.string(),
    content:   z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })).optional(),
  createdAt:   z.string().datetime(),
  updatedAt:   z.string().datetime(),
});

const ContactInput = z.object({
  id:           z.string(),
  name:         z.string(),
  role:         z.string(),
  email:        z.string().optional().nullable(),
  phone:        z.string().optional().nullable(),
  notes:        z.string().optional().nullable(),
  tags:         z.array(z.string()).default([]),
  folderId:     z.string().optional().nullable(),
  nextReminder: z.string().datetime().optional().nullable(),
  lastContacted: z.string().datetime().optional().nullable(),
  createdAt:    z.string().datetime(),
  updatedAt:    z.string().datetime(),
});

const FlashcardInput = z.object({
  id:          z.string(),
  question:    z.string(),
  answer:      z.string(),
  tags:        z.array(z.string()).default([]),
  folderId:    z.string().optional().nullable(),
  difficulty:  z.string().optional().nullable(),
  nextReview:  z.string().datetime().optional().nullable(),
  interval:    z.number().optional().nullable(),
  repetitions: z.number().optional().nullable(),
  ef:          z.number().min(1.3).max(5.0).optional().nullable(), // SM-2 ef
  // The fields below were missing from the input schema, so Zod stripped
  // them from every push. The effect was silent and severe: a card's shape
  // (cloze/fill-in), its subject, its leech count, its origin and its whole
  // review trail were all discarded on sync, which broke the Mastery Map
  // and reset the spaced-repetition history on the server copy.
  type:        z.string().optional().nullable(),          // standard | fill-in | cloze
  topic:       z.string().optional().nullable(),          // subject, for the Mastery Map
  leechCount:  z.number().int().min(0).optional().nullable(),
  source:      z.string().optional().nullable(),          // manual | note | ai | tutor
  reviewHistory: z.array(z.object({
    date:    z.string(),
    quality: z.number().int().min(0).max(3),
  })).optional().nullable(),
  createdAt:   z.string().datetime(),
  updatedAt:   z.string().datetime(),
});

const FolderInput = z.object({
  id:          z.string(),
  name:        z.string(),
  isSmart:     z.boolean().default(false),
  smartFilter: z.string().optional().nullable(),
  createdAt:   z.string().datetime(),
  updatedAt:   z.string().datetime().optional(), // backwards compat
});

const PracticeInput = z.object({
  id:        z.string(),
  question:  z.string(),
  answer:    z.string(),
  type:      z.string(),
  options:   z.array(z.string()).default([]),
  noteId:    z.string().optional().nullable(),
  // The subject a question belongs to. Like the flashcard fields above, this
  // was missing from the schema and so was stripped on every push, which
  // quietly emptied practice questions out of the Mastery Map.
  topic:     z.string().optional().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  // SM-2 fields (optional — older clients won't send them)
  nextReview:         z.string().datetime().optional().nullable(),
  interval:           z.number().optional().nullable(),
  repetitions:        z.number().optional().nullable(),
  ef:                 z.number().min(1.3).max(5.0).optional().nullable(),
  lastAnsweredCorrect: z.boolean().optional().nullable(),
});

const SavedSearchInput = z.object({
  id:        z.string(),
  name:      z.string(),
  query:     z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});

const SyncBody = z.object({
  notes:             z.array(NoteInput).default([]),
  contacts:          z.array(ContactInput).default([]),
  flashcards:        z.array(FlashcardInput).default([]),
  folders:           z.array(FolderInput).default([]),
  practiceQuestions: z.array(PracticeInput).default([]),
  savedSearches:     z.array(SavedSearchInput).default([]),
});

// ── LWW helpers ────────────────────────────────────────────────────────────────
// Returns true if the incoming record should overwrite the existing one.
// Missing existing → always accept. Incoming older → reject. Equal → accept
// (idempotent — last writer wins on tie).
function isIncomingNewer(
  incomingUpdatedAt: string,
  existingUpdatedAt: Date | null
): boolean {
  if (!existingUpdatedAt) return true;
  return new Date(incomingUpdatedAt).getTime() >= existingUpdatedAt.getTime();
}

syncRouter.post('/', zValidator('json', SyncBody), async c => {
  const user = c.get('user');
  const body = c.req.valid('json') as z.infer<typeof SyncBody>;

  // Server-side tier enforcement: a free user can't sneak past the 50-item
  // limit by pushing extra items via sync. Pull the live tier from the DB
  // (not the cookie/session) so a Stripe webhook downgrade is reflected
  // immediately on the next push.
  //
  // We always check the limit for free users (not just when the incoming
  // push itself is large) because the existing server data may already be
  // at or above the limit — in that case, even a "small" push would push
  // the user further over.
  const dbUser = await prisma.user.findUnique({
    where:  { id: user.id },
    select: { tier: true, trialEndsAt: true },
  });
  const isPro = computeEffectiveTier({
    tier: dbUser?.tier ?? 'FREE',
    trialEndsAt: dbUser?.trialEndsAt ?? null,
  }) === 'PRO';
  if (!isPro) {
    const [n, co, fc] = await Promise.all([
      prisma.note.count({ where: { userId: user.id } }),
      prisma.contact.count({ where: { userId: user.id } }),
      prisma.flashcard.count({ where: { userId: user.id } }),
    ]);
    const total = n + co + fc;
    if (total >= FREE_ITEM_LIMIT) {
      return c.json({
        error: `Free plan limit: ${FREE_ITEM_LIMIT} items. You have ${total} on the server. Delete some before syncing, or upgrade to Pro.`,
        upgradeUrl: '/pricing',
        currentCount: total,
        limit: FREE_ITEM_LIMIT,
      }, 403);
    }
  }

  // Stats so the client can show "synced N items, accepted M"
  const stats = { notes: 0, contacts: 0, flashcards: 0, folders: 0, practice: 0, searches: 0, conflicts: 0 };

  await prisma.$transaction(async (tx) => {
    // Upsert folders first (notes/contacts/flashcards reference them)
    for (const f of (body as any).folders) {
      const existing = await tx.folder.findUnique({ where: { id: f.id }, select: { updatedAt: true } });
      if (!existing || isIncomingNewer(f.updatedAt ?? f.createdAt, existing.updatedAt)) {
        await tx.folder.upsert({
          where:  { id: f.id },
          create: { ...f, userId: user.id, createdAt: new Date(f.createdAt), updatedAt: new Date(f.updatedAt ?? f.createdAt) },
          update: { name: f.name, isSmart: f.isSmart, smartFilter: f.smartFilter, updatedAt: new Date(f.updatedAt ?? f.createdAt) },
        });
        stats.folders++;
      } else {
        stats.conflicts++;
      }
    }

    for (const n of (body as any).notes) {
      const existing = await tx.note.findUnique({ where: { id: n.id }, select: { updatedAt: true } });
      if (!existing || isIncomingNewer(n.updatedAt, existing.updatedAt)) {
        // The highlight and personal-note lists are replaced wholesale. The
        // client always sends the complete list for a note, so this is a
        // mirror rather than a merge — and it means a highlight deleted on
        // one device is deleted on all of them.
        const highlightRows = (n.highlights ?? []).map((h: any) => ({
          id:        h.id,
          text:      h.text,
          color:     h.color,
          note:      h.note ?? null,
          createdAt: new Date(h.createdAt),
        }));
        const personalNoteRows = (n.personalNotes ?? []).map((p: any) => ({
          id:        p.id,
          content:   p.content,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        }));

        await tx.note.upsert({
          where:  { id: n.id },
          create: {
            ...n,
            userId:      user.id,
            createdAt:   new Date(n.createdAt),
            updatedAt:   new Date(n.updatedAt),
            nextReminder: n.nextReminder ? new Date(n.nextReminder) : undefined,
            highlights:  { create: highlightRows },
            personalNotes: { create: personalNoteRows },
          },
          update: {
            title:       n.title,
            content:     n.content,
            type:        n.type,
            tags:        n.tags,
            summary:     n.summary,
            folderId:    n.folderId,
            updatedAt:   new Date(n.updatedAt),
            nextReminder: n.nextReminder ? new Date(n.nextReminder) : null,
            highlights:  { deleteMany: {}, create: highlightRows },
            personalNotes: { deleteMany: {}, create: personalNoteRows },
          },
        });
        stats.notes++;
      } else {
        stats.conflicts++;
      }
    }

    for (const con of (body as any).contacts) {
      const existing = await tx.contact.findUnique({ where: { id: con.id }, select: { updatedAt: true } });
      if (!existing || isIncomingNewer(con.updatedAt, existing.updatedAt)) {
        await tx.contact.upsert({
          where:  { id: con.id },
          create: {
            ...con,
            userId:       user.id,
            createdAt:    new Date(con.createdAt),
            updatedAt:    new Date(con.updatedAt),
            nextReminder: con.nextReminder  ? new Date(con.nextReminder)  : undefined,
            lastContacted: con.lastContacted ? new Date(con.lastContacted) : undefined,
          },
          update: {
            name:         con.name,
            role:         con.role,
            email:        con.email,
            phone:        con.phone,
            notes:        con.notes,
            tags:         con.tags,
            folderId:     con.folderId,
            updatedAt:    new Date(con.updatedAt),
            nextReminder: con.nextReminder  ? new Date(con.nextReminder)  : null,
            lastContacted: con.lastContacted ? new Date(con.lastContacted) : null,
          },
        });
        stats.contacts++;
      } else {
        stats.conflicts++;
      }
    }

    for (const fc of (body as any).flashcards) {
      const existing = await tx.flashcard.findUnique({ where: { id: fc.id }, select: { updatedAt: true } });
      if (!existing || isIncomingNewer(fc.updatedAt, existing.updatedAt)) {
        await tx.flashcard.upsert({
          where:  { id: fc.id },
          create: {
            ...fc,
            userId:     user.id,
            createdAt:  new Date(fc.createdAt),
            updatedAt:  new Date(fc.updatedAt),
            nextReview: fc.nextReview ? new Date(fc.nextReview) : undefined,
          },
          update: {
            question:    fc.question,
            answer:      fc.answer,
            tags:        fc.tags,
            folderId:    fc.folderId,
            difficulty:  fc.difficulty,
            nextReview:  fc.nextReview ? new Date(fc.nextReview) : null,
            interval:    fc.interval,
            repetitions: fc.repetitions,
            ef:          fc.ef ?? 2.5,
            // These were missing from the update branch, so a card that
            // already existed on the server kept its old shape, subject,
            // leech count and review trail even after the client had
            // changed them. That is how a card's spaced-repetition history
            // and Mastery Map subject got lost on every device.
            type:          fc.type ?? 'standard',
            topic:         fc.topic ?? null,
            leechCount:    fc.leechCount ?? 0,
            source:        fc.source ?? null,
            reviewHistory: fc.reviewHistory ?? undefined,
            updatedAt:     new Date(fc.updatedAt),
          },
        });
        stats.flashcards++;
      } else {
        stats.conflicts++;
      }
    }

    for (const pq of (body as any).practiceQuestions) {
      const existing = await tx.practiceQuestion.findUnique({ where: { id: pq.id }, select: { id: true } });
      if (existing) {
        // Practice questions are append-only by content — update SRS state if seen again.
        await tx.practiceQuestion.update({
          where: { id: pq.id },
          data:  {
            question:  pq.question,
            answer:    pq.answer,
            type:      pq.type,
            options:   pq.options,
            noteId:    pq.noteId,
            // The subject was missing here too, so a question that had been
            // filed under a topic lost that filing on the server and fell
            // out of the Mastery Map.
            topic:     pq.topic ?? null,
            nextReview: pq.nextReview ? new Date(pq.nextReview) : null,
            interval:   pq.interval,
            repetitions: pq.repetitions,
            ef:         pq.ef,
            lastAnsweredCorrect: pq.lastAnsweredCorrect,
          },
        });
      } else {
        await tx.practiceQuestion.create({
          data: {
            ...pq,
            userId:    user.id,
            createdAt: new Date(pq.createdAt),
            nextReview: pq.nextReview ? new Date(pq.nextReview) : null,
            interval:   pq.interval,
            repetitions: pq.repetitions,
            ef:         pq.ef,
            lastAnsweredCorrect: pq.lastAnsweredCorrect,
          },
        });
      }
      stats.practice++;
    }

    for (const ss of (body as any).savedSearches) {
      const existing = await tx.savedSearch.findUnique({ where: { id: ss.id }, select: { updatedAt: true } });
      if (!existing || isIncomingNewer(ss.updatedAt ?? ss.createdAt, existing.updatedAt)) {
        await tx.savedSearch.upsert({
          where:  { id: ss.id },
          create: { ...ss, userId: user.id, createdAt: new Date(ss.createdAt), updatedAt: new Date(ss.updatedAt ?? ss.createdAt) },
          update: { name: ss.name, query: ss.query, updatedAt: new Date(ss.updatedAt ?? ss.createdAt) },
        });
        stats.searches++;
      } else {
        stats.conflicts++;
      }
    }
  });

  return c.json({ success: true, stats });
});
