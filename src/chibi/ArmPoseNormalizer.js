import * as THREE from 'three';

/**
 * ArmPoseNormalizer
 * Maps arm and finger bone chains across Uma Musume / FBX skeletons
 * and applies procedural rest posture damping to eliminate horizontal "zombie" T/A-poses.
 */
export class ArmPoseNormalizer {
  constructor(model, bones = {}) {
    this.model = model;
    this.bones = {
      leftShoulder: null,
      rightShoulder: null,
      leftArm: null,
      rightArm: null,
      leftForeArm: null,
      rightForeArm: null,
      leftHand: null,
      rightHand: null,
    };
    this.fingerBones = {
      left: [],
      right: []
    };
    this.fingerChains = {
      left: { thumb: [], index: [], ring: [] },
      right: { thumb: [], index: [], ring: [] }
    };

    this.targetQuats = {
      leftArm: null,
      rightArm: null,
      leftForeArm: null,
      rightForeArm: null
    };

    this.initBoneMapping(bones);
  }

  initBoneMapping(existingBones = {}) {
    // 1. Direct assignment from existing registered bones if present
    if (existingBones['Shoulder_L']) this.bones.leftShoulder = existingBones['Shoulder_L'];
    if (existingBones['Shoulder_R']) this.bones.rightShoulder = existingBones['Shoulder_R'];
    if (existingBones['Arm_L']) this.bones.leftArm = existingBones['Arm_L'];
    if (existingBones['Arm_R']) this.bones.rightArm = existingBones['Arm_R'];
    if (existingBones['Elbow_L']) this.bones.leftForeArm = existingBones['Elbow_L'];
    if (existingBones['Elbow_R']) this.bones.rightForeArm = existingBones['Elbow_R'];
    if (existingBones['Wrist_L']) this.bones.leftHand = existingBones['Wrist_L'];
    if (existingBones['Wrist_R']) this.bones.rightHand = existingBones['Wrist_R'];

    // 2. Comprehensive traversal for finger and arm bone discovery
    if (this.model) {
      this.model.traverse((child) => {
        if (!child.isBone) return;
        const name = child.name;
        const lower = name.toLowerCase();

        // Arm bones fallback
        if (!this.bones.leftShoulder && (lower.includes('shoulder_l') || lower.includes('clavicle_l'))) this.bones.leftShoulder = child;
        if (!this.bones.rightShoulder && (lower.includes('shoulder_r') || lower.includes('clavicle_r'))) this.bones.rightShoulder = child;
        if (!this.bones.leftArm && (lower.includes('arm_l') || lower.includes('upperarm_l'))) this.bones.leftArm = child;
        if (!this.bones.rightArm && (lower.includes('arm_r') || lower.includes('upperarm_r'))) this.bones.rightArm = child;
        if (!this.bones.leftForeArm && (lower.includes('elbow_l') || lower.includes('forearm_l'))) this.bones.leftForeArm = child;
        if (!this.bones.rightForeArm && (lower.includes('elbow_r') || lower.includes('forearm_r'))) this.bones.rightForeArm = child;
        if (!this.bones.leftHand && (lower.includes('wrist_l') || lower.includes('hand_l'))) this.bones.leftHand = child;
        if (!this.bones.rightHand && (lower.includes('wrist_r') || lower.includes('hand_r'))) this.bones.rightHand = child;

        // Skip non-deforming terminal leaf markers (_end)
        if (lower.endsWith('_end') || lower.endsWith('end')) return;

        // Finger bone chains (Thumb, Index, Ring/Pinky/Middle)
        const isFinger = lower.includes('thumb') || lower.includes('index') || lower.includes('ring') ||
                         lower.includes('mid') || lower.includes('pinky') || lower.includes('finger');

        if (isFinger) {
          if (!child.userData.restRotation) {
            child.userData.restRotation = child.rotation.clone();
          }
          if (!child.userData.restQuaternion) {
            child.userData.restQuaternion = child.quaternion.clone();
          }

          const isLeft = lower.endsWith('_l') || lower.includes('left') || lower.includes('_l_');
          const isRight = lower.endsWith('_r') || lower.includes('right') || lower.includes('_r_');

          if (isLeft) {
            this.fingerBones.left.push(child);
            if (lower.includes('thumb')) this.fingerChains.left.thumb.push(child);
            else if (lower.includes('index')) this.fingerChains.left.index.push(child);
            else this.fingerChains.left.ring.push(child);
          } else if (isRight) {
            this.fingerBones.right.push(child);
            if (lower.includes('thumb')) this.fingerChains.right.thumb.push(child);
            else if (lower.includes('index')) this.fingerChains.right.index.push(child);
            else this.fingerChains.right.ring.push(child);
          }
        }
      });
    }

    // Cache initial arm quaternions for reliable blending
    [this.bones.leftArm, this.bones.rightArm, this.bones.leftForeArm, this.bones.rightForeArm].forEach(bone => {
      if (bone && !bone.userData.restQuaternion) {
        bone.userData.restQuaternion = bone.quaternion.clone();
      }
    });

    // 3. Initialize hand basis vectors directly from skeleton finger & thumb geometry
    this._initHandBases();

    // 4. Compute universal target rest quaternions in bone local space
    this._computeTargetRestQuats();
  }

  _initHandBases() {
    const setupWrist = (wristBone, isRight) => {
      if (!wristBone) return null;
      let indexBone = null;
      let thumbBone = null;
      wristBone.traverse(c => {
        if (!c.isBone || c === wristBone) return;
        const lower = c.name.toLowerCase();
        if (!indexBone && (lower.includes('index') || lower.includes('finger'))) indexBone = c;
        if (!thumbBone && lower.includes('thumb')) thumbBone = c;
      });

      if (indexBone && thumbBone) {
        const toIndexLocal = indexBone.position.clone().normalize();
        const toThumbLocal = thumbBone.position.clone().normalize();
        const palmNormalLocal = isRight
          ? new THREE.Vector3().crossVectors(toThumbLocal, toIndexLocal).normalize()
          : new THREE.Vector3().crossVectors(toIndexLocal, toThumbLocal).normalize();
        const handXLocal = new THREE.Vector3().crossVectors(toIndexLocal, palmNormalLocal).normalize();

        const mLocal = new THREE.Matrix4().makeBasis(handXLocal, toIndexLocal, palmNormalLocal);
        return {
          invBasis: mLocal.clone().invert(),
          palmNormalLocal,
          toIndexLocal,
          handXLocal
        };
      }
      return null;
    };

    this.wristDataR = setupWrist(this.bones.rightHand, true);
    this.wristDataL = setupWrist(this.bones.leftHand, false);
  }

  _computeTargetRestQuats() {
    if (!this.model) return;
    this.model.updateMatrixWorld(true);

    const orientBone = (bone, childBone, targetDirWorld) => {
      if (!bone || !childBone || !bone.parent) return null;
      const bWorld = new THREE.Vector3(); bone.getWorldPosition(bWorld);
      const cWorld = new THREE.Vector3(); childBone.getWorldPosition(cWorld);
      const currentDirWorld = cWorld.sub(bWorld).normalize();
      const worldRot = new THREE.Quaternion().setFromUnitVectors(currentDirWorld, targetDirWorld);

      const parentWorldQuat = new THREE.Quaternion();
      bone.parent.getWorldQuaternion(parentWorldQuat);
      const parentInv = parentWorldQuat.clone().invert();

      const boneWorldQuat = new THREE.Quaternion();
      bone.getWorldQuaternion(boneWorldQuat);
      const targetWorldQuat = worldRot.multiply(boneWorldQuat);
      return parentInv.multiply(targetWorldQuat);
    };

    // Upper arms: relaxed down ~70 deg, slightly forward ~15 deg, slightly outward at hips
    // Left arm is on character's +X side; Right arm is on character's -X side
    const targetUpperDirL = new THREE.Vector3(0.08, -0.96, 0.22).normalize();
    const targetUpperDirR = new THREE.Vector3(-0.08, -0.96, 0.22).normalize();

    this.targetQuats.leftArm = orientBone(this.bones.leftArm, this.bones.leftForeArm, targetUpperDirL);
    this.targetQuats.rightArm = orientBone(this.bones.rightArm, this.bones.rightForeArm, targetUpperDirR);

    // Temporarily apply upper arm orientations to evaluate forearm target
    const origQuatL = this.bones.leftArm?.quaternion.clone();
    const origQuatR = this.bones.rightArm?.quaternion.clone();

    if (this.bones.leftArm && this.targetQuats.leftArm) this.bones.leftArm.quaternion.copy(this.targetQuats.leftArm);
    if (this.bones.rightArm && this.targetQuats.rightArm) this.bones.rightArm.quaternion.copy(this.targetQuats.rightArm);
    this.model.updateMatrixWorld(true);

    // Forearms: flexed forward ~25 deg
    const targetForearmDirL = new THREE.Vector3(0.05, -0.85, 0.52).normalize();
    const targetForearmDirR = new THREE.Vector3(-0.05, -0.85, 0.52).normalize();

    this.targetQuats.leftForeArm = orientBone(this.bones.leftForeArm, this.bones.leftHand, targetForearmDirL);
    this.targetQuats.rightForeArm = orientBone(this.bones.rightForeArm, this.bones.rightHand, targetForearmDirR);

    // Restore original quaternions
    if (this.bones.leftArm && origQuatL) this.bones.leftArm.quaternion.copy(origQuatL);
    if (this.bones.rightArm && origQuatR) this.bones.rightArm.quaternion.copy(origQuatR);
    this.model.updateMatrixWorld(true);
  }

  /**
   * Force-relax arms downward during idle or low-influence states.
   * Relaxes upper arms down ~70 deg, slightly forward ~15 deg, and forearms bent ~25 deg.
   * @param {number} blendWeight - 0.0 (no override) to 1.0 (full relaxed rest posture)
   */
  applyRelaxedRestPose(blendWeight = 1.0) {
    if (blendWeight <= 0.001) return;
    if (this.bones.leftArm && this.targetQuats.leftArm) {
      this.bones.leftArm.quaternion.slerp(this.targetQuats.leftArm, blendWeight);
    }
    if (this.bones.rightArm && this.targetQuats.rightArm) {
      this.bones.rightArm.quaternion.slerp(this.targetQuats.rightArm, blendWeight);
    }
    if (this.bones.leftForeArm && this.targetQuats.leftForeArm) {
      this.bones.leftForeArm.quaternion.slerp(this.targetQuats.leftForeArm, blendWeight);
    }
    if (this.bones.rightForeArm && this.targetQuats.rightForeArm) {
      this.bones.rightForeArm.quaternion.slerp(this.targetQuats.rightForeArm, blendWeight);
    }
  }

  /**
   * Apply natural waving posture:
   * Left arm relaxed at side.
   * Right arm raised up with forearm bent towards sky, and wrist oriented so palm faces
   * dead-center forward (+Z) directly at the user, oscillating cheerfully side-to-side.
   */
  applyWavePose(t) {
    if (!this.model) return;
    this.model.updateMatrixWorld(true);

    const b = this.bones;
    if (!b.leftArm || !b.rightArm || !b.rightForeArm || !b.rightHand) return;

    const modelQuat = new THREE.Quaternion();
    this.model.getWorldQuaternion(modelQuat);

    const orientBone = (bone, childBone, targetDirWorld) => {
      if (!bone || !childBone || !bone.parent) return;
      const bWorld = new THREE.Vector3(); bone.getWorldPosition(bWorld);
      const cWorld = new THREE.Vector3(); childBone.getWorldPosition(cWorld);
      const currentDirWorld = cWorld.sub(bWorld).normalize();
      const worldRot = new THREE.Quaternion().setFromUnitVectors(currentDirWorld, targetDirWorld);

      const parentWorldQuat = new THREE.Quaternion();
      bone.parent.getWorldQuaternion(parentWorldQuat);
      const parentInv = parentWorldQuat.clone().invert();

      const boneWorldQuat = new THREE.Quaternion();
      bone.getWorldQuaternion(boneWorldQuat);
      const targetWorldQuat = worldRot.multiply(boneWorldQuat);
      bone.quaternion.copy(parentInv.multiply(targetWorldQuat));
    };

    // 1. Keep left arm relaxed at side (+X side of character, hanging naturally along hip)
    const leftArmDownDir = new THREE.Vector3(0.08, -0.96, 0.22).applyQuaternion(modelQuat).normalize();
    const leftForearmDownDir = new THREE.Vector3(0.05, -0.85, 0.52).applyQuaternion(modelQuat).normalize();

    orientBone(b.leftArm, b.leftForeArm, leftArmDownDir);
    this.model.updateMatrixWorld(true);
    orientBone(b.leftForeArm, b.leftHand, leftForearmDownDir);
    this.model.updateMatrixWorld(true);

    // 2. Right Arm waving: Upper arm reaches outward (-X), upward (+Y), and forward (+Z) in front of hair
    const waveArmWorldDir = new THREE.Vector3(-0.52, 0.42, 0.75).applyQuaternion(modelQuat).normalize();
    orientBone(b.rightArm, b.rightForeArm, waveArmWorldDir);
    this.model.updateMatrixWorld(true);

    // Forearm reaches up (+Y), forward (+Z), and outward (-X) beside cheek in front of hair lock
    const waveElbowWorldDir = new THREE.Vector3(-0.20, 0.60, 0.77).applyQuaternion(modelQuat).normalize();
    orientBone(b.rightForeArm, b.rightHand, waveElbowWorldDir);
    this.model.updateMatrixWorld(true);

    // 3. Orient right wrist so palm faces forward (+Z) directly at viewer, fingers pointing up
    if (this.wristDataR && this.wristDataR.invBasis) {
      // Cheerful energetic side-to-side hand flap
      const waveFlap = Math.sin(t * 11.0) * 0.32;
      const waveRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, waveFlap, 'XYZ'));

      // Palm faces forward (+Z) toward viewer, fingers point UP in front/beside face
      const targetPalmWorld = new THREE.Vector3(0, -0.15, 0.98).normalize().applyQuaternion(modelQuat).applyQuaternion(waveRot);
      const targetFingersWorld = new THREE.Vector3(0, 0.98, 0.15).normalize().applyQuaternion(modelQuat).applyQuaternion(waveRot);
      const targetXWorld = new THREE.Vector3().crossVectors(targetFingersWorld, targetPalmWorld).normalize();

      const mTarget = new THREE.Matrix4().makeBasis(targetXWorld, targetFingersWorld, targetPalmWorld);
      const rWristWorldMatrix = new THREE.Matrix4().multiplyMatrices(mTarget, this.wristDataR.invBasis);
      const rWristWorld = new THREE.Quaternion().setFromRotationMatrix(rWristWorldMatrix);

      const wristParentInv = b.rightHand.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      b.rightHand.quaternion.copy(wristParentInv.multiply(rWristWorld));
    }
  }
}
