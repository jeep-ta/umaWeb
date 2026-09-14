import * as THREE from 'three';

/**
 * SecondaryPhysics: Procedural Spring-Damper & Verlet Integration
 * Drives natural secondary motion on Uma Musume ear and tail bones.
 */
export class SecondaryPhysics {
  constructor(character) {
    this.character = character;
    this.bones = character.bones;

    // Ear spring state (Euler angle offsets from rest rotation)
    this.earOffsetL = new THREE.Vector3(0, 0, 0);
    this.earOffsetR = new THREE.Vector3(0, 0, 0);
    this.earVelL = new THREE.Vector3(0, 0, 0);
    this.earVelR = new THREE.Vector3(0, 0, 0);

    // Tail spring state
    this.tailOffset = new THREE.Vector3(0, 0, 0);
    this.tailVel = new THREE.Vector3(0, 0, 0);

    // Micro-twitch timer (Poisson intervals 3s - 8s)
    this.twitchTimer = 3.0 + Math.random() * 5.0;
    this.twitchDuration = 0;
    this.activeTwitchSide = 'both';

    // Alert reaction timer
    this.alertTimer = 0;

    // Physics parameters
    this.earStiffness = 180.0;
    this.earDamping = 12.0;
    this.tailStiffness = 120.0;
    this.tailDamping = 9.0;
  }

  triggerAlert(duration = 1.2) {
    this.alertTimer = Math.max(this.alertTimer, duration);
    // Instant perked impulse
    this.earVelL.x += 1.8;
    this.earVelR.x += 1.8;
    this.earVelL.z -= 0.6;
    this.earVelR.z += 0.6;
  }

  triggerEarTwitch(side = null) {
    this.activeTwitchSide = side || (Math.random() < 0.4 ? 'L' : Math.random() < 0.7 ? 'R' : 'both');
    this.twitchDuration = 0.35;
    const impulse = (Math.random() > 0.5 ? 1 : -1) * (1.6 + Math.random() * 0.8);
    if (this.activeTwitchSide === 'L' || this.activeTwitchSide === 'both') {
      this.earVelL.z += impulse;
      this.earVelL.x += Math.random() * 1.2;
    }
    if (this.activeTwitchSide === 'R' || this.activeTwitchSide === 'both') {
      this.earVelR.z -= impulse;
      this.earVelR.x += Math.random() * 1.2;
    }
  }

  update(dt, velocity, state) {
    // Clamp delta time to avoid instability on frame drops
    const subDt = Math.min(dt, 0.05);

    // 1. Update Micro-Twitches during idle states
    this.twitchTimer -= subDt;
    if (this.twitchTimer <= 0) {
      if (state.startsWith('IDLE') || state === 'idle') {
        this.triggerEarTwitch();
      }
      this.twitchTimer = 3.0 + Math.random() * 5.0;
    }

    if (this.alertTimer > 0) {
      this.alertTimer -= subDt;
    }

    // 2. Ear Target Offsets based on Character State & Velocity
    const earTargetL = new THREE.Vector3(0, 0, 0);
    const earTargetR = new THREE.Vector3(0, 0, 0);

    // Directional drag from movement velocity: \theta_target = \theta_base - \alpha * v_char
    const facing = this.character.facingDirection || 1;
    const horizSpeed = (velocity.x || 0);
    const vertSpeed = (velocity.y || 0);

    // Aerodynamic lag: ears push back when moving fast
    const speedMagnitude = Math.abs(horizSpeed);
    const velDragPitch = -speedMagnitude * 0.04;
    const vertDragPitch = -vertSpeed * 0.03;

    earTargetL.x += velDragPitch + vertDragPitch;
    earTargetR.x += velDragPitch + vertDragPitch;

    // Lateral ear sway
    const latSway = horizSpeed * facing * -0.02;
    earTargetL.z += latSway;
    earTargetR.z += latSway;

    // State-specific ear poses
    if (state === 'SPRINT' || state === 'run') {
      // Pin ears back aerodynamically: rotateX(-25 deg = -0.436 rad)
      const pinBackAngle = -0.45;
      earTargetL.x += pinBackAngle;
      earTargetR.x += pinBackAngle;
      earTargetL.z += -0.15;
      earTargetR.z += 0.15;
    } else if (state === 'TROT') {
      // Slight bouncy back-and-forth rhythm
      const trotWiggle = Math.sin(this.character.animTime * 14) * 0.12;
      earTargetL.x += trotWiggle - 0.1;
      earTargetR.x += -trotWiggle - 0.1;
    } else if (state === 'SNOOZE' || state === 'sleeping') {
      // Droopy relaxed ears
      earTargetL.x += -0.28;
      earTargetR.x += -0.28;
      earTargetL.z += 0.22;
      earTargetR.z += -0.22;
    } else if (this.alertTimer > 0) {
      // Perked upright alert ears
      earTargetL.x += 0.35;
      earTargetR.x += 0.35;
      earTargetL.z += -0.1;
      earTargetR.z += 0.1;
    } else if (state === 'HELD_AIRBORNE' || state === 'dragged') {
      // Flustered upright twitches
      earTargetL.x += 0.2 + Math.sin(this.character.animTime * 20) * 0.15;
      earTargetR.x += 0.2 + Math.cos(this.character.animTime * 20) * 0.15;
    }

    // Spring-damper integration for Left Ear: F = -k*(x - target) - c*v
    const fLx = -this.earStiffness * (this.earOffsetL.x - earTargetL.x) - this.earDamping * this.earVelL.x;
    const fLy = -this.earStiffness * (this.earOffsetL.y - earTargetL.y) - this.earDamping * this.earVelL.y;
    const fLz = -this.earStiffness * (this.earOffsetL.z - earTargetL.z) - this.earDamping * this.earVelL.z;
    this.earVelL.x += fLx * subDt;
    this.earVelL.y += fLy * subDt;
    this.earVelL.z += fLz * subDt;
    this.earOffsetL.addScaledVector(this.earVelL, subDt);

    // Spring-damper integration for Right Ear
    const fRx = -this.earStiffness * (this.earOffsetR.x - earTargetR.x) - this.earDamping * this.earVelR.x;
    const fRy = -this.earStiffness * (this.earOffsetR.y - earTargetR.y) - this.earDamping * this.earVelR.y;
    const fRz = -this.earStiffness * (this.earOffsetR.z - earTargetR.z) - this.earDamping * this.earVelR.z;
    this.earVelR.x += fRx * subDt;
    this.earVelR.y += fRy * subDt;
    this.earVelR.z += fRz * subDt;
    this.earOffsetR.addScaledVector(this.earVelR, subDt);

    // Apply to Left Ear Bone
    const earBoneL = this.bones['Ear_01_L'];
    if (earBoneL) {
      const rest = earBoneL.userData.restRotation || earBoneL.rotation;
      earBoneL.rotation.set(
        rest.x + this.earOffsetL.x,
        rest.y + this.earOffsetL.y,
        rest.z + this.earOffsetL.z
      );
    }

    // Apply to Right Ear Bone
    const earBoneR = this.bones['Ear_01_R'];
    if (earBoneR) {
      const rest = earBoneR.userData.restRotation || earBoneR.rotation;
      earBoneR.rotation.set(
        rest.x + this.earOffsetR.x,
        rest.y + this.earOffsetR.y,
        rest.z + this.earOffsetR.z
      );
    }

    // 3. Tail Physics & Pendulum Sway
    const tailTarget = new THREE.Vector3(0, 0, 0);
    const t = this.character.animTime;

    if (state === 'SPRINT' || state === 'run') {
      // High-frequency aerodynamic trailing wag
      tailTarget.x = 0.5 + Math.sin(t * 16) * 0.15; // Lifted up behind
      tailTarget.y = Math.sin(t * 14) * 0.45;
      tailTarget.z = Math.cos(t * 14) * 0.3;
    } else if (state === 'TROT') {
      // Perky bouncy wag
      tailTarget.x = 0.25 + Math.sin(t * 12) * 0.2;
      tailTarget.y = Math.sin(t * 10) * 0.5;
    } else if (state === 'WALK' || state === 'walk') {
      // Relaxed pendulum wag matching walk cycle
      tailTarget.x = 0.05 + Math.sin(t * 7) * 0.1;
      tailTarget.y = Math.sin(t * 6) * 0.35;
    } else if (state === 'SNOOZE' || state === 'sleeping') {
      // Curled around legs, slow gentle curl
      tailTarget.x = -0.3 + Math.sin(t * 2) * 0.06;
      tailTarget.y = 0.4;
    } else if (state === 'HELD_AIRBORNE' || state === 'dragged') {
      // Frantic whipping wag
      tailTarget.x = 0.2 + Math.sin(t * 22) * 0.3;
      tailTarget.y = Math.cos(t * 22) * 0.6;
    } else if (state === 'DRIFT_STOP') {
      // Whipped forward by sudden braking
      tailTarget.x = -0.4;
      tailTarget.y = Math.sin(t * 15) * 0.3;
    } else {
      // Gentle idle swishes
      tailTarget.x = Math.sin(t * 2.5) * 0.08;
      tailTarget.y = Math.sin(t * 3.0) * 0.25;
    }

    // Tail inertial lag from character acceleration
    tailTarget.x += -vertSpeed * 0.04;
    tailTarget.y += -horizSpeed * 0.04;

    // Spring-damper for tail
    const fTx = -this.tailStiffness * (this.tailOffset.x - tailTarget.x) - this.tailDamping * this.tailVel.x;
    const fTy = -this.tailStiffness * (this.tailOffset.y - tailTarget.y) - this.tailDamping * this.tailVel.y;
    const fTz = -this.tailStiffness * (this.tailOffset.z - tailTarget.z) - this.tailDamping * this.tailVel.z;
    this.tailVel.x += fTx * subDt;
    this.tailVel.y += fTy * subDt;
    this.tailVel.z += fTz * subDt;
    this.tailOffset.addScaledVector(this.tailVel, subDt);

    const tailBone = this.bones['Tail_Ctrl'];
    if (tailBone) {
      const rest = tailBone.userData.restRotation || tailBone.rotation;
      tailBone.rotation.set(
        rest.x + this.tailOffset.x,
        rest.y + this.tailOffset.y,
        rest.z + this.tailOffset.z
      );
    }
  }
}
