/**
 * NetworkPeer: WebRTC Real-Time Multiplayer Engine for Catan
 * Uses PeerJS with public STUN servers for seamless mobile-to-mobile connections.
 * Includes URL-based room linking, session persistence, and seamless reconnect on page refresh.
 */

class NetworkPeer {
  constructor(app) {
    this.app = app;
    this.mode = 'webrtc_host'; // 'webrtc_host' or 'webrtc_guest'
    this.peer = null;
    this.localGame = null;
    this.connections = {}; // pid -> DataConnection (if host)
    this.hostConn = null;  // DataConnection to host (if guest)
    this.myPlayerId = 0;
    this.roomId = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectTimer = null;

    this._bindWindowEvents();
  }

  _getPeerConfig() {
    return {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          { urls: 'stun:stun.cloudflare.com:3478' }
        ]
      }
    };
  }

  _cleanCode(code) {
    return (code || 'KATA8').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  _getOrCreateToken() {
    let token = sessionStorage.getItem('catan_player_token');
    if (!token) {
      token = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8);
      sessionStorage.setItem('catan_player_token', token);
    }
    return token;
  }

  _updateBrowserUrl(roomId) {
    if (!roomId) return;
    const clean = this._cleanCode(roomId).toUpperCase();
    const url = new URL(window.location.href);
    url.searchParams.set('room', clean);
    window.history.replaceState({ room: clean }, '', url.toString());
  }

  _clearBrowserUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.pathname);
  }

  _bindWindowEvents() {
    // Free up PeerJS ID on signaling server when closing tab
    window.addEventListener('beforeunload', () => {
      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
      }
    });
    window.addEventListener('pagehide', () => {
      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
      }
    });
  }

  // --- WEBRTC ROOM HOSTING ---
  createOnlineRoom(roomId, playerName, maxPlayers = 8, targetVP = 10) {
    this.mode = 'webrtc_host';
    this.roomId = roomId.toUpperCase();
    this.myPlayerId = 0;
    this.connections = {};

    const token = this._getOrCreateToken();
    sessionStorage.setItem('catan_active_room', this.roomId);
    sessionStorage.setItem('catan_role', 'webrtc_host');
    sessionStorage.setItem('catan_player_name', playerName);
    sessionStorage.setItem('catan_my_pid', '0');
    sessionStorage.setItem('catan_max_players', maxPlayers);
    sessionStorage.setItem('catan_target_vp', targetVP);

    this._updateBrowserUrl(this.roomId);

    const boardType = maxPlayers <= 4 ? 'standard' : (maxPlayers <= 6 ? 'extended' : 'mega');
    this.localGame = new ClientGameState(this.roomId, maxPlayers, boardType, targetVP);
    this.localGame.is_pass_and_play = false;
    const p0 = this.localGame.addPlayer(playerName, false);
    if (this.localGame.players[p0]) {
      this.localGame.players[p0].token = token;
    }

    this._saveHostState();

    const cleanCode = this._cleanCode(this.roomId);
    const peerId = `catan8_${cleanCode}`;
    this._initHostPeer(peerId);
  }

  resumeHostRoom(roomId, playerName) {
    this.mode = 'webrtc_host';
    this.roomId = roomId.toUpperCase();
    this.myPlayerId = 0;
    this.connections = {};

    this._updateBrowserUrl(this.roomId);

    // Try restoring saved game snapshot
    const savedStateStr = sessionStorage.getItem(`catan_host_state_${this.roomId}`);
    if (savedStateStr) {
      try {
        const savedState = JSON.parse(savedStateStr);
        this.localGame = ClientGameState.fromFullDict(savedState);
        console.log('Restored host game state successfully from sessionStorage!');
      } catch (e) {
        console.warn('Failed to parse saved host game state:', e);
      }
    }

    // Fallback if no valid state
    if (!this.localGame) {
      const maxPlayers = parseInt(sessionStorage.getItem('catan_max_players')) || 8;
      const targetVP = parseInt(sessionStorage.getItem('catan_target_vp')) || 10;
      const boardType = maxPlayers <= 4 ? 'standard' : (maxPlayers <= 6 ? 'extended' : 'mega');
      this.localGame = new ClientGameState(this.roomId, maxPlayers, boardType, targetVP);
      this.localGame.is_pass_and_play = false;
      const p0 = this.localGame.addPlayer(playerName, false);
      if (this.localGame.players[p0]) {
        this.localGame.players[p0].token = this._getOrCreateToken();
      }
    }

    this._saveHostState();

    // Render immediately on host resume so no blank screen during re-binding
    this._broadcastLocalState();

    const cleanCode = this._cleanCode(this.roomId);
    const peerId = `catan8_${cleanCode}`;
    this._initHostPeer(peerId);
  }

  _saveHostState() {
    if (this.mode === 'webrtc_host' && this.localGame && this.roomId) {
      try {
        sessionStorage.setItem(`catan_host_state_${this.roomId}`, JSON.stringify(this.localGame.toFullDict()));
      } catch (e) {
        console.warn('Could not save host state to sessionStorage:', e);
      }
    }
  }

  _initHostPeer(peerId) {
    if (typeof Peer === 'undefined') {
      alert('Kunde inte ladda PeerJS. Kontrollera att du är ansluten till internet.');
      return;
    }

    // Clean up previous peer if any
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
    }

    try {
      this.peer = new Peer(peerId, this._getPeerConfig());

      this.peer.on('open', (id) => {
        console.log('Host ready with Peer ID:', id);
        this._broadcastLocalState();
      });

      this.peer.on('connection', (conn) => {
        console.log('Incoming connection from guest:', conn.peer);
        conn.on('open', () => {
          conn.on('data', (data) => {
            this._handleHostMessage(conn, data);
          });
        });

        conn.on('close', () => {
          for (const [pid, c] of Object.entries(this.connections)) {
            if (c === conn) {
              console.log('Guest peer disconnected:', pid);
              if (this.localGame && this.localGame.players[pid]) {
                this.localGame.players[pid].connected = false;
              }
              delete this.connections[pid];
              this._broadcastLocalState();
              break;
            }
          }
        });
      });

      this.peer.on('error', (err) => {
        console.error('Host peer error:', err);
        if (err.type === 'unavailable-id') {
          // If unavailable-id occurs during a reload, wait 1.2s and retry
          setTimeout(() => {
            if (this.mode === 'webrtc_host') {
              console.log('Retrying host peer binding...');
              try { if (this.peer) this.peer.destroy(); } catch (e) {}
              this._initHostPeer(peerId);
            }
          }, 1200);
        }
      });
    } catch (e) {
      console.error('Error starting host peer:', e);
    }
  }

  _handleHostMessage(conn, data) {
    if (!this.localGame) return;

    if (data.type === 'join_room' || data.type === 'reconnect') {
      const token = data.token;
      const requestedPid = data.player_id !== undefined && data.player_id !== null ? parseInt(data.player_id) : null;
      
      // Check if this player already exists in this game (seamless reconnection after reload)
      let matchedPlayer = null;
      if (token) {
        matchedPlayer = this.localGame.players.find(p => p.token === token);
      }
      if (!matchedPlayer && requestedPid !== null && requestedPid >= 0 && requestedPid < this.localGame.players.length) {
        const candidate = this.localGame.players[requestedPid];
        if (candidate && (candidate.name === data.player_name || !candidate.connected)) {
          matchedPlayer = candidate;
        }
      }

      if (matchedPlayer) {
        // Player reconnected!
        const pid = matchedPlayer.id;
        matchedPlayer.connected = true;
        if (token) matchedPlayer.token = token;
        this.connections[pid] = conn;
        conn.send({ type: 'joined_ok', your_player_id: pid });
        this.localGame._addLog(`🔄 ${matchedPlayer.name} återanslöt till spelet!`);
        this._saveHostState();
        this._broadcastLocalState();
        return;
      }

      // New player joining
      if (this.localGame.status !== 'LOBBY') {
        conn.send({ type: 'error', message: 'Spelet har redan startat och du är inte registrerad i denna omgång.' });
        return;
      }

      const pid = this.localGame.addPlayer(data.player_name || 'Spelare', false);
      if (pid === null) {
        conn.send({ type: 'error', message: 'Rummet är fullt.' });
        return;
      }
      if (token) {
        this.localGame.players[pid].token = token;
      }
      this.connections[pid] = conn;
      conn.send({ type: 'joined_ok', your_player_id: pid });
      this._saveHostState();
      this._broadcastLocalState();

    } else if (data.type === 'game_action') {
      this.handleAction(data.action, data, data.player_id);
    } else if (data.type === 'chat') {
      const p = this.localGame.players[data.player_id];
      const name = p ? p.name : 'Spelare';
      this.localGame._addLog(`💬 ${name}: ${data.text}`);
      this._broadcastLocalState();
    }
  }

  // --- WEBRTC GUEST JOIN ---
  joinOnlineRoom(roomId, playerName, isReconnect = false) {
    this.mode = 'webrtc_guest';
    this.roomId = roomId.toUpperCase();
    this.reconnectAttempts = 0;

    if (typeof Peer === 'undefined') {
      alert('Kunde inte ladda PeerJS. Kontrollera din internetanslutning.');
      return;
    }

    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
    }

    sessionStorage.setItem('catan_active_room', this.roomId);
    sessionStorage.setItem('catan_role', 'webrtc_guest');
    sessionStorage.setItem('catan_player_name', playerName);

    this._updateBrowserUrl(this.roomId);

    const cleanCode = this._cleanCode(this.roomId);
    const hostPeerId = `catan8_${cleanCode}`;
    const token = this._getOrCreateToken();
    const savedPid = sessionStorage.getItem('catan_my_pid');

    try {
      this.peer = new Peer(this._getPeerConfig());

      this.peer.on('open', (myId) => {
        console.log('Guest peer initialized with ID:', myId);
        console.log('Connecting to host:', hostPeerId);
        
        this.hostConn = this.peer.connect(hostPeerId, { reliable: true });

        this.hostConn.on('open', () => {
          console.log('Connected to host data channel successfully!');
          this.reconnectAttempts = 0;
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }

          this.hostConn.send({
            type: isReconnect ? 'reconnect' : 'join_room',
            player_name: playerName,
            token: token,
            player_id: savedPid ? parseInt(savedPid) : null
          });
        });

        this.hostConn.on('data', (data) => {
          this._handleGuestMessage(data);
        });

        this.hostConn.on('close', () => {
          console.warn('Connection to host closed. Attempting auto-reconnect...');
          this._attemptGuestReconnect(roomId, playerName);
        });
      });

      this.peer.on('error', (err) => {
        console.error('Guest peer error:', err);
        if (err.type === 'peer-unavailable') {
          if (isReconnect || this.reconnectAttempts > 0) {
            // Reconnect attempt failed, retry
            this._attemptGuestReconnect(roomId, playerName);
          } else {
            alert(`Kunde inte hitta något rum med koden "${this.roomId}". Kontrollera att värden har skapat rummet och att koden är rätt stavad.`);
          }
        } else {
          console.warn('Guest peer error:', err.type);
        }
      });
    } catch (e) {
      console.error('Error starting guest peer:', e);
    }
  }

  _attemptGuestReconnect(roomId, playerName) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      alert('Kunde inte återansluta till rummet. Värden kan ha avslutat spelet.');
      this.leaveRoom(false);
      return;
    }

    this.reconnectAttempts++;
    console.log(`Reconnecting to host (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.mode === 'webrtc_guest') {
        this.joinOnlineRoom(roomId, playerName, true);
      }
    }, 2000);
  }

  _handleGuestMessage(data) {
    if (data.type === 'joined_ok') {
      this.myPlayerId = data.your_player_id;
      sessionStorage.setItem('catan_my_pid', this.myPlayerId.toString());
      console.log('Joined room OK! My player ID is:', this.myPlayerId);
    } else if (data.type === 'state_update') {
      this.app.playerId = this.myPlayerId;
      this.app.gameState = data.state;
      this.app.boardData = data.state.board;
      this.app.onStateUpdated();
    } else if (data.type === 'room_closed') {
      alert(data.message || 'Rummet har avslutats.');
      this.leaveRoom(false);
    } else if (data.type === 'error') {
      alert(data.message);
      this.leaveRoom(false);
    }
  }

  // --- ACTION HANDLING ---
  handleAction(action, extra = {}, senderPid = null) {
    if (this.mode === 'webrtc_guest') {
      if (this.hostConn && this.hostConn.open) {
        this.hostConn.send({
          type: 'game_action',
          action: action,
          player_id: this.myPlayerId,
          ...extra
        });
      }
      return;
    }

    if (!this.localGame) return;
    const pid = (senderPid !== null) ? senderPid : this.myPlayerId;

    if (action === 'place_setup_settlement') {
      this.localGame.placeSetupSettlement(pid, extra.vertex_id);
    } else if (action === 'place_setup_road') {
      this.localGame.placeSetupRoad(pid, extra.edge_id);
    } else if (action === 'roll_dice') {
      this.localGame.rollDice(pid);
    } else if (action === 'build_road') {
      this.localGame.buildRoad(pid, extra.edge_id);
    } else if (action === 'build_settlement') {
      this.localGame.buildSettlement(pid, extra.vertex_id);
    } else if (action === 'build_city') {
      this.localGame.buildCity(pid, extra.vertex_id);
    } else if (action === 'buy_dev_card') {
      this.localGame.buyDevCard(pid);
    } else if (action === 'play_dev_card') {
      this.localGame.playDevCard(pid, extra.card_type, extra.extra_data);
    } else if (action === 'bank_trade') {
      this.localGame.bankTrade(pid, extra.give, extra.get);
    } else if (action === 'propose_trade') {
      this.localGame.proposeTrade(pid, extra.offer, extra.target);
    } else if (action === 'accept_trade') {
      this.localGame.acceptTradeProposal(pid);
    } else if (action === 'execute_trade') {
      this.localGame.executeTrade(extra.partner_id);
    } else if (action === 'cancel_trade') {
      this.localGame.cancelTrade();
    } else if (action === 'move_robber') {
      this.localGame.moveRobber(pid, extra.hex_id);
    } else if (action === 'steal_resource') {
      this.localGame.stealResource(pid, extra.victim_id);
    } else if (action === 'discard_cards') {
      this.localGame.discardCards(pid, extra.discards);
    } else if (action === 'end_turn') {
      this.localGame.endTurn(pid);
    }

    this._saveHostState();
    this._broadcastLocalState();
  }

  sendChat(text) {
    if (this.mode === 'webrtc_guest') {
      if (this.hostConn && this.hostConn.open) {
        this.hostConn.send({ type: 'chat', text, player_id: this.myPlayerId });
      }
    } else if (this.localGame) {
      const p = this.localGame.players[this.myPlayerId];
      const name = p ? p.name : 'Spelare';
      this.localGame._addLog(`💬 ${name}: ${text}`);
      this._saveHostState();
      this._broadcastLocalState();
    }
  }

  addBot() {
    if (this.localGame && this.localGame.status === 'LOBBY') {
      const botNum = this.localGame.players.length + 1;
      this.localGame.addPlayer(`Bot ${botNum}`, true);
      this._saveHostState();
      this._broadcastLocalState();
    }
  }

  removePlayer(targetId) {
    if (this.localGame && this.localGame.status === 'LOBBY') {
      if (this.connections[targetId]) {
        try {
          this.connections[targetId].send({ type: 'room_closed', message: 'Du togs bort från rummet av värden.' });
          this.connections[targetId].close();
        } catch (e) {}
        delete this.connections[targetId];
      }
      this.localGame.players = this.localGame.players.filter(p => p.id !== targetId);
      for (let i = 0; i < this.localGame.players.length; i++) {
        this.localGame.players[i].id = i;
      }
      this._saveHostState();
      this._broadcastLocalState();
    }
  }

  startHostGame() {
    if (this.localGame && this.localGame.status === 'LOBBY') {
      if (this.localGame.startGame()) {
        this._saveHostState();
        this._broadcastLocalState();
      }
    }
  }

  leaveRoom(askConfirm = true) {
    if (askConfirm && !confirm('Är du säker på att du vill lämna rummet?')) {
      return;
    }

    if (this.mode === 'webrtc_host') {
      for (const [pidStr, conn] of Object.entries(this.connections)) {
        try {
          conn.send({ type: 'room_closed', message: 'Värden har avslutat rummet.' });
        } catch (e) {}
      }
      if (this.roomId) {
        sessionStorage.removeItem(`catan_host_state_${this.roomId}`);
      }
    }

    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }

    sessionStorage.removeItem('catan_active_room');
    sessionStorage.removeItem('catan_role');
    sessionStorage.removeItem('catan_my_pid');

    this._clearBrowserUrl();
    this.app.returnToLobby();
  }

  _broadcastLocalState() {
    if (!this.localGame) return;

    // Update local UI
    this.app.playerId = this.myPlayerId;
    this.app.gameState = this.localGame.getClientState(this.myPlayerId);
    this.app.boardData = this.localGame.board ? this.localGame.board.toDict() : null;
    this.app.onStateUpdated();

    // Broadcast to connected peers
    if (this.mode === 'webrtc_host') {
      for (const [pidStr, conn] of Object.entries(this.connections)) {
        const pid = parseInt(pidStr);
        try {
          if (conn.open) {
            conn.send({
              type: 'state_update',
              state: this.localGame.getClientState(pid)
            });
          }
        } catch (e) {
          console.warn('Error sending state to peer', pid, e);
        }
      }
    }
  }
}

window.NetworkPeer = NetworkPeer;
