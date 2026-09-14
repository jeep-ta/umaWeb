# Implementation Plan: Arm Rest-Pose Correction & Hand Expressiveness Engine

## 1. Root-Cause Analysis (Why the "Zombie Posture" Happens)

The arms and hands sticking out straight or horizontally forward like a zombie is caused by three distinct issues in Three.js FBX workflows:

1. **Rest Pose / Binding Pose Leakage:** The FBX default T-pose or A-pose has $\approx 0^\circ$ rotation on shoulder and elbow joints. If an animation clip lacks explicit keyframes for arm/hand tracks (or if an additive layer is unweighted), the skeleton reverts to the base T/A-pose.
2. **Coordinate Axis Mismatch in FBX Exporters:** FBX arm bones often have inverted pre-rotations ($X$-forward or $Z$-down) compared to standard Three.js bone axes, causing arms to project forward along $+Z$.
3. **Static Hand Rigging:** FBX game rigs frequently collapse finger bones into a single palm joint or leave individual phalanges at $0^\circ$ pitch, resulting in flat, lifeless "paddle hands."

---

## 2. Multi-Layer Solution Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Animation Mixer Layer                     │
│  Base Locomotion / Action Clip (Walk, Sprint, Idle, Pose)   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Procedural Arm Pose Layer (Override)            │
│  - Rest Posture Damping (Relax shoulders down ~70°, in ~15°)│
│  - Arm Swing Procedural Layer (Counter-phase with stride)   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│          Procedural Finger & Hand Expressiveness            │
│  - Preset Poses (Relaxed Cup, Fist, Peace/V, Open Claws)    │
│  - Micro-Jiggle & Personality-Driven Gestures               │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Step-by-Step Implementation

### Step 1: Bone Mapping & Rest-Pose Normalizer (`ArmPoseNormalizer.js`)

Map standard Uma Musume / Mixamo / generic FBX bone naming conventions and enforce a natural relaxed rest angle when animations do not fully drive the arms.

```javascript
// ArmPoseNormalizer.js
import * as THREE from 'three';

export class ArmPoseNormalizer {
  constructor(model) {
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
    this.fingerBones = { left: [], right: [] };
    this.initBoneMapping();
  }

  initBoneMapping() {
    this.model.traverse((child) => {
      if (!child.isBone) return;
      const name = child.name.toLowerCase();

      // Arm chain detection
      if (name.includes('shoulder_l') || name.includes('clavicle_l')) this.bones.leftShoulder = child;
      if (name.includes('shoulder_r') || name.includes('clavicle_r')) this.bones.rightShoulder = child;
      if (name.includes('upperarm_l') || name.includes('arm_l')) this.bones.leftArm = child;
      if (name.includes('upperarm_r') || name.includes('arm_r')) this.bones.rightArm = child;
      if (name.includes('forearm_l') || name.includes('elbow_l')) this.bones.leftForeArm = child;
      if (name.includes('forearm_r') || name.includes('elbow_r')) this.bones.rightForeArm = child;
      if (name.includes('hand_l') || name.includes('wrist_l')) this.bones.leftHand = child;
      if (name.includes('hand_r') || name.includes('wrist_r')) this.bones.rightHand = child;

      // Finger chain detection (Thumb, Index, Middle, Ring, Pinky)
      if (
        name.includes('finger') ||
        name.includes('thumb') ||
        name.includes('index') ||
        name.includes('mid') ||
        name.includes('pinky')
      ) {
        if (name.endsWith('_l') || name.includes('left')) this.fingerBones.left.push(child);
        if (name.endsWith('_r') || name.includes('right')) this.fingerBones.right.push(child);
      }
    });
  }

  // Force-relax arms downward during idle or weak clips
  applyRelaxedRestPose(blendWeight = 1.0) {
    if (blendWeight <= 0) return;

    // Natural rest angles: Upper arms down ~70 deg, slightly forward ~15 deg; Forearms bent ~25 deg
    const targetLeftArmQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.1, -1.2, 'XYZ'));
    const targetRightArmQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.1, 1.2, 'XYZ'));
    const targetForearmL = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.0, -0.2, 'XYZ'));
    const targetForearmR = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.0, 0.2, 'XYZ'));

    if (this.bones.leftArm) this.bones.leftArm.quaternion.slerp(targetLeftArmQuat, blendWeight);
    if (this.bones.rightArm) this.bones.rightArm.quaternion.slerp(targetRightArmQuat, blendWeight);
    if (this.bones.leftForeArm) this.bones.leftForeArm.quaternion.slerp(targetForearmL, blendWeight);
    if (this.bones.rightForeArm) this.bones.rightForeArm.quaternion.slerp(targetForearmR, blendWeight);
  }
}
```

---

### Step 2: Procedural Hand Pose & Finger Curvature Engine (`HandController.js`)

Create a procedural controller that bends joints into realistic postures (natural curve, clench, peace signs, wave) instead of flat boards.

```javascript
// HandController.js
import * as THREE from 'three';

export const HAND_POSES = {
  RELAXED_CUP: { curlBase: 0.25, curlMid: 0.35, curlTip: 0.2, thumbSpread: 0.15 },
  FIST: { curlBase: 1.2, curlMid: 1.4, curlTip: 1.1, thumbSpread: -0.2 },
  PEACE_V: { indexSpread: 0.2, middleSpread: -0.2, othersCurl: 1.4, thumbCurl: 1.0 },
  CLAW_EXCITED: { curlBase: 0.6, curlMid: 0.9, curlTip: 0.4, thumbSpread: 0.4 },
  HOLD_CARROT: { curlBase: 0.7, curlMid: 0.8, curlTip: 0.6, thumbSpread: 0.3 },
};

export class HandController {
  constructor(armNormalizer) {
    this.normalizer = armNormalizer;
    this.currentPose = 'RELAXED_CUP';
  }

  setHandPose(poseName) {
    if (HAND_POSES[poseName]) {
      this.currentPose = poseName;
    }
  }

  update(delta) {
    const config = HAND_POSES[this.currentPose];
    if (!config) return;

    // Apply natural curl to finger bones
    [...this.normalizer.fingerBones.left, ...this.normalizer.fingerBones.right].forEach((bone) => {
      const isThumb = bone.name.toLowerCase().includes('thumb');
      const curlAmount = isThumb ? (config.thumbSpread || 0.2) : (config.curlBase || 0.3);

      const targetEuler = new THREE.Euler(curlAmount, 0, 0, 'XYZ');
      const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);
      bone.quaternion.slerp(targetQuat, delta * 8.0);
    });
  }
}
```

---

### Step 3: Natural Arm-Swing Generator (`ProceduralArmSwing.js`)

When characters walk or sprint, procedural counter-rotation prevents the arms from remaining static:

```javascript
// ProceduralArmSwing.js
import * as THREE from 'three';

export class ProceduralArmSwing {
  constructor(armNormalizer) {
    this.normalizer = armNormalizer;
    this.swingPhase = 0;
  }

  update(velocity, delta) {
    const speed = velocity.length();
    if (speed < 0.05) return; // In idle, let the rest pose or clip handle it

    // Advance phase proportional to speed
    this.swingPhase += delta * speed * 6.0;

    // Natural running/walking arm swing (Left & Right are 180 degrees / PI out of phase)
    const swingL = Math.sin(this.swingPhase) * 0.45;
    const swingR = Math.sin(this.swingPhase + Math.PI) * 0.45;

    if (this.normalizer.bones.leftArm) {
      this.normalizer.bones.leftArm.rotation.x += swingL;
    }
    if (this.normalizer.bones.rightArm) {
      this.normalizer.bones.rightArm.rotation.x += swingR;
    }
  }
}
```

---

### Step 4: Character Personality Hand & Arm Customization

Integrate arm/hand styles directly into each character's personality profile:

| Character | Default Hand Pose | Arm Movement / Gesture Style |
| :--- | :--- | :--- |
| **Special Week** | `RELAXED_CUP` | Bouncy arm swing; hands flap outward slightly during high sprint. |
| **Silence Suzuka** | `FIST` (light) | Tight, aerodynamic tuck; minimal side-to-side swing; hands kept close to hips. |
| **Oguri Cap** | `HOLD_CARROT` / `FIST` | Deliberate, firm arm swings; left hand frequently holds an onigiri/carrot snack prop. |
| **Daitaku Helios** | `PEACE_V` / `CLAW_EXCITED` | High-energy gyaru hand gestures; one hand constantly flashing peace signs or cheering. |
| **Mambo** | `FIST` (clenched thumbs) | "Ei, ei, mun!" fist-pump poses; relaxed, slightly wobbly arm swing while walking. |

---

### Step 5: Render Loop Execution Order

To ensure procedural overrides take effect without being overwritten by the FBX animation clips, maintain this strict order in the main `tick(delta)` loop:

```javascript
function tick(delta) {
  // 1. Update FBX base clip playback
  if (animationMixer) animationMixer.update(delta);

  // 2. Override rest posture if in Idle / Low-influence states
  if (currentState === 'IDLE' || currentState === 'SNOOZE') {
    armNormalizer.applyRelaxedRestPose(0.85); // 85% procedural blend
  }

  // 3. Add procedural arm-swing during locomotion
  if (currentState === 'WALK' || currentState === 'SPRINT') {
    proceduralArmSwing.update(characterVelocity, delta);
  }

  // 4. Update hand poses & finger curling
  handController.update(delta);

  // 5. Secondary ear/tail spring physics
  secondaryPhysics.update(delta);

  // 6. Final WebGL render
  renderer.render(scene, camera);
}
```

---

## 4. Verification & Testing Checklist

- [ ] **Rest Pose Verification:** Load all 5 models in `IDLE`. Arms must hang naturally at the sides with a relaxed elbow bend, completely eliminating the horizontal T/A-pose projection.
- [ ] **Locomotion Swings:** Ensure arms swing in opposite phase with the character's legs during `WALK` and `SPRINT`.
- [ ] **Finger Bending:** Inspect fingers up close; verify they are smoothly curved inward rather than stiff, straight boards.
- [ ] **Personality-Specific Gestures:**
  - Verify Daitaku Helios switches to `PEACE_V` during idle and clicks.
  - Verify Mambo pumps both fists during her `ei_ei_mun` animation.
  - Verify Oguri Cap holds her hands in a natural grip around snack items.