/**
 * Super Racers — Match State Manager.
 *
 * Single source of truth for the match clock. The game loop calls `update(dt)`
 * once per frame (already delta-clamped) and the manager drives the whole state
 * machine:
 *
 *   STARTING  →  3…2…1…GO! countdown (karts are frozen, the HUD shows the numbers)
 *   PLAYING   →  the 3:00 match timer ticks down in the HUD top-centre box
 *   OVER      →  the clock stops (results screen)
 *
 * Keeping this out of main.js means the timer can never get "stuck at 0:00"
 * again: every phase transition is explicit, delta-time is validated, and the
 * mm:ss text is pushed to the HUD exactly once per second (3:00 → 2:59).
 *
 * The class is renderer-agnostic and DOM-free so it can be unit tested headless.
 */

export const MATCH_STATE = Object.freeze({
  /** 3-second "3… 2… 1… GO!" countdown before the karts unlock. */
  STARTING: 'starting',
  /** Match clock running. */
  PLAYING: 'playing',
  /** Finished — nothing ticks any more. */
  OVER: 'over',
});

/** Seconds of the "3… 2… 1… GO!" countdown. */
export const COUNTDOWN_SECONDS = 3;

/** The 3-minute match clock (180 s → HUD "3:00"). */
export const MATCH_SECONDS = 180;

/** Clock for the "most kills in 5:00" timed mode. */
export const TIME_LIMIT_SECONDS = 300;

/** Largest delta the manager will ever integrate (matches the game loop cap). */
export const MAX_DELTA = 0.1;

/**
 * Countdown clock text. The remainder is rounded **up** so a whole second is
 * shown for a whole second: 180 → "3:00", 179.9 → "3:00", 179 → "2:59",
 * 0.4 → "0:01", 0 → "0:00". Non-finite input degrades to "0:00".
 */
export function formatClock(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Which clock a given match configuration should run on. */
export function matchDurationFor(config = {}) {
  if (config.matchSeconds) return Math.max(1, Math.floor(config.matchSeconds));
  if (config.mode === 'koth') return MATCH_SECONDS;
  if (config.target === 'time') return TIME_LIMIT_SECONDS;
  return MATCH_SECONDS;
}

export class MatchStateManager {
  /**
   * @param {object}   o
   * @param {number}   [o.duration]      seconds on the clock once PLAYING starts
   * @param {number}   [o.countdown]     seconds of the state STARTING countdown
   * @param {Function} [o.onCountdown]   (text, sub) — "3" / "2" / "1" / "GO!"
   * @param {Function} [o.onStart]       fired once when STARTING → PLAYING
   * @param {Function} [o.onSecond]      (secondsLeft, text) — once per whole second
   * @param {Function} [o.onTimeUp]      fired once when the clock hits 0
   * @param {Function} [o.onTick]        (snapshot) — every update, for HUD refresh
   */
  constructor({
    duration = MATCH_SECONDS,
    countdown = COUNTDOWN_SECONDS,
    onCountdown = null,
    onStart = null,
    onSecond = null,
    onTimeUp = null,
    onTick = null,
  } = {}) {
    this.callbacks = { onCountdown, onStart, onSecond, onTimeUp, onTick };
    this.reset({ duration, countdown });
  }

  /* ── lifecycle ─────────────────────────────────────────────────────── */
  reset({ duration = this.duration, countdown = this.countdownSeconds } = {}) {
    this.duration = Number.isFinite(duration) && duration > 0 ? duration : MATCH_SECONDS;
    this.countdownSeconds = Number.isFinite(countdown) ? Math.max(0, countdown) : COUNTDOWN_SECONDS;
    this.state = MATCH_STATE.STARTING;
    this.countdownLeft = this.countdownSeconds;
    this.timeLeft = this.duration;
    this.elapsed = 0;
    this.playingFor = 0;
    this.secondsShown = Math.ceil(this.duration);
    this.countdownText = null;
    this.finishedAt = null;
    this._started = false;
    this._timeUpFired = false;
    return this;
  }

  /** Force the match into PLAYING (used by rematch / network catch-up). */
  skipToPlaying() {
    if (this.state === MATCH_STATE.OVER) return this;
    this.countdownLeft = 0;
    this.state = MATCH_STATE.PLAYING;
    this._fireStart();
    return this;
  }

  /** Stop the clock (results screen). */
  finish(reason = 'over') {
    if (this.state === MATCH_STATE.OVER) return this;
    this.state = MATCH_STATE.OVER;
    this.reason = reason;
    this.finishedAt = this.elapsed;
    return this;
  }

  /* ── per-frame ─────────────────────────────────────────────────────── */
  /**
   * Advance the state machine.
   * @param {number} dt seconds (already capped by the game loop, validated here)
   * @returns {object} snapshot { state, timeLeft, elapsed, countdownText }
   */
  update(dt) {
    // never integrate a broken / absurd delta — this is what used to send the
    // physics + clock into NaN land after a long tab-switch or GC pause.
    const step = Number.isFinite(dt) ? Math.min(MAX_DELTA, Math.max(0, dt)) : 0;
    if (step <= 0) return this.snapshot();

    if (this.state === MATCH_STATE.STARTING) {
      this.countdownLeft -= step;
      this.elapsed += step;
      const n = Math.ceil(this.countdownLeft);
      const text = n > 0 ? String(n) : 'GO!';
      if (text !== this.countdownText) {
        this.countdownText = text;
        this.callbacks.onCountdown?.(text, n > 0 ? 'GET READY' : 'DEATHMATCH', n > 0);
      }
      if (this.countdownLeft <= 0) {
        this.state = MATCH_STATE.PLAYING;
        this._fireStart();
      }
    } else if (this.state === MATCH_STATE.PLAYING) {
      this.elapsed += step;
      this.playingFor += step;
      this.timeLeft = Math.max(0, this.timeLeft - step);

      const whole = Math.ceil(this.timeLeft);
      if (whole !== this.secondsShown) {
        this.secondsShown = whole;
        this.callbacks.onSecond?.(whole, formatClock(whole));
      }
      if (this.timeLeft <= 0 && !this._timeUpFired) {
        this._timeUpFired = true;
        this.callbacks.onTimeUp?.(this);
        // self-consistent: even without an onTimeUp listener the clock stops
        if (this.state === MATCH_STATE.PLAYING) this.state = MATCH_STATE.OVER;
      }
    }

    const snap = this.snapshot();
    this.callbacks.onTick?.(snap);
    return snap;
  }

  _fireStart() {
    if (this._started) return;
    this._started = true;
    this.secondsShown = Math.ceil(this.timeLeft);
    this.callbacks.onStart?.(this);
  }

  snapshot() {
    return {
      state: this.state,
      timeLeft: this.timeLeft,
      elapsed: this.elapsed,
      duration: this.duration,
      countdownText: this.countdownText,
      text: formatClock(this.timeLeft),
    };
  }

  /* ── queries ───────────────────────────────────────────────────────── */
  get isStarting() { return this.state === MATCH_STATE.STARTING; }
  get isPlaying() { return this.state === MATCH_STATE.PLAYING; }
  get isOver() { return this.state === MATCH_STATE.OVER; }
  /** True while karts are allowed to drive / shoot. */
  get live() { return this.state === MATCH_STATE.PLAYING; }
}
