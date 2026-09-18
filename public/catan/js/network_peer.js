/**
 * NetworkPeer: Universal Multiplayer Engine for Catan
 * Supports:
 * 1. Pass & Play (100% offline, 2-8 players on 1 device)
 * 2. WebRTC Peer-to-Peer via PeerJS (Host runs authoritative game, up to 7 peers connect via room code)
 */

class NetworkPeer {
  constructor(app) {
    this.app = app;
    this.mode = 'pass'; // 'pass' or 'webrtc_host' or 'webrtc_guest'
    this.peer = null;
    this.localGame = null;
    this.connections = {}; // pid -> DataConnection (if host)
    this.hostConn = null;  // DataConnection to host (if guest)
    this.myPlayerId = 0;
    this.roomId = null;
  }

  // --- PASS & PLAY MODE ---
  startPassAndPlay(roomId, numPlayers, targetVP) {
    this.mode = 'pass';
    this.roomId = roomId;
    this.myPlayerId = 0;

    const boardType = numPlayers <= 4 ? 'standard' : (numPlayers <= 6 ? 'extended' : 'mega');
    this.localGame = new ClientGameState(roomId, numPlayers, boardType, targetVP);
    this.localGame.is_pass_and_play = true;

    for (let i = 0; i < numPlayers; i++) {
      this.localGame.addPlayer(`Spelare ${i + 1}`, false);
    }
    this.localGame.startGame();
    this._broadcastLocalState();
  }

  // --- WEBRTC ROOM HOSTING ---
  createOnlineRoom(roomId, playerName, maxPlayers, targetVP) {
    this.mode = 'webrtc_host';
    this.roomId = roomId.toUpperCase();
    this.myPlayerId = 0;

    const boardType = maxPlayers <= 4 ? 'standard' : (maxPlayers <= 6 ? 'extended' : 'mega');
    this.localGame = new ClientGameState(this.roomId, maxPlayers, boardType, targetVP);
    this.localGame.is_pass_and_play = false;
    this.localGame.addPlayer(playerName, false);

    const peerId = `catan8_${this.roomId}`;
    this._initHostPeer(peerId);
  }

  _initHostPeer(peerId) {
    if (typeof Peer === 'undefined') {
      alert('Kunde inte ladda PeerJS för onlinespel. Kontrollera internetanslutningen.');
      return;
    }

    try {
      this.peer = new Peer(peerId, { debug: 1 });

      this.peer.on('open', (id) => {
        console.log('WebRTC Host ready with Peer ID:', id);
        this._broadcastLocalState();
      });

      this.peer.on('connection', (conn) => {
        conn.on('open', () => {
          conn.on('data', (data) => {
            this._handleHostMessage(conn, data);
          });
        });

        conn.on('close', () => {
          // Find player and mark disconnected
          for (const [pid, c] of Object.entries(this.connections)) {
            if (c === conn) {
              delete this.connections[pid];
              break;
            }
          }
        });
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS Host Error:', err);
        if (err.type === 'unavailable-id') {
          alert('Rumskoden är redan upptagen. Välj en annan kod eller slumpa.');
        }
      });
    } catch (e) {
      console.error('Error starting host peer:', e);
    }
  }

  _handleHostMessage(conn, data) {
    if (!this.localGame) return;

    if (data.type === 'join_room') {
      const pid = this.localGame.addPlayer(data.player_name || 'Spelare', false);
      if (pid === null) {
        conn.send({ type: 'error', message: 'Rummet är fullt eller spelet har startat.' });
        return;
      }
      this.connections[pid] = conn;
      conn.send({ type: 'joined_ok', your_player_id: pid });
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
  joinOnlineRoom(roomId, playerName) {
    this.mode = 'webrtc_guest';
    this.roomId = roomId.toUpperCase();

    if (typeof Peer === 'undefined') {
      alert('Kunde inte ladda PeerJS. Kontrollera internetanslutningen.');
      return;
    }

    try {
      this.peer = new Peer();

      this.peer.on('open', () => {
        const hostPeerId = `catan8_${this.roomId}`;
        this.hostConn = this.peer.connect(hostPeerId, { reliable: true });

        this.hostConn.on('open', () => {
          this.hostConn.send({
            type: 'join_room',
            player_name: playerName
          });
        });

        this.hostConn.on('data', (data) => {
          this._handleGuestMessage(data);
        });

        this.hostConn.on('error', (err) => {
          console.error('Host connection error:', err);
          alert('Kunde inte ansluta till värden. Kontrollera att rumskoden är rätt.');
        });
      });

      this.peer.on('error', (err) => {
        console.error('Guest Peer error:', err);
        alert('Nätverksfel vid anslutning: ' + err.type);
      });
    } catch (e) {
      console.error('Error starting guest peer:', e);
    }
  }

  _handleGuestMessage(data) {
    if (data.type === 'joined_ok') {
      this.myPlayerId = data.your_player_id;
    } else if (data.type === 'state_update') {
      this.app.playerId = this.myPlayerId;
      this.app.gameState = data.state;
      this.app.boardData = data.state.board;
      this.app.onStateUpdated();
    } else if (data.type === 'error') {
      alert(data.message);
    }
  }

  // --- ACTION HANDLING ---
  handleAction(action, extra = {}, senderPid = null) {
    if (this.mode === 'webrtc_guest') {
      if (this.hostConn) {
        this.hostConn.send({
          type: 'game_action',
          action: action,
          player_id: this.myPlayerId,
          ...extra
        });
      }
      return;
    }

    // Host or Pass & Play
    if (!this.localGame) return;
    const pid = (senderPid !== null) ? senderPid : (this.mode === 'pass' ? this.localGame.current_turn_idx : this.myPlayerId);

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

    this._broadcastLocalState();
  }

  sendChat(text) {
    if (this.mode === 'webrtc_guest') {
      if (this.hostConn) {
        this.hostConn.send({ type: 'chat', text, player_id: this.myPlayerId });
      }
    } else if (this.localGame) {
      const p = this.localGame.players[this.myPlayerId];
      const name = p ? p.name : 'Spelare';
      this.localGame._addLog(`💬 ${name}: ${text}`);
      this._broadcastLocalState();
    }
  }

  addBot() {
    if (this.localGame && this.localGame.status === 'LOBBY') {
      const botNum = this.localGame.players.length + 1;
      this.localGame.addPlayer(`Bot ${botNum}`, true);
      this._broadcastLocalState();
    }
  }

  removePlayer(targetId) {
    if (this.localGame && this.localGame.status === 'LOBBY') {
      this.localGame.players = this.localGame.players.filter(p => p.id !== targetId);
      for (let i = 0; i < this.localGame.players.length; i++) {
        this.localGame.players[i].id = i;
      }
      this._broadcastLocalState();
    }
  }

  startHostGame() {
    if (this.localGame && this.localGame.status === 'LOBBY') {
      if (this.localGame.startGame()) {
        this._broadcastLocalState();
      }
    }
  }

  _broadcastLocalState() {
    if (!this.localGame) return;

    // Update local UI
    this.app.playerId = this.myPlayerId;
    this.app.gameState = this.localGame.getClientState(this.myPlayerId);
    this.app.boardData = this.localGame.board ? this.localGame.board.toDict() : null;
    this.app.onStateUpdated();

    // Broadcast to peers if host
    if (this.mode === 'webrtc_host') {
      for (const [pidStr, conn] of Object.entries(this.connections)) {
        const pid = parseInt(pidStr);
        try {
          conn.send({
            type: 'state_update',
            state: this.localGame.getClientState(pid)
          });
        } catch (e) {
          console.warn('Error sending state to peer', pid, e);
        }
      }
    }
  }
}

window.NetworkPeer = NetworkPeer;
