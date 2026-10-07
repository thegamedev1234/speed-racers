/**
 * Super Racers — Menu UI controller.
 * Boot sequence, main menu, skin garage, settings modals, lobby, results and
 * toasts. Pure DOM: everything is wired by hand, no framework.
 */

import { SKINS, getSkin, skinModifiers } from './profile.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

export class MenuUI {
  constructor({ profile, audio, callbacks = {} }) {
    this.profile = profile;
    this.audio = audio;
    this.cb = callbacks;

    this.config = { mode: 'deathmatch', bots: 5, target: 15, arena: 'neon' };
    this.activeModal = null;

    this.el = {
      boot: $('boot'),
      bootBar: $('boot-bar-fill'),
      bootStatus: $('boot-status'),
      bootStart: $('boot-start'),
      bootHint: $('boot-hint'),
      root: $('menu-root'),
      menuScreen: $('menu-screen'),
      lobbyScreen: $('lobby-screen'),
      resultsScreen: $('results-screen'),
      modalLayer: $('modal-layer'),
      toasts: $('toast-stack'),
      skinList: $('skin-list'),
      skinClass: $('skin-class-label'),
      statBlock: $('stat-block'),
      username: $('username-input'),
      pcLevel: $('pc-level'),
      pcXp: $('pc-xp'),
      pcXpFill: $('pc-xp-fill'),
      pcKills: $('pc-kills'),
      pcWins: $('pc-wins'),
      pcRaces: $('pc-races'),
      soundIcon: $('sound-icon'),
      netDot: $('net-dot'),
      netLabel: $('net-label'),
      lobbyList: $('lobby-list'),
      lobbyCount: $('lobby-count'),
      lobbyTitle: $('lobby-title'),
      roomCode: $('room-code'),
      lobbyStatus: $('lobby-status'),
      lobbyStart: $('btn-lobby-start'),
      resultsList: $('results-list'),
      resultsTitle: $('results-title'),
      resultsSub: $('results-sub'),
      resultsReward: $('results-reward'),
      brandSub: $('brand-sub'),
    };

    this.built = false;
    this.bindStatic();
    this.bindSegments();
    this.bindSettings();
    this.syncProfile();
  }

  /* ══════════════ BOOT ══════════════ */
  async runBoot() {
    const steps = [
      [8, 'INITIALISING RENDERER…'],
      [24, 'GENERATING NEON TEXTURES…'],
      [42, 'BUILDING SHOWROOM…'],
      [58, 'CALIBRATING KART PHYSICS…'],
      [72, 'LOADING ABILITY ROSTER…'],
      [86, 'WARMING UP ENGINES…'],
      [100, 'READY TO RACE'],
    ];
    for (const [pct, text] of steps) {
      this.el.bootBar.style.width = `${pct}%`;
      this.el.bootStatus.textContent = text;
      await new Promise((r) => setTimeout(r, 110 + Math.random() * 90));
    }
    return new Promise((resolve) => {
      this.el.bootStart.hidden = false;
      this.el.bootHint.textContent = 'click to enable audio + enter fullscreen';
      this.el.bootStart.onclick = () => {
        this.el.bootStart.disabled = true;
        this.el.bootStatus.textContent = 'ENTERING…';
        this.audio?.init();
        this.audio?.uiSuccess();
        this.el.boot.style.transition = 'opacity .45s ease';
        this.el.boot.style.opacity = '0';
        setTimeout(() => {
          this.el.boot.classList.add('hidden');
          resolve();
        }, 460);
      };
    });
  }

  /* ══════════════ MAIN MENU ══════════════ */
  buildGarage() {
    if (this.built) return;
    this.built = true;
    this.el.skinList.innerHTML = '';
    SKINS.forEach((skin) => {
      const unlocked = this.profile.isUnlocked(skin);
      const card = document.createElement('button');
      card.className = 'skin-card' + (skin.id === this.profile.skinId ? ' active' : '') + (unlocked ? '' : ' locked');
      card.dataset.skin = skin.id;
      card.innerHTML = `
        <span class="skin-chip" style="--c1:${hex(skin.body)};--c2:${hex(skin.accent)}"></span>
        <span class="skin-info">
          <b>${skin.name}</b>
          <em>${skin.tag}</em>
        </span>
        ${unlocked ? '' : `<span class="skin-lock">🔒 LVL ${skin.unlockLevel}</span>`}
      `;
      card.addEventListener('mouseenter', () => this.audio?.uiHover());
      card.addEventListener('click', () => {
        if (!this.profile.isUnlocked(skin)) {
          this.audio?.uiError();
          this.toast(`Reach level ${skin.unlockLevel} to unlock ${skin.name}`, 'warn', '🔒');
          return;
        }
        this.profile.setSkin(skin.id);
        this.audio?.uiClick();
        this.syncProfile();
        this.cb.onSkinPreview?.(skin);
      });
      this.el.skinList.appendChild(card);
    });
    this.updateStats();
  }

  updateStats() {
    const skin = this.profile.skin;
    const stats = skin.stats;
    this.el.skinClass.textContent = skin.tag;
    document.querySelectorAll('.stat-row').forEach((row) => {
      const key = row.dataset.stat;
      const val = stats[key] || 3;
      row.querySelector('i').style.width = `${(val / 5) * 100}%`;
    });
    document.querySelectorAll('.skin-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.skin === skin.id);
    });
  }

  syncProfile() {
    const p = this.profile.data;
    if (this.el.username) this.el.username.value = p.name;
    this.el.pcLevel.textContent = String(p.level);
    this.el.pcKills.textContent = String(p.kills);
    this.el.pcWins.textContent = String(p.wins);
    this.el.pcRaces.textContent = String(p.matches);
    const need = this.profile.xpForLevel(p.level);
    this.el.pcXp.textContent = `${p.xp}/${need} XP`;
    this.el.pcXpFill.style.width = `${Math.min(100, (p.xp / need) * 100)}%`;
    if (this.el.soundIcon) this.el.soundIcon.textContent = p.settings.volume > 0 ? '🔊' : '🔇';
    this.updateStats();
  }

  showMenu() {
    this.el.root.classList.remove('hidden');
    this.el.menuScreen.classList.remove('hidden');
    this.el.lobbyScreen.classList.add('hidden');
    this.el.resultsScreen.classList.add('hidden');
    this.buildGarage();
    this.syncProfile();
    this.closeModals();
  }

  showLobby({ code, isHost }) {
    this.el.lobbyScreen.classList.remove('hidden');
    this.el.menuScreen.classList.add('hidden');
    this.el.resultsScreen.classList.add('hidden');
    this.el.roomCode.textContent = code;
    this.el.lobbyStart.hidden = !isHost;
    this.el.lobbyStatus.textContent = isHost
      ? 'Waiting for racers to join…'
      : 'Waiting for the host to start the match…';
  }

  hide() {
    this.el.root.classList.add('hidden');
  }

  updateLobby({ code, players, isHost, config }) {
    this.el.roomCode.textContent = code;
    this.el.lobbyCount.textContent = `${players.length}/8`;
    this.el.lobbyList.innerHTML = players.map((p, i) => `
      <li class="lobby-player${p.self ? ' me' : ''}">
        <span class="lp-rank">${i + 1}</span>
        <span class="lp-chip" style="--c1:${hex(p.color)};--c2:${hex(p.accent)}"></span>
        <span class="lp-name">${p.name}</span>
        ${p.isBot ? '<span class="lp-tag bot">BOT</span>' : ''}
        ${p.host ? '<span class="lp-tag host">HOST</span>' : ''}
        ${!p.isBot && !p.host ? `<span class="lp-tag ${p.ready ? 'ready' : 'wait'}">${p.ready ? 'READY' : 'WAITING'}</span>` : ''}
      </li>
    `).join('');

    if (isHost && config) {
      this.setSegment('lobby-seg-mode', config.mode);
      this.setSegment('lobby-seg-bots', String(config.bots));
    }
  }

  showResults({ standings, xp, reward, won, modeName }) {
    this.el.resultsScreen.classList.remove('hidden');
    this.el.menuScreen.classList.add('hidden');
    this.el.lobbyScreen.classList.add('hidden');
    this.el.resultsTitle.textContent = won ? 'VICTORY!' : 'MATCH COMPLETE';
    this.el.resultsSub.textContent = modeName;
    this.el.resultsList.innerHTML = standings.map((r, i) => `
      <li class="result-row${r.isMe ? ' me' : ''}${i < 3 ? ' podium' : ''}">
        <span class="rr-rank">${i === 0 ? '🏆' : `${i + 1}`}</span>
        <span class="sb-chip" style="--c1:${hex(r.color)};--c2:${hex(r.accent)}"></span>
        <span class="rr-name">${r.name}${r.isBot ? '<span class="bot-tag">BOT</span>' : ''}</span>
        <span class="rr-kd">${r.kills} K · ${r.deaths} D</span>
        <span class="rr-xp">${r.xp ? `+${r.xp} XP` : ''}</span>
      </li>
    `).join('');
    this.el.resultsReward.textContent = reward || `+${xp} XP earned`;
    this.syncProfile();
  }

  /** Validate + submit the room code from the join modal. */
  submitJoinCode() {
    const input = $('join-code-input');
    const err = $('join-code-error');
    const clean = (input?.value || '').trim().toUpperCase();
    if (!/^SR-\d{4}$/.test(clean)) {
      this.audio?.uiError();
      if (err) err.hidden = false;
      input?.classList.add('invalid');
      return;
    }
    this.audio?.uiSuccess();
    this.closeModals();
    this.cb.onJoinRoom?.(clean);
  }

  /* ══════════════ MODALS ══════════════ */
  openModal(id) {
    this.el.modalLayer.classList.remove('hidden');
    document.querySelectorAll('.modal').forEach((m) => m.classList.toggle('active', m.id === id));
    this.activeModal = id;
    if (id === 'modal-profile') this.fillProfileModal();
    this.audio?.uiClick();
  }

  closeModals() {
    this.el.modalLayer.classList.add('hidden');
    document.querySelectorAll('.modal').forEach((m) => m.classList.remove('active'));
    this.activeModal = null;
  }

  fillProfileModal() {
    const p = this.profile.data;
    $('prof-level').textContent = String(p.level);
    $('prof-xp').textContent = String(p.xp);
    $('prof-kills').textContent = String(p.kills);
    $('prof-deaths').textContent = String(p.deaths);
    $('prof-wins').textContent = String(p.wins);
    $('prof-races').textContent = String(p.matches);
    $('prof-name').value = p.name;
  }

  /* ══════════════ TOASTS ══════════════ */
  toast(message, kind = '', icon = 'ℹ️') {
    const div = document.createElement('div');
    div.className = `toast${kind ? ` ${kind}` : ''}`;
    div.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
    this.el.toasts.appendChild(div);
    setTimeout(() => {
      div.classList.add('out');
      setTimeout(() => div.remove(), 320);
    }, 3200);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  setNetStatus(state, label) {
    this.el.netDot.className = `net-dot${state === 'ok' ? '' : state === 'warn' ? ' off' : state === 'err' ? ' err' : ' off'}`;
    this.el.netLabel.textContent = label;
  }

  /* ══════════════ SEGMENTED CONTROLS ══════════════ */
  setSegment(id, value) {
    const seg = $(id);
    if (!seg) return;
    seg.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.value === String(value));
    });
  }

  wireSegment(id, onChange) {
    const seg = $(id);
    if (!seg) return;
    seg.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('mouseenter', () => this.audio?.uiHover());
      btn.addEventListener('click', () => {
        seg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.audio?.uiClick();
        onChange?.(btn.dataset.value);
      });
    });
  }

  /* ══════════════ WIRING ══════════════ */
  bindStatic() {
    const click = (id, fn) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('mouseenter', () => this.audio?.uiHover());
      el.addEventListener('click', (e) => {
        this.audio?.init();
        this.audio?.uiClick();
        fn(e);
      });
    };

    /* main actions */
    click('btn-play', () => this.cb.onPlay?.(this.config));
    click('btn-create-room', () => {
      const code = `SR-${Math.floor(1000 + Math.random() * 8999)}`;
      this.cb.onCreateRoom?.({ ...this.config, code });
    });
    click('btn-join-room', () => {
      this.openModal('modal-join');
      const input = $('join-code-input');
      const err = $('join-code-error');
      if (err) err.hidden = true;
      if (input) {
        input.value = '';
        input.classList.remove('invalid');
        setTimeout(() => input.focus(), 60);
      }
    });

    click('btn-join-confirm', () => this.submitJoinCode());

    const joinInput = $('join-code-input');
    if (joinInput) {
      joinInput.addEventListener('input', () => {
        // keep the SR-#### shape while typing
        const digits = joinInput.value.replace(/[^0-9]/g, '').slice(0, 4);
        joinInput.value = digits ? `SR-${digits}` : '';
        joinInput.classList.remove('invalid');
      });
      joinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.submitJoinCode(); }
      });
    }

    click('btn-lobby-start', () => this.cb.onLobbyStart?.(this.config));
    click('btn-lobby-leave', () => this.cb.onLobbyLeave?.());
    click('btn-lobby-close', () => this.cb.onLobbyLeave?.());
    click('btn-copy-code', async () => {
      try {
        await navigator.clipboard.writeText(this.el.roomCode.textContent);
        this.toast('Invite code copied', 'success', '📋');
      } catch {
        this.toast(`Share this code: ${this.el.roomCode.textContent}`, '', '🔗');
      }
    });

    click('btn-results-menu', () => this.cb.onMainMenu?.());
    click('btn-rematch', () => this.cb.onRematch?.());

    /* header buttons */
    click('btn-settings', () => this.openModal('modal-settings'));
    click('btn-controls', () => this.openModal('modal-controls'));
    click('btn-profile', () => this.openModal('modal-profile'));
    click('btn-save-profile', () => {
      this.profile.setName($('prof-name').value);
      this.syncProfile();
      this.toast('Profile saved', 'success', '💾');
      this.closeModals();
    });

    click('btn-fullscreen', () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    });

    click('btn-sound', () => {
      const s = this.profile.settings;
      const next = s.volume > 0 ? 0 : 0.8;
      this.profile.setSetting('volume', next);
      this.audio?.applySettings();
      this.syncProfile();
      this.toast(next === 0 ? 'Audio muted' : 'Audio on', '', next === 0 ? '🔇' : '🔊');
    });

    /* close buttons */
    document.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', () => this.closeModals());
    });

    /* username inline edit */
    if (this.el.username) {
      const commit = () => {
        this.profile.setName(this.el.username.value);
        this.el.username.value = this.profile.name;
        this.syncProfile();
        this.cb.onNameChange?.(this.profile.name);
      };
      this.el.username.addEventListener('blur', commit);
      this.el.username.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.el.username.blur(); } });
    }

    /* ESC closes modals */
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeModal) this.closeModals();
    });
  }

  bindSegments() {
    this.wireSegment('seg-mode', (v) => {
      this.config.mode = v;
      this.el.brandSub.textContent = v === 'koth' ? 'KING OF THE HILL' : 'NEON DEATHMATCH';
    });
    this.wireSegment('seg-bots', (v) => { this.config.bots = parseInt(v, 10); });
    this.wireSegment('seg-score', (v) => { this.config.target = v === 'time' ? 'time' : parseInt(v, 10); });
    this.wireSegment('seg-arena', (v) => { this.config.arena = v; });
    this.wireSegment('seg-quality', (v) => {
      this.profile.setSetting('quality', v);
      this.cb.onSettingsChange?.('quality', v);
      this.toast(`Graphics: ${v.toUpperCase()} — applies next launch`, 'warn', '🎛️');
    });
    this.wireSegment('lobby-seg-mode', (v) => {
      this.config.mode = v;
      this.cb.onLobbyConfig?.(this.config);
    });
    this.wireSegment('lobby-seg-bots', (v) => {
      this.config.bots = parseInt(v, 10);
      this.cb.onLobbyConfig?.(this.config);
    });
  }

  bindSettings() {
    const s = this.profile.settings;
    const setRange = (id, key, labelId, fmt) => {
      const el = $(id);
      const label = $(labelId);
      if (!el) return;
      el.value = String(Math.round((s[key] ?? el.value / 100) * 100));
      label.textContent = fmt(s[key]);
      el.addEventListener('input', () => {
        const val = parseInt(el.value, 10) / 100;
        this.profile.setSetting(key, val);
        label.textContent = fmt(val);
        this.audio?.applySettings();
        this.syncProfile();
      });
    };

    setRange('set-volume', 'volume', 'lbl-volume', (v) => `${Math.round(v * 100)}%`);
    setRange('set-music', 'music', 'lbl-music', (v) => `${Math.round(v * 100)}%`);
    setRange('set-shake', 'shake', 'lbl-shake', (v) => `${Math.round(v * 100)}%`);
    setRange('set-sens', 'sensitivity', 'lbl-sens', (v) => `${Math.round(v * 100)}%`);

    const toggle = (id, key, sideEffect) => {
      const el = $(id);
      if (!el) return;
      el.checked = !!s[key];
      el.addEventListener('change', () => {
        this.profile.setSetting(key, el.checked);
        sideEffect?.(el.checked);
      });
    };
    toggle('set-inverty', 'invertY');
    toggle('set-dmgnum', 'dmgNumbers');
    toggle('set-bloom', 'bloom', (v) => {
      this.cb.onSettingsChange?.('bloom', v);
      this.toast(v ? 'Neon bloom ON' : 'Bloom disabled (better performance)', '', '✨');
    });

    const server = $('set-server');
    if (server) {
      server.value = s.serverUrl || '';
      server.addEventListener('change', () => {
        this.profile.setSetting('serverUrl', server.value.trim());
        this.toast(server.value.trim() ? 'Server URL saved — reconnecting' : 'Using built-in local server', '', '🌐');
        this.cb.onSettingsChange?.('serverUrl', server.value.trim());
      });
    }

    // two-step confirmation: no native confirm() (blocked in sandboxed frames)
    const reset = $('btn-reset-profile');
    if (reset) {
      let armed = false;
      let armTimer = null;
      const restore = () => {
        armed = false;
        reset.textContent = 'RESET ALL PROGRESS';
        reset.classList.add('danger');
      };
      reset.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          reset.textContent = '⚠️ CLICK AGAIN TO WIPE EVERYTHING';
          reset.classList.remove('danger');
          armTimer = setTimeout(restore, 4000);
          return;
        }
        clearTimeout(armTimer);
        restore();
        this.profile.reset();
        this.built = false;
        this.buildGarage();
        this.syncProfile();
        this.toast('Progress reset', 'warn', '🧹');
      });
    }
  }
}
