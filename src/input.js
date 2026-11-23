// input.js — keyboard + mouse with pointer lock. Deliberately tiny.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();      // KeyboardEvent.code currently held
    this.pressed = new Set();   // pressed since last endFrame()
    this.mouseDX = 0; this.mouseDY = 0;
    this.buttons = new Set();
    this.clicked = new Set();
    this.wheel = 0;
    this.locked = false;
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code); this.pressed.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.buttons.clear(); });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button); this.clicked.add(e.button);
    });
    addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.down.clear(); this.buttons.clear(); }
      this.onLockChange && this.onLockChange(this.locked);
    });
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* not allowed yet */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  key(code) { return this.down.has(code); }
  hit(code) { return this.pressed.has(code); }
  click(btn = 0) { return this.clicked.has(btn); }
  held(btn = 0) { return this.buttons.has(btn); }

  endFrame() {
    this.pressed.clear(); this.clicked.clear();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
  }
}
