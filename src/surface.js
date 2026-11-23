// surface.js — the valley: lake, forest, the cabin, the road to the mountain,
// weather, day/night, and the red sky.
//
// World layout (metres, Y up, north = -Z):
//   lake       ellipse centred on the origin, 110 x 70 m, water at y = 0
//   cabin      east shore, porch facing the water (west)
//   mountain   ridge rising north of z = -200; the facility door at its foot
//   valley rim mountains ring everything beyond ~330 m

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { psxMaterial, canvasTex } from './retro.js';
import { tex, modelGeom, modelMaterial, pickModel, modelMesh } from './assets.js';
import { clamp, lerp, smoothstep, fbm, vnoise, rng, distToPolyline, damp } from './util.js';

export const LAKE = { rx: 110, rz: 70 };
export const CABIN = { x: 128, z: 6 };            // cabin centre (world)
export const DOOR = { x: 0, z: -211.5 };           // facility door (in the cliff face)
export const ROAD = [[131, 12], [136, 34], [150, -10], [146, -60], [118, -112], [70, -158], [26, -182], [4, -194], [0, -203]];
const CLEARING = { x0: -22, x1: 22, z0: -218, z1: -178 };

// ---------------------------------------------------------------------------------
// Terrain height
// ---------------------------------------------------------------------------------

let cabinFloorY = 0, clearingY = 0;

function rawHeight(x, z) {
  const d = Math.hypot(x / LAKE.rx, z / LAKE.rz);
  let h;
  if (d < 1) h = Math.max(-5.5, (d - 1) * 18);
  else h = (d - 1) * 6.5;
  h += fbm(x * 0.012, z * 0.012, 4) * 7 * smoothstep(1.0, 1.5, d);
  h += fbm(x * 0.05, z * 0.05, 2) * 0.8 * smoothstep(0.97, 1.1, d);
  // the northern ridge
  if (z < -196) {
    // steep at the foot (the cliff with the door), then a long shoulder up to ~110 m
    const t = -196 - z;
    const rise = t < 25 ? t * 2.3 : 57.5 + Math.min(55, (t - 25) * 0.45);
    h += rise + fbm(x * 0.03, z * 0.03, 3) * 6 * smoothstep(0, 20, t);
  }
  // valley rim (kept low enough that the sky stays the sky)
  const r = Math.hypot(x, z * 1.15);
  if (r > 300) h += Math.min(85, Math.pow((r - 300) / 130, 2) * 85) + fbm(x * 0.01, z * 0.01, 3) * 18 * smoothstep(300, 420, r);
  return h;
}

export function heightAt(x, z) {
  let h = rawHeight(x, z);
  // the old service road is graded flat-ish
  const rd = distToPolyline(x, z, ROAD);
  if (rd < 10) {
    const smooth = (rawHeight(x + 6, z) + rawHeight(x - 6, z) + rawHeight(x, z + 6) + rawHeight(x, z - 6)) / 4;
    h = lerp(lerp(smooth, h, 0.3), h, smoothstep(3, 10, rd));
  }
  // cabin pad
  const cd = Math.max(Math.abs(x - CABIN.x) - 7, Math.abs(z - CABIN.z) - 9, 0);
  h = lerp(cabinFloorY - 0.55, h, smoothstep(0, 9, cd));
  // facility clearing in front of the door (last, so nothing undoes it)
  const qx = Math.max(CLEARING.x0 - x, x - CLEARING.x1, 0), qz = Math.max(CLEARING.z0 - z, z - CLEARING.z1, 0);
  if (z > CLEARING.z0 - 0.5) h = lerp(clearingY, h, smoothstep(0, 14, Math.hypot(qx, qz)));
  return h;
}

function initPads() {
  cabinFloorY = Math.max(1.6, rawHeight(CABIN.x, CABIN.z) + 0.3);
  clearingY = rawHeight(0, -186) + 0.5;
}

// ---------------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------------

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
  gl_Position.z = gl_Position.w * 0.99995;   // just inside the far plane, or it gets clipped
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uTop, uHorizon, uGround, uSunDir, uSunColor, uRedDir;
uniform float uCloud, uTime, uRed, uNight, uWind;
varying vec3 vDir;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p *= 2.07; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uTop, pow(up, 0.55));
  if (d.y < 0.0) col = mix(uHorizon, uGround, smoothstep(0.0, -0.25, d.y));
  // sun
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 600.0) * 4.0 + pow(sd, 12.0) * 0.25) * (1.0 - uCloud * 0.9);
  // stars
  if (uNight > 0.01 && d.y > 0.0) {
    vec2 g = floor(d.xz / (d.y + 0.3) * 220.0);
    float s = step(0.9975, h21(g));
    col += vec3(s) * uNight * (1.0 - uCloud) * 0.9;
  }
  // clouds: a slab overhead, projected
  float cloud = 0.0;
  if (d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.12) * 1.4 + vec2(uTime * 0.004 * (0.5 + uWind), uTime * 0.0015);
    float n = fbm(uv);
    float n2 = fbm(uv * 2.3 + 7.0);
    cloud = smoothstep(1.0 - uCloud - 0.05, 1.0 - uCloud + 0.35, n * 0.8 + n2 * 0.35);
    vec3 cdark = mix(uHorizon * 0.55, vec3(0.03), uNight * 0.7);
    vec3 clight = mix(uHorizon * 1.15 + uSunColor * 0.12, uHorizon * 0.8, uCloud);
    vec3 ccol = mix(clight, cdark, smoothstep(0.4, 1.0, n2) * 0.8);
    col = mix(col, ccol, cloud * smoothstep(0.0, 0.08, d.y));
  }
  // the red sky: clouds become a red sea, glowing from the direction of the mountain
  if (uRed > 0.0) {
    float toward = max(dot(normalize(vec3(d.x, max(d.y, 0.0) * 0.6, d.z)), uRedDir), 0.0);
    float pulse = 0.85 + 0.15 * sin(uTime * 2.3) * sin(uTime * 0.7);
    vec3 red = mix(vec3(0.35, 0.02, 0.01), vec3(1.6, 0.12, 0.05), cloud) * pulse;
    red += vec3(2.2, 0.25, 0.08) * pow(toward, 6.0) * (0.6 + 0.4 * cloud);
    col = mix(col, red, uRed * (0.55 + 0.45 * cloud));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// Weather presets. The valley spends most of its time grey and damp, as it should.
const WEATHER = {
  sunbreak: { cover: 0.38, rain: 0, fog: 0.0065, wind: 0.3, w: 1 },
  overcast: { cover: 0.82, rain: 0, fog: 0.009, wind: 0.35, w: 3 },
  mist:     { cover: 0.86, rain: 0, fog: 0.03, wind: 0.08, w: 1.2 },
  drizzle:  { cover: 0.93, rain: 0.35, fog: 0.012, wind: 0.4, w: 2.4 },
  rain:     { cover: 1.0, rain: 0.75, fog: 0.015, wind: 0.55, w: 1.5 },
  storm:    { cover: 1.0, rain: 1.0, fog: 0.017, wind: 0.95, w: 0.5 },
};

// ---------------------------------------------------------------------------------

export class Surface {
  constructor(G) {
    this.G = G;
    this.scene = new THREE.Scene();
    this.interact = [];
    this.ladders = [];
    this.weather = { name: 'mist', cover: 0.86, rain: 0, fog: 0.03, wind: 0.08, nextChange: 9.5 };
    this.red = 0;          // red sky intensity 0..1
    this.redT = -1;        // seconds since the event started (-1 = not running)
    this.lightning = 0;
    this.stoveLit = false;
    this.lampOn = true;
    this.doorOpen = false;
    this.t = 0;
    this.forage = [];      // mushroom / berry pick spots
  }

  build() {
    initPads();
    const S = this.scene;
    S.fog = new THREE.FogExp2(0x8a9590, 0.01);

    // lights
    this.hemi = new THREE.HemisphereLight(0xb8c4cc, 0x2a3020, 0.6);
    S.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.camera.layers.enable(1);
    S.add(this.sun, this.sun.target);

    // sky dome
    this.skyU = {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color(0x1a1f18) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
      uRedDir: { value: new THREE.Vector3(0, 0.15, -1).normalize() },
      uCloud: { value: 0.8 }, uTime: { value: 0 }, uRed: { value: 0 }, uNight: { value: 0 }, uWind: { value: 0.3 },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
        side: THREE.BackSide, depthWrite: false, fog: false }));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    S.add(this.sky);

    this.buildTerrain();
    this.buildFarMountain();
    this.buildLake();
    this.buildForest();
    this.buildCabin();
    this.buildDock();
    this.buildRoad();
    this.buildFacilityEntrance();
    this.buildLookout();
    this.buildRain();
    return this;
  }

  // --- terrain ---------------------------------------------------------------------

  buildTerrain() {
    const size = 900, seg = 300;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const uv = g.attributes.uv;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);
      uv.setXY(i, x / 5, z / 5);
      // vertex tint: shore gravel, wet grass, forest floor, rock on steep/high ground
      const d = Math.hypot(x / LAKE.rx, z / LAKE.rz);
      const n = vnoise(x * 0.08, z * 0.08) * 0.5 + 0.5;
      c.setRGB(0.82, 1.12, 0.7);
      if (d < 1.06) c.lerp(new THREE.Color(1.25, 1.2, 1.1), smoothstep(1.06, 0.98, d));
      if (h > 22) c.lerp(new THREE.Color(1.3, 1.3, 1.35), smoothstep(22, 45, h));
      c.multiplyScalar(0.8 + n * 0.35);
      const rd = distToPolyline(x, z, ROAD);
      if (rd < 3.2) c.multiplyScalar(lerp(0.75, 1, smoothstep(1.5, 3.2, rd)));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const t = tex('ground_forest');
    const m = new THREE.Mesh(g, psxMaterial({ map: t, vertexColors: true }));
    m.receiveShadow = true;
    this.scene.add(m);
    this.terrain = m;

    // a rock texture skin on the steep northern ridge, laid over the terrain
    const rg = new THREE.PlaneGeometry(420, 120, 140, 40);
    rg.rotateX(-Math.PI / 2);
    rg.translate(0, 0, -262);
    const rp = rg.attributes.position, ruv = rg.attributes.uv;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i), z = rp.getZ(i);
      rp.setY(i, heightAt(x, z) + 0.06);
      ruv.setXY(i, x / 6, (heightAt(x, z) + z) / 6);
    }
    rg.computeVertexNormals();
    const rock = new THREE.Mesh(rg, psxMaterial({ map: tex('rock_cliff'), color: 0xb8b8b0 }));
    rock.receiveShadow = true;
    this.scene.add(rock);
  }

  buildFarMountain() {
    // a big volcanic cone to the north, behind everything: the valley's landmark
    const g = new THREE.ConeGeometry(430, 560, 24, 6);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const jitter = 1 + vnoise(p.getX(i) * 0.01, p.getZ(i) * 0.01) * 0.08;
      p.setX(i, p.getX(i) * jitter); p.setZ(i, p.getZ(i) * jitter);
      const snow = smoothstep(80, 190, y + vnoise(p.getX(i) * 0.02, p.getZ(i) * 0.02) * 60);
      col.set([lerp(0.32, 0.9, snow), lerp(0.34, 0.92, snow), lerp(0.38, 0.95, snow)], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    this.farMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.6, depthWrite: false });
    const m = new THREE.Mesh(g, this.farMat);
    m.position.set(-190, 230, -1350);
    m.renderOrder = -5;
    this.scene.add(m);
    this.farMountain = m;
  }

  // --- lake ------------------------------------------------------------------------

  buildLake() {
    const shader = {
      uniforms: {
        color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
        uTime: { value: 0 }, uRain: { value: 0 }, uDeep: { value: new THREE.Color(0x0e1c1a) },
        uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.01 }, uLight: { value: 1 },
      },
      vertexShader: /* glsl */`
        uniform mat4 textureMatrix;
        varying vec4 vUv; varying vec3 vWorld;
        void main() {
          vUv = textureMatrix * vec4(position, 1.0);
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float uTime, uRain, uFogDensity, uLight;
        uniform vec3 uDeep, uFogColor;
        varying vec4 vUv; varying vec3 vWorld;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec2 w = vWorld.xz;
          vec2 d = vec2(sin(w.x * 0.35 + uTime * 0.9) + sin(w.y * 0.53 - uTime * 0.7),
                        cos(w.y * 0.41 + uTime * 0.8) + sin(w.x * 0.29 + uTime * 0.6)) * 0.006;
          // rain rings: a cheap cellular pattern of expanding ripples
          vec2 cell = floor(w * 1.6); vec2 f = fract(w * 1.6) - 0.5;
          float rnd = h21(cell); float ph = fract(uTime * 0.9 + rnd);
          float ring = sin(clamp(length(f) - ph * 0.5, -0.1, 0.1) * 60.0) * (1.0 - ph) * step(rnd, uRain);
          d += f * ring * 0.03;
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float fres = 0.08 + 0.92 * pow(1.0 - max(viewDir.y, 0.0), 4.0);
          vec4 uv = vUv; uv.xy += d * uv.w * 6.0;
          vec3 refl = texture2DProj(tDiffuse, uv).rgb;
          vec3 col = mix(uDeep * uLight, refl, clamp(fres + 0.25, 0.0, 1.0));
          float dist = length(cameraPosition - vWorld);
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
        }`,
    };
    const geo = new THREE.PlaneGeometry(LAKE.rx * 2 + 30, LAKE.rz * 2 + 30);
    this.lake = new Reflector(geo, { textureWidth: 384, textureHeight: 256, clipBias: 0.003, shader, multisample: 0 });
    this.lake.rotateX(-Math.PI / 2);
    this.lake.position.y = 0;
    this.scene.add(this.lake);
    this.lakeU = this.lake.material.uniforms;
    // lily pads near the shore
    const lily = pickModel('lilypad');
    if (lily) {
      const r = rng(7);
      const inst = new THREE.InstancedMesh(modelGeom(lily), modelMaterial(), 60);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      for (let i = 0; i < 60; i++) {
        const a = r() * Math.PI * 2, d = 0.82 + r() * 0.14;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
        s.setScalar(0.6 + r() * 0.8);
        m4.compose(new THREE.Vector3(Math.cos(a) * LAKE.rx * d, 0.02, Math.sin(a) * LAKE.rz * d), q, s);
        inst.setMatrixAt(i, m4);
      }
      this.scene.add(inst);
    }
  }

  // --- forest ----------------------------------------------------------------------

  isClear(x, z, pad = 0) {
    const d = Math.hypot(x / LAKE.rx, z / LAKE.rz);
    if (d < 1.07) return false;
    if (Math.abs(x - CABIN.x) < 13 + pad && Math.abs(z - CABIN.z) < 14 + pad) return false;
    if (distToPolyline(x, z, ROAD) < 4.5 + pad) return false;
    if (x > CLEARING.x0 - 6 && x < CLEARING.x1 + 6 && z > CLEARING.z0 - 4 && z < CLEARING.z1 + 4) return false;
    if (Math.hypot(x - LOOKOUT.x, z - LOOKOUT.z) < 7) return false;
    if (Math.abs(x - 104) < 12 && Math.abs(z - 14) < 4) return false; // dock approach
    return true;
  }

  buildForest() {
    const r = rng(1234);
    const col = this.G.collider;
    const pines = ['pine_1', 'pine_2', 'pine_3', 'pine_4', 'pine_5'].filter((n) => modelGeom(n));
    const others = ['tree_common_1', 'tree_common_2', 'birch_1', 'birch_2', 'tree_dead_1'].filter((n) => modelGeom(n));
    const near = [];   // [x, z, scale, yaw, kind]
    const far = [];
    this.treeCircles = [];
    const spacing = 9;
    for (let x = -440; x < 440; x += spacing) {
      for (let z = -440; z < 440; z += spacing) {
        const px = x + (r() - 0.5) * spacing * 0.9, pz = z + (r() - 0.5) * spacing * 0.9;
        if (!this.isClear(px, pz)) continue;
        const dens = 0.62 + fbm(px * 0.01, pz * 0.01, 2) * 0.6;
        if (r() > dens) continue;
        const h = heightAt(px, pz);
        const rr = Math.hypot(px, pz * 1.15);
        if (h > 95) continue;
        const scale = 0.75 + r() * 0.6;
        if (rr < 270 && Math.abs(pz + 10) < 240) near.push([px, h, pz, scale, r() * 6.28, r()]);
        else far.push([px, h, pz, scale, r() * 6.28]);
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    // near trees: real models (CC0 Quaternius) instanced per variant
    const kinds = pines.length ? pines : [];
    const buckets = new Map();
    for (const t of near) {
      let name;
      if (kinds.length === 0) name = '__proc';
      else if (others.length && t[5] < 0.12) name = others[(t[5] * 1000 | 0) % others.length];
      else name = kinds[(t[5] * 997 | 0) % kinds.length];
      if (!buckets.has(name)) buckets.set(name, []);
      buckets.get(name).push(t);
      col.addCircle(t[0], t[2], 0.32 * t[3] + 0.1, t[1] - 1, t[1] + 30);
    }
    // LOD: full CC0 models near the player, a low-poly stand-in further out.
    // Instances are re-sorted every second (see updateForestLOD).
    this.lodTrees = [];
    this.hiMeshes = new Map();
    for (const [name, list] of buckets) {
      const geo = name === '__proc' ? proceduralPine() : modelGeom(name);
      const inst = new THREE.InstancedMesh(geo, modelMaterial(), list.length);
      inst.castShadow = true; inst.receiveShadow = true;
      inst.count = 0;
      inst.layers.set(1);              // main camera only: kept out of the lake reflection
      this.scene.add(inst);
      const bb = geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox);
      const slim = name.startsWith('pine') ? 0.55 : 0.8, tall = name.startsWith('pine') ? 1.15 : 1;
      const H = (bb.max.y - bb.min.y) * tall, W = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * slim;
      this.hiMeshes.set(name, inst);
      for (const t of list) this.lodTrees.push({ x: t[0], y: t[1] - 0.2, z: t[2], s: t[3], yaw: t[4], name, slim, tall, H, W, pine: name.startsWith('pine') || name === '__proc' });
    }
    // the stand-in: a 70-triangle pine sized to match each tree
    const lo = proceduralPine();
    lo.computeBoundingBox();
    this.loH = lo.boundingBox.max.y - lo.boundingBox.min.y;
    this.loW = lo.boundingBox.max.x - lo.boundingBox.min.x;
    this.loMesh = new THREE.InstancedMesh(lo, modelMaterial(), this.lodTrees.length);
    this.loMesh.castShadow = true; this.loMesh.receiveShadow = true;
    this.scene.add(this.loMesh);
    this.lodAt = { x: 1e9, z: 1e9 };
    this.updateForestLOD(CABIN.x, CABIN.z, true);

    // far trees: cheap cones
    const cone = proceduralPine(true);
    const finst = new THREE.InstancedMesh(cone, modelMaterial(), far.length);
    far.forEach((t, i) => {
      q.setFromAxisAngle(up, t[4]); s.setScalar(t[3] * 1.2);
      m4.compose(new THREE.Vector3(t[0], t[1] - 0.3, t[2]), q, s);
      finst.setMatrixAt(i, m4);
    });
    this.scene.add(finst);

    // undergrowth: rocks, bushes, ferns, logs, stumps
    const scatter = (names, count, minS, maxS, collide, area = 230, ymin = -0.2) => {
      const avail = names.filter((n) => modelGeom(n));
      if (!avail.length) return [];
      const placed = [];
      const byName = new Map();
      for (let i = 0; i < count; i++) {
        const x = (r() - 0.5) * area * 2, z = (r() - 0.5) * area * 2 - 20;
        if (!this.isClear(x, z, -3)) continue;
        const y = heightAt(x, z);
        if (y < ymin) continue;
        const n = avail[(r() * avail.length) | 0];
        const sc = minS + r() * (maxS - minS);
        if (!byName.has(n)) byName.set(n, []);
        byName.get(n).push([x, y, z, sc, r() * 6.28]);
        placed.push([x, y, z, sc, n]);
        if (collide) {
          const bb = modelGeom(n).boundingBox;
          const rad = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.4 * sc;
          if (rad > 0.25) col.addCircle(x, z, rad, y - 1, y + (bb.max.y - bb.min.y) * sc);
        }
      }
      for (const [n, list] of byName) {
        const inst = new THREE.InstancedMesh(modelGeom(n), modelMaterial(), list.length);
        list.forEach((t, i) => {
          q.setFromAxisAngle(up, t[4]); s.setScalar(t[3]);
          m4.compose(new THREE.Vector3(t[0], t[1] - 0.05, t[2]), q, s);
          inst.setMatrixAt(i, m4);
        });
        inst.castShadow = true; inst.receiveShadow = true;
        if (!collide) inst.layers.set(1);   // small stuff stays out of the reflection pass
        this.scene.add(inst);
      }
      return placed;
    };
    scatter(['rock_moss_1', 'rock_moss_2', 'rock_moss_3', 'rock_moss_4', 'rock_moss_5', 'rock_moss_6', 'rock_moss_7', 'rock_1', 'rock_2', 'rock_3'], 260, 0.6, 2.2, true);
    scatter(['bush_1', 'bush_2', 'plant_1', 'plant_2', 'plant_3'], 550, 0.7, 1.4, false);
    scatter(['grass', 'grass_short', 'flowers'], 450, 0.8, 1.5, false, 160);
    const logs = scatter(['log_moss', 'log', 'stump_moss', 'stump'], 90, 0.8, 1.2, true);
    // berry bushes: forageable
    const berries = scatter(['bush_berries_1', 'bush_berries_2'], 45, 0.9, 1.3, false, 200);
    for (const b of berries) this.forage.push({ kind: 'berries', x: b[0], y: b[1], z: b[2], regrow: 0 });
    // mushroom spots: next to logs and at the feet of trees
    for (const l of logs) this.forage.push({ kind: 'mushroom', x: l[0] + 0.8, y: l[1], z: l[2] + 0.5, regrow: 0 });
    for (let i = 0; i < 60; i++) {
      const t = near[(r() * near.length) | 0];
      if (t && Math.hypot(t[0] - CABIN.x, t[2] - CABIN.z) < 220) this.forage.push({ kind: 'mushroom', x: t[0] + 0.9, y: t[1], z: t[2] + 0.6, regrow: 0 });
    }
    this.buildForage();
  }

  updateForestLOD(px, pz, force = false) {
    if (!force && Math.hypot(px - this.lodAt.x, pz - this.lodAt.z) < 6) return;
    this.lodAt.x = px; this.lodAt.z = pz;
    const R2 = 85 * 85;
    const m4 = _m4, q = _q4, sc = _s3, pos = _p3;
    const counts = new Map();
    for (const [n, inst] of this.hiMeshes) counts.set(n, 0);
    let lo = 0;
    for (const t of this.lodTrees) {
      const dx = t.x - px, dz = t.z - pz;
      q.setFromAxisAngle(_up, t.yaw);
      pos.set(t.x, t.y, t.z);
      if (dx * dx + dz * dz < R2) {
        sc.set(t.s * t.slim, t.s * t.tall, t.s * t.slim);
        m4.compose(pos, q, sc);
        const inst = this.hiMeshes.get(t.name);
        const i = counts.get(t.name);
        inst.setMatrixAt(i, m4);
        counts.set(t.name, i + 1);
      } else {
        sc.set(t.s * t.W / this.loW, t.s * t.H / this.loH, t.s * t.W / this.loW);
        m4.compose(pos, q, sc);
        this.loMesh.setMatrixAt(lo++, m4);
      }
    }
    for (const [n, inst] of this.hiMeshes) { inst.count = counts.get(n); inst.instanceMatrix.needsUpdate = true; inst.computeBoundingSphere(); }
    this.loMesh.count = lo; this.loMesh.instanceMatrix.needsUpdate = true; this.loMesh.computeBoundingSphere();
  }

  buildForage() {
    const mushGeo = pickModel('mushroom');
    for (const f of this.forage) {
      let mesh;
      if (f.kind === 'mushroom') {
        mesh = mushGeo ? modelMesh(mushGeo, { height: 0.18 }) : proceduralMushroom();
        f.y = heightAt(f.x, f.z);
        mesh.position.set(f.x, f.y, f.z);
        mesh.traverse((o) => o.layers.set(1));
        this.scene.add(mesh);
      } else {
        // berries: little red/blue dots on the bush
        mesh = new THREE.Group();
        const bm = psxMaterial({ color: 0x5a2a7a, emissive: 0x150010 });
        for (let i = 0; i < 7; i++) {
          const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), bm);
          b.position.set((Math.random() - 0.5) * 0.9, 0.35 + Math.random() * 0.45, (Math.random() - 0.5) * 0.9);
          mesh.add(b);
        }
        mesh.position.set(f.x, f.y, f.z);
        this.scene.add(mesh);
      }
      f.mesh = mesh;
      this.interact.push({
        pos: new THREE.Vector3(f.x, f.y + (f.kind === 'mushroom' ? 0.1 : 0.6), f.z), r: 1.6,
        label: () => (f.regrow > 0 ? null : f.kind === 'mushroom' ? 'Pick chanterelle' : 'Pick huckleberries'),
        act: () => this.G.game.forage(f),
      });
    }
  }

  dailyRegrow() {
    for (const f of this.forage) {
      if (f.regrow > 0) f.regrow--;
      f.mesh.visible = f.regrow <= 0;
    }
  }

  // --- cabin -----------------------------------------------------------------------

  buildCabin() {
    const G = this.G, col = G.collider;
    const grp = new THREE.Group();
    grp.position.set(CABIN.x, cabinFloorY, CABIN.z);
    this.scene.add(grp);
    this.cabin = grp;
    const Y = cabinFloorY, OX = CABIN.x, OZ = CABIN.z;
    const logs = tex('cabin_logs'), planks = tex('wood_planks'), dark = tex('wood_dark');
    const logMat = psxMaterial({ map: logs, color: 0xd8c0a0 });
    const plankMat = psxMaterial({ map: planks });
    const darkMat = psxMaterial({ map: dark });
    const roofMat = psxMaterial({ map: tex('roof_shingles'), side: THREE.DoubleSide });

    // box helper: local coords (x east, z south), y from floor; adds collision unless nocol
    const box = (x0, y0, z0, x1, y1, z1, mat, { nocol = false, uvs = 1.6, cast = true } = {}) => {
      const g = segBox(x1 - x0, y1 - y0, z1 - z0);
      boxUV(g, x1 - x0, y1 - y0, z1 - z0, uvs);
      const m = new THREE.Mesh(g, mat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      m.castShadow = cast; m.receiveShadow = true;
      grp.add(m);
      if (!nocol) col.add({ x0: OX + x0, x1: OX + x1, y0: Y + y0, y1: Y + y1, z0: OZ + z0, z1: OZ + z1, mat: 'wood' });
      return m;
    };
    this.cabinBox = box;

    // floor + foundation
    box(-3.15, -0.6, -4.15, 3.15, 0, 4.15, plankMat, { uvs: 2.5 });
    // porch deck (west) and steps
    box(-5.8, -0.6, -4.3, -3.15, -0.05, 4.3, psxMaterial({ map: tex('dock_planks') }), { uvs: 2.5 });
    box(-6.5, -0.6, -1.0, -5.8, -0.35, 1.0, darkMat);
    // walls: west (door + 2 windows), east, north, south
    const H = 2.6, T = 0.15;
    const wall = (axis, c, a0, a1, holes) => {
      // build a wall along `axis` ('z' or 'x') at coordinate c, from a0 to a1, cutting holes [b0,b1,y0,y1]
      const segs = [];
      let cur = a0;
      const hs = holes.slice().sort((p, q) => p[0] - q[0]);
      for (const [b0, b1, y0, y1] of hs) {
        segs.push([cur, b0, 0, H]);
        if (y0 > 0) segs.push([b0, b1, 0, y0]);
        segs.push([b0, b1, y1, H]);
        cur = b1;
      }
      segs.push([cur, a1, 0, H]);
      for (const [s0, s1, y0, y1] of segs) {
        if (s1 - s0 < 0.01 || y1 - y0 < 0.01) continue;
        if (axis === 'z') box(c - T, y0, s0, c + T, y1, s1, logMat);
        else box(s0, y0, c - T, s1, y1, c + T, logMat);
      }
    };
    wall('z', -3, -4.15, 4.15, [[-3.0, -1.7, 0.95, 1.85], [-0.55, 0.55, 0, 2.15], [1.7, 3.0, 0.95, 1.85]]);
    wall('z', 3, -4.15, 4.15, [[-3.3, -2.1, 1.05, 1.85]]);
    wall('x', -4, -3.15, 3.15, [[-1.2, 0.2, 0.95, 1.85]]);
    wall('x', 4, -3.15, 3.15, [[-0.4, 1.0, 0.95, 1.85]]);
    // corner log ends, for that hand-built silhouette
    const endGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.7, 7);
    endGeo.rotateZ(Math.PI / 2);
    for (const [cx, cz] of [[-3, -4], [3, -4], [-3, 4], [3, 4]]) {
      for (let y = 0.15; y < H; y += 0.3) {
        const e1 = new THREE.Mesh(endGeo, logMat); e1.position.set(cx, y, cz); grp.add(e1);
        const e2 = new THREE.Mesh(endGeo, logMat); e2.rotation.y = Math.PI / 2; e2.position.set(cx, y + 0.15, cz); grp.add(e2);
      }
    }
    // gables (north/south) and roof
    for (const zc of [-4, 4]) {
      const gs = new THREE.Shape();
      gs.moveTo(-3.15, 0); gs.lineTo(3.15, 0); gs.lineTo(0, 1.6); gs.closePath();
      const gg = new THREE.ShapeGeometry(gs);
      const uvA = gg.attributes.uv, pA = gg.attributes.position;
      for (let i = 0; i < uvA.count; i++) uvA.setXY(i, pA.getX(i) / 1.6, pA.getY(i) / 1.6);
      const gm = new THREE.Mesh(gg, psxMaterial({ map: logs, color: 0xd8c0a0, side: THREE.DoubleSide }));
      gm.position.set(0, H, zc); grp.add(gm);
    }
    const roofSide = (x0, y0, x1, y1) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const g = segBox(len, 0.12, 9.2);
      boxUV(g, len, 0.12, 9.2, 1.4);
      const m = new THREE.Mesh(g, roofMat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2 + 0.06, 0);
      m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
    };
    roofSide(-6.1, 2.25, 0, H + 1.6);   // west slope, over the porch
    roofSide(0, H + 1.6, 3.7, H + 0.55);
    // plank ceiling inside (so you don't stare at the underside of the shingles)
    const ceilG = new THREE.PlaneGeometry(6.0, 8.0, 3, 4);
    const cu = ceilG.attributes.uv; for (let i = 0; i < cu.count; i++) cu.setXY(i, cu.getX(i) * 3, cu.getY(i) * 4);
    const ceil = new THREE.Mesh(ceilG, plankMat);
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H - 0.02, 0); ceil.receiveShadow = true;
    grp.add(ceil);
    for (let bz = -3.5; bz <= 3.5; bz += 1.75) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.16, 0.14), darkMat);
      beam.position.set(0, H - 0.1, bz); grp.add(beam);
    }
    // porch posts and railing
    for (const pz of [-4.1, -1.2, 1.2, 4.1]) box(-5.75, 0, pz - 0.09, -5.57, 2.35, pz + 0.09, darkMat);
    box(-5.75, 0.85, -4.2, -5.6, 0.95, -1.2, darkMat);
    box(-5.75, 0.85, 1.2, -5.6, 0.95, 4.2, darkMat);
    // chimney pipe
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 3.2, 8), psxMaterial({ color: 0x222222 }));
    pipe.position.set(2.45, 2.6, 0.4); grp.add(pipe);

    // windows: glass panes that glow warm at night when the lamp is on
    this.windowMat = psxMaterial({ color: 0x8fa4ad, transparent: true, opacity: 0.28, emissive: 0x000000, depthWrite: false });
    const pane = (x, y, z, w, h, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.windowMat);
      m.position.set(x, y, z); m.rotation.y = ry; grp.add(m);
    };
    pane(-3, 1.4, -2.35, 1.3, 0.9, Math.PI / 2); pane(-3, 1.4, 2.35, 1.3, 0.9, Math.PI / 2);
    pane(3, 1.45, -2.7, 1.2, 0.8, Math.PI / 2); pane(-0.5, 1.4, -4, 1.4, 0.9, 0); pane(0.3, 1.4, 4, 1.4, 0.9, 0);

    // the front door (west wall), hinged
    const doorPivot = new THREE.Group();
    doorPivot.position.set(-3, 0, -0.55);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.12, 1.1), darkMat);
    door.position.set(0, 1.06, 0.55);
    door.castShadow = true;
    doorPivot.add(door);
    grp.add(doorPivot);
    this.doorPivot = doorPivot;
    this.doorBox = col.add({ x0: OX - 3.06, x1: OX - 2.94, y0: Y, y1: Y + 2.15, z0: OZ - 0.55, z1: OZ + 0.55, dynamic: true, mat: 'wood' });
    this.interact.push({
      pos: new THREE.Vector3(OX - 3, Y + 1.1, OZ), r: 1.7,
      label: () => (this.doorOpen ? 'Close door' : 'Open door'),
      act: () => this.toggleDoor(),
    });

    // --- interior ---
    const furniture = (name, fallback, x, z, rot, height, colBox) => {
      let m = name ? modelMesh(name, { height }) : null;
      if (!m) m = fallback();
      m.position.set(x, 0, z); m.rotation.y = rot || 0;
      grp.add(m);
      if (colBox) col.add({ x0: OX + colBox[0], x1: OX + colBox[2], y0: Y, y1: Y + colBox[4], z0: OZ + colBox[1], z1: OZ + colBox[3], mat: 'wood' });
      return m;
    };
    const blocky = (w, h, d, mat, y0 = 0) => () => {
      const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      g.position.y = y0 + h / 2; g.castShadow = true; g.receiveShadow = true;
      const o = new THREE.Group(); o.add(g); return o;
    };
    // bed (SE corner)
    furniture(pickModel('bed_single', 'bed_double'), () => proceduralBed(darkMat), 2.2, 2.9, -Math.PI / 2, 0.75, [1.55, 1.9, 2.85, 3.9, 0.55]);
    // kitchen counter (NE) along the east wall
    furniture(pickModel('kitchen_cabinet', 'kitchen_drawers'), blocky(0.65, 0.9, 2.2, darkMat), 2.5, -2.9, 0, 0.9, [2.15, -4.0, 2.85, -1.8, 0.9]);
    // wood stove (east wall, centre)
    const stove = new THREE.Group();
    const sm = psxMaterial({ color: 0x1b1b1b });
    const sb = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.8, 0.7), sm); sb.position.y = 0.45; stove.add(sb);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.22), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    glow.position.set(-0.38, 0.45, 0); glow.rotation.y = -Math.PI / 2; stove.add(glow);
    this.stoveGlow = glow;
    for (const [lx, lz] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.06), sm); leg.position.set(lx, 0.05, lz); stove.add(leg);
    }
    stove.position.set(2.42, 0, 0.4);
    grp.add(stove);
    col.add({ x0: OX + 2.05, x1: OX + 2.8, y0: Y, y1: Y + 0.85, z0: OZ + 0.05, z1: OZ + 0.75, mat: 'metal' });
    this.stoveLight = new THREE.PointLight(0xff8a3a, 0, 9, 2);
    this.stoveLight.position.set(OX + 1.8, Y + 0.6, OZ + 0.4);
    this.stoveLight.castShadow = true;
    this.stoveLight.shadow.mapSize.set(512, 512);
    this.stoveLight.shadow.bias = -0.004;
    this.scene.add(this.stoveLight);
    this.interact.push({
      pos: new THREE.Vector3(OX + 2.4, Y + 0.85, OZ + 0.4), r: 1.6,
      label: () => G.game.stoveLabel(),
      act: () => G.game.stoveAction(),
    });
    // table + chairs + radio (centre west)
    furniture(pickModel('table_round'), blocky(1.2, 0.76, 0.8, darkMat), -1.3, -1.6, 0, 0.76, [-1.9, -2.0, -0.7, -1.2, 0.76]);
    furniture(pickModel('chair_1', 'chair_2'), blocky(0.45, 0.9, 0.45, darkMat), -1.3, -0.85, Math.PI, 0.9, null);
    furniture(pickModel('chair_1', 'chair_2'), blocky(0.45, 0.9, 0.45, darkMat), -1.3, -2.45, 0, 0.9, null);
    const radio = new THREE.Group();
    const rb = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.14), psxMaterial({ color: 0x5b3b22 }));
    rb.position.y = 0.1; radio.add(rb);
    const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.06), new THREE.MeshBasicMaterial({ color: 0x332200 }));
    dial.position.set(0.06, 0.12, 0.071); radio.add(dial);
    this.radioDial = dial;
    radio.position.set(-1.1, 0.77, -1.6);
    grp.add(radio);
    this.interact.push({ pos: new THREE.Vector3(OX - 1.1, Y + 0.9, OZ - 1.6), r: 1.3, label: () => G.game.radioLabel(), act: () => G.game.radioAction() });
    // pantry chest (NW): storage
    furniture(pickModel('bookshelf'), blocky(1.0, 0.6, 0.55, darkMat), -2.4, -3.5, 0, 0.6, [-2.9, -3.85, -1.9, -3.15, 0.6]);
    this.interact.push({ pos: new THREE.Vector3(OX - 2.4, Y + 0.6, OZ - 3.5), r: 1.4, label: () => 'Pantry chest', act: () => G.game.openStorage() });
    // workbench (SW, under the window)
    furniture(pickModel('desk'), blocky(0.7, 0.85, 1.6, darkMat), -2.45, 2.6, 0, 0.85, [-2.85, 1.8, -2.1, 3.4, 0.85]);
    this.interact.push({ pos: new THREE.Vector3(OX - 2.45, Y + 0.9, OZ + 2.6), r: 1.5, label: () => 'Workbench', act: () => G.game.openWorkbench() });
    // bed interaction
    this.interact.push({ pos: new THREE.Vector3(OX + 2.2, Y + 0.6, OZ + 2.9), r: 1.6, label: () => G.game.bedLabel(), act: () => G.game.sleep() });
    // rug
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.5), psxMaterial({ map: canvasTex(16, 16, (g) => {
      g.fillStyle = '#5a1f1a'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#a07a3a';
      g.fillRect(1, 1, 14, 1); g.fillRect(1, 14, 14, 1); g.fillRect(1, 1, 1, 14); g.fillRect(14, 1, 1, 14);
      g.fillStyle = '#2c3f4a'; g.fillRect(5, 5, 6, 6);
    }, { repeat: false }) }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(0.2, 0.01, 0.8); rug.receiveShadow = true; grp.add(rug);

    // ceiling lamp + switch
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }));
    bulb.position.set(0, 2.45, 0); grp.add(bulb);
    this.bulb = bulb;
    this.lamp = new THREE.PointLight(0xffc98a, 6, 11, 2);
    this.lamp.position.set(OX, Y + 2.35, OZ);
    this.scene.add(this.lamp);
    this.interact.push({ pos: new THREE.Vector3(OX - 2.85, Y + 1.3, OZ + 0.9), r: 1.2, label: () => (this.lampOn ? 'Lamp off' : 'Lamp on'), act: () => { this.lampOn = !this.lampOn; G.audio.play('switch', { volume: 0.4 }); } });
    // a little switch plate
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.08), psxMaterial({ color: 0xdddccc }));
    sw.position.set(-2.84, 1.3, 0.9); grp.add(sw);

    // outside: woodpile + chopping block (south side)
    const block = modelMesh(pickModel('stump', 'stump_moss') || '', { height: 0.55 }) || proceduralStump();
    block.position.set(0.5, -0.55, 6.6); grp.add(block);
    col.addCircle(OX + 0.5, OZ + 6.6, 0.35, Y - 1, Y);
    const logGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.9, 7); logGeo.rotateZ(Math.PI / 2);
    const pile = new THREE.Group();
    for (let i = 0; i < 18; i++) {
      const l = new THREE.Mesh(logGeo, logMat);
      const row = Math.floor(i / 6), k = i % 6;
      l.position.set(0, 0.14 + row * 0.26, k * 0.29 - 0.8 + (row % 2) * 0.12);
      l.rotation.y = Math.PI / 2 + (Math.random() - 0.5) * 0.1;
      l.castShadow = true; pile.add(l);
    }
    pile.position.set(-1.6, -0.55, 4.6); pile.rotation.y = Math.PI / 2;
    grp.add(pile);
    col.add({ x0: OX - 2.6, x1: OX - 0.6, y0: Y - 0.6, y1: Y + 0.3, z0: OZ + 4.2, z1: OZ + 5.0, mat: 'wood' });
    this.interact.push({ pos: new THREE.Vector3(OX + 0.5, Y, OZ + 6.6), r: 1.8, label: () => G.game.chopLabel(), act: () => G.game.chop() });

    // an old pickup truck that brought us here (it runs, mostly)
    const truck = proceduralTruck();
    truck.position.set(OX + 7.5, heightAt(OX + 7.5, OZ + 12), OZ + 12);
    truck.rotation.y = 0.3;
    this.scene.add(truck);
    col.add({ x0: OX + 5.6, x1: OX + 9.4, y0: truck.position.y, y1: truck.position.y + 1.8, z0: OZ + 9.5, z1: OZ + 14.5 });

    this.cabinRect = { x0: OX - 3.0, x1: OX + 3.0, z0: OZ - 4.0, z1: OZ + 4.0, y0: Y - 0.2, y1: Y + 2.8 };
    this.roofRect = { x0: OX - 6.2, x1: OX + 3.8, z0: OZ - 4.6, z1: OZ + 4.6 };
    this.bedPos = { x: OX + 1.2, y: Y, z: OZ + 2.9 };
    this.spawn = { x: OX + 0.8, y: Y, z: OZ + 2.4, yaw: Math.PI * 0.5 };
  }

  toggleDoor() {
    this.doorOpen = !this.doorOpen;
    this.doorBox.disabled = this.doorOpen;
    this.G.audio.play('door_wood', { position: this.doorPivot.getWorldPosition(new THREE.Vector3()) });
  }

  inCabin(x, y, z) {
    const r = this.cabinRect;
    return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 && y > r.y0 && y < r.y1;
  }
  underRoof(x, z) {
    const r = this.roofRect;
    return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
  }

  // --- dock --------------------------------------------------------------------------

  buildDock() {
    const col = this.G.collider;
    const mat = psxMaterial({ map: tex('dock_planks') });
    const y = 0.75;
    const x0 = 93, x1 = 116, z0 = 13, z1 = 15.2;
    const g = segBox(x1 - x0, 0.14, z1 - z0);
    boxUV(g, x1 - x0, 0.14, z1 - z0, 2);
    const deck = new THREE.Mesh(g, mat);
    deck.position.set((x0 + x1) / 2, y - 0.07, (z0 + z1) / 2);
    deck.castShadow = true; deck.receiveShadow = true;
    this.scene.add(deck);
    col.add({ x0, x1, y0: y - 0.5, y1: y, z0, z1, mat: 'wood' });
    const postMat = psxMaterial({ map: tex('wood_dark') });
    for (let x = x0 + 0.2; x < x1; x += 2.5) for (const z of [z0 + 0.1, z1 - 0.1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), postMat);
      p.position.set(x, y - 1.4, z); this.scene.add(p);
    }
    // a little bench at the end of the dock
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 1.4), postMat);
    bench.position.set(x0 + 1.2, y + 0.22, (z0 + z1) / 2); bench.castShadow = true; this.scene.add(bench);
    this.dockRect = { x0, x1, z0, z1, y };
  }

  // --- road --------------------------------------------------------------------------

  buildRoad() {
    // a strip of dirt texture draped over the graded road line
    const pts = [];
    for (let i = 0; i < ROAD.length - 1; i++) {
      const [ax, az] = ROAD[i], [bx, bz] = ROAD[i + 1];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 2);
      for (let k = 0; k < n; k++) pts.push([lerp(ax, bx, k / n), lerp(az, bz, k / n)]);
    }
    pts.push(ROAD[ROAD.length - 1]);
    const pos = [], uv = [], idx = [];
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      const [nx, nz] = pts[Math.min(i + 1, pts.length - 1)], [px, pz] = pts[Math.max(i - 1, 0)];
      let dx = nx - px, dz = nz - pz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      if (i > 0) along += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      for (const s of [-1.6, 1.6]) {
        const vx = x - dz * s, vz = z + dx * s;
        pos.push(vx, heightAt(vx, vz) + 0.05, vz);
        uv.push(s > 0 ? 1 : 0, along / 3.2);
      }
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, psxMaterial({ map: tex('dirt_road'), polygonOffset: true, polygonOffsetFactor: -2 }));
    m.receiveShadow = true;
    this.scene.add(m);
  }

  // --- the fenced entrance at the foot of the mountain ---------------------------------

  buildFacilityEntrance() {
    const G = this.G, col = G.collider, S = this.scene;
    const Y = clearingY;
    const z = DOOR.z;
    const rock = psxMaterial({ map: tex('rock_cliff'), color: 0xa8a8a0 });
    const conc = psxMaterial({ map: tex('concrete_dirty') });
    const addBox = (x0, y0, z0, x1, y1, z1, mat, uvs = 3, collide = true) => {
      const g = segBox(x1 - x0, y1 - y0, z1 - z0);
      boxUV(g, x1 - x0, y1 - y0, z1 - z0, uvs);
      const m = new THREE.Mesh(g, mat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      m.castShadow = true; m.receiveShadow = true; S.add(m);
      if (collide) col.add({ x0, x1, y0, y1, z0, z1, mat: 'stone' });
      return m;
    };
    // cliff face with a concrete portal
    addBox(-34, Y - 4, z - 10, -2.6, Y + 22, z, rock, 4);
    addBox(2.6, Y - 4, z - 10, 34, Y + 22, z, rock, 4);
    addBox(-2.6, Y + 3.2, z - 10, 2.6, Y + 22, z, rock, 4);
    addBox(-3.4, Y - 0.2, z - 0.2, -2.4, Y + 3.8, z + 0.6, conc, 1.5);
    addBox(2.4, Y - 0.2, z - 0.2, 3.4, Y + 3.8, z + 0.6, conc, 1.5);
    addBox(-3.4, Y + 3.0, z - 0.2, 3.4, Y + 3.8, z + 0.6, conc, 1.5);
    addBox(-3.4, Y - 0.3, z - 2, 3.4, Y, z + 1.6, conc, 1.5);  // threshold slab
    // dark interior behind the doors
    const voidM = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 3.2), new THREE.MeshBasicMaterial({ color: 0x020202 }));
    voidM.position.set(0, Y + 1.6, z - 1.5); S.add(voidM);
    // rocks to hide the seams
    const rocks = ['rock_moss_1', 'rock_moss_3', 'rock_2', 'rock_moss_5', 'rock_1', 'rock_moss_6'].filter((n) => modelGeom(n));
    const rr = rng(99);
    for (let i = 0; i < 26 && rocks.length; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (7 + rr() * 28), zz = z + 0.5 + rr() * 2.5 - (Math.abs(x) > 20 ? rr() * 6 : 0);
      const m = modelMesh(rocks[i % rocks.length], { scale: 1.1 + rr() * 1.6 });
      m.position.set(x, heightAt(x, zz) - 0.6, zz); m.rotation.y = rr() * 6.28;
      S.add(m);
    }

    // the doors: heavy steel double door, padlocked hasp
    const steel = psxMaterial({ map: tex('metal_panel'), color: 0x7a8580 });
    this.facilityDoors = [];
    for (const side of [-1, 1]) {
      const piv = new THREE.Group();
      piv.position.set(side * 2.4, Y, z + 0.2);
      const d = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.0, 0.12), steel);
      d.position.set(-side * 1.2, 1.5, 0); d.castShadow = true;
      piv.add(d);
      // warning stripe
      const st = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.25), psxMaterial({ map: tex('hazard_stripes') }));
      st.position.set(-side * 1.2, 0.35, 0.065); piv.add(st);
      S.add(piv);
      this.facilityDoors.push(piv);
    }
    this.facilityDoorBox = col.add({ x0: -2.4, x1: 2.4, y0: Y, y1: Y + 3, z0: z, z1: z + 0.35, dynamic: true, mat: 'metal' });
    const lock = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.06), psxMaterial({ color: 0x8a7a3a }));
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 4, 8, Math.PI), psxMaterial({ color: 0x9a9a9a }));
    shackle.position.y = 0.07;
    lock.add(body, shackle);
    lock.position.set(0, Y + 1.25, z + 0.33);
    S.add(lock);
    this.padlock = lock;
    this.interact.push({
      pos: new THREE.Vector3(0, Y + 1.3, z + 0.6), r: 2.2,
      label: () => G.game.facilityDoorLabel(),
      act: () => G.game.facilityDoorAction(),
    });
    // small floodlight above the door that died long ago, and a utility box
    addBox(-5.6, Y, z + 0.1, -4.4, Y + 1.5, z + 0.8, psxMaterial({ map: tex('metal_rusty') }), 1);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 7, 6), psxMaterial({ map: tex('wood_dark') }));
    pole.position.set(9, Y + 3.5, z + 6); S.add(pole); col.addCircle(9, z + 6, 0.2);

    // chain-link fence with a hanging-open gate
    const chain = tex('chainlink');
    chain.wrapS = chain.wrapT = THREE.RepeatWrapping;
    const fenceMat = psxMaterial({ map: chain, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, color: 0xbbbbbb });
    const postMat = psxMaterial({ color: 0x777b7d });
    const fx0 = -12, fx1 = 12, fz0 = z + 0.5, fz1 = z + 19;
    const fenceSeg = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const g = new THREE.PlaneGeometry(len, 2.4);
      const uvA = g.attributes.uv;
      for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * len / 1.2, uvA.getY(i) * 2);
      const m = new THREE.Mesh(g, fenceMat);
      const yy = (heightAt(ax, az) + heightAt(bx, bz)) / 2;
      m.position.set((ax + bx) / 2, yy + 1.2, (az + bz) / 2);
      m.rotation.y = -Math.atan2(bz - az, bx - ax);
      S.add(m);
      const n = Math.ceil(len / 3);
      for (let i = 0; i <= n; i++) {
        const px = lerp(ax, bx, i / n), pz = lerp(az, bz, i / n);
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5), postMat);
        p.position.set(px, heightAt(px, pz) + 1.3, pz); S.add(p);
      }
      col.add({ x0: Math.min(ax, bx) - 0.05, x1: Math.max(ax, bx) + 0.05, y0: yy - 2, y1: yy + 2.4, z0: Math.min(az, bz) - 0.05, z1: Math.max(az, bz) + 0.05 });
    };
    fenceSeg(fx0, fz0, fx0, fz1); fenceSeg(fx1, fz0, fx1, fz1);
    fenceSeg(fx0, fz1, -1.8, fz1); fenceSeg(1.8, fz1, fx1, fz1);
    // the gate leaf, swung open and sagging
    const gate = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.2), fenceMat);
    gate.position.set(-1.8 + 1.2, heightAt(0, fz1) + 1.1, fz1 + 1.3); gate.rotation.y = -1.1; gate.rotation.z = 0.05;
    S.add(gate);
    // signs
    const signTex = tex('sign_restricted');
    for (const [sx, sy] of [[-6, 1.4], [6, 1.4]]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), psxMaterial({ map: signTex }));
      s.position.set(sx, heightAt(sx, fz1) + sy, fz1 + 0.04); S.add(s);
    }
    this.doorArea = { x: 0, y: Y, z: z + 1.6 };
    // after the red sky: a faint red pulse leaks around the door frame at night
    this.beacon = new THREE.PointLight(0xff2010, 0, 25, 2);
    this.beacon.position.set(0, Y + 1.5, z + 1.2);
    S.add(this.beacon);
  }

  openFacilityDoors() {
    this.facilityDoorBox.disabled = true;
    this.padlock.visible = false;
  }

  // --- the old fire lookout on the western ridge ---------------------------------------

  buildLookout() {
    const { x, z } = LOOKOUT;
    const y = heightAt(x, z);
    const col = this.G.collider, S = this.scene;
    const wood = psxMaterial({ map: tex('wood_dark') });
    const planks = psxMaterial({ map: tex('dock_planks') });
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, 11, 0.25), wood);
      p.position.set(x + dx, y + 5.5, z + dz); p.castShadow = true; S.add(p);
      col.add({ x0: x + dx - 0.13, x1: x + dx + 0.13, y0: y - 1, y1: y + 11, z0: z + dz - 0.13, z1: z + dz + 0.13 });
    }
    // braces
    for (let k = 1; k < 4; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 0.12), wood);
      b.position.set(x, y + k * 2.6, z - 2); S.add(b);
      const b2 = b.clone(); b2.position.z = z + 2; S.add(b2);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(5, 0.2, 5), planks);
    deck.position.set(x, y + 11, z); deck.castShadow = true; deck.receiveShadow = true; S.add(deck);
    col.add({ x0: x - 2.5, x1: x + 2.5, y0: y + 10.9, y1: y + 11.1, z0: z - 2.5, z1: z + 0.9 });
    col.add({ x0: x - 2.5, x1: x + 1.5, y0: y + 10.9, y1: y + 11.1, z0: z + 0.9, z1: z + 2.5 });
    // cabin on top
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.6, 4), psxMaterial({ map: tex('roof_shingles') }));
    roof.position.set(x, y + 14.4, z); roof.rotation.y = Math.PI / 4; S.add(roof);
    for (const [dx, dz] of [[-2.3, -2.3], [2.3, -2.3], [-2.3, 2.3], [2.3, 2.3]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.6, 0.15), wood);
      p.position.set(x + dx, y + 12.4, z + dz); S.add(p);
    }
    for (const [cx, cz, w, d] of [[0, -2.4, 5, 0.1], [0, 2.4, 5, 0.1], [-2.4, 0, 0.1, 5]]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), wood);
      r.position.set(x + cx, y + 11.6, z + cz); S.add(r);
      col.add({ x0: x + cx - w / 2, x1: x + cx + w / 2, y0: y + 11, y1: y + 12.1, z0: z + cz - d / 2, z1: z + cz + d / 2 });
    }
    // ladder up through a hatch on the east side
    const lad = new THREE.Group();
    for (const s of [-0.25, 0.25]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 11.2, 0.06), wood);
      rail.position.set(0, 5.6, s); lad.add(rail);
    }
    for (let k = 0.3; k < 11; k += 0.35) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.5), wood); rung.position.set(0, k, 0); lad.add(rung);
    }
    lad.position.set(x + 2.15, y, z + 1.7); S.add(lad);
    this.ladders.push({ x0: x + 1.55, x1: x + 2.55, z0: z + 1.2, z1: z + 2.3, y0: y - 0.5, y1: y + 11.3 });
    // an old logbook up there
    this.interact.push({ pos: new THREE.Vector3(x - 1.5, y + 12, z - 1.5), r: 1.6, label: () => 'Fire lookout logbook', act: () => this.G.game.readNote('lookout') });
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.22), psxMaterial({ color: 0x3a2a1a }));
    const table = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), wood);
    table.position.set(x - 1.5, y + 11.5, z - 1.5); book.position.set(x - 1.5, y + 11.93, z - 1.5);
    S.add(table, book);
  }

  // --- rain --------------------------------------------------------------------------

  buildRain() {
    const N = 4500;
    const seed = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2), pos = new Float32Array(N * 2 * 3);
    const r = rng(5);
    for (let i = 0; i < N; i++) {
      const a = r(), b = r(), c = r();
      for (let k = 0; k < 2; k++) { seed.set([a, b, c], (i * 2 + k) * 3); end[i * 2 + k] = k; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('endp', new THREE.BufferAttribute(end, 1));
    this.rainU = {
      uTime: { value: 0 }, uRain: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2(0.4, 0.2) },
      uRoof: { value: new THREE.Vector4() }, uRoofY: { value: 0 }, uLight: { value: 1 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute vec3 seed; attribute float endp;
        uniform float uTime, uRain; uniform vec3 uCam; uniform vec2 uWind; uniform vec4 uRoof; uniform float uRoofY;
        varying float vA;
        void main() {
          float B = 34.0, H = 22.0;
          vec3 p;
          p.x = uCam.x + mod(seed.x * B - uCam.x, B) - B * 0.5;
          p.z = uCam.z + mod(seed.z * B - uCam.z, B) - B * 0.5;
          p.y = uCam.y + mod(seed.y * H - uTime * 13.0, H) - H * 0.5;
          vec3 vel = vec3(uWind.x * 3.0, -13.0, uWind.y * 3.0);
          p += vel * 0.045 * endp;
          float covered = (p.x > uRoof.x && p.x < uRoof.y && p.z > uRoof.z && p.z < uRoof.w && p.y < uRoofY) ? 0.0 : 1.0;
          vA = step(fract(seed.x * 17.3 + seed.z * 7.1), uRain) * covered;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying float vA; uniform float uLight;
        void main() { if (vA < 0.5) discard; gl_FragColor = vec4(vec3(0.62, 0.68, 0.72) * uLight, 0.45); }`,
    });
    this.rain = new THREE.LineSegments(g, m);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  // --- collision setup -----------------------------------------------------------------
  // (boxes/circles were added straight into the collider during build; the terrain
  //  is a height function)
  attach(col) { col.heightFn = heightAt; }

  // --- per frame ---------------------------------------------------------------------

  update(dt, cam) {
    const G = this.G, S = this.scene;
    this.t += dt;
    const hour = G.state.hour;
    this.updateWeather(dt);
    const w = this.weather;

    // sun path: rises in the east (+x), crosses the south (+z), sets in the west
    const ang = ((hour - 6) / 12) * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang) * 0.9, 0.42).normalize();
    const sunUp = smoothstep(-0.12, 0.3, sunDir.y);
    const night = 1 - smoothstep(-0.25, 0.05, sunDir.y);
    const golden = smoothstep(0.35, 0.05, sunDir.y) * sunUp;

    // palette: Oregon grey, warm low sun, blue night
    const dayTop = new THREE.Color(0x6f8fae).lerp(new THREE.Color(0x8a9399), w.cover);
    const dayHor = new THREE.Color(0xc3cdd0).lerp(new THREE.Color(0x9aa29f), w.cover);
    dayHor.lerp(new THREE.Color(0xd9a27a), golden * (1 - w.cover * 0.6));
    const nightTop = new THREE.Color(0x05080e), nightHor = new THREE.Color(0x101820);
    const top = nightTop.clone().lerp(dayTop, sunUp), hor = nightHor.clone().lerp(dayHor, sunUp);
    // lightning flash
    if (w.rain > 0.9 && Math.random() < dt * 0.05) { this.lightning = 1; G.audio.play('thunder', { volume: 0.9 }); }
    this.lightning = Math.max(0, this.lightning - dt * 3);
    top.offsetHSL(0, 0, this.lightning * 0.4); hor.offsetHSL(0, 0, this.lightning * 0.3);

    // red sky event
    this.updateRed(dt);
    const red = this.red;
    const redC = new THREE.Color(0x8a1206);
    top.lerp(new THREE.Color(0x3a0503), red); hor.lerp(redC, red);

    const su = this.skyU;
    su.uTop.value.copy(top); su.uHorizon.value.copy(hor);
    su.uSunDir.value.copy(sunDir);
    su.uSunColor.value.setRGB(1, 0.85 - golden * 0.25, 0.65 - golden * 0.35).multiplyScalar(sunUp);
    su.uCloud.value = w.cover; su.uTime.value = this.t; su.uRed.value = red; su.uNight.value = night; su.uWind.value = w.wind;
    this.sky.position.copy(cam.position);

    // fog
    const fogC = hor.clone().multiplyScalar(0.92);
    S.fog.color.copy(fogC);
    let fogD = w.fog;
    const mist = smoothstep(9, 6, hour) * smoothstep(3, 6, hour) * 0.012; // dawn mist over the lake
    S.fog.density = fogD + mist + red * 0.006;
    G.renderer.setClearColor(fogC);

    // lights
    const cloudDim = 1 - w.cover * 0.82;
    this.sun.intensity = (2.4 * sunUp * cloudDim + this.lightning * 3) * (1 - red * 0.6);
    this.sun.color.setRGB(1, 0.92 - golden * 0.25, 0.82 - golden * 0.4).lerp(new THREE.Color(1, 0.2, 0.1), red);
    const p = cam.position;
    const snapP = new THREE.Vector3(Math.round(p.x / 4) * 4, 0, Math.round(p.z / 4) * 4);
    this.sun.position.copy(snapP).addScaledVector(sunDir.y > 0 ? sunDir : new THREE.Vector3(-0.3, 0.8, 0.4), 160);
    this.sun.target.position.copy(snapP);
    this.updateForestLOD(p.x, p.z);
    this.hemi.color.copy(top).lerp(new THREE.Color(0xc8d0d8), 0.4);
    this.hemi.groundColor.setRGB(0.12, 0.14, 0.09);
    this.hemi.intensity = (0.25 + 1.6 * sunUp * (0.7 + w.cover * 0.3)) * (1 + red * 0.6) + this.lightning * 2;
    if (red > 0) this.hemi.color.lerp(new THREE.Color(1, 0.15, 0.08), red);
    // the far volcano only shows through clear-ish air, as a pale silhouette
    this.farMat.color.copy(hor).multiplyScalar(0.92);
    this.farMat.opacity = clamp(0.5 * (1 - (S.fog.density - 0.006) * 90), 0, 0.5) * (0.25 + 0.75 * sunUp) * (1 - red);

    // cabin lights
    const lampI = this.lampOn ? 7 : 0;
    this.lamp.intensity = damp(this.lamp.intensity, lampI, 10, dt);
    this.bulb.material.color.setHex(this.lampOn ? 0xffe0a0 : 0x333028);
    const flick = 0.85 + Math.sin(this.t * 13) * 0.06 + Math.sin(this.t * 31.7) * 0.05 + (Math.random() - 0.5) * 0.08;
    this.stoveLight.intensity = this.stoveLit ? 5 * flick : 0;
    this.stoveGlow.material.color.setRGB(this.stoveLit ? 1 * flick : 0.02, this.stoveLit ? 0.45 * flick : 0.02, this.stoveLit ? 0.1 : 0.02);
    const glowW = (this.lampOn ? 1 : 0) * 0.55 + (this.stoveLit ? 0.25 : 0);
    this.windowMat.emissive.setRGB(1, 0.68, 0.35).multiplyScalar(glowW * (0.25 + 0.75 * night));
    this.windowMat.opacity = 0.28 + glowW * night * 0.4;

    // beacon at the facility door after the event
    if (G.state.redSkyDone && !G.state.padlockBroken) {
      this.beacon.intensity = (0.5 + 0.5 * Math.sin(this.t * 1.7)) * 6 * (0.3 + night);
    } else this.beacon.intensity = 0;

    // water + rain
    const lu = this.lakeU;
    lu.uTime.value = this.t; lu.uRain.value = w.rain; lu.uFogColor.value.copy(fogC); lu.uFogDensity.value = S.fog.density;
    lu.uLight.value = 0.2 + sunUp * 0.8;
    lu.uDeep.value.setRGB(0.05, 0.1, 0.09).lerp(new THREE.Color(0.25, 0.02, 0.01), red);
    const ru = this.rainU;
    ru.uTime.value = this.t; ru.uRain.value = w.rain; ru.uCam.value.copy(cam.position);
    ru.uWind.value.set(w.wind * 0.8, w.wind * 0.3);
    const rr = this.roofRect; ru.uRoof.value.set(rr.x0, rr.x1, rr.z0, rr.z1); ru.uRoofY.value = cabinFloorY + 3.8;
    ru.uLight.value = 0.35 + sunUp * 0.65;

    // audio environment
    const inside = this.inCabin(G.player.x, G.player.y, G.player.z) ? 1 : 0;
    const lakeD = Math.hypot(G.player.x / LAKE.rx, G.player.z / LAKE.rz);
    const stoveD = Math.hypot(G.player.x - this.stoveLight.position.x, G.player.z - this.stoveLight.position.z);
    G.audio.setEnvironment({
      outdoor: 1, underground: 0, deep: 0, hum: 0, inside, rain: w.rain, wind: w.wind, night,
      lake: clamp(1.6 - lakeD, 0, 1) * (1 - inside * 0.7), stove: this.stoveLit ? clamp(1 - stoveD / 6, 0, 1) : 0,
      redsky: red, danger: 0,
    });
    this.night = night; this.sunUp = sunUp;
  }

  updateWeather(dt) {
    const G = this.G, w = this.weather;
    const absHour = G.state.day * 24 + G.state.hour;
    if (absHour > w.nextAbs || w.nextAbs === undefined) {
      if (w.nextAbs !== undefined) {
        const names = Object.keys(WEATHER);
        let total = 0; for (const n of names) total += WEATHER[n].w;
        let pick = Math.random() * total;
        for (const n of names) { pick -= WEATHER[n].w; if (pick <= 0) { w.name = n; break; } }
      }
      w.nextAbs = absHour + 2 + Math.random() * 4;
    }
    const target = WEATHER[w.name];
    const rate = dt * 0.05;
    for (const k of ['cover', 'rain', 'fog', 'wind']) w[k] = damp(w[k], target[k], 1, rate);
  }

  setWeather(name) {
    const w = this.weather;
    w.name = name; Object.assign(w, WEATHER[name]);
    w.nextAbs = this.G.state.day * 24 + this.G.state.hour + 3 + Math.random() * 3;
  }

  startRedSky() {
    this.redT = 0;
    this.G.audio.play('boom', { volume: 1 });
  }

  updateRed(dt) {
    if (this.redT < 0) { this.red = damp(this.red, 0, 0.5, dt); return; }
    this.redT += dt;
    const t = this.redT;
    // 0-2 s: the boom rolls in; 2-6 s: the sky floods red; holds ~50 s; fades over 30 s
    let target = 0;
    if (t < 2) target = 0.1 * t;
    else if (t < 6) target = 0.2 + (t - 2) / 4 * 0.8;
    else if (t < 56) target = 1;
    else if (t < 86) target = 1 - (t - 56) / 30;
    else { target = 0; this.redT = -1; }
    this.red = damp(this.red, target, 3, dt);
    this.G.post.u.uTint.value.set(1 + this.red * 0.15, 1 - this.red * 0.35, 1 - this.red * 0.4);
    if (this.redT < 0) this.G.post.u.uTint.value.set(1, 1, 1);
  }

  /** What is the player walking on? (footstep sounds) */
  surfaceAt(x, y, z) {
    if (y < -0.1 || this.waterAt(x, z) !== undefined) return 'step_water';
    const d = this.dockRect;
    if (x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1 && Math.abs(y - d.y) < 0.2) return 'step_wood';
    if (this.inCabin(x, y + 0.1, z) || (Math.abs(y - cabinFloorY) < 0.2 && this.underRoof(x, z))) return 'step_wood';
    if (y > cabinFloorY + 5) return 'step_wood'; // lookout
    if (distToPolyline(x, z, ROAD) < 2.2) return 'step_dirt';
    if (Math.hypot(x / LAKE.rx, z / LAKE.rz) < 1.06) return 'step_stone';
    return 'step_grass';
  }

  /** Water surface height at (x,z), or undefined on dry land. */
  waterAt(x, z) { return heightAt(x, z) < 0 && Math.hypot(x / LAKE.rx, z / LAKE.rz) < 1.02 ? 0 : undefined; }

  /** Is there fishable water at (x,z)? */
  isWater(x, z) { return heightAt(x, z) < -0.6 && Math.hypot(x / LAKE.rx, z / LAKE.rz) < 0.98; }
}

const LOOKOUT = { x: -236, z: 52 };
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _s3 = new THREE.Vector3(), _p3 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------------
// procedural fallbacks + helpers
// ---------------------------------------------------------------------------------

/** Re-map a BoxGeometry's UVs to world-ish units so textures don't stretch. */
/** A BoxGeometry cut into ~2.5 m segments so affine texture mapping stays tame. */
export function segBox(w, h, d, step = 2.5) {
  return new THREE.BoxGeometry(w, h, d, Math.max(1, Math.ceil(w / step)), Math.max(1, Math.ceil(h / step)), Math.max(1, Math.ceil(d / step)));
}

export function boxUV(g, w, h, d, unit = 2) {
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (one group each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const idx = g.index;
  g.groups.forEach((grp, f) => {
    const [a, b] = dims[f];
    const seen = new Set();
    for (let k = grp.start; k < grp.start + grp.count; k++) {
      const i = idx.getX(k);
      if (seen.has(i)) continue;
      seen.add(i);
      uv.setXY(i, uv.getX(i) * a / unit, uv.getY(i) * b / unit);
    }
  });
}

function colorize(g, fn) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) c.set(fn(p.getX(i), p.getY(i), p.getZ(i)), i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function mergeGeoms(list) {
  let n = 0;
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

export function proceduralPine(cheap = false) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.25, 0.4, cheap ? 6 : 5, cheap ? 4 : 6);
  trunk.translate(0, cheap ? 3 : 2.5, 0);
  parts.push(colorize(trunk, () => [0.18, 0.11, 0.07]));
  const tiers = cheap ? 1 : 4;
  for (let i = 0; i < tiers; i++) {
    const r = cheap ? 2.6 : 3.2 - i * 0.65, h = cheap ? 14 : 5.5 - i * 0.6;
    const c = new THREE.ConeGeometry(r, h, cheap ? 5 : 7);
    c.translate(0, cheap ? 10 : 5 + i * 3, 0);
    const shade = 0.75 + i * 0.07;
    parts.push(colorize(c, (x, y) => [0.07 * shade, 0.16 * shade + (y > 0 ? 0.02 : 0), 0.09 * shade]));
  }
  return mergeGeoms(parts);
}

function proceduralMushroom() {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.1, 5), psxMaterial({ color: 0xd9c7a0 }));
  stem.position.y = 0.05;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.05, 6), psxMaterial({ color: 0xe0a030 }));
  cap.position.y = 0.11;
  g.add(stem, cap);
  return g;
}

function proceduralStump() {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 0.55, 8), psxMaterial({ color: 0x5a4028 }));
  s.position.y = 0.27; g.add(s);
  return g;
}

function proceduralBed(mat) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.35, 2.0), mat); frame.position.y = 0.2;
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.18, 1.9), psxMaterial({ color: 0x8a3a2a }));
  mattress.position.y = 0.46;
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.35), psxMaterial({ color: 0xddd8c8 }));
  pillow.position.set(0, 0.6, -0.75);
  g.add(frame, mattress, pillow);
  g.rotation.y = Math.PI / 2;
  const o = new THREE.Group(); o.add(g); return o;
}

function proceduralTruck() {
  const g = new THREE.Group();
  const body = psxMaterial({ color: 0x3f5a46 }), dark = psxMaterial({ color: 0x151515 }), glass = psxMaterial({ color: 0x223038 });
  const add = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; g.add(b); };
  add(1.9, 0.7, 4.8, 0, 0.75, 0, body);          // chassis
  add(1.8, 0.75, 1.6, 0, 1.45, -0.4, body);       // cab
  add(1.7, 0.5, 0.05, 0, 1.5, -1.21, glass);      // windscreen
  add(1.9, 0.45, 1.9, 0, 1.25, 1.4, body);        // bed walls
  for (const [x, z] of [[-0.95, -1.5], [0.95, -1.5], [-0.95, 1.5], [0.95, 1.5]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 8), dark);
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.38, z); g.add(w);
  }
  return g;
}
