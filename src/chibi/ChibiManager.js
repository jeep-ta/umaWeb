import * as THREE from 'three';
import { CHIBI_CONFIGS, DEFAULT_SETTINGS } from './ChibiConfigs.js';
import { ChibiCharacter } from './ChibiCharacter.js';
import { ChibiParticleManager } from './ChibiParticles.js';
import { ChibiAudio } from './ChibiAudio.js';
import { DOMBridge } from './DOMBridge.js';
import { PassByReaction } from './PassByReaction.js';

export class ChibiManager {
  constructor(canvasElement, domContainer, customSettings = {}) {
    this.canvas = canvasElement;
    this.domContainer = domContainer;
    this.settings = { ...DEFAULT_SETTINGS, ...customSettings };

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();

    this.particles = new ChibiParticleManager(this.domContainer);
    this.chibis = [];
    this.activeSnacks = [];

    // Raycasting & Interaction
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.draggedChibi = null;
    this.dragPlane = new THREE.Plane();
    this.dragIntersection = new THREE.Vector3();

    // Petting gesture tracker
    this.petTracker = {
      activeChibi: null,
      lastX: 0,
      lastY: 0,
      wiggleDistance: 0,
      startTime: 0
    };

    // Pointer state
    this.pointerDownPos = new THREE.Vector2();
    this.pointerDownTime = 0;
    this.isPointerDown = false;

    // DOM & Viewport Interaction Bridge (cursor velocity, rapid scroll, element roosting, idle timeout)
    this.domBridge = new DOMBridge(this);

    // Race management state
    this.isRacing = false;
    this.raceLapsRequired = 2;
    this.raceWinnerDeclared = false;

    this._initThree();
    this._initEvents();
    this._syncChibisWithSettings();
    this._animate();
  }

  _initThree() {
    this.scene = new THREE.Scene();

    const w = window.innerWidth;
    const h = window.innerHeight;

    // Perspective camera positioned so floor (Y = 0) is at the bottom of the viewport
    const vFov = 34;
    const cameraDist = 5.2;
    this.camera = new THREE.PerspectiveCamera(vFov, w / h, 0.1, 1000);

    // Calculate camera Y so Y = 0 rests just 15px above bottom edge
    const halfH = Math.tan(THREE.MathUtils.degToRad(vFov / 2)) * cameraDist;
    const cameraY = halfH - 0.04;
    this.camera.position.set(0, cameraY, cameraDist);
    this.camera.lookAt(0, cameraY, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    // Warm, soft anime lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfffaed, 0.7);
    dirLight.position.set(2, 5, 3);
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xe8f0fe, 0.4);
    fillLight.position.set(-2, 3, 2);
    this.scene.add(fillLight);

    // Drag plane parallel to camera at Z = 0
    this.dragPlane.set(new THREE.Vector3(0, 0, 1), 0);
  }

  _initEvents() {
    window.addEventListener('resize', this._onResize.bind(this));

    // Pointer events on window so clicks pass through unless targeting a chibi
    window.addEventListener('pointerdown', this._onPointerDown.bind(this), { capture: true });
    window.addEventListener('pointermove', this._onPointerMove.bind(this));
    window.addEventListener('pointerup', this._onPointerUp.bind(this));

    // Double-click on floor drops a snack at cursor
    window.addEventListener('dblclick', (e) => {
      if (e.target.closest('.control-dock') || e.target.closest('nav') || e.target.closest('button') || e.target.closest('input')) return;
      if (e.clientY > window.innerHeight - 250) {
        this.dropSnack(e.clientX, e.clientY);
      }
    });

    // Context menu prevention on canvas
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z;
    const cameraY = halfH - 0.04;
    this.camera.position.y = cameraY;
    this.camera.lookAt(0, cameraY, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  getWorldBounds() {
    // Determine world horizontal width visible at floor line (Z = 0)
    const vFOV = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = this.camera.position.z;
    const visibleHeight = 2 * Math.tan(vFOV / 2) * dist;
    const visibleWidth = visibleHeight * this.camera.aspect;
    return {
      width: visibleWidth,
      height: visibleHeight
    };
  }

  screenToWorld(screenX, screenY) {
    this.mouse.x = (screenX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(screenY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const target = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.dragPlane, target);
    return target;
  }

  _raycastChibis(screenX, screenY) {
    this.mouse.x = (screenX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(screenY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const targets = [];
    for (const chibi of this.chibis) {
      if (chibi.group) {
        targets.push({ chibi, object: chibi.group });
      }
    }

    for (const { chibi, object } of targets) {
      const hits = this.raycaster.intersectObject(object, true);
      if (hits.length > 0) {
        return chibi;
      }
    }
    return null;
  }

  _onPointerDown(e) {
    // Don't intercept if clicking UI controls or popup dock
    if (e.target.closest('.control-dock') || e.target.closest('nav') || e.target.closest('button') || e.target.closest('input')) {
      return;
    }

    const clickedChibi = this._raycastChibis(e.clientX, e.clientY);
    if (clickedChibi) {
      // Intercept event specifically for Chibi interaction
      e.stopPropagation();
      e.preventDefault();
      if (window.getSelection) {
        window.getSelection().removeAllRanges();
      }

      this.isPointerDown = true;
      this.pointerDownPos.set(e.clientX, e.clientY);
      this.pointerDownTime = performance.now();

      this.draggedChibi = clickedChibi;
      const worldPos = this.screenToWorld(e.clientX, e.clientY);
      this.draggedChibi.startDrag();
      this.draggedChibi.updateDrag(worldPos);

      // Start petting tracker
      this.petTracker.activeChibi = clickedChibi;
      this.petTracker.lastX = e.clientX;
      this.petTracker.lastY = e.clientY;
      this.petTracker.wiggleDistance = 0;
      this.petTracker.startTime = performance.now();

      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
    }
  }

  _onPointerMove(e) {
    const worldPos = this.screenToWorld(e.clientX, e.clientY);

    if (this.draggedChibi && this.isPointerDown) {
      this.draggedChibi.updateDrag(worldPos);

      // Petting detection: rapid small wiggles
      const dx = Math.abs(e.clientX - this.petTracker.lastX);
      const dy = Math.abs(e.clientY - this.petTracker.lastY);
      this.petTracker.wiggleDistance += dx + dy;
      this.petTracker.lastX = e.clientX;
      this.petTracker.lastY = e.clientY;

      if (this.petTracker.wiggleDistance > 140) {
        this.petTracker.wiggleDistance = 0;
        this.draggedChibi.pet();
      }
    } else {
      // Hover test for cursor styling
      const hovered = this._raycastChibis(e.clientX, e.clientY);
      if (hovered) {
        document.body.style.cursor = 'grab';
      } else if (document.body.style.cursor === 'grab') {
        document.body.style.cursor = 'default';
      }
    }
  }

  _onPointerUp(e) {
    if (this.draggedChibi) {
      const elapsed = performance.now() - this.pointerDownTime;
      const moveDist = this.pointerDownPos.distanceTo(new THREE.Vector2(e.clientX, e.clientY));

      if (elapsed < 280 && moveDist < 8) {
        // Quick click -> If idle, wave and greet! If sleeping or running, poke!
        this.draggedChibi.endDrag();
        if (this.draggedChibi.state === 'idle') {
          this.draggedChibi.wave();
        } else {
          this.draggedChibi.poke();
        }
      } else {
        // Drop & fling
        this.draggedChibi.endDrag();
      }
      this.draggedChibi = null;
    }

    this.isPointerDown = false;
    document.body.style.userSelect = '';
    if (document.body.style.cursor === 'grab') {
      document.body.style.cursor = 'default';
    }
  }

  // Manage Roster
  _syncChibisWithSettings() {
    const enabledIds = this.settings.enabledChibis || ['spe', 'oguri', 'helios', 'mambo', 'suzuka'];
    const targetCount = Math.min(this.settings.population || 3, enabledIds.length);

    // Filter current chibis
    const validChibis = [];
    for (const chibi of this.chibis) {
      if (enabledIds.includes(chibi.config.id) && validChibis.length < targetCount) {
        validChibis.push(chibi);
      } else {
        chibi.destroy();
      }
    }
    this.chibis = validChibis;

    // Add missing chibis evenly spaced
    const currentIds = this.chibis.map(c => c.config.id);
    const bounds = this.getWorldBounds();
    const step = (bounds.width - 2) / Math.max(1, targetCount);

    for (const id of enabledIds) {
      if (this.chibis.length >= targetCount) break;
      if (!currentIds.includes(id) && CHIBI_CONFIGS[id]) {
        const chibi = new ChibiCharacter(CHIBI_CONFIGS[id], this);
        const spawnX = -((bounds.width - 2) / 2) + step * (this.chibis.length + 0.5) + (Math.random() * 0.4 - 0.2);
        this.chibis.push(chibi);
        const trackZ = chibi.getTrackZ();
        chibi.position.set(spawnX, 0, trackZ);
        if (chibi.passingSteer) chibi.passingSteer.targetLaneZ = trackZ;
      }
    }
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    if (newSettings.volume !== undefined) {
      ChibiAudio.setVolume(newSettings.volume);
    }
    if (newSettings.soundEnabled !== undefined) {
      ChibiAudio.setMuted(!newSettings.soundEnabled);
    }
    this._syncChibisWithSettings();
  }

  // Interactive Feature: Drop Snack
  dropSnack(screenX, screenY) {
    ChibiAudio.playMunch();
    const worldPos = this.screenToWorld(
      screenX !== undefined ? screenX : window.innerWidth * (0.3 + Math.random() * 0.4),
      screenY !== undefined ? screenY : window.innerHeight - 80
    );

    // Spawn 2D snack element falling to floor
    const snackEl = document.createElement('div');
    snackEl.className = 'chibi-snack-item';
    const snackIcons = ['🥕', '🍰', '🍙', '🍎', '🍪'];
    snackEl.textContent = snackIcons[Math.floor(Math.random() * snackIcons.length)];
    snackEl.style.left = `${(worldPos.x / (this.getWorldBounds().width / 2)) * (window.innerWidth / 2) + window.innerWidth / 2}px`;
    snackEl.style.top = `${window.innerHeight - 70}px`;

    this.domContainer.appendChild(snackEl);

    // Notify nearest chibi to run towards snack
    let nearestChibi = null;
    let minDist = Infinity;
    for (const chibi of this.chibis) {
      const dist = Math.abs(chibi.position.x - worldPos.x);
      if (dist < minDist) {
        minDist = dist;
        nearestChibi = chibi;
      }
    }

    if (nearestChibi) {
      nearestChibi.feedSnack(worldPos);
    }

    // Auto-remove snack element after 3.5s
    setTimeout(() => {
      if (snackEl.parentNode) snackEl.parentNode.removeChild(snackEl);
    }, 3500);
  }

  // Interactive Feature: Stampede Race Mode
  startStampede() {
    ChibiAudio.playRaceWhistle();
    const bounds = this.getWorldBounds();
    const halfW = bounds.width / 2;
    const startX = -halfW + 0.35;

    this.isRacing = true;
    this.raceLapsRequired = 2;
    this.raceWinnerDeclared = false;

    this.chibis.forEach((chibi, idx) => {
      chibi.isDragging = false;
      chibi.grounded = true;
      chibi.currentPlatform = null;
      chibi.isRacing = true;
      chibi.raceLap = 0;
      chibi.isRaceFinished = false;

      // Assign dedicated parallel race tracks across [-0.28, +0.28] so no two runners ever share the same Z layer
      const raceLaneZ = chibi.getTrackZ ? chibi.getTrackZ() : 0.0;
      chibi.raceLaneZ = raceLaneZ;
      chibi.position.set(startX + idx * 0.25, 0, raceLaneZ);
      if (chibi.passingSteer) chibi.passingSteer.targetLaneZ = raceLaneZ;

      chibi.state = 'SPRINT';
      chibi.targetFacing = 1;
      chibi.facingAngle = 1.28;
      // Set endless target in facing direction; laps determine race completion
      chibi.walkTargetX = chibi.position.x + bounds.width * 10.0;
      chibi.walkSpeed = (3.3 + idx * 0.35 + Math.random() * 0.45) * (chibi.config.speedMultiplier || 1.0) * this.settings.speed;
      chibi.stateTimer = 999.0;
      chibi.controller?.setState('SPRINT', true);

      chibi.say(chibi.getRaceQuote(), 2.8);
      if (chibi.screenX && chibi.screenY) {
        this.particles.spawnDust(chibi.screenX, chibi.screenY, -1);
      }
    });
  }

  // Interactive Feature: Group Nap
  groupNap() {
    ChibiAudio.playYawn();
    this.chibis.forEach(chibi => {
      chibi.state = 'SNOOZE';
      chibi.stateTimer = 12.0;
      chibi.velocity.set(0, 0, 0);
      chibi.controller?.setState('SNOOZE', true);
      chibi.say(chibi.getSnoozeQuote(), 3.0);
    });
  }

  // Interactive Feature: Wake Up All
  wakeAll() {
    this.chibis.forEach(chibi => {
      chibi.poke();
    });
  }

  // Interactive Feature: Wave All
  waveAll() {
    this.chibis.forEach((chibi) => {
      chibi.isDragging = false;
      if (chibi.state === 'SNOOZE' || chibi.state === 'sleeping') {
        chibi.state = 'IDLE_LOOK_AROUND';
      }
      chibi.wave();
    });
  }

  // Interactive Feature: Trot All
  trotAll() {
    const bounds = this.getWorldBounds();
    this.chibis.forEach((chibi, idx) => {
      chibi.state = 'TROT';
      const trackZ = chibi.getTrackZ ? chibi.getTrackZ() : 0.0;
      chibi.raceLaneZ = trackZ;
      if (chibi.passingSteer) chibi.passingSteer.targetLaneZ = trackZ;
      chibi.walkSpeed = 1.6 * (chibi.config.speedMultiplier || 1.0) * this.settings.speed;
      chibi.walkTargetX = (Math.random() * (bounds.width - 2)) - (bounds.width / 2 - 1);
      chibi.targetFacing = chibi.walkTargetX > chibi.position.x ? 1 : -1;
      chibi.stateTimer = 4.0;
    });
  }

  // Interactive Feature: Sprint All
  sprintAll() {
    ChibiAudio.playRaceWhistle();
    const bounds = this.getWorldBounds();
    this.chibis.forEach((chibi, idx) => {
      chibi.isDragging = false;
      chibi.isRacing = false;
      chibi.state = 'SPRINT';
      const trackZ = chibi.getTrackZ ? chibi.getTrackZ() : 0.0;
      chibi.raceLaneZ = trackZ;
      if (chibi.passingSteer) chibi.passingSteer.targetLaneZ = trackZ;
      chibi.walkSpeed = 3.3 * (chibi.config.speedMultiplier || 1.0) * this.settings.speed;
      chibi.targetFacing = Math.random() > 0.5 ? 1 : -1;
      chibi.walkTargetX = chibi.position.x + chibi.targetFacing * (bounds.width * 2.5);
      chibi.stateTimer = 2.8 + Math.random() * 1.5;
      chibi.controller?.setState('SPRINT', true);
      chibi.say(chibi.getSprintQuote(), 2.0);
      if (chibi.screenX && chibi.screenY) {
        this.particles.spawnDust(chibi.screenX, chibi.screenY, -chibi.targetFacing);
      }
    });
  }

  // Rapid scroll reaction triggered by DOMBridge
  handleRapidScroll(direction) {
    // direction > 0 is scrolling down, < 0 is scrolling up
    const dir = direction > 0 ? 1 : -1;
    const bounds = this.getWorldBounds();
    this.chibis.forEach((chibi) => {
      if (chibi.isDragging || chibi.state === 'HELD_AIRBORNE' || chibi.state === 'EATING' || chibi.state === 'RACE_VICTORY') return;
      chibi.isRacing = false;
      chibi.state = 'SPRINT';
      const trackZ = chibi.getTrackZ ? chibi.getTrackZ() : 0.0;
      chibi.raceLaneZ = trackZ;
      if (chibi.passingSteer) chibi.passingSteer.targetLaneZ = trackZ;
      chibi.targetFacing = dir;
      chibi.walkTargetX = chibi.position.x + dir * (bounds.width * 2.5);
      chibi.walkSpeed = 3.4 * (chibi.config.speedMultiplier || 1.0) * this.settings.speed;
      chibi.stateTimer = 2.2;
      chibi.controller?.setState('SPRINT', true);
      if (chibi.screenX && chibi.screenY) {
        this.particles.spawnDust(chibi.screenX, chibi.screenY, -dir);
      }
    });
  }

  // Monitor Stampede multi-lap race progress and declare placements
  _updateRace(dt) {
    if (!this.isRacing) return;

    const bounds = this.getWorldBounds();
    const halfW = bounds.width / 2;
    // Finish line positioned towards the right side of the screen on the final lap
    const finishLineX = halfW * 0.35;

    let allFinished = true;

    for (const chibi of this.chibis) {
      if (!chibi.isRacing) continue;

      if (!chibi.isRaceFinished) {
        allFinished = false;

        // Check if chibi completed required laps and crossed the finish line
        if (chibi.raceLap >= this.raceLapsRequired && chibi.position.x >= finishLineX) {
          chibi.isRaceFinished = true;

          if (!this.raceWinnerDeclared) {
            // First place winner!
            this.raceWinnerDeclared = true;
            chibi.isRacing = false;
            chibi.startDriftStop('RACE_VICTORY');
            setTimeout(() => {
              if (chibi.state === 'DRIFT_STOP' || chibi.postDriftState === 'RACE_VICTORY') {
                chibi.celebrateVictory();
              }
            }, 600);
          } else {
            // Runner-up finishers
            chibi.isRacing = false;
            chibi.finishRaceRunnerUp();
          }
        }
      }
    }

    if (allFinished) {
      this.isRacing = false;
    }
  }

  _animate() {
    requestAnimationFrame(this._animate.bind(this));

    const dt = Math.min(this.clock.getDelta(), 0.1);

    // Update DOM & viewport tracking
    if (this.domBridge) {
      this.domBridge.update(dt);
    }

    // Update all chibis
    for (const chibi of this.chibis) {
      chibi.update(dt);
    }

    // Check race progress if racing
    if (this.isRacing) {
      this._updateRace(dt);
    }

    // Check proximity and trigger pass-by courtesy shoulder tilt and ear twitches
    PassByReaction.checkAndApplyReactions(this.chibis, dt);

    // Render 3D scene
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    if (this.domBridge) {
      this.domBridge.destroy();
    }
    this.chibis.forEach(c => c.destroy());
    this.particles.clear();
    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}

