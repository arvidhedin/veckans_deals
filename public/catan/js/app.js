/**
 * Main Application: Katan 8-Player Real-Time Controller
 */

class CatanApp {
  constructor() {
    this.ws = null;
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

    this.useLocalPeer = false;
    this.lastTurnIdx = null;
    this.lastDiceRolled = false;

    this.init();
  }

  init() {
    this._bindLobbyEvents();
    this._checkUrlRoomCode();
    this._fetchServerInfo();
  }

  _bindLobbyEvents() {
    const joinBtn = document.getElementById('join-btn');
    const randomBtn = document.getElementById('random-room-btn');
    const addBotBtn = document.getElementById('add-bot-btn');
    const startBtn = document.getElementById('start-game-btn');
    const copyLinkBtn = document.getElementById('copy-link-btn');

    const tabOnline = document.getElementById('tab-mode-online');
    const tabPass = document.getElementById('tab-mode-pass');
    const onlineFields = document.getElementById('online-fields');
    const passFields = document.getElementById('pass-fields');
    const joinBtnText = document.getElementById('join-btn-text');

    this.currentLobbyMode = 'online';

    tabOnline.addEventListener('click', () => {
      this.currentLobbyMode = 'online';
      tabOnline.classList.add('active');
      tabPass.classList.remove('active');
      onlineFields.style.display = 'block';
      passFields.style.display = 'none';
      joinBtnText.textContent = 'Skapa / Gå med i Rum 🚀';
    });

    tabPass.addEventListener('click', () => {
      this.currentLobbyMode = 'pass';
      tabPass.classList.add('active');
      tabOnline.classList.remove('active');
      onlineFields.style.display = 'none';
      passFields.style.display = 'block';
      joinBtnText.textContent = 'Starta Pass & Play Direkt 🎮';
    });

    randomBtn.addEventListener('click', () => {
      const code = 'CATAN' + Math.floor(10 + Math.random() * 90);
      document.getElementById('room-code-input').value = code;
    });

    joinBtn.addEventListener('click', () => {
      const maxPlayers = parseInt(document.getElementById('max-players-select').value) || 8;
      const targetVP = parseInt(document.getElementById('target-vp-select').value) || 10;

      if (this.currentLobbyMode === 'pass') {
        const room = 'PNP-' + Math.floor(100 + Math.random() * 900);
        this.startPassAndPlay(room, maxPlayers, targetVP);
      } else {
        const name = document.getElementById('player-name-input').value.trim() || 'Spelare 1';
        const room = document.getElementById('room-code-input').value.trim().toUpperCase() || 'CATAN8';
        this.joinRoom(room, name, maxPlayers, targetVP);
      }
    });

    addBotBtn.addEventListener('click', () => {
      if (this.useLocalPeer) {
        this.network.addBot();
      } else {
        this.send({ type: 'add_bot' });
      }
    });

    startBtn.addEventListener('click', () => {
      if (this.useLocalPeer) {
        this.network.startHostGame();
      } else {
        this.send({ type: 'start_game' });
      }
    });

    copyLinkBtn.addEventListener('click', () => {
      const url = window.location.origin + window.location.pathname + `?room=${this.roomId}`;
      navigator.clipboard.writeText(url).then(() => {
        copyLinkBtn.textContent = '✅ Länk kopierad!';
        setTimeout(() => copyLinkBtn.textContent = '📋 Kopiera Inbjudningslänk', 2000);
      });
    });
  }

  startPassAndPlay(roomId, numPlayers, targetVP) {
    this.roomId = roomId;
    this.useLocalPeer = true;
    this.network.startPassAndPlay(roomId, numPlayers, targetVP);
  }

  _checkUrlRoomCode() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      document.getElementById('room-code-input').value = room.toUpperCase();
      this.isGuestJoin = true;
      const btnText = document.getElementById('join-btn-text');
      if (btnText) btnText.textContent = `Anslut till Rum ${room.toUpperCase()} 🚀`;
    }
  }

  _fetchServerInfo() {
    const banner = document.getElementById('mobile-ip-banner');
    const link = document.getElementById('mobile-join-url');
    if (!banner || !link) return;

    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      banner.style.display = 'block';
      link.textContent = `${window.location.origin}${window.location.pathname}?room=${this.roomId || 'CATAN8'}`;
    } else {
      fetch('/api/info')
        .then(res => res.json())
        .then(info => {
          if (info.local_ip) {
            banner.style.display = 'block';
            link.textContent = `http://${info.local_ip}:${info.port}/?room=${this.roomId || 'CATAN8'}`;
          }
        })
        .catch(() => {});
    }
  }

  connectWS(callback) {
    const isStaticDeploy = !['localhost', '127.0.0.1'].includes(window.location.hostname) && !window.location.hostname.includes('lhr.life');
    if (isStaticDeploy) {
      // Cloudflare Pages / Static deployment -> use WebRTC peer
      this.useLocalPeer = true;
      if (callback) callback();
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (callback) callback();
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('Connected to Catan server');
      if (callback) callback();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleServerMessage(data);
      } catch (err) {
        console.error('Error handling message:', err);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket closed, attempting reconnect...');
      setTimeout(() => this.connectWS(), 2000);
    };
  }

  send(msgObj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msgObj));
    }
  }

  sendAction(action, extra = {}) {
    if (this.useLocalPeer) {
      this.network.handleAction(action, extra);
    } else {
      this.send({
        type: 'game_action',
        action: action,
        ...extra
      });
    }
  }

  sendChat(text) {
    if (this.useLocalPeer) {
      this.network.sendChat(text);
    } else {
      this.send({
        type: 'chat',
        text: text
      });
    }
  }

  joinRoom(roomId, playerName, maxPlayers = 8, targetVP = 10) {
    this.roomId = roomId;

    const isStaticDeploy = !['localhost', '127.0.0.1'].includes(window.location.hostname) && !window.location.hostname.includes('lhr.life');
    if (isStaticDeploy) {
      this.useLocalPeer = true;
      if (this.isGuestJoin) {
        this.network.joinOnlineRoom(roomId, playerName);
      } else {
        this.network.createOnlineRoom(roomId, playerName, maxPlayers, targetVP);
      }
      return;
    }

    this.connectWS(() => {
      this.send({
        type: 'join_room',
        room_id: roomId,
        player_name: playerName,
        max_players: maxPlayers,
        target_vp: targetVP
      });
    });
  }

  handleServerMessage(msg) {
    if (msg.type === 'state_update') {
      this.playerId = msg.your_player_id;
      this.gameState = msg.state;
      this.boardData = msg.state.board;
      this.onStateUpdated();
    } else if (msg.type === 'error') {
      alert(msg.message);
    }
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
        this.send({ type: 'remove_player', player_id: targetId });
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
      if (s.turn_phase === 'BEFORE_ROLL' || !s.dice_rolled) {
        this.sendAction('roll_dice');
      } else if (s.turn_phase === 'ACTION') {
        this.sendAction('end_turn');
      }
    }
  }

  startSetupSettlementPlacement() {
    if (!this.boardData) return;
    // Find all valid vertices (empty + distance rule satisfied)
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
    // Edges connected to the newly placed settlement
    const myPlayer = this.gameState.players[this.playerId];
    // Find player's most recent settlement
    let mySettlementVid = null;
    for (const [vid, v] of Object.entries(this.boardData.vertices)) {
      if (v.building && v.building.player_id === this.playerId) {
        // Find if this vertex has roads yet
        const hasRoad = v.edges.some(eid => this.boardData.edges[eid].road !== null);
        if (!hasRoad) {
          mySettlementVid = vid;
          break;
        }
      }
    }

    if (!mySettlementVid) {
      // Fallback to any vertex with settlement
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
      // Must be empty, satisfy distance rule, and connect to player's road
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

      this.ui.setInstruction('🏠 Tryck på en blinkande punkt för att bygga en by!');
      this.boardRenderer.showVertexTargets(validVertices, this.boardData.vertices, (vid) => {
        this.sendAction('build_settlement', { vertex_id: vid });
      });

    } else if (itemType === 'city') {
      // Must upgrade existing settlement owned by player
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
      // Must connect to player's road, settlement, or city
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
            // Or connected road without enemy building blocking
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
      const r2 = prompt('Välj andra resurs (wood, brick, sheep, wheat, ore):', 'wheat');
      this.sendAction('play_dev_card', {
        card_type: 'year_of_plenty',
        extra_data: { res1: r1, res2: r2 }
      });
    } else if (cardType === 'monopoly') {
      const r = prompt('Välj resurs att ta monopol på (wood, brick, sheep, wheat, ore):', 'ore');
      this.sendAction('play_dev_card', {
        card_type: 'monopoly',
        extra_data: { resource: r }
      });
    } else {
      this.sendAction('play_dev_card', { card_type: cardType });
    }
  }
}

// Start app when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new CatanApp();
});
