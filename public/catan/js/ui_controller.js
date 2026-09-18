/**
 * UI Controller: Colonist.io Mobile Interface Controller
 * Manages player status bar, resource ribbons, bottom sheets, modals, and user actions.
 */

class UIController {
  constructor(app) {
    this.app = app;

    // Elements
    this.playersCarousel = document.getElementById('players-carousel');
    this.instructionPill = document.getElementById('instruction-pill');
    this.instructionText = document.getElementById('instruction-text');
    this.diceBanner = document.getElementById('dice-banner');
    this.die1 = document.getElementById('die-1');
    this.die2 = document.getElementById('die-2');
    this.diceSumLabel = document.getElementById('dice-sum-label');

    // Bottom dock
    this.primaryBtn = document.getElementById('btn-primary-turn');
    this.primaryBtnIcon = document.getElementById('primary-btn-icon');
    this.primaryBtnLabel = document.getElementById('primary-btn-label');
    this.btnBuild = document.getElementById('btn-build');
    this.btnTrade = document.getElementById('btn-trade');
    this.btnDevCards = document.getElementById('btn-open-dev-cards');

    // Bottom sheets
    this.buildSheet = document.getElementById('build-sheet');
    this.tradeSheet = document.getElementById('trade-sheet');
    this.devCardsSheet = document.getElementById('dev-cards-sheet');
    this.chatDrawer = document.getElementById('chat-drawer');

    // Modals
    this.discardModal = document.getElementById('discard-modal');
    this.stealModal = document.getElementById('steal-modal');
    this.gameOverModal = document.getElementById('game-over-modal');

    // Resource counts
    this.resBadges = {
      wood: document.getElementById('res-count-wood'),
      brick: document.getElementById('res-count-brick'),
      sheep: document.getElementById('res-count-sheep'),
      wheat: document.getElementById('res-count-wheat'),
      ore: document.getElementById('res-count-ore'),
      dev: document.getElementById('res-count-dev'),
    };

    // Bank trade selections
    this.selectedBankGive = null;
    this.selectedBankGet = null;

    // Player trade stepper counts
    this.offerCounts = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    this.targetCounts = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };

    this._bindEvents();
  }

  _bindEvents() {
    // Primary turn button click
    this.primaryBtn.addEventListener('click', () => {
      this.app.handlePrimaryAction();
    });

    // Sheet openers
    this.btnBuild.addEventListener('click', () => this.toggleSheet(this.buildSheet));
    this.btnTrade.addEventListener('click', () => this.toggleSheet(this.tradeSheet));
    this.btnDevCards.addEventListener('click', () => this.toggleSheet(this.devCardsSheet));

    // Sheet close buttons
    document.querySelectorAll('.sheet-close-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const sheetId = e.currentTarget.getAttribute('data-close');
        if (sheetId) {
          const sheet = document.getElementById(sheetId);
          if (sheet) sheet.classList.remove('open');
        } else {
          this.chatDrawer.classList.remove('open');
        }
      });
    });

    // Toggle Chat / Log Drawer
    const btnToggleLog = document.getElementById('btn-toggle-log');
    if (btnToggleLog) {
      btnToggleLog.addEventListener('click', () => {
        this.chatDrawer.classList.toggle('open');
      });
    }

    // Toggle Audio
    const btnToggleAudio = document.getElementById('btn-toggle-audio');
    if (btnToggleAudio) {
      btnToggleAudio.addEventListener('click', () => {
        if (window.soundEffects) {
          const enabled = window.soundEffects.toggle();
          btnToggleAudio.textContent = enabled ? '🔊' : '🔇';
        }
      });
    }

    // Build Sheet actions
    document.getElementById('btn-buy-road').addEventListener('click', () => {
      this.closeAllSheets();
      this.app.startBuildMode('road');
    });

    document.getElementById('btn-buy-settlement').addEventListener('click', () => {
      this.closeAllSheets();
      this.app.startBuildMode('settlement');
    });

    document.getElementById('btn-buy-city').addEventListener('click', () => {
      this.closeAllSheets();
      this.app.startBuildMode('city');
    });

    document.getElementById('btn-buy-dev-card').addEventListener('click', () => {
      this.closeAllSheets();
      this.app.sendAction('buy_dev_card', {});
    });

    // Trade tab switching
    document.querySelectorAll('.trade-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.trade-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.trade-tab-pane').forEach(p => p.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const targetId = `tab-${e.currentTarget.getAttribute('data-tab')}`;
        const pane = document.getElementById(targetId);
        if (pane) pane.classList.add('active');
      });
    });

    // Bank trade execution
    document.getElementById('btn-execute-bank-trade').addEventListener('click', () => {
      if (this.selectedBankGive && this.selectedBankGet) {
        this.app.sendAction('bank_trade', {
          give: this.selectedBankGive,
          get: this.selectedBankGet
        });
        this.closeAllSheets();
      }
    });

    // Domestic player trade proposal
    document.getElementById('btn-propose-trade').addEventListener('click', () => {
      const offerSum = Object.values(this.offerCounts).reduce((a, b) => a + b, 0);
      const targetSum = Object.values(this.targetCounts).reduce((a, b) => a + b, 0);
      if (offerSum > 0 && targetSum > 0) {
        this.app.sendAction('propose_trade', {
          offer: this.offerCounts,
          target: this.targetCounts
        });
        this.closeAllSheets();
      }
    });

    // Chat form submit
    const chatForm = document.getElementById('chat-form');
    if (chatForm) {
      chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (text) {
          this.app.sendChat(text);
          input.value = '';
        }
      });
    }

    // Return to lobby button
    document.getElementById('btn-return-lobby').addEventListener('click', () => {
      window.location.reload();
    });
  }

  toggleSheet(sheet) {
    if (!sheet) return;
    const isOpen = sheet.classList.contains('open');
    this.closeAllSheets();
    if (!isOpen) {
      sheet.classList.add('open');
    }
  }

  closeAllSheets() {
    [this.buildSheet, this.tradeSheet, this.devCardsSheet].forEach(s => {
      if (s) s.classList.remove('open');
    });
  }

  // --- RENDER PLAYERS STATUS (8 PLAYERS CAROUSEL) ---
  renderPlayers(players, currentTurnIdx, longestRoadPid, largestArmyPid) {
    if (!this.playersCarousel || !players) return;
    this.playersCarousel.innerHTML = '';

    players.forEach((p) => {
      const isTurn = (p.id === currentTurnIdx);
      const card = document.createElement('div');
      card.className = `player-card ${isTurn ? 'active-turn' : ''}`;

      const avatar = document.createElement('div');
      avatar.className = 'p-avatar';
      avatar.style.backgroundColor = p.color;
      avatar.textContent = p.name.charAt(0).toUpperCase();

      const meta = document.createElement('div');
      meta.className = 'p-meta';

      const nameRow = document.createElement('div');
      nameRow.className = 'p-name';
      nameRow.textContent = p.name + (p.is_bot ? ' 🤖' : '');

      const statsRow = document.createElement('div');
      statsRow.className = 'p-stats';
      statsRow.innerHTML = `
        <span class="stat-item stat-vp" title="Segerpoäng">🏆 ${p.total_vp}</span>
        <span class="stat-item" title="Kort på hand">🃏 ${p.resources_count}</span>
        <span class="stat-item" title="Utvecklingskort">📜 ${p.dev_cards_count}</span>
      `;

      if (p.id === longestRoadPid) {
        statsRow.innerHTML += `<span class="badge-special badge-road" title="Längsta Vägen">🛣️</span>`;
      }
      if (p.id === largestArmyPid) {
        statsRow.innerHTML += `<span class="badge-special badge-army" title="Största Riddarmakten">⚔️</span>`;
      }

      meta.appendChild(nameRow);
      meta.appendChild(statsRow);
      card.appendChild(avatar);
      card.appendChild(meta);

      this.playersCarousel.appendChild(card);
    });
  }

  // --- RENDER RESOURCE COUNTS ---
  renderResources(myPlayer) {
    if (!myPlayer) return;
    const res = myPlayer.resources || {};

    for (const [key, badge] of Object.entries(this.resBadges)) {
      if (key === 'dev') {
        const count = myPlayer.dev_cards ? myPlayer.dev_cards.length : 0;
        badge.textContent = count;
      } else {
        const count = res[key] || 0;
        badge.textContent = count;
      }
    }

    // Update build sheet affordability
    this.updateBuildSheetAffordability(myPlayer);
    this.renderBankTradeOptions(myPlayer);
    this.renderDomesticTradeSteppers(myPlayer);
    this.renderDevCardsSheet(myPlayer);
  }

  updateBuildSheetAffordability(player) {
    const res = player.resources || {};
    const costs = {
      road: { wood: 1, brick: 1 },
      settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
      city: { wheat: 2, ore: 3 },
      dev: { sheep: 1, wheat: 1, ore: 1 }
    };

    const canAfford = (cost) => Object.entries(cost).every(([r, amt]) => (res[r] || 0) >= amt);

    // Update remaining counters
    document.getElementById('rem-road').textContent = player.roads_remaining;
    document.getElementById('rem-settlement').textContent = player.settlements_remaining;
    document.getElementById('rem-city').textContent = player.cities_remaining;

    const items = [
      { id: 'road', card: 'build-item-road', btn: 'btn-buy-road', rem: player.roads_remaining },
      { id: 'settlement', card: 'build-item-settlement', btn: 'btn-buy-settlement', rem: player.settlements_remaining },
      { id: 'city', card: 'build-item-city', btn: 'btn-buy-city', rem: player.cities_remaining },
      { id: 'dev', card: 'build-item-dev', btn: 'btn-buy-dev-card', rem: 99 },
    ];

    items.forEach(({ id, card, btn, rem }) => {
      const affordable = canAfford(costs[id]) && rem > 0;
      const cardEl = document.getElementById(card);
      const btnEl = document.getElementById(btn);
      if (cardEl) cardEl.classList.toggle('affordable', affordable);
      if (btnEl) btnEl.disabled = !affordable;
    });
  }

  // --- PRIMARY ACTION BUTTON ADAPTATION ---
  updateTurnState(state, myPlayerId) {
    const isMyTurn = (state.current_turn_idx === myPlayerId);
    const activePlayer = state.players[state.current_turn_idx];
    const activeName = activePlayer ? activePlayer.name : 'Spelare';

    this.primaryBtn.classList.remove('end-turn-mode');

    if (state.status === 'SETUP_1' || state.status === 'SETUP_2') {
      this.btnBuild.style.display = 'none';
      this.btnTrade.style.display = 'none';

      if (isMyTurn) {
        if (state.turn_phase === 'SETUP_SETTLEMENT') {
          this.setInstruction('🏠 Tryck på en vit punkt för att bygga en startby!');
          this.setPrimaryButton('Placera By', '🏠', true);
        } else if (state.turn_phase === 'SETUP_ROAD') {
          this.setInstruction('🛤️ Tryck på en vägmarkering intill din by!');
          this.setPrimaryButton('Placera Väg', '🛤️', true);
        }
      } else {
        this.setInstruction(`⏳ ${activeName} placerar ut sina startbyggnader...`);
        this.setPrimaryButton(`Väntar på ${activeName}`, '⏳', false);
      }
      return;
    }

    if (state.status === 'MAIN_GAME') {
      this.btnBuild.style.display = 'flex';
      this.btnTrade.style.display = 'flex';

      // Check robber discard
      if (state.turn_phase === 'ROBBER_DISCARD') {
        if (state.sub_turn_players && state.sub_turn_players.includes(myPlayerId)) {
          this.setInstruction('⚠️ Tärningen slog en 7:a! Du måste slänga hälften av dina kort.');
          this.showDiscardModal(state.players[myPlayerId]);
          this.setPrimaryButton('Släng Kort', '⚠️', true);
          return;
        } else {
          this.hideDiscardModal();
          this.setInstruction('⏳ Andra spelare slänger kort...');
          this.setPrimaryButton('Väntar...', '⏳', false);
          return;
        }
      } else {
        this.hideDiscardModal();
      }

      // Check robber move
      if (state.turn_phase === 'ROBBER_MOVE') {
        if (isMyTurn) {
          this.setInstruction('🏴‍☠️ Tryck på en hexagon för att flytta rövaren!');
          this.setPrimaryButton('Flytta Rövare', '🏴‍☠️', true);
          this.app.startRobberMoveMode();
        } else {
          this.setInstruction(`⏳ ${activeName} flyttar rövaren...`);
          this.setPrimaryButton(`Väntar på ${activeName}`, '⏳', false);
        }
        return;
      }

      // Check robber steal
      if (state.turn_phase === 'ROBBER_STEAL') {
        if (isMyTurn) {
          this.setInstruction('🗡️ Välj vem du vill stjäla ett kort från!');
          this.showStealModal(state.sub_turn_players, state.players);
          this.setPrimaryButton('Stjäl Kort', '🗡️', true);
        } else {
          this.hideStealModal();
          this.setInstruction(`⏳ ${activeName} väljer vem som rånas...`);
          this.setPrimaryButton(`Väntar på ${activeName}`, '⏳', false);
        }
        return;
      } else {
        this.hideStealModal();
      }

      if (isMyTurn) {
        if (myPlayer && myPlayer.free_roads > 0) {
          this.setInstruction(`🛣️ Du har ${myPlayer.free_roads} gratis väg${myPlayer.free_roads > 1 ? 'ar' : ''} att bygga!`);
          this.setPrimaryButton(`Placera Gratis Väg (${myPlayer.free_roads})`, '🛣️', true);
        } else if (state.turn_phase === 'BEFORE_ROLL' || !state.dice_rolled) {
          this.setInstruction('🎲 Det är din tur! Kasta tärningarna.');
          this.setPrimaryButton('Kasta Tärning', '🎲', true);
        } else if (state.turn_phase === 'ACTION') {
          this.setInstruction('⚡ Bygg, handla eller avsluta draget.');
          this.setPrimaryButton('Avsluta Drag', '⏭️', true);
          this.primaryBtn.classList.add('end-turn-mode');
        }
      } else {
        this.setInstruction(`⏳ Det är ${activeName}s tur...`);
        this.setPrimaryButton(`Väntar på ${activeName}`, '⏳', false);
      }
    }

    if (state.status === 'GAME_OVER') {
      const winner = state.players[state.winner_id];
      this.showGameOver(winner, state.players);
    }
  }

  setInstruction(text) {
    if (this.instructionText) this.instructionText.textContent = text;
  }

  setPrimaryButton(label, icon, enabled) {
    this.primaryBtnLabel.textContent = label;
    this.primaryBtnIcon.textContent = icon;
    this.primaryBtn.disabled = !enabled;
  }

  showDiceRoll(d1, d2) {
    if (!this.diceBanner) return;
    this.die1.textContent = d1;
    this.die2.textContent = d2;
    this.diceSumLabel.textContent = `Summa: ${d1 + d2}`;
    this.diceBanner.style.display = 'flex';

    if (window.soundEffects) {
      window.soundEffects.playDiceRoll();
    }

    setTimeout(() => {
      if (this.diceBanner) this.diceBanner.style.display = 'none';
    }, 2800);
  }

  // --- BANK TRADE OPTIONS ---
  renderBankTradeOptions(player) {
    const giveSelect = document.getElementById('bank-give-select');
    const getSelect = document.getElementById('bank-get-select');
    if (!giveSelect || !getSelect) return;

    giveSelect.innerHTML = '';
    getSelect.innerHTML = '';

    const resTypes = [
      { id: 'wood', name: 'Trä 🌲' },
      { id: 'brick', name: 'Tegel 🧱' },
      { id: 'sheep', name: 'Ull 🐑' },
      { id: 'wheat', name: 'Vete 🌾' },
      { id: 'ore', name: 'Malm 🪨' },
    ];

    const myRes = player.resources || {};
    // Calculate best rate for each resource: 2:1, 3:1, or 4:1
    const ports = this.app.boardData ? this._getPlayerPorts(player.id) : [];

    resTypes.forEach(({ id, name }) => {
      let rate = 4;
      if (ports.includes(`${id}_2_1`)) rate = 2;
      else if (ports.includes('generic_3_1')) rate = 3;

      const count = myRes[id] || 0;
      const canGive = count >= rate;

      const pill = document.createElement('div');
      pill.className = `trade-pill ${!canGive ? 'disabled' : ''} ${this.selectedBankGive === id ? 'selected' : ''}`;
      pill.innerHTML = `<span>${name}</span><strong>${rate}:1 (${count} st)</strong>`;

      if (canGive) {
        pill.addEventListener('click', () => {
          this.selectedBankGive = id;
          this.renderBankTradeOptions(player);
          this._checkBankTradeReady();
        });
      }
      giveSelect.appendChild(pill);

      // Target selection
      const getPill = document.createElement('div');
      getPill.className = `trade-pill ${this.selectedBankGet === id ? 'selected' : ''}`;
      getPill.innerHTML = `<span>${name}</span><strong>1x</strong>`;
      getPill.addEventListener('click', () => {
        this.selectedBankGet = id;
        this.renderBankTradeOptions(player);
        this._checkBankTradeReady();
      });
      getSelect.appendChild(getPill);
    });

    this._checkBankTradeReady();
  }

  _getPlayerPorts(playerId) {
    const ports = [];
    if (!this.app.boardData) return ports;
    for (const v of Object.values(this.app.boardData.vertices)) {
      if (v.building && v.building.player_id === playerId && v.port) {
        ports.push(v.port);
      }
    }
    return ports;
  }

  _checkBankTradeReady() {
    const btn = document.getElementById('btn-execute-bank-trade');
    if (btn) {
      const ready = this.selectedBankGive && this.selectedBankGet && (this.selectedBankGive !== this.selectedBankGet);
      btn.disabled = !ready;
    }
  }

  // --- DOMESTIC TRADE STEPPERS ---
  renderDomesticTradeSteppers(player) {
    const offerContainer = document.getElementById('trade-offer-steppers');
    const targetContainer = document.getElementById('trade-target-steppers');
    if (!offerContainer || !targetContainer) return;

    offerContainer.innerHTML = '';
    targetContainer.innerHTML = '';

    const resTypes = [
      { id: 'wood', name: 'Trä 🌲' },
      { id: 'brick', name: 'Tegel 🧱' },
      { id: 'sheep', name: 'Ull 🐑' },
      { id: 'wheat', name: 'Vete 🌾' },
      { id: 'ore', name: 'Malm 🪨' },
    ];

    const myRes = player.resources || {};

    resTypes.forEach(({ id, name }) => {
      // Offer stepper
      const maxCount = myRes[id] || 0;
      const row = document.createElement('div');
      row.className = 'stepper-row';
      row.innerHTML = `
        <span>${name}</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="step-btn" data-type="offer-minus" data-res="${id}">-</button>
          <strong style="min-width:18px;text-align:center;">${this.offerCounts[id]}</strong>
          <button class="step-btn" data-type="offer-plus" data-res="${id}">+</button>
        </div>
      `;
      offerContainer.appendChild(row);

      // Target stepper
      const tRow = document.createElement('div');
      tRow.className = 'stepper-row';
      tRow.innerHTML = `
        <span>${name}</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="step-btn" data-type="target-minus" data-res="${id}">-</button>
          <strong style="min-width:18px;text-align:center;">${this.targetCounts[id]}</strong>
          <button class="step-btn" data-type="target-plus" data-res="${id}">+</button>
        </div>
      `;
      targetContainer.appendChild(tRow);
    });

    // Stepper event binding
    document.querySelectorAll('.step-btn').forEach((b) => {
      b.addEventListener('click', (e) => {
        const type = e.currentTarget.getAttribute('data-type');
        const res = e.currentTarget.getAttribute('data-res');
        const max = myRes[res] || 0;

        if (type === 'offer-plus' && this.offerCounts[res] < max) this.offerCounts[res]++;
        if (type === 'offer-minus' && this.offerCounts[res] > 0) this.offerCounts[res]--;
        if (type === 'target-plus' && this.targetCounts[res] < 5) this.targetCounts[res]++;
        if (type === 'target-minus' && this.targetCounts[res] > 0) this.targetCounts[res]--;

        this.renderDomesticTradeSteppers(player);
      });
    });
  }

  // --- DEV CARDS SHEET ---
  renderDevCardsSheet(player) {
    const list = document.getElementById('dev-cards-list');
    if (!list) return;
    list.innerHTML = '';

    const playableCards = player.dev_cards || [];
    const newCards = player.dev_cards_bought_this_turn || [];

    if (playableCards.length === 0 && newCards.length === 0) {
      list.innerHTML = '<p class="text-muted">Du har inga utvecklingskort på hand.</p>';
      return;
    }

    const cardNames = {
      knight: { name: 'Riddare ⚔️', desc: 'Flytta rövaren och stjäl 1 kort från en intilliggande spelare.' },
      victory_point: { name: 'Segerpoäng 🏆', desc: 'Ger 1 permanent hemlig segerpoäng (räknas automatiskt).' },
      road_building: { name: 'Vägbygge 🛣️', desc: 'Bygg 2 gratis vägar direkt.' },
      year_of_plenty: { name: 'Överflöd ✨', desc: 'Välj 2 valfria resurskort från banken.' },
      monopoly: { name: 'Monopol 💰', desc: 'Nämn en resurs. Alla andra spelare måste ge dig alla sina kort av den typen!' }
    };

    const hasPlayedThisTurn = player.has_played_dev_this_turn;

    // 1. Playable cards (bought in earlier turns)
    playableCards.forEach((c) => {
      const info = cardNames[c] || { name: c, desc: '' };
      const cardEl = document.createElement('div');
      cardEl.className = 'build-card';
      
      let actionBtn = '';
      if (c === 'victory_point') {
        actionBtn = '<span style="font-size:0.75rem;color:var(--accent-gold);font-weight:700;">Aktiv (+1 VP)</span>';
      } else if (hasPlayedThisTurn) {
        actionBtn = '<button class="btn btn-sm btn-disabled" disabled style="opacity:0.6;font-size:0.75rem;">Redan spelat kort</button>';
      } else {
        actionBtn = `<button class="btn btn-sm btn-primary play-dev-btn" data-card="${c}">Spela</button>`;
      }

      cardEl.innerHTML = `
        <div>
          <strong>${info.name}</strong>
          <p style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${info.desc}</p>
        </div>
        ${actionBtn}
      `;
      list.appendChild(cardEl);
    });

    // 2. Newly bought cards (cannot be played in the same turn)
    newCards.forEach((c) => {
      const info = cardNames[c] || { name: c, desc: '' };
      const cardEl = document.createElement('div');
      cardEl.className = 'build-card';
      cardEl.style.opacity = '0.8';
      cardEl.style.border = '1px dashed rgba(245, 158, 11, 0.45)';

      let actionText = '';
      if (c === 'victory_point') {
        actionText = '<span style="font-size:0.75rem;color:var(--accent-gold);font-weight:700;">Aktiv (+1 VP)</span>';
      } else {
        actionText = '<span style="font-size:0.75rem;color:var(--accent-gold);font-weight:600;display:block;line-height:1.2;">🔒 Köpt denna runda<br><small style="color:var(--text-muted);font-weight:400;">Kan spelas nästa runda</small></span>';
      }

      cardEl.innerHTML = `
        <div>
          <strong>${info.name}</strong>
          <p style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${info.desc}</p>
        </div>
        <div style="text-align:right;">
          ${actionText}
        </div>
      `;
      list.appendChild(cardEl);
    });

    list.querySelectorAll('.play-dev-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const card = e.currentTarget.getAttribute('data-card');
        this.closeAllSheets();
        this.app.playDevCard(card);
      });
    });
  }

  // --- ROBBER DISCARD MODAL ---
  showDiscardModal(player) {
    if (!this.discardModal) return;
    this.discardModal.style.display = 'flex';
    const needed = player.pending_discard_count || 0;
    document.getElementById('discard-needed-count').textContent = needed;
    document.getElementById('discard-target-count').textContent = needed;

    const steppers = document.getElementById('discard-steppers');
    steppers.innerHTML = '';
    const discards = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };

    const updateCounts = () => {
      const selected = Object.values(discards).reduce((a, b) => a + b, 0);
      document.getElementById('discard-selected-count').textContent = selected;
      const btn = document.getElementById('btn-confirm-discard');
      btn.disabled = (selected !== needed);
    };

    const resTypes = [
      { id: 'wood', name: 'Trä 🌲' },
      { id: 'brick', name: 'Tegel 🧱' },
      { id: 'sheep', name: 'Ull 🐑' },
      { id: 'wheat', name: 'Vete 🌾' },
      { id: 'ore', name: 'Malm 🪨' },
    ];

    resTypes.forEach(({ id, name }) => {
      const maxCount = player.resources[id] || 0;
      const row = document.createElement('div');
      row.className = 'stepper-row';
      row.innerHTML = `
        <span>${name} (${maxCount} st)</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="step-btn disc-minus" data-res="${id}">-</button>
          <strong id="disc-val-${id}" style="min-width:18px;text-align:center;">0</strong>
          <button class="step-btn disc-plus" data-res="${id}">+</button>
        </div>
      `;
      steppers.appendChild(row);
    });

    steppers.querySelectorAll('.disc-plus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const r = e.currentTarget.getAttribute('data-res');
        const max = player.resources[r] || 0;
        const currentSum = Object.values(discards).reduce((a, b) => a + b, 0);
        if (discards[r] < max && currentSum < needed) {
          discards[r]++;
          document.getElementById(`disc-val-${r}`).textContent = discards[r];
          updateCounts();
        }
      });
    });

    steppers.querySelectorAll('.disc-minus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const r = e.currentTarget.getAttribute('data-res');
        if (discards[r] > 0) {
          discards[r]--;
          document.getElementById(`disc-val-${r}`).textContent = discards[r];
          updateCounts();
        }
      });
    });

    document.getElementById('btn-confirm-discard').onclick = () => {
      this.app.sendAction('discard_cards', { discards });
      this.discardModal.style.display = 'none';
    };

    updateCounts();
  }

  hideDiscardModal() {
    if (this.discardModal) this.discardModal.style.display = 'none';
  }

  // --- ROBBER STEAL MODAL ---
  showStealModal(victimIds, allPlayers) {
    if (!this.stealModal) return;
    this.stealModal.style.display = 'flex';
    const list = document.getElementById('steal-players-list');
    list.innerHTML = '';

    victimIds.forEach((vid) => {
      const p = allPlayers[vid];
      if (!p) return;

      const row = document.createElement('div');
      row.className = 'steal-player-row';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="color-dot" style="background:${p.color}"></div>
          <strong>${p.name}</strong>
        </div>
        <span>${p.resources_count} kort</span>
      `;
      row.addEventListener('click', () => {
        this.app.sendAction('steal_resource', { victim_id: vid });
        this.stealModal.style.display = 'none';
      });
      list.appendChild(row);
    });
  }

  hideStealModal() {
    if (this.stealModal) this.stealModal.style.display = 'none';
  }

  // --- GAME OVER MODAL ---
  showGameOver(winner, allPlayers) {
    if (!this.gameOverModal) return;
    this.gameOverModal.style.display = 'flex';
    document.getElementById('winner-name-title').textContent = `${winner.name} VANN!`;
    document.getElementById('winner-desc-text').textContent = `Grattis! ${winner.name} nådde ${winner.total_vp} segerpoäng.`;

    const scoresList = document.getElementById('final-scores-list');
    scoresList.innerHTML = '';
    const sorted = [...allPlayers].sort((a, b) => b.total_vp - a.total_vp);

    sorted.forEach((p, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.1);';
      row.innerHTML = `<span>#${idx + 1} ${p.name}</span><strong>${p.total_vp} VP</strong>`;
      scoresList.appendChild(row);
    });
  }

  // --- LOG FEED ---
  renderLog(logs) {
    const feed = document.getElementById('game-log-feed');
    if (!feed || !logs) return;
    feed.innerHTML = '';
    logs.forEach(item => {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.textContent = item.text;
      feed.appendChild(entry);
    });
    feed.scrollTop = feed.scrollHeight;
  }
}

window.UIController = UIController;
