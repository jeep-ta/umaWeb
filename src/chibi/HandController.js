import * as THREE from 'three';

/**
 * HAND_POSES
 * Expressive finger curvature definitions for anime chibi hands.
 * Angles in radians applied additively relative to the bone's rest binding rotation.
 */
export const HAND_POSES = {
  RELAXED_CUP: {
    // Natural gentle cup with relaxed curve
    indexCurl: -0.32,
    ringCurl: -0.42,
    thumbCurl: -0.25,
    indexSpread: 0.05,
    ringSpread: -0.05,
    thumbSpread: 0.15
  },
  FIST: {
    // Solid clench with thumb folded over fingers
    indexCurl: -1.15,
    ringCurl: -1.35,
    thumbCurl: -0.85,
    indexSpread: 0.0,
    ringSpread: 0.0,
    thumbSpread: -0.2
  },
  PEACE_V: {
    // Classic anime V-sign / Poji-pisu: Index pointed outward, other fingers curled
    indexCurl: -0.02,   // Straight
    ringCurl: -1.45,   // Curled into palm
    thumbCurl: -1.1,   // Tucked over ring
    indexSpread: 0.18, // Spread outward
    ringSpread: -0.08,
    thumbSpread: -0.15
  },
  CLAW_EXCITED: {
    // Energetic hooked claw gesture
    indexCurl: -0.65,
    ringCurl: -0.75,
    thumbCurl: -0.45,
    indexSpread: 0.22,
    ringSpread: -0.22,
    thumbSpread: 0.35
  },
  HOLD_CARROT: {
    // Cylindrical grip wrapping around snack prop
    indexCurl: -0.80,
    ringCurl: -0.92,
    thumbCurl: -0.75,
    indexSpread: 0.08,
    ringSpread: -0.08,
    thumbSpread: 0.28
  },
  OPEN_PALM: {
    // Open greeting hand with fingers extended and separated for waving
    indexCurl: -0.05,
    ringCurl: -0.08,
    thumbCurl: -0.10,
    indexSpread: 0.15,
    ringSpread: -0.15,
    thumbSpread: 0.30
  }
};

export class HandController {
  constructor(armNormalizer, characterConfig = {}) {
    this.normalizer = armNormalizer;
    this.config = characterConfig;

    // Default pose from personality or relaxed cup
    const initialPose = characterConfig.defaultHandPose || 'RELAXED_CUP';
    this.leftPose = initialPose;
    this.rightPose = initialPose;

    this.animTime = Math.random() * 10.0;
  }

  setHandPose(poseName, side = 'both') {
    if (!HAND_POSES[poseName]) return;
    if (side === 'left' || side === 'both') this.leftPose = poseName;
    if (side === 'right' || side === 'both') this.rightPose = poseName;
  }

  setLeftPose(poseName) {
    this.setHandPose(poseName, 'left');
  }

  setRightPose(poseName) {
    this.setHandPose(poseName, 'right');
  }

  update(dt) {
    this.animTime += dt;
    const microJiggle = Math.sin(this.animTime * 3.2) * 0.015;

    this._applyHandPoseToSide('left', this.leftPose, microJiggle, dt);
    this._applyHandPoseToSide('right', this.rightPose, -microJiggle, dt);
  }

  _applyHandPoseToSide(side, poseName, microJiggle, dt) {
    const config = HAND_POSES[poseName] || HAND_POSES.RELAXED_CUP;
    const chains = this.normalizer.fingerChains[side];
    if (!chains) return;

    const isLeft = side === 'left';
    const sideMultiplier = isLeft ? 1 : -1;

    // 1. Index Finger Chain
    if (chains.index && chains.index.length > 0) {
      chains.index.forEach((bone, idx) => {
        const rest = bone.userData.restRotation;
        if (!rest) return;

        // Base knuckle has curl + spread; distal joint has primarily curl
        const curl = config.indexCurl * (idx === 0 ? 0.85 : 1.15) + microJiggle;
        const spread = (idx === 0 ? config.indexSpread * sideMultiplier : 0.0);

        const targetEuler = new THREE.Euler(
          rest.x + curl,
          rest.y,
          rest.z + spread,
          'XYZ'
        );
        const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);
        bone.quaternion.slerp(targetQuat, Math.min(1.0, dt * 10.0));
      });
    }

    // 2. Ring / Other Fingers Chain
    if (chains.ring && chains.ring.length > 0) {
      chains.ring.forEach((bone, idx) => {
        const rest = bone.userData.restRotation;
        if (!rest) return;

        const curl = config.ringCurl * (idx === 0 ? 0.85 : 1.15) + microJiggle;
        const spread = (idx === 0 ? config.ringSpread * sideMultiplier : 0.0);

        const targetEuler = new THREE.Euler(
          rest.x + curl,
          rest.y,
          rest.z + spread,
          'XYZ'
        );
        const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);
        bone.quaternion.slerp(targetQuat, Math.min(1.0, dt * 10.0));
      });
    }

    // 3. Thumb Chain
    if (chains.thumb && chains.thumb.length > 0) {
      chains.thumb.forEach((bone, idx) => {
        const rest = bone.userData.restRotation;
        if (!rest) return;

        const curl = config.thumbCurl * (idx === 0 ? 0.7 : 1.2) + microJiggle * 0.5;
        const fold = (idx === 0 ? config.thumbSpread * sideMultiplier : 0.0);

        const targetEuler = new THREE.Euler(
          rest.x + curl,
          rest.y,
          rest.z + fold,
          'XYZ'
        );
        const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);
        bone.quaternion.slerp(targetQuat, Math.min(1.0, dt * 10.0));
      });
    }
  }
}
