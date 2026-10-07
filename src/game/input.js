/**
 * Super Racers — Input manager.
 *
 * Hard-coded arcade bindings:
 *   W / ↑   accelerate            S / ↓   brake + reverse
 *   A / ←   steer LEFT  (+Y)      D / →   steer RIGHT (−Y)
 *   SPACE   FIRE HELD ABILITY
 *   SHIFT   drift / handbrake     E       look behind
 *   Q       horn                  R       reset / respawn if stuck
 *   TAB     scoreboard            ESC     pause
 */

const KEY_MAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'ability',
  ShiftLeft: 'drift', ShiftRight: 'drift',
  KeyE: 'lookBehind',
  KeyQ: 'horn',
  KeyR: 'reset',
  Tab: 'scoreboard',
  Escape: 'pause',
  Enter: 'confirm',
};

export class InputManager {
  constructor(target = window) {
    this.target = target;
    this.down = new Set();
    this.pressedThisFrame = new Set();
    this.releasedThisFrame = new Set();
    this.enabled = true;
    /** pointer-look accumulator, consumed by the camera each frame */
    this.lookDelta = { x: 0, y: 0 };
    this.dragging = false;
    this.lastPointer = { x: 0, y: 0 };
    this.steerSmoothed = 0;
    this.onEscape = null;
    this.handlers = [];
    this.bind();
  }

  bind() {
    const add = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      this.handlers.push(() => el.removeEventListener(type, fn, opts));
    };

    add(this.target, 'keydown', (e) => {
      if (!this.enabled) return;
      const action = KEY_MAP[e.code];
      // stop the page from scrolling / tabbing away while racing
      if (action || ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      if (!action) return;
      if (!this.down.has(action)) this.pressedThisFrame.add(action);
      this.down.add(action);
      if (action === 'pause' && this.onEscape) this.onEscape();
    }, { passive: false });

    add(this.target, 'keyup', (e) => {
      const action = KEY_MAP[e.code];
      if (!action) return;
      e.preventDefault();
      this.down.delete(action);
      this.releasedThisFrame.add(action);
    }, { passive: false });

    add(this.target, 'blur', () => this.clearAll());

    // camera orbit via drag (works for mouse + touch)
    const el = document.getElementById('viewport') || document.body;
    add(el, 'pointerdown', (e) => {
      this.dragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });
    add(window, 'pointerup', () => { this.dragging = false; });
    add(window, 'pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.lookDelta.x += dx;
      this.lookDelta.y += dy;
    });
    add(el, 'wheel', (e) => {
      this.zoomDelta = (this.zoomDelta || 0) + Math.sign(e.deltaY);
    }, { passive: true });
    add(el, 'contextmenu', (e) => e.preventDefault());
  }

  dispose() {
    this.handlers.forEach((off) => off());
    this.handlers = [];
  }

  clearAll() {
    this.down.clear();
    this.pressedThisFrame.clear();
    this.dragging = false;
  }

  /* ── queries ───────────────────────────────────────────────── */
  isDown(action) { return this.down.has(action); }
  wasPressed(action) { return this.pressedThisFrame.has(action); }
  wasReleased(action) { return this.releasedThisFrame.has(action); }

  consumeLook() {
    const out = { x: this.lookDelta.x, y: this.lookDelta.y };
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    return out;
  }

  consumeZoom() {
    const z = this.zoomDelta || 0;
    this.zoomDelta = 0;
    return z;
  }

  /**
   * Normalised driving axes.
   *   throttle: +1 forward, −1 brake/reverse
   *   steer:    +1 LEFT (positive Y rotation), −1 RIGHT (negative Y rotation)
   */
  axes(dt = 0.016) {
    let throttle = 0;
    let steer = 0;
    if (this.enabled) {
      if (this.down.has('forward')) throttle += 1;
      if (this.down.has('back')) throttle -= 1;
      if (this.down.has('left')) steer += 1;
      if (this.down.has('right')) steer -= 1;
    }
    // smooth the steering so keyboard taps don't snap the kart around
    const rate = steer === 0 ? 12 : 16;
    this.steerSmoothed += (steer - this.steerSmoothed) * Math.min(1, rate * dt);
    return {
      throttle,
      steer,
      steerSmooth: this.steerSmoothed,
      drift: this.down.has('drift'),
      ability: this.down.has('ability'),
      abilityPressed: this.pressedThisFrame.has('ability'),
    };
  }

  /** Called at the very end of every frame. */
  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
  }
}
