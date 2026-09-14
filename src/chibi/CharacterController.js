import * as THREE from 'three';

/**
 * CharacterController: Hierarchical Finite State Machine, Procedural Animation Blending,
 * Head IK Cursor Look-At, and Eye Blinking.
 */
export class CharacterController {
  constructor(character) {
    this.character = character;
    this.bones = character.bones;

    // FSM State Tracking
    this.currentState = 'IDLE_LOOK_AROUND';
    this.previousState = 'IDLE_LOOK_AROUND';
    this.stateTimer = 2.5 + Math.random() * 2.0;
    this.transitionTime = 0.25; // 0.25s crossfading
    this.transitionProgress = 1.0;

    // Blended Pose Buffers (relative to rest rotations)
    this.prevPose = this._createPoseBuffer();
    this.currentPose = this._createPoseBuffer();
    this.blendedPose = this._createPoseBuffer();

    // Procedural Eye Blinking
    this.blinkTimer = 2.5 + Math.random() * 3.5;
    this.blinkPhase = 'open'; // 'closing', 'opening', 'open'
    this.blinkProgress = 0;
    this.eyeMesh = null;
    this._findEyeMesh();

    // Head IK & Cursor Tracking
    this.cursorWorldPos = new THREE.Vector3(0, 0, 0);
    this.cursorLookYaw = 0;
    this.cursorLookPitch = 0;
    this.targetLookYaw = 0;
    this.targetLookPitch = 0;
    this.cursorAlert = false;
    this.alertTimer = 0;

    // Roosting / Surface
    this.currentPlatformY = 0;
    this.isRoosting = false;

    // Locomotion root tilt (e.g. forward lean in sprint, backward tilt in drift stop)
    this.rootTilt = 0;
    this.targetRootTilt = 0;
  }

  _createPoseBuffer() {
    return {
      armL: new THREE.Vector3(),
      armR: new THREE.Vector3(),
      elbowL: new THREE.Vector3(),
      elbowR: new THREE.Vector3(),
      wristL: new THREE.Vector3(),
      wristR: new THREE.Vector3(),
      thighL: new THREE.Vector3(),
      thighR: new THREE.Vector3(),
      kneeL: new THREE.Vector3(),
      kneeR: new THREE.Vector3(),
      ankleL: new THREE.Vector3(),
      ankleR: new THREE.Vector3(),
      spine: new THREE.Vector3(),
      waist: new THREE.Vector3(),
      head: new THREE.Vector3(),
      neck: new THREE.Vector3(),
      rootTilt: 0,
      rootOffsetY: 0
    };
  }

  _findEyeMesh() {
    if (!this.character.model) return;
    this.character.model.traverse((child) => {
      if (child.isMesh) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i];
          if (m && (m.name.toLowerCase().includes('eye') || i === 4)) {
            this.eyeMesh = child;
            break;
          }
        }
      }
    });
  }

  setState(newState, force = false) {
    if (this.currentState === newState && !force) return;

    // Snapshot current evaluated pose into previous buffer
    this._copyPose(this.blendedPose, this.prevPose);
    this.previousState = this.currentState;
    this.currentState = newState;
    this.transitionProgress = 0.0;

    // Trigger state-specific entry events
    if (newState === 'SPRINT') {
      this.character.manager?.particles?.spawnDust(this.character.screenX, this.character.screenY);
    } else if (newState === 'DRIFT_STOP') {
      this.character.manager?.particles?.spawnDust(this.character.screenX - 10, this.character.screenY);
      this.character.manager?.particles?.spawnDust(this.character.screenX + 10, this.character.screenY);
      this.stateTimer = 0.60; // Brake duration
    } else if (newState === 'RECOVER_PANT') {
      this.stateTimer = 2.0;
      this.character.squash.set(1.08, 0.92, 1.08);
    } else if (newState === 'RACE_VICTORY') {
      this.stateTimer = 3.5;
      this.character.squash.set(0.92, 1.12, 0.92);
    } else if (newState === 'LAND_RECOVERY') {
      this.stateTimer = 0.45;
      this.character.squash.set(1.25, 0.75, 1.25);
    }
  }

  _copyPose(src, dst) {
    dst.armL.copy(src.armL);
    dst.armR.copy(src.armR);
    dst.elbowL.copy(src.elbowL);
    dst.elbowR.copy(src.elbowR);
    dst.wristL.copy(src.wristL);
    dst.wristR.copy(src.wristR);
    dst.thighL.copy(src.thighL);
    dst.thighR.copy(src.thighR);
    dst.kneeL.copy(src.kneeL);
    dst.kneeR.copy(src.kneeR);
    dst.ankleL.copy(src.ankleL);
    dst.ankleR.copy(src.ankleR);
    dst.spine.copy(src.spine);
    dst.waist.copy(src.waist);
    dst.head.copy(src.head);
    dst.neck.copy(src.neck);
    dst.rootTilt = src.rootTilt;
    dst.rootOffsetY = src.rootOffsetY;
  }

  update(dt, cursorWorldPos, cursorSpeed) {
    const subDt = Math.min(dt, 0.05);
    const t = this.character.animTime;

    if (!this.eyeMesh) this._findEyeMesh();

    // 1. Update Transition Blending Progress
    if (this.transitionProgress < 1.0) {
      this.transitionProgress += subDt / this.transitionTime;
      if (this.transitionProgress > 1.0) this.transitionProgress = 1.0;
    }

    // 2. Cursor Alert Reaction (> 1500 px/s)
    if (cursorSpeed > 1500) {
      this.triggerAlert();
    }
    if (this.alertTimer > 0) {
      this.alertTimer -= subDt;
      if (this.alertTimer <= 0) {
        this.cursorAlert = false;
      }
    }

    // 3. Procedural Eye Blinking (Poisson distribution 2.5s - 6s)
    this._updateBlink(subDt);

    // 4. Head IK / Cursor Look-At Calculation
    this._updateHeadIK(subDt, cursorWorldPos);

    // 5. Evaluate Poses for Previous and Current States
    this._evaluateStatePose(this.previousState, t, this.prevPose);
    this._evaluateStatePose(this.currentState, t, this.currentPose);

    // 6. Crossfade / Slerp Blending between States
    const alpha = this._smoothstep(this.transitionProgress);
    this._blendPoses(this.prevPose, this.currentPose, alpha, this.blendedPose);

    // 7. Apply Blended Bone Transforms to 3D Skeletal Rig
    this._applyBlendedPoseToBones();
  }

  _smoothstep(x) {
    return x * x * (3 - 2 * x);
  }

  _updateBlink(dt) {
    this.blinkTimer -= dt;

    if (this.blinkPhase === 'open') {
      if (this.blinkTimer <= 0) {
        this.blinkPhase = 'closing';
        this.blinkProgress = 0;
      }
    } else if (this.blinkPhase === 'closing') {
      this.blinkProgress += dt / 0.06; // 60ms close
      if (this.blinkProgress >= 1.0) {
        this.blinkProgress = 1.0;
        this.blinkPhase = 'opening';
      }
    } else if (this.blinkPhase === 'opening') {
      this.blinkProgress -= dt / 0.12; // 120ms open
      if (this.blinkProgress <= 0.0) {
        this.blinkProgress = 0.0;
        this.blinkPhase = 'open';
        this.blinkTimer = 2.5 + Math.random() * 3.5;
      }
    }

  }

  triggerAlert(duration = 1.2) {
    this.cursorAlert = true;
    this.alertTimer = Math.max(this.alertTimer, duration);
    this.character.secondaryPhysics?.triggerAlert(duration);
  }

  _updateHeadIK(dt, cursorWorldPos) {
    if (!cursorWorldPos) return;
    this.cursorWorldPos.copy(cursorWorldPos);

    // When walking, trotting, sprinting sideways, sleeping, or held airborne:
    // Do NOT track cursor! Keep head facing the movement direction.
    const isLocomotion = (this.currentState === 'WALK' || this.currentState === 'walk' ||
                          this.currentState === 'TROT' ||
                          this.currentState === 'SPRINT' || this.currentState === 'run' ||
                          this.currentState === 'DRIFT_STOP');
    const isSideways = Math.abs(this.character.targetFacing) > 0.3;

    if (isLocomotion || isSideways || this.currentState === 'SNOOZE' || this.currentState === 'sleeping' || this.currentState === 'HELD_AIRBORNE') {
      this.targetLookYaw = 0;
      this.targetLookPitch = 0;
      this.cursorLookYaw += (0 - this.cursorLookYaw) * 12 * dt;
      this.cursorLookPitch += (0 - this.cursorLookPitch) * 12 * dt;
      return;
    }

    const headBone = this.bones['Head'];
    if (!headBone) return;

    // Vector from head to cursor in character's local group space
    const localCursor = this.character.group.worldToLocal(this.cursorWorldPos.clone());
    const headHeight = 0.52; // approximate head height above group origin

    const dx = localCursor.x;
    const dy = localCursor.y - headHeight;
    const dz = Math.max(0.6, localCursor.z + 1.2);

    // Yaw: look left/right (clamped to +/- 35 deg)
    const maxYaw = THREE.MathUtils.degToRad(35);
    let rawYaw = Math.atan2(dx, dz);

    // Pitch: look up/down
    // When dy > 0 (cursor above head): rawPitch < 0 -> look UP (clamped to -20 deg = -0.35 rad)
    // When dy < 0 (cursor below head): NEVER duck head into chest! Clamp to +0.03 rad max (+1.7 deg)
    let rawPitch = -Math.atan2(dy, dz);

    this.targetLookYaw = THREE.MathUtils.clamp(rawYaw, -maxYaw, maxYaw);
    this.targetLookPitch = THREE.MathUtils.clamp(rawPitch, -0.35, 0.03);

    // Smooth interpolation
    const lerpSpeed = this.cursorAlert ? 18.0 : 8.0;
    this.cursorLookYaw += (this.targetLookYaw - this.cursorLookYaw) * lerpSpeed * dt;
    this.cursorLookPitch += (this.targetLookPitch - this.cursorLookPitch) * lerpSpeed * dt;
  }

  _evaluateStatePose(state, t, out) {
    // Zero out buffers
    out.armL.set(0, 0, 0);
    out.armR.set(0, 0, 0);
    out.elbowL.set(0, 0, 0);
    out.elbowR.set(0, 0, 0);
    out.wristL.set(0, 0, 0);
    out.wristR.set(0, 0, 0);
    out.thighL.set(0, 0, 0);
    out.thighR.set(0, 0, 0);
    out.kneeL.set(0, 0, 0);
    out.kneeR.set(0, 0, 0);
    out.ankleL.set(0, 0, 0);
    out.ankleR.set(0, 0, 0);
    out.spine.set(0, 0, 0);
    out.waist.set(0, 0, 0);
    out.head.set(0, 0, 0);
    out.neck.set(0, 0, 0);
    out.rootTilt = 0;
    out.rootOffsetY = 0;

    switch (state) {
      case 'IDLE_LOOK_AROUND':
      case 'idle': {
        // Natural resting arms with soft 20 deg elbow bend
        const breath = Math.sin(t * 2.2) * 0.04;
        out.armL.set(-1.18 + breath, 0.05, -0.20);
        out.armR.set(-1.18 + breath, -0.05, 0.20);
        out.elbowL.set(0, 0, -0.38);
        out.elbowR.set(0, 0, 0.38);
        out.wristL.set(0, 0, 0);
        out.wristR.set(0, 0, 0);
        // Look around side to side
        const scan = Math.sin(t * 1.6) * 0.28;
        out.head.set(breath * 0.5, scan, breath * 0.3);
        out.spine.set(breath, scan * 0.25, 0);
        break;
      }

      case 'IDLE_STRETCH': {
        // Arms up high, spine arch, relaxed yawning stretch
        const stretchT = Math.sin(t * 3.0);
        out.armL.set(0, 0, -2.45 + stretchT * 0.08);
        out.armR.set(0, 0, 2.45 - stretchT * 0.08);
        out.elbowL.set(0.2, 0, 0);
        out.elbowR.set(0.2, 0, 0);
        out.spine.set(-0.22, 0, 0);
        out.head.set(-0.18, 0, 0);
        out.rootOffsetY = 0.04 * Math.max(0, stretchT);
        break;
      }

      case 'IDLE_EAR_TWITCH': {
        // Inquisitive head tilt and relaxed arms
        const twitchAngle = Math.sin(t * 8.0) * 0.18;
        out.armL.set(-1.18, 0.05, -0.20);
        out.armR.set(-1.18, -0.05, 0.20);
        out.elbowL.set(0, 0, -0.38);
        out.elbowR.set(0, 0, 0.38);
        out.head.set(0, 0, twitchAngle);
        break;
      }

      case 'SNOOZE':
      case 'sleeping': {
        // Relaxed sitting/curled pose with gentle rhythmic nod
        const sleepBreath = Math.sin(t * 1.4) * 0.04;
        out.thighL.set(1.2, 0, 0);
        out.thighR.set(1.2, 0, 0);
        out.kneeL.set(-1.45, 0, 0);
        out.kneeR.set(-1.45, 0, 0);
        out.ankleL.set(0.35, 0, 0);
        out.ankleR.set(0.35, 0, 0);
        out.armL.set(-1.10, 0.05, -0.15);
        out.armR.set(-1.10, -0.05, 0.15);
        out.elbowL.set(0, 0, -0.55);
        out.elbowR.set(0, 0, 0.55);
        out.head.set(0.04 + sleepBreath, 0, 0.1);
        out.spine.set(0.06 + sleepBreath * 0.3, 0, 0);
        out.rootOffsetY = -0.16;
        break;
      }

      case 'WALK':
      case 'walk': {
        const speed = 7.0;
        const cycle = Math.sin(t * speed);
        const cosCycle = Math.cos(t * speed);
        const swing = cycle * 0.55;

        out.thighL.set(swing, 0, 0);
        out.thighR.set(-swing, 0, 0);
        out.kneeL.set(Math.max(0, swing * 0.7), 0, 0);
        out.kneeR.set(Math.max(0, -swing * 0.7), 0, 0);
        out.ankleL.set(-swing * 0.2, 0, 0);
        out.ankleR.set(swing * 0.2, 0, 0);

        out.armL.set(0, 0, -1.18);
        out.armR.set(0, 0, 1.18);
        out.elbowL.set(0.38, 0, 0);
        out.elbowR.set(0.38, 0, 0);
        out.wristL.set(0, 0, 0);
        out.wristR.set(0, 0, 0);

        out.spine.set(0, cycle * 0.08, 0);
        out.head.set(0, 0, 0);
        out.rootOffsetY = Math.abs(cosCycle) * 0.02;
        break;
      }

      case 'TROT': {
        // High bouncy trot with animated vertical lift
        const speed = 10.0;
        const cycle = Math.sin(t * speed);
        const cosCycle = Math.cos(t * speed);
        const swing = cycle * 0.72;

        out.thighL.set(swing, 0, 0);
        out.thighR.set(-swing, 0, 0);
        out.kneeL.set(Math.max(0, swing * 1.1), 0, 0);
        out.kneeR.set(Math.max(0, -swing * 1.1), 0, 0);
        out.ankleL.set(-swing * 0.25, 0, 0);
        out.ankleR.set(swing * 0.25, 0, 0);

        out.armL.set(0, 0, -1.18);
        out.armR.set(0, 0, 1.18);
        out.elbowL.set(0.50, 0, 0);
        out.elbowR.set(0.50, 0, 0);
        out.wristL.set(0, 0, 0);
        out.wristR.set(0, 0, 0);

        out.spine.set(0.04, cycle * 0.12, 0);
        out.head.set(0, 0, 0);
        out.rootOffsetY = Math.abs(cosCycle) * 0.045; // Energetic bounce
        break;
      }

      case 'SPRINT':
      case 'run': {
        // High-speed burst with athletic pumping elbows and forward gaze
        const speed = 15.0;
        const cycle = Math.sin(t * speed);
        const cosCycle = Math.cos(t * speed);
        const swing = cycle * 1.05;

        out.rootTilt = 0;
        out.head.set(0, 0, 0); // Head upright looking forward

        out.thighL.set(swing, 0, 0);
        out.thighR.set(-swing, 0, 0);
        out.kneeL.set(Math.max(0, swing * 1.35), 0, 0);
        out.kneeR.set(Math.max(0, -swing * 1.35), 0, 0);
        out.ankleL.set(-swing * 0.35, 0, 0);
        out.ankleR.set(swing * 0.35, 0, 0);

        out.armL.set(0, 0, -1.22);
        out.armR.set(0, 0, 1.22);
        out.elbowL.set(0.70, 0, 0);
        out.elbowR.set(0.70, 0, 0);
        out.wristL.set(0, 0, 0);
        out.wristR.set(0, 0, 0);

        out.spine.set(0.04, cycle * 0.18, 0);
        out.rootOffsetY = Math.abs(cosCycle) * 0.055;
        break;
      }

      case 'DRIFT_STOP': {
        // Skidding overshoot braking pose
        out.rootTilt = 0;
        out.thighL.set(0.75, 0, 0);
        out.thighR.set(-0.45, 0, 0);
        out.kneeL.set(0.2, 0, 0);
        out.kneeR.set(0.55, 0, 0);
        out.armL.set(0, 0, -1.65);
        out.armR.set(0, 0, 1.65);
        out.elbowL.set(0.5, 0, 0);
        out.elbowR.set(0.5, 0, 0);
        out.spine.set(-0.05, 0, 0);
        out.head.set(0, 0, 0);
        out.rootOffsetY = -0.04;
        break;
      }

      case 'RECOVER_PANT': {
        // Leaning forward catching breath with rhythmic chest heave
        const breath = Math.sin(t * 8.5);
        const heave = breath * 0.04;
        out.rootTilt = 0;
        out.rootOffsetY = -0.06 + heave;

        // Feet planted shoulder-width
        out.thighL.set(0.42, 0, 0.1);
        out.thighR.set(0.42, 0, -0.1);
        out.kneeL.set(-0.55, 0, 0);
        out.kneeR.set(-0.55, 0, 0);

        // Hands resting on knees / thighs
        out.armL.set(0.35, 0, -0.45);
        out.armR.set(0.35, 0, 0.45);
        out.elbowL.set(1.15, 0, 0);
        out.elbowR.set(1.15, 0, 0);
        out.wristL.set(0, 0, 0);
        out.wristR.set(0, 0, 0);

        // Spine leaning forward with rhythmic panting heave
        out.spine.set(0.32 + heave * 0.8, 0, 0);
        out.head.set(-0.25 - heave * 0.5, 0, 0);
        break;
      }

      case 'RACE_VICTORY': {
        // Joyful victory celebration: V-arms, happy rhythmic bounce / hop
        const hop = Math.abs(Math.sin(t * 7.5)) * 0.09;
        out.rootTilt = Math.sin(t * 3.75) * 0.05;
        out.rootOffsetY = hop;

        // Legs doing cheerful bouncy hops
        const legFlex = Math.sin(t * 7.5);
        out.thighL.set(legFlex > 0 ? 0.35 : 0.05, 0, 0.08);
        out.thighR.set(legFlex <= 0 ? 0.35 : 0.05, 0, -0.08);
        out.kneeL.set(legFlex > 0 ? -0.45 : -0.1, 0, 0);
        out.kneeR.set(legFlex <= 0 ? -0.45 : -0.1, 0, 0);

        // Both arms raised high in triumphant victory V!
        out.armL.set(0, 0, -2.4 + Math.sin(t * 7.5) * 0.12);
        out.armR.set(0, 0, 2.4 - Math.sin(t * 7.5) * 0.12);
        out.elbowL.set(0.25, 0, 0);
        out.elbowR.set(0.25, 0, 0);
        out.wristL.set(0, 0, 0.2);
        out.wristR.set(0, 0, -0.2);

        out.spine.set(-0.06, 0, 0);
        out.head.set(0.12 + Math.sin(t * 7.5) * 0.06, 0, 0);
        break;
      }

      case 'HELD_AIRBORNE':
      case 'dragged': {
        // Frantic dangling bicycle kicks and flapping arms
        const kick = Math.sin(t * 18.0);
        out.armL.set(0, 0, -2.1 + kick * 0.4);
        out.armR.set(0, 0, 2.1 + kick * 0.4);
        out.elbowL.set(0.65 + Math.abs(kick) * 0.4, 0, 0);
        out.elbowR.set(0.65 + Math.abs(kick) * 0.4, 0, 0);
        out.wristL.set(0, 0, kick * 0.45);
        out.wristR.set(0, 0, -kick * 0.45);

        out.thighL.set(kick * 0.7, 0, 0);
        out.thighR.set(-kick * 0.7, 0, 0);
        out.kneeL.set(Math.max(0, kick * 0.9), 0, 0);
        out.kneeR.set(Math.max(0, -kick * 0.9), 0, 0);
        out.spine.set(0, 0, kick * 0.12);
        break;
      }

      case 'LAND_RECOVERY': {
        // Deep crouch impact absorption
        out.thighL.set(0.6, 0, 0);
        out.thighR.set(0.6, 0, 0);
        out.kneeL.set(-0.8, 0, 0);
        out.kneeR.set(-0.8, 0, 0);
        out.armL.set(0, 0, -1.4);
        out.armR.set(0, 0, 1.4);
        out.elbowL.set(0.7, 0, 0);
        out.elbowR.set(0.7, 0, 0);
        out.rootOffsetY = -0.08;
        break;
      }

      case 'WAVE':
      case 'wave': {
        // High raised right hand enthusiastically waving, left arm gently at side
        const waveMotion = Math.sin(t * 11.0);
        out.armR.set(0.35 + Math.sin(t * 3.0) * 0.05, 0.2, 0.45);
        out.elbowR.set(1.4, -0.2, -0.4);
        out.wristR.set(0, 0, waveMotion * 0.30);

        out.armL.set(-1.18, 0.05, -0.20);
        out.elbowL.set(0, 0, -0.38);
        out.wristL.set(0, 0, 0);
        out.head.set(0.02 + Math.sin(t * 4.0) * 0.03, Math.sin(t * 3.0) * 0.06, 0.12);
        break;
      }

      case 'EATING':
      case 'eating': {
        const munch = Math.sin(t * 9.0) * 0.12;
        out.armL.set(0, 0, -0.9);
        out.armR.set(0, 0, 0.9);
        out.elbowL.set(1.25, 0, 0);
        out.elbowR.set(1.25, 0, 0);
        out.wristL.set(0, 0.35, 0.4);
        out.wristR.set(0, -0.35, -0.4);
        out.head.set(munch, 0, 0);
        break;
      }

      default:
        break;
    }
  }

  _blendPoses(a, b, alpha, out) {
    out.armL.lerpVectors(a.armL, b.armL, alpha);
    out.armR.lerpVectors(a.armR, b.armR, alpha);
    out.elbowL.lerpVectors(a.elbowL, b.elbowL, alpha);
    out.elbowR.lerpVectors(a.elbowR, b.elbowR, alpha);
    out.wristL.lerpVectors(a.wristL, b.wristL, alpha);
    out.wristR.lerpVectors(a.wristR, b.wristR, alpha);
    out.thighL.lerpVectors(a.thighL, b.thighL, alpha);
    out.thighR.lerpVectors(a.thighR, b.thighR, alpha);
    out.kneeL.lerpVectors(a.kneeL, b.kneeL, alpha);
    out.kneeR.lerpVectors(a.kneeR, b.kneeR, alpha);
    out.ankleL.lerpVectors(a.ankleL, b.ankleL, alpha);
    out.ankleR.lerpVectors(a.ankleR, b.ankleR, alpha);
    out.spine.lerpVectors(a.spine, b.spine, alpha);
    out.waist.lerpVectors(a.waist, b.waist, alpha);
    out.head.lerpVectors(a.head, b.head, alpha);
    out.neck.lerpVectors(a.neck, b.neck, alpha);
    out.rootTilt = THREE.MathUtils.lerp(a.rootTilt, b.rootTilt, alpha);
    out.rootOffsetY = THREE.MathUtils.lerp(a.rootOffsetY, b.rootOffsetY, alpha);
  }

  _applyBlendedPoseToBones() {
    const b = this.bones;
    const p = this.blendedPose;

    // Apply Arm and Forearm transforms
    if (b['Arm_L']) b['Arm_L'].rotation.set(p.armL.x, p.armL.y, p.armL.z);
    if (b['Arm_R']) b['Arm_R'].rotation.set(p.armR.x, p.armR.y, p.armR.z);
    if (b['Elbow_L']) b['Elbow_L'].rotation.set(p.elbowL.x, p.elbowL.y, p.elbowL.z);
    if (b['Elbow_R']) b['Elbow_R'].rotation.set(p.elbowR.x, p.elbowR.y, p.elbowR.z);
    if (b['Wrist_L']) b['Wrist_L'].rotation.set(p.wristL.x, p.wristL.y, p.wristL.z);
    if (b['Wrist_R']) b['Wrist_R'].rotation.set(p.wristR.x, p.wristR.y, p.wristR.z);

    // Apply Leg transforms relative to rest rotations
    const restThighL = b['Thigh_L']?.userData.restRotation;
    const restThighR = b['Thigh_R']?.userData.restRotation;
    const restKneeL = b['Knee_L']?.userData.restRotation;
    const restKneeR = b['Knee_R']?.userData.restRotation;
    const restAnkleL = b['Ankle_L']?.userData.restRotation;
    const restAnkleR = b['Ankle_R']?.userData.restRotation;

    if (b['Thigh_L'] && restThighL) {
      b['Thigh_L'].rotation.set(restThighL.x + p.thighL.x, restThighL.y + p.thighL.y, restThighL.z + p.thighL.z);
    }
    if (b['Thigh_R'] && restThighR) {
      b['Thigh_R'].rotation.set(restThighR.x + p.thighR.x, restThighR.y + p.thighR.y, restThighR.z + p.thighR.z);
    }
    if (b['Knee_L'] && restKneeL) {
      b['Knee_L'].rotation.set(restKneeL.x + p.kneeL.x, restKneeL.y + p.kneeL.y, restKneeL.z + p.kneeL.z);
    }
    if (b['Knee_R'] && restKneeR) {
      b['Knee_R'].rotation.set(restKneeR.x + p.kneeR.x, restKneeR.y + p.kneeR.y, restKneeR.z + p.kneeR.z);
    }
    if (b['Ankle_L'] && restAnkleL) {
      b['Ankle_L'].rotation.set(restAnkleL.x + p.ankleL.x, restAnkleL.y + p.ankleL.y, restAnkleL.z + p.ankleL.z);
    }
    if (b['Ankle_R'] && restAnkleR) {
      b['Ankle_R'].rotation.set(restAnkleR.x + p.ankleR.x, restAnkleR.y + p.ankleR.y, restAnkleR.z + p.ankleR.z);
    }

    // Apply Spine & Waist
    if (b['Spine']) b['Spine'].rotation.set(p.spine.x, p.spine.y, p.spine.z);
    if (b['Waist']) {
      const restWaist = b['Waist'].userData.restRotation;
      if (restWaist) {
        b['Waist'].rotation.set(restWaist.x + p.waist.x, restWaist.y + p.waist.y, restWaist.z + p.waist.z);
      }
    }

    // Apply Head & Neck with rest rotations preserved so they never duck or pitch down
    const restHead = b['Head']?.userData.restRotation || new THREE.Euler();
    const restNeck = b['Neck']?.userData.restRotation || new THREE.Euler();

    if (b['Head']) {
      b['Head'].rotation.set(
        restHead.x + p.head.x + this.cursorLookPitch * 0.6,
        restHead.y + p.head.y + this.cursorLookYaw * 0.6,
        restHead.z + p.head.z
      );
    }
    if (b['Neck']) {
      b['Neck'].rotation.set(
        restNeck.x + p.neck.x + this.cursorLookPitch * 0.2,
        restNeck.y + p.neck.y + this.cursorLookYaw * 0.2,
        restNeck.z + p.neck.z
      );
    }
  }
}
