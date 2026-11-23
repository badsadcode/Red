// physics.js — a small, predictable character collider.
//
// The world is described as:
//   * boxes   axis-aligned solids (BadLevel brushes, cabin walls, doors, lifts...)
//             optionally with a sloped top/bottom (ramps, vaults) or cut to a
//             45° triangle in plan (diagonal walls)
//   * circles vertical cylinders (tree trunks, rocks, posts)
//   * height  an optional terrain height function y = f(x, z)
// The player is a vertical cylinder that slides along walls and steps up stairs.
// All units are metres, Y is up.

const CELL = 4; // spatial hash cell size (m)
const hkey = (ix, iz) => ix * 73856093 ^ iz * 19349663;

export class Collider {
  constructor() {
    this.grid = new Map();
    this.boxes = [];
    this.dynamic = [];   // moving/opening solids, always tested (few of them)
    this.circles = [];
    this.circleGrid = new Map();
    this.heightFn = null;
    this._stamp = 0;
  }

  clear() {
    this.grid.clear(); this.boxes.length = 0; this.dynamic.length = 0;
    this.circles.length = 0; this.circleGrid.clear(); this.heightFn = null;
  }

  /**
   * Add a solid. b = {x0,y0,z0,x1,y1,z1, slope?, tri?, mat?, dynamic?}
   *  slope: {top: bool, v: [h00,h10,h11,h01]} heights (m) at (x0,z1),(x1,z1),(x1,z0),(x0,z0)
   *         i.e. BadLevel's (x0,y0),(x1,y0),(x1,y1),(x0,y1) after y -> -z.
   *  tri:   [[x,z],[x,z],[x,z]] solid triangle footprint inside the box.
   */
  add(b) {
    b._s = 0;
    if (b.dynamic) { this.dynamic.push(b); return b; }
    this.boxes.push(b);
    const ix0 = Math.floor(b.x0 / CELL), ix1 = Math.floor(b.x1 / CELL);
    const iz0 = Math.floor(b.z0 / CELL), iz1 = Math.floor(b.z1 / CELL);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const k = hkey(ix, iz);
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, list = []);
      list.push(b);
    }
    return b;
  }

  remove(b) {
    if (b.dynamic) { const i = this.dynamic.indexOf(b); if (i >= 0) this.dynamic.splice(i, 1); return; }
    b.disabled = true;
  }

  addCircle(x, z, r, y0 = -1e9, y1 = 1e9) {
    const c = { x, z, r, y0, y1 };
    this.circles.push(c);
    const k = hkey(Math.floor(x / CELL), Math.floor(z / CELL));
    let list = this.circleGrid.get(k);
    if (!list) this.circleGrid.set(k, list = []);
    list.push(c);
    return c;
  }

  /** Boxes near an XZ disc (deduplicated). */
  query(x, z, r, out = []) {
    out.length = 0;
    const s = ++this._stamp;
    const ix0 = Math.floor((x - r) / CELL), ix1 = Math.floor((x + r) / CELL);
    const iz0 = Math.floor((z - r) / CELL), iz1 = Math.floor((z + r) / CELL);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const list = this.grid.get(hkey(ix, iz));
      if (!list) continue;
      for (const b of list) if (b._s !== s && !b.disabled) { b._s = s; out.push(b); }
    }
    for (const b of this.dynamic) if (!b.disabled) out.push(b);
    return out;
  }

  queryCircles(x, z, r, out = []) {
    out.length = 0;
    const ix0 = Math.floor((x - r - 2) / CELL), ix1 = Math.floor((x + r + 2) / CELL);
    const iz0 = Math.floor((z - r - 2) / CELL), iz1 = Math.floor((z + r + 2) / CELL);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const list = this.circleGrid.get(hkey(ix, iz));
      if (list) for (const c of list) out.push(c);
    }
    return out;
  }

  /** Top surface height of box b at (x, z). */
  static topAt(b, x, z) {
    if (b.slope && b.slope.top) return Collider.slopeAt(b, x, z);
    return b.y1;
  }
  static bottomAt(b, x, z) {
    if (b.slope && !b.slope.top) return Collider.slopeAt(b, x, z);
    return b.y0;
  }
  static slopeAt(b, x, z) {
    const u = Math.min(1, Math.max(0, (x - b.x0) / (b.x1 - b.x0)));
    const v = Math.min(1, Math.max(0, (b.z1 - z) / (b.z1 - b.z0))); // BadLevel +y = -z
    const [h00, h10, h11, h01] = b.slope.v;
    return (h00 + (h10 - h00) * u) * (1 - v) + (h01 + (h11 - h01) * u) * v;
  }

  /** Does the XZ point lie inside the box footprint (triangle-aware)? */
  static containsXZ(b, x, z, pad = 0) {
    if (x < b.x0 - pad || x > b.x1 + pad || z < b.z0 - pad || z > b.z1 + pad) return false;
    if (b.tri) return pointInTri(x, z, b.tri) || (pad > 0 && distToTri(x, z, b.tri) < pad);
    return true;
  }

  /** Highest walkable surface under (x,z) not higher than maxY. */
  groundAt(x, z, maxY, r = 0.12) {
    let g = this.heightFn ? this.heightFn(x, z) : -Infinity;
    const list = this.query(x, z, r, _q);
    for (const b of list) {
      if (!Collider.containsXZ(b, x, z, r)) continue;
      const t = Collider.topAt(b, x, z);
      if (t <= maxY && t > g) g = t;
    }
    return g;
  }

  /** Lowest ceiling above (x,z) at or above minY. */
  ceilingAt(x, z, minY, r = 0.12) {
    let c = Infinity;
    const list = this.query(x, z, r, _q);
    for (const b of list) {
      if (!Collider.containsXZ(b, x, z, r)) continue;
      const bt = Collider.bottomAt(b, x, z);
      if (bt >= minY && bt < c) c = bt;
    }
    return c;
  }

  /**
   * Push a vertical cylinder (feet y, height h, radius r) out of walls.
   * Solids whose top is within `step` of the feet are ignored (they are stairs).
   * Returns the corrected {x, z}.
   */
  pushOut(x, z, y, h, r, step) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const list = this.query(x, z, r + 0.1, _q);
      for (const b of list) {
        const top = Collider.topAt(b, Math.min(Math.max(x, b.x0), b.x1), Math.min(Math.max(z, b.z0), b.z1));
        if (top <= y + step) continue;
        if (Collider.bottomAt(b, x, z) >= y + h) continue;
        if (b.tri) {
          const res = pushTri(x, z, r, b.tri);
          if (res) { x = res[0]; z = res[1]; moved = true; }
          continue;
        }
        const cx = Math.min(Math.max(x, b.x0), b.x1), cz = Math.min(Math.max(z, b.z0), b.z1);
        let dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2), k = (r - d) / d;
          x += dx * k; z += dz * k;
        } else {
          // centre inside the rectangle: leave by the shortest side
          const l = x - b.x0, rr = b.x1 - x, n = z - b.z0, s = b.z1 - z;
          const m = Math.min(l, rr, n, s);
          if (m === l) x = b.x0 - r; else if (m === rr) x = b.x1 + r;
          else if (m === n) z = b.z0 - r; else z = b.z1 + r;
        }
        moved = true;
      }
      for (const c of this.queryCircles(x, z, r, _qc)) {
        if (y + h < c.y0 || y > c.y1) continue;
        const dx = x - c.x, dz = z - c.z, rr = r + c.r, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-10) {
          const d = Math.sqrt(d2), k = (rr - d) / d;
          x += dx * k; z += dz * k; moved = true;
        }
      }
      if (!moved) break;
    }
    return _p.set(x, z);
  }

  /**
   * Segment test against solids (for interaction rays, line of sight, AI).
   * Returns hit distance along the segment (metres) or Infinity.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, stepLen = CELL * 0.25) {
    let best = maxDist;
    const steps = Math.max(1, Math.ceil(maxDist / stepLen));
    const s = ++this._stamp;
    const check = (b) => {
      if (b._s === s || b.disabled) return;
      b._s = s;
      const t = rayBox(ox, oy, oz, dx, dy, dz, b);
      if (t < best) best = t;
    };
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * maxDist;
      const x = ox + dx * t, z = oz + dz * t;
      const list = this.grid.get(hkey(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (list) for (const b of list) check(b);
    }
    for (const b of this.dynamic) check(b);
    return best < maxDist ? best : Infinity;
  }
}

const _q = [], _qc = [];
const _p = { x: 0, z: 0, set(x, z) { this.x = x; this.z = z; return this; } };

function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1], o = [ox, oy, oz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return Infinity;
    } else {
      let t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

function pointInTri(x, z, t) {
  const [a, b, c] = t;
  const s1 = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const s2 = (c[0] - b[0]) * (z - b[1]) - (c[1] - b[1]) * (x - b[0]);
  const s3 = (a[0] - c[0]) * (z - c[1]) - (a[1] - c[1]) * (x - c[0]);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

function closestOnSeg(x, z, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1];
  let t = ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez);
  t = Math.max(0, Math.min(1, t));
  return [a[0] + ex * t, a[1] + ez * t];
}

function closestOnTri(x, z, t) {
  let best = null, bd = Infinity;
  for (let i = 0; i < 3; i++) {
    const p = closestOnSeg(x, z, t[i], t[(i + 1) % 3]);
    const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return [best, Math.sqrt(bd)];
}

function distToTri(x, z, t) {
  if (pointInTri(x, z, t)) return 0;
  return closestOnTri(x, z, t)[1];
}

function pushTri(x, z, r, t) {
  const inside = pointInTri(x, z, t);
  const [p, d] = closestOnTri(x, z, t);
  if (!inside && d >= r) return null;
  if (d < 1e-8) return null;
  const nx = (x - p[0]) / d, nz = (z - p[1]) / d;
  const s = inside ? -1 : 1;
  return [p[0] + nx * s * r, p[1] + nz * s * r];
}

// --- Player ---------------------------------------------------------------------------

export class Player {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0;
    this.vy = 0;
    this.yaw = 0; this.pitch = 0;
    this.radius = 0.3;
    this.height = 1.72;
    this.eye = 1.6;
    this.step = 0.6;
    this.onGround = false;
    this.eyeY = 0;           // smoothed eye height (stairs)
    this.bob = 0;
    this.stepDist = 0;
    this.speed = 0;
    this.noclip = false;
    this.frozen = false;
    this.swimming = false;
  }

  place(x, y, z, yaw = this.yaw) {
    this.x = x; this.y = y; this.z = z; this.vy = 0; this.yaw = yaw;
    this.eyeY = y + this.eye;
  }

  /**
   * move: {fx, fz} local intent (-1..1), run, jump. env: {speedMul, waterY}
   * onStep(distance) called each footstep.
   */
  update(dt, col, move, env = {}, onStep) {
    if (this.frozen) { this.eyeY = this.y + this.eye; return; }
    const walk = 3.2 * (env.speedMul ?? 1);
    let spd = move.run ? walk * 1.85 : walk;
    const inWater = env.waterY !== undefined && env.waterY > this.y + 0.25;
    if (inWater) spd *= 0.6;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // right = (cos, 0, -sin), forward = (-sin, 0, -cos) for a camera yawed by `yaw`
    let mx = move.fx * cos - move.fz * sin;
    let mz = -move.fx * sin - move.fz * cos;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }

    if (this.noclip) {
      const f = spd * 4 * dt;
      this.x += mx * f; this.z += mz * f;
      this.y += ((move.jump ? 1 : 0) - (move.down ? 1 : 0)) * f;
      this.eyeY = this.y + this.eye;
      return;
    }

    // substeps keep fast movement from tunnelling through thin walls
    const total = Math.hypot(mx * spd * dt, mz * spd * dt);
    const n = Math.max(1, Math.ceil(total / 0.15));
    const prevX = this.x, prevZ = this.z;
    for (let i = 0; i < n; i++) {
      const nx = this.x + mx * spd * dt / n, nz = this.z + mz * spd * dt / n;
      const p = col.pushOut(nx, nz, this.y, this.height, this.radius, this.step);
      this.x = p.x; this.z = p.z;
    }
    const moved = Math.hypot(this.x - prevX, this.z - prevZ);

    // ladders: climb straight up/down, no gravity
    if (env.climb !== undefined) {
      this.vy = 0;
      let cy = this.y + env.climb * dt;
      const g = col.groundAt(this.x, this.z, this.y + this.step);
      if (cy < g) cy = g;
      const ceil = col.ceilingAt(this.x, this.z, this.y + this.height - 0.01);
      if (cy + this.height > ceil) cy = ceil - this.height;
      this.y = cy; this.onGround = cy <= g + 0.01;
      this.speed = Math.abs(env.climb);
      if (env.climb !== 0 && onStep) { this.stepDist += Math.abs(env.climb) * dt; if (this.stepDist > 0.5) { this.stepDist = 0; onStep(0); } }
      this.eyeY = this.y + this.eye;
      return;
    }

    // vertical
    const wasGround = this.onGround;
    if (move.jump && this.onGround) { this.vy = 4.6; this.onGround = false; }
    if (inWater && move.jump) this.vy = Math.max(this.vy, 1.8);
    this.vy -= (inWater ? 6 : 18) * dt;
    if (this.vy < -40) this.vy = -40;
    let ny = this.y + this.vy * dt;
    const ground = col.groundAt(this.x, this.z, this.y + this.step);
    if (ny <= ground) {
      if (!wasGround && this.vy < -6 && onStep) onStep(-this.vy);
      ny = ground; this.vy = 0; this.onGround = true;
    } else if (wasGround && this.vy <= 0 && this.y - ground < this.step + 0.05) {
      ny = ground; this.vy = 0; this.onGround = true;   // stick to stairs/ramps going down
    } else {
      this.onGround = false;
    }
    if (this.vy > 0) {
      const ceil = col.ceilingAt(this.x, this.z, this.y + this.height - 0.01);
      if (ny + this.height > ceil) { ny = ceil - this.height; this.vy = 0; }
    }
    this.y = ny;

    // footsteps + head bob
    this.speed = moved / Math.max(dt, 1e-4);
    if (this.onGround && moved > 0.001) {
      this.stepDist += moved;
      this.bob += moved * (move.run ? 1.9 : 2.4);
      const stride = move.run ? 1.6 : 1.25;
      if (this.stepDist > stride) { this.stepDist = 0; onStep && onStep(0); }
    }
    const target = this.y + this.eye;
    this.eyeY += (target - this.eyeY) * Math.min(1, dt * (target > this.eyeY ? 14 : 22));
    if (Math.abs(target - this.eyeY) > 1.2) this.eyeY = target;
  }

  applyCamera(cam, bobAmount = 1) {
    const b = Math.sin(this.bob * Math.PI) * 0.035 * bobAmount * Math.min(1, this.speed / 3);
    cam.position.set(this.x, this.eyeY + b, this.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
