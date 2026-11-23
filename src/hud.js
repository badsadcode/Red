// hud.js — every bit of 2D: prompts, toasts, bars, menus, notes, the map.
// Plain DOM, styled in index.html. Menus release the mouse and give it back on close.

import { ITEMS, UPGRADES } from './gameplay.js';
import { STOPS } from './underground.js';
import { fmtTime } from './util.js';
import { LAKE, CABIN, ROAD, DOOR } from './surface.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(G) {
    this.G = G;
    this.menuOpen = null;
    this.toastList = [];
    this.subT = 0;
  }

  // --- small things -------------------------------------------------------------------
  prompt(text) {
    const el = $('prompt');
    if (text) { el.textContent = `[E] ${text}`; el.style.opacity = 1; } else el.style.opacity = 0;
  }

  toast(text, secs = 3) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    $('toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = 0; }, secs * 1000);
    setTimeout(() => el.remove(), secs * 1000 + 600);
    while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
  }

  subtitle(text, secs = 5) {
    const el = $('subtitle');
    el.textContent = text; el.style.opacity = 1;
    clearTimeout(this._subTimer);
    this._subTimer = setTimeout(() => { el.style.opacity = 0; }, secs * 1000);
  }

  fishBar(progress, tension, pulling) {
    const el = $('fishbar');
    if (progress === null || progress === undefined) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    $('fish-prog').style.width = `${Math.max(0, progress) * 100}%`;
    $('fish-tens').style.width = `${Math.min(1, tension) * 100}%`;
    $('fish-tens').style.background = tension > 0.75 ? '#e04030' : pulling ? '#e0a030' : '#9ab0a0';
    $('fish-label').textContent = pulling ? 'IT\'S PULLING — EASE OFF' : 'REEL (hold mouse)';
  }

  update() {
    const G = this.G, S = G.state;
    $('bar-energy').style.width = `${S.energy}%`;
    $('bar-health').style.width = `${S.health}%`;
    $('row-health').style.display = (G.area !== 'surface' || S.health < 100) ? 'flex' : 'none';
    $('bar-battery').style.width = `${S.battery}%`;
    $('row-battery').style.opacity = S.flashlight ? 1 : 0.45;
    const where = G.area === 'surface' ? G.surface.weather.name : G.areaLabel();
    $('clock').textContent = `Day ${S.day} · ${fmtTime(S.hour)} · ${where}`;
    for (const t of ['hands', 'axe', 'rod']) $(`tool-${t}`).classList.toggle('on', S.tool === t);
    $('energy-label').textContent = S.energy < 15 ? 'HUNGRY' : 'ENERGY';
  }

  // --- generic panel --------------------------------------------------------------------
  open(name, html, onBind) {
    const G = this.G;
    this.menuOpen = name;
    const el = $('panel');
    el.innerHTML = html;
    el.style.display = 'block';
    G.input.unlock();
    el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.close()));
    onBind && onBind(el);
  }

  close(relock = true) {
    if (!this.menuOpen) return;
    this.menuOpen = null;
    $('panel').style.display = 'none';
    this.G.audio.play('ui_click', { volume: 0.4 });
    if (relock) this.G.input.lock();
  }

  note(title, text) {
    this.open('note', `<div class="paper"><h2>${esc(title)}</h2><pre>${esc(text)}</pre></div>
      <div class="row"><button data-close>Close [E]</button></div>`);
  }

  elevatorMenu(stops, pick) {
    const G = this.G;
    const btns = stops.map((s, i) => {
      const ok = G.game.stopUnlocked(i);
      const here = G.under.platformAt(i);
      const cls = i === 7 ? 'scratched' : ok ? '' : 'off';
      return `<button class="elev ${cls}" data-i="${i}" ${here ? 'disabled' : ''}>
        <b>${s.code}</b> <span>${i === 7 && !ok ? '— — — — —' : s.name}</span>${here ? ' <i>(here)</i>' : ok ? '' : ' <i>no power</i>'}</button>`;
    }).join('');
    this.open('elevator', `<h2>FREIGHT SHAFT 1</h2><p class="dim">Cascade Basin Applied Research — authorised personnel</p>
      <div class="elevlist">${btns}</div><div class="row"><button data-close>Cancel</button></div>`, (el) => {
      el.querySelectorAll('button.elev').forEach((b) => b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        this.close(); pick(i);
      }));
    });
  }

  inventory() {
    const G = this.G, S = G.state;
    const rows = Object.entries(S.inv).filter(([, n]) => n > 0).map(([k, n]) => {
      const it = ITEMS[k] || { name: k };
      const edible = it.food > 0;
      const use = edible ? `<button data-eat="${k}">Eat</button>` : k === 'medkit' ? '<button data-med>Use</button>' : k === 'battery' ? '<button data-bat>Swap in</button>' : '';
      return `<tr><td>${esc(it.name)}</td><td>×${n}</td><td>${use}</td></tr>`;
    }).join('') || '<tr><td class="dim">Empty pockets.</td></tr>';
    const keys = S.keys.length ? `<p class="dim">Keycards: ${S.keys.map((k) => k.replace(':', ' ').toUpperCase()).join(', ')}</p>` : '';
    const notes = `<p class="dim">Notes read: ${S.notesRead.length}. Fish caught: ${S.fishCaught}.</p>`;
    this.open('inventory', `<h2>Backpack</h2><table class="inv">${rows}</table>${keys}${notes}
      <div class="row"><button data-close>Close [Tab]</button></div>`, (el) => {
      el.querySelectorAll('[data-eat]').forEach((b) => b.addEventListener('click', () => { G.game.eat(b.dataset.eat); this.inventory(); }));
      el.querySelector('[data-med]')?.addEventListener('click', () => { G.game.useMedkit(); this.inventory(); });
      el.querySelector('[data-bat]')?.addEventListener('click', () => { G.game.swapBattery(); this.inventory(); });
    });
  }

  storageMenu() {
    const G = this.G, S = G.state;
    const list = (src) => Object.entries(src).filter(([, n]) => n > 0).map(([k, n]) => `<li>${esc((ITEMS[k] || { name: k }).name)} ×${n}</li>`).join('') || '<li class="dim">nothing</li>';
    this.open('storage', `<h2>Pantry chest</h2><p class="dim">Things kept here are safe, whatever happens down there.</p>
      <div class="cols"><div><h3>Carrying</h3><ul>${list(S.inv)}</ul><button data-store>Store everything</button></div>
      <div><h3>In the chest</h3><ul>${list(S.pantry)}</ul><button data-takeall>Take everything</button></div></div>
      <div class="row"><button data-close>Close</button></div>`, (el) => {
      el.querySelector('[data-store]').addEventListener('click', () => { move(S.inv, S.pantry); G.audio.play('pickup'); this.storageMenu(); });
      el.querySelector('[data-takeall]').addEventListener('click', () => { move(S.pantry, S.inv); G.audio.play('pickup'); this.storageMenu(); });
    });
  }

  workbenchMenu() {
    const G = this.G, S = G.state;
    const rows = UPGRADES.map((u) => {
      const owned = S.upgrades[u.id];
      const cost = Object.entries(u.cost).map(([k, n]) => `${n}× ${ITEMS[k].name}`).join(', ');
      const can = G.game.canAfford(u.cost);
      return `<div class="upg ${owned ? 'owned' : ''}"><b>${u.name}</b><p>${u.desc}</p><small>${owned ? 'Done.' : cost}</small>
        ${owned ? '' : `<button data-up="${u.id}" ${can ? '' : 'disabled'}>Build</button>`}</div>`;
    }).join('');
    this.open('workbench', `<h2>Workbench</h2><p class="dim">Salvage from below the mountain makes the cabin better.</p>${rows}
      <div class="row"><button data-close>Close</button></div>`, (el) => {
      el.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
        const up = UPGRADES.find((u) => u.id === b.dataset.up);
        if (G.game.buy(up)) this.toast(`Built: ${up.name}`);
        this.workbenchMenu();
      }));
    });
  }

  pauseMenu() {
    const G = this.G;
    const s = G.settings;
    const sel = (key, opts) => `<select data-set="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(s[key]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const rng = (key, min, max, step) => `<input type="range" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}">`;
    this.open('pause', `<h2>Paused</h2>
      <div class="settings">
        <label>Internal resolution ${sel('resolution', [[180, '180p (crunchy)'], [240, '240p (PS1)'], [360, '360p'], [480, '480p'], [0, 'Native']])}</label>
        <label>Vertex wobble ${sel('snap', [['true', 'On'], ['false', 'Off']])}</label>
        <label>Texture swim (affine) ${rng('affine', 0, 1, 0.1)}</label>
        <label>Dithering ${sel('dither', [['true', 'On'], ['false', 'Off']])}</label>
        <label>Colour depth ${sel('colorDepth', [[32, '15-bit'], [64, '18-bit'], [256, 'Full']])}</label>
        <label>Scanlines ${rng('scanlines', 0, 0.5, 0.05)}</label>
        <label>Vignette ${rng('vignette', 0, 1, 0.05)}</label>
        <label>Field of view ${rng('fov', 55, 100, 1)}</label>
        <label>Mouse sensitivity ${rng('sensitivity', 0.2, 3, 0.1)}</label>
        <label>Volume ${rng('volume', 0, 1, 0.05)}</label>
        <label>Shadows ${sel('shadows', [['true', 'On'], ['false', 'Off']])}</label>
      </div>
      <p class="dim">WASD move · Shift run · Space jump · E interact · Mouse use tool · 1/2/3 hands/axe/rod · F flashlight · R batteries · Q eat · Tab backpack · M map</p>
      <div class="row"><button data-close>Resume</button><button data-save>Save</button><button data-title>Quit to title</button></div>`, (el) => {
      el.querySelectorAll('[data-set]').forEach((inp) => inp.addEventListener('input', () => {
        let v = inp.value;
        if (v === 'true') v = true; else if (v === 'false') v = false; else if (!isNaN(Number(v))) v = Number(v);
        G.setSetting(inp.dataset.set, v);
      }));
      el.querySelector('[data-save]').addEventListener('click', () => { G.save(); this.toast('Saved.'); });
      el.querySelector('[data-title]').addEventListener('click', () => { G.save(); location.reload(); });
    });
  }

  endCard() {
    this.open('end', `<div class="endcard"><p>You wake at dawn in the cabin.</p><p>Mist on the lake. Somewhere below the mountain, a light that has been waiting a very long time is still waiting. It isn't in a hurry.</p>
      <h2>Some days you fish.<br>Some days you descend into the impossible.</h2>
      <p class="dim">That's the end of this slice of Oregon Lakehouse — but the valley, the lake and the complex are still yours. The nights will be a little redder now.</p>
      <div class="row"><button data-close>Keep living here</button></div></div>`);
  }

  // --- map ------------------------------------------------------------------------------
  map() {
    const G = this.G;
    this.open('map', `<h2>${G.area === 'surface' ? 'The valley' : G.areaLabel()}</h2><canvas id="mapc" width="640" height="420"></canvas>
      <p class="dim">${G.area === 'surface' ? 'A hand-drawn map from the cabin drawer.' : 'Your own sketch of where you\'ve been. Only this floor.'}</p>
      <div class="row"><button data-close>Close [M]</button></div>`, (el) => {
      const c = el.querySelector('#mapc'), g = c.getContext('2d');
      if (G.area === 'surface') drawValley(g, c, G); else drawSector(g, c, G);
    });
  }

  // --- loading / title ---------------------------------------------------------------------
  loading(text) {
    const el = $('loading');
    if (text) { el.textContent = text; el.style.display = 'flex'; } else el.style.display = 'none';
  }
}

function move(from, to) {
  for (const [k, n] of Object.entries(from)) { if (n > 0) to[k] = (to[k] || 0) + n; delete from[k]; }
}

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function drawValley(g, c, G) {
  const W = c.width, H = c.height, sc = 0.75, ox = W / 2 - 20, oz = H / 2 + 40;
  const P = (x, z) => [ox + x * sc, oz + z * sc];
  g.fillStyle = '#d9cfb4'; g.fillRect(0, 0, W, H);
  // forest texture
  g.fillStyle = '#7d8a5a';
  for (let i = 0; i < 900; i++) { const x = (i * 97) % W, y = (i * 61 + (i >> 3) * 13) % H; g.fillRect(x, y, 2, 3); }
  // ridge
  g.fillStyle = '#9a8f78'; g.fillRect(0, 0, W, P(0, -200)[1]);
  g.strokeStyle = '#5a4a3a'; g.beginPath();
  for (let x = 0; x < W; x += 12) g.lineTo(x, P(0, -200)[1] - 6 - Math.sin(x * 0.07) * 5);
  g.stroke();
  // lake
  g.fillStyle = '#6f8f9a'; g.beginPath();
  g.ellipse(...P(0, 0), LAKE.rx * sc, LAKE.rz * sc, 0, 0, Math.PI * 2); g.fill();
  // road
  g.strokeStyle = '#8a6a4a'; g.setLineDash([4, 3]); g.lineWidth = 2; g.beginPath();
  for (const [x, z] of ROAD) g.lineTo(...P(x, z));
  g.stroke(); g.setLineDash([]);
  // cabin, door, lookout
  g.fillStyle = '#5a2a1a'; g.fillRect(P(CABIN.x, CABIN.z)[0] - 4, P(CABIN.x, CABIN.z)[1] - 4, 8, 8);
  g.font = '12px monospace'; g.fillStyle = '#2a2018';
  g.fillText('cabin', P(CABIN.x, CABIN.z)[0] + 6, P(CABIN.x, CABIN.z)[1] + 4);
  if (G.state.redSkyDone) { g.fillStyle = '#a02010'; g.fillText('X  ?', P(DOOR.x, DOOR.z)[0] - 4, P(DOOR.x, DOOR.z)[1] + 16); }
  g.fillStyle = '#2a2018'; g.fillText('old lookout', P(-236, 52)[0] - 30, P(-236, 52)[1] + 14);
  g.fillText('BASIN RIDGE', W / 2 - 40, 20);
  // you
  const [px, py] = P(G.player.x, G.player.z);
  g.save(); g.translate(px, py); g.rotate(-G.player.yaw);
  g.fillStyle = '#c03020'; g.beginPath(); g.moveTo(0, -7); g.lineTo(4, 5); g.lineTo(-4, 5); g.fill(); g.restore();
}

function drawSector(g, c, G) {
  const W = c.width, H = c.height;
  g.fillStyle = '#0d1012'; g.fillRect(0, 0, W, H);
  const U = G.under;
  if (!U.sector) { g.fillStyle = '#6a7a80'; g.font = '14px monospace'; g.fillText('THE SHAFT. Down is the only direction that matters.', 40, H / 2); return; }
  const d = U.sector, st = G.game.sectorState(d.id);
  const [gw, gh] = d.grid;
  const s = Math.min(W / gw, H / gh);
  const ox = (W - gw * s) / 2, oy = (H - gh * s) / 2;
  const explored = new Set(st.explored);
  const py = G.player.y * 32;
  g.fillStyle = '#4a5a52';
  for (const sp of d.spans) {
    const [cx, cy, f, ce, f2] = sp;
    const key = cx * 10000 + cy;
    if (!explored.has(key)) continue;
    const near = Math.abs(f - py) < 80 || (f2 !== undefined && Math.abs(f2 - py) < 80);
    g.fillStyle = near ? '#7a9a88' : '#2a3a34';
    g.fillRect(ox + cx * s, oy + (gh - 1 - cy) * s, Math.ceil(s), Math.ceil(s));
  }
  g.font = '9px monospace'; g.fillStyle = '#c8d8c0';
  for (const r of d.rooms) {
    const k = Math.floor(r.x + r.w / 2) * 10000 + Math.floor(r.y + r.h / 2);
    if (!explored.has(k)) continue;
    g.fillText(String(r.program || '').replace('_', ' '), ox + r.x * s, oy + (gh - r.y - r.h / 2) * s);
  }
  const cm = d.cell / 32;
  const px = G.player.x / cm, pz = -G.player.z / cm;
  g.save(); g.translate(ox + px * s, oy + (gh - pz) * s); g.rotate(-G.player.yaw);
  g.fillStyle = '#ff5030'; g.beginPath(); g.moveTo(0, -7); g.lineTo(4, 5); g.lineTo(-4, 5); g.fill(); g.restore();
  g.fillStyle = '#6a7a80'; g.fillText(`${d.code}  ${d.name}`, 8, 14);
}
