/**
 * StudyWorks Web Clipper — background service worker.
 *
 * Adds a right-click context menu "Save to StudyWorks" on pages and links.
 * Uses the same base URL setting as the popup; opens the web app's
 * /?save=<url> flow (reliable regardless of auth state).
 */
const DEFAULT_BASE = 'http://localhost:5173';

async function getBase() {
  const { base } = await chrome.storage.sync.get('base');
  return (base || DEFAULT_BASE).replace(/\/$/, '');
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'studyworks-save-page',
    title: 'Save page to StudyWorks',
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: 'studyworks-save-link',
    title: 'Save link to StudyWorks',
    contexts: ['link'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const base = await getBase();
  const url =
    info.menuItemId === 'studyworks-save-link'
      ? info.linkUrl
      : (info.pageUrl || tab?.url || '');
  if (!url) return;
  chrome.tabs.create({ url: base + '/?save=' + encodeURIComponent(url) });
});
