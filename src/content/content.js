import { ChibiManager } from '../chibi/ChibiManager.js';
import { DEFAULT_SETTINGS } from '../chibi/ChibiConfigs.js';

(function initChibiGoobers() {
  if (document.getElementById('chibi-goobers-host')) return;

  const host = document.createElement('div');
  host.id = 'chibi-goobers-host';
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('bottom', '0', 'important');
  host.style.setProperty('left', '0', 'important');
  host.style.setProperty('width', '100vw', 'important');
  host.style.setProperty('height', '100vh', 'important');
  host.style.setProperty('pointer-events', 'none', 'important');
  host.style.setProperty('z-index', '2147483640', 'important');
  host.style.setProperty('overflow', 'hidden', 'important');
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // Inject styles into Shadow DOM
  const styleLink = document.createElement('style');
  styleLink.textContent = `
    :host, #chibi-goobers-root {
      position: fixed !important;
      bottom: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      pointer-events: none !important;
      z-index: 2147483640 !important;
      user-select: none !important;
      -webkit-user-select: none !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      overflow: hidden !important;
    }
    #chibi-canvas {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      pointer-events: none !important;
      z-index: 1 !important;
    }
    .chibi-speech-bubble {
      position: absolute;
      z-index: 10 !important;
      transform: translate(-50%, -100%);
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: #1e293b;
      font-size: 13px;
      font-weight: 700;
      padding: 6px 12px;
      border-radius: 14px;
      border: 2.5px solid #ff76ac;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.08);
      pointer-events: none;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      transform-origin: bottom center;
    }
    .chibi-speech-bubble.visible {
      opacity: 1;
      transform: translate(-50%, -115%) scale(1);
    }
    .chibi-speech-bubble::after {
      content: '';
      position: absolute;
      bottom: -7px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 7px solid rgba(255, 255, 255, 0.94);
    }
    .chibi-snack-item {
      position: absolute;
      font-size: 28px;
      transform: translate(-50%, -50%);
      animation: snack-drop 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
      pointer-events: none;
      filter: drop-shadow(0 4px 8px rgba(0,0,0,0.25));
    }
    @keyframes snack-drop {
      0% { transform: translate(-50%, -150%) scale(0.6); opacity: 0; }
      60% { transform: translate(-50%, -40%) scale(1.15); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
    }
    .chibi-particle {
      position: absolute;
      pointer-events: none;
      font-size: 22px;
      z-index: 2147483645;
    }
    .chibi-particle-heart { animation: heart-float 1.2s ease-out forwards; }
    @keyframes heart-float {
      0% { transform: translate(-50%, 0) scale(0.5); opacity: 1; }
      50% { transform: translate(-50%, -35px) scale(1.2); opacity: 0.9; }
      100% { transform: translate(-50%, -70px) scale(0.8); opacity: 0; }
    }
    .chibi-particle-crumb { font-size: 16px; animation: crumb-fall 0.9s cubic-bezier(0.25, 1, 0.5, 1) forwards; }
    @keyframes crumb-fall {
      0% { transform: translate(0, 0) scale(1); opacity: 1; }
      100% { transform: translate(var(--vx, 15px), 25px) scale(0.4); opacity: 0; }
    }
    .chibi-particle-emote {
      font-size: 24px;
      font-weight: 900;
      color: #ff4757;
      text-shadow: 0 2px 8px rgba(0,0,0,0.3);
      animation: emote-pop 1s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
    }
    @keyframes emote-pop {
      0% { transform: translate(-50%, 10px) scale(0); opacity: 0; }
      20% { transform: translate(-50%, -10px) scale(1.3); opacity: 1; }
      40% { transform: translate(-50%, -15px) scale(1); opacity: 1; }
      100% { transform: translate(-50%, -30px) scale(0.8); opacity: 0; }
    }
    .chibi-particle-zzz { font-size: 18px; animation: zzz-float 1.8s ease-in forwards; }
    @keyframes zzz-float {
      0% { transform: translate(0, 0) scale(0.6); opacity: 0; }
      25% { opacity: 0.9; transform: translate(8px, -15px) scale(0.9); }
      60% { opacity: 0.8; transform: translate(16px, -35px) scale(1.1); }
      100% { transform: translate(25px, -60px) scale(1.3); opacity: 0; }
    }
    .chibi-particle-dust { font-size: 20px; animation: dust-puff 0.75s ease-out forwards; }
    @keyframes dust-puff {
      0% { transform: translate(-50%, 0) scale(0.4); opacity: 0.9; }
      50% { transform: translate(var(--dust-dir, -20px), -12px) scale(1.2); opacity: 0.8; }
      100% { transform: translate(var(--dust-dir, -30px), -20px) scale(1.5); opacity: 0; }
    }
    .chibi-particle-sweat { font-size: 22px; animation: sweat-drop 0.85s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
    @keyframes sweat-drop {
      0% { transform: translate(-50%, -10px) scale(0.2); opacity: 0; }
      30% { transform: translate(-50%, 0) scale(1.2); opacity: 1; }
      70% { transform: translate(-50%, 10px) scale(1); opacity: 0.9; }
      100% { transform: translate(-50%, 25px) scale(0.6); opacity: 0; }
    }
    .chibi-particle-anger { font-size: 24px; animation: anger-pop 0.9s ease-out forwards; }
    @keyframes anger-pop {
      0% { transform: translate(-50%, 0) scale(0); opacity: 0; }
      25% { transform: translate(-50%, -15px) scale(1.3); opacity: 1; }
      50% { transform: translate(-50%, -20px) scale(1.1) rotate(15deg); opacity: 1; }
      75% { transform: translate(-50%, -25px) scale(1.1) rotate(-15deg); opacity: 0.8; }
      100% { transform: translate(-50%, -35px) scale(0.5); opacity: 0; }
    }
  `;
  shadow.appendChild(styleLink);

  const container = document.createElement('div');
  container.id = 'chibi-goobers-root';

  const canvas = document.createElement('canvas');
  canvas.id = 'chibi-canvas';
  container.appendChild(canvas);
  shadow.appendChild(container);

  // Load saved settings or defaults
  let initialSettings = { ...DEFAULT_SETTINGS };

  function startManager(settings) {
    const manager = new ChibiManager(canvas, container, settings);

    // Extension runtime message listener (Cross-browser for Zen Browser, Firefox & Chrome)
    const extApi = (typeof browser !== 'undefined' && browser.runtime)
      ? browser
      : (typeof chrome !== 'undefined' && chrome.runtime ? chrome : null);

    if (extApi && extApi.runtime && extApi.runtime.onMessage) {
      extApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'SETTINGS_UPDATE') {
          manager.updateSettings(msg.settings);
          sendResponse({ status: 'ok' });
        } else if (msg.type === 'ACTION_FEED') {
          manager.dropSnack();
          sendResponse({ status: 'ok' });
        } else if (msg.type === 'ACTION_STAMPEDE') {
          manager.startStampede();
          sendResponse({ status: 'ok' });
        } else if (msg.type === 'ACTION_NAP') {
          manager.groupNap();
          sendResponse({ status: 'ok' });
        } else if (msg.type === 'ACTION_WAKE') {
          manager.wakeAll();
          sendResponse({ status: 'ok' });
        } else if (msg.type === 'ACTION_WAVE') {
          manager.waveAll();
          sendResponse({ status: 'ok' });
        }
        return true;
      });
    }

    // Keyboard shortcut (Alt + C) to drop snack on any page!
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        manager.dropSnack();
      }
    });

    return manager;
  }

  const extStorage = (typeof browser !== 'undefined' && browser.storage)
    ? browser.storage
    : (typeof chrome !== 'undefined' && chrome.storage ? chrome.storage : null);

  if (extStorage && extStorage.sync) {
    extStorage.sync.get('chibiSettings', (res) => {
      if (res && res.chibiSettings) {
        initialSettings = { ...initialSettings, ...res.chibiSettings };
      }
      startManager(initialSettings);
    });
  } else {
    startManager(initialSettings);
  }
})();
