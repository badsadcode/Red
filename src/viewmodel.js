// viewmodel.js — the tool in your hands, drawn in its own little scene on top of
// the world (so it never clips into walls), then pixelated with everything else.

import * as THREE from 'three';
import { modelMesh, pickModel } from './assets.js';
import { psxMaterial } from './retro.js';

export class Viewmodel {
  constructor(G) {
    this.G = G;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.key = new THREE.DirectionalLight(0xffffff, 1.2);
    this.key.position.set(1, 2, 1);
    this.scene.add(this.ambient, this.key);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.tools = { hands: new THREE.Group(), axe: this.makeAxe(), rod: this.makeRod() };
    for (const t of Object.values(this.tools)) { t.visible = false; this.root.add(t); }
    this.current = 'hands';
    this.swingT = 0; this.castT = 0; this.switchT = 0; this.bob = 0;
    this.show('hands');
  }

  makeAxe() {
    const g = new THREE.Group();
    let m = modelMesh(pickModel('axe', 'hatchet') || '', { height: 0.62 });
    if (!m) {
      m = new THREE.Group();
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.6, 0.035), psxMaterial({ color: 0x7a5530 }));
      h.position.y = 0.3; m.add(h);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.16), psxMaterial({ color: 0x9aa0a8 }));
      head.position.set(0, 0.56, 0.06); m.add(head);
    }
    m.castShadow = false;
    m.rotation.set(0, Math.PI / 2, 0);
    g.add(m);
    g.userData.base = { pos: new THREE.Vector3(0.32, -0.52, -0.55), rot: new THREE.Euler(-0.25, 0.15, 0.35) };
    return g;
  }

  makeRod() {
    const g = new THREE.Group();
    let m = modelMesh(pickModel('fishing_rod') || '', { height: 1.25 });
    if (!m) {
      m = new THREE.Group();
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.015, 1.25, 5), psxMaterial({ color: 0x3a3a3a }));
      r.position.y = 0.62; m.add(r);
      const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8), psxMaterial({ color: 0x999999 }));
      reel.rotation.z = Math.PI / 2; reel.position.set(0.03, 0.2, 0); m.add(reel);
    }
    g.add(m);
    this.tip = new THREE.Object3D();
    this.tip.position.set(0, 1.25, 0);
    m.add(this.tip);
    g.userData.base = { pos: new THREE.Vector3(0.28, -0.45, -0.45), rot: new THREE.Euler(-0.85, 0.1, 0.12) };
    return g;
  }

  show(tool) { this.next = tool; this.switchT = 0.3; }
  swing() { this.swingT = 0.45; }
  cast() { this.castT = 0.7; }

  /** World position of the rod tip (for the fishing line). */
  rodTip() {
    const cam = this.G.camera;
    if (this.current !== 'rod') return cam.position.clone();
    this.root.updateMatrixWorld(true);
    const local = new THREE.Vector3().setFromMatrixPosition(this.tip.matrixWorld); // in vm camera space
    return local.applyMatrix4(cam.matrixWorld);
  }

  update(dt, light) {
    const G = this.G;
    this.camera.aspect = G.camera.aspect;
    this.camera.updateProjectionMatrix();
    // switching animation: drop down, swap, come up
    if (this.switchT > 0) {
      this.switchT -= dt;
      if (this.switchT <= 0.15 && this.next !== this.current) {
        this.tools[this.current].visible = false;
        this.current = this.next;
        this.tools[this.current].visible = true;
      }
    } else this.tools[this.current].visible = true;
    const drop = this.switchT > 0 ? Math.sin((this.switchT / 0.3) * Math.PI) * 0.4 : 0;
    const t = this.tools[this.current];
    const base = t.userData.base;
    if (!base) return;
    const p = G.player;
    this.bob += dt * Math.min(1, p.speed / 3) * 8;
    const bx = Math.sin(this.bob) * 0.012, by = Math.abs(Math.cos(this.bob)) * 0.014;
    t.position.copy(base.pos).add(new THREE.Vector3(bx, by - drop, 0));
    t.rotation.copy(base.rot);
    if (this.swingT > 0) {
      this.swingT -= dt;
      const k = 1 - this.swingT / 0.45;
      const s = k < 0.35 ? -k / 0.35 * 0.6 : Math.sin((k - 0.35) / 0.65 * Math.PI) * 1.6 - 0.6 * (1 - (k - 0.35) / 0.65);
      t.rotation.x += s; t.position.y += Math.max(0, -s) * 0.1; t.position.x -= Math.max(0, s) * 0.12;
    }
    if (this.castT > 0) {
      this.castT -= dt;
      const k = 1 - this.castT / 0.7;
      t.rotation.x += k < 0.3 ? k / 0.3 * 0.9 : 0.9 - (k - 0.3) / 0.7 * 1.4;
    }
    // lighting follows the world: daylight on the surface, flashlight below
    this.ambient.intensity = light;
    this.key.intensity = light * 1.6;
  }
}
