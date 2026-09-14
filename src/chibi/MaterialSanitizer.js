import * as THREE from 'three';

/**
 * MaterialSanitizer: Ensures proper depth-testing and depth-writing states
 * on FBX meshes to prevent transparent sorting glitches, hollowed-out faces,
 * and background hair bleeding through foreground characters.
 */
export function sanitizeCharacterMaterials(model) {
  if (!model) return;

  model.traverse((child) => {
    if (!child.isMesh) return;

    if (Array.isArray(child.material)) {
      child.material.forEach((mat) => fixMaterial(mat, child));
    } else if (child.material) {
      fixMaterial(child.material, child);
    }
  });
}

function fixMaterial(mat, mesh) {
  if (!mat) return;
  const name = (mat.name || '').toLowerCase();

  // Special invisible helper meshes (e.g. Mambo transparent helper, Helios front helper)
  if (name === 'transparent' || name.includes('transp') || name === 'front') {
    mat.transparent = true;
    mat.opacity = 0;
    mat.visible = false;
    mat.depthWrite = false;
    mat.depthTest = false;
    return;
  }

  const isDecal = name.includes('eye') || name.includes('mouth') || 
                  name.includes('cheek') || name.includes('brow');

  if (isDecal) {
    // Face decals (eyes, mouth, blush, eyebrows):
    // Use polygonOffset to push decals slightly forward in depth calculation relative
    // to their own character's face skin. This prevents self Z-fighting while ensuring
    // depthTest = true so other characters in front properly occlude the decals!
    mat.depthTest = true;
    mat.depthWrite = false;
    mat.transparent = true;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2.0;
    mat.polygonOffsetUnits = -4.0;
  } else {
    // Opaque and semi-opaque geometry (Body, Clothes, Hair, Tail, Face base skin):
    mat.depthTest = true;
    mat.depthWrite = true;

    // If marked transparent or has alpha cutouts (e.g. hair strands/fringe),
    // set alphaTest so fully transparent pixels do not occlude geometry behind them.
    if (mat.transparent || mat.alphaMap || (mat.map && mat.map.format === THREE.RGBAFormat)) {
      mat.alphaTest = 0.45;
    }
  }
}
