# StudyWorks — Pro Feature Roadmap

Generated from a deep audit of the codebase on 13 Jul 2026. Source: `src/` (Vite/React 19/TS) + `server/` (Hono/Prisma/Postgres/Better Auth). All findings are based on the actual code, not the marketing copy.

The Pro page (`src/components/PricingView.tsx`) ships with a per-feature `built: true|false` flag. I treated the `true` list as "claimed shipped" and the `false` list as "coming soon", then cross-checked each one against the code.

---

## TL;DR

There are **two parallel categories of unfinished work**:

1. **6 Pro features are advertised on the Pricing page but never built** (`built: false` in `PricingView.tsx`).
2. **At least 5 Pro features are integrated into the UI but are wired up incorrectly or to dead code paths** — the buttons exist, the routes exist in places, but the wiring is broken or bypasses a real backend (e.g. the AI proxy server, the Stripe checkout flow).

Net effect: a paying user clicking "Upgrade to Pro" gets a free demo upgrade. The "Cloud sync" feature is half-built (client never calls the server sync endpoint from `useDB`). The "Smart Q&A", "AI summary", "semantic search" and "weekly insights" buttons all **work locally if the user pastes their own Gemini/OpenAI key into the browser** — but the server-side AI proxy that the schema and routes already support is never used.

There are also ~7 quality/polish issues across the in-app "built" features that the user will hit on day one.

---

## Part 1 — Pro features listed on the Pricing page but NOT integrated

Source: `src/components/PricingView.tsx` lines 28–56 — items where `built: false`. These are shown under a "🔜 Coming soon" subhead on the Pro card, so they're honestly disclosed as not built. The task is to actually build them.

| # | Feature | What's there | What needs building | Complexity | Suggested phase |
|---|---|---|---|---|---|
| 1 | **Browser extension** | Nothing. The repo has no `extension/` directory. | Manifest V3 Chrome/Firefox extension that captures selected text and one-click "save to StudyWorks" via a personal API token. Two pages: popup (search/save) and options (auth + tier gate). | High (separate app, code-signing for Chrome Web Store) | Phase 2 (post-MVP) |
| 2 | **Email-to-save** | Nothing. The `Resend` SDK is referenced in `server/src/lib/auth.ts` (line 8) but only used for password-reset. | Inbound email pipeline. Options: (a) Postmark Inbound / SendGrid Inbound Parse / AWS SES → webhook, (b) mailgun routes, or (c) a Gmail API OAuth. Strip the body, optional `[[Title]]` subject, save as note for the user matching `to: <userid>+@studyworks.app`. | High (inbound webhooks, address allocation, spam filtering) | Phase 2 |
| 3 | **Save Twitter / YouTube** | Nothing. | For YouTube: extract video id from URL, call YouTube Data API (or a transcript API like youtube-transcript.io), save as a note tagged `youtube`. For Twitter/X: an oEmbed/embed lookup is no longer reliable post-API-shutdown; pivot to **URL unfurl** that grabs `<meta>` (og:title, og:description, og:image) and saves as a "link" note. | Medium | Phase 2 |
| 4 | **Share folders with others** | Schema has no `FolderShare` model. Folders are per-user. | Add `FolderShare { folderId, sharedWithUserId, role }`. UI: "Share" button in folder dropdown, recipient email picker, role selector (view/edit). Add a `GET /api/folders/shared-with-me` route and surface those folders in the folder picker. | Medium-High (ACL logic, notifications) | Phase 2 |
| 5 | **Cloud sync** | **Half-built.** Server route exists at `server/src/routes/sync.ts` (full upsert/pull logic, transaction-safe). The Prisma schema is in place. The **client never calls it from the data path** — `App.tsx` calls `pullSync()` once on login (lines 99–123) and `pushSync()` debounced after data changes (lines 188–201), but the data is *also* written to IndexedDB by `useDB.ts` setters via `clear()`+`putAll()` (lines 132–178). On every `setNotes(notes)` call the IDB is cleared and rewritten → which means **the sync push is racing the IDB write, and there is no offline queue / conflict resolution**. Also: there is no `/api/ai/settings` write from `SettingsView` — it writes only to IDB (`saveAIConfig` in `db/aiSettings.ts`), so server-side AI settings are perpetually empty even after `pullSync` shows them. | See **Part 3** for the full fix list. | High | Phase 1 (this is the foundation for everything else) |
| 6 | **Email support (48 h)** | Nothing. | Support inbox integration (HelpScout / Plain / Front). Or simpler: a `support@studyworks.app` inbox that creates a Linear ticket via API. | Low (process + SLA) | Phase 1 (operational) |

---

## Part 2 — Pro features marked `built: true` but actually NOT working

These are the dangerous ones. The Pro page ships a green checkmark, the UI shows the feature, but the wiring is broken or self-defeating. I found **5 confirmed** and **2 likely**:

### 🔴 #1 — "Upgrade to Pro" is a demo, not Stripe

- **What the user sees**: Click "Upgrade to Pro →" in `PricingView` → confirmation modal with text *"This is a demo — no real payment is processed. In production this would open Stripe Checkout. Confirm to enable all Pro features now."* → tier flips to `pro` for free.
- **Where**: `App.tsx` lines 521–529. `handleUpgrade('pro')` only sets `setUpgradeModal('upgrade')`, and the modal's `onConfirm` just calls `db.setTier('pro')`.
- **What already exists** but is unused: full Stripe integration in `server/src/routes/stripe.ts` — `/api/stripe/checkout`, `/api/stripe/portal`, `/api/stripe/webhook`. The Prisma schema carries `stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId`, `stripeCurrentPeriodEnd`. The `.env.example` lists `STRIPE_PRO_MONTHLY_PRICE_ID` and `STRIPE_PRO_YEARLY_PRICE_ID`. None of it is called from the frontend.
- **Fix**:
  1. Add a client `src/api/billing.ts` with `createCheckoutSession(priceId)` and `openPortal()` that hit `/api/stripe/checkout` and `/api/stripe/portal`.
  2. In `PricingView`, replace the "Upgrade" button with one that calls `createCheckoutSession(billing === 'monthly' ? STRIPE_PRO_MONTHLY_PRICE_ID : STRIPE_PRO_YEARLY_PRICE_ID)` and `window.location = url`.
  3. The modal becomes a real success/cancel handler for `?checkout=success|cancel` (the server already returns those URLs).
  4. The current `db.setTier('pro')` in `App.tsx` should be replaced by re-pulling `/api/sync` after success — the server's webhook will have updated the tier, the next pull will reflect it.
  - **Effort**: ~1 day. **Priority**: P0.

### 🔴 #2 — Cloud sync overwrites local edits on every pull (data loss bug)

- **Where**: `App.tsx` lines 99–123. After sign-in, `pullSync()` is called and its result is *unconditionally* assigned: `db.setNotes(remote.notes)`, `db.setContacts(remote.contacts)`, etc. Each `setX` triggers a `clear()`+`putAll()` in `useDB.ts`.
- **What's wrong**:
  1. **No merge.** If a user makes an offline edit, then signs in on another device, the offline edits are clobbered by whatever the server has — even if the server's copy is older.
  2. **No conflict resolution.** There is no per-record `updatedAt` comparison. The server's `pushSync` route is "id-keyed upsert", so it works fine for push, but the *pull* path treats the server as truth.
  3. **High write rate to IDB.** Every push effect in `App.tsx` (line 188) triggers `clear()`+`putAll()` for each of notes/contacts/flashcards. With 200+ items this stalls the main thread on every keystroke save (the debounce is 3s but each debounced write rewrites the entire array).
  4. **`pushSync` reads the IDB state from `useUndoRedo` (notesUR.state, contactsUR.state, flashcardsUR.state) but uses `db.folders`, `db.practiceQuestions`, `db.savedSearches` directly** (App.tsx lines 193–198). So undo/redo of folders, practice questions and saved searches would *not* sync, but undo/redo of notes/contacts/flashcards would. Inconsistent.
- **Fix**:
  1. Add `updatedAt` to all schemas (server already has it on most, missing on `Folder` and `SavedSearch` — confirm) and compare per-record.
  2. Implement a proper LWW (last-write-wins) merge keyed by `(id, updatedAt)`. Prefer the larger `updatedAt`. Keep local-only and remote-only records; only emit conflicts when the *content* differs for the same id.
  3. Add a `version` field for true CRDTs later, but LWW is fine for v1.
  4. In `useDB`, switch from `clear()+putAll()` to a diffing `put()` of only changed items, and call `delete()` on removed items.
  5. Move the push to also include folders/practice/savedSearches via the same undo/redo pattern (or wrap them in their own undo/redo so behaviour is uniform).
  - **Effort**: 2–3 days. **Priority**: P0 — this is a data-corruption risk for anyone who uses sync.

### 🔴 #3 — AI features work, but the server-side AI proxy is bypassed entirely

- **What works**: User enters a Gemini/OpenAI key in Settings → `saveAIConfig` writes to IDB → `useAI` calls `chatComplete()` from `src/ai/client.ts` directly from the browser, using the key. Summaries, flashcards, practice questions, Q&A, semantic rerank, weekly insights all work.
- **What doesn't**: The server has a full AI proxy at `server/src/routes/ai.ts` with `POST /api/ai/summary`, `/flashcards`, `/practice-questions`, `/qa`, `/rerank`, `/insights`, plus `GET/PUT /api/ai/settings`. The server stores the API key encrypted (`server/src/lib/encryption.ts`) per user. **The frontend never uses it.** The Settings page writes to `settingsDB` (IDB), not to `/api/ai/settings`.
- **Consequences**:
  1. **API keys are stuck in the browser.** If the user switches devices, they have to paste the key again. Even though the schema and `syncRouter` already round-trip `aiSettings` (with `hasApiKey: true|false` — server strips the actual key), the **client never sends the key to the server**. So `hasApiKey` is always false on the server side.
  2. **No usage tracking.** The plan is to charge Pro for "unlimited AI", but there's no way to count calls per user when they all happen client-side. The `aiSummariesThisMonth` and `qaQueriesThisMonth` counters in `useDB.ts` are local-only and trivially bypassed.
  3. **CORS / no server-side rate limiting.** Anyone can hammer the provider directly with no controls.
- **Fix**:
  1. Update `SettingsView` `handleSaveAI` to `PUT /api/ai/settings` (in addition to or instead of the local write). On the client, store only `hasApiKey: true` and the provider/model; never the actual key.
  2. Make `useAI`'s functions call the server endpoints (`apiPost('/api/ai/summary', ...)` etc.) instead of `chatComplete()` directly. The server decrypts the key and proxies.
  3. Move `aiSummariesThisMonth` / `qaQueriesThisMonth` counters to the server, atomically incremented inside the AI route. Have `/api/sync` return them.
  4. Keep a tiny **client-side fallback** for users who have explicitly opted out of cloud AI and want to keep the key 100% local — but default to the server proxy for everyone.
  - **Effort**: 2–3 days. **Priority**: P1 — needed before the "unlimited AI" promise is meaningful.

### 🔴 #4 — Tier is local-first, server is the source of truth, and they disagree

- **Where**: `db.tier` lives in IDB (`useDB.ts` line 73, set in `setTier` line 185). It's seeded from server in `App.tsx` line 114 (`if (remote.tier) db.setTier(remote.tier.toLowerCase() as 'free' | 'pro')`). But the Stripe webhook updates the server's `User.tier` to `'PRO'`/`'FREE'` — and the only way the client learns is on the *next* pull.
- **What's wrong**:
  1. If the user upgrades via the (currently broken — see #1) Stripe flow, they keep seeing "Free" until they refresh and re-login.
  2. Pro gates (e.g. "Folders are a Pro feature!") check `tier === 'pro'` against the IDB value, which can lag the server.
  3. The `?checkout=success` URL in the Stripe route sets up the right callback, but `App.tsx` doesn't read it.
- **Fix**:
  1. On `?checkout=success` page load, call `pullSync()` to refresh tier + all data.
  2. Long-term: add WebSocket/SSE push from server → client on `user.tier` change.
  3. Make every Pro-gated action (`generateFlashcards`, `addFolder`, `saveSearch`, `handleFileUpload`, `startReview`, `relatedNotes`) re-check tier on the **server** too — not just the client. The current gates are 100% client-side, so a Pro-feature call to the server is unguarded. (This is fine while the API is in dev, but the moment it ships publicly, anyone can `curl` the AI endpoints and get Pro features for free.)
  - **Effort**: 1 day for #1, +2 days for server-side enforcement + WebSocket. **Priority**: P0 (security).

### 🔴 #5 — File uploads work, but the binary lives in IDB as a base64 data URL

- **Where**: `NotesView.handleFileUpload` (lines 152–164) reads the file as a `FileReader.readAsDataURL` and stores the full data URL on `note.files[].url`. This is then sent to the server via `pushSync` (`api/sync.ts` `reviveNote` line 74 → `a.url`).
- **What's wrong**:
  1. **A 50 MB PDF becomes ~67 MB of base64 in IDB.** IndexedDB can handle it but it's slow and burns browser quota. 100 MB is the Pro quota per the Pricing page; 2 PDFs and you can be at the limit.
  2. **Server can't serve it.** The Prisma `Attachment` model has `storageKey: String` and `url: String` (lines 156–158 of `schema.prisma`) — clearly designed for S3/R2 object storage. But the client never uploads to S3; it just sends a base64 string in the `url` field. There's no presign endpoint, no `/api/attachments/upload`, no S3/R2 client.
  3. **No actual cloud storage of files.** So a user who signs in on another device sees a 50MB blob on each note — but the "cloud sync" promise says their files follow them. They sort of do, but as 67MB-of-base64 strings eating the user's network on every sync.
  4. The Pro feature label "File uploads — PDF, images, audio" is technically true (you can attach), but it is not implemented the way the schema implies.
- **Fix**:
  1. Add an `attachments` route: `POST /api/attachments/presign` returns a presigned S3/R2 URL; the client PUTs the file directly to the bucket; the client then `POST /api/notes/:id/attachments` with the resulting `storageKey` and `url`.
  2. The Prisma model is already shaped for this — just need the route + R2 bucket + CORS.
  3. Migrate existing base64 attachments on next save (one-time backfill: re-upload to R2, replace `url` with the new R2 URL).
  4. Enforce 50MB / type / Pro tier **on the server** in the presign route.
  - **Effort**: 2 days. **Priority**: P1.

### 🟡 #6 — "Related notes" is a fake, tag-only stub

- **What the user sees**: "🔗 Related" section under expanded notes. (`NotesView.tsx` line 737)
- **Where**: `relatedNotes(note)` line 352 — just `notes.filter(n => n.id !== note.id && n.tags.some(t => note.tags.includes(t))).slice(0, 3)`.
- **What's wrong**:
  1. It's the *only* related-note signal. If two notes share a single tag like "lecture", every lecture note is "related" to every other.
  2. There's no scoring (TF-IDF, semantic similarity, recent overlap, manual links via `[[Title]]`).
  3. The actual `[[Title]]` linker is implemented in `src/utils/noteLinker.tsx` and is *only used to render chip links in note content*. It's not used to feed the "Related" list. So if you write `[[Biology 101]]` in a note, the link shows up as a chip, but `relatedNotes` doesn't promote `Biology 101` into the Related list.
- **Fix**:
  1. Promote notes linked via `[[Title]]` to the top of the related list (these are *user-declared* relations).
  2. Score by Jaccard tag overlap.
  3. Optionally use AI semantic similarity (server endpoint already has a `rerank` route — adapt it).
  - **Effort**: 1 day. **Priority**: P2.

### 🟡 #7 — "Save Twitter / YouTube" is in the false column above, but there's a half-built footprint

- The Pro page correctly lists it as "Coming soon". But: the `[AI]` features on the server include a `save` concept? No. The `[[Title]]` link parser supports a `type:article` note (line 451 of `NotesView.tsx`). So the *type* exists. But there's no `link-preview` route, no `oembed` lookup, no unfurl helper. The "AI" client doesn't have a `summarize-url` either.
- See Part 1 #3 for the build plan.

---

## Part 3 — Integrated Pro features that have quality/polish bugs

These features are functionally *there* but the user will notice issues on day one.

### 🟠 A. "Practice Qs" section shows ALL questions in one shuffled list

- **Where**: `FlashcardsView` lines 342–393. There is no filter by `noteId`, no filter by type, no "shuffle", no "review only missed" tracking.
- **Issue**: A user with 50 practice questions from 10 different notes gets a single jumbled list, and the cards never track whether the user got them right. Practice questions are **fire-and-forget** — they don't participate in spaced repetition.
- **Fix**: Add a per-practice-question `lastAnsweredCorrect: boolean` and `repetitions`, run them through the SM-2 algorithm like flashcards, and add a "Practice Review" mode that filters to `noteId === currentNote` or `type === 'multiple-choice' | 'true-false' | 'open'`.

### 🟠 B. Spaced repetition "Again" quality handling is wrong

- **Where**: `FlashcardsView.sm2` (lines 22–36).
- **Issue**: When `quality === 0` ("Again" — complete blackout), the implementation sets `newIv = 1` and `newReps = 0`. SM-2 says: keep the card's existing `ef` and reset `repetitions` to 0, with `interval` going back to 1 day *if `repetitions` was > 1*, but if it's the *first* repetition (reps was 0), interval should also be 1. The `difficulty: quality <= 1 ? 'hard' : ...` is OK. But the code does not touch `ef` at all — `ef` is hardcoded to `2.5` on line 25. Real SM-2 *updates* `ef` on every review. So as the user rates the card, the `ef` never drifts, which means `interval` always grows by the same `ef` multiplier. Over time every card becomes "easy" by literal interval expansion regardless of actual performance.
- **Fix**: Add `ef` to the `Flashcard` type, store it, update it per SM-2 spec: `ef = max(1.3, ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))`. This is a one-line bug fix but it materially affects retention.

### 🟠 C. `NotesView.tsx` uses 14 separate `useState` hooks with no reducer — editing a note while it's open in the form has stale-state bugs

- **Where**: `NotesView.tsx` lines 58–94. There are 14 `useState` declarations. The form is mutated by `startEdit(note)` (line 116) but several state vars (`reminderNoteId`, `reminderDate`, `personalNoteInput`, `editingPersonalNote`, `expandedNoteId`, `bulkMode`, `bulkSelected`) are not reset on edit/cancel.
- **Issue**: Open note A, click ⏰, set a reminder, switch to note B → reminder input is still pre-filled with A's data, and the form may keep note A's edit context after `startEdit(B)`. Race conditions galore.
- **Fix**: Extract a `useReducer` for the form/edit state, or split into a sub-component. ~1 day of work.

### 🟠 D. Search has no debounce and runs on every keystroke

- **Where**: `NotesView.tsx` line 518: `<input ... onChange={e => { setSearch(e.target.value); setSemanticResults(null); }} />`. `ContactsView` and `FlashcardsView` have the same pattern.
- **Issue**: For a free user with 50 items it's fine. For a Pro user with 5000 items, the entire `filteredNotes` recomputes (lines 332–347) on every keystroke, and `setSearch` is re-creating the entire list. Plus the keyword filter does `toPlainText()` on every note's content for every keystroke (line 343). `toPlainText` is HTML-stripping the entire note body.
- **Fix**: Debounce `search` to 200ms, and only run `toPlainText` once at load time (cache plain text on the note object).

### 🟠 E. Note linking `[[Title]]` only works in card preview, not in search

- `noteLinker.tsx` is only consumed in `NotesView` line 599. The semantic rerank, the keyword search, the saved search, the practice questions, the contacts — none of them consider `[[Title]]` links. A user can write a web of wikilinks in their notes and the only thing that uses them is the chip renderer.
- **Fix**: Build a backlink index. For each note, compute the set of `[[Target]]` titles. Add a "Backlinks" section to the note view that lists incoming links. Bonus: when computing `relatedNotes`, score wikilinked notes highest.

### 🟠 F. Custom AI prompts in Settings are not applied when going through the server

- **Where**: `SettingsView.tsx` line 252 has a `customSummaryPrompt` field. The server route at `/api/ai/summary` (server `ai.ts` line 195) checks `cfg.customSummaryPrompt` and uses it.
- **Issue**: The frontend never sends those custom prompts to the server. The `aiSettings` schema on the server has the fields, and `pullSync` does pull them (sync.ts line 64), but `SettingsView` `saveAIConfig` (db/aiSettings.ts line 82) only writes to IDB. The next pull overwrites those server custom prompts with `null`/empty.
- **Fix**: Handled as part of Part 2 #3 (move AI to server proxy). For now, even simpler: include `customSummaryPrompt` in the AI config that gets PUT to `/api/ai/settings`.

### 🟠 G. PDF export is the *browser print dialog* — the user expects a file

- **Where**: `src/utils/exportPDF.ts` line 144: `window.open(...)`, then `window.print()` on a styled HTML doc. There's no `jsPDF`, no `pdf-lib`, no server-side PDF.
- **Issue**: A user clicking the 🖨️ button in the sidebar expects `studyworks-export-2026-07-13.pdf` to download. Instead they get a "Print to PDF" dialog, which is fine on desktop but is broken on iOS Safari (no print-to-PDF there) and on mobile Chrome in general. The Pro page says "Export JSON + PDF" — it should produce a PDF.
- **Fix**: Two options:
  1. **Quick**: ship a tiny PDF generator (~100 lines) using `pdf-lib` or print the iframe to canvas and export. ~1 day.
  2. **Better**: server-side PDF using Puppeteer/Chromium or a `react-pdf` server renderer. Better typography, file downloads, embed fonts. ~3 days.

---

## Part 4 — Engineering / infrastructure gaps (not in the Pro feature list but blocking)

These didn't appear on the Pricing page but they block all the work above.

| Gap | Impact | Effort |
|---|---|---|
| No CI/CD. `package.json` has a `build` script but no GitHub Actions, no test runner (no Jest/Vitest installed). | Every fix is a manual re-test. Risk of regressions. | 1 day to set up Vitest + a smoke test per route. |
| No rate limiting on AI routes. | Pro user can call `/api/ai/summary` 10,000 times. | 0.5 day — `@hono/rate-limiter`. |
| `useDB` calls `clear()`+`putAll()` on every setter. | O(n) writes on every keystroke save. Stalls the UI at 200+ items. | 1 day — diffing writer. |
| IDB-stored files (base64) are not evicted. | Quota fills up silently. The Settings page estimates "used X MB of Y" but never warns the user. | 0.5 day. |
| Prisma schema `Folder.isSmart` and `Folder.smartFilter` are saved on the server, but the client-side smart folder logic is a hand-rolled parser in `src/utils/smartFolders.ts`. The parser doesn't support negation (`-tag:exam`) or OR (`tag:exam | tag:homework`) — only AND. The Pricing page advertises "Smart folders" but the feature is a thin filter DSL. | Limited power, but works for simple cases. | 0.5 day to extend parser. |
| `server/src/lib/encryption.ts` exists but is never wired into the AI settings flow. The key never reaches the server. | See Part 2 #3. | covered above |
| `dist/` is committed to the repo (visible in the tree). | Bloats the repo, leaks secrets if the dist is ever built with `.env.production` references. | 0.1 day — gitignore + remove. |
| No tests at all. The `server/src/routes/*.test.ts` files do not exist. The `src/**/*.test.tsx` files do not exist. | Zero regression safety net. | 2 days to bootstrap. |

---

## Suggested execution order (a 4-week plan)

### Week 1 — Unblock the paying user (P0)

1. **Wire Stripe checkout end-to-end** (Part 2 #1) — 1 day.
2. **Fix cloud sync LWW + diffing writes** (Part 2 #2) — 2–3 days.
3. **Server-side tier enforcement on every gated route** (Part 2 #4) — 1 day.
4. **Bootstrap Vitest + smoke test for every route** (Part 4) — 1 day.

### Week 2 — Make AI honest (P1)

5. **Move AI to the server proxy** (Part 2 #3) — 2–3 days.
6. **Fix SM-2 `ef` drift** (Part 3 B) — 0.5 day.
7. **Wire file uploads to S3/R2** (Part 2 #5) — 2 days.

### Week 3 — Polish the existing Pro features (P2)

8. **Real PDF export (client-side `pdf-lib`)** (Part 3 G) — 1 day.
9. **Backlinks + better related notes** (Part 2 #6 + Part 3 E) — 1 day.
10. **NotesView useReducer** (Part 3 C) — 1 day.
11. **Debounce + plain-text cache for search** (Part 3 D) — 0.5 day.
12. **Practice questions into spaced repetition** (Part 3 A) — 1.5 days.

### Week 4 — Catch up on the "coming soon" list (Phase 2)

13. **Folder sharing** (Part 1 #4) — 3 days.
14. **URL unfurl + YouTube transcript save** (Part 1 #3) — 2 days.
15. **Email support inbox** (Part 1 #6) — operational, 0.5 day to set up.

### Later (post-revenue)

16. **Browser extension** (Part 1 #1) — 1–2 weeks.
17. **Email-to-save** (Part 1 #2) — 1–2 weeks.
18. **Mobile app** (Pricing page Phase 2) — months.

---

## What this list does NOT cover

- Performance work (virtualizing the note grid at 1000+ items).
- Accessibility audit (the app is keyboard-navigable, but color contrast and screen reader passes haven't been done).
- Internationalization (everything is en-US).
- Mobile-first PWA polish (manifest exists, but no install prompt, no splash, no offline indicator).
- Privacy / GDPR data export and account deletion flows (server has no `/api/user/delete`).
- Marketing site / landing page / Stripe customer portal styling.

These are all real, but they're not on the Pro page. They should be a separate audit pass.

---

*Document last updated: 13 July 2026, generated from a code audit of `C:\Users\pious\Documents\trae_projects\studyworks`. All line numbers reference the current HEAD.*
