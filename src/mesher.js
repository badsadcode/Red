// mesher.js — turns solid boxes (BadLevel brushes or hand-placed ones) into
// PS1-style meshes, and bakes light into the vertices.
//
// Faces are cut on a world-aligned 2 m grid. That gives:
//   * vertex density for Gouraud-style baked lighting (the PS1 look),
//   * small enough triangles that affine texture swim stays charming, not broken,
//   * per-tile culling of faces buried inside neighbouring solids.
//
// Baking: every vertex sums the lights within reach, with a wrap-around N·L term and
// an occlusion ray through the collider. Results are cached per (position, normal),
// because neighbouring tiles share corners.

import * as THREE from 'three';
import { Collider } from './physics.js';
import { psxMaterial } from './retro.js';

const GRID = 2.0;

/** Is the point inside any static solid in the collider? */
export function insideSolid(col, x, y, z, skip) {
  const list = col.query(x, z, 0.001, _tmp);
  for (const b of list) {
    if (b === skip || b.dynamic || b.noCull) continue;
    if (y <= b.y0 || x <= b.x0 || x >= b.x1 || z <= b.z0 || z >= b.z1) continue;
    if (!Collider.containsXZ(b, x, z)) continue;
    const top = Collider.topAt(b, x, z), bot = Collider.bottomAt(b, x, z);
    if (y < top && y > bot) return true;
  }
  return false;
}
const _tmp = [];

function cuts(a, b) {
  const out = [a];
  let g = Math.floor(a / GRID + 1e-6) * GRID + GRID;
  while (g < b - 1e-4) { out.push(g); g += GRID; }
  out.push(b);
  return out;
}

class Group {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; this.n = 0; }
  quad(p, nrm, uvs) {
    // p: 4 corners (counter-clockwise seen from the normal side)
    const n = this.n;
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.nor.push(nrm[0], nrm[1], nrm[2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
    }
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    this.n += 4;
  }
  tri(p, nrm, uvs) {
    const n = this.n;
    for (let i = 0; i < 3; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.nor.push(nrm[0], nrm[1], nrm[2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
    }
    this.idx.push(n, n + 1, n + 2);
    this.n += 3;
  }
}

/**
 * Build meshes for a list of boxes.
 *   boxes: collider boxes (already added to `col`), each with b.matKey(face) or b.mat
 *   faceKey(b, face) -> material key string; face in 'top' | 'bottom' | 'side'
 *   returns Map<key, Group>
 */
export function meshBoxes(boxes, col, faceKey, isAir = null) {
  const air = isAir || (() => true);
  const groups = new Map();
  const G = (k) => { if (!groups.has(k)) groups.set(k, new Group()); return groups.get(k); };
  const E = 0.04;

  for (const b of boxes) {
    if (b.invisible) continue;
    if (b.tri) { meshTri(b, col, G, faceKey, E); continue; }
    const topY = (x, z) => Collider.topAt(b, x, z), botY = (x, z) => Collider.bottomAt(b, x, z);
    const xs = cuts(b.x0, b.x1), zs = cuts(b.z0, b.z1), ys = cuts(b.y0, b.y1);

    // top
    {
      const g = G(faceKey(b, 'top'));
      for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
        const xa = xs[i], xb = xs[i + 1], za = zs[j], zb = zs[j + 1];
        const cx = (xa + xb) / 2, cz = (za + zb) / 2;
        if (insideSolid(col, cx, topY(cx, cz) + E, cz, b) || !air(cx, topY(cx, cz) + E, cz)) continue;
        const p = [[xa, topY(xa, zb), zb], [xb, topY(xb, zb), zb], [xb, topY(xb, za), za], [xa, topY(xa, za), za]];
        let nrm = [0, 1, 0];
        if (b.slope && b.slope.top) nrm = slopeNormal(p, 1);
        g.quad(p, nrm, p.map((v) => [v[0] / 2, -v[2] / 2]));
      }
    }
    // bottom
    {
      const g = G(faceKey(b, 'bottom'));
      for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
        const xa = xs[i], xb = xs[i + 1], za = zs[j], zb = zs[j + 1];
        const cx = (xa + xb) / 2, cz = (za + zb) / 2;
        if (insideSolid(col, cx, botY(cx, cz) - E, cz, b) || !air(cx, botY(cx, cz) - E, cz)) continue;
        const p = [[xa, botY(xa, za), za], [xb, botY(xb, za), za], [xb, botY(xb, zb), zb], [xa, botY(xa, zb), zb]];
        let nrm = [0, -1, 0];
        if (b.slope && !b.slope.top) nrm = slopeNormal(p, -1);
        g.quad(p, nrm, p.map((v) => [v[0] / 2, v[2] / 2]));
      }
    }
    // sides
    const side = (key, fixed, isX, sign) => {
      const g = G(key);
      const along = isX ? zs : xs;
      for (let i = 0; i < along.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
        const a0 = along[i], a1 = along[i + 1];
        const P = (a, y) => {
          const x = isX ? fixed : a, z = isX ? a : fixed;
          const yy = Math.min(Math.max(y, botY(x, z)), topY(x, z));
          return [x, yy, z];
        };
        const ya = ys[j], yb = ys[j + 1];
        const am = (a0 + a1) / 2, ym = (ya + yb) / 2;
        const cx = isX ? fixed + sign * E : am, cz = isX ? am : fixed + sign * E;
        if (insideSolid(col, cx, ym, cz, b) || !air(cx, ym, cz)) continue;
        let p;
        // counter-clockwise when seen from outside
        if (isX) p = sign > 0 ? [P(a1, ya), P(a0, ya), P(a0, yb), P(a1, yb)] : [P(a0, ya), P(a1, ya), P(a1, yb), P(a0, yb)];
        else p = sign > 0 ? [P(a0, ya), P(a1, ya), P(a1, yb), P(a0, yb)] : [P(a1, ya), P(a0, ya), P(a0, yb), P(a1, yb)];
        if (Math.abs(p[2][1] - p[1][1]) < 1e-4 && Math.abs(p[3][1] - p[0][1]) < 1e-4) continue; // squashed by a slope
        const nrm = isX ? [sign, 0, 0] : [0, 0, sign];
        g.quad(p, nrm, p.map((v) => [(isX ? -sign * v[2] : sign * v[0]) / 2, v[1] / 2]));
      }
    };
    const sk = faceKey(b, 'side');
    side(sk, b.x1, true, 1); side(sk, b.x0, true, -1);
    side(sk, b.z1, false, 1); side(sk, b.z0, false, -1);
  }
  return groups;
}

function slopeNormal(p, up) {
  const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
  const bx = p[3][0] - p[0][0], by = p[3][1] - p[0][1], bz = p[3][2] - p[0][2];
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  if (Math.sign(ny) !== Math.sign(up)) { nx = -nx; ny = -ny; nz = -nz; }
  return [nx, ny, nz];
}

function meshTri(b, col, G, faceKey, E) {
  const t = b.tri;
  const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cz = (t[0][1] + t[1][1] + t[2][1]) / 3;
  // make the triangle counter-clockwise seen from above (+y): in x/z with y up, CCW from above
  let [a, bb, c] = t;
  const cross = (bb[0] - a[0]) * (c[1] - a[1]) - (bb[1] - a[1]) * (c[0] - a[0]);
  if (cross > 0) { const s = bb; bb = c; c = s; }
  if (!insideSolid(col, cx, b.y1 + E, cz, b))
    G(faceKey(b, 'top')).tri([[a[0], b.y1, a[1]], [bb[0], b.y1, bb[1]], [c[0], b.y1, c[1]]], [0, 1, 0],
      [[a[0] / 2, -a[1] / 2], [bb[0] / 2, -bb[1] / 2], [c[0] / 2, -c[1] / 2]]);
  if (!insideSolid(col, cx, b.y0 - E, cz, b))
    G(faceKey(b, 'bottom')).tri([[a[0], b.y0, a[1]], [c[0], b.y0, c[1]], [bb[0], b.y0, bb[1]]], [0, -1, 0],
      [[a[0] / 2, a[1] / 2], [c[0] / 2, c[1] / 2], [bb[0] / 2, bb[1] / 2]]);
  const ys = cuts(b.y0, b.y1);
  const g = G(faceKey(b, 'side'));
  for (const [p0, p1] of [[a, bb], [bb, c], [c, a]]) {
    const ex = p1[0] - p0[0], ez = p1[1] - p0[1], len = Math.hypot(ex, ez);
    let nx = ez / len, nz = -ex / len;
    const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
    if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
    for (let j = 0; j < ys.length - 1; j++) {
      const ya = ys[j], yb = ys[j + 1];
      if (insideSolid(col, mx + nx * E, (ya + yb) / 2, mz + nz * E, b)) continue;
      // quad [s ya, e ya, e yb, s yb] faces along (-ez, 0, ex); flip ends if that points inward
      let s = p0, e = p1;
      if (-ez * nx + ex * nz < 0) { s = p1; e = p0; }
      const q = [[s[0], ya, s[1]], [e[0], ya, e[1]], [e[0], yb, e[1]], [s[0], yb, s[1]]];
      g.quad(q, [nx, 0, nz], [[0, ya / 2], [len / 2, ya / 2], [len / 2, yb / 2], [0, yb / 2]]);
    }
  }
}

// --- light baking ------------------------------------------------------------------

/**
 * lights: [{x,y,z, r (reach m), c: [r,g,b] (linear, already scaled by strength)}]
 * Returns a Float32Array of rgb per vertex.
 */
export function bakeGroup(group, lights, col, ambient, lightGrid) {
  const n = group.n;
  const out = new Float32Array(n * 3);
  const cache = new Map();
  const P = group.pos, N = group.nor;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    const key = `${(x * 20) | 0},${(y * 20) | 0},${(z * 20) | 0},${(nx * 4) | 0},${(ny * 4) | 0},${(nz * 4) | 0}`;
    let v = cache.get(key);
    if (!v) {
      let r = ambient[0], g = ambient[1], bl = ambient[2];
      const near = lightGrid(x, z);
      const ox = x + nx * 0.06, oy = y + ny * 0.06, oz = z + nz * 0.06;
      for (const L of near) {
        let dx = L.x - ox, dy = L.y - oy, dz = L.z - oz;
        const d = Math.hypot(dx, dy, dz);
        if (d > L.r || d < 1e-4) continue;
        dx /= d; dy /= d; dz /= d;
        const ndl = dx * nx + dy * ny + dz * nz;
        if (ndl < -0.2) continue;
        const wrap = Math.max(0, (ndl + 0.2) / 1.2);
        const k = 1 - d / L.r;
        const att = k * k * wrap;
        if (att < 0.004) continue;
        if (d > 0.5 && col.raycast(ox, oy, oz, dx, dy, dz, d - 0.35) !== Infinity) continue;
        r += L.c[0] * att; g += L.c[1] * att; bl += L.c[2] * att;
      }
      v = [r, g, bl];
      cache.set(key, v);
    }
    out[i * 3] = v[0]; out[i * 3 + 1] = v[1]; out[i * 3 + 2] = v[2];
  }
  return out;
}

export function makeLightGrid(lights, cell = 8) {
  const grid = new Map();
  const k = (ix, iz) => ix * 92821 + iz;
  for (const L of lights) {
    const ix0 = Math.floor((L.x - L.r) / cell), ix1 = Math.floor((L.x + L.r) / cell);
    const iz0 = Math.floor((L.z - L.r) / cell), iz1 = Math.floor((L.z + L.r) / cell);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const key = k(ix, iz);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(L);
    }
  }
  const empty = [];
  return (x, z) => grid.get(k(Math.floor(x / cell), Math.floor(z / cell))) || empty;
}

/** Turn groups into meshes. materials: key -> material (created by `makeMat(key)`). */
export function groupsToMeshes(groups, makeMat, bakeFn) {
  const meshes = [];
  for (const [key, g] of groups) {
    if (!g.n) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    if (bakeFn) geo.setAttribute('bake', new THREE.BufferAttribute(bakeFn(g), 3));
    geo.setIndex(g.n > 65535 ? new THREE.Uint32BufferAttribute(g.idx, 1) : new THREE.Uint16BufferAttribute(g.idx, 1));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, makeMat(key));
    m.receiveShadow = true;
    m.castShadow = true;
    m.userData.key = key;
    meshes.push(m);
  }
  return meshes;
}

export { psxMaterial };
