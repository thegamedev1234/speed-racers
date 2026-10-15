/**
 * Super Racers — Input manager.
 *
 * Hard-coded arcade bindings, attached **globally to `window`** (not to a div)
 * so the controls work no matter which element has focus:
 *
 *   W / ↑   accelerate            S / ↓   brake + reverse
 *   A / ←   steer LEFT  (+Y)      D / →   steer RIGHT (−Y)
 *   SPACE   FIRE HELD ABILITY
 *   SHIFT   drift / handbrake     E       look behind
 *   Q       horn                  R       reset / respawn if stuck
 *   TAB     scoreboard            ESC     pause
 *
 * Keys are resolved from `event.code` first (layout independent), then from
 * `event.key` (including the legacy "Spacebar" / "Esc" names) and finally from
 * the deprecated `keyCode`, so synth/older browsers still drive the kart.
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

/** `event.key` fallback (lower-cased) — covers missing `code` + legacy names. */
const KEY_FALLBACK = {
  w: 'forward', arrowup: 'forward', up: 'forward',
  s: 'back', arrowdown: 'back', down: 'back',
  a: 'left', arrowleft: 'left', left: 'left',
  d: 'right', arrowright: 'right', right: 'right',
  ' ': 'ability', spacebar: 'ability', space: 'ability',
  shift: 'drift', e: 'lookBehind', q: 'horn', r: 'reset',
  tab: 'scoreboard', escape: 'pause', esc: 'pause', enter: 'confirm',
};

/** Very old `event.keyCode` fallback. */
const KEYCODE_MAP = {
  32: 'ability', 16: 'drift', 9: 'scoreboard', 27: 'pause', 13: 'confirm',
  87: 'forward', 83: 'back', 65: 'left', 68: 'right',
  38: 'forward', 40: 'back', 37: 'left', 39: 'right',
};

const SCROLLABLE_CODES = ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** Resolve a keyboard event to a game action (or null). */
export function resolveAction(e) {
  if (!e) return null;
  if (typeof e.code === 'string' && KEY_MAP[e.code]) return KEY_MAP[e.code];
  const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
  if (key && KEY_FALLBACK[key]) return KEY_FALLBACK[key];
  const legacy = typeof e.keyCode === 'number' ? KEYCODE_MAP[e.keyCode] : null;
  return legacy || null;
}

/** True while the player is typing into a text field (must not steal WASD). */
function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
}

export class InputManager {
  constructor(target = (typeof window !== 'undefined' ? window : null)) {
    /** The global event target — `window`, so controls never need a click. */
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
      if (!el || typeof el.addEventListener !== 'function') return;
      el.addEventListener(type, fn, opts);
      this.handlers.push(() => el.removeEventListener(type, fn, opts));
    };

    /* ── global keyboard (window level) ─────────────────────────────── */
    add(this.target, 'keydown', (e) => {
      if (!this.enabled) return;
      const typing = isTypingTarget(e.target);
      const action = resolveAction(e);
      // stop the page from scrolling / tabbing away while racing
      if (!typing && (action || SCROLLABLE_CODES.includes(e.code))) e.preventDefault();
      if (!action) return;
      if (typing && action !== 'pause') return;      // never hijack the name field
      if (!this.down.has(action)) this.pressedThisFrame.add(action);
      this.down.add(action);
      if (action === 'pause' && this.onEscape) this.onEscape();
    }, { passive: false });

    add(this.target, 'keyup', (e) => {
      const action = resolveAction(e);
      if (!action) return;
      if (isTypingTarget(e.target) && action !== 'pause') return;
      if (!this.enabled) return;
      e.preventDefault();
      this.down.delete(action);
      this.releasedThisFrame.add(action);
    }, { passive: false });

    // losing focus (alt-tab, clicking outside) must not leave keys stuck down
    add(this.target, 'blur', () => this.clearAll());
    add(typeof document !== 'undefined' ? document : null, 'visibilitychange', () => {
      if (typeof document !== 'undefined' && document.hidden) this.clearAll();
    });

    // camera orbit via drag (works for mouse + touch)
    const el = (typeof document !== 'undefined' && document.getElementById('viewport')) || null;
    if (el) {
      add(el, 'pointerdown', (e) => {
        this.dragging = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
      });
      add(el, 'wheel', (e) => {
        this.zoomDelta = (this.zoomDelta || 0) + Math.sign(e.deltaY);
      }, { passive: true });
      add(el, 'contextmenu', (e) => e.preventDefault());
    }
    add(this.target, 'pointerup', () => { this.dragging = false; });
    add(this.target, 'pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.lookDelta.x += dx;
      this.lookDelta.y += dy;
    });
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
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0.016;
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
    this.steerSmoothed += (steer - this.steerSmoothed) * Math.min(1, rate * step);
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
