# Implementation Plan: Overtake Lanes, Dynamic Z-Sorting & Passing AI

## 1. Visual Bug Diagnosis (What the Screenshot Shows)

The screenshot shows three distinct rendering and collision bugs occurring simultaneously:

1. **Strict 1D Coplanar Walkways ($Z = 0$):** All characters are constrained to the exact same Z-depth coordinate. When walking in opposite directions or overtaking, their meshes intersect rather than passing around each other.
2. **Transparent / Alpha-Sorting Artifacts (Mesh Hollow-Out):** Hair and accessories from the character behind are rendering *through* the front character's face/body due to missing or incorrect `material.depthWrite` / `material.depthTest` states on transparent anime hair materials.
3. **Absence of Overtake / Steering Logic:** The character models possess no local avoidance steering (Reynolds Boids / RVO) to dynamically switch forward/backward depth lanes when approaching each other.

---

## 2. Multi-Tier Resolution Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                 Two-Lane "Passing" Steer AI                 │
│  - Characters heading RIGHT take foreground (Z = +0.15)     │
│  - Characters heading LEFT take background  (Z = -0.15)     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Dynamic Depth & Alpha-Blend Fixer               │
│  - Force `depthWrite = true` on opaque and hair meshes       │
│  - Set dynamic `mesh.renderOrder` based on active Z-lane    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Procedural "Pardon Me" Pass Reaction            │
│  - Characters turn shoulders slightly (Y-tilt ~15°)         │
│  - Fast characters side-step around slow/idle characters    │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Step-by-Step Implementation

### Step 1: Material & Depth-Buffer Sanitizer (`MaterialSanitizer.js`)

Anime models frequently have transparent textures for hair bangs, accessories, and eye highlights. In Three.js, this causes transparent sorting glitches where the back character's hair cuts through the front character's face.

```javascript
// MaterialSanitizer.js
export function sanitizeCharacterMaterials(model) {
  model.traverse((child) => {
    if (!child.isMesh) return;

    if (Array.isArray(child.material)) {
      child.material.forEach(fixMaterial);
    } else if (child.material) {
      fixMaterial(child.material);
    }
  });
}

function fixMaterial(mat) {
  // Prevent transparent clipping artifacts
  mat.depthTest = true;
  mat.depthWrite = true;
  
  // If the material has transparent elements (e.g. hair fringe / alpha cutouts)
  if (mat.transparent) {
    mat.alphaTest = 0.5; // Discard fully transparent pixels from depth write
  }
}
```

---

### Step 2: Directional 2-Lane Overtake System (`PassingSteerController.js`)

Implement deterministic depth separation:
* **Moving Right ($ec{v}_x > 0$):** Smoothly transitions to the **Foreground Lane** ($Z = +0.18$).
* **Moving Left ($ec{v}_x < 0$):** Smoothly transitions to the **Background Lane** ($Z = -0.18$).
* **Idle / Picked Up:** Stays in the **Neutral Lane** ($Z = 0.0$).

```javascript
// PassingSteerController.js
import * as THREE from 'three';

export class PassingSteerController {
  constructor(character) {
    this.char = character;
    this.laneZ = 0.0;
  }

  update(delta) {
    const vx = this.char.velocity.x;

    // 1. Determine target Z-lane based on travel direction
    if (vx > 0.05) {
      this.laneZ = 0.18; // Right-bound = Front Lane
    } else if (vx < -0.05) {
      this.laneZ = -0.18; // Left-bound = Back Lane
    } else {
      // If idle, keep current lane to prevent jitter
      this.laneZ = this.char.position.z > 0 ? 0.18 : -0.18;
    }

    // 2. Smoothly slerp/lerp character Z-position into the correct lane
    this.char.position.z = THREE.MathUtils.lerp(this.char.position.z, this.laneZ, delta * 8.0);

    // 3. Update WebGL renderOrder based on Z (Higher Z = Front = Higher Render Order)
    const baseRenderOrder = this.char.position.z > 0 ? 200 : 100;
    this.char.model.traverse((child) => {
      if (child.isMesh) {
        child.renderOrder = baseRenderOrder;
      }
    });
  }
}
```

---

### Step 3: Proximity "Pass-By" Shoulder Tilt (`PassByReaction.js`)

When two characters are about to cross within close $X$ proximity, apply a slight body yaw ($Y$-axis tilt) and arm tuck to make the pass look natural and expressive:

```javascript
// PassByReaction.js
import * as THREE from 'three';

export class PassByReaction {
  static checkAndApplyReactions(characters, delta) {
    const proximityThreshold = 0.6; // Distance in meters/units to trigger reaction

    for (let i = 0; i < characters.length; i++) {
      for (let j = i + 1; j < characters.length; j++) {
        const a = characters[i];
        const b = characters[j];

        const dx = Math.abs(a.position.x - b.position.x);

        if (dx < proximityThreshold) {
          // Characters are passing each other!
          // Apply slight torso tilt to face slightly forward/away
          const tiltDirection = a.position.x < b.position.x ? -1 : 1;
          
          if (a.model) a.model.rotation.y += tiltDirection * 0.15 * delta * 5.0;
          if (b.model) b.model.rotation.y -= tiltDirection * 0.15 * delta * 5.0;

          // Temporary ear twitch on pass-by
          if (a.secondaryPhysics) a.secondaryPhysics.triggerTwitch();
          if (b.secondaryPhysics) b.secondaryPhysics.triggerTwitch();
        }
      }
    }
  }
}
```

---

## 4. Render Loop Execution Sequence

```javascript
import { sanitizeCharacterMaterials } from './MaterialSanitizer.js';
import { PassByReaction } from './PassByReaction.js';

// Call once when loading character FBX models
characters.forEach(char => sanitizeCharacterMaterials(char.model));

function tick(delta) {
  // 1. Animation mixer & base locomotion updates
  characters.forEach(char => char.update(delta));

  // 2. Update directional lane separation (Z-position & renderOrder)
  characters.forEach(char => char.passingSteer.update(delta));

  // 3. Check proximity and trigger pass-by shoulder angles and ear twitches
  PassByReaction.checkAndApplyReactions(characters, delta);

  // 4. Render WebGL scene
  renderer.render(scene, camera);
}
```