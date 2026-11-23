// assets.js — loads assets/manifest.json, textures and the CC0 low-poly models.
// Every lookup has a fallback, so the game still runs (uglier) if a file is missing.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadTex, canvasTex, psxMaterial } from './retro.js';

const BASE = './assets/';
let manifest = { textures: {}, models: {} };
const geoms = new Map();

export async function loadAssets(onProgress) {
  try {
    const r = await fetch(BASE + 'manifest.json', { cache: 'no-cache' });
    if (r.ok) manifest = await r.json();
  } catch { /* no manifest: procedural fallbacks everywhere */ }
  manifest.textures ||= {}; manifest.models ||= {};
  const names = Object.keys(manifest.models);
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(names.map(async (name) => {
    const info = manifest.models[name];
    try {
      const gltf = await loader.loadAsync(BASE + info.file);
      const parts = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (o.isMesh) {
          const g = o.geometry.clone();
          g.applyMatrix4(o.matrixWorld);
          parts.push(g);
        }
      });
      if (parts.length) {
        const g = parts.length === 1 ? parts[0] : mergeSimple(parts);
        if (!g.attributes.color) {
          const n = g.attributes.position.count;
          g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.7), 3));
        } else if (info.colorSpace !== 'linear') {
          // GLB vertex colours authored as sRGB: three.js lights in linear space.
          const c = g.attributes.color;
          const tmp = new THREE.Color();
          for (let i = 0; i < c.count; i++) {
            tmp.setRGB(c.getX(i), c.getY(i), c.getZ(i), THREE.SRGBColorSpace);
            c.setXYZ(i, tmp.r, tmp.g, tmp.b);
          }
        }
        if (!g.attributes.normal) g.computeVertexNormals();
        g.computeBoundingBox(); g.computeBoundingSphere();
        geoms.set(name, g);
      }
    } catch (e) { console.warn('model failed', name, e); }
    done++;
    onProgress && onProgress(done / Math.max(1, names.length));
  }));
}

function mergeSimple(parts) {
  // all parts must share attribute layout; keep position/normal/color only
  let count = 0;
  for (const p of parts) count += (p.index ? p.index.count : p.attributes.position.count);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (let p of parts) {
    if (p.index) p = p.toNonIndexed();
    const n = p.attributes.position.count;
    pos.set(p.attributes.position.array.subarray(0, n * 3), o * 3);
    if (p.attributes.normal) nor.set(p.attributes.normal.array.subarray(0, n * 3), o * 3);
    if (p.attributes.color && p.attributes.color.itemSize === 3) col.set(p.attributes.color.array.subarray(0, n * 3), o * 3);
    else col.fill(0.7, o * 3, (o + n) * 3);
    o += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function hasModel(name) { return geoms.has(name); }
export function modelGeom(name) { return geoms.get(name) || null; }
export function modelNames(prefix) { return [...geoms.keys()].filter((n) => n.startsWith(prefix)); }

/** First available model among candidate names. */
export function pickModel(...names) {
  for (const n of names) if (geoms.has(n)) return n;
  return null;
}

const vcMat = new Map();
/** Shared vertex-coloured PS1 material for models. */
export function modelMaterial(key = 'default', opts = {}) {
  if (!vcMat.has(key)) vcMat.set(key, psxMaterial({ vertexColors: true, ...opts }));
  return vcMat.get(key);
}

/** A mesh of a model, scaled so its height is `height` metres (optional). */
export function modelMesh(name, { height, scale, material } = {}) {
  const g = geoms.get(name);
  if (!g) return null;
  const m = new THREE.Mesh(g, material || modelMaterial());
  if (height) { const h = g.boundingBox.max.y - g.boundingBox.min.y; m.scale.setScalar(height / Math.max(h, 1e-3)); }
  else if (scale) m.scale.setScalar(scale);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// --- textures --------------------------------------------------------------------

const FALLBACK = {
  ground_forest: '#3b4a2a', ground_grass: '#41552c', dirt_road: '#5a4a36', shore_gravel: '#77736a',
  rock_cliff: '#6d6d68', moss_rock: '#566148', cabin_logs: '#6b4a2e', wood_planks: '#7a5636',
  wood_dark: '#4a3322', roof_shingles: '#3d3a37', dock_planks: '#6e6457', concrete_wall: '#8a8a84',
  concrete_floor: '#77766f', concrete_dirty: '#5f5d56', metal_plate: '#6c7073', metal_panel: '#7d8a8e',
  metal_rusty: '#6b4b37', floor_tiles: '#a5a397', ceiling_tiles: '#b6b4aa', carpet_office: '#4b5466',
  brick_painted: '#b0aa96', castle_stone: '#4b4844', stone_floor_old: '#55514a', hazard_stripes: '#c9a516',
};

const texCacheRole = new Map();
/** Texture by role name from the manifest, or a noisy flat fallback. */
export function tex(role) {
  if (texCacheRole.has(role)) return texCacheRole.get(role);
  let t;
  const info = manifest.textures[role];
  if (info) t = loadTex(BASE + info.file);
  else {
    const base = FALLBACK[role] || '#808080';
    t = canvasTex(32, 32, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 220; i++) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.12})`;
        g.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 2, 2);
      }
    });
  }
  texCacheRole.set(role, t);
  return t;
}

export function hasTex(role) { return !!manifest.textures[role]; }
