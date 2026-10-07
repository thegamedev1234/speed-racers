import { SKINS, REGIONS } from './profile.js';

/**
 * Super Racers - Menu UI & Modal Controller
 * Connects DOM overlays, modals, notifications, and HUD to the game state.
 */
export class MenuUI {
  constructor({ profileManager, soundSystem, onStartPlay, onJoinRoom, onCreateRoom, onExitMatch, onSkinSelect }) {
    this.profile = profileManager;
    this.sound = soundSystem;
    this.onStartPlay = onStartPlay;
    this.onJoinRoom = onJoinRoom;
    this.onCreateRoom = onCreateRoom;
    this.onExitMatch = onExitMatch;
    this.onSkinSelect = onSkinSelect;

    this.toastTimeout = null;
    this.gameViewTimeout = null;
    this.currentHudAbilityId = undefined;

    this.cacheElements();
    this.initUI();
    this.bindEvents();
  }

  cacheElements() {
    // Overlays
    this.menuOverlay = document.getElementById('menu-overlay');
    this.gameHud = document.getElementById('game-hud');
    this.countdownOverlay = document.getElementById('countdown-overlay');
    this.countdownText = document.getElementById('countdown-text');
    this.toastEl = document.getElementById('toast-notification');

    // Profile elements
    this.usernameDisplay = document.getElementById('profile-username');
    this.levelBadge = document.getElementById('profile-level');
    this.xpBarFill = document.getElementById('xp-bar-fill');
    this.coinsDisplay = document.getElementById('currency-coins');
    this.gemsDisplay = document.getElementById('currency-gems');

    // Buttons & Inputs
    this.btnEditName = document.getElementById('btn-edit-name');
    this.btnCustomize = document.getElementById('btn-customize');
    this.btnPlay = document.getElementById('btn-play');
    this.btnCreateRoom = document.getElementById('btn-create-room');
    this.btnJoinRoom = document.getElementById('btn-join-room');
    this.inputRoomCode = document.getElementById('input-room-code');

    // Bottom Bar
    this.btnSettings = document.getElementById('btn-settings');
    this.btnAudioToggle = document.getElementById('btn-audio-toggle');
    this.audioIcon = document.getElementById('audio-icon');
    this.selectRegion = document.getElementById('select-region');

    // Modals
    this.modalEditName = document.getElementById('modal-edit-name');
    this.inputEditName = document.getElementById('input-edit-name');
    this.btnSaveName = document.getElementById('btn-save-name');
    this.btnCancelName = document.getElementById('btn-cancel-name');

    this.modalCustomize = document.getElementById('modal-customize');
    this.skinsGrid = document.getElementById('skins-grid');
    this.btnCloseCustomize = document.getElementById('btn-close-customize');

    this.modalCreateRoom = document.getElementById('modal-create-room');
    this.generatedRoomCode = document.getElementById('generated-room-code');
    this.btnCopyCode = document.getElementById('btn-copy-code');
    this.selectGameMode = document.getElementById('select-game-mode');
    this.selectMaxPlayers = document.getElementById('select-max-players');
    this.toggleBots = document.getElementById('toggle-bots');
    this.btnStartCustomMatch = document.getElementById('btn-start-custom-match');
    this.btnCancelCreateRoom = document.getElementById('btn-cancel-create-room');

    this.modalSettings = document.getElementById('modal-settings');
    this.sliderVolume = document.getElementById('slider-volume');
    this.checkSoundToggle = document.getElementById('check-sound-toggle');
    this.btnCloseSettings = document.getElementById('btn-close-settings');

    // HUD Elements
    this.hudSpeedometer = document.getElementById('hud-speed');
    this.hudTimer = document.getElementById('hud-timer');
    this.hudRoomBadge = document.getElementById('hud-room-badge');
    this.hudLeaderboardList = document.getElementById('hud-leaderboard-list');
    this.hudPlayerRank = document.getElementById('hud-player-rank');
    this.hudItemSlot = document.getElementById('hud-item-slot');
    this.hudItemIcon = document.getElementById('hud-item-icon');
    this.hudItemName = document.getElementById('hud-item-name');
    this.hudItemHint = document.getElementById('hud-item-hint');
    this.btnExitMatch = document.getElementById('btn-exit-match');
  }

  initUI() {
    this.renderProfile();
    this.renderRegions();
    this.renderSkinsGrid();
    this.updateAudioButtonState();

    if (this.sliderVolume) {
      this.sliderVolume.value = Math.round(this.profile.getVolume() * 100);
    }
    if (this.checkSoundToggle) {
      this.checkSoundToggle.checked = this.profile.getAudioEnabled();
    }
  }

  renderProfile() {
    this.usernameDisplay.textContent = this.profile.getUsername();
    this.levelBadge.textContent = `LVL ${this.profile.profile.level}`;
    const xpPercent = Math.min(100, Math.round((this.profile.profile.xp / this.profile.profile.maxXp) * 100));
    this.xpBarFill.style.width = `${xpPercent}%`;
    this.coinsDisplay.textContent = Number(this.profile.profile.coins).toLocaleString();
    this.gemsDisplay.textContent = Number(this.profile.profile.gems).toLocaleString();
  }

  renderRegions() {
    this.selectRegion.innerHTML = '';
    const currentRegion = this.profile.getRegion();
    REGIONS.forEach(reg => {
      const opt = document.createElement('option');
      opt.value = reg.id;
      opt.textContent = `${reg.id} • ${reg.ping}ms`;
      if (reg.id === currentRegion) {
        opt.selected = true;
      }
      this.selectRegion.appendChild(opt);
    });
  }

  renderSkinsGrid() {
    this.skinsGrid.innerHTML = '';
    const activeSkin = this.profile.getActiveSkin();

    SKINS.forEach(skin => {
      const isSelected = skin.id === activeSkin.id;
      const card = document.createElement('div');
      card.className = `skin-card ${isSelected ? 'active' : ''}`;
      card.setAttribute('data-skin-id', skin.id);

      card.innerHTML = `
        <div class="skin-card-header">
          <span class="skin-badge">${skin.badge}</span>
          <div class="skin-swatch" style="background: ${skin.swatch}; box-shadow: 0 0 12px ${skin.swatch};"></div>
        </div>
        <div class="skin-name">${skin.name}</div>
        <div class="skin-desc">${skin.description}</div>
        <button class="skin-equip-btn ${isSelected ? 'equipped' : ''}">
          ${isSelected ? 'EQUIPPED' : 'EQUIP'}
        </button>
      `;

      // Hover preview or click to equip
      card.addEventListener('mouseenter', () => {
        this.onSkinSelect(skin, false); // Preview
      });

      card.addEventListener('mouseleave', () => {
        this.onSkinSelect(this.profile.getActiveSkin(), false); // Revert to active
      });

      card.addEventListener('click', () => {
        this.selectSkin(skin);
      });

      this.skinsGrid.appendChild(card);
    });
  }

  selectSkin(skin) {
    this.sound.playChime();
    this.profile.setSkin(skin.id);
    this.onSkinSelect(skin, true); // Commit
    this.renderSkinsGrid();
    this.showToast(`Equipped ${skin.name} skin!`);
  }

  updateAudioButtonState() {
    const isEnabled = this.profile.getAudioEnabled() && this.profile.getVolume() > 0;
    if (this.btnAudioToggle) {
      this.btnAudioToggle.setAttribute('aria-label', isEnabled ? 'Mute Audio' : 'Unmute Audio');
      this.btnAudioToggle.classList.toggle('muted', !isEnabled);
    }
    if (this.audioIcon) {
      this.audioIcon.textContent = isEnabled ? '🔊' : '🔇';
    }
  }

  bindEvents() {
    // 1. PLAY Button
    this.btnPlay.addEventListener('click', () => {
      this.sound.playClick();
      this.onStartPlay({
        isPrivate: false,
        gameMode: 'Instant Bot Match',
        botsEnabled: true,
        maxPlayers: 4
      });
    });

    // 2. JOIN ROOM
    this.btnJoinRoom.addEventListener('click', () => {
      this.handleJoinRoom();
    });

    this.inputRoomCode.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        this.handleJoinRoom();
      }
    });

    this.inputRoomCode.addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase();
    });

    // 3. CREATE ROOM
    this.btnCreateRoom.addEventListener('click', () => {
      this.sound.playClick();
      this.openCreateRoomModal();
    });

    this.btnStartCustomMatch.addEventListener('click', () => {
      this.sound.playClick();
      const roomCode = this.generatedRoomCode.textContent.trim();
      const gameMode = this.selectGameMode.value;
      const maxPlayers = parseInt(this.selectMaxPlayers.value, 10);
      const botsEnabled = this.toggleBots.checked;

      this.closeModal(this.modalCreateRoom);
      this.onCreateRoom({
        isPrivate: true,
        roomCode,
        gameMode,
        maxPlayers,
        botsEnabled
      });
    });

    this.btnCancelCreateRoom.addEventListener('click', () => {
      this.sound.playClick();
      this.closeModal(this.modalCreateRoom);
    });

    this.btnCopyCode.addEventListener('click', () => {
      this.sound.playClick();
      const code = this.generatedRoomCode.textContent.trim();
      navigator.clipboard?.writeText(code).then(() => {
        this.showToast(`Room code ${code} copied!`);
      }).catch(() => {
        this.showToast(`Room code: ${code}`);
      });
    });

    // 4. CUSTOMIZE BUTTON
    this.btnCustomize.addEventListener('click', () => {
      this.sound.playClick();
      this.renderSkinsGrid();
      this.openModal(this.modalCustomize);
    });

    this.btnCloseCustomize.addEventListener('click', () => {
      this.sound.playClick();
      this.closeModal(this.modalCustomize);
    });

    // 5. EDIT USERNAME
    this.btnEditName.addEventListener('click', () => {
      this.sound.playClick();
      this.inputEditName.value = this.profile.getUsername();
      this.openModal(this.modalEditName);
      setTimeout(() => this.inputEditName.focus(), 50);
    });

    this.btnSaveName.addEventListener('click', () => {
      this.saveUsername();
    });

    this.btnCancelName.addEventListener('click', () => {
      this.sound.playClick();
      this.closeModal(this.modalEditName);
    });

    this.inputEditName.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        this.saveUsername();
      } else if (e.key === 'Escape') {
        this.closeModal(this.modalEditName);
      }
    });

    // 6. BOTTOM BAR CONTROLS
    this.btnAudioToggle.addEventListener('click', () => {
      const currentState = this.profile.getAudioEnabled();
      const newState = !currentState;
      this.profile.setAudioEnabled(newState);
      this.updateAudioButtonState();
      if (this.checkSoundToggle) {
        this.checkSoundToggle.checked = newState;
      }
      if (newState) {
        this.sound.playClick();
      }
    });

    this.selectRegion.addEventListener('change', e => {
      this.profile.setRegion(e.target.value);
      this.sound.playClick();
      this.showToast(`Region updated to ${e.target.value}`);
    });

    this.btnSettings.addEventListener('click', () => {
      this.sound.playClick();
      this.openModal(this.modalSettings);
    });

    this.btnCloseSettings.addEventListener('click', () => {
      this.sound.playClick();
      this.closeModal(this.modalSettings);
    });

    if (this.sliderVolume) {
      this.sliderVolume.addEventListener('input', e => {
        const val = parseInt(e.target.value, 10) / 100;
        this.profile.setVolume(val);
        this.updateAudioButtonState();
      });
    }

    if (this.checkSoundToggle) {
      this.checkSoundToggle.addEventListener('change', e => {
        this.profile.setAudioEnabled(e.target.checked);
        this.updateAudioButtonState();
      });
    }

    // 7. IN-GAME HUD & ESC KEY
    this.btnExitMatch.addEventListener('click', () => {
      this.sound.playClick();
      this.onExitMatch();
    });

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        // If modals are open, close them
        if (this.modalEditName.classList.contains('active')) {
          this.closeModal(this.modalEditName);
        } else if (this.modalCustomize.classList.contains('active')) {
          this.closeModal(this.modalCustomize);
        } else if (this.modalCreateRoom.classList.contains('active')) {
          this.closeModal(this.modalCreateRoom);
        } else if (this.modalSettings.classList.contains('active')) {
          this.closeModal(this.modalSettings);
        } else if (this.gameHud.classList.contains('active')) {
          // If playing game, return to menu
          this.onExitMatch();
        }
      }
    });
  }

  handleJoinRoom() {
    const rawCode = (this.inputRoomCode.value || '').trim().toUpperCase();
    if (rawCode.length < 5) {
      this.sound.playBump();
      this.showToast('Please enter a valid room code (e.g. SR-8921)');
      this.inputRoomCode.focus();
      return;
    }

    this.sound.playClick();
    this.showToast(`Connecting to room ${rawCode}...`);

    setTimeout(() => {
      this.onJoinRoom(rawCode);
    }, 600);
  }

  saveUsername() {
    const newName = (this.inputEditName.value || '').trim();
    if (!newName || newName.length < 2) {
      this.sound.playBump();
      this.showToast('Username must be at least 2 characters long.');
      return;
    }

    const sanitized = newName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16);
    if (!sanitized) {
      this.showToast('Username must contain letters or numbers.');
      return;
    }

    this.sound.playChime();
    this.profile.setUsername(sanitized);
    this.renderProfile();
    this.closeModal(this.modalEditName);
    this.showToast(`Username changed to ${sanitized}!`);
  }

  openCreateRoomModal() {
    const randomCode = `SR-${Math.floor(1000 + Math.random() * 9000)}`;
    this.generatedRoomCode.textContent = randomCode;
    this.openModal(this.modalCreateRoom);
  }

  openModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.add('active');
  }

  closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('active');
  }

  showToast(message) {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.add('visible');

    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastEl.classList.remove('visible');
    }, 2800);
  }

  setMenuView() {
    clearTimeout(this.gameViewTimeout);
    this.gameViewTimeout = null;
    this.menuOverlay.style.display = 'flex';
    this.menuOverlay.classList.remove('fade-out');
    this.gameHud.classList.remove('active');
    this.countdownOverlay.classList.remove('active');
    this.setItemSlot(null);
    this.renderProfile();
  }

  setGameView(matchOptions) {
    this.menuOverlay.classList.add('fade-out');
    clearTimeout(this.gameViewTimeout);
    this.gameViewTimeout = setTimeout(() => {
      this.menuOverlay.style.display = 'none';
      this.gameHud.classList.add('active');
      this.gameViewTimeout = null;
    }, 300);

    this.setItemSlot(null);

    // Setup HUD tags
    if (matchOptions.isPrivate && matchOptions.roomCode) {
      this.hudRoomBadge.textContent = `ROOM: ${matchOptions.roomCode}`;
    } else {
      this.hudRoomBadge.textContent = 'PRACTICE ARENA';
    }
  }

  showCountdown(val) {
    if (val === null) {
      this.countdownOverlay.classList.remove('active');
      return;
    }

    this.countdownOverlay.classList.add('active');
    this.countdownText.textContent = val;

    // Trigger pulse CSS animation
    this.countdownText.classList.remove('pulse');
    void this.countdownText.offsetWidth; // force reflow
    this.countdownText.classList.add('pulse');
  }

  setItemSlot(ability) {
    if (!this.hudItemSlot) return;

    const abilityId = ability?.slotId ?? ability?.id ?? null;
    if (abilityId === this.currentHudAbilityId) return;
    this.currentHudAbilityId = abilityId;
    this.hudItemSlot.classList.remove('pickup-pulse');
    if (!ability) {
      this.hudItemSlot.classList.remove('has-item');
      this.hudItemSlot.classList.add('is-empty');
      this.hudItemSlot.style.setProperty('--item-color', '#06b6d4');
      this.hudItemSlot.setAttribute('aria-label', 'Empty item slot. Drive through a mystery crate to collect an item.');
      this.hudItemIcon.textContent = '?';
      this.hudItemName.textContent = 'EMPTY SLOT';
      this.hudItemHint.textContent = 'Drive through a mystery crate';
      return;
    }

    this.hudItemSlot.classList.remove('is-empty');
    this.hudItemSlot.classList.add('has-item');
    this.hudItemSlot.style.setProperty('--item-color', ability.color || '#06b6d4');
    this.hudItemSlot.setAttribute('aria-label', `${ability.name} stored in the active item slot.`);
    this.hudItemIcon.textContent = ability.icon || '✦';
    this.hudItemName.textContent = ability.name;
    this.hudItemHint.textContent = 'STORED IN ACTIVE SLOT';
    void this.hudItemSlot.offsetWidth;
    this.hudItemSlot.classList.add('pickup-pulse');
  }

  updateHUD({ speedKmh, matchTimer, racers, playerRank, activeAbility }) {
    this.setItemSlot(activeAbility);
    if (this.hudSpeedometer) {
      this.hudSpeedometer.textContent = speedKmh;
    }

    if (this.hudTimer) {
      const minutes = Math.floor(matchTimer / 60).toString().padStart(2, '0');
      const seconds = Math.floor(matchTimer % 60).toString().padStart(2, '0');
      this.hudTimer.textContent = `${minutes}:${seconds}`;
    }

    if (this.hudPlayerRank) {
      const suffix = playerRank === 1 ? 'ST' : playerRank === 2 ? 'ND' : playerRank === 3 ? 'RD' : 'TH';
      this.hudPlayerRank.textContent = `${playerRank}${suffix}`;
    }

    if (this.hudLeaderboardList && racers) {
      this.hudLeaderboardList.innerHTML = racers.map(r => `
        <div class="leaderboard-row ${r.isPlayer ? 'is-player' : ''}">
          <span class="rank-pos">#${r.position}</span>
          <span class="rank-name" style="color: ${r.color};">${r.name}</span>
          <span class="rank-score">${r.score}</span>
        </div>
      `).join('');
    }
  }
}
