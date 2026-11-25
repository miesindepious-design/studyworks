# Feature roadmap — everything still to build

Ordered by importance. Each item is a self-contained feature with a clear
definition of done. This file is the source of truth for what remains; it
gets a tick and a line of history when an item lands.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## 1. Note-level spaced repetition
**Why first:** the whole spaced-repetition engine works only for flashcards.
Notes have `lastRevisited` and `nextReminder`, but nothing schedules a note to
come back — so the material a student actually writes never resurfaces as
they forget it. This is the biggest structural gap in the app.

- [ ] `Note` gains `repetitions`, `interval`, `ef`, `nextReview`, `reviewHistory`
- [ ] Server: `Note` model gains the same fields + migration
- [ ] Sync: the new fields survive a push/pull
- [ ] A "Recall notes" review mode: show the note's title and a masked summary,
      reveal, self-rate, schedule with SM-2
- [ ] Notes join the Study Plan queue on the same terms as cards
- [ ] Mastery Map counts notes, not just cards and questions
- [ ] `note_reviewed` XP event (the daily quests need one)

## 2. Deck settings — daily limits and per-deck overrides
**Why:** a backlog of 800 due cards currently means one enormous session or
none at all. Anki users expect "20 new per day" and "max 200 reviews".

- [ ] `DeckSettings` model: per-folder new/day, reviews/day, per-item overrides
- [ ] The daily queue respects the limits (cards, questions, notes together)
- [ ] Settings UI for the global defaults and per-deck overrides
- [ ] The plan says when it is stopping, and why

## 3. Deck progress
**Why:** `DeckProgress` is declared in `src/types.ts` and used nowhere. The
shape is already right — it just needs filling in.

- [ ] Compute per-folder total / mastered / learning / new / due / progress
- [ ] A deck list on the Flashcards page
- [ ] Server persistence so it follows the student across devices

## 4. AI leech fixer
**Why:** the `leech_fixed` XP event (15 XP, "Tough card fixed") is defined and
**unreachable**. A leech usually means a badly-worded card, so the fix is
rewriting it, not re-memorising it. The `source` field exists for exactly this
and nothing reads it.

- [ ] Server route: rewrite a card's question/answer in clearer words
- [ ] Client: "Fix this card" on leeches and AI-made cards
- [ ] Review-and-accept UI — never overwrite a card silently
- [ ] Awards `leech_fixed`
- [ ] Records that the card was fixed, so it is not fixed twice

## 5. Socratic tutor mode
**Why:** all four tutor modes give information. A fifth that only asks
questions is a proven study technique, and the `mode` enum already has a slot.

- [ ] `socratic` added to `TutorMode`
- [ ] Prompt that asks instead of tells, one question at a time
- [ ] Client toggle in the tutor
- [ ] The tutor's answer panel handles a question-only reply

## 6. Grade / assignment tracker with weighted grade calculator
**Why:** absent entirely. Students routinely need "what do I need on the final
to get an A?".

- [ ] `Grade` model: course, assignment, weight, score, max, due date
- [ ] Server routes + sync
- [ ] Weighted current-grade calculation
- [ ] "What do I need to hit my target?" projection
- [ ] A dashboard card with upcoming deadlines

## 7. Weekly email digest
**Why:** `WeeklyRecap` shows the week's story and has a Copy button, but
nothing sends it. Resend is already wired server-side.

- [ ] Server route that renders the week's numbers
- [ ] Opt-in per user (never send unasked)
- [ ] Weekly schedule
- [ ] A preference toggle in Settings

## 8. Real Anki `.apkg` export
**Why:** export produces a plain text file. Anki users want the real archive
(SQLite inside a zip).

- [ ] Build a `collection.anki2` SQLite database
- [ ] Zip it with the media folder
- [ ] Round-trip check against a known-good `.apkg`

## 9. Import from Quizlet / Notion / Google Docs
**Why:** only Anki import exists. `PricingView` already advertises these as
Phase 2, so it is a known gap.

- [ ] Quizlet CSV / TXT import
- [ ] Notion export (Markdown + CSV) import
- [ ] Google Docs export import
- [ ] One import wizard that detects the format

## 10. Citations & bibliography generator
**Why:** nothing exists for citing sources.

- [ ] APA / MLA / Harvard / Chicago / IEEE output
- [ ] A citation stored per note, with the source it came from
- [ ] A bibliography view and export

## 11. Study-group collaborative editing
**Why:** sharing is read-only. A classmate cannot edit a shared folder. This
is the biggest lift and the biggest differentiator.

- [ ] Real-time collaborative editing (CRDT or OT)
- [ ] Permissions: owner / editor / viewer
- [ ] Presence and conflict handling
- [ ] Sync that does not clobber a collaborator's work

## 12. Audio lecture capture, transcription and note-making
**Why:** `getUserMedia` is used only by voice rooms. Recording a lecture,
transcribing it and turning it into notes is a large build with real cost
implications.

- [ ] Record audio from the app
- [ ] Upload and transcribe
- [ ] Turn the transcript into a note with key points
- [ ] Cost controls — this is the only feature that costs money per use

---

## Landed in this session

- **Study Plan** — one ordered queue merging cards, questions and notes, with a
  14-day forecast and a mistakes book.
- **Highlights → Flashcards** — cloze or recall cards from highlighted
  passages, no AI key needed.
- **Review session history** — sessions persisted with timings and read back
  into the statistics panel.
- **Sync field preservation** — card shape, subject, leech count, origin and
  review trail; question subjects; note highlights and personal notes.
- **Dashboard storage guard** — `saveAchievements` no longer crashes when
  `localStorage` is unavailable.
