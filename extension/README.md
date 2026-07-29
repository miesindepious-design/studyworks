# StudyWorks Web Clipper (Browser Extension)

A Manifest V3 Chrome/Edge extension that saves the current page to StudyWorks
as a note — via toolbar popup or right-click context menu.

## How it works

Two save paths, tried in order:

1. **Direct API** — the popup POSTs to `POST /api/notes` with
   `credentials: 'include'`. If you're logged into StudyWorks in the same
   browser, the session cookie is sent and the note is created instantly.
2. **Interactive fallback** — if you're not logged in (401) or the API is
   unreachable, the extension opens `<StudyWorks>/?save=<url>` so the web app
   clips the page interactively (unfurls title/description/thumbnail).

The right-click context menu always uses path 2 (reliable regardless of auth).

## Install (developer mode)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the StudyWorks icon to your toolbar.

## Configure

Click the extension icon → set **StudyWorks URL** at the bottom:

- Local dev: `http://localhost:5173`
- Production: your deployed StudyWorks URL

The setting is saved in `chrome.storage.sync`.

## Notes for production

- For the **direct API path** to work cross-site in production, the API must
  send `Access-Control-Allow-Credentials: true` and the session cookie must be
  `SameSite=None; Secure`. In local dev (same-origin via the Vite proxy) this
  is not an issue; the fallback path works everywhere regardless.
- Replace `icon-48.png` / `icon-128.png` with branded icons before publishing.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest (permissions, action, background) |
| `popup.html` / `popup.js` | Toolbar popup UI + save logic |
| `background.js` | Context-menu registration + handler |
| `icon-48.png` / `icon-128.png` | Extension icons |
