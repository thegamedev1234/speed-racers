/**
 * Super Racers — In-game HUD.
 * Owns: health bar, speedometer, ability slot, kill feed, scoreboard, damage
 * indicators, countdown, banners, death screen and the full-screen FX layers.
 */

const $ = (id) => document.getElementById(id);

const hex = (n) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

export class HUD {
  constructor() {
    this.root = $('hud-root');
    this.el = {
      score: $('hud-score'),
      timer: $('hud-timer'),
      modeName: $('hud-mode-name'),
      leader: $('hud-leader'),
      alive: $('hud-alive'),
      killFeed: $('kill-feed'),
      hitMarker: $('hit-marker'),
      killMarker: $('kill-marker'),
      dmgDirs: $('dmg-dirs'),
      dmgNumbers: $('dmg-numbers'),
      status: $('status-effects'),
      healthFill: $('health-fill'),
      healthGhost: $('health-ghost'),
      healthText: $('health-text'),
      shieldBar: $('shield-bar'),
      shieldFill: $('shield-fill'),
      speedCanvas: $('speedo-canvas'),
      speedValue: $('speed-value'),
      speedGear: $('speed-gear'),
      abilitySlot: $('ability-slot'),
      abilityRing: $('ability-ring-fill'),
      abilityIcon: $('ability-icon'),
      abilityName: $('ability-name'),
      abilityReady: $('ability-ready'),
      hint: $('hud-hint'),
      scoreboard: $('scoreboard'),
      sbBody: $('sb-body'),
      sbTitle: $('sb-title'),
      sbSub: $('sb-sub'),
      death: $('death-overlay'),
      deathBy: $('death-by'),
      respawn: $('respawn-count'),
      countdown: $('countdown'),
      cdText: $('cd-text'),
      cdSub: $('cd-sub'),
      banner: $('banner'),
      boost: $('boost-indicator'),
      boostFill: $('boost-fill'),
      fxDamage: $('fx-damage'),
      fxFlash: $('fx-flash'),
      fxBoost: $('fx-boost'),
      fxFade: $('fx-fade'),
      fxSpeed: $('fx-speedlines'),
    };

    this.ctx = this.el.speedCanvas?.getContext('2d');
    this.feed = [];
    this.banners = [];
    this.healthDisplay = 100;
    this.ghostHealth = 100;
    this.lastSpeedDrawn = -1;
    this.speedFrame = 0;
    this.hitTimer = null;
    this.statusChips = new Map();
    this.visible = false;

    this.el.abilitySlot?.classList.add('empty');
  }

  /* ── visibility ─────────────────────────────────────────────── */
  show() {
    this.root.classList.remove('hidden');
    this.visible = true;
    this.setHint('Break crates to grab abilities');
  }

  hide() {
    this.root.classList.add('hidden');
    this.visible = false;
    this.el.scoreboard?.classList.add('hidden');
    this.el.death?.classList.add('hidden');
    this.el.countdown?.classList.add('hidden');
    this.clearFeed();
  }

  /* ── match chrome ───────────────────────────────────────────── */
  setMode(name, target) {
    if (this.el.modeName) this.el.modeName.textContent = name;
    if (this.el.sbTitle) this.el.sbTitle.textContent = name;
    if (this.el.sbSub) this.el.sbSub.textContent = target;
  }

  setScore(n) { if (this.el.score) this.el.score.textContent = String(n); }
  setAlive(n) { if (this.el.alive) this.el.alive.textContent = String(n); }

  setLeader(name, kills) {
    if (this.el.leader) this.el.leader.textContent = name ? `LEADER: ${name} · ${kills}` : 'LEADER: —';
  }

  setTimer(seconds) {
    if (!this.el.timer) return;
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    this.el.timer.textContent = `${m}:${String(r).padStart(2, '0')}`;
    this.el.timer.classList.toggle('low', s <= 30);
  }

  /* ── vital stats ────────────────────────────────────────────── */
  setHealth(current, max, shield = 0) {
    const ratio = Math.max(0, Math.min(1, current / max));
    const pct = ratio * 100;
    this.healthDisplay = current;
    if (pct > this.ghostHealth) this.ghostHealth = pct;
    if (this.el.healthFill) {
      this.el.healthFill.style.width = `${pct}%`;
      this.el.healthFill.classList.toggle('critical', ratio <= 0.3);
      this.el.healthFill.classList.toggle('hurt', ratio > 0.3 && ratio <= 0.6);
    }
    if (this.el.healthGhost) {
      this.el.healthGhost.style.width = `${this.ghostHealth}%`;
      this.ghostHealth += (pct - this.ghostHealth) * 0.05;
    }
    if (this.el.healthText) this.el.healthText.textContent = String(Math.max(0, Math.round(current)));
    if (this.el.shieldBar) {
      this.el.shieldBar.hidden = shield <= 0;
      if (shield > 0) this.el.shieldFill.style.width = `${Math.min(100, (shield / 45) * 100)}%`;
    }
  }

  setSpeed(kmh, gear, boosting) {
    this.speedFrame++;
    if (this.el.speedValue && (this.speedFrame % 2 === 0 || Math.abs(kmh - this.lastSpeedDrawn) > 3)) {
      this.el.speedValue.textContent = String(Math.round(kmh));
      this.lastSpeedDrawn = kmh;
    }
    if (this.el.speedGear) this.el.speedGear.textContent = gear;
    if (this.el.fxBoost) this.el.fxBoost.classList.toggle('on', !!boosting);
    if (this.el.fxSpeed) this.el.fxSpeed.classList.toggle('on', kmh > 135);
    if (this.speedFrame % 2 === 0) this.drawSpeedo(kmh, boosting);
  }

  drawSpeedo(kmh, boosting) {
    const ctx = this.ctx;
    if (!ctx) return;
    const size = this.el.speedCanvas.width;
    const c = size / 2;
    ctx.clearRect(0, 0, size, size);

    const start = Math.PI * 0.75;
    const end = Math.PI * 2.25;
    const maxKmh = 170;
    const t = Math.max(0, Math.min(1, kmh / maxKmh));

    // track
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(126,224,255,.14)';
    ctx.beginPath();
    ctx.arc(c, c, c - 26, start, end);
    ctx.stroke();

    // ticks
    ctx.lineWidth = 2;
    for (let i = 0; i <= 20; i++) {
      const a = start + ((end - start) * i) / 20;
      const inner = i % 5 === 0 ? 16 : 9;
      ctx.strokeStyle = i % 5 === 0 ? 'rgba(255,255,255,.55)' : 'rgba(126,224,255,.28)';
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * (c - 30 - inner), c + Math.sin(a) * (c - 30 - inner));
      ctx.lineTo(c + Math.cos(a) * (c - 30), c + Math.sin(a) * (c - 30));
      ctx.stroke();
    }

    // value arc
    const grad = ctx.createLinearGradient(0, 0, size, size);
    if (boosting) {
      grad.addColorStop(0, '#ffc23d');
      grad.addColorStop(1, '#ff3b5c');
    } else {
      grad.addColorStop(0, '#22e1ff');
      grad.addColorStop(1, '#b4ff39');
    }
    ctx.strokeStyle = grad;
    ctx.lineWidth = 12;
    ctx.shadowColor = boosting ? '#ff7a1a' : '#22e1ff';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(c, c, c - 26, start, start + (end - start) * t);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // needle dot
    const a2 = start + (end - start) * t;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(c + Math.cos(a2) * (c - 26), c + Math.sin(a2) * (c - 26), 5, 0, Math.PI * 2);
    ctx.fill();
  }

  setBoost(ratio) {
    if (!this.el.boost) return;
    if (ratio === null || ratio === undefined || ratio <= 0) {
      this.el.boost.classList.add('hidden');
      return;
    }
    this.el.boost.classList.remove('hidden');
    this.el.boostFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }

  /* ── ability slot ───────────────────────────────────────────── */
  setAbility(ability, progress = 1, held = false) {
    const slot = this.el.abilitySlot;
    if (!slot) return;
    if (!ability) {
      slot.classList.add('empty');
      slot.classList.remove('ready', 'armed');
      this.el.abilityRing.style.strokeDashoffset = '283';
      this.el.abilityIcon.textContent = '❔';
      this.el.abilityName.textContent = 'NO ITEM';
      this.el.abilityReady.hidden = true;
      return;
    }
    slot.classList.remove('empty');
    this.el.abilityIcon.textContent = ability.icon;
    this.el.abilityName.textContent = ability.name;

    const ready = progress >= 1;
    slot.classList.toggle('ready', ready);
    slot.classList.toggle('armed', ready && held);
    this.el.abilityRing.style.strokeDashoffset = String(283 * (1 - Math.max(0, Math.min(1, progress))));
    this.el.abilityRing.style.stroke = hex(ability.color);
    this.el.abilityReady.hidden = !ready;
  }

  setHint(text, flash = false) {
    if (!this.el.hint) return;
    this.el.hint.textContent = text;
    this.el.hint.classList.toggle('flash', flash);
  }

  /* ── kill feed ──────────────────────────────────────────────── */
  pushKill({ killer, victim, icon, weapon, streak, mine = 'none' }) {
    const li = document.createElement('li');
    li.className = `kf-item${mine === 'kill' ? ' me-kill' : mine === 'death' ? ' me-death' : ''}`;
    li.innerHTML = `
      <span class="kf-killer">${killer || 'ARENA'}</span>
      <span class="kf-icon">${icon || '💥'}</span>
      <span class="kf-victim">${victim}</span>
      ${streak > 1 ? `<span class="kf-streak">${streak}× STREAK</span>` : ''}
    `;
    this.el.killFeed.prepend(li);
    const entry = { li, until: performance.now() + 5000 };
    this.feed.push(entry);
    while (this.feed.length > 6) {
      const old = this.feed.shift();
      old.li.remove();
    }
    setTimeout(() => {
      li.classList.add('out');
      setTimeout(() => li.remove(), 400);
    }, 5000);
  }

  clearFeed() {
    this.feed.forEach((f) => f.li.remove());
    this.feed.length = 0;
    if (this.el.killFeed) this.el.killFeed.innerHTML = '';
  }

  /* ── hit markers + damage feedback ──────────────────────────── */
  hitMarker(lethal = false) {
    const el = lethal ? this.el.killMarker : this.el.hitMarker;
    if (!el) return;
    el.classList.remove('on');
    // force restart of the animation
    void el.offsetWidth;
    el.classList.add('on');
  }

  damageDirection(angleRad) {
    if (!this.el.dmgDirs) return;
    const div = document.createElement('div');
    div.className = 'dmg-dir';
    div.style.transform = `rotate(${angleRad}rad)`;
    div.innerHTML = '<i></i>';
    this.el.dmgDirs.appendChild(div);
    setTimeout(() => div.remove(), 1150);
  }

  damageNumber(screen, text, kind = '') {
    if (!this.el.dmgNumbers) return;
    const div = document.createElement('div');
    div.className = `dmg-num${kind ? ` ${kind}` : ''}`;
    div.style.left = `${screen.x}px`;
    div.style.top = `${screen.y}px`;
    div.textContent = text;
    this.el.dmgNumbers.appendChild(div);
    setTimeout(() => div.remove(), 1050);
  }

  flashDamage() {
    const el = this.el.fxDamage;
    if (!el) return;
    el.classList.add('hit');
    setTimeout(() => el.classList.remove('hit'), 60);
    setTimeout(() => el.classList.remove('hit'), 260);
  }

  flashScreen(color = '#ffffff', duration = 140) {
    const el = this.el.fxFlash;
    if (!el) return;
    el.style.background = color;
    el.style.opacity = '0.75';
    setTimeout(() => { el.style.opacity = '0'; }, 40);
  }

  /* ── status effect chips ────────────────────────────────────── */
  setStatusChip(kartId, { kind, label, until }) {
    if (!this.el.status) return;
    const key = `${kartId}:${kind}`;
    let chip = this.statusChips.get(key);
    if (!until || until <= 0) {
      if (chip) { chip.el.remove(); this.statusChips.delete(key); }
      return;
    }
    if (!chip) {
      const el = document.createElement('div');
      el.className = 'status-chip';
      el.dataset.kind = kind;
      this.el.status.appendChild(el);
      chip = { el, until: 0, label };
      this.statusChips.set(key, chip);
    }
    chip.until = performance.now() + 15000;
    chip.el.innerHTML = `<b>${label}</b>`;
  }

  clearStatusChips() {
    this.statusChips.forEach((c) => c.el.remove());
    this.statusChips.clear();
  }

  purgeExpiredChips(untilMap) {
    this.statusChips.forEach((chip, key) => {
      if (untilMap.has(key) && !untilMap.get(key)) {
        chip.el.remove();
        this.statusChips.delete(key);
      }
    });
  }

  /* ── overlays ───────────────────────────────────────────────── */
  showDeath(killerName) {
    if (!this.el.death) return;
    this.el.deathBy.textContent = killerName ? `eliminated by ${killerName}` : 'you wrecked yourself';
    this.el.death.classList.remove('hidden');
  }

  hideDeath() { this.el.death?.classList.add('hidden'); }

  setRespawn(seconds) {
    if (this.el.respawn) this.el.respawn.textContent = String(Math.max(0, Math.ceil(seconds)));
  }

  countdown(text, sub) {
    if (!this.el.countdown) return;
    if (text === null) { this.el.countdown.classList.add('hidden'); return; }
    this.el.countdown.classList.remove('hidden');
    this.el.cdText.textContent = text;
    if (sub !== undefined && this.el.cdSub) this.el.cdSub.textContent = sub;
    this.el.cdText.style.animation = 'none';
    void this.el.cdText.offsetWidth;
    this.el.cdText.style.animation = '';
  }

  banner(text, variant = '', duration = 1600) {
    if (!this.el.banner) return;
    const div = document.createElement('div');
    div.className = `banner-msg${variant ? ` ${variant}` : ''}`;
    div.textContent = text;
    this.el.banner.appendChild(div);
    setTimeout(() => {
      div.classList.add('leave');
      setTimeout(() => div.remove(), 450);
    }, duration);
    while (this.el.banner.children.length > 3) this.el.banner.firstChild.remove();
  }

  /* ── scoreboard ─────────────────────────────────────────────── */
  setScoreboard(rows, visible) {
    if (!this.el.scoreboard) return;
    this.el.scoreboard.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.el.sbBody.innerHTML = rows.map((r, i) => `
      <tr class="sb-row${r.isMe ? ' me' : ''}${r.alive ? '' : ' dead'}">
        <td>${i + 1}</td>
        <td>
          <span class="sb-chip" style="--c1:${hex(r.color)};--c2:${hex(r.accent)}"></span>
          ${r.name}${r.isBot ? '<span class="bot-tag">BOT</span>' : ''}
        </td>
        <td>${r.kills}</td>
        <td>${r.deaths}</td>
        <td class="sb-streak">${r.streak > 1 ? `${r.streak}🔥` : '—'}</td>
        <td>${r.ping !== undefined && r.ping !== null ? r.ping : '—'}</td>
      </tr>
    `).join('');
  }

  /* ── screen fade ────────────────────────────────────────────── */
  fade(on, text = '') {
    const el = this.el.fxFade;
    if (!el) return;
    el.classList.toggle('text', !!text);
    if (text) el.dataset.text = text;
    el.classList.toggle('on', !!on);
  }

  update(dt) {
    // expire status chips whose timers have run out
    const now = performance.now();
    this.statusChips.forEach((chip, key) => {
      if (chip.until < now) {
        chip.el.remove();
        this.statusChips.delete(key);
      }
    });
  }
}
