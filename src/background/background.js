// Chibi Goobers Background Script (Manifest V3 - Universal Chrome & Zen/Firefox)
const extApi = (typeof browser !== 'undefined') ? browser : (typeof chrome !== 'undefined' ? chrome : null);

if (extApi && extApi.runtime && extApi.runtime.onInstalled) {
  extApi.runtime.onInstalled.addListener(() => {
    console.log('Chibi Goobers extension installed successfully!');
    const actionApi = extApi.action || extApi.browserAction;
    if (actionApi && actionApi.setBadgeText) {
      actionApi.setBadgeText({ text: '🐾' });
      actionApi.setBadgeBackgroundColor({ color: '#ff76ac' });
    }
  });
}

// Handle keyboard shortcut commands if configured
if (extApi && extApi.commands && extApi.commands.onCommand) {
  extApi.commands.onCommand.addListener((command) => {
    if (command === 'feed_snack' && extApi.tabs && extApi.tabs.query) {
      extApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].id) {
          try {
            const res = extApi.tabs.sendMessage(tabs[0].id, { type: 'ACTION_FEED' });
            if (res && typeof res.catch === 'function') {
              res.catch(() => {});
            }
          } catch (e) {}
        }
      });
    }
  });
}

// Asset loader bridge for content scripts (bypasses website CSP connect-src and Gecko cross-origin restrictions)
if (extApi && extApi.runtime && extApi.runtime.onMessage) {
  extApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'LOAD_ASSET') {
      const cleanPath = (msg.path || '').replace(/^\.\//, '');
      const assetUrl = extApi.runtime.getURL(cleanPath);

      fetch(assetUrl)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          if (msg.responseType === 'arraybuffer') {
            const buf = await res.arrayBuffer();
            // Convert to base64 string for universal cross-compartment safe transfer
            let binary = '';
            const bytes = new Uint8Array(buf);
            const len = bytes.byteLength;
            const chunkSize = 0x8000;
            for (let i = 0; i < len; i += chunkSize) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
            }
            const base64 = btoa(binary);
            sendResponse({ success: true, base64 });
          } else if (msg.responseType === 'dataurl') {
            const blob = await res.blob();
            const reader = new FileReader();
            reader.onloadend = () => {
              sendResponse({ success: true, dataUrl: reader.result });
            };
            reader.readAsDataURL(blob);
          } else {
            const text = await res.text();
            sendResponse({ success: true, text });
          }
        })
        .catch((err) => {
          console.error('Background asset load error for', msg.path, err);
          sendResponse({ success: false, error: err.message });
        });

      return true; // Keep message port open for async response
    }
  });
}
