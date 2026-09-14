import * as THREE from 'three';

/**
 * PassByReaction: Proximity-based "Pardon Me" courtesy steering and reaction.
 * When two characters pass each other within close X-proximity in opposite directions:
 * 1. Gently turns their torso/model yaw (~12-15°) to gracefully slide past each other.
 * 2. Triggers an inquisitive ear twitch via secondary physics.
 */
export class PassByReaction {
  static checkAndApplyReactions(characters, delta) {
    if (!characters || characters.length < 2) return;

    const proximityThreshold = 0.65; // Distance in world units triggering reaction

    // Track active pass-by tilt per character
    const targetTilts = new Map();
    characters.forEach(c => targetTilts.set(c, 0));

    for (let i = 0; i < characters.length; i++) {
      for (let j = i + 1; j < characters.length; j++) {
        const a = characters[i];
        const b = characters[j];

        if (!a.isLoaded || !b.isLoaded) continue;
        if (a.isDragging || b.isDragging) continue;
        if (a.state === 'HELD_AIRBORNE' || b.state === 'HELD_AIRBORNE') continue;

        const dx = Math.abs(a.position.x - b.position.x);
        const dz = Math.abs(a.position.z - b.position.z);

        if (dx < proximityThreshold) {
          // 1. Dynamic Z-Collision Avoidance: Characters must NEVER run or stand along the same Z layer!
          const minZSep = 0.20; // Minimum 0.20 units of depth separation between passing characters
          if (dz < minZSep) {
            const zOverlap = minZSep - dz;
            // Deterministic push direction: push foreground one forward, background one backward
            const zDiff = a.position.z - b.position.z;
            const zSign = Math.abs(zDiff) > 0.005 ? Math.sign(zDiff) : (a.getIndex() > b.getIndex() ? 1 : -1);
            const zNudge = zSign * zOverlap * 0.5;

            // Nudge targetLaneZ so both characters steer smoothly into separate depth layers
            if (a.passingSteer) a.passingSteer.targetLaneZ = THREE.MathUtils.clamp(a.passingSteer.targetLaneZ + zNudge * 1.5, -0.34, 0.38);
            if (b.passingSteer) b.passingSteer.targetLaneZ = THREE.MathUtils.clamp(b.passingSteer.targetLaneZ - zNudge * 1.5, -0.34, 0.38);

            // Immediate subtle displacement to guarantee zero depth collision
            a.position.z += zNudge * Math.min(1.0, delta * 8.0);
            b.position.z -= zNudge * Math.min(1.0, delta * 8.0);
          }

          // 2. Passing each other in close proximity: apply polite shoulder tilt
          // Intensity scales from 1.0 (dead close) down to 0.0 at threshold
          const intensity = 1.0 - (dx / proximityThreshold);

          // Tilt direction: character further to left tilts one way, character to right tilts opposite
          const tiltSign = a.position.x < b.position.x ? -1 : 1;
          const tiltAngle = tiltSign * 0.20 * intensity; // up to ~11.5 deg

          targetTilts.set(a, targetTilts.get(a) + tiltAngle);
          targetTilts.set(b, targetTilts.get(b) - tiltAngle);

          // Subtle ear twitch on pass-by (with debounce timer on character)
          const now = performance.now();
          if (!a._lastPassTwitch || now - a._lastPassTwitch > 2500) {
            a._lastPassTwitch = now;
            a.secondaryPhysics?.triggerAlert(0.5);
          }
          if (!b._lastPassTwitch || now - b._lastPassTwitch > 2500) {
            b._lastPassTwitch = now;
            b.secondaryPhysics?.triggerAlert(0.5);
          }
        }
      }
    }

    // Smoothly apply pass-by yaw tilt to model rotation
    characters.forEach(c => {
      if (!c.model) return;
      const targetTilt = targetTilts.get(c) || 0;
      if (!c._currentPassTilt) c._currentPassTilt = 0;
      c._currentPassTilt = THREE.MathUtils.lerp(c._currentPassTilt, targetTilt, Math.min(1.0, delta * 8.0));

      // Apply tilt additively to character model rotation around Y
      c.model.rotation.y = c._currentPassTilt;
    });
  }
}
