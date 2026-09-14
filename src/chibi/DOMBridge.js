import * as THREE from 'three';

/**
 * DOMBridge: Bridge between Browser DOM Events, Viewport Mechanics, and 3D Characters
 * Handles:
 * 1. Global cursor tracking & velocity calculation (px/s)
 * 2. Rapid wheel/scroll velocity detection & scroll reactivity
 * 3. 45-second user inactivity / idle timeout detection
 * 4. DOM element roosting (mapping HTML element top edges to 3D walk platforms)
 */
export class DOMBridge {
  constructor(manager) {
    this.manager = manager;

    // Cursor tracking
    this.mousePos = new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2);
    this.prevMousePos = new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2);
    this.cursorSpeed = 0; // px/s
    this.lastMouseMoveTime = performance.now();

    // Scroll tracking
    this.scrollVelocity = 0;
    this.lastScrollTime = performance.now();
    this.lastScrollY = window.scrollY;

    // User inactivity / idle timeout tracker
    this.lastUserActionTime = performance.now();
    this.idleTimeoutTriggered = false;

    // Roosting platforms cache
    this.platforms = [];
    this.lastPlatformScanTime = 0;

    this._initEvents();
  }

  _initEvents() {
    window.addEventListener('mousemove', this._onMouseMove.bind(this), { passive: true });
    window.addEventListener('wheel', this._onWheel.bind(this), { passive: true });
    window.addEventListener('scroll', this._onScroll.bind(this), { passive: true });
    window.addEventListener('keydown', this._recordUserAction.bind(this), { passive: true });
    window.addEventListener('pointerdown', this._recordUserAction.bind(this), { passive: true });
    window.addEventListener('resize', () => {
      this.scanRoostPlatforms(true);
    }, { passive: true });
  }

  _recordUserAction() {
    this.lastUserActionTime = performance.now();
    if (this.idleTimeoutTriggered) {
      this.idleTimeoutTriggered = false;
      this.manager.wakeAll();
    }
  }

  _onMouseMove(e) {
    this._recordUserAction();
    const now = performance.now();
    const dt = (now - this.lastMouseMoveTime) / 1000.0;
    this.lastMouseMoveTime = now;

    if (dt > 0.001) {
      const dx = e.clientX - this.mousePos.x;
      const dy = e.clientY - this.mousePos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const instantSpeed = dist / dt;
      // Exponential moving average for smooth cursor velocity
      this.cursorSpeed = this.cursorSpeed * 0.7 + instantSpeed * 0.3;
    }

    this.prevMousePos.copy(this.mousePos);
    this.mousePos.set(e.clientX, e.clientY);
  }

  _onWheel(e) {
    this._recordUserAction();
    // Scroll/wheel no longer triggers a sprint reaction — chibis roam autonomously.
  }

  _onScroll() {
    this._recordUserAction();
    // Scroll no longer triggers a sprint reaction — chibis roam autonomously.
  }

  update(dt) {
    // Decay cursor speed
    const timeSinceMove = (performance.now() - this.lastMouseMoveTime) / 1000.0;
    if (timeSinceMove > 0.08) {
      this.cursorSpeed *= Math.exp(-dt * 15);
    }

    // Check 45s user idle timeout
    const idleSeconds = (performance.now() - this.lastUserActionTime) / 1000.0;
    if (idleSeconds > 45.0 && !this.idleTimeoutTriggered) {
      this.idleTimeoutTriggered = true;
      this.manager.groupNap('💤 Inactivity timeout: time for a collective nap...');
    }

    // Refresh platforms every 1.5 seconds
    const now = performance.now();
    if (now - this.lastPlatformScanTime > 1500) {
      this.scanRoostPlatforms();
    }
  }

  /**
   * Scan prominent viewport DOM elements to build walk platforms in 3D world coordinates
   */
  scanRoostPlatforms(force = false) {
    this.lastPlatformScanTime = performance.now();
    const platforms = [];

    // Prominent selectors for cards, banners, sticky headers, and buttons
    const selectors = [
      '.feature-card',
      '.intro-banner',
      '.chibi-card',
      'nav',
      'header',
      '.modal',
      '.dialog',
      '[role="dialog"]',
      'article',
      '.hero-card'
    ];

    const elements = Array.from(document.querySelectorAll(selectors.join(',')))
      .filter(el => {
        // Exclude our own chibi overlay root and dock controls
        if (el.closest('#chibi-goobers-host') || el.closest('#chibi-goobers-root') || el.closest('.control-dock')) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width >= 120 && rect.height >= 40 && rect.top > 40 && rect.top < window.innerHeight - 100;
      });

    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      // Project left, right, and top of the element into 3D world space
      const worldCenter = this.manager.screenToWorld(rect.left + rect.width / 2, rect.top);
      const worldLeft = this.manager.screenToWorld(rect.left, rect.top);
      const worldRight = this.manager.screenToWorld(rect.right, rect.top);

      if (worldCenter && worldLeft && worldRight) {
        platforms.push({
          minX: Math.min(worldLeft.x, worldRight.x) + 0.2,
          maxX: Math.max(worldLeft.x, worldRight.x) - 0.2,
          topY: worldCenter.y + 0.05, // Slight elevation above top edge
          domElement: el
        });
      }
    }

    this.platforms = platforms;
  }

  /**
   * Find a roosting platform directly beneath a character at (worldX, worldY)
   */
  findPlatformBeneath(worldX, worldY, margin = 0.25) {
    let bestPlatform = null;
    let highestY = -Infinity;

    for (const p of this.platforms) {
      if (worldX >= p.minX && worldX <= p.maxX) {
        // Platform must be at or below character's current Y (within tolerance)
        if (p.topY <= worldY + margin && p.topY > highestY) {
          highestY = p.topY;
          bestPlatform = p;
        }
      }
    }

    return bestPlatform;
  }
}
