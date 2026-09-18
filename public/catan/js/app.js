/**
 * Main Application: Katan 8-Player WebRTC Mobile Controller
 */

class CatanApp {
  constructor() {
    this.roomId = null;
    this.playerId = null;
    this.gameState = null;
    this.boardData = null;

    // View elements
    this.lobbyView = document.getElementById('lobby-view');
    this.gameView = document.getElementById('game-view');
    this.lobbyJoinForm = document.getElementById('lobby-join-form');
    this.lobbyRoom = document.getElementById('lobby-room');

    // Modules
    this.touchControls = new TouchControls('board-container', 'board-root');
    this.boardRenderer = new BoardRenderer('catan-board-svg');
    this.network = new NetworkPeer(this);
    this.ui = new UIController(this);

    this.lastTurnIdx = null;
    this.lastDiceRolled = false;

    this.init();
  }

  init() {
    this._bindLobbyEvents();
    this._checkUrlRoomCode();
  }

  _bindLobbyEvents() {
    const tabCreate = document.getElementById('tab-mode-create');
    const tabJoin = document.getElementById('tab-mode-join');
    const createPane = document.getElementById('create-room-pane');
    const joinPane = document.getElementById('join-room-pane');

    const btnCreateRoom = document.getElementById('btn-create-room');
    const btnJoinRoom = document.getElementById('btn-join-room');
    const randomBtn = document.getElementById('random-room-btn');
    const addBotBtn = document.getElementById('add-bot-btn');
    const startBtn = document.getElementById('start-game-btn');
    const copyLinkBtn = document.getElementById('copy-link-btn');

    // Switch between Create and Join tabs
    tabCreate.addEventListener('click', () => {
      tabCreate.classList.add('active');
      tabJoin.classList.remove('active');
      createPane.style.display = 'block';
      joinPane.style.display = 'none';
    });

    tabJoin.addEventListener('click', () => {
      tabJoin.classList.add('active');
      tabCreate.classList.remove('active');
      createPane.style.display = 'none';
      joinPane.style.display = 'block';
      const joinInput = document.getElementById('join-room-code');
      if (joinInput) joinInput.focus();
    });

    // Random room code generator
    randomBtn.addEventListener('click', () => {
      const code = 'KATA' + Math.floor(10 + Math.random() * 90);
      document.getElementById('create-room-code').value = code;
    });

    // Create Room action
    btnCreateRoom.addEventListener('click', () => {
      const name = document.getElementById('create-player-name').value.trim() || 'Spelare 1';
      const room = document.getElementById('create-room-code').value.trim().toUpperCase() || 'KATA8';
      const maxPlayers = parseInt(document.getElementById('max-players-select').value) || 8;
      const targetVP = parseInt(document.getElementById('target-vp-select').value) || 10;

      this.roomId = room;
      this.network.createOnlineRoom(room, name, maxPlayers, targetVP);
    });

    // Join Room action
    btnJoinRoom.addEventListener('click', () => {
      const name = document.getElementById('join-player-name').value.trim() || 'Spelare';
      const room = document.getElementById('join-room-code').value.trim().toUpperCase();

      if (!room) {
        alert('Vänligen ange en rumskod.');
        return;
      }

      this.roomId = room;
      this.network.joinOnlineRoom(room, name);
    });

    // Waiting room actions
    addBotBtn.addEventListener('click', () => {
      this.network.addBot();
    });

    startBtn.addEventListener('click', () => {
      this.network.startHostGame();
    });

    copyLinkBtn.addEventListener('click', () => {
      const url = `${window.location.origin}${window.location.pathname}?room=${this.roomId}`;
      navigator.clipboard.writeText(url).then(() => {
        copyLinkBtn.textContent = '✅ Länk kopierad!';
        setTimeout(() => copyLinkBtn.textContent = '📋 Kopiera Länk', 2000);
      });
    });
  }

  _checkUrlRoomCode() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      // Auto-switch to join tab
      const tabJoin = document.getElementById('tab-mode-join');
      const tabCreate = document.getElementById('tab-mode-create');
      const createPane = document.getElementById('create-room-pane');
      const joinPane = document.getElementById('join-room-pane');
      const joinInput = document.getElementById('join-room-code');

      if (tabJoin && joinInput) {
        tabJoin.classList.add('active');
        if (tabCreate) tabCreate.classList.remove('active');
        if (createPane) createPane.style.display = 'none';
        if (joinPane) joinPane.style.display = 'block';
        joinInput.value = room.toUpperCase();
      }
    }
  }

  sendAction(action, extra = {}) {
    this.network.handleAction(action, extra);
  }

  sendChat(text) {
    this.network.sendChat(text);
  }

  onStateUpdated() {
    const s = this.gameState;
    if (!s) return;

    if (s.status === 'LOBBY') {
      this.showLobbyWaitingRoom(s);
      return;
    }

    // Switch to game view
    this.lobbyView.classList.remove('active');
    this.gameView.classList.add('active');

    // Trigger board render
    this.boardRenderer.render(s.board, s.players);

    // Audio & Turn check
    if (this.lastTurnIdx !== s.current_turn_idx) {
      this.lastTurnIdx = s.current_turn_idx;
      if (s.current_turn_idx === this.playerId && window.soundEffects) {
        window.soundEffects.playTurnChime();
      }
    }

    // Check dice roll
    if (s.dice_rolled && !this.lastDiceRolled) {
      this.ui.showDiceRoll(s.dice[0], s.dice[1]);
    }
    this.lastDiceRolled = s.dice_rolled;

    // Update UI components
    this.ui.renderPlayers(s.players, s.current_turn_idx, s.longest_road_player_id, s.largest_army_player_id);
    const myPlayer = s.players[this.playerId];
    this.ui.renderResources(myPlayer);
    this.ui.updateTurnState(s, this.playerId);
    this.ui.renderLog(s.log);

    // Auto-prompt interactive placement if it's my turn
    if (s.current_turn_idx === this.playerId) {
      if (s.status === 'SETUP_1' || s.status === 'SETUP_2') {
        if (s.turn_phase === 'SETUP_SETTLEMENT') {
          this.startSetupSettlementPlacement();
        } else if (s.turn_phase === 'SETUP_ROAD') {
          this.startSetupRoadPlacement();
        }
      }
    }
  }

  showLobbyWaitingRoom(state) {
    this.lobbyJoinForm.style.display = 'none';
    this.lobbyRoom.style.display = 'flex';
    document.getElementById('active-room-id').textContent = state.room_id;
    const hint = document.getElementById('hint-room-code');
    if (hint) hint.textContent = state.room_id;

    document.getElementById('player-count').textContent = state.players.length;
    document.getElementById('player-max').textContent = state.max_players;

    const grid = document.getElementById('lobby-players-grid');
    grid.innerHTML = '';

    state.players.forEach((p) => {
      const slot = document.createElement('div');
      slot.className = 'player-slot';
      const isYou = (p.id === this.playerId);

      slot.innerHTML = `
        <div class="slot-left">
          <div class="color-dot" style="background-color:${p.color}"></div>
          <span class="slot-name">${p.name}</span>
        </div>
        <div>
          <span class="slot-badge ${isYou ? 'you' : ''}">${isYou ? 'Du' : (p.is_bot ? 'Bot' : 'Spelare')}</span>
          ${(p.is_bot && this.playerId === 0) ? `<button class="slot-remove-btn" data-id="${p.id}">✕</button>` : ''}
        </div>
      `;
      grid.appendChild(slot);
    });

    grid.querySelectorAll('.slot-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = parseInt(e.currentTarget.getAttribute('data-id'));
        this.network.removePlayer(targetId);
      });
    });

    const startBtn = document.getElementById('start-game-btn');
    startBtn.disabled = (state.players.length < 2 || this.playerId !== 0);
    if (this.playerId !== 0) {
      startBtn.textContent = 'Väntar på att rummets skapare ska starta...';
    } else {
      startBtn.textContent = 'Starta Spel Nu 🎮';
    }
  }

  // --- ACTIONS ---
  handlePrimaryAction() {
    const s = this.gameState;
    if (!s || s.current_turn_idx !== this.playerId) return;

    if (s.status === 'SETUP_1' || s.status === 'SETUP_2') {
      if (s.turn_phase === 'SETUP_SETTLEMENT') {
        this.startSetupSettlementPlacement();
      } else if (s.turn_phase === 'SETUP_ROAD') {
        this.startSetupRoadPlacement();
      }
    } else if (s.status === 'MAIN_GAME') {
      const myPlayer = s.players[this.playerId];
      if (myPlayer && myPlayer.free_roads > 0) {
        this.startBuildItem('road');
      } else if (s.turn_phase === 'BEFORE_ROLL' || !s.dice_rolled) {
        this.sendAction('roll_dice');
      } else if (s.turn_phase === 'ACTION') {
        this.sendAction('end_turn');
      }
    }
  }

  startSetupSettlementPlacement() {
    if (!this.boardData) return;
    const validVertices = [];
    for (const [vid, v] of Object.entries(this.boardData.vertices)) {
      if (v.building === null) {
        const canPlace = v.adjacent_vertices.every(
          adjId => this.boardData.vertices[adjId].building === null
        );
        if (canPlace) validVertices.push(vid);
      }
    }

    this.boardRenderer.showVertexTargets(validVertices, this.boardData.vertices, (selectedVid) => {
      this.sendAction('place_setup_settlement', { vertex_id: selectedVid });
    });
  }

  startSetupRoadPlacement() {
    if (!this.boardData) return;
    let mySettlementVid = null;
    for (const [vid, v] of Object.entries(this.boardData.vertices)) {
      if (v.building && v.building.player_id === this.playerId) {
        const hasRoad = v.edges.some(eid => this.boardData.edges[eid].road !== null);
        if (!hasRoad) {
          mySettlementVid = vid;
          break;
        }
      }
    }

    if (!mySettlementVid) {
      for (const [vid, v] of Object.entries(this.boardData.vertices)) {
        if (v.building && v.building.player_id === this.playerId) {
          mySettlementVid = vid;
          break;
        }
      }
    }

    if (mySettlementVid) {
      const validEdges = this.boardData.vertices[mySettlementVid].edges.filter(
        eid => this.boardData.edges[eid].road === null
      );
      this.boardRenderer.showEdgeTargets(validEdges, this.boardData.edges, this.boardData.vertices, (selectedEid) => {
        this.sendAction('place_setup_road', { edge_id: selectedEid });
      });
    }
  }

  startBuildMode(itemType) {
    if (!this.boardData || !this.gameState) return;
    const pid = this.playerId;

    if (itemType === 'settlement') {
      const validVertices = [];
      for (const [vid, v] of Object.entries(this.boardData.vertices)) {
        if (v.building === null) {
          const distanceRule = v.adjacent_vertices.every(
            adj => this.boardData.vertices[adj].building === null
          );
          if (distanceRule) {
            const hasRoad = v.edges.some(
              eid => this.boardData.edges[eid].road && this.boardData.edges[eid].road.player_id === pid
            );
            if (hasRoad) validVertices.push(vid);
          }
        }
      }

      if (validVertices.length === 0) {
        alert('Inga giltiga platser att bygga en by på. Du måste ansluta till dina egna vägar.');
        return;
      }

      this.ui.setInstruction('🏠 Tryck på en vit punkt för att bygga en by!');
      this.boardRenderer.showVertexTargets(validVertices, this.boardData.vertices, (vid) => {
        this.sendAction('build_settlement', { vertex_id: vid });
      });

    } else if (itemType === 'city') {
      const validVertices = [];
      for (const [vid, v] of Object.entries(this.boardData.vertices)) {
        if (v.building && v.building.type === 'settlement' && v.building.player_id === pid) {
          validVertices.push(vid);
        }
      }

      if (validVertices.length === 0) {
        alert('Du har inga byar att uppgradera till stad.');
        return;
      }

      this.ui.setInstruction('🏰 Tryck på en av dina byar för att uppgradera till stad!');
      this.boardRenderer.showVertexTargets(validVertices, this.boardData.vertices, (vid) => {
        this.sendAction('build_city', { vertex_id: vid });
      });

    } else if (itemType === 'road') {
      const validEdges = [];
      for (const [eid, ed] of Object.entries(this.boardData.edges)) {
        if (ed.road === null) {
          let canConnect = false;
          for (const vid of [ed.v1, ed.v2]) {
            const vdata = this.boardData.vertices[vid];
            if (vdata.building && vdata.building.player_id === pid) {
              canConnect = true;
              break;
            }
            const enemyBldg = vdata.building && vdata.building.player_id !== pid;
            if (!enemyBldg) {
              for (const adjEid of vdata.edges) {
                if (adjEid !== eid && this.boardData.edges[adjEid].road && this.boardData.edges[adjEid].road.player_id === pid) {
                  canConnect = true;
                  break;
                }
              }
            }
            if (canConnect) break;
          }
          if (canConnect) validEdges.push(eid);
        }
      }

      if (validEdges.length === 0) {
        alert('Inga giltiga platser att bygga väg på.');
        return;
      }

      this.ui.setInstruction('🛤️ Tryck på en vägmarkering för att bygga!');
      this.boardRenderer.showEdgeTargets(validEdges, this.boardData.edges, this.boardData.vertices, (eid) => {
        this.sendAction('build_road', { edge_id: eid });
      });
    }
  }

  startRobberMoveMode() {
    if (!this.boardData) return;
    const validHexes = Object.keys(this.boardData.hexes).filter(
      hid => hid !== this.boardData.robber_hex_id
    );

    this.boardRenderer.showHexTargets(validHexes, this.boardData.hexes, (selectedHid) => {
      this.sendAction('move_robber', { hex_id: selectedHid });
    });
  }

  playDevCard(cardType) {
    if (cardType === 'year_of_plenty') {
      const r1 = prompt('Välj första resurs (wood, brick, sheep, wheat, ore):', 'ore');
      if (!r1) return;
      const r2 = prompt('Välj andra resurs (wood, brick, sheep, wheat, ore):', 'wheat');
      if (!r2) return;
      this.sendAction('play_dev_card', {
        card_type: 'year_of_plenty',
        extra_data: { res1: r1.trim().toLowerCase(), res2: r2.trim().toLowerCase() }
      });
    } else if (cardType === 'monopoly') {
      const r = prompt('Välj resurs att ta monopol på (wood, brick, sheep, wheat, ore):', 'ore');
      if (!r) return;
      this.sendAction('play_dev_card', {
        card_type: 'monopoly',
        extra_data: { resource: r.trim().toLowerCase() }
      });
    } else if (cardType === 'road_building') {
      this.sendAction('play_dev_card', { card_type: 'road_building' });
      setTimeout(() => {
        this.startBuildItem('road');
      }, 300);
    } else {
      this.sendAction('play_dev_card', { card_type: cardType });
    }
  }
}

// Start app when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new CatanApp();
});
