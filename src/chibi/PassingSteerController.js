import * as THREE from 'three';

/**
 * PassingSteerController: Deterministic 2-Lane Overtake & Dynamic Z-Sorting.
 * Characters moving right take the foreground lane (+Z).
 * Characters moving left take the background lane (-Z).
 * Ensures characters pass around each other instead of clipping through.
 * Sets dynamic WebGL renderOrder so foreground characters always render second,
 * completely preventing decal bleed-through from background characters.
 */
export class PassingSteerController {
  constructor(character) {
    this.char = character;
    this.targetLaneZ = 0.0;
    this.currentLane = 'front'; // 'front', 'back', 'held'
  }

  update(delta) {
    if (!this.char || !this.char.position) return;

    // 1. Determine target Z lane
    if (this.char.isDragging || this.char.state === 'HELD_AIRBORNE') {
      this.targetLaneZ = 0.38; // Priority foreground: held in front of all walking/running chibis
      this.currentLane = 'held';
    } else if (this.char.raceLaneZ !== null && this.char.raceLaneZ !== undefined && this.char.state === 'SPRINT') {
      // Dedicated parallel race track during stampede/sprint
      this.targetLaneZ = this.char.raceLaneZ;
      this.currentLane = this.targetLaneZ >= 0 ? 'front' : 'back';
    } else {
      // Guaranteed distinct, dedicated track for each character so no two chibis share the same Z layer
      const trackZ = this.char.getTrackZ ? this.char.getTrackZ() : 0.0;

      // When greeting/waving, stay on dedicated track with tiny forward lean (+0.03) that never crosses adjacent lanes
      if (this.char.state === 'WAVE' || this.char.state === 'wave') {
        this.targetLaneZ = trackZ + 0.03;
      } else {
        this.targetLaneZ = trackZ;
      }
      this.currentLane = this.targetLaneZ >= 0 ? 'front' : 'back';
    }

    // Clamp target lane to safe depth bounds
    this.targetLaneZ = THREE.MathUtils.clamp(this.targetLaneZ, -0.32, 0.38);

    // 2. Smooth exponential decay interpolation towards target lane
    const lerpSpeed = this.char.isDragging ? 18.0 : 6.5;
    this.char.position.z = THREE.MathUtils.lerp(
      this.char.position.z,
      this.targetLaneZ,
      Math.min(1.0, delta * lerpSpeed)
    );

    // 3. Dynamic WebGL renderOrder based on depth (Higher Z = Foreground = Higher Render Order)
    // Three.js renders lower renderOrder first, so background is drawn first, then foreground covers it!
    const baseRenderOrder = Math.round(200 + this.char.position.z * 150);
    if (this.char.model) {
      this.char.model.traverse((child) => {
        if (child.isMesh) {
          child.renderOrder = baseRenderOrder;
        }
      });
    }

    // 4. Update speech bubble DOM z-index to match depth layer
    if (this.char.bubbleElement) {
      const zIndex = Math.round(100 + (this.char.position.z + 1.0) * 50);
      this.char.bubbleElement.style.zIndex = zIndex;
    }
  }
}
