/**
 * StudyWorks Web Clipper — popup logic.
 *
 * Two save paths:
 *   1. Direct API: POST /api/notes with credentials:'include'. Works when the
 *      user is logged into StudyWorks in this browser (session cookie is sent).
 *   2. Fallback: open <base>/?save=<url> so the web app clips it interactively.
 *
 * The StudyWorks base URL is stored in chrome.storage.sync (default localhost).
 */
const DEFAULT_BASE = 'http://localhost:5173';

const $ = (id) => document.getElementById(id);

async function getBase() {
  const { base } = await chrome.storage.sync.get('base');
  return (base || DEFAULT_BASE).replace(/\/$/, '');
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

let currentTab = null;

async function init() {
  currentTab = await getActiveTab();
  $('title').value = currentTab?.title || '';
  $('url').textContent = currentTab?.url || '';
  $('base').value = await getBase();
}

// Persist base URL edits.
$('base').addEventListener('change', async () => {
  await chrome.storage.sync.set({ base: $('base').value.trim() });
  setStatus('Saved URL setting.', 'ok');
});

$('openApp').addEventListener('click', async () => {
  const base = await getBase();
  chrome.tabs.create({ url: base + '/' });
});

$('save').addEventListener('click', async () => {
  const base = await getBase();
  const title = $('title').value.trim() || currentTab?.url || 'Saved page';
  const url = currentTab?.url || '';
  const note = $('note').value.trim();

  $('save').disabled = true;
  setStatus('Saving…');

  const content =
    (note ? `<p>${escapeHtml(note)}</p>` : '') +
    `<p><a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a></p>` +
    `<p><em>Clipped from ${escapeHtml(currentTab?.title || url)}</em></p>`;

  try {
    // Path 1: direct API using the web session cookie.
    const res = await fetch(base + '/api/notes', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.slice(0, 200),
        content,
        type: 'article',
        tags: ['clipped'],
      }),
    });

    if (res.ok) {
      setStatus('✓ Saved to StudyWorks!', 'ok');
      setTimeout(() => window.close(), 900);
      return;
    }
    if (res.status === 401) {
      // Not logged in — fall back to the interactive web flow.
      throw new Error('not-authed');
    }
    throw new Error('HTTP ' + res.status);
  } catch (err) {
    // Path 2: fallback — open the web app to clip interactively.
    setStatus('Opening StudyWorks to finish…', '');
    chrome.tabs.create({ url: base + '/?save=' + encodeURIComponent(url) });
    setTimeout(() => window.close(), 600);
  } finally {
    $('save').disabled = false;
  }
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

init();
