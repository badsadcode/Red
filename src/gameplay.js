// gameplay.js — the things you *do*: fish, chop, cook, eat, sleep, forage, read,
// salvage, upgrade. Also the survival-lite rules (design doc §7.1: rituals, not
// meters to babysit) and the red-sky trigger.

import * as THREE from 'three';
import { NOTES, RADIO } from './lore.js';
import { STOPS } from './underground.js';
import { clamp, fmtTime } from './util.js';

export const ITEMS = {
  raw_fish:    { name: 'Raw trout', food: 0 },
  pale_fish:   { name: 'Pale trout', food: 0 },
  cooked_fish: { name: 'Pan-fried trout', food: 30 },
  cooked_pale: { name: 'Pan-fried pale trout', food: 30 },
  stew:        { name: 'Trout & chanterelle stew', food: 55 },
  mushroom:    { name: 'Chanterelles', food: 4 },
  berries:     { name: 'Huckleberries', food: 8 },
  canned:      { name: 'Canned beans', food: 25 },
  coffee:      { name: 'Can of cold coffee', food: 10 },
  firewood:    { name: 'Firewood' },
  battery:     { name: 'D-cell batteries' },
  scrap:       { name: 'Salvaged electronics' },
  medkit:      { name: 'First-aid kit' },
};
const EAT_ORDER = ['stew', 'cooked_fish', 'cooked_pale', 'canned', 'berries', 'coffee', 'mushroom'];

export const UPGRADES = [
  { id: 'beam', name: 'Wide-beam reflector', cost: { scrap: 2 }, desc: 'A wider, brighter flashlight beam. Shades hate it.' },
  { id: 'cells', name: 'Rewired battery pack', cost: { scrap: 3, battery: 1 }, desc: 'Flashlight batteries last twice as long.' },
  { id: 'reel', name: 'Reinforced reel', cost: { scrap: 2 }, desc: 'Reeling is easier. Bigger fish bite.' },
  { id: 'radio', name: 'Repair the old radio', cost: { scrap: 3 }, desc: 'Weather reports. And, lately, other things.' },
];

export function newState() {
  return {
    version: 1, day: 1, hour: 7.6, energy: 75, health: 100, battery: 100,
    inv: { firewood: 2, battery: 1, berries: 2 },
    pantry: { canned: 1 },
    keys: [], upgrades: {}, unlocked: 1, sectors: {}, notesRead: [], flags: {},
    redSkyDone: false, padlockBroken: false, fishCaught: 0, slept: 0,
    stoveFuel: 0, where: 'surface', tool: 'hands', flashlight: false,
    lanternSeen: false, ateRawCount: 0,
  };
}

export class Game {
  constructor(G) {
    this.G = G;
    this.fish = { state: 'idle', t: 0 };
    this.swingT = 0;
    this.cooking = 0;
    this.radioOn = false;
    this.radioLoop = null;
    this.radioIdx = 0;
    this.lastHour = 0;
    this.bobber = null;
  }
  get S() { return this.G.state; }

  // --- inventory ----------------------------------------------------------------------
  add(item, n = 1) { this.S.inv[item] = (this.S.inv[item] || 0) + n; }
  has(item, n = 1) { return (this.S.inv[item] || 0) >= n; }
  take(item, n = 1) { if (!this.has(item, n)) return false; this.S.inv[item] -= n; if (!this.S.inv[item]) delete this.S.inv[item]; return true; }

  eat(item) {
    const it = ITEMS[item];
    if (!it || it.food === undefined || !this.take(item)) return;
    const G = this.G;
    if (item === 'raw_fish' || item === 'pale_fish') return;
    this.S.energy = clamp(this.S.energy + it.food, 0, 100);
    G.audio.play(item === 'coffee' ? 'drink' : 'eat');
    if (item === 'coffee') this.coffee = 90;
    if (item === 'cooked_pale') this.S.flags.dream = true;
    if (item === 'mushroom') G.hud.toast('Raw chanterelles. Peppery. Better cooked.');
    else G.hud.toast(`Ate: ${it.name}`);
  }

  quickEat() {
    for (const k of EAT_ORDER) if (this.has(k)) { this.eat(k); return; }
    this.G.hud.toast('Nothing ready to eat.');
  }

  useMedkit() {
    if (!this.take('medkit')) return;
    this.S.health = 100; this.G.audio.play('pickup'); this.G.hud.toast('Patched up.');
  }

  // --- tools ---------------------------------------------------------------------------
  setTool(t) {
    if (this.S.tool === t) return;
    if (this.fish.state !== 'idle') this.cancelFishing();
    this.S.tool = t;
    this.G.viewmodel.show(t);
    this.G.audio.play('ui_click', { volume: 0.4 });
  }

  flashlightOn() { return this.S.flashlight && this.S.battery > 0; }
  beamAngle() { return this.S.upgrades.beam ? 0.58 : 0.42; }
  toggleFlashlight() {
    if (this.S.battery <= 0 && !this.S.flashlight) { this.G.hud.toast('Battery dead. [R] to swap in fresh D-cells.'); this.G.audio.play('flashlight_click'); return; }
    this.S.flashlight = !this.S.flashlight;
    this.G.audio.play('flashlight_click');
  }
  swapBattery() {
    if (!this.take('battery')) { this.G.hud.toast('No spare batteries.'); return; }
    this.S.battery = 100; this.G.audio.play('battery_insert'); this.G.hud.toast('Fresh batteries.');
  }

  primary() {
    const tool = this.S.tool;
    if (tool === 'axe') this.swing();
    else if (tool === 'rod') this.fishClick();
  }
  secondary() { if (this.S.tool === 'rod' && this.fish.state !== 'idle') this.cancelFishing(); }

  swing() {
    if (this.swingT > 0) return;
    const G = this.G;
    this.swingT = 0.5;
    G.viewmodel.swing();
    G.audio.play('axe_swing');
    setTimeout(() => {
      // hit a shade?
      if (G.area !== 'surface') {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
        for (const s of G.under.shades) {
          if (s.gone > 0 || s.spawnDelay > 0) continue;
          const to = new THREE.Vector3(s.x - G.player.x, s.y + 1.2 - G.player.eyeY, s.z - G.player.z);
          const d = to.length();
          if (d < 2.4 && fwd.dot(to.normalize()) > 0.6) { s.hit(); return; }
        }
      }
      // hit a wall / tree?
      const p = G.camera.position;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
      const h = G.collider.raycast(p.x, p.y, p.z, fwd.x, fwd.y, fwd.z, 1.9);
      if (h !== Infinity) G.audio.play(G.area === 'surface' ? 'axe_hit_wood' : 'axe_hit_metal', { volume: 0.7 });
      else if (G.area === 'surface') {
        for (const c of G.collider.queryCircles(p.x + fwd.x, p.z + fwd.z, 0.8)) {
          if (Math.hypot(c.x - p.x - fwd.x * 1.2, c.z - p.z - fwd.z * 1.2) < c.r + 0.6) { G.audio.play('axe_hit_wood', { volume: 0.7 }); break; }
        }
      }
    }, 200);
    this.S.energy = Math.max(0, this.S.energy - 0.3);
  }

  // --- fishing ---------------------------------------------------------------------------
  fishClick() {
    const G = this.G, f = this.fish;
    if (G.area !== 'surface') { G.hud.toast('No fish down here. Probably.'); return; }
    if (f.state === 'idle') {
      // find water ahead of us
      const cam = G.camera;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      fwd.y = 0; fwd.normalize();
      let spot = null;
      for (let d = 15; d >= 5; d -= 0.5) {
        const x = G.player.x + fwd.x * d, z = G.player.z + fwd.z * d;
        if (G.surface.isWater(x, z)) { spot = new THREE.Vector3(x, 0.02, z); break; }
      }
      if (!spot) { G.hud.toast('No good water to cast into from here. Try the dock.'); return; }
      f.state = 'cast'; f.t = 0; f.spot = spot;
      f.from = G.camera.position.clone();
      G.viewmodel.cast();
      G.audio.play('cast');
      this.ensureBobber();
      this.bobber.visible = true;
    } else if (f.state === 'bite') {
      f.state = 'reel'; f.t = 0; f.progress = 0.08; f.tension = 0.2; f.pull = 0; f.pullT = 1;
      f.power = 0.7 + Math.random() * 0.6;
      G.hud.toast('Fish on! Hold [Mouse] to reel, ease off when it pulls.');
    } else if (f.state === 'wait') {
      // reeling in an empty line
      this.cancelFishing();
    }
  }

  ensureBobber() {
    if (this.bobber) return;
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
    top.position.y = 0.02; g.add(top, bot);
    this.G.surface.scene.add(g);
    this.bobber = g;
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.5 }));
    this.line.frustumCulled = false;
    this.G.surface.scene.add(this.line);
  }

  cancelFishing() {
    this.fish.state = 'idle';
    if (this.bobber) { this.bobber.visible = false; this.line.visible = false; }
    this.G.hud.fishBar(null);
    if (this.reelLoop) { this.reelLoop.stop(); this.reelLoop = null; }
  }

  updateFishing(dt) {
    const G = this.G, f = this.fish;
    if (f.state === 'idle') return;
    if (G.area !== 'surface' || this.S.tool !== 'rod') { this.cancelFishing(); return; }
    // walked away?
    if (f.spot && Math.hypot(G.player.x - f.spot.x, G.player.z - f.spot.z) > 22) { this.cancelFishing(); G.hud.toast('Line reeled in.'); return; }
    f.t += dt;
    const b = this.bobber;
    const tip = G.viewmodel.rodTip();
    if (f.state === 'cast') {
      const k = Math.min(1, f.t / 0.7);
      b.position.lerpVectors(f.from, f.spot, k);
      b.position.y = THREE.MathUtils.lerp(f.from.y, f.spot.y, k) + Math.sin(k * Math.PI) * 3;
      if (k >= 1) {
        f.state = 'wait'; f.t = 0;
        G.audio.play('splash', { position: f.spot });
        // bite timing: dawn, dusk and drizzle help; so does a better reel
        const h = this.S.hour, w = G.surface.weather;
        let mean = 14;
        if ((h > 5 && h < 8.5) || (h > 18 && h < 21)) mean *= 0.55;
        if (w.rain > 0.2) mean *= 0.7;
        if (this.S.upgrades.reel) mean *= 0.8;
        f.biteAt = 3 + Math.random() * mean;
      }
    } else if (f.state === 'wait') {
      b.position.set(f.spot.x, 0.02 + Math.sin(f.t * 2) * 0.01, f.spot.z);
      if (f.t > f.biteAt) { f.state = 'bite'; f.t = 0; G.audio.play('bite', { position: f.spot }); }
    } else if (f.state === 'bite') {
      b.position.set(f.spot.x, -0.06 + Math.sin(f.t * 30) * 0.03, f.spot.z);
      if (f.t > 1.3) {
        f.state = 'wait'; f.t = 0; f.biteAt = 4 + Math.random() * 10;
        G.hud.toast('Missed it. Wait for the next nibble.');
      }
    } else if (f.state === 'reel') {
      // fish pulls in bursts
      f.pullT -= dt;
      if (f.pullT <= 0) { f.pull = f.pull ? 0 : 1; f.pullT = f.pull ? 0.6 + Math.random() * 1.0 : 0.8 + Math.random() * 1.6; }
      const reeling = G.input.held(0);
      const strength = f.power * (this.S.upgrades.reel ? 0.75 : 1);
      if (reeling) {
        f.progress += dt * (f.pull ? 0.04 : 0.2);
        f.tension += dt * (f.pull ? 0.95 * strength : 0.1 * strength);   // calm reeling is safe; pulls are not
        if (!this.reelLoop) this.reelLoop = G.audio.startLoop('reel', { volume: 0.5 });
      } else {
        f.tension -= dt * 0.7;
        f.progress -= dt * (f.pull ? 0.07 : 0.02);
        if (this.reelLoop) { this.reelLoop.stop(); this.reelLoop = null; }
      }
      f.tension = clamp(f.tension, 0, 1.2);
      f.progress = clamp(f.progress, -0.1, 1);
      const pull = f.pull ? Math.sin(f.t * 25) * 0.15 : 0;
      b.position.set(f.spot.x + pull, -0.02, f.spot.z);
      const toward = new THREE.Vector3(G.player.x, 0, G.player.z).sub(f.spot).multiplyScalar(0.0015 * (reeling ? 1 : 0));
      f.spot.add(toward);
      G.hud.fishBar(f.progress, f.tension, !!f.pull);
      if (f.tension >= 1) { this.cancelFishing(); G.audio.play('reel_tick'); G.hud.toast('Snap! The line broke. The fish swims off, smug.'); return; }
      if (f.progress <= -0.1) { this.cancelFishing(); G.hud.toast('It slipped the hook.'); return; }
      if (f.progress >= 1) { this.landFish(); return; }
    }
    // line from rod tip to bobber
    this.line.visible = true;
    const pa = this.line.geometry.attributes.position;
    pa.setXYZ(0, tip.x, tip.y, tip.z); pa.setXYZ(1, b.position.x, b.position.y, b.position.z);
    pa.needsUpdate = true;
  }

  landFish() {
    const G = this.G;
    const h = this.S.hour;
    const night = h < 5 || h > 21;
    let name, item = 'raw_fish';
    const r = Math.random();
    const paleChance = this.S.redSkyDone ? (night ? (this.S.lanternSeen ? 0.25 : 0.1) : 0.02) : 0;
    if (r < paleChance) { name = 'a pale trout. It glows faintly'; item = 'pale_fish'; }
    else if (r < 0.15 && h < 9) name = 'a kokanee salmon';
    else if (r < 0.35) name = 'a cutthroat trout';
    else if (r < 0.45 && this.S.upgrades.reel) name = 'a big largemouth bass';
    else name = 'a rainbow trout';
    const len = (25 + Math.random() * 25 + (this.S.upgrades.reel ? 10 : 0)).toFixed(0);
    this.add(item);
    this.S.fishCaught++;
    G.audio.play('fish_caught', { position: this.fish.spot });
    G.hud.toast(`Caught ${name}! (${len} cm)`, 4);
    this.cancelFishing();
    G.save();
  }

  // --- foraging / chopping -------------------------------------------------------------
  forage(f) {
    const G = this.G;
    if (f.regrow > 0) return;
    if (f.kind === 'mushroom') { this.add('mushroom'); f.regrow = 2; G.hud.toast('Picked chanterelles.'); }
    else { this.add('berries', 3); f.regrow = 3; G.hud.toast('Picked a handful of huckleberries.'); }
    f.mesh.visible = false;
    G.audio.play('pickup');
  }

  chopLabel() { return this.S.tool === 'axe' ? 'Split firewood' : 'Chopping block (equip the axe: [2])'; }
  chop() {
    const G = this.G;
    if (this.S.tool !== 'axe') { this.setTool('axe'); return; }
    if (this.swingT > 0) return;
    this.swingT = 0.6;
    G.viewmodel.swing();
    G.audio.play('axe_hit_wood');
    this.chops = (this.chops || 0) + 1;
    this.S.energy = Math.max(0, this.S.energy - 0.6);
    if (this.chops >= 3) {
      this.chops = 0; this.add('firewood');
      setTimeout(() => G.audio.play('chop_done'), 150);
      G.hud.toast(`Firewood: ${this.S.inv.firewood}`);
    }
  }

  // --- stove ------------------------------------------------------------------------------
  stoveLabel() {
    if (this.cooking > 0) return null;
    const lit = this.S.stoveFuel > 0;
    if (!lit) return this.has('firewood') ? 'Light the stove (1 firewood)' : 'Stove (needs firewood)';
    if (this.has('raw_fish') && this.has('mushroom')) return 'Cook trout & chanterelle stew';
    if (this.has('raw_fish')) return 'Fry a trout';
    if (this.has('pale_fish')) return 'Fry the pale trout';
    if (this.has('mushroom', 2)) return 'Sauté chanterelles';
    if (this.has('firewood') && this.S.stoveFuel < 4) return 'Add firewood';
    return null;
  }

  stoveAction() {
    const G = this.G;
    if (this.cooking > 0) return;
    if (this.S.stoveFuel <= 0) {
      if (!this.take('firewood')) { G.hud.toast('Need firewood. The chopping block is out by the south wall.'); return; }
      this.S.stoveFuel = 6;
      G.audio.play('stove_light', { position: G.surface.stoveLight.position });
      return;
    }
    let out = null;
    if (this.has('raw_fish') && this.has('mushroom')) { this.take('raw_fish'); this.take('mushroom'); out = 'stew'; }
    else if (this.has('raw_fish')) { this.take('raw_fish'); out = 'cooked_fish'; }
    else if (this.has('pale_fish')) { this.take('pale_fish'); out = 'cooked_pale'; }
    else if (this.has('mushroom', 2)) { this.take('mushroom', 2); out = 'berries'; /* sautéed: count as a snack */ }
    else if (this.has('firewood')) { this.take('firewood'); this.S.stoveFuel += 6; G.audio.play('stove_light', { position: G.surface.stoveLight.position, volume: 0.5 }); return; }
    if (!out) return;
    this.cooking = 3;
    G.audio.play('sizzle', { position: G.surface.stoveLight.position });
    G.hud.toast('Cooking...', 3);
    setTimeout(() => {
      this.cooking = 0;
      this.add(out);
      this.S.flags.cooked = true;
      G.hud.toast(`${ITEMS[out].name} is ready. [Q] to eat.`, 4);
    }, 3000);
  }

  // --- radio ------------------------------------------------------------------------------
  radioLabel() {
    if (!this.S.upgrades.radio) return 'Old radio (broken — fix it at the workbench)';
    return this.radioOn ? 'Turn the radio off' : 'Turn the radio on';
  }
  radioAction() {
    const G = this.G;
    if (!this.S.upgrades.radio) { G.audio.play('radio_on', { volume: 0.3 }); G.hud.toast('Dead. Needs a few parts.'); return; }
    this.radioOn = !this.radioOn;
    G.audio.play('radio_on');
    if (this.radioOn) {
      const pool = this.S.redSkyDone ? RADIO.after : RADIO.normal;
      const line = pool[this.radioIdx++ % pool.length];
      G.hud.subtitle(line, 9);
      this.radioLoop = G.audio.startLoop('radio_static', { volume: 0.35, numbers: this.S.redSkyDone, position: G.surface.radioDial.getWorldPosition(new THREE.Vector3()) });
    } else if (this.radioLoop) { this.radioLoop.stop(); this.radioLoop = null; }
  }

  // --- bed / time --------------------------------------------------------------------------
  bedLabel() {
    const h = this.S.hour;
    return (h >= 19 || h < 5) ? 'Sleep until morning' : 'Nap for two hours';
  }

  async sleep() {
    const G = this.G;
    const h = this.S.hour;
    const night = h >= 19 || h < 5;
    if (this.radioOn) this.radioAction();
    G.audio.play('sleep');
    await G.fade(1, 1.2);
    if (night) {
      if (h >= 19) this.S.day++;
      this.S.hour = 7 + Math.random() * 0.6;
      this.S.energy = clamp(this.S.energy - 15, 0, 100);
      this.S.health = 100;
      this.S.slept++;
      this.S.stoveFuel = 0;
      G.surface.dailyRegrow();
    } else {
      this.S.hour += 2;
      this.S.energy = clamp(this.S.energy - 4, 0, 100);
      this.S.health = clamp(this.S.health + 30, 0, 100);
      this.S.stoveFuel = Math.max(0, this.S.stoveFuel - 2);
    }
    G.save();
    let dream = null;
    if (night && this.S.flags.dream) {
      this.S.flags.dream = false;
      dream = 'You dream of a staircase, going down and down, and at the bottom a ring of red light that is glad to see you.';
    } else if (night && this.S.redSkyDone && !this.S.padlockBroken && Math.random() < 0.6) {
      dream = 'You dream of a heavy door at the foot of the mountain. Someone on the other side is knocking, very patiently.';
    }
    if (dream) { G.hud.subtitle(dream, 7); await new Promise((r) => setTimeout(r, 2500)); }
    await G.fade(0, 1.5);
    G.hud.toast(`Day ${this.S.day} · ${fmtTime(this.S.hour)}`);
  }

  // --- storage + workbench ------------------------------------------------------------------
  openStorage() { this.G.hud.storageMenu(); }
  openWorkbench() { this.G.hud.workbenchMenu(); }
  canAfford(cost) { return Object.entries(cost).every(([k, n]) => this.has(k, n)); }
  buy(up) {
    if (this.S.upgrades[up.id] || !this.canAfford(up.cost)) return false;
    for (const [k, n] of Object.entries(up.cost)) this.take(k, n);
    this.S.upgrades[up.id] = true;
    this.G.audio.play('switch');
    this.G.save();
    return true;
  }

  // --- facility door ------------------------------------------------------------------------
  facilityDoorLabel() {
    if (this.S.padlockBroken) return 'Go inside';
    if (!this.S.redSkyDone) return 'A rusted padlock on an old utility door';
    return this.S.tool === 'axe' ? 'Break the padlock' : 'Padlocked (equip the axe: [2])';
  }
  facilityDoorAction() {
    const G = this.G;
    if (this.S.padlockBroken) { G.travel.toHub(0); return; }
    if (!this.S.redSkyDone) {
      if (this.S.tool === 'axe') { this.swing(); G.audio.play('axe_hit_metal'); G.hud.toast("The padlock doesn't budge. Just an old utility door. Not worth it."); }
      else G.hud.toast('Government property. Rusted shut, by the look of it.');
      return;
    }
    if (this.S.tool !== 'axe') { this.setTool('axe'); return; }
    if (this.swingT > 0) return;
    this.swing();
    G.audio.play('axe_hit_metal', { position: G.surface.padlock.position });
    this.lockHits = (this.lockHits || 0) + 1;
    if (this.lockHits >= 3) {
      this.S.padlockBroken = true;
      G.audio.play('padlock_break', { position: G.surface.padlock.position });
      setTimeout(() => G.audio.play('door_metal_open', { position: G.surface.padlock.position }), 600);
      G.surface.openFacilityDoors();
      G.save();
    }
  }

  // --- underground --------------------------------------------------------------------------
  sectorState(id) {
    this.S.sectors[id] ||= { taken: [], doors: [], relay: false, explored: [] };
    return this.S.sectors[id];
  }
  hasKey(sid, color) { return this.S.keys.includes(`${sid}:${color}`); }
  addKey(sid, color) { this.S.keys.push(`${sid}:${color}`); this.G.audio.play('keycard'); this.G.hud.toast(`${color.toUpperCase()} keycard`); }
  stopUnlocked(i) { return i === 0 || i <= this.S.unlocked; }
  relayClosed(sid) {
    const i = STOPS.findIndex((s) => s.id === sid);
    this.S.unlocked = Math.max(this.S.unlocked, i + 1);
    const next = STOPS[i + 1];
    this.G.hud.toast(next ? (next.id === 'b7' ? 'Something far below the shaft hums awake.' : `Freight power restored to ${next.code} — ${next.name}`) : 'Power restored.', 5);
    this.G.save();
  }
  itemLabel(item) {
    return { canned: 'Take canned beans', coffee: 'Take a can of cold coffee', battery: 'Take D-cell batteries', scrap: 'Salvage electronics',
      medkit: 'Take the first-aid kit', cache: 'Open the supply locker' }[item] || 'Take';
  }
  takeItem(item) {
    const G = this.G;
    G.audio.play('pickup');
    if (item === 'cache') {
      const loot = [['battery', 1 + (Math.random() * 2 | 0)], ['scrap', 1 + (Math.random() * 2 | 0)], ['canned', 1]];
      for (const [k, n] of loot) this.add(k, n);
      G.hud.toast(`Supply locker: ${loot.map(([k, n]) => `${n}× ${ITEMS[k].name}`).join(', ')}`, 4);
      return;
    }
    this.add(item);
    G.hud.toast(ITEMS[item].name);
  }
  discover(what) { this.G.audio.play('discovery', { volume: 0.6 }); this.G.hud.toast(what); }

  readNote(id) {
    const n = NOTES[id];
    if (!n) return;
    if (!this.S.notesRead.includes(id)) { this.S.notesRead.push(id); this.G.audio.play('discovery', { volume: 0.35 }); }
    this.G.audio.play('paper');
    this.G.hud.note(n.title, n.text);
  }

  hurt(amount, msg) {
    const G = this.G;
    if (G.player.noclip || this.blackingOut) return;
    this.S.health = Math.max(0, this.S.health - amount);
    G.audio.play('hurt');
    G.flash = 0.6;
    if (msg) G.hud.toast(msg);
    if (this.S.health <= 0) this.blackout();
  }

  async blackout() {
    const G = this.G;
    this.blackingOut = true;
    G.hud.subtitle('Everything goes dark...', 4);
    await G.fade(1, 1.5);
    // lose some of what you carried
    for (const k of ['battery', 'scrap', 'canned', 'coffee']) if (this.S.inv[k]) this.S.inv[k] = Math.floor(this.S.inv[k] / 2);
    for (const k of Object.keys(this.S.inv)) if (!this.S.inv[k]) delete this.S.inv[k];
    if (this.S.hour >= 7) this.S.day++;
    this.S.hour = 8;
    this.S.health = 60;
    this.S.energy = Math.max(10, this.S.energy - 20);
    await G.travel.toSurface(true);
    G.player.place(G.surface.spawn.x, G.surface.spawn.y, G.surface.spawn.z, G.surface.spawn.yaw);
    G.save();
    await new Promise((r) => setTimeout(r, 800));
    G.hud.subtitle('You wake in your own bed with no memory of the walk home. Your pockets feel lighter.', 7);
    await G.fade(0, 2);
    this.blackingOut = false;
  }

  async touchLantern() {
    const G = this.G;
    G.audio.play('boom', { volume: 1 });
    G.post.u.uTint.value.set(1.6, 0.3, 0.2);
    await G.fade(1, 4);
    G.post.u.uTint.value.set(1, 1, 1);
    this.S.lanternSeen = true;
    this.S.day++; this.S.hour = 6.2;
    await G.travel.toSurface(true);
    G.player.place(G.surface.spawn.x, G.surface.spawn.y, G.surface.spawn.z, G.surface.spawn.yaw);
    G.surface.setWeather('mist');
    G.save();
    G.hud.endCard();
  }

  // --- per frame ----------------------------------------------------------------------------
  update(dt) {
    const G = this.G, S = this.S;
    this.swingT = Math.max(0, this.swingT - dt);
    if (this.coffee > 0) this.coffee -= dt;
    // time
    const gameHours = dt * (0.8 / 60);
    S.hour += gameHours;
    if (S.hour >= 24) { S.hour -= 24; S.day++; G.surface.dailyRegrow(); }
    // energy drains gently; running costs a little more
    const running = G.input.key('ShiftLeft') && G.player.speed > 4;
    S.energy = Math.max(0, S.energy - gameHours * 3.6 - (running ? dt * 0.03 : 0));
    // health regenerates when fed
    if (S.energy > 40 && S.health < 100) S.health = Math.min(100, S.health + dt * 0.25);
    // stove fuel burns
    if (S.stoveFuel > 0) S.stoveFuel = Math.max(0, S.stoveFuel - gameHours);
    G.surface.stoveLit = S.stoveFuel > 0;
    // flashlight battery
    if (this.flashlightOn()) {
      S.battery = Math.max(0, S.battery - dt * (S.upgrades.cells ? 100 / 720 : 100 / 360));
      if (S.battery <= 0) { S.flashlight = false; G.hud.toast('The flashlight dies. [R] to swap batteries.'); }
    }
    this.updateFishing(dt);

    // the red sky: after the first couple of quiet days, at dusk
    if (G.area === 'surface' && !S.redSkyDone && S.day >= 2 && S.hour > 17.6 && S.hour < 20.5 && (S.fishCaught > 0 || S.flags.cooked || S.day >= 3)) {
      S.redSkyDone = true;
      G.surface.startRedSky();
      setTimeout(() => G.hud.subtitle('What... was that? It came from the north. From the mountain.', 7), 9000);
      G.save();
    }
  }

  speedMul() {
    const S = this.S;
    let m = 1;
    if (S.energy < 15) m *= 0.8;
    if (this.coffee > 0) m *= 1.12;
    return m;
  }
}
