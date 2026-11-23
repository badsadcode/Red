// underground.js — everything below the mountain door.
//
//   * the vestibule and reception (hand-built)
//   * THE SHAFT: a colossal vertical shaft with a freight platform riding down past
//     seven sector landings (the "this cannot fit under that mountain" reveal)
//   * seven BadLevel sectors, generated once and frozen (assets/sectors/*.json)
//   * the shades, and the lantern at the very bottom
//
// Coordinates: BadLevel x,y,z (quake units, z up) -> three.js (x/32, z/32, -y/32).

import * as THREE from 'three';
import { Collider } from './physics.js';
import { meshBoxes, bakeGroup, makeLightGrid, groupsToMeshes } from './mesher.js';
import { psxMaterial, canvasTex } from './retro.js';
import { tex, modelMesh, pickModel, modelGeom, modelMaterial } from './assets.js';
import { SECTOR_NOTES } from './lore.js';
import { clamp, lerp, rng, damp, smoothstep } from './util.js';

const Q = 1 / 32;

// --- themes: how each sector looks and sounds -----------------------------------------
export const THEMES = {
  admin:       { wall: 'brick_painted', wallTint: 0xe8e0c8, floor: 'carpet_office', alt: 'floor_tiles', ceil: 'ceiling_tiles', prop: 'metal_panel', propTint: 0x9a9a92,
                 light: [1.0, 0.95, 0.82], strength: 2.4, ambient: 0.035, fog: 0x0a0c0d, fogD: 0.03, step: 'step_concrete', water: 0x203530 },
  residential: { wall: 'brick_painted', wallTint: 0xf0d8b8, floor: 'wood_planks', alt: 'floor_tiles', ceil: 'ceiling_tiles', prop: 'wood_dark', propTint: 0xffffff,
                 light: [1.0, 0.82, 0.62], strength: 2.2, ambient: 0.03, fog: 0x0d0b09, fogD: 0.028, step: 'step_wood', water: 0x203530, fakeSky: true },
  research:    { wall: 'metal_panel', wallTint: 0xd8e4e8, floor: 'floor_tiles', alt: 'floor_tiles', ceil: 'ceiling_tiles', prop: 'metal_panel', propTint: 0xc0c8cc,
                 light: [0.78, 0.92, 1.05], strength: 2.4, ambient: 0.03, fog: 0x080b0e, fogD: 0.03, step: 'step_metal', water: 0x1a3038 },
  hydro:       { wall: 'concrete_wall', wallTint: 0xc8d0c0, floor: 'metal_plate', alt: 'concrete_floor', ceil: 'concrete_dirty', prop: 'metal_rusty', propTint: 0xb0b0a0,
                 light: [0.62, 1.0, 0.55], strength: 2.2, ambient: 0.03, fog: 0x07100a, fogD: 0.032, step: 'step_metal', water: 0x1c3a24, grow: true },
  reactor:     { wall: 'concrete_dirty', wallTint: 0xd0c4b4, floor: 'metal_plate', alt: 'concrete_floor', ceil: 'metal_rusty', prop: 'metal_rusty', propTint: 0xc0a090,
                 light: [1.0, 0.62, 0.28], strength: 2.4, ambient: 0.03, fog: 0x0e0904, fogD: 0.025, step: 'step_metal', water: 0x302010 },
  flooded:     { wall: 'concrete_dirty', wallTint: 0xa8b8b0, floor: 'concrete_floor', alt: 'concrete_dirty', ceil: 'concrete_dirty', prop: 'metal_rusty', propTint: 0x90a0a0,
                 light: [0.5, 0.85, 0.8], strength: 2.0, ambient: 0.022, fog: 0x050a0a, fogD: 0.04, step: 'step_concrete', water: 0x0e2a2a },
  deep:        { wall: 'castle_stone', wallTint: 0xc8b8a8, floor: 'stone_floor_old', alt: 'stone_floor_old', ceil: 'castle_stone', prop: 'castle_stone', propTint: 0xa09080,
                 light: [1.0, 0.5, 0.2], strength: 2.2, ambient: 0.02, fog: 0x0a0302, fogD: 0.035, step: 'step_stone', water: 0x200808 },
  hub:         { wall: 'concrete_wall', wallTint: 0xc0c0b8, floor: 'concrete_floor', alt: 'floor_tiles', ceil: 'concrete_dirty', prop: 'metal_panel', propTint: 0xa0a8a8,
                 light: [0.95, 0.95, 0.88], strength: 2.2, ambient: 0.03, fog: 0x080a0c, fogD: 0.0075, step: 'step_concrete', water: 0x203530 },
};

const CARPET = new Set(['office', 'conference', 'lobby', 'security']);
const TILES = new Set(['lab', 'server', 'control', 'cafeteria', 'test_chamber', 'atrium', 'transit']);
const CONCRETE = new Set(['storage', 'supply', 'warehouse', 'workshop', 'pump', 'boiler', 'closet', 'stairwell', 'lift']);

export const STOPS = [
  { id: 'top', code: 'TOP', name: 'Surface access', y: -6, dir: [0, 1] },
  { id: 'b1', code: 'B-1', name: 'Administration & Security', y: -70, dir: [1, 0] },
  { id: 'b2', code: 'B-2', name: 'Commons & Residential', y: -150, dir: [-1, 0] },
  { id: 'b3', code: 'B-3', name: 'Research Laboratories', y: -235, dir: [0, -1] },
  { id: 'b4', code: 'B-4', name: 'Hydroponics & Biosciences', y: -320, dir: [1, 0] },
  { id: 'b5', code: 'B-5', name: 'Power & Reactor', y: -410, dir: [0, 1] },
  { id: 'b6', code: 'B-6', name: 'Flooded Maintenance', y: -500, dir: [-1, 0] },
  { id: 'b7', code: '- - -', name: '(scratched off)', y: -620, dir: [0, -1] },
];
const SHAFT = { x: 0, z: -94, r: 34, top: 30, bottom: -680 };
const PLAT = 3.8; // platform half-size

export class Underground {
  constructor(G) {
    this.G = G;
    this.area = null;           // 'hub' | sector id | 'lantern'
    this.scene = null;
    this.interact = [];
    this.ladders = [];
    this.updaters = [];
    this.sectorCache = new Map();
    this.shades = [];
    this.platformY = STOPS[0].y;
    this.platformTarget = null;
    this.t = 0;
  }

  // ===================================================================================
  // shared scene setup
  // ===================================================================================

  newScene(theme) {
    const S = new THREE.Scene();
    S.fog = new THREE.FogExp2(theme.fog, theme.fogD);
    S.add(new THREE.AmbientLight(0xffffff, 0.04));
    S.add(new THREE.HemisphereLight(0x8090a0, 0x101010, 0.05));
    return S;
  }

  /** Materials for brush faces, cached per key 'role|tint'. */
  matFor(key) {
    this._mats ||= new Map();
    if (!this._mats.has(key)) {
      const [role, tint] = key.split('|');
      const m = psxMaterial({ map: tex(role), color: new THREE.Color(Number(tint || 0xffffff)), bake: true });
      this._mats.set(key, m);
    }
    return this._mats.get(key);
  }

  buildBrushes(boxes, lights, theme, isAir = null) {
    const col = this.G.collider;
    const grid = makeLightGrid(lights);
    const amb = [theme.ambient, theme.ambient, theme.ambient * 1.1];
    const t0 = performance.now();
    const groups = meshBoxes(boxes, col, (b, face) => faceRole(b, face, theme), isAir);
    const meshes = groupsToMeshes(groups, (k) => this.matFor(k), (g) => bakeGroup(g, lights, col, amb, grid));
    let verts = 0; for (const m of meshes) verts += m.geometry.attributes.position.count;
    console.log(`[mesher] ${boxes.length} boxes -> ${verts} verts in ${(performance.now() - t0) | 0} ms`);
    return meshes;
  }

  // ===================================================================================
  // THE HUB: vestibule, reception, service stair, the shaft
  // ===================================================================================

  buildHub() {
    const G = this.G, col = G.collider;
    const theme = THEMES.hub;
    const S = this.newScene(theme);
    const boxes = [];
    const lights = [];
    const B = (x0, y0, z0, x1, y1, z1, opts = {}) => {
      const b = { x0, y0, z0, x1, y1, z1, ...opts };
      boxes.push(b); col.add(b); return b;
    };
    const L = (x, y, z, r = 9, c = theme.light, s = theme.strength) => lights.push({ x, y, z, r, c: c.map((v) => v * s) });
    const wallT = 0.5;

    // vestibule: entry corridor from the mountain door (z=0) inward
    B(-2.2, -0.5, -14, 2.2, 0, 0.4, { floor: true, alt: true });
    B(-2.2, 3.2, -14, 2.2, 3.7, 0.4, { ceil: true });
    B(-2.2 - wallT, -0.5, -14, -2.2, 3.7, 0.4);
    B(2.2, -0.5, -14, 2.2 + wallT, 3.7, 0.4);
    B(-2.7, -0.5, 0.4, 2.7, 3.7, 0.9);     // the inside of the steel door
    L(0, 3.0, -4, 7); L(0, 3.0, -11, 7, [0.9, 0.95, 1.0], 0.6); // second one is dying

    // reception
    B(-8, -0.5, -28, 8, 0, -14, { floor: true });
    B(-8, 4.2, -28, 8, 4.7, -14, { ceil: true });
    B(-8.5, -0.5, -28, -8, 4.7, -14); B(8, -0.5, -28, 8.5, 4.7, -14);
    B(-8.5, -0.5, -14.5, -2.2, 4.7, -14); B(2.2, -0.5, -14.5, 8.5, 4.7, -14);
    B(-2.2, 3.2, -14.5, 2.2, 4.7, -14);
    B(-8.5, -0.5, -28.5, -2, 4.7, -28); B(2, -0.5, -28.5, 8.5, 4.7, -28);
    B(-2, 3.2, -28.5, 2, 4.7, -28);
    B(-5.2, 0, -21.2, -1.6, 1.05, -20.2, { prop: true });   // reception desk
    B(-5.2, 0, -21.2, -4.4, 1.05, -18.2, { prop: true });
    B(4.5, 0, -27.5, 7.5, 2.2, -26.8, { prop: true });       // filing cabinets
    B(6.8, 0, -24, 7.6, 1.8, -17, { prop: true });
    L(-4, 3.9, -17, 8); L(4, 3.9, -17, 8); L(-4, 3.9, -25, 8); L(4, 3.9, -25, 8, [1, 0.3, 0.2], 0.9); // emergency red

    // service corridor down to the shaft (stairs)
    B(-2, -0.5, -34, 2, 0, -28, { floor: true, alt: true });
    for (let i = 0; i < 24; i++) {
      const z0 = -34 - i * 0.5;
      B(-2, -8, z0 - 0.5, 2, -0.25 * (i + 1), z0, { floor: true, alt: true });
    }
    B(-2, -8, -60, 2, -6, -46, { floor: true, alt: true });
    B(-2.5, -8, -60, -2, 4.7, -28); B(2, -8, -60, 2.5, 4.7, -28);
    B(-2, 3.2, -40, 2, 4.7, -28, { ceil: true });
    B(-2, -2.8, -60, 2, 3.2, -40, { ceil: true });
    L(0, 2.9, -31, 7); L(0, 0.2, -40, 7); L(0, -3.1, -50, 7); L(0, -3.1, -57, 8, [1, 0.6, 0.25], 1.4);

    // the shaft
    this.buildShaft(S, B, L);

    // geometry
    for (const m of this.buildBrushes(boxes, lights, theme)) S.add(m);
    this.addFixtures(S, lights, theme);

    // exit door interaction
    this.interact.push({ pos: new THREE.Vector3(0, 1.5, 0.2), r: 2.2, label: () => 'Go back outside', act: () => G.travel.toSurface() });
    // a few notes & props in reception
    this.addNote(S, 'b1_welcome', -3.4, 1.06, -20.7);
    this.addProp(S, pickModel('computer_small'), -2.4, 1.05, -20.6, 0.5, 0);
    this.addProp(S, pickModel('office_chair'), -3.2, 0, -21.9, 1.0, Math.PI);
    this.addProp(S, pickModel('houseplant'), 7.2, 0, -15, 1.2, 0);
    this.addProp(S, pickModel('trashcan_small'), -7.4, 0, -27.2, 0.5, 0);

    // reveal trigger: stepping onto the catwalk for the first time
    this.updaters.push(() => {
      const p = G.player;
      if (!G.state.flags.sawShaft && p.z < -61 && p.y < -4) {
        G.state.flags.sawShaft = true;
        G.audio.play('discovery', { volume: 0.9 });
        G.hud.subtitle('...this can\'t possibly fit under that mountain.', 6);
      }
    });
    return S;
  }

  buildShaft(S, B, L) {
    const G = this.G;
    const { x: cx, z: cz, r: R } = SHAFT;
    const metal = THEMES.hub;
    // catwalk from the service corridor to the centre (top stop)
    const catwalk = (dir, y, len0, len1, name) => {
      // dir: [dx, dz] unit cardinal; spans from distance len0 to len1 from the shaft centre
      const [dx, dz] = dir;
      const w = 1.6;
      const a0 = Math.min(len0, len1), a1 = Math.max(len0, len1);
      let x0, x1, z0, z1;
      if (dx !== 0) { x0 = cx + dx * a0; x1 = cx + dx * a1; if (x0 > x1) [x0, x1] = [x1, x0]; z0 = cz - w; z1 = cz + w; }
      else { z0 = cz + dz * a0; z1 = cz + dz * a1; if (z0 > z1) [z0, z1] = [z1, z0]; x0 = cx - w; x1 = cx + w; }
      B(x0, y - 0.3, z0, x1, y, z1, { floor: true, grate: true });
      // railings: invisible collision walls + see-through visual rails (the abyss must show)
      if (dx !== 0) { B(x0, y, z0 - 0.08, x1, y + 1.1, z0, { invisible: true }); B(x0, y, z1, x1, y + 1.1, z1 + 0.08, { invisible: true }); }
      else { B(x0 - 0.08, y, z0, x0, y + 1.1, z1, { invisible: true }); B(x1, y, z0, x1 + 0.08, y + 1.1, z1, { invisible: true }); }
      railVisual(x0, z0, x1, z1, y, dx !== 0);
      // lights along it
      for (let d = a0 + 4; d < a1 - 2; d += 8) L(cx + dx * d, y + 1.3, cz + dz * d, 6, [1, 0.75, 0.4], 1.0);
    };
    const railMat = psxMaterial({ color: 0xc89a30, emissive: 0x2a1c04 });
    const railVisual = (x0, z0, x1, z1, y, alongX) => {
      const len = alongX ? x1 - x0 : z1 - z0;
      for (const side of [0, 1]) {
        const g = new THREE.Group();
        for (const hgt of [1.05, 0.55]) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.06, 0.06, alongX ? 0.06 : len), railMat);
          bar.position.set(alongX ? (x0 + x1) / 2 : (side ? x1 + 0.04 : x0 - 0.04), y + hgt, alongX ? (side ? z1 + 0.04 : z0 - 0.04) : (z0 + z1) / 2);
          g.add(bar);
        }
        for (let t = 0; t <= len; t += 1.5) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), railMat);
          post.position.set(alongX ? x0 + t : (side ? x1 + 0.04 : x0 - 0.04), y + 0.55, alongX ? (side ? z1 + 0.04 : z0 - 0.04) : z0 + t);
          g.add(post);
        }
        S.add(g);
      }
    };
    // top catwalk joins the corridor at z=-60 (= cz + 34)
    catwalk([0, 1], -6, PLAT + 0.2, R + 0.5, 'top');
    // landings for each sector stop
    this.landings = [];
    for (let i = 1; i < STOPS.length; i++) {
      const st = STOPS[i];
      const [dx, dz] = st.dir;
      catwalk(st.dir, st.y, PLAT + 0.2, R - 0.5);
      // portal frame in the shaft wall
      const px = cx + dx * (R - 0.3), pz = cz + dz * (R - 0.3);
      const deep = st.id === 'b7';
      const frame = (ax0, ay0, az0, ax1, ay1, az1) => B(ax0, ay0, az0, ax1, ay1, az1, deep ? { stone: true } : { prop: true });
      if (dx !== 0) {
        frame(px - 0.6, st.y, pz - 2.4, px + 0.6, st.y + 3.6, pz - 1.6);
        frame(px - 0.6, st.y, pz + 1.6, px + 0.6, st.y + 3.6, pz + 2.4);
        frame(px - 0.6, st.y + 3.0, pz - 2.4, px + 0.6, st.y + 3.6, pz + 2.4);
      } else {
        frame(px - 2.4, st.y, pz - 0.6, px - 1.6, st.y + 3.6, pz + 0.6);
        frame(px + 1.6, st.y, pz - 0.6, px + 2.4, st.y + 3.6, pz + 0.6);
        frame(px - 2.4, st.y + 3.0, pz - 0.6, px + 2.4, st.y + 3.6, pz + 0.6);
      }
      // a dark doorway leaf behind the frame
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.0), new THREE.MeshBasicMaterial({ color: deep ? 0x120202 : 0x050607 }));
      leaf.position.set(cx + dx * (R + 0.4), st.y + 1.5, cz + dz * (R + 0.4));
      leaf.lookAt(cx, st.y + 1.5, cz);
      S.add(leaf);
      // landing sign
      const sign = this.signMesh(st.code, deep ? 'DO NOT' : st.name, deep);
      sign.position.set(cx + dx * (R - 0.8), st.y + 4.3, cz + dz * (R - 0.8));
      sign.lookAt(cx, st.y + 4.3, cz);
      S.add(sign);
      L(cx + dx * (R - 2), st.y + 3.2, cz + dz * (R - 2), 10, deep ? [1, 0.15, 0.08] : [1, 0.85, 0.6], 1.8);
      const stopIndex = i;
      this.landings.push({ i, x: px - dx * 1.5, y: st.y, z: pz - dz * 1.5 });
      this.interact.push({
        pos: new THREE.Vector3(px - dx * 0.8, st.y + 1.4, pz - dz * 0.8), r: 2.4,
        label: () => `Enter ${STOPS[stopIndex].code} — ${STOPS[stopIndex].name}`,
        act: () => G.travel.toSector(STOPS[stopIndex].id),
      });
      // call button at the landing
      this.interact.push({
        pos: new THREE.Vector3(cx + dx * (R - 4), st.y + 1.2, cz + dz * (R - 4) + (dx !== 0 ? 1.7 : 0) + (dz !== 0 ? 0 : 0)), r: 1.6,
        label: () => (this.platformAt(stopIndex) ? null : 'Call freight platform'),
        act: () => this.sendPlatform(stopIndex),
      });
    }
    this.interact.push({
      pos: new THREE.Vector3(cx + 1.7, -6 + 1.2, cz + 30), r: 1.6,
      label: () => (this.platformAt(0) ? null : 'Call freight platform'),
      act: () => this.sendPlatform(0),
    });

    // shaft wall: an open cylinder, vertex-lit by its ring lights
    const H = SHAFT.top - SHAFT.bottom;
    const cyl = new THREE.CylinderGeometry(R + 0.4, R + 0.4, H, 56, Math.round(H / 3), true);
    cyl.translate(cx, (SHAFT.top + SHAFT.bottom) / 2, cz);
    const uv = cyl.attributes.uv, pos = cyl.attributes.position;
    const bake = new Float32Array(pos.count * 3);
    const rings = [];
    for (let y = SHAFT.top - 12; y > SHAFT.bottom + 20; y -= 18) rings.push(y);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) - cx, y = pos.getY(i), z = pos.getZ(i) - cz;
      uv.setXY(i, uv.getX(i) * (2 * Math.PI * R) / 4, y / 4);
      let lr = 0.006, lg = 0.007, lb = 0.009;
      for (const ry of rings) { const k = Math.exp(-((y - ry) ** 2) / 26); lr += k * 1.3; lg += k * 1.22; lb += k * 1.05; }
      for (let s = 1; s < STOPS.length; s++) {
        const st = STOPS[s];
        const ang = Math.atan2(z, x), sa = Math.atan2(st.dir[1], st.dir[0]);
        let da = Math.abs(ang - sa); if (da > Math.PI) da = 2 * Math.PI - da;
        const k = Math.exp(-(da * da) / 0.03) * Math.exp(-((y - st.y - 3) ** 2) / 30);
        const red = st.id === 'b7';
        lr += k * 1.4; lg += k * (red ? 0.15 : 1.0); lb += k * (red ? 0.08 : 0.6);
      }
      bake[i * 3] = lr; bake[i * 3 + 1] = lg; bake[i * 3 + 2] = lb;
    }
    cyl.setAttribute('bake', new THREE.BufferAttribute(bake, 3));
    const wall = new THREE.Mesh(cyl, psxMaterial({ map: tex('concrete_wall'), color: 0xb0b0a8, side: THREE.BackSide, bake: true }));
    S.add(wall);
    // ring lights: fog-free so they recede into the depths like a dotted tunnel,
    // dimmed by distance by hand (see the updater below)
    const ringGeo = new THREE.TorusGeometry(R + 0.05, 0.32, 4, 64);
    const ringList = [];
    for (const ry of rings) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xfff1d0, fog: false });
      const t = new THREE.Mesh(ringGeo, mat);
      t.rotation.x = Math.PI / 2; t.position.set(cx, ry, cz); S.add(t);
      ringList.push({ y: ry, mat });
    }
    // little lit windows of rooms nobody can reach, scattered all the way down
    const winGeo = new THREE.PlaneGeometry(1.6, 0.9);
    const rw = rng(4242);
    for (let i = 0; i < 90; i++) {
      const a = rw() * Math.PI * 2, y = SHAFT.top - 20 - rw() * (H - 60);
      const mat = new THREE.MeshBasicMaterial({ color: rw() < 0.15 ? 0xff5030 : rw() < 0.5 ? 0xd8e8ff : 0xffd8a0, fog: false });
      const w = new THREE.Mesh(winGeo, mat);
      w.position.set(cx + Math.cos(a) * (R + 0.3), y, cz + Math.sin(a) * (R + 0.3));
      w.lookAt(cx, y, cz);
      S.add(w);
      ringList.push({ y, mat, base: mat.color.clone() });
    }
    this.updaters.push(() => {
      const camY = G.camera.position.y;
      for (const r of ringList) {
        const k = Math.exp(-Math.abs(r.y - camY) / 140);
        if (r.base) r.mat.color.copy(r.base).multiplyScalar(0.25 + 0.75 * k);
        else r.mat.color.setRGB(1 * k + 0.04, 0.94 * k + 0.035, 0.82 * k + 0.03);
      }
    });
    // vertical things in the shaft get vertex light from the rings too
    const shaftBake = (geo) => {
      const p = geo.attributes.position, b = new Float32Array(p.count * 3);
      geo.computeBoundingBox();
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i) + (geo.userData.oy || 0);
        let l = 0.05;
        for (const ry of rings) l += Math.exp(-((y - ry) ** 2) / 26) * 0.9;
        b[i * 3] = l; b[i * 3 + 1] = l * 0.95; b[i * 3 + 2] = l * 0.85;
      }
      geo.setAttribute('bake', new THREE.BufferAttribute(b, 3));
    };
    // the guide columns of the freight platform
    const colMat = psxMaterial({ map: tex('metal_rusty'), color: 0x8a8a8a, bake: true });
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = cx + ox * (PLAT + 0.6), z = cz + oz * (PLAT + 0.6);
      const g = new THREE.BoxGeometry(0.6, H, 0.6, 1, Math.round(H / 3), 1);
      const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i), u.getY(i) * H / 3);
      g.userData.oy = (SHAFT.top + SHAFT.bottom) / 2; shaftBake(g);
      const m = new THREE.Mesh(g, colMat); m.position.set(x, (SHAFT.top + SHAFT.bottom) / 2, z); S.add(m);
      this.G.collider.add({ x0: x - 0.3, x1: x + 0.3, y0: SHAFT.bottom, y1: SHAFT.top, z0: z - 0.3, z1: z + 0.3, mat: 'metal' });
    }
    // huge pipes running down the wall
    const pipeMat = psxMaterial({ map: tex('metal_rusty'), color: 0x707060, bake: true });
    for (let k = 0; k < 7; k++) {
      const a = k * 0.9 + 0.4;
      const g = new THREE.CylinderGeometry(1.1, 1.1, H, 8, Math.round(H / 3), true);
      g.userData.oy = (SHAFT.top + SHAFT.bottom) / 2; shaftBake(g);
      const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 2, u.getY(i) * H / 4);
      const m = new THREE.Mesh(g, pipeMat);
      m.position.set(cx + Math.cos(a) * (R - 1.0), (SHAFT.top + SHAFT.bottom) / 2, cz + Math.sin(a) * (R - 1.0));
      S.add(m);
    }
    // far below: the floor is never quite visible. above: a sealed hatch.
    const cap = new THREE.Mesh(new THREE.CircleGeometry(R + 0.5, 32), psxMaterial({ map: tex('metal_plate'), color: 0x404040 }));
    cap.rotation.x = Math.PI / 2; cap.position.set(cx, SHAFT.top, cz); S.add(cap);

    // the freight platform (moves)
    const plat = new THREE.Group();
    const deckG = new THREE.BoxGeometry(PLAT * 2, 0.4, PLAT * 2);
    const du = deckG.attributes.uv; for (let i = 0; i < du.count; i++) du.setXY(i, du.getX(i) * 4, du.getY(i) * 4);
    const deck = new THREE.Mesh(deckG, psxMaterial({ map: tex('metal_plate') }));
    deck.position.y = -0.2; plat.add(deck);
    const stripeMat = psxMaterial({ map: tex('hazard_stripes') });
    for (const [w, d, x, z] of [[PLAT * 2, 0.3, 0, -PLAT + 0.15], [PLAT * 2, 0.3, 0, PLAT - 0.15], [0.3, PLAT * 2, -PLAT + 0.15, 0], [0.3, PLAT * 2, PLAT - 0.15, 0]]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), stripeMat); s.position.set(x, 0.01, z); plat.add(s);
    }
    // low railings with gaps in the middle of each side
    const platRailMat = psxMaterial({ color: 0xb08a20 });
    for (const side of [-1, 1]) for (const half of [-1, 1]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(PLAT - 1, 1.0, 0.08), platRailMat);
      a.position.set(half * (PLAT + 1) / 2, 0.5, side * PLAT); plat.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, PLAT - 1), platRailMat);
      b.position.set(side * PLAT, 0.5, half * (PLAT + 1) / 2); plat.add(b);
    }
    // control pedestal
    const ped = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.4), psxMaterial({ map: tex('metal_panel') }));
    ped.position.set(PLAT - 0.6, 0.55, PLAT - 0.6); plat.add(ped);
    const btn = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), new THREE.MeshBasicMaterial({ color: 0x40ff60 }));
    btn.position.set(PLAT - 0.6, 1.0, PLAT - 0.39); plat.add(btn);
    this.platBtn = btn;
    // work lamp + rotating amber beacon
    const lamp = new THREE.PointLight(0xffc080, 12, 16, 1.6);
    lamp.position.set(0, 3.2, 0); plat.add(lamp);
    const beacon = new THREE.SpotLight(0xffa020, 0, 40, 0.5, 0.5, 1.2);
    beacon.position.set(-PLAT + 0.6, 1.4, -PLAT + 0.6);
    const bt = new THREE.Object3D(); bt.position.set(-PLAT + 0.6 + 5, 1.4, -PLAT + 0.6); plat.add(bt);
    beacon.target = bt; plat.add(beacon);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: 0x553300 }));
    bulb.position.copy(beacon.position); plat.add(bulb);
    this.beacon = { light: beacon, target: bt, bulb };
    plat.position.set(cx, this.platformY, cz);
    S.add(plat);
    this.platform = plat;
    this.platBox = this.G.collider.add({ x0: cx - PLAT, x1: cx + PLAT, y0: this.platformY - 0.4, y1: this.platformY, z0: cz - PLAT, z1: cz + PLAT, dynamic: true, mat: 'metal' });
    // railing collision (dynamic: rides with the platform). Gates close while moving.
    this.platRails = [];
    const rail = (x0, z0, x1, z1, gate = false) => {
      const b = this.G.collider.add({ x0: cx + x0, x1: cx + x1, y0: 0, y1: 0, z0: cz + z0, z1: cz + z1, dynamic: true, gate, mat: 'metal' });
      this.platRails.push(b); return b;
    };
    for (const s of [-1, 1]) {
      rail(-PLAT, s * PLAT - 0.05, -1, s * PLAT + 0.05); rail(1, s * PLAT - 0.05, PLAT, s * PLAT + 0.05);
      rail(s * PLAT - 0.05, -PLAT, s * PLAT + 0.05, -1); rail(s * PLAT - 0.05, 1, s * PLAT + 0.05, PLAT);
      rail(-1, s * PLAT - 0.05, 1, s * PLAT + 0.05, true); rail(s * PLAT - 0.05, -1, s * PLAT + 0.05, 1, true);
    }
    this.syncPlatform();
    this.interact.push({
      pos: { get x() { return cx + PLAT - 0.6; }, get y() { return G.under.platformY + 1.0; }, get z() { return cz + PLAT - 0.6; } },
      r: 1.6,
      label: () => (this.platformTarget !== null ? null : 'Freight controls'),
      act: () => G.hud.elevatorMenu(STOPS, (i) => this.sendPlatform(i)),
    });
    this.updaters.push((dt) => this.updatePlatform(dt));
  }

  signMesh(code, name, red) {
    const t = canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = red ? '#2a0806' : '#d8c890'; g.fillRect(0, 0, w, h);
      g.fillStyle = red ? '#7a1a10' : '#1a1a1a'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
      g.fillStyle = red ? '#c03020' : '#141414';
      g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.fillText(code, w / 2, 36);
      g.font = '9px monospace'; g.fillText(name.toUpperCase().slice(0, 26), w / 2, 52);
    }, { repeat: false });
    return new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), psxMaterial({ map: t, emissive: red ? 0x200000 : 0x262218, side: THREE.DoubleSide }));
  }

  platformAt(i) { return this.platformTarget === null && Math.abs(this.platformY - STOPS[i].y) < 0.05; }

  sendPlatform(i) {
    const G = this.G;
    if (!G.game.stopUnlocked(i)) {
      G.audio.play('deny');
      G.hud.toast(i === 7 ? 'The B-7 button has been scratched out. It does nothing.' : `${STOPS[i].code}: NO POWER — landing locked out at the level relay`);
      return;
    }
    if (this.platformAt(i)) return;
    this.platformTarget = i;
    this.platVel = 0;
    G.audio.play('elevator_start', { position: this.platform.position });
    this.motor = G.audio.startLoop('elevator_motor', { volume: 0.7 });
  }

  updatePlatform(dt) {
    const G = this.G;
    if (this.platformTarget !== null) {
      const ty = STOPS[this.platformTarget].y;
      const d = ty - this.platformY;
      const maxV = 11, acc = 3;
      const want = Math.sign(d) * Math.min(maxV, Math.sqrt(2 * acc * Math.abs(d)));
      this.platVel = damp(this.platVel || 0, want, 2, dt);
      let step = this.platVel * dt;
      if (Math.abs(step) >= Math.abs(d) || Math.abs(d) < 0.02) {
        step = d; this.platformTarget = null; this.platVel = 0;
        G.audio.play('elevator_stop', { position: this.platform.position });
        if (this.motor) { this.motor.stop(); this.motor = null; }
      }
      // carry the player if standing on the platform
      const p = G.player;
      const onPlat = Math.abs(p.x - SHAFT.x) < PLAT + 0.1 && Math.abs(p.z - SHAFT.z) < PLAT + 0.1 && Math.abs(p.y - this.platformY) < 0.5;
      this.platformY += step;
      if (onPlat) { p.y = this.platformY; p.vy = 0; p.onGround = true; p.eyeY += step; G.shake = Math.max(G.shake || 0, 0.015); }
      if (this.motor) this.motor.setRate(0.6 + Math.abs(this.platVel) / maxV * 0.8);
    }
    this.syncPlatform();
    // beacon spins while moving
    const moving = this.platformTarget !== null;
    this.beacon.light.intensity = moving ? 30 : 0;
    this.beacon.bulb.material.color.setHex(moving ? 0xffa020 : 0x553300);
    const a = this.t * 4;
    this.beacon.target.position.set(-PLAT + 0.6 + Math.cos(a) * 5, 1.4, -PLAT + 0.6 + Math.sin(a) * 5);
    this.platBtn.material.color.setHex(moving ? 0xff4020 : 0x40ff60);
  }

  syncPlatform() {
    const y = this.platformY;
    this.platform.position.y = y;
    this.platBox.y0 = y - 0.4; this.platBox.y1 = y;
    const moving = this.platformTarget !== null;
    for (const b of this.platRails) { b.y0 = y; b.y1 = y + 1.05; b.disabled = b.gate && !moving; }
  }

  addFixtures(S, lights, theme) {
    const col = this.G.collider;
    const geo = new THREE.BoxGeometry(1.0, 0.06, 0.3);
    const mats = new Map();
    for (const L of lights) {
      if (L.noFixture) continue;
      const c = new THREE.Color(L.c[0], L.c[1], L.c[2]);
      const hex = c.getHex();
      if (!mats.has(hex)) {
        const m = c.clone(); const mx = Math.max(m.r, m.g, m.b) || 1; m.multiplyScalar(1.4 / mx);
        mats.set(hex, new THREE.MeshBasicMaterial({ color: m }));
      }
      const mesh = new THREE.Mesh(L.torch ? TORCH_GEO : geo, mats.get(hex));
      let y = L.y;
      if (!L.torch) {
        const ceil = col.ceilingAt(L.x, L.z, L.y - 0.1);
        if (ceil - L.y < 3) y = ceil - 0.04;
      }
      mesh.position.set(L.x, y, L.z);
      S.add(mesh);
    }
  }

  addProp(S, name, x, y, z, height, rot) {
    if (!name) return null;
    const m = modelMesh(name, { height });
    if (!m) return null;
    m.position.set(x, y, z); m.rotation.y = rot || 0;
    S.add(m);
    return m;
  }

  addNote(S, noteId, x, y, z, terminal = false) {
    const G = this.G;
    let mesh;
    if (terminal && pickModel('computer_small')) {
      mesh = modelMesh('computer_small', { height: 0.45 });
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), new THREE.MeshBasicMaterial({ color: 0x2a8a3a }));
      screen.position.set(0, 0.28, 0.13);
      mesh.add(screen);
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.01, 0.32), psxMaterial({ map: PAPER(), emissive: 0x222222 }));
      mesh.rotation.y = Math.random() * 6.28;
    }
    mesh.position.set(x, y, z);
    S.add(mesh);
    this.interact.push({
      pos: new THREE.Vector3(x, y + 0.15, z), r: 1.6,
      label: () => (G.state.notesRead.includes(noteId) ? 'Read again' : terminal ? 'Read the terminal' : 'Read'),
      act: () => G.game.readNote(noteId),
    });
    return mesh;
  }

  // ===================================================================================
  // SECTORS
  // ===================================================================================

  async loadSectorData(id) {
    if (this.sectorCache.has(id)) return this.sectorCache.get(id);
    const r = await fetch(`./assets/sectors/${id}.json`);
    const d = await r.json();
    this.sectorCache.set(id, d);
    return d;
  }

  buildSector(d) {
    const G = this.G, col = G.collider;
    const theme = THEMES[d.theme] || THEMES.admin;
    const S = this.newScene(theme);
    const st = G.game.sectorState(d.id);
    this.sector = d; this.theme = theme;
    const boxes = [];
    const zones = d.zones;
    const cellM = d.cell * Q;

    // brushes -> boxes
    for (const br of d.brushes) {
      const [bx0, by0, bz0, bx1, by1, bz1, flags, zone, extra] = br;
      const b = {
        x0: bx0 * Q, x1: bx1 * Q, y0: bz0 * Q, y1: bz1 * Q, z0: -by1 * Q, z1: -by0 * Q,
        floor: !!(flags & 1), ceil: !!(flags & 2), zone: zones[zone] || 'corridor',
      };
      if (extra && extra[0] === 's') b.slope = { top: b.floor, v: extra.slice(1, 5).map((v) => v * Q) };
      if (extra && extra[0] === 'c') {
        const U = { sw: [0, 0], se: [1, 0], nw: [0, 1], ne: [1, 1] };
        const tris = { sw: ['sw', 'se', 'nw'], se: ['se', 'ne', 'sw'], nw: ['nw', 'sw', 'ne'], ne: ['ne', 'nw', 'se'] };
        const t = tris[extra[1]] || tris.sw;
        b.tri = t.map((k) => [b.x0 + U[k][0] * (b.x1 - b.x0), b.z1 - U[k][1] * (b.z1 - b.z0)]);
      }
      const h = b.y1 - b.y0, w = b.x1 - b.x0, dd = b.z1 - b.z0;
      if (h <= 1.6 && w <= 6 && dd <= 6 && b.floor && !b.slope) b.prop = true;
      boxes.push(b);
      col.add(b);
    }

    // lights
    const lights = [];
    const lc = theme.light;
    for (const e of d.entities) {
      if (e.k === 'light') {
        const r = clamp((e.intensity || 200) * Q * 1.6, 6, 18);
        lights.push({ x: e.p[0] * Q, y: e.p[2] * Q, z: -e.p[1] * Q, r, c: lc.map((v) => v * theme.strength) });
      } else if (e.k === 'torch') {
        const r = clamp((e.intensity || 170) * Q * 1.3, 4, 10);
        lights.push({ x: e.p[0] * Q, y: e.p[2] * Q, z: -e.p[1] * Q, r, c: [1.6, 0.7, 0.25], torch: true });
      }
    }
    // the fake sky / grow lights over open yards
    const zTop = d.z_range[1] * Q;
    if (d.sky.length) {
      const skyC = theme.grow ? [0.9, 0.5, 1.1] : theme.fakeSky ? [1.2, 0.75, 0.55] : [0.5, 0.55, 0.6];
      for (let i = 0; i < d.sky.length; i += 9) {
        const [cx, cy] = d.sky[i];
        lights.push({ x: (cx + 0.5) * cellM, y: zTop + 2, z: -(cy + 0.5) * cellM, r: 16, c: skyC, noFixture: true });
      }
    }
    // air map from BadLevel's open spans: faces that only face the void are never meshed
    const airMap = new Map();
    const skySet = new Set(d.sky.map(([x, y]) => x * 10000 + y));
    for (const sp of d.spans) {
      const k = sp[0] * 10000 + sp[1];
      const list = [];
      for (let i = 2; i + 1 < sp.length; i += 2) list.push([sp[i] * Q - 0.6, sp[i + 1] * Q + 0.6]);
      if (skySet.has(k) && list.length) list[list.length - 1][1] = Infinity;
      airMap.set(k, list);
    }
    const isAir = (x, y, z) => {
      const cx = Math.floor(x / cellM), cy = Math.floor(-z / cellM);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const list = airMap.get((cx + dx) * 10000 + cy + dy);
        if (list) for (const [f, c] of list) if (y >= f && y <= c) return true;
      }
      return false;
    };
    for (const m of this.buildBrushes(boxes, lights, theme, isAir)) S.add(m);
    this.addFixtures(S, lights, theme);
    this.lights = lights;

    // cavern roof / fake sky over open cells
    if (d.sky.length) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [cx, cy] of d.sky) { minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy); }
      const w = (maxX - minX + 6) * cellM, h = (maxY - minY + 6) * cellM;
      const roofMat = theme.fakeSky
        ? new THREE.MeshBasicMaterial({ color: 0x5a3a30, fog: false })
        : theme.grow ? new THREE.MeshBasicMaterial({ color: 0x2a1030 }) : psxMaterial({ map: tex('rock_cliff'), color: 0x202020 });
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(w, h), roofMat);
      roof.rotation.x = Math.PI / 2;
      roof.position.set((minX + maxX + 1) / 2 * cellM, zTop + 6, -(minY + maxY + 1) / 2 * cellM);
      S.add(roof);
      if (theme.grow || theme.fakeSky) {
        // grid of glowing panels
        const pm = new THREE.MeshBasicMaterial({ color: theme.grow ? 0xd080ff : 0xffb070 });
        for (let i = 0; i < d.sky.length; i += 6) {
          const [cx, cy] = d.sky[i];
          const p = new THREE.Mesh(new THREE.PlaneGeometry(cellM * 0.8, cellM * 0.8), pm);
          p.rotation.x = Math.PI / 2; p.position.set((cx + 0.5) * cellM, zTop + 5.9, -(cy + 0.5) * cellM);
          S.add(p);
        }
      }
    }

    // water
    this.waterMap = new Map();
    if (d.water.length) {
      const pos = [], idx = [];
      for (const [cx, cy, wz] of d.water) {
        const y = wz * Q, x0 = cx * cellM, x1 = (cx + 1) * cellM, z0 = -(cy + 1) * cellM, z1 = -cy * cellM;
        const n = pos.length / 3;
        pos.push(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0);
        idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
        this.waterMap.set(cx * 10000 + cy, y);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const wm = psxMaterial({ color: theme.water, transparent: true, opacity: 0.72, emissive: new THREE.Color(theme.water).multiplyScalar(0.25), depthWrite: false });
      S.add(new THREE.Mesh(g, wm));
    }
    this.hazardSet = new Set(d.hazards.map(([x, y]) => x * 10000 + y));

    // entities
    const enemySpots = [];
    let start = null;
    d.entities.forEach((e, idx) => {
      const x = e.p[0] * Q, y = e.p[2] * Q, z = -e.p[1] * Q;
      const box = e.b ? { x0: e.b[0][0] * Q, x1: e.b[1][0] * Q, y0: e.b[0][2] * Q, y1: e.b[1][2] * Q, z0: -e.b[1][1] * Q, z1: -e.b[0][1] * Q } : null;
      switch (e.k) {
        case 'player_start': start = { x, y, z, idx, angle: e.angle }; break;
        case 'enemy': enemySpots.push({ x, y, z }); break;
        case 'door': this.makeDoor(S, d, idx, box, e.key || 'red', st, false); break;
        case 'secret_door': this.makeDoor(S, d, idx, box, null, st, true); break;
        case 'key': this.makeKey(S, d, idx, x, y, z, e.color || 'red', st); break;
        case 'lift': this.makeLift(S, box, e.low * Q, e.high * Q); break;
        case 'ladder': this.makeLadder(S, box); break;
        case 'window': if (box) this.makeWindow(S, box); break;
        case 'exit': this.makeRelay(S, d, idx, x, y, z, st); break;
        case 'health': case 'ammo': case 'armor': case 'megahealth': case 'weapon':
          this.makeItem(S, d, idx, e.k, x, y, z, st); break;
        case 'trap': this.traps.push({ x, y, z, axis: e.axis, t: 0 }); break;
        default: break;
      }
    });

    // notes, placed in rooms by job
    const used = new Set();
    for (const nid of SECTOR_NOTES[d.id] || []) {
      const note = G.notes[nid];
      let room = null;
      for (const prog of note.rooms || []) {
        room = d.rooms.find((r) => r.program === prog && !used.has(r.id));
        if (room) break;
      }
      if (!room) room = d.rooms.find((r) => !used.has(r.id) && r.kind !== 'start');
      if (!room) continue;
      used.add(room.id);
      const rr = rng(room.id * 31 + 7);
      const cx = (room.x + room.w * (0.3 + rr() * 0.4)) * cellM, cz = -(room.y + room.h * (0.3 + rr() * 0.4)) * cellM;
      const gy = col.groundAt(cx, cz, room.ceil * Q - 0.5);
      if (!isFinite(gy)) continue;
      this.addNote(S, nid, cx, gy + 0.01, cz, ['server', 'control', 'lab', 'security', 'office'].includes(room.program) && rr() < 0.6);
    }

    // set dressing: a few CC0 props per room, never on the walkways
    this.dressRooms(S, d, theme, used);

    // the way back
    this.startPos = start || { x: 0, y: 0, z: 0 };
    const sr = d.rooms.find((r) => r.kind === 'start') || d.rooms[0];
    const rcx = (sr.x + sr.w / 2) * cellM, rcz = -(sr.y + sr.h / 2) * cellM;
    this.startYaw = Math.atan2(-(rcx - this.startPos.x), -(rcz - this.startPos.z));
    if (start && start.angle !== undefined) {
      // Quake angle: degrees, 0 = east, 90 = north (BadLevel +y = three.js -z)
      const a = start.angle * Math.PI / 180;
      this.startYaw = Math.atan2(-Math.cos(a), Math.sin(a));
    }
    const panel = new THREE.Group();
    const pb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.25), psxMaterial({ map: tex('metal_panel') }));
    pb.position.y = 0.7; panel.add(pb);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), new THREE.MeshBasicMaterial({ color: 0xffb020 }));
    pl.position.set(0, 1.05, 0.13); panel.add(pl);
    const bx = this.startPos.x - Math.sin(this.startYaw) * -1.2, bz = this.startPos.z - Math.cos(this.startYaw) * -1.2;
    panel.position.set(bx, col.groundAt(bx, bz, this.startPos.y + 1.5), bz);
    panel.rotation.y = this.startYaw;
    S.add(panel);
    this.interact.push({ pos: new THREE.Vector3(bx, panel.position.y + 1, bz), r: 1.8, label: () => 'Freight landing — back to the shaft', act: () => G.travel.toHub(STOPS.findIndex((s) => s.id === d.id)) });

    // shades
    this.spawnSpots = enemySpots.filter((s) => Math.hypot(s.x - this.startPos.x, s.z - this.startPos.z) > 30);
    const n = Math.min(d.stalkers || 0, this.spawnSpots.length);
    const r = rng(d.seed * 13);
    for (let i = 0; i < n; i++) this.shades.push(new Shade(this, S, this.spawnSpots[(r() * this.spawnSpots.length) | 0]));

    this.updaters.push((dt) => this.updateSector(dt));
    return S;
  }

  dressRooms(S, d, theme, used) {
    const col = this.G.collider;
    const cellM = d.cell * Q;
    const r = rng(d.seed);
    const sets = {
      admin: ['desk', 'office_chair', 'trashcan_small', 'houseplant', 'closet', 'computer_small'],
      residential: ['couch', 'table_round', 'chair_1', 'bookshelf', 'fridge', 'lamp_floor', 'bed_single', 'trashcan'],
      research: ['computer', 'capsule', 'vessel', 'vessel_tall', 'machine_base', 'shelf', 'crate'],
      hydro: ['vessel_short', 'vessel', 'plant_1', 'plant_2', 'bush_1', 'crate', 'container'],
      reactor: ['machine_base', 'container', 'crate_long', 'gas_can', 'propane_tank', 'pipes', 'shelf_tall'],
      flooded: ['crate', 'container', 'gas_can', 'trashcan', 'pipes_long'],
      deep: ['statue', 'column', 'chest', 'bonfire'],
    };
    const names = (sets[d.theme] || sets.admin).filter((n) => modelGeom(n));
    if (!names.length) return;
    for (const room of d.rooms) {
      if (room.w < 6 || room.h < 6 || room.kind === 'start') continue;
      const k = 1 + Math.floor((room.w * room.h) / 70);
      for (let i = 0; i < Math.min(k, 5); i++) {
        // hug the walls: pick a point 1.5 m inside the room edge
        const side = (r() * 4) | 0;
        let cx, cy;
        const inset = 1.6 / cellM;
        if (side === 0) { cx = room.x + inset; cy = room.y + 1 + r() * (room.h - 2); }
        else if (side === 1) { cx = room.x + room.w - inset; cy = room.y + 1 + r() * (room.h - 2); }
        else if (side === 2) { cy = room.y + inset; cx = room.x + 1 + r() * (room.w - 2); }
        else { cy = room.y + room.h - inset; cx = room.x + 1 + r() * (room.w - 2); }
        const x = cx * cellM, z = -cy * cellM;
        const floorY = room.floor * Q;
        const gy = col.groundAt(x, z, floorY + 0.3);
        if (!isFinite(gy) || Math.abs(gy - floorY) > 0.3) continue;
        // keep it out of doorways: something solid must be within 1.2 m (a wall)
        const name = names[(r() * names.length) | 0];
        const g = modelGeom(name);
        const m = new THREE.Mesh(g, modelMaterial('dim', { color: 0x9a9a9a }));
        const rot = [Math.PI / 2, -Math.PI / 2, 0, Math.PI][side];
        m.rotation.y = rot;
        m.position.set(x, gy, z);
        m.castShadow = true; m.receiveShadow = true;
        // bake-ish: tint by nearest lights so props aren't fluorescent in the dark
        S.add(m);
        const bb = g.boundingBox;
        const hw = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.45;
        if (hw > 0.3) col.add({ x0: x - hw, x1: x + hw, y0: gy, y1: gy + (bb.max.y - bb.min.y), z0: z - hw, z1: z + hw, dynamic: false, noCull: true, mat: 'metal' });
      }
    }
  }

  makeDoor(S, d, idx, box, color, st, secret) {
    if (!box) return;
    const G = this.G;
    const open = st.doors.includes(idx);
    const w = box.x1 - box.x0, h = box.y1 - box.y0, dd = box.z1 - box.z0;
    const mat = secret ? this.matFor(`${this.theme.wall}|${this.theme.wallTint}`) : psxMaterial({ map: tex('metal_panel'), color: 0x9aa0a0 });
    const g = new THREE.BoxGeometry(w, h, dd);
    const m = new THREE.Mesh(g, secret ? psxMaterial({ map: tex(this.theme.wall), color: this.theme.wallTint }) : mat);
    m.position.set((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2);
    S.add(m);
    const KC = { red: 0xd02020, blue: 0x2050e0, yellow: 0xe0c020 };
    if (color) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.18, dd + 0.02), new THREE.MeshBasicMaterial({ color: KC[color] || 0xd02020 }));
      stripe.position.y = h * 0.15; m.add(stripe);
    }
    const cb = G.collider.add({ ...box, dynamic: true, mat: 'metal' });
    const door = { m, cb, open, t: open ? 1 : 0, h };
    if (open) { cb.disabled = true; m.position.y += h - 0.1; }
    this.doors.push(door);
    this.interact.push({
      pos: new THREE.Vector3(m.position.x, box.y0 + 1.3, m.position.z), r: 2.6,
      label: () => {
        if (door.open) return null;
        if (secret) return 'This panel sounds hollow — push it';
        return G.game.hasKey(d.id, color) ? `Open (${color.toUpperCase()} card)` : `Locked — ${color.toUpperCase()} clearance`;
      },
      act: () => {
        if (door.open) return;
        if (!secret && !G.game.hasKey(d.id, color)) { G.audio.play('deny', { position: m.position }); return; }
        if (!secret) G.audio.play('keycard', { position: m.position });
        door.open = true; st.doors.push(idx);
        G.audio.play('door_slide', { position: m.position });
        if (secret) G.game.discover('Hidden passage');
      },
    });
  }

  makeKey(S, d, idx, x, y, z, color, st) {
    const G = this.G;
    if (st.taken.includes(idx)) return;
    const KC = { red: 0xff3030, blue: 0x3070ff, yellow: 0xffd030 };
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.14), new THREE.MeshBasicMaterial({ color: KC[color] || 0xff3030 }));
    const gy = G.collider.groundAt(x, z, y + 1);
    card.position.set(x, (isFinite(gy) ? gy : y) + 0.9, z);
    S.add(card);
    const glow = new THREE.PointLight(KC[color] || 0xff3030, 2, 4, 2);
    card.add(glow);
    this.spinners.push(card);
    const it = {
      pos: card.position, r: 1.8,
      label: () => (card.visible ? `Take ${color.toUpperCase()} keycard` : null),
      act: () => { card.visible = false; st.taken.push(idx); G.game.addKey(d.id, color); },
    };
    this.interact.push(it);
  }

  makeItem(S, d, idx, kind, x, y, z, st) {
    const G = this.G;
    if (st.taken.includes(idx)) return;
    const MAP = {
      health: { item: idx % 3 === 0 ? 'coffee' : 'canned', model: idx % 3 === 0 ? 'soda' : 'can_closed', h: 0.14 },
      ammo: { item: 'battery', model: 'battery_small', h: 0.12 },
      armor: { item: 'scrap', model: 'computer_small', h: 0.3 },
      megahealth: { item: 'medkit', model: 'first_aid_kit', h: 0.22 },
      weapon: { item: 'cache', model: 'chest', h: 0.6 },
    };
    const info = MAP[kind];
    const gy = G.collider.groundAt(x, z, y + 1);
    const py = isFinite(gy) ? gy : y;
    let m = modelMesh(pickModel(info.model) || '', { height: info.h });
    if (!m) m = new THREE.Mesh(new THREE.BoxGeometry(info.h, info.h, info.h), psxMaterial({ color: 0x888866 }));
    m.position.set(x, py, z);
    m.rotation.y = idx * 1.7;
    S.add(m);
    this.interact.push({
      pos: new THREE.Vector3(x, py + 0.2, z), r: 1.7,
      label: () => (m.visible ? G.game.itemLabel(info.item) : null),
      act: () => { m.visible = false; st.taken.push(idx); G.game.takeItem(info.item); },
    });
  }

  makeLift(S, box, low, high) {
    if (!box) return;
    const G = this.G;
    const w = box.x1 - box.x0, dd = box.z1 - box.z0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, dd), psxMaterial({ map: tex('metal_plate') }));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.1, dd + 0.02), psxMaterial({ map: tex('hazard_stripes') }));
    stripe.position.y = -0.1; m.add(stripe);
    S.add(m);
    const startHigh = Math.abs(box.y1 - high) < Math.abs(box.y1 - low);
    const lift = { m, y: startHigh ? high : low, low, high, target: null, idle: 0, box: G.collider.add({ x0: box.x0, x1: box.x1, y0: 0, y1: 0, z0: box.z0, z1: box.z1, dynamic: true, mat: 'metal' }) };
    const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
    lift.cx = cx; lift.cz = cz; lift.hw = w / 2; lift.hd = dd / 2;
    this.lifts.push(lift);
    for (const level of [low, high]) {
      this.interact.push({
        pos: new THREE.Vector3(cx, level + 1, cz), r: Math.max(w, dd) / 2 + 1.6,
        label: () => (lift.target === null && Math.abs(lift.y - level) > 0.1 ? 'Call lift' : null),
        act: () => { lift.target = level; G.audio.play('lift_clank', { position: m.position }); },
      });
    }
  }

  makeLadder(S, box) {
    if (!box) return;
    const wood = psxMaterial({ color: 0x6a6a6a });
    const h = box.y1 - box.y0;
    const g = new THREE.Group();
    const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
    const alongX = (box.x1 - box.x0) > (box.z1 - box.z0);
    for (let y = 0.3; y < h; y += 0.35) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(alongX ? box.x1 - box.x0 : 0.05, 0.04, alongX ? 0.05 : box.z1 - box.z0), wood);
      rung.position.set(0, y, 0); g.add(rung);
    }
    g.position.set(cx, box.y0, cz);
    S.add(g);
    this.ladders.push({ x0: box.x0 - 0.5, x1: box.x1 + 0.5, z0: box.z0 - 0.5, z1: box.z1 + 0.5, y0: box.y0 - 0.5, y1: box.y1 + 0.2 });
  }

  makeWindow(S, box) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(box.x1 - box.x0, box.y1 - box.y0, box.z1 - box.z0),
      psxMaterial({ color: 0x90b0b8, transparent: true, opacity: 0.22, depthWrite: false }));
    m.position.set((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2);
    S.add(m);
    this.G.collider.add({ ...box, dynamic: true, mat: 'glass' });
  }

  makeRelay(S, d, idx, x, y, z, st) {
    const G = this.G;
    const gy = G.collider.groundAt(x, z, y + 1);
    const py = isFinite(gy) ? gy : y;
    const isDeep = d.id === 'b7';
    const g = new THREE.Group();
    if (!isDeep) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.0, 0.5), psxMaterial({ map: tex('metal_panel'), color: 0x8a9090 }));
      body.position.y = 1.0; g.add(body);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.2, 0.52), psxMaterial({ map: tex('hazard_stripes') }));
      stripe.position.y = 0.2; g.add(stripe);
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), psxMaterial({ color: 0xb02020 }));
      lever.position.set(0.3, 1.3, 0.3); lever.rotation.x = st.relay ? -0.9 : 0.9; g.add(lever);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: st.relay ? 0x30ff40 : 0xff3020 }));
      lamp.position.set(-0.3, 1.7, 0.27); g.add(lamp);
      g.userData = { lever, lamp };
    } else {
      // at the bottom of B-7: a stair cut into the rock, red light rising from below
      const arch = new THREE.Mesh(new THREE.BoxGeometry(3, 3.4, 0.6), psxMaterial({ map: tex('castle_stone'), color: 0x806050 }));
      arch.position.y = 1.7; g.add(arch);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2.6), new THREE.MeshBasicMaterial({ color: 0xff2008 }));
      glow.position.set(0, 1.3, 0.31); g.add(glow);
      const pl = new THREE.PointLight(0xff2010, 10, 14, 1.5); pl.position.set(0, 1.5, 1); g.add(pl);
    }
    g.position.set(x, py, z);
    S.add(g);
    this.interact.push({
      pos: new THREE.Vector3(x, py + 1.3, z), r: 2.2,
      label: () => {
        if (isDeep) return 'Descend the carved stair';
        if (st.relay) return null;
        const next = STOPS[STOPS.findIndex((s) => s.id === d.id) + 1];
        return `Close the freight relay (restore power to ${next ? next.code : '?'})`;
      },
      act: () => {
        if (isDeep) { G.travel.toLantern(); return; }
        if (st.relay) return;
        st.relay = true;
        g.userData.lever.rotation.x = -0.9;
        g.userData.lamp.material.color.setHex(0x30ff40);
        G.audio.play('switch', { position: g.position });
        setTimeout(() => G.audio.play('generator_start', { volume: 0.6 }), 400);
        G.game.relayClosed(d.id);
      },
    });
  }

  updateSector(dt) {
    const G = this.G, p = G.player;
    // doors
    for (const dr of this.doors) {
      if (dr.open && dr.t < 1) {
        dr.t = Math.min(1, dr.t + dt / 1.4);
        dr.m.position.y = dr.baseY ?? (dr.baseY = dr.m.position.y);
        dr.m.position.y = dr.baseY + (dr.h - 0.1) * smoothstep(0, 1, dr.t);
        if (dr.t > 0.6) dr.cb.disabled = true;
      }
    }
    // lifts
    for (const L of this.lifts) {
      const onIt = Math.abs(p.x - L.cx) < L.hw && Math.abs(p.z - L.cz) < L.hd && Math.abs(p.y - L.y) < 0.15 && p.onGround;
      if (L.target === null) {
        if (onIt) { L.idle += dt; if (L.idle > 0.7) { L.target = Math.abs(L.y - L.high) < 0.1 ? L.low : L.high; L.idle = 0; G.audio.play('lift_clank', { position: L.m.position }); } }
        else L.idle = 0;
      } else {
        const d = L.target - L.y;
        const step = Math.sign(d) * Math.min(Math.abs(d), 2.6 * dt);
        L.y += step;
        if (onIt) { p.y = L.y; p.vy = 0; p.eyeY += step; }
        if (Math.abs(L.target - L.y) < 1e-3) { L.target = null; L.idle = -2; }
      }
      L.m.position.set(L.cx, L.y - 0.25, L.cz);
      L.box.y0 = L.y - 0.5; L.box.y1 = L.y;
    }
    // spinning keycards
    for (const s of this.spinners) s.rotation.y += dt * 1.5;
    // traps (darts in the deep corridors)
    for (const tr of this.traps) {
      tr.t -= dt;
      if (tr.t <= 0 && Math.abs(p.y - tr.y) < 2.5 && Math.hypot(p.x - tr.x, p.z - tr.z) < 1.2) {
        tr.t = 4;
        G.audio.play('axe_swing', { position: { x: tr.x, y: tr.y, z: tr.z }, rate: 1.6 });
        if (!p.noclip) G.game.hurt(12, 'A dart from the wall!');
      }
    }
    // shades
    let nearest = Infinity;
    for (const s of this.shades) { s.update(dt); nearest = Math.min(nearest, s.dist); }
    this.dangerLevel = nearest < 25 ? 1 - nearest / 25 : 0;
  }

  /** Cell lookup helpers for the current sector. */
  cellAt(x, z) {
    const cm = this.sector.cell * Q;
    return [Math.floor(x / cm), Math.floor(-z / cm)];
  }
  waterAt(x, z) {
    if (!this.waterMap || !this.waterMap.size) return undefined;
    const [cx, cy] = this.cellAt(x, z);
    return this.waterMap.get(cx * 10000 + cy);
  }
  inHazard(x, z) {
    if (!this.hazardSet || !this.hazardSet.size) return false;
    const [cx, cy] = this.cellAt(x, z);
    return this.hazardSet.has(cx * 10000 + cy);
  }

  // ===================================================================================
  // THE LANTERN
  // ===================================================================================

  buildLantern() {
    const G = this.G, col = G.collider;
    const theme = THEMES.deep;
    const S = this.newScene(theme);
    S.fog.density = 0.02;
    S.fog.color.setHex(0x120302);
    const boxes = [], lights = [];
    const B = (x0, y0, z0, x1, y1, z1, o = {}) => { const b = { x0, y0, z0, x1, y1, z1, stone: true, ...o }; boxes.push(b); col.add(b); return b; };
    // a long stair down into a vast round chamber
    for (let i = 0; i < 40; i++) B(-1.6, -30, -i * 0.6 - 0.6, 1.6, -i * 0.3, -i * 0.6, { floor: true });
    B(-2.2, -30, -24, -1.6, 4, 0); B(1.6, -30, -24, 2.2, 4, 0);
    B(-1.6, 3.4, -24, 1.6, 4, 0);
    B(-40, -14, -84, 40, -12, -24, { floor: true });          // chamber floor at y=-12
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const x = Math.cos(a) * 22, z = -54 + Math.sin(a) * 22;
      B(x - 1.2, -12, z - 1.2, x + 1.2, 10, z + 1.2);
      if (i % 2 === 0) lights.push({ x: x * 0.85, y: -9, z: -54 + (z + 54) * 0.85, r: 12, c: [1.6, 0.25, 0.1], noFixture: true });
    }
    lights.push({ x: 0, y: -2, z: -54, r: 34, c: [3, 0.25, 0.1], noFixture: true });
    lights.push({ x: 0, y: 2, z: -22, r: 10, c: [1, 0.4, 0.2], noFixture: true });
    for (const m of this.buildBrushes(boxes, lights, theme)) S.add(m);
    // cavern walls (a huge dark cylinder)
    const cav = new THREE.Mesh(new THREE.CylinderGeometry(42, 46, 90, 32, 1, true), psxMaterial({ map: tex('rock_cliff'), color: 0x3a2018, side: THREE.BackSide }));
    cav.position.set(0, 30, -54); S.add(cav);
    // the lantern: a black monolith ringed by slowly turning red light
    const mono = new THREE.Mesh(new THREE.BoxGeometry(3, 16, 3), psxMaterial({ color: 0x0a0606, emissive: 0x100000 }));
    mono.position.set(0, -4, -54); S.add(mono);
    col.add({ x0: -1.5, x1: 1.5, y0: -12, y1: 4, z0: -55.5, z1: -52.5 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.35, 6, 32), new THREE.MeshBasicMaterial({ color: 0xff2a10 }));
    ring.position.set(0, 0, -54); S.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.15, 4, 40), new THREE.MeshBasicMaterial({ color: 0xaa1408 }));
    ring2.position.set(0, 0, -54); S.add(ring2);
    const pl = new THREE.PointLight(0xff2a10, 40, 60, 1.4); pl.position.set(0, 0, -54); S.add(pl);
    this.updaters.push((dt) => {
      ring.rotation.x = this.t * 0.3; ring.rotation.y = this.t * 0.21;
      ring2.rotation.x = -this.t * 0.17; ring2.rotation.z = this.t * 0.11;
      pl.intensity = 34 + Math.sin(this.t * 1.3) * 10;
      G.audio.setEnvironment({ outdoor: 0, underground: 1, deep: 1, redsky: 0.5, hum: 0 });
    });
    this.interact.push({ pos: new THREE.Vector3(0, -10.5, -51.8), r: 3, label: () => 'Touch the lantern', act: () => G.game.touchLantern() });
    this.addNote(S, 'lantern', 1.6, -12, -51.5);
    this.startPos = { x: 0, y: 0, z: -1 }; this.startYaw = 0;
    this.interact.push({ pos: new THREE.Vector3(0, 1, -0.5), r: 2, label: () => 'Climb back up to B-7', act: () => G.travel.toSector('b7', true) });
    return S;
  }

  // ===================================================================================
  // area switching
  // ===================================================================================

  reset() {
    this.interact = []; this.ladders = []; this.updaters = [];
    this.doors = []; this.lifts = []; this.spinners = []; this.traps = []; this.shades = [];
    this.waterMap = null; this.hazardSet = null; this.sector = null;
    this.dangerLevel = 0;
    this.G.collider = this.G.underCol;   // the surface keeps its own collider
    this.G.collider.clear();
  }

  async enter(area) {
    this.reset();
    this.area = area;
    if (area === 'hub') { this.scene = this.buildHub(); this.theme = THEMES.hub; }
    else if (area === 'lantern') { this.scene = this.buildLantern(); this.theme = THEMES.deep; }
    else { const d = await this.loadSectorData(area); this.scene = this.buildSector(d); }
    return this.scene;
  }

  update(dt) {
    this.t += dt;
    for (const u of this.updaters) u(dt);
    if (this.area !== 'lantern') {
      const deep = this.area === 'b7' ? 1 : 0;
      this.G.audio.setEnvironment({
        outdoor: 0, inside: 0, rain: 0, wind: 0, lake: 0, stove: 0, redsky: 0,
        underground: 1, deep, hum: deep ? 0 : this.area === 'hub' ? 0.6 : 0.9,
        danger: this.dangerLevel || 0,
      });
    }
  }

  footstep() {
    const p = this.G.player;
    if (this.waterAt(p.x, p.z) > p.y) return 'step_water';
    if (this.area === 'hub') return p.z < -60 ? 'step_metal' : 'step_concrete';
    return (this.theme && this.theme.step) || 'step_concrete';
  }
}

// --- texture choice for brush faces ---------------------------------------------------

function faceRole(b, face, theme) {
  let role, tint = 0xffffff;
  if (b.stone) { role = face === 'top' && b.floor ? 'stone_floor_old' : 'castle_stone'; tint = 0xb8a090; }
  else if (b.grate) { role = 'metal_plate'; tint = 0xd8d8d0; }
  else if (b.rail) { role = 'metal_rusty'; tint = 0xb09040; }
  else if (b.prop) { role = theme.prop; tint = theme.propTint; }
  else if (face === 'top' && b.floor) {
    if (b.alt) role = theme.alt;
    else if (b.zone === 'corridor') role = theme.alt;
    else if (CARPET.has(b.zone) && theme.floor === 'carpet_office') role = 'carpet_office';
    else if (TILES.has(b.zone)) role = theme.floor === 'carpet_office' ? 'floor_tiles' : theme.floor;
    else if (CONCRETE.has(b.zone)) role = 'concrete_floor';
    else role = theme.floor;
  } else if (face === 'bottom' && b.ceil) { role = theme.ceil; }
  else { role = theme.wall; tint = theme.wallTint; }
  return `${role}|${tint}`;
}

const TORCH_GEO = new THREE.ConeGeometry(0.12, 0.35, 5);
let _paper = null;
function PAPER() {
  if (_paper) return _paper;
  _paper = canvasTex(16, 16, (g) => {
    g.fillStyle = '#e8e4d8'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#5a5a60';
    for (let y = 3; y < 15; y += 2) g.fillRect(2, y, 8 + ((y * 7) % 5), 1);
  }, { repeat: false });
  return _paper;
}

// ===================================================================================
// THE SHADES
// ===================================================================================

const SHADE_MAT = new THREE.MeshBasicMaterial({ color: 0x050505 });
const EYE_MAT = new THREE.MeshBasicMaterial({ color: 0xff2010, fog: false });

class Shade {
  constructor(U, S, spot) {
    this.U = U; this.G = U.G;
    this.x = spot.x; this.y = spot.y; this.z = spot.z;
    this.home = spot;
    this.state = 'wander';
    this.timer = 0; this.burn = 0; this.hp = 3; this.cool = 0; this.dist = Infinity;
    this.target = null; this.stuck = 0; this.alpha = 1; this.gone = 0;
    this.spawnDelay = 18 + Math.random() * 20;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.9, 5), SHADE_MAT);
    body.position.y = 0.95; body.rotation.y = 0.4; g.add(body);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), SHADE_MAT);
    head.position.y = 2.0; g.add(head);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), EYE_MAT);
      eye.position.set(s * 0.07, 2.02, -0.18); g.add(eye);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.06), SHADE_MAT);
      arm.position.set(s * 0.34, 1.15, 0); arm.rotation.z = s * 0.12; g.add(arm);
      g.userData['arm' + s] = arm;
    }
    g.visible = false;
    S.add(g);
    this.mesh = g;
  }

  update(dt) {
    const G = this.G, p = G.player, col = G.collider;
    if (this.spawnDelay > 0) { this.spawnDelay -= dt; this.dist = Infinity; return; }
    if (this.gone > 0) {
      this.gone -= dt; this.mesh.visible = false; this.dist = Infinity;
      if (this.gone <= 0) {
        // reappear somewhere far from the player
        const far = this.U.spawnSpots.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) > 35);
        const s = far[(Math.random() * far.length) | 0] || this.home;
        this.x = s.x; this.y = s.y; this.z = s.z; this.hp = 3; this.burn = 0; this.state = 'wander';
      }
      return;
    }
    this.mesh.visible = true;
    const dx = p.x - this.x, dz = p.z - this.z, dy = p.y - this.y;
    const dist = Math.hypot(dx, dz);
    this.dist = Math.abs(dy) < 4 ? dist : Infinity;
    this.cool -= dt; this.timer -= dt;

    // line of sight from head to the player's eyes
    let sees = false;
    if (dist < 18 && Math.abs(dy) < 3.5) {
      const ex = p.x - this.x, ey = p.eyeY - (this.y + 1.9), ez = p.z - this.z;
      const L = Math.hypot(ex, ey, ez);
      sees = col.raycast(this.x, this.y + 1.9, this.z, ex / L, ey / L, ez / L, L - 0.4) === Infinity;
    }
    // flashlight burn
    const fl = G.game.flashlightOn();
    let lit = false;
    if (fl && sees && dist < 17) {
      const cam = G.camera;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const to = new THREE.Vector3(this.x - cam.position.x, this.y + 1.2 - cam.position.y, this.z - cam.position.z).normalize();
      lit = fwd.dot(to) > Math.cos(G.game.beamAngle() * 0.85);
    }
    if (lit) this.burn += dt; else this.burn = Math.max(0, this.burn - dt * 0.5);
    if (this.burn > 0.6 && this.state !== 'flee') { this.state = 'flee'; this.timer = 3.5; G.audio.play('stalker_shriek', { position: { x: this.x, y: this.y + 1.8, z: this.z } }); }
    if (this.burn > 2.3) { this.dissolve(); return; }

    let speed = 0, tx = this.x, tz = this.z;
    if (this.state === 'flee') {
      speed = 4.8; tx = this.x - dx; tz = this.z - dz;
      if (this.timer <= 0) this.state = 'wander';
    } else if (sees || (dist < 3 && Math.abs(dy) < 2)) {
      this.state = 'chase'; this.timer = 5; speed = 3.7; tx = p.x; tz = p.z;
    } else if (this.state === 'chase' && this.timer > 0) {
      speed = 3.2; tx = p.x; tz = p.z;
    } else {
      this.state = 'wander';
      if (!this.target || this.timer <= 0 || Math.hypot(this.target.x - this.x, this.target.z - this.z) < 1.2) {
        const opts = this.U.spawnSpots.filter((s) => Math.abs(s.y - this.y) < 3 && Math.hypot(s.x - this.x, s.z - this.z) < 40);
        this.target = opts[(Math.random() * opts.length) | 0] || this.home;
        this.timer = 8 + Math.random() * 8;
      }
      speed = 1.5; tx = this.target.x; tz = this.target.z;
    }
    // move
    const mx = tx - this.x, mz = tz - this.z, ml = Math.hypot(mx, mz);
    if (ml > 0.01 && speed > 0) {
      const ox = this.x, oz = this.z;
      const r = col.pushOut(this.x + mx / ml * speed * dt, this.z + mz / ml * speed * dt, this.y, 1.9, 0.3, 0.6);
      this.x = r.x; this.z = r.z;
      const moved = Math.hypot(this.x - ox, this.z - oz);
      if (moved < speed * dt * 0.2) { this.stuck += dt; if (this.stuck > 1.5) { this.target = null; this.timer = 0; this.stuck = 0; } } else this.stuck = 0;
      this.mesh.rotation.y = Math.atan2(-mx, -mz);
    }
    const g = col.groundAt(this.x, this.z, this.y + 0.6);
    if (isFinite(g)) this.y = this.y > g ? Math.max(g, this.y - 9 * dt) : g;

    // attack
    if (dist < 1.0 && Math.abs(dy) < 1.6 && this.cool <= 0 && this.state !== 'flee') {
      this.cool = 1.6;
      G.game.hurt(18, null);
      G.audio.play('stalker_shriek', { position: { x: this.x, y: this.y + 1.8, z: this.z }, volume: 0.6, rate: 1.3 });
      const k = 1.2 / Math.max(dist, 0.1);
      const r2 = col.pushOut(p.x + dx * k, p.z + dz * k, p.y, p.height, p.radius, p.step);
      p.x = r2.x; p.z = r2.z;
    }
    // footsteps, jitter
    if (speed > 2 && Math.random() < dt * 3) G.audio.play('stalker_step', { position: { x: this.x, y: this.y, z: this.z }, volume: 0.7 });
    const jit = this.state === 'chase' ? 0.05 : 0.015;
    this.mesh.position.set(this.x + (Math.random() - 0.5) * jit, this.y, this.z + (Math.random() - 0.5) * jit);
    const sw = Math.sin(this.U.t * (speed > 2 ? 9 : 3)) * 0.25;
    this.mesh.userData['arm-1'].rotation.x = sw; this.mesh.userData.arm1.rotation.x = -sw;
    // flicker when far away
    this.mesh.visible = dist < 9 || Math.random() > 0.08;
  }

  hit() {
    this.hp--;
    this.G.audio.play('axe_hit_flesh', { position: { x: this.x, y: this.y + 1.2, z: this.z } });
    this.state = 'flee'; this.timer = 2.5;
    if (this.hp <= 0) this.dissolve();
  }

  dissolve() {
    this.G.audio.play('stalker_shriek', { position: { x: this.x, y: this.y + 1.8, z: this.z }, rate: 0.7 });
    this.gone = 60 + Math.random() * 60;
    this.mesh.visible = false;
    this.dist = Infinity;
  }
}
