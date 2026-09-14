import { DEFAULT_SETTINGS } from '../src/chibi/ChibiConfigs.js';

let currentSettings = { ...DEFAULT_SETTINGS };

// DOM elements
const rangePopulation = document.getElementById('range-population');
const valPopulation = document.getElementById('val-population');

const rangeScale = document.getElementById('range-scale');
const valScale = document.getElementById('val-scale');

const rangeSpeed = document.getElementById('range-speed');
const valSpeed = document.getElementById('val-speed');

const rangeVolume = document.getElementById('range-volume');
const valVolume = document.getElementById('val-volume');

const toggleSound = document.getElementById('toggle-sound');
const toggleSpeech = document.getElementById('toggle-speech');

const chibiCheckboxes = {
  spe: document.getElementById('check-spe'),
  suzuka: document.getElementById('check-suzuka'),
  oguri: document.getElementById('check-oguri'),
  helios: document.getElementById('check-helios'),
  mambo: document.getElementById('check-mambo')
};

// Quick action buttons
const btnWave = document.getElementById('btn-wave');
const btnFeed = document.getElementById('btn-feed');
const btnStampede = document.getElementById('btn-stampede');
const btnNap = document.getElementById('btn-nap');
const btnWake = document.getElementById('btn-wake');

const extApi = (typeof browser !== 'undefined') ? browser : (typeof chrome !== 'undefined' ? chrome : null);

function loadSettings() {
  if (extApi && extApi.storage && extApi.storage.sync) {
    extApi.storage.sync.get('chibiSettings', (res) => {
      if (res && res.chibiSettings) {
        currentSettings = { ...currentSettings, ...res.chibiSettings };
      }
      applySettingsToUI();
    });
  } else {
    const saved = localStorage.getItem('chibiSettings');
    if (saved) {
      try { currentSettings = { ...currentSettings, ...JSON.parse(saved) }; } catch (e) {}
    }
    applySettingsToUI();
  }
}

function saveSettings() {
  if (extApi && extApi.storage && extApi.storage.sync) {
    extApi.storage.sync.set({ chibiSettings: currentSettings });
  } else {
    localStorage.setItem('chibiSettings', JSON.stringify(currentSettings));
  }
  broadcastMessage({ type: 'SETTINGS_UPDATE', settings: currentSettings });
}

function broadcastMessage(message) {
  if (extApi && extApi.tabs && extApi.tabs.query) {
    extApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        try {
          const res = extApi.tabs.sendMessage(tabs[0].id, message);
          if (res && typeof res.catch === 'function') {
            res.catch(() => {
              // Tab might not have content script injected yet
            });
          }
        } catch (e) {}
      }
    });
  }
}

function applySettingsToUI() {
  rangePopulation.value = currentSettings.population;
  valPopulation.textContent = currentSettings.population;

  rangeScale.value = currentSettings.scale;
  valScale.textContent = `${currentSettings.scale.toFixed(1)}x`;

  rangeSpeed.value = currentSettings.speed;
  valSpeed.textContent = `${currentSettings.speed.toFixed(1)}x`;

  rangeVolume.value = Math.round(currentSettings.volume * 100);
  valVolume.textContent = `${Math.round(currentSettings.volume * 100)}%`;

  toggleSound.checked = currentSettings.soundEnabled;
  toggleSpeech.checked = currentSettings.speechBubbles;

  Object.entries(chibiCheckboxes).forEach(([id, checkbox]) => {
    if (checkbox) {
      checkbox.checked = currentSettings.enabledChibis.includes(id);
    }
  });
}

// Bind Events
function initEvents() {
  rangePopulation.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    valPopulation.textContent = val;
    currentSettings.population = val;
    saveSettings();
  });

  rangeScale.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    valScale.textContent = `${val.toFixed(1)}x`;
    currentSettings.scale = val;
    saveSettings();
  });

  rangeSpeed.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    valSpeed.textContent = `${val.toFixed(1)}x`;
    currentSettings.speed = val;
    saveSettings();
  });

  rangeVolume.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    valVolume.textContent = `${val}%`;
    currentSettings.volume = val / 100;
    saveSettings();
  });

  toggleSound.addEventListener('change', (e) => {
    currentSettings.soundEnabled = e.target.checked;
    saveSettings();
  });

  toggleSpeech.addEventListener('change', (e) => {
    currentSettings.speechBubbles = e.target.checked;
    saveSettings();
  });

  Object.entries(chibiCheckboxes).forEach(([id, checkbox]) => {
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        const enabled = [];
        Object.entries(chibiCheckboxes).forEach(([k, cb]) => {
          if (cb && cb.checked) enabled.push(k);
        });
        if (enabled.length === 0) {
          // Keep at least one enabled
          checkbox.checked = true;
          return;
        }
        currentSettings.enabledChibis = enabled;
        saveSettings();
      });
    }
  });

  // Action Buttons
  if (btnWave) {
    btnWave.addEventListener('click', () => {
      broadcastMessage({ type: 'ACTION_WAVE' });
    });
  }

  btnFeed.addEventListener('click', () => {
    broadcastMessage({ type: 'ACTION_FEED' });
  });

  btnStampede.addEventListener('click', () => {
    broadcastMessage({ type: 'ACTION_STAMPEDE' });
  });

  btnNap.addEventListener('click', () => {
    broadcastMessage({ type: 'ACTION_NAP' });
  });

  btnWake.addEventListener('click', () => {
    broadcastMessage({ type: 'ACTION_WAKE' });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initEvents();
  loadSettings();
});
