// retro.js — the PS1 look, done on purpose.
//
// Two halves:
//  1. psxMaterial(): a MeshLambertMaterial patched with vertex snapping (wobbly
//     PS1 geometry), affine texture mapping (the classic texture swim), and an
//     optional per-vertex "bake" colour that is added as emissive light. The bake
//     is how the underground gets its Gouraud-shaded fluorescent glow without
//     hundreds of real lights; real lights (flashlight, stove, sun) still work on top.
//  2. RetroPost: the scene is rendered into a small render target (e.g. 320x240),
//     then upscaled with nearest filtering through a shader doing tone mapping,
//     ordered dithering, colour-depth reduction, optional scanlines and fades.
//
// Every effect is adjustable in Settings (design doc 8.1: "retro shaders should be
// adjustable and individually toggleable").

import * as THREE from 'three';

// Shared uniforms: every patched material points at these objects, so changing a
// setting updates the whole world at once.
export const RETRO = {
  uSnap: { value: new THREE.Vector2(160, 120) }, // grid in NDC half-pixels; 0 = off
  uAffine: { value: 0.6 },                        // 0 = perspective-correct, 1 = full PS1 swim
};

const VERT_HEAD = /* glsl */`
uniform vec2 uSnap;
uniform float uAffine;
#ifdef USE_MAP
varying vec3 vAffUv;
#endif
#ifdef USE_BAKE
attribute vec3 bake;
varying vec3 vBake;
#endif
`;

const VERT_TAIL = /* glsl */`
if (uSnap.x > 0.0) {
  vec4 snapped = gl_Position;
  snapped.xyz /= snapped.w;
  snapped.xy = floor(snapped.xy * uSnap + 0.5) / uSnap;
  snapped.xyz *= snapped.w;
  gl_Position = snapped;
}
#ifdef USE_MAP
vAffUv = vec3(vMapUv * gl_Position.w, gl_Position.w);
#endif
#ifdef USE_BAKE
vBake = bake;
#endif
`;

const FRAG_HEAD = /* glsl */`
uniform float uAffine;
#ifdef USE_MAP
varying vec3 vAffUv;
#endif
#ifdef USE_BAKE
varying vec3 vBake;
#endif
`;

const FRAG_MAP = /* glsl */`
#ifdef USE_MAP
  vec2 psxUv = mix(vMapUv, vAffUv.xy / vAffUv.z, uAffine);
  vec4 sampledDiffuseColor = texture2D( map, psxUv );
  diffuseColor *= sampledDiffuseColor;
#endif
`;

function patch(shader) {
  shader.uniforms.uSnap = RETRO.uSnap;
  shader.uniforms.uAffine = RETRO.uAffine;
  shader.vertexShader = VERT_HEAD + shader.vertexShader.replace(
    '#include <fog_vertex>', '#include <fog_vertex>\n' + VERT_TAIL);
  shader.fragmentShader = FRAG_HEAD + shader.fragmentShader
    .replace('#include <map_fragment>', FRAG_MAP)
    .replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#ifdef USE_BAKE\n totalEmissiveRadiance += diffuseColor.rgb * vBake;\n#endif\n');
}

/**
 * Make a PS1-style material.
 * opts: map, color, vertexColors, bake (bool: geometry has a `bake` attribute),
 *       emissive, transparent, opacity, alphaTest, side, fog (default true)
 */
export function psxMaterial(opts = {}) {
  const { bake, ...rest } = opts;
  const m = new THREE.MeshLambertMaterial(rest);
  if (bake) m.defines = { USE_BAKE: '' };
  m.onBeforeCompile = patch;
  return m;
}

/** Patch an existing material (e.g. one that came out of a GLB) in place. */
export function psxify(material) {
  material.onBeforeCompile = patch;
  material.needsUpdate = true;
  return material;
}

// --- Texture loading ---------------------------------------------------------------

const texLoader = new THREE.TextureLoader();
const texCache = new Map();

/** Load a pixel-art texture: nearest filtering, repeat wrap, sRGB. */
export function loadTex(url, { repeat = true } = {}) {
  if (texCache.has(url)) return texCache.get(url);
  const t = texLoader.load(url, undefined, undefined, () => console.warn('texture missing', url));
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 1;
  texCache.set(url, t);
  return t;
}

/** Draw a texture procedurally into a canvas (fallbacks, signs, UI-ish surfaces). */
export function canvasTex(w, h, draw, { repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// --- Post processing ------------------------------------------------------------------

const POST_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tScene;
uniform vec2 uRes;          // internal resolution
uniform float uDither;      // 0/1
uniform float uLevels;      // colour levels per channel (32 = 15-bit look, 256 = off)
uniform float uScan;        // scanline strength 0..1
uniform float uExposure;
uniform vec3 uTint;         // multiplicative grade (red sky, underwater...)
uniform float uFade;        // 0 = clear, 1 = black
uniform vec3 uFlash;        // additive flash (damage)
uniform float uVignette;
varying vec2 vUv;

float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0)); int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16];
  m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
  m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
  for (int k = 0; k < 16; k++) if (k == i) return m[k] / 16.0 - 0.5;
  return 0.0;
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  c = aces(c * uExposure * uTint);
  c = toSRGB(c);
  c += uFlash;
  vec2 px = floor(vUv * uRes);
  if (uLevels < 255.0) {
    float n = uDither * bayer(px);
    c = floor(c * (uLevels - 1.0) + 0.5 + n) / (uLevels - 1.0);
  }
  if (uScan > 0.0) {
    float line = mod(gl_FragCoord.y, 3.0) < 1.0 ? 1.0 - uScan : 1.0;
    c *= line;
  }
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * dot(q, q) * 1.6;
  c *= 1.0 - uFade;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const POST_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class RetroPost {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(320, 240, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType, depthBuffer: true,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: POST_VERT, fragmentShader: POST_FRAG,
      uniforms: {
        tScene: { value: this.target.texture },
        uRes: { value: new THREE.Vector2(320, 240) },
        uDither: { value: 1 }, uLevels: { value: 32 }, uScan: { value: 0 },
        uExposure: { value: 1.0 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
        uFade: { value: 0 }, uFlash: { value: new THREE.Vector3() }, uVignette: { value: 0.35 },
      },
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.internalHeight = 240;
  }

  get u() { return this.material.uniforms; }

  /** Resize the internal target for a canvas of w x h CSS*dpr pixels. */
  resize(w, h) {
    const ih = this.internalHeight > 0 ? Math.min(this.internalHeight, h) : h;
    const iw = Math.max(1, Math.round(ih * (w / h)));
    this.target.setSize(iw, ih);
    this.u.uRes.value.set(iw, ih);
    // Vertex snapping grid: one step per internal pixel (half-resolution in NDC terms).
    if (RETRO.uSnap.value.x !== 0) RETRO.uSnap.value.set(iw / 2, ih / 2);
    this._snapW = iw / 2; this._snapH = ih / 2;
  }

  setSnap(on) {
    if (on) RETRO.uSnap.value.set(this._snapW || 160, this._snapH || 120);
    else RETRO.uSnap.value.set(0, 0);
  }

  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }
}

// --- Settings --------------------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  resolution: 240,   // internal height; 0 = native
  snap: true,
  affine: 0.6,
  dither: true,
  colorDepth: 32,    // levels per channel: 32 (15-bit), 64, 256 (off)
  scanlines: 0,
  vignette: 0.35,
  fov: 70,
  sensitivity: 1.0,
  volume: 0.8,
  shadows: true,
  drawDistance: 1.0,
};

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('lakehouse.settings') || '{}');
    return { ...DEFAULT_SETTINGS, ...s };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem('lakehouse.settings', JSON.stringify(s)); } catch { /* private mode */ }
}

export function applySettings(s, post) {
  post.internalHeight = s.resolution;
  post.setSnap(s.snap);
  RETRO.uAffine.value = s.affine;
  post.u.uDither.value = s.dither ? 1 : 0;
  post.u.uLevels.value = s.colorDepth;
  post.u.uScan.value = s.scanlines;
  post.u.uVignette.value = s.vignette;
}
