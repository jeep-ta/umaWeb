// Content script entry loader for Manifest V3 ES Modules
(async () => {
  try {
    const src = chrome.runtime.getURL('dist/content.js');
    await import(src);
  } catch (err) {
    console.error('Failed to load Chibi Goobers content script:', err);
  }
})();
