import * as THREE from 'three';

/**
 * ProceduralArmSwing
 * Generates natural counter-phase arm swings during walking and sprinting,
 * preventing static arms and incorporating personality-driven locomotion dynamics.
 */
export class ProceduralArmSwing {
  constructor(armNormalizer, characterConfig = {}) {
    this.normalizer = armNormalizer;
    this.config = characterConfig;
    this.swingPhase = Math.random() * Math.PI * 2;
    this.style = characterConfig.personalityArmStyle || 'BOUNCY';
  }

  update(velocity, dt, currentState = 'WALK', animTime = null) {
    const speed = velocity ? (Math.abs(velocity.x) || velocity.length?.() || 0) : 0;
    const isLocomotion = (currentState === 'WALK' || currentState === 'walk' ||
                          currentState === 'TROT' ||
                          currentState === 'SPRINT' || currentState === 'run');

    if (speed < 0.05 && !isLocomotion) {
      return;
    }

    // Rate of swing advances with locomotion speed
    const isSprint = (currentState === 'SPRINT' || currentState === 'run');
    const isTrot = (currentState === 'TROT');
    const phaseRate = isSprint ? 15.0 : (isTrot ? 10.0 : 7.0);

    this.swingPhase += dt * phaseRate;

    // Smooth speed scaling (so stopping/starting doesn't jerk)
    const speedScale = Math.min(1.0, Math.max(0.35, speed / 0.8));

    // Determine personality-based swing amplitude & character traits
    let amp = 0.45;
    let elbowFlex = 0.35;
    let lateralSway = 0.0;

    switch (this.style) {
      case 'AERODYNAMIC': // Silence Suzuka: tight aerodynamic tuck close to hips
        amp = (isSprint ? 0.50 : 0.32) * speedScale;
        elbowFlex = 0.50;
        lateralSway = 0.01;
        break;

      case 'GYARU': // Daitaku Helios: high-energy bouncy stride with pumped elbows
        amp = (isSprint ? 0.70 : 0.55) * speedScale;
        elbowFlex = 0.60;
        lateralSway = Math.sin(this.swingPhase * 0.5) * 0.08;
        break;

      case 'STEADY': // Oguri Cap: firm, rhythmic, determined strides
        amp = (isSprint ? 0.52 : 0.42) * speedScale;
        elbowFlex = 0.40;
        lateralSway = 0.02;
        break;

      case 'WOBBLY': // Matikane Tannhauser (Mambo): cute wobbly stride
        amp = (isSprint ? 0.52 : 0.40) * speedScale;
        elbowFlex = 0.35;
        lateralSway = Math.sin(this.swingPhase * 0.5) * 0.12;
        break;

      case 'BOUNCY': // Special Week: lively energetic arm swing
      default:
        amp = (isSprint ? 0.60 : 0.46) * speedScale;
        elbowFlex = 0.42;
        lateralSway = Math.sin(this.swingPhase) * 0.04;
        break;
    }

    // Counter-phase oscillation (Left & Right 180 degrees / PI out of phase)
    // Left leg forward -> Left arm swings backward (-swing)
    // Right leg forward -> Right arm swings forward (+swing)
    const swingL = -Math.sin(this.swingPhase) * amp;
    const swingR = Math.sin(this.swingPhase) * amp;

    const b = this.normalizer.bones;
    const targets = this.normalizer.targetQuats;

    // Reset to resting baseline orientation
    if (targets.leftArm && b.leftArm) b.leftArm.quaternion.copy(targets.leftArm);
    if (targets.rightArm && b.rightArm) b.rightArm.quaternion.copy(targets.rightArm);
    if (targets.leftForeArm && b.leftForeArm) b.leftForeArm.quaternion.copy(targets.leftForeArm);
    if (targets.rightForeArm && b.rightForeArm) b.rightForeArm.quaternion.copy(targets.rightForeArm);

    // Apply procedural forward/backward swing around world pitch axis
    if (b.leftArm && b.leftArm.parent) {
      const parentInv = b.leftArm.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      const curWorld = b.leftArm.getWorldQuaternion(new THREE.Quaternion());
      const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -swingL);
      b.leftArm.quaternion.copy(parentInv.multiply(pitch.multiply(curWorld)));
    }
    if (b.rightArm && b.rightArm.parent) {
      const parentInv = b.rightArm.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      const curWorld = b.rightArm.getWorldQuaternion(new THREE.Quaternion());
      const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -swingR);
      b.rightArm.quaternion.copy(parentInv.multiply(pitch.multiply(curWorld)));
    }

    // Dynamic elbow flexion on forward stroke
    if (b.leftForeArm && b.leftForeArm.parent) {
      const flex = Math.max(0, swingL) * elbowFlex;
      const parentInv = b.leftForeArm.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      const curWorld = b.leftForeArm.getWorldQuaternion(new THREE.Quaternion());
      const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -flex);
      b.leftForeArm.quaternion.copy(parentInv.multiply(pitch.multiply(curWorld)));
    }
    if (b.rightForeArm && b.rightForeArm.parent) {
      const flex = Math.max(0, swingR) * elbowFlex;
      const parentInv = b.rightForeArm.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      const curWorld = b.rightForeArm.getWorldQuaternion(new THREE.Quaternion());
      const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -flex);
      b.rightForeArm.quaternion.copy(parentInv.multiply(pitch.multiply(curWorld)));
    }
  }
}
