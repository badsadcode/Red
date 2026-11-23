// main.js — boots the game and runs the loop. `G` is the shared context every
// module receives: renderer, camera, player, colliders, areas, audio, HUD, state.

import * as THREE from 'three';
import { RetroPost, loadSettings, saveSettings, applySettings } from './retro.js';
import { Input } from './input.js';
import { Collider, Player } from './physics.js';
import { AudioSys } from './audio.js';
import { loadAssets } from './assets.js';
import { Surface } from './surface.js';
import { Underground, STOPS } from './underground.js';
import { Game, newState } from './gameplay.js';
import { Hud } from './hud.js';
import { Viewmodel } from './viewmodel.js';
import { NOTES } from './lore.js';
import { clamp } from './util.js';

const SAVE_KEY = 'lakehouse.save.v1';
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

const G = window.G = {
  state: newState(),
  settings: loadSettings(),
  notes: NOTES,
  area: 'surface',
  shake: 0, flash: 0,
};

async function boot() {
  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = G.settings.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  G.renderer = renderer;
  G.post = new RetroPost(renderer);
  G.camera = new THREE.PerspectiveCamera(G.settings.fov, innerWidth / innerHeight, 0.05, 2200);
  G.camera.layers.enable(1);   // layer 1 = near detail the lake reflection skips
  G.input = new Input(canvas);
  G.audio = new AudioSys();
  G.player = new Player();
  G.surfaceCol = new Collider();
  G.underCol = new Collider();
  G.collider = G.surfaceCol;
  G.hud = new Hud(G);
  G.game = new Game(G);
  applySettings(G.settings, G.post);
  onResize();
  addEventListener('resize', onResize);

  // flashlight: a real shadow-casting spot that rides on the camera
  const fl = new THREE.SpotLight(0xfff4e0, 0, 34, 0.42, 0.45, 1.4);
  fl.castShadow = true;
  fl.shadow.mapSize.set(512, 512);
  fl.shadow.camera.near = 0.2;
  fl.shadow.bias = -0.0015;
  fl.position.set(0.15, -0.12, 0);
  fl.target.position.set(0, 0, -5);
  G.camera.add(fl, fl.target);
  G.flashlight = fl;

  const bar = document.getElementById('loadbar');
  await loadAssets((k) => { bar.style.width = `${(k * 70) | 0}%`; });
  bar.style.width = '75%';
  await tick();
  G.surface = new Surface(G).build();
  G.surface.attach(G.surfaceCol);
  bar.style.width = '95%';
  G.under = new Underground(G);
  G.viewmodel = new Viewmodel(G);
  bar.style.width = '100%';

  setupTitle();
  setupInput();
  G.scene = G.surface.scene;
  G.scene.add(G.camera);
  placeAtCabin();
  G.surface.update(0.016, G.camera);
  requestAnimationFrame(loop);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function onResize() {
  const w = innerWidth, h = innerHeight;
  G.renderer.setSize(w, h);
  G.camera.aspect = w / h;
  G.camera.updateProjectionMatrix();
  G.post.resize(w, h);
}

G.setSetting = (key, v) => {
  G.settings[key] = v;
  saveSettings(G.settings);
  applySettings(G.settings, G.post);
  G.post.resize(innerWidth, innerHeight);
  G.camera.fov = G.settings.fov; G.camera.updateProjectionMatrix();
  G.audio.setMasterVolume(G.settings.volume);
  if (key === 'shadows') { G.renderer.shadowMap.enabled = v; G.renderer.shadowMap.needsUpdate = true; G.renderer.compile(G.scene, G.camera); }
};

function placeAtCabin() {
  const s = G.surface.spawn;
  G.player.place(s.x, s.y, s.z, s.yaw);
}

// --- save / load ----------------------------------------------------------------------

G.save = () => {
  try {
    const S = G.state;
    S.where = G.area === 'surface' ? 'surface' : 'under';
    S.pos = G.area === 'surface' ? { x: G.player.x, y: G.player.y, z: G.player.z, yaw: G.player.yaw } : null;
    S.weather = G.surface.weather.name;
    S.platformY = G.under.platformY;
    S.lampOn = G.surface.lampOn;
    localStorage.setItem(SAVE_KEY, JSON.stringify(S));
  } catch (e) { console.warn('save failed', e); }
};

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return { ...newState(), ...JSON.parse(raw) };
  } catch { return null; }
}

// --- areas and travel ------------------------------------------------------------------

G.areaLabel = () => {
  if (G.area === 'hub') return 'Freight Shaft 1';
  if (G.area === 'lantern') return '???';
  const st = STOPS.find((s) => s.id === G.area);
  return st ? `${st.code} ${st.id === 'b7' ? '' : st.name}` : G.area;
};

G.fade = (target, secs = 0.6) => new Promise((resolve) => {
  G.fadeAnim = { from: G.post.u.uFade.value, to: target, t: 0, secs, resolve };
});

let traveling = false;
async function travel(fn, label) {
  if (traveling) return;
  traveling = true;
  G.game.cancelFishing();
  await G.fade(1, 0.6);
  if (label) G.hud.loading(label);
  await tick(); await tick();
  try { await fn(); } catch (e) { console.error(e); G.hud.toast('Something went wrong down there: ' + e.message, 6); }
  G.hud.loading(null);
  G.save();
  traveling = false;
  await G.fade(0, 0.8);
}

function setScene(scene) {
  if (G.camera.parent) G.camera.parent.remove(G.camera);
  G.scene = scene;
  scene.add(G.camera);
}

G.travel = {
  toHub(stopIndex = 0) {
    return travel(async () => {
      const from = G.area;
      await G.under.enter('hub');
      setScene(G.under.scene);
      G.area = 'hub';
      if (from === 'surface' || stopIndex === 0) {
        G.player.place(0, 0, -1.8, 0);
        G.audio.play('door_metal_open', { volume: 0.6 });
      } else {
        const L = G.under.landings[stopIndex - 1];
        G.player.place(L.x, L.y, L.z, Math.atan2(-(0 - L.x), -(-94 - L.z)));
      }
    }, 'Freight Shaft 1');
  },
  toSector(id, fromLantern = false) {
    const st = STOPS.find((s) => s.id === id);
    return travel(async () => {
      await G.under.enter(id);
      setScene(G.under.scene);
      G.area = id;
      const U = G.under;
      if (fromLantern) {
        const ex = U.sector.entities.find((e) => e.k === 'exit');
        G.player.place(ex.p[0] / 32 + 1.5, ex.p[2] / 32 + 0.2, -ex.p[1] / 32 + 1.5, 0);
      } else {
        G.player.place(U.startPos.x, U.startPos.y + 0.05, U.startPos.z, U.startYaw);
      }
      G.lastSafe = { x: G.player.x, y: G.player.y, z: G.player.z };
      if (!G.state.flags['visited_' + id]) {
        G.state.flags['visited_' + id] = true;
        setTimeout(() => G.hud.subtitle(id === 'b7' ? 'The air smells of old smoke and wet stone.' : `${st.code} — ${st.name}`, 5), 900);
      }
    }, `Descending to ${st.code}...`);
  },
  toLantern() {
    return travel(async () => {
      await G.under.enter('lantern');
      setScene(G.under.scene);
      G.area = 'lantern';
      G.player.place(G.under.startPos.x, G.under.startPos.y, G.under.startPos.z, 0);
      setTimeout(() => G.hud.subtitle('The stair goes down much farther than the mountain is tall.', 6), 1200);
    }, '...');
  },
  async toSurface(noFade = false) {
    const go = async () => {
      G.under.reset();
      G.collider = G.surfaceCol;
      setScene(G.surface.scene);
      G.area = 'surface';
      const d = G.surface.doorArea;
      G.player.place(d.x, d.y, d.z + 1.5, Math.PI);
    };
    if (noFade) return go();
    return travel(go, null);
  },
};

// --- title screen -----------------------------------------------------------------------

let started = false;
function setupTitle() {
  const save = loadSave();
  const t = document.getElementById('title');
  document.getElementById('loadwrap').style.display = 'none';
  document.getElementById('menu').style.display = 'flex';
  const cont = document.getElementById('btn-continue');
  if (!save) cont.style.display = 'none';
  cont.onclick = () => start(save);
  document.getElementById('btn-new').onclick = () => {
    if (save && !confirm('Start over? Your current save will be replaced.')) return;
    start(null);
  };
  document.getElementById('btn-settings').onclick = () => { G.hud.pauseMenu(); };
  if (DEBUG && params.get('area')) start(null);
}

async function start(save) {
  started = true;
  document.getElementById('title').style.display = 'none';
  document.getElementById('studio').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  await G.audio.init();
  G.audio.setMasterVolume(G.settings.volume);
  if (save) {
    G.state = save;
    G.surface.lampOn = save.lampOn !== false;
    if (save.weather) G.surface.setWeather(save.weather);
    if (save.platformY !== undefined) G.under.platformY = save.platformY;
    if (save.padlockBroken) G.surface.openFacilityDoors();
    if (save.where === 'surface' && save.pos) G.player.place(save.pos.x, save.pos.y, save.pos.z, save.pos.yaw);
    else if (save.where === 'under') { G.player.place(G.surface.doorArea.x, G.surface.doorArea.y, G.surface.doorArea.z + 1.5, Math.PI); }
    G.viewmodel.show(save.tool || 'hands');
  } else {
    G.state = newState();
    G.surface.setWeather('mist');
    placeAtCabin();
    setTimeout(() => G.hud.subtitle('Day one of the vacation. No phone signal, no plans. Just the lake.', 7), 1500);
    setTimeout(() => G.game.readNote('welcome'), 400);
  }
  G.input.lock();
  if (DEBUG) debugSetup();
}

function setupInput() {
  const canvas = G.renderer.domElement;
  canvas.addEventListener('click', () => { if (started && !G.hud.menuOpen && !G.input.locked) G.input.lock(); });
  G.input.onLockChange = (locked) => {
    if (!locked && started && !G.hud.menuOpen) G.hud.pauseMenu();
    if (locked && G.hud.menuOpen === 'pause') G.hud.close(false);
  };
  addEventListener('keydown', (e) => {
    if (!started) return;
    const m = G.hud.menuOpen;
    if (m && (e.code === 'KeyE' && m === 'note' || e.code === 'Tab' && m === 'inventory' || e.code === 'KeyM' && m === 'map')) { e.preventDefault(); G.hud.close(); return; }
    if (m) return;
    if (e.code === 'Tab') { e.preventDefault(); G.hud.inventory(); }
    if (e.code === 'KeyM') G.hud.map();
  });
}

// --- debug helpers (?debug) ---------------------------------------------------------------

function debugSetup() {
  G.state.unlocked = 8; G.state.redSkyDone = params.has('red') ? false : G.state.redSkyDone;
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyN') G.player.noclip = !G.player.noclip;
    if (e.code === 'KeyT') G.state.hour = (G.state.hour + 1) % 24;
    if (e.code === 'KeyK') { G.state.redSkyDone = true; G.surface.startRedSky(); }
    if (e.code === 'KeyP') G.state.padlockBroken = true, G.surface.openFacilityDoors();
  });
  const a = params.get('area');
  if (a === 'hub') G.travel.toHub(0);
  else if (a === 'lantern') G.travel.toLantern();
  else if (a && a.startsWith('b')) G.travel.toSector(a);
  if (params.get('hour')) G.state.hour = Number(params.get('hour'));
  if (params.get('weather')) G.surface.setWeather(params.get('weather'));
}

// --- the loop -------------------------------------------------------------------------------

let last = performance.now();
let exploreT = 0, safeT = 0, airT = 0;
const fwd = new THREE.Vector3();

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const I = G.input, P = G.player, S = G.state;
  const playing = started && !G.hud.menuOpen && !traveling;

  // fade animation
  if (G.fadeAnim) {
    const f = G.fadeAnim;
    f.t += dt / f.secs;
    G.post.u.uFade.value = f.from + (f.to - f.from) * Math.min(1, f.t);
    if (f.t >= 1) { G.fadeAnim = null; f.resolve(); }
  }

  if (playing) {
    // look
    const sens = 0.0022 * G.settings.sensitivity;
    P.yaw -= I.mouseDX * sens;
    P.pitch = clamp(P.pitch - I.mouseDY * sens, -1.5, 1.5);
    // keys
    if (I.hit('Digit1')) G.game.setTool('hands');
    if (I.hit('Digit2')) G.game.setTool('axe');
    if (I.hit('Digit3')) G.game.setTool('rod');
    if (I.wheel) { const order = ['hands', 'axe', 'rod']; const i = order.indexOf(S.tool); G.game.setTool(order[(i + (I.wheel > 0 ? 1 : 2)) % 3]); }
    if (I.hit('KeyF')) G.game.toggleFlashlight();
    if (I.hit('KeyR')) G.game.swapBattery();
    if (I.hit('KeyQ')) G.game.quickEat();
    if (I.click(0)) G.game.primary();
    if (I.click(2)) G.game.secondary();
  }

  // movement
  const move = { fx: 0, fz: 0, run: false, jump: false, down: false };
  if (playing) {
    move.fx = (I.key('KeyD') ? 1 : 0) - (I.key('KeyA') ? 1 : 0);
    move.fz = (I.key('KeyW') ? 1 : 0) - (I.key('KeyS') ? 1 : 0);
    move.run = I.key('ShiftLeft') || I.key('ShiftRight');
    move.jump = I.key('Space');
    move.down = I.key('ControlLeft') || I.key('KeyC');
  }
  const env = { speedMul: G.game.speedMul() };
  const ladders = G.area === 'surface' ? G.surface.ladders : G.under.ladders;
  for (const L of ladders) {
    if (P.x > L.x0 && P.x < L.x1 && P.z > L.z0 && P.z < L.z1 && P.y > L.y0 && P.y < L.y1) {
      if (move.fz !== 0 || move.jump) env.climb = (move.fz > 0 || move.jump ? 2.4 : -2.4);
    }
  }
  if (G.area !== 'surface' && G.under.sector) env.waterY = G.under.waterAt(P.x, P.z);
  if (G.area === 'surface') env.waterY = G.surface.waterAt(P.x, P.z);
  if (started && !traveling) {
    P.update(dt, G.collider, move, env, (fall) => {
      if (fall > 11) G.game.hurt(Math.round((fall - 11) * 7), 'Ouch.');
      const type = G.area === 'surface' ? G.surface.surfaceAt(P.x, P.y, P.z) : G.under.footstep();
      G.audio.play(fall > 0 ? 'jump_land' : type, { volume: fall > 0 ? 0.8 : (move.run ? 0.75 : 0.5), position: { x: P.x, y: P.y, z: P.z } });
    });
  }

  // deep water: tread water with your head above the surface
  if (env.waterY !== undefined && P.y < env.waterY - 1.35 && !P.noclip) {
    P.y = env.waterY - 1.35; P.vy = Math.max(P.vy, 0); P.onGround = true;
  }

  // safety: falling forever / chasms
  if (started && !traveling && !P.noclip) {
    if (P.onGround) {
      airT = 0;
      safeT += dt;
      const hazard = G.area !== 'surface' && G.under.inHazard(P.x, P.z);
      if (safeT > 0.5 && !hazard) { safeT = 0; G.lastSafe = { x: P.x, y: P.y, z: P.z }; }
      if (hazard && G.lastSafe && P.y < G.lastSafe.y - 3) recover('The chasm. You climb out, bleeding.');
    } else airT += dt;
    if (airT > 2.6 && G.lastSafe) recover('You fall a long, long way...');
  }

  // game systems
  if (started) G.game.update(dt);
  P.applyCamera(G.camera);
  if (G.shake > 0) {
    G.camera.position.x += (Math.random() - 0.5) * G.shake;
    G.camera.position.y += (Math.random() - 0.5) * G.shake;
    G.shake = Math.max(0, G.shake - dt * 0.05);
  }
  G.camera.updateMatrixWorld();

  // flashlight
  const flOn = G.game.flashlightOn();
  const lowBat = G.state.battery < 15 ? (Math.random() < 0.08 ? 0.2 : 1) : 1;
  G.flashlight.intensity = flOn ? (G.state.upgrades.beam ? 34 : 24) * lowBat : 0;
  G.flashlight.angle = G.game.beamAngle();

  // area update
  let vmLight = 0.5;
  if (G.area === 'surface') {
    G.surface.update(dt, G.camera);
    const inside = G.surface.inCabin(P.x, P.y, P.z);
    vmLight = 0.15 + G.surface.sunUp * 0.8 + (inside && G.surface.lampOn ? 0.35 : 0) + (flOn ? 0.3 : 0);
    // facility doors swing open after the padlock breaks
    if (S.padlockBroken) for (const [i, d] of G.surface.facilityDoors.entries()) {
      const target = (i === 0 ? 1 : -1) * 1.6;
      d.rotation.y += (target - d.rotation.y) * Math.min(1, dt * 1.5);
    }
    // cabin front door swing
    const dp = G.surface.doorPivot;
    dp.rotation.y += ((G.surface.doorOpen ? -1.7 : 0) - dp.rotation.y) * Math.min(1, dt * 6);
  } else {
    G.under.update(dt);
    vmLight = 0.12 + (flOn ? 0.55 : 0);
    // exploration sketch
    exploreT += dt;
    if (G.under.sector && exploreT > 0.4) {
      exploreT = 0;
      const st = G.game.sectorState(G.under.sector.id);
      G._explored ||= {};
      const set = G._explored[G.under.sector.id] ||= new Set(st.explored);
      const [cx, cy] = G.under.cellAt(P.x, P.z);
      for (let dx = -5; dx <= 5; dx++) for (let dy = -5; dy <= 5; dy++) {
        if (dx * dx + dy * dy > 25) continue;
        const k = (cx + dx) * 10000 + (cy + dy);
        if (!set.has(k)) { set.add(k); st.explored.push(k); }
      }
    }
  }
  G.audio.setListener({ x: P.x, y: P.eyeY, z: P.z }, fwd.set(0, 0, -1).applyQuaternion(G.camera.quaternion));
  G.audio.update(dt);

  // interaction
  if (started) {
    const it = playing ? findInteract() : null;
    G.hud.prompt(it ? it.label() : null);
    if (it && I.hit('KeyE')) it.act();
    G.hud.update();
  }

  // effects
  G.flash = Math.max(0, G.flash - dt * 1.5);
  const hungry = S.energy < 15 ? 0.25 : 0;
  G.post.u.uFlash.value.set(G.flash * 0.5, 0, 0);
  G.post.u.uVignette.value = G.settings.vignette + hungry + (S.health < 40 ? 0.35 : 0);

  // viewmodel + render
  G.viewmodel.update(dt, vmLight);
  const r = G.renderer;
  r.setRenderTarget(G.post.target);
  r.clear();
  r.render(G.scene, G.camera);
  r.autoClear = false;
  r.clearDepth();
  if (started) r.render(G.viewmodel.scene, G.viewmodel.camera);
  r.autoClear = true;
  r.setRenderTarget(null);
  r.render(G.post.scene, G.post.camera);
  I.endFrame();
  G.frameMs = performance.now() - now;
  G._frames = (G._frames || 0) + 1;
}

function recover(msg) {
  const P = G.player;
  airT = 0;
  G.game.hurt(30, msg);
  if (G.game.blackingOut) return;
  P.place(G.lastSafe.x, G.lastSafe.y + 0.1, G.lastSafe.z, P.yaw);
}

const _v = new THREE.Vector3();
function findInteract() {
  const list = G.area === 'surface' ? G.surface.interact : G.under.interact;
  const cam = G.camera.position;
  fwd.set(0, 0, -1).applyQuaternion(G.camera.quaternion);
  let best = null, bestScore = -Infinity;
  for (const it of list) {
    const dx = it.pos.x - cam.x, dy = it.pos.y - cam.y, dz = it.pos.z - cam.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > it.r + 0.6) continue;
    const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / Math.max(d, 1e-3);
    if (dot < 0.72 && d > 0.9) continue;
    const label = it.label();
    if (!label) continue;
    const score = dot * 2 - d * 0.3;
    if (score > bestScore) { bestScore = score; best = it; }
  }
  if (best) {
    // something solid in between? (closed doors, walls)
    const dx = best.pos.x - cam.x, dy = best.pos.y - cam.y, dz = best.pos.z - cam.z;
    const d = Math.hypot(dx, dy, dz);
    const h = G.collider.raycast(cam.x, cam.y, cam.z, dx / d, dy / d, dz / d, d, 0.5);
    if (h < d - 0.9) return null;
  }
  return best;
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('loadwrap').innerHTML = `<p style="color:#e88">Failed to start: ${e.message}</p>`;
});
