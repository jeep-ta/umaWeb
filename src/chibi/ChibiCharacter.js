import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { resolveAssetUrl } from './ChibiConfigs.js';
import { ChibiAudio } from './ChibiAudio.js';
import { CharacterController } from './CharacterController.js';
import { SecondaryPhysics } from './SecondaryPhysics.js';
import { ArmPoseNormalizer } from './ArmPoseNormalizer.js';
import { HandController } from './HandController.js';
import { ProceduralArmSwing } from './ProceduralArmSwing.js';
import { sanitizeCharacterMaterials } from './MaterialSanitizer.js';
import { PassingSteerController } from './PassingSteerController.js';

// Reusable texture cache to avoid duplicate texture loads
const textureCache = new Map();

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function loadModelBuffer(path) {
  const cleanPath = path.replace(/^\.\//, '');
  const extApi = (typeof browser !== 'undefined' && browser.runtime) 
    ? browser 
    : (typeof chrome !== 'undefined' && chrome.runtime ? chrome : null);

  // If not running in extension context (e.g. standalone demo.html), use direct fetch
  if (!extApi || !extApi.runtime || !extApi.runtime.getURL) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.arrayBuffer();
  }

  // In extension: try direct fetch first
  const fullUrl = extApi.runtime.getURL(cleanPath);
  try {
    const res = await fetch(fullUrl);
    if (res.ok) {
      return await res.arrayBuffer();
    }
  } catch (e) {
    // Direct fetch blocked by page CSP connect-src or Gecko CORS. Fall through to background bridge!
  }

  // Request asset buffer from background script (runs with extension privileges, immune to page CSP)
  return new Promise((resolve, reject) => {
    extApi.runtime.sendMessage({ type: 'LOAD_ASSET', path: cleanPath, responseType: 'arraybuffer' }, (response) => {
      if (!response) {
        reject(new Error(extApi.runtime.lastError?.message || 'No response from background script'));
        return;
      }
      if (!response.success) {
        reject(new Error(response.error || 'Background asset load failed'));
        return;
      }
      if (response.base64) {
        resolve(base64ToArrayBuffer(response.base64));
      } else if (response.buffer) {
        // Safely clone into local compartment
        const u8 = new Uint8Array(response.buffer);
        const local = new ArrayBuffer(u8.byteLength);
        new Uint8Array(local).set(u8);
        resolve(local);
      } else {
        reject(new Error('Received empty buffer from background'));
      }
    });
  });
}

function loadCachedTexture(url) {
  if (textureCache.has(url)) {
    return textureCache.get(url);
  }
  const loader = new THREE.TextureLoader();
  const fullUrl = resolveAssetUrl(url);
  const tex = loader.load(
    fullUrl,
    undefined,
    undefined,
    (err) => {
      console.warn(`Direct texture load failed for ${url}, fetching via background fallback...`, err);
      const extApi = (typeof browser !== 'undefined' && browser.runtime) ? browser : (typeof chrome !== 'undefined' && chrome.runtime ? chrome : null);
      if (extApi && extApi.runtime && extApi.runtime.sendMessage) {
        const cleanPath = url.replace(/^\.\//, '');
        extApi.runtime.sendMessage({ type: 'LOAD_ASSET', path: cleanPath, responseType: 'dataurl' }, (res) => {
          if (res && res.success && res.dataUrl) {
            new THREE.TextureLoader().load(res.dataUrl, (fallbackTex) => {
              tex.image = fallbackTex.image;
              tex.needsUpdate = true;
            });
          }
        });
      }
    }
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  textureCache.set(url, tex);
  return tex;
}

export class ChibiCharacter {
  constructor(config, manager) {
    this.config = config;
    this.manager = manager;
    this.scene = manager.scene;

    this.id = config.id + '_' + Math.random().toString(36).substr(2, 6);
    this.group = new THREE.Group();
    this.model = null;
    this.bones = {};
    this.isLoaded = false;

    // Modular Animation Controller & Secondary Spring Physics
    this.controller = new CharacterController(this);
    this.secondaryPhysics = new SecondaryPhysics(this);

    // Procedural arm normalizer, hand pose controller, and locomotion swing
    this.armNormalizer = null;
    this.handController = null;
    this.armSwing = null;
    this.passingSteer = new PassingSteerController(this);

    // Spatial & Physics state
    // Positions in 3D world coordinates (X: horizontal, Y: vertical, Z: depth)
    this.position = this.group.position;
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.facingDirection = 1; // 1 = right, -1 = left, 0 = forward
    this.targetFacing = 1;
    this.facingAngle = Math.PI / 2;
    this.floorY = 0;
    this.grounded = true;
    this.isDragging = false;
    this.dragOffset = new THREE.Vector3();
    this.prevDragPos = new THREE.Vector2();
    this.dragVelocity = new THREE.Vector2();
    this.raceLaneZ = null; // Dedicated parallel track assigned during Stampede/Race mode

    // Interaction & emote trackers
    this.dragHistory = [];
    this.pokeHistory = [];
    this.currentPlatform = null;
    this.sleepParticleTimer = 0;

    // Squash and stretch spring
    this.squash = new THREE.Vector3(1, 1, 1);
    this.squashVelocity = new THREE.Vector3(0, 0, 0);

    // AI & Behavior State
    // States: 'IDLE_LOOK_AROUND', 'IDLE_STRETCH', 'IDLE_EAR_TWITCH', 'WALK', 'TROT', 'SPRINT', 'DRIFT_STOP', 'RECOVER_PANT', 'RACE_VICTORY', 'HELD_AIRBORNE', 'LAND_RECOVERY', 'SNOOZE', 'WAVE', 'EATING'
    this.state = 'IDLE_LOOK_AROUND';
    this.stateTimer = 0;
    this.nextDecisionTime = 2 + Math.random() * 3;
    this.walkTargetX = 0;
    this.walkSpeed = 1.0;
    this.isRacing = false;
    this.raceLap = 0;
    this.postDriftState = 'RECOVER_PANT';
    this.petIntensity = 0;
    this.lastPetTime = 0;
    this.snackTarget = null;

    // Speech bubble element
    this.bubbleElement = null;
    this.bubbleTimer = 0;

    // Audio step timer
    this.stepTimer = 0;

    // Animation elapsed time
    this.animTime = Math.random() * 100;

    // Load 3D model
    this._loadModel();
    this._createBubbleElement();
  }

  async _loadModel() {
    try {
      const buffer = await loadModelBuffer(this.config.model);
      const loader = new FBXLoader();
      const fbx = loader.parse(buffer, '');

      this.model = fbx;
      const scale = this.config.baseScale || 0.01;
      fbx.scale.set(scale, scale, scale);
      this.group.add(fbx);

      // Preload textures
      const texConfig = this.config.textures;
      const textures = {
        body: texConfig.body ? loadCachedTexture(texConfig.body) : null,
        hair: texConfig.hair ? loadCachedTexture(texConfig.hair) : null,
        face: texConfig.face ? loadCachedTexture(texConfig.face) : null,
        cheek: texConfig.cheek ? loadCachedTexture(texConfig.cheek) : null,
        eye: texConfig.eye ? loadCachedTexture(texConfig.eye) : null,
        mouth: texConfig.mouth ? loadCachedTexture(texConfig.mouth) : null,
        brow: texConfig.brow ? loadCachedTexture(texConfig.brow) : null,
        tail: texConfig.tail ? loadCachedTexture(texConfig.tail) : null
      };

      // Traverse mesh and bones
      fbx.traverse((child) => {
        if (child.isBone) {
          child.userData.restRotation = child.rotation.clone();
          child.userData.restPosition = child.position.clone();
          this._registerBone(child);
        }
        if (child.isMesh) {
          this._applyMaterialsToMesh(child, textures);
        }
      });

      // Sanitize material depth buffer and alpha test properties
      sanitizeCharacterMaterials(this.model);

      // Initialize Procedural Arm Normalizer, Hand Controller, and Locomotion Arm Swing
      this.armNormalizer = new ArmPoseNormalizer(this.model, this.bones);
      this.handController = new HandController(this.armNormalizer, this.config);
      this.armSwing = new ProceduralArmSwing(this.armNormalizer, this.config);

      this.scene.add(this.group);
      this.isLoaded = true;
      this.controller._findEyeMesh();
      this.say(this.getRandomQuote());
    } catch (err) {
      console.error(`Error loading model for ${this.config.name}:`, err);
      if (this.manager.settings.speechBubbles) {
        this.say(`⚠️ [${this.config.name}] ${err?.message || err}`, 10);
      }
    }
  }

  _registerBone(bone) {
    const name = bone.name;
    this.bones[name] = bone;

    // Fuzzy matching for common bone aliases
    const lower = name.toLowerCase();
    if (lower.includes('arm_l') || lower.includes('arm.l') || lower.includes('leftarm')) this.bones['Arm_L'] = bone;
    if (lower.includes('arm_r') || lower.includes('arm.r') || lower.includes('rightarm')) this.bones['Arm_R'] = bone;
    if (lower.includes('elbow_l') || lower.includes('elbow.l') || lower.includes('leftforearm')) this.bones['Elbow_L'] = bone;
    if (lower.includes('elbow_r') || lower.includes('elbow.r') || lower.includes('rightforearm')) this.bones['Elbow_R'] = bone;
    if (lower.includes('wrist_l') || lower.includes('wrist.l') || lower.includes('lefthand')) this.bones['Wrist_L'] = bone;
    if (lower.includes('wrist_r') || lower.includes('wrist.r') || lower.includes('righthand')) this.bones['Wrist_R'] = bone;
    if (lower.includes('thumb_01_l') || lower.includes('thumb1_l')) this.bones['Thumb_01_L'] = bone;
    if (lower.includes('thumb_01_r') || lower.includes('thumb1_r')) this.bones['Thumb_01_R'] = bone;
    if (lower.includes('index_01_l') || lower.includes('index1_l')) this.bones['Index_01_L'] = bone;
    if (lower.includes('index_01_r') || lower.includes('index1_r')) this.bones['Index_01_R'] = bone;
    if (lower.includes('thigh_l') || lower.includes('thigh.l') || lower.includes('leg_l') || lower.includes('leftupleg')) this.bones['Thigh_L'] = bone;
    if (lower.includes('thigh_r') || lower.includes('thigh.r') || lower.includes('leg_r') || lower.includes('rightupleg')) this.bones['Thigh_R'] = bone;
    if (lower.includes('knee_l') || lower.includes('knee.l') || lower.includes('leftleg')) this.bones['Knee_L'] = bone;
    if (lower.includes('knee_r') || lower.includes('knee.r') || lower.includes('rightleg')) this.bones['Knee_R'] = bone;
    if (lower.includes('ankle_l') || lower.includes('foot_l') || lower.includes('leftfoot')) this.bones['Ankle_L'] = bone;
    if (lower.includes('ankle_r') || lower.includes('foot_r') || lower.includes('rightfoot')) this.bones['Ankle_R'] = bone;
    if (lower === 'hip' || (!this.bones['Hip'] && (lower.includes('hip') || lower.includes('pelvis')))) this.bones['Hip'] = bone;
    if (lower.includes('waist')) this.bones['Waist'] = bone;
    if (lower.includes('head')) this.bones['Head'] = bone;
    if (lower.includes('neck')) this.bones['Neck'] = bone;
    if (lower.includes('spine')) this.bones['Spine'] = bone;
    if (lower.includes('ear_01_l') || lower.includes('ear_l') || lower.includes('ear.l')) this.bones['Ear_01_L'] = bone;
    if (lower.includes('ear_01_r') || lower.includes('ear_r') || lower.includes('ear.r')) this.bones['Ear_01_R'] = bone;
    if (lower.includes('tail')) this.bones['Tail_Ctrl'] = bone;
  }

  _applyMaterialsToMesh(mesh, textures) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((m, idx) => {
      if (!m) return;
      const name = (m.name || '').toLowerCase();
      let tex = null;

      // Invisible helper mesh (e.g. Transparent in Mambo, Front in Helios)
      if (name === 'transparent' || name.includes('transp') || name === 'front') {
        m.transparent = true;
        m.opacity = 0;
        m.visible = false;
        return;
      }

      if (name.includes('body')) tex = textures.body;
      else if (name.includes('hair')) tex = textures.hair;
      else if (name.includes('face') || name.includes('head')) tex = textures.face;
      else if (name.includes('cheek')) tex = textures.cheek;
      else if (name.includes('eye')) tex = textures.eye;
      else if (name.includes('mouth')) tex = textures.mouth;
      else if (name.includes('brow')) tex = textures.brow;
      else if (name.includes('tail')) tex = textures.tail;

      // Fallback by slot index if names are generic
      if (!tex) {
        if (idx === 0) tex = textures.body;
        else if (idx === 1) tex = textures.hair;
        else if (idx === 2) tex = textures.face;
        else if (idx === 3) tex = textures.tail;
        else if (idx === 4) tex = textures.eye;
        else if (idx === 5) tex = textures.mouth;
        else if (idx === 6) tex = textures.cheek;
        else if (idx === 7 || idx === 8) tex = textures.brow;
      }

      // Precision layering for anime face decals
      // NOTE: Eye, Mouth, and Face textures have opaque skin backgrounds with 0-alpha channels.
      // Do NOT set transparent = true on eye/mouth/face, or WebGL will discard all pixels!
      const isBrow = name.includes('brow') || (!name && (idx === 7 || idx === 8));
      const isCheek = name.includes('cheek') || (!name && idx === 6);
      const isEye = name.includes('eye') || (!name && idx === 4);
      const isMouth = name.includes('mouth') || (!name && idx === 5);

      if (isBrow) {
        // Eyebrows: strokes on transparent canvas
        if (tex) { m.map = tex; m.needsUpdate = true; }
        m.transparent = true;
        m.depthTest = true;
        m.depthWrite = false;
        m.polygonOffset = true;
        m.polygonOffsetFactor = -2.0;
        m.polygonOffsetUnits = -4.0;
        m.side = THREE.DoubleSide;
      } else if (isCheek) {
        // Blush: soft circles on transparent canvas
        if (tex) { m.map = tex; m.needsUpdate = true; }
        m.transparent = true;
        m.depthTest = true;
        m.depthWrite = false;
        m.polygonOffset = true;
        m.polygonOffsetFactor = -2.0;
        m.polygonOffsetUnits = -4.0;
        m.side = THREE.DoubleSide;
      } else if (isEye) {
        // Eyes: fresh MeshStandardMaterial to avoid FBXLoader shader quirks, double-sided, depthTest=true with polygonOffset
        materials[idx] = new THREE.MeshStandardMaterial({
          name: m.name || 'Eyes',
          map: tex,
          roughness: 0.92,
          metalness: 0.0,
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2.0,
          polygonOffsetUnits: -4.0
        });
      } else if (isMouth) {
        // Mouth: fresh MeshStandardMaterial, double-sided, depthTest=true with polygonOffset
        materials[idx] = new THREE.MeshStandardMaterial({
          name: m.name || 'Mouth',
          map: tex,
          roughness: 0.92,
          metalness: 0.0,
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2.0,
          polygonOffsetUnits: -4.0
        });
      } else {
        // Body, Hair, Face, Tail: normal opaque geometry
        if (tex) { m.map = tex; m.needsUpdate = true; }
        m.transparent = false;
        m.depthTest = true;
        m.side = THREE.FrontSide;
        m.roughness = 0.92;
        m.metalness = 0.0;
      }
    });

    mesh.material = materials;

    // Sort geometry groups so face skin is guaranteed to draw BEFORE eye/mouth/cheek/brow decals
    if (mesh.geometry && Array.isArray(mesh.geometry.groups)) {
      const getPriority = (mat) => {
        if (!mat) return 0;
        const n = (mat.name || '').toLowerCase();
        if (n.includes('body')) return 0;
        if (n.includes('face') || n.includes('head')) return 1;
        if (n.includes('hair')) return 2;
        if (n.includes('tail')) return 3;
        if (n.includes('eye')) return 4;
        if (n.includes('mouth')) return 5;
        if (n.includes('cheek')) return 6;
        if (n.includes('brow')) return 7;
        return 8;
      };
      mesh.geometry.groups.sort((a, b) => {
        const pA = getPriority(materials[a.materialIndex]);
        const pB = getPriority(materials[b.materialIndex]);
        return pA - pB;
      });
    }
  }

  _createBubbleElement() {
    this.bubbleElement = document.createElement('div');
    this.bubbleElement.className = 'chibi-speech-bubble';
    this.bubbleElement.style.display = 'none';
    this.manager.domContainer.appendChild(this.bubbleElement);
  }

  say(text, duration = 3.2) {
    if (!this.manager.settings.speechBubbles) return;
    if (!this.bubbleElement) return;

    this.bubbleElement.textContent = text;
    this.bubbleElement.style.display = 'block';
    this.bubbleElement.style.borderColor = this.config.themeColor;
    this.bubbleElement.classList.add('visible');
    this.bubbleTimer = duration;
  }

  getRandomQuote() {
    const quotes = this.config.quotes;
    return quotes[Math.floor(Math.random() * quotes.length)];
  }

  getPokeQuote(type = 'normal') {
    const p = this.config.pokeQuotes;
    if (!p) return 'Fueee?!';
    if (type === 'awake') return p.awake || 'Wha-?! Awake!';
    if (type === 'rapid') {
      const arr = p.rapid || ['Too fast! 💦'];
      return arr[Math.floor(Math.random() * arr.length)];
    }
    const arr = p.normal || ['Huh?!'];
    return arr[Math.floor(Math.random() * arr.length)];
  }

  getDragQuote(isAngry = false) {
    const d = this.config.dragQuotes;
    if (!d) return 'Put me down!';
    const arr = isAngry ? (d.angry || d.normal) : d.normal;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  getFlingQuote() {
    const f = this.config.flingQuotes;
    if (Array.isArray(f)) return f[Math.floor(Math.random() * f.length)];
    return f || 'Wheeeee!! 💨';
  }

  getPetQuote() {
    const p = this.config.petQuotes;
    if (Array.isArray(p)) return p[Math.floor(Math.random() * p.length)];
    return 'Ehehe~ ❤️';
  }

  getSnackTargetQuote() {
    const s = this.config.snackTargetQuotes;
    if (Array.isArray(s)) return s[Math.floor(Math.random() * s.length)];
    return s || 'A SNACK?! 🥕✨';
  }

  getEatQuote() {
    const e = this.config.eatQuotes;
    if (Array.isArray(e)) return e[Math.floor(Math.random() * e.length)];
    return 'Mogu mogu! 🥕';
  }

  getSprintQuote() {
    const s = this.config.sprintQuotes;
    if (Array.isArray(s)) return s[Math.floor(Math.random() * s.length)];
    return 'Zoomies!! 💨';
  }

  getSnoozeQuote() {
    const s = this.config.snoozeQuotes;
    if (Array.isArray(s)) return s[Math.floor(Math.random() * s.length)];
    return s || 'Zzz...';
  }

  getRaceQuote() {
    return this.config.raceQuote || 'First place is mine! 🏁';
  }

  getPantQuote() {
    const s = this.config.pantQuotes;
    if (Array.isArray(s)) return s[Math.floor(Math.random() * s.length)];
    return 'Haa... haa... catching my breath... 💦';
  }

  getRaceWinQuote() {
    const s = this.config.raceWinQuotes;
    if (Array.isArray(s)) return s[Math.floor(Math.random() * s.length)];
    return 'I won! First place is mine! 🏆✨';
  }

  getRaceFinishQuote() {
    const s = this.config.raceFinishQuotes;
    if (Array.isArray(s)) return s[Math.floor(Math.random() * s.length)];
    return 'Haa... good race everyone! 💦';
  }

  // Trigger deceleration drift braking
  startDriftStop(thenState = 'RECOVER_PANT') {
    if (this.isDragging || this.state === 'HELD_AIRBORNE') return;
    this.state = 'DRIFT_STOP';
    this.postDriftState = thenState;
    this.stateTimer = 0.60;
    this.controller?.setState('DRIFT_STOP', true);

    ChibiAudio.playSkid();
    if (this.screenX && this.screenY) {
      this.manager.particles?.spawnDust(this.screenX, this.screenY, -this.targetFacing);
    }
  }

  // Trigger post-sprint / post-race panting recovery
  startRecoverPant(quote = null) {
    if (this.isDragging || this.state === 'HELD_AIRBORNE') return;
    this.state = 'RECOVER_PANT';
    this.stateTimer = 2.2;
    this.velocity.set(0, 0, 0);
    this.controller?.setState('RECOVER_PANT', true);

    if (this.screenX && this.screenY) {
      this.manager.particles?.spawnSweat(this.screenX, this.screenY);
    }
    const txt = quote || this.getPantQuote();
    this.say(txt, 2.5);
  }

  // Trigger victory celebration for race winner
  celebrateVictory() {
    if (this.isDragging || this.state === 'HELD_AIRBORNE') return;
    this.state = 'RACE_VICTORY';
    this.stateTimer = 3.8;
    this.velocity.set(0, 0, 0);
    this.targetFacing = 0; // Turn forward towards user!
    this.facingAngle = 0;
    if (this.group) this.group.rotation.y = 0;
    this.controller?.setState('RACE_VICTORY', true);

    ChibiAudio.playVictoryFanfare();
    if (this.screenX && this.screenY) {
      this.manager.particles?.spawnHeart(this.screenX, this.screenY - 20);
    }
    this.say(this.getRaceWinQuote(), 3.5);
  }

  // Trigger runner-up race finish
  finishRaceRunnerUp() {
    this.startDriftStop('RECOVER_PANT_RACE');
  }

  getIndex() {
    if (!this.manager || !this.manager.chibis) return 0;
    const idx = this.manager.chibis.indexOf(this);
    return idx >= 0 ? idx : 0;
  }

  getTrackZ() {
    if (!this.manager || !this.manager.chibis || this.manager.chibis.length <= 1) {
      return 0.0;
    }
    const total = this.manager.chibis.length;
    const idx = this.getIndex();
    // Dedicated parallel tracks across [-0.28, +0.28] so no two characters ever share or run along the same Z layer
    return -0.28 + (idx / (total - 1)) * 0.56;
  }

  // Greet user: turn forward, wave hand, and display Uma greeting
  wave(customQuote = null) {
    if (this.isDragging || this.state === 'HELD_AIRBORNE') return;
    this.state = 'WAVE';
    this.stateTimer = 3.2;
    this.targetFacing = 0; // Turn forward to face user
    this.facingAngle = 0;  // Immediately face forward to greet user
    this.group.rotation.y = 0;
    this.velocity.set(0, 0, 0);
    this.controller?.setState('WAVE', true);

    ChibiAudio.playSqueak(1.2);
    this.manager.particles.spawnHeart(this.screenX, this.screenY - 25);

    const waveQuotes = this.config.waveQuotes || [
      'Konnichiwa! 👋✨',
      'Hello there! 👋',
      'Trainer, look over here! 👋'
    ];
    const text = customQuote || waveQuotes[Math.floor(Math.random() * waveQuotes.length)];
    this.say(text, 2.6);
  }

  // User interactions: Poke, Pet, Drag, Drop
  poke() {
    const now = performance.now();
    this.pokeHistory.push(now);
    this.pokeHistory = this.pokeHistory.filter(t => now - t < 1200);

    ChibiAudio.playSqueak(1.1 + Math.random() * 0.3);
    this.squash.set(0.8, 1.35, 0.8);

    if (this.state === 'SNOOZE') {
      this.state = 'IDLE_LOOK_AROUND';
      this.say(this.getPokeQuote('awake'));
      this.controller.triggerAlert();
      this.secondaryPhysics.triggerAlert();
      return;
    }

    // Rapid poke reaction: spawn sweat drop & trigger alert!
    if (this.pokeHistory.length >= 3) {
      this.manager.particles.spawnSweat(this.screenX, this.screenY);
      this.controller.triggerAlert();
      this.secondaryPhysics.triggerAlert();
      this.say(this.getPokeQuote('rapid'), 2.0);
    } else {
      this.manager.particles.spawnEmote(this.screenX, this.screenY, '!');
      this.say(this.getPokeQuote('normal'), 2.2);
    }

    // Mini hop
    this.velocity.y = 2.0;
    this.grounded = false;
  }

  pet() {
    const now = performance.now();
    if (now - this.lastPetTime < 180) {
      this.petIntensity = Math.min(1.0, this.petIntensity + 0.25);
    } else {
      this.petIntensity = 0.2;
    }
    this.lastPetTime = now;

    ChibiAudio.playPurr();
    this.manager.particles.spawnHeart(this.screenX, this.screenY - 20);

    if (this.state !== 'HELD_AIRBORNE') {
      this.state = 'IDLE_LOOK_AROUND';
      this.stateTimer = 1.5;
    }

    if (Math.random() < 0.28) {
      this.say(this.getPetQuote(), 2.0);
    }
  }

  startDrag(rayOrigin, rayDir) {
    const now = performance.now();
    this.dragHistory.push(now);
    this.dragHistory = this.dragHistory.filter(t => now - t < 10000);

    this.isDragging = true;
    this.state = 'HELD_AIRBORNE';
    this.grounded = false;
    this.currentPlatform = null;
    this.velocity.set(0, 0, 0);

    ChibiAudio.playSqueak(1.3);

    // Repeated pick-up frustration: spawn anger spark 💢
    if (this.dragHistory.length >= 3) {
      this.manager.particles.spawnAnger(this.screenX, this.screenY);
      this.say(this.getDragQuote(true), 2.2);
    } else {
      this.manager.particles.spawnEmote(this.screenX, this.screenY, '💦');
      this.say(this.getDragQuote(false), 2.0);
    }
  }

  updateDrag(worldTargetPos) {
    if (!this.isDragging) return;

    this.state = 'HELD_AIRBORNE';

    // Follow cursor with slight inertia
    const targetX = worldTargetPos.x;
    const targetY = Math.max(this.floorY + 0.2, worldTargetPos.y);

    const dx = targetX - this.position.x;
    const dy = targetY - this.position.y;

    this.dragVelocity.set(dx * 18, dy * 18);
    this.position.x += dx * 0.6;
    this.position.y += dy * 0.6;

    if (Math.abs(dx) > 0.05) {
      this.targetFacing = Math.sign(dx);
    }
  }

  endDrag() {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.state = 'HELD_AIRBORNE';

    // Fling physics from drag velocity
    this.velocity.x = Math.max(-10, Math.min(10, this.dragVelocity.x * 0.3));
    this.velocity.y = Math.max(-8, Math.min(10, this.dragVelocity.y * 0.3));

    if (Math.abs(this.velocity.x) > 4 || Math.abs(this.velocity.y) > 4) {
      this.say(this.getFlingQuote());
    }
  }

  feedSnack(snackPosition) {
    this.snackTarget = snackPosition;
    this.state = 'WALK';
    this.walkTargetX = snackPosition.x;
    this.walkSpeed = 1.8;
    this.say(this.getSnackTargetQuote(), 2.5);
  }

  // Main Update Loop (called every frame)
  update(dt) {
    this.animTime += dt;
    this.stateTimer -= dt;
    this.bubbleTimer -= dt;

    if (this.bubbleTimer <= 0 && this.bubbleElement && this.bubbleElement.style.display !== 'none') {
      this.bubbleElement.style.display = 'none';
      this.bubbleElement.classList.remove('visible');
    }

    // Snooze Zzz particle spawner
    if (this.state === 'SNOOZE') {
      this.sleepParticleTimer += dt;
      if (this.sleepParticleTimer >= 2.2) {
        this.sleepParticleTimer = 0;
        this.manager.particles.spawnSleepZzz(this.screenX, this.screenY);
      }
    } else {
      this.sleepParticleTimer = 0;
    }

    // AI Behavior decisions
    if (!this.isDragging && this.grounded) {
      this._updateAI(dt);
    }

    // Physics (Gravity, Roosting Platforms, Boundaries, Bounce)
    this._updatePhysics(dt);

    // 2-Lane Passing Steer & Dynamic Z-Sorting
    if (this.passingSteer) {
      this.passingSteer.update(dt);
    }

    // Procedural skeletal animations & secondary physics
    if (this.isLoaded) {
      this._updateSkeletalAnimation(dt);
    }

    // Update screen-projected positions for UI and particles
    this._updateScreenPosition();
  }

  _updateAI(dt) {
    // Check global idle timeout from DOMBridge (>45s inactive)
    if (this.manager.domBridge?.isIdleTimeout && this.state !== 'SNOOZE' && this.state !== 'HELD_AIRBORNE') {
      this.state = 'SNOOZE';
      this.stateTimer = 15.0;
      ChibiAudio.playYawn();
      this.say(this.getSnoozeQuote(), 2.5);
      return;
    }

    // Periodic comic effects during fatigue recovery and race victory
    if (this.state === 'RECOVER_PANT') {
      if (Math.random() < 0.04 && this.screenX && this.screenY) {
        this.manager.particles?.spawnSweat(this.screenX, this.screenY);
      }
    } else if (this.state === 'RACE_VICTORY') {
      if (Math.random() < 0.06 && this.screenX && this.screenY) {
        this.manager.particles?.spawnHeart(this.screenX, this.screenY - 20);
      }
    }

    if (this.stateTimer <= 0) {
      // 1. Chained state completion transitions
      if (this.state === 'DRIFT_STOP') {
        if (this.postDriftState === 'RECOVER_PANT_RACE') {
          this.startRecoverPant(this.getRaceFinishQuote());
        } else {
          this.startRecoverPant();
        }
        return;
      }

      if (this.state === 'SPRINT') {
        if (!this.isRacing) {
          this.startDriftStop('RECOVER_PANT');
          return;
        }
      }

      if (this.state === 'RECOVER_PANT' || this.state === 'RACE_VICTORY') {
        this.isRacing = false;
        this.state = 'IDLE_LOOK_AROUND';
        this.stateTimer = 1.5 + Math.random() * 2.0;
        return;
      }

      // Pick next activity
      const roll = Math.random();
      const bounds = this.manager.getWorldBounds();

      if (roll < 0.22) {
        // WALK: slow relaxed patrol
        this.state = 'WALK';
        this.walkTargetX = (Math.random() * (bounds.width - 2)) - (bounds.width / 2 - 1);
        this.walkSpeed = (0.7 + Math.random() * 0.4) * (this.config.speedMultiplier || 1.0) * this.manager.settings.speed;
        this.targetFacing = this.walkTargetX > this.position.x ? 1 : -1;
        this.stateTimer = 2.5 + Math.random() * 3.5;
      } else if (roll < 0.38) {
        // TROT: moderate purposeful stride
        this.state = 'TROT';
        this.walkTargetX = (Math.random() * (bounds.width - 2)) - (bounds.width / 2 - 1);
        this.walkSpeed = (1.5 + Math.random() * 0.5) * (this.config.speedMultiplier || 1.0) * this.manager.settings.speed;
        this.targetFacing = this.walkTargetX > this.position.x ? 1 : -1;
        this.stateTimer = 2.0 + Math.random() * 3.0;
      } else if (roll < 0.50) {
        // SPRINT: high speed burst across space!
        this.state = 'SPRINT';
        this.targetFacing = Math.random() > 0.5 ? 1 : -1;
        // Sprint target far in facing direction so character warps across screen boundaries
        this.walkTargetX = this.position.x + this.targetFacing * (bounds.width * 2.5);
        this.walkSpeed = 3.2 * (this.config.speedMultiplier || 1.0) * this.manager.settings.speed;
        this.stateTimer = 2.5 + Math.random() * 2.0;
        this.manager.particles.spawnDust(this.screenX, this.screenY, -this.targetFacing);
        if (Math.random() < 0.45) {
          this.say(this.getSprintQuote());
        }
      } else if (roll < 0.62) {
        // IDLE_LOOK_AROUND: natural idle with head rotation
        this.state = 'IDLE_LOOK_AROUND';
        this.stateTimer = 2.0 + Math.random() * 3.0;
        const turnRoll = Math.random();
        if (turnRoll < 0.35) {
          this.targetFacing = 0; // Face forward toward user!
        } else if (turnRoll < 0.70) {
          this.targetFacing = this.targetFacing === 1 ? -1 : 1;
        }
        if (Math.random() < 0.15) {
          this.say(this.getRandomQuote());
        }
      } else if (roll < 0.72) {
        // IDLE_STRETCH: cute deep stretch
        this.state = 'IDLE_STRETCH';
        this.stateTimer = 2.2;
      } else if (roll < 0.82) {
        // IDLE_EAR_TWITCH: ears twitching inquisitively
        this.state = 'IDLE_EAR_TWITCH';
        this.stateTimer = 1.8;
      } else if (roll < 0.92) {
        // WAVE: Turn forward and wave cheerfully to user!
        this.wave();
      } else {
        // SNOOZE: Take a cute power nap
        this.state = 'SNOOZE';
        this.stateTimer = 4.5 + Math.random() * 4.0;
        if (Math.random() < 0.4) this.targetFacing = 0;
        ChibiAudio.playYawn();
        this.say(this.getSnoozeQuote(), 2.0);
      }
    }

    // Check snack target
    if (this.snackTarget) {
      const dist = Math.abs(this.snackTarget.x - this.position.x);
      if (dist < 0.25) {
        this.snackTarget = null;
        this.state = 'EATING';
        this.stateTimer = 3.2;
        ChibiAudio.playMunch();
        this.manager.particles.spawnCrumbs(this.screenX, this.screenY);
        this.say(this.getEatQuote(), 2.5);
      }
    }
  }

  _updatePhysics(dt) {
    const gravity = -18.0;
    const bounds = this.manager.getWorldBounds();

    if (!this.isDragging) {
      // Check DOM roosting platform beneath chibi
      const platform = this.manager.domBridge ? this.manager.domBridge.findPlatformBeneath(this.position.x, this.position.y) : null;
      const effectiveFloorY = platform ? platform.worldY : this.floorY;

      // Detect walking off edge of platform
      if (this.currentPlatform && !platform && this.position.y > this.floorY + 0.05) {
        this.grounded = false;
        this.currentPlatform = null;
      } else if (platform) {
        this.currentPlatform = platform;
      }

      if (!this.grounded) {
        this.velocity.y += gravity * dt;
        this.position.x += this.velocity.x * dt;
        this.position.y += this.velocity.y * dt;

        // Check landing on effective floor (roosted card or bottom of screen)
        if (this.position.y <= effectiveFloorY) {
          this.position.y = effectiveFloorY;
          const impactSpeed = Math.abs(this.velocity.y);
          this.grounded = true;

          // Squash & stretch on landing
          if (impactSpeed > 1.8) {
            const squashFactor = Math.min(0.5, impactSpeed * 0.05);
            this.squash.set(1 + squashFactor * 1.2, 1 - squashFactor, 1 + squashFactor * 1.2);
            ChibiAudio.playBoing(Math.min(1.0, impactSpeed * 0.15));

            this.state = 'LAND_RECOVERY';
            this.stateTimer = 0.45;
            this.manager.particles.spawnDust(this.screenX, this.screenY, 0);
          } else {
            this.state = 'IDLE_LOOK_AROUND';
            this.stateTimer = 1.0;
          }

          this.velocity.set(0, 0, 0);
        }
      } else {
        // Ground movement logic
        const isMovingState = (this.state === 'WALK' || this.state === 'TROT' || this.state === 'SPRINT');
        if (isMovingState) {
          const dx = this.walkTargetX - this.position.x;
          if (Math.abs(dx) > 0.1) {
            const dir = Math.sign(dx);
            this.targetFacing = dir;
            this.velocity.x = dir * this.walkSpeed;
            this.position.x += dir * this.walkSpeed * dt;

            // Footstep audio
            const stepRate = this.state === 'SPRINT' ? 16 : (this.state === 'TROT' ? 11 : 7.5);
            this.stepTimer += dt * stepRate;
            if (this.stepTimer >= 1.0) {
              this.stepTimer = 0;
              ChibiAudio.playStep(this.state === 'SPRINT' ? 0.3 : 0);
            }

            // Sprint dust puffs
            if (this.state === 'SPRINT' && Math.random() < 0.12) {
              this.manager.particles.spawnDust(this.screenX, this.screenY, -dir);
            }
          } else {
            this.velocity.x = 0;
            // Reached destination: if sprinting, trigger drift stop
            if (this.state === 'SPRINT') {
              this.startDriftStop('RECOVER_PANT');
            } else {
              this.state = 'IDLE_LOOK_AROUND';
              this.stateTimer = 1.5 + Math.random() * 2.0;
            }
          }
        } else if (this.state === 'DRIFT_STOP') {
          // Decelerate with ground braking friction
          this.velocity.x *= Math.pow(0.04, dt);
          this.position.x += this.velocity.x * dt;

          if (Math.random() < 0.22 && this.screenX && this.screenY) {
            this.manager.particles?.spawnDust(this.screenX, this.screenY, -this.targetFacing);
          }
        }
      }
    }

    // Space Warping: Wrap seamlessly around screen boundaries
    if (!this.isDragging) {
      const halfW = bounds.width / 2;
      const warpMargin = 0.55;
      const leftBound = -halfW - warpMargin;
      const rightBound = halfW + warpMargin;
      const span = rightBound - leftBound;

      if (this.position.x > rightBound) {
        this.position.x -= span;
        if (this.isRacing) {
          this.raceLap = (this.raceLap || 0) + 1;
        }
      } else if (this.position.x < leftBound) {
        this.position.x += span;
        if (this.isRacing && this.targetFacing < 0) {
          this.raceLap = (this.raceLap || 0) + 1;
        }
      }
    }

    // Dynamic tilt during high speed sprint (banking)
    let targetRoll = 0;
    if (this.state === 'SPRINT') {
      targetRoll = -this.targetFacing * 0.08; // Gentle 4.5 degree athletic bank
    }

    // Smooth facing turn: 1 = right, -1 = left, 0 = forward (facing user)
    // Use 73.3 degrees (1.28 rad) 3/4 anime perspective so mouth, eyes, and facial features are always visible
    let targetAngle = 0;
    if (this.state === 'WAVE' || this.state === 'wave') {
      targetAngle = 0;
    } else if (this.targetFacing > 0.3) {
      targetAngle = 1.28;
    } else if (this.targetFacing < -0.3) {
      targetAngle = -1.28;
    } else {
      targetAngle = 0;
    }
    const turnRate = (this.state === 'WAVE' || this.state === 'wave') ? 25 : 10;
    this.facingAngle += (targetAngle - this.facingAngle) * turnRate * dt;
    this.group.rotation.y = this.facingAngle;
    this.group.rotation.z += (targetRoll - this.group.rotation.z) * 12 * dt;

    // Recover squash spring
    const springStrength = 180;
    const damping = 14;
    const fx = (1 - this.squash.x) * springStrength - this.squashVelocity.x * damping;
    const fy = (1 - this.squash.y) * springStrength - this.squashVelocity.y * damping;
    const fz = (1 - this.squash.z) * springStrength - this.squashVelocity.z * damping;
    this.squashVelocity.x += fx * dt;
    this.squashVelocity.y += fy * dt;
    this.squashVelocity.z += fz * dt;
    this.squash.x += this.squashVelocity.x * dt;
    this.squash.y += this.squashVelocity.y * dt;
    this.squash.z += this.squashVelocity.z * dt;

    const baseScale = (this.config.baseScale || 0.01) * this.manager.settings.scale;
    if (this.model) {
      this.model.scale.set(
        baseScale * this.squash.x,
        baseScale * this.squash.y,
        baseScale * this.squash.z
      );
    }
  }

  _updateSkeletalAnimation(dt) {
    this.controller.setState(this.state);
    const domBridge = this.manager.domBridge;
    const cursorWorldPos = domBridge ? this.manager.screenToWorld(domBridge.mousePos.x, domBridge.mousePos.y) : null;
    const cursorSpeed = domBridge ? domBridge.cursorSpeed : 0;

    // 1. Base skeletal animation controller (updates state poses and crossfading)
    this.controller.update(dt, cursorWorldPos, cursorSpeed);

    // 2. Override rest posture if in Idle / Low-influence / Snooze states, or apply wave pose
    if (this.armNormalizer) {
      if (this.state.startsWith('IDLE') || this.state === 'idle' || this.state === 'SNOOZE' || this.state === 'sleeping') {
        this.armNormalizer.applyRelaxedRestPose(0.95); // 95% procedural relaxed blend
      } else if (this.state === 'WAVE' || this.state === 'wave') {
        this.armNormalizer.applyWavePose(this.animTime);
      }
    }

    // 3. Add procedural arm-swing during locomotion
    if (this.armSwing && (this.state === 'WALK' || this.state === 'walk' || this.state === 'TROT' || this.state === 'SPRINT' || this.state === 'run')) {
      this.armSwing.update(this.velocity, dt, this.state, this.animTime);
    }

    // 4. Update hand poses & finger curling
    if (this.handController) {
      if (this.state === 'EATING') {
        this.handController.setHandPose('HOLD_CARROT');
      } else if (this.state === 'WAVE') {
        if (this.config.id === 'helios') {
          this.handController.setRightPose('PEACE_V');
          this.handController.setLeftPose('PEACE_V');
        } else if (this.config.id === 'mambo') {
          this.handController.setRightPose('OPEN_PALM');
          this.handController.setLeftPose('FIST');
        } else {
          this.handController.setRightPose('OPEN_PALM');
          this.handController.setLeftPose('RELAXED_CUP');
        }
      } else if (this.state === 'SPRINT' || this.state === 'run') {
        this.handController.setHandPose('FIST');
      } else if (this.state === 'RACE_VICTORY') {
        this.handController.setHandPose('PEACE_V');
      } else if (this.state === 'RECOVER_PANT') {
        this.handController.setHandPose('OPEN_PALM');
      } else {
        this.handController.setHandPose(this.config.defaultHandPose || 'RELAXED_CUP');
      }
      this.handController.update(dt);
    }

    // 5. Secondary ear/tail spring physics
    this.secondaryPhysics.update(dt, this.velocity, this.controller.currentState);
  }

  _updateScreenPosition() {
    if (!this.group || !this.manager.camera) return;

    // Project 3D position to 2D screen coordinates
    const scaleFactor = (this.config.baseScale || 0.0065) / 0.0065;
    const headHeight = 0.52 * scaleFactor * this.manager.settings.scale;
    const headWorldPos = new THREE.Vector3(this.position.x, this.position.y + headHeight, this.position.z);
    headWorldPos.project(this.manager.camera);

    const width = window.innerWidth;
    const height = window.innerHeight;

    this.screenX = ((headWorldPos.x + 1) * width) / 2;
    this.screenY = ((-headWorldPos.y + 1) * height) / 2;

    // Position speech bubble
    if (this.bubbleElement && this.bubbleElement.style.display !== 'none') {
      this.bubbleElement.style.left = `${this.screenX}px`;
      this.bubbleElement.style.top = `${this.screenY - 15}px`;
    }
  }

  destroy() {
    if (this.bubbleElement && this.bubbleElement.parentNode) {
      this.bubbleElement.parentNode.removeChild(this.bubbleElement);
    }
    if (this.group && this.scene) {
      this.scene.remove(this.group);
    }
  }
}
