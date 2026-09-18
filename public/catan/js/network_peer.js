/**
 * NetworkPeer: WebRTC Real-Time Multiplayer Engine for Catan
 * Uses PeerJS with public STUN servers for seamless mobile-to-mobile connections.
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

  // --- WEBRTC ROOM HOSTING ---
  createOnlineRoom(roomId, playerName, maxPlayers, targetVP) {
    this.mode = 'webrtc_host';
    this.roomId = roomId.toUpperCase();
    this.myPlayerId = 0;

    const boardType = maxPlayers <= 4 ? 'standard' : (maxPlayers <= 6 ? 'extended' : 'mega');
    this.localGame = new ClientGameState(this.roomId, maxPlayers, boardType, targetVP);
    this.localGame.is_pass_and_play = false;
    this.localGame.addPlayer(playerName, false);

    const cleanCode = this._cleanCode(this.roomId);
    const peerId = `catan8_${cleanCode}`;
    this._initHostPeer(peerId);
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
              delete this.connections[pid];
              break;
            }
          }
        });
      });

      this.peer.on('error', (err) => {
        console.error('Host peer error:', err);
        if (err.type === 'unavailable-id') {
          alert(`Rumskoden "${this.roomId}" är redan upptagen. Välj en annan kod (t.ex. slumpa) och försök igen.`);
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
        conn.send({ type: 'error', message: 'Rummet är fullt eller spelet har redan startat.' });
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
      alert('Kunde inte ladda PeerJS. Kontrollera din internetanslutning.');
      return;
    }

    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
    }

    const cleanCode = this._cleanCode(this.roomId);
    const hostPeerId = `catan8_${cleanCode}`;

    try {
      this.peer = new Peer(this._getPeerConfig());

      this.peer.on('open', (myId) => {
        console.log('Guest peer initialized with ID:', myId);
        console.log('Connecting to host:', hostPeerId);
        
        this.hostConn = this.peer.connect(hostPeerId, { reliable: true });

        this.hostConn.on('open', () => {
          console.log('Connected to host data channel successfully!');
          this.hostConn.send({
            type: 'join_room',
            player_name: playerName
          });
        });

        this.hostConn.on('data', (data) => {
          this._handleGuestMessage(data);
        });

        this.hostConn.on('close', () => {
          alert('Anslutningen till rummets värd bröts.');
        });
      });

      this.peer.on('error', (err) => {
        console.error('Guest peer error:', err);
        if (err.type === 'peer-unavailable') {
          alert(`Kunde inte hitta något rum med koden "${this.roomId}". Kontrollera att värden har skapat rummet och att koden är rätt stavad.`);
        } else {
          alert('Nätverksfel vid anslutning: ' + err.type);
        }
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

    // Broadcast to connected peers
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
