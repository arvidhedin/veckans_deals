/**
 * Client-Side Catan Game Engine (JavaScript)
 * Runs 100% in the browser. Supports 2-8 players, scalable boards (19, 30, 44 hexes),
 * rules enforcement, trading, dev cards, longest road, and win conditions.
 */

const RESOURCE_TYPES = ["wood", "brick", "sheep", "wheat", "ore"];
const DEV_CARD_TYPES = ["knight", "victory_point", "road_building", "year_of_plenty", "monopoly"];

const PLAYER_COLORS = [
  { name: "Röd", hex: "#e74c3c", dark: "#c0392b" },
  { name: "Blå", hex: "#3498db", dark: "#2980b9" },
  { name: "Orange", hex: "#e67e22", dark: "#d35400" },
  { name: "Vit", hex: "#f5f6fa", dark: "#7f8c8d" },
  { name: "Grön", hex: "#2ecc71", dark: "#27ae60" },
  { name: "Lila", hex: "#9b59b6", dark: "#8e44ad" },
  { name: "Brun", hex: "#8d6e63", dark: "#5d4037" },
  { name: "Gul", hex: "#f1c40f", dark: "#f39c12" },
];

const COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  dev_card: { sheep: 1, wheat: 1, ore: 1 },
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Board {
  constructor(boardType = "auto", numPlayers = 4) {
    this.boardType = boardType;
    this.numPlayers = numPlayers;
    if (boardType === "auto") {
      if (numPlayers <= 4) this.boardType = "standard";
      else if (numPlayers <= 6) this.boardType = "extended";
      else this.boardType = "mega";
    }

    this.hexes = {};
    this.vertices = {};
    this.edges = {};
    this.ports = [];
    this.robber_hex_id = "";
    this._generateBoard();
  }

  _generateBoard() {
    const hexSize = 50.0;
    const hexCoords = [];
    let resourcePool = [];
    let numberPool = [];

    if (this.boardType === "standard") {
      // 19 hexes (radius 2)
      for (let q = -2; q <= 2; q++) {
        const r1 = Math.max(-2, -q - 2);
        const r2 = Math.min(2, -q + 2);
        for (let r = r1; r <= r2; r++) {
          hexCoords.push([q, r]);
        }
      }
      resourcePool = [
        ...Array(4).fill("wood"), ...Array(3).fill("brick"), ...Array(4).fill("sheep"),
        ...Array(4).fill("wheat"), ...Array(3).fill("ore"), "desert"
      ];
      numberPool = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
    } else if (this.boardType === "extended") {
      // 30 hexes (5-6 players)
      const rows = [
        [-3, [-1, 0, 1]],
        [-2, [-2, -1, 0, 1]],
        [-1, [-2, -1, 0, 1, 2]],
        [0,  [-3, -2, -1, 0, 1, 2]],
        [1,  [-2, -1, 0, 1, 2]],
        [2,  [-2, -1, 0, 1]],
        [3,  [-1, 0, 1]],
      ];
      for (const [r, qList] of rows) {
        for (const q of qList) hexCoords.push([q, r]);
      }
      resourcePool = [
        ...Array(6).fill("wood"), ...Array(5).fill("brick"), ...Array(6).fill("sheep"),
        ...Array(6).fill("wheat"), ...Array(5).fill("ore"), ...Array(2).fill("desert")
      ];
      numberPool = [
        2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6,
        8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12
      ];
    } else {
      // Mega 44 hexes (7-8 players)
      const rows = [
        [-3, [-2, -1, 0, 1, 2]],
        [-2, [-3, -2, -1, 0, 1, 2]],
        [-1, [-3, -2, -1, 0, 1, 2, 3]],
        [0,  [-4, -3, -2, -1, 0, 1, 2, 3]],
        [1,  [-3, -2, -1, 0, 1, 2, 3]],
        [2,  [-3, -2, -1, 0, 1, 2]],
        [3,  [-2, -1, 0, 1, 2]],
      ];
      for (const [r, qList] of rows) {
        for (const q of qList) hexCoords.push([q, r]);
      }
      resourcePool = [
        ...Array(9).fill("wood"), ...Array(8).fill("brick"), ...Array(8).fill("sheep"),
        ...Array(8).fill("wheat"), ...Array(8).fill("ore"), ...Array(3).fill("desert")
      ];
      numberPool = [
        2, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6,
        8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 12, 12, 12,
        3, 4, 5, 9, 11
      ];
    }

    resourcePool = shuffle(resourcePool);
    numberPool = shuffle(numberPool);

    let numIdx = 0;
    hexCoords.forEach(([q, r], i) => {
      const hid = `hex_${q}_${r}`;
      const res = resourcePool[i];
      let val = null;
      if (res !== "desert") {
        val = numberPool[numIdx++];
      } else {
        this.robber_hex_id = hid;
      }

      const cx = hexSize * Math.sqrt(3) * (q + r / 2.0);
      const cy = hexSize * 1.5 * r;

      this.hexes[hid] = {
        id: hid,
        q,
        r,
        cx: parseFloat(cx.toFixed(2)),
        cy: parseFloat(cy.toFixed(2)),
        resource: res,
        number: val,
        vertices: [],
        edges: []
      };
    });

    this._balanceRedNumbers();

    // Vertices & Edges
    const cornerAngles = [30, 90, 150, 210, 270, 330];
    for (const [hid, h] of Object.entries(this.hexes)) {
      const hexVIds = [];
      for (const angle of cornerAngles) {
        const rad = (Math.PI / 180) * angle;
        const vx = parseFloat((h.cx + hexSize * Math.cos(rad)).toFixed(1));
        const vy = parseFloat((h.cy + hexSize * Math.sin(rad)).toFixed(1));
        const vid = `v_${Math.round(vx)}_${Math.round(vy)}`;

        if (!this.vertices[vid]) {
          this.vertices[vid] = {
            id: vid,
            x: vx,
            y: vy,
            hexes: [],
            adjacent_vertices: [],
            edges: [],
            building: null,
            port: null
          };
        }
        if (!this.vertices[vid].hexes.includes(hid)) {
          this.vertices[vid].hexes.push(hid);
        }
        hexVIds.push(vid);
      }
      h.vertices = hexVIds;

      for (let i = 0; i < 6; i++) {
        const v1_id = hexVIds[i];
        const v2_id = hexVIds[(i + 1) % 6];
        const eid = this._edgeId(v1_id, v2_id);

        if (!this.edges[eid]) {
          const v1 = this.vertices[v1_id];
          const v2 = this.vertices[v2_id];
          this.edges[eid] = {
            id: eid,
            v1: v1_id,
            v2: v2_id,
            mx: parseFloat(((v1.x + v2.x) / 2.0).toFixed(1)),
            my: parseFloat(((v1.y + v2.y) / 2.0).toFixed(1)),
            road: null
          };
        }

        if (!h.edges.includes(eid)) h.edges.push(eid);
        if (!this.vertices[v1_id].edges.includes(eid)) this.vertices[v1_id].edges.push(eid);
        if (!this.vertices[v2_id].edges.includes(eid)) this.vertices[v2_id].edges.push(eid);
        if (!this.vertices[v1_id].adjacent_vertices.includes(v2_id)) this.vertices[v1_id].adjacent_vertices.push(v2_id);
        if (!this.vertices[v2_id].adjacent_vertices.includes(v1_id)) this.vertices[v2_id].adjacent_vertices.push(v1_id);
      }
    }

    this._placePorts();
  }

  _edgeId(v1_id, v2_id) {
    return v1_id < v2_id ? `e_${v1_id}__${v2_id}` : `e_${v2_id}__${v1_id}`;
  }

  _balanceRedNumbers() {
    for (let iter = 0; iter < 50; iter++) {
      let conflict = false;
      for (const [hid, h] of Object.entries(this.hexes)) {
        if (h.number === 6 || h.number === 8) {
          const neighbors = [
            [h.q + 1, h.r],
            [h.q + 1, h.r - 1],
            [h.q, h.r - 1],
            [h.q - 1, h.r],
            [h.q - 1, h.r + 1],
            [h.q, h.r + 1],
          ];
          for (const [nq, nr] of neighbors) {
            const nid = `hex_${nq}_${nr}`;
            if (this.hexes[nid] && (this.hexes[nid].number === 6 || this.hexes[nid].number === 8)) {
              const cands = Object.keys(this.hexes).filter(
                k => this.hexes[k].number !== null && this.hexes[k].number !== 6 && this.hexes[k].number !== 8
              );
              if (cands.length > 0) {
                const swapId = cands[Math.floor(Math.random() * cands.length)];
                const tmp = h.number;
                h.number = this.hexes[swapId].number;
                this.hexes[swapId].number = tmp;
                conflict = true;
                break;
              }
            }
          }
          if (conflict) break;
        }
      }
      if (!conflict) break;
    }
  }

  _placePorts() {
    const coastalEdges = [];
    for (const [eid, ed] of Object.entries(this.edges)) {
      const v1Hexes = new Set(this.vertices[ed.v1].hexes);
      const v2Hexes = new Set(this.vertices[ed.v2].hexes);
      const shared = [...v1Hexes].filter(x => v2Hexes.has(x));
      if (shared.length === 1) coastalEdges.push(eid);
    }

    coastalEdges.sort((a, b) => {
      const edA = this.edges[a];
      const edB = this.edges[b];
      return Math.atan2(edA.my, edA.mx) - Math.atan2(edB.my, edB.mx);
    });

    const numPorts = this.boardType === "standard" ? 9 : (this.boardType === "extended" ? 11 : 14);
    let portTypesPool = [
      "generic_3_1", "generic_3_1", "generic_3_1", "generic_3_1",
      "wood_2_1", "brick_2_1", "sheep_2_1", "wheat_2_1", "ore_2_1"
    ];
    if (numPorts > portTypesPool.length) {
      portTypesPool.push(...["generic_3_1", "wood_2_1", "sheep_2_1", "wheat_2_1", "brick_2_1", "ore_2_1"].slice(0, numPorts - portTypesPool.length));
    }
    portTypesPool = shuffle(portTypesPool);

    const assignedVertices = new Set();
    let portIdx = 0;
    const totalCoastal = coastalEdges.length;
    const targetStep = totalCoastal / parseFloat(numPorts);

    for (let i = 0; i < numPorts; i++) {
      const targetIdx = Math.round(i * targetStep) % totalCoastal;
      let bestEdge = null;
      for (let offset = 0; offset < totalCoastal; offset++) {
        const idx = (targetIdx + offset) % totalCoastal;
        const candEid = coastalEdges[idx];
        const candEd = this.edges[candEid];
        if (!assignedVertices.has(candEd.v1) && !assignedVertices.has(candEd.v2)) {
          bestEdge = candEid;
          break;
        }
      }

      if (bestEdge && portIdx < portTypesPool.length) {
        const ed = this.edges[bestEdge];
        const ptype = portTypesPool[portIdx];
        const portData = {
          id: `port_${portIdx}`,
          type: ptype,
          edge_id: bestEdge,
          v1: ed.v1,
          v2: ed.v2,
          x: ed.mx,
          y: ed.my
        };
        this.ports.push(portData);
        this.vertices[ed.v1].port = ptype;
        this.vertices[ed.v2].port = ptype;
        assignedVertices.add(ed.v1);
        assignedVertices.add(ed.v2);
        portIdx++;
      }
    }
  }

  toDict() {
    return {
      board_type: this.boardType,
      robber_hex_id: this.robber_hex_id,
      hexes: this.hexes,
      vertices: this.vertices,
      edges: this.edges,
      ports: this.ports
    };
  }
}

class ClientGameState {
  constructor(roomId, maxPlayers = 4, boardType = "auto", targetVP = 10, specialBuild = true) {
    this.room_id = roomId;
    this.max_players = Math.max(2, Math.min(8, maxPlayers));
    this.board_type = boardType;
    this.target_vp = targetVP;
    this.special_build = specialBuild;
    this.is_pass_and_play = false;

    this.players = [];
    this.board = null;
    this.status = "LOBBY";
    this.current_turn_idx = 0;
    this.turn_phase = "BEFORE_ROLL";
    this.sub_turn_players = [];

    this.dice = [1, 1];
    this.dice_rolled = false;
    this.dev_deck = [];
    this.longest_road_player_id = null;
    this.longest_road_count = 0;
    this.largest_army_player_id = null;
    this.largest_army_count = 0;
    this.winner_id = null;

    this.current_trade = null;
    this.last_placed_setup_vertex = null;
    this.log = [];
    this._addLog("Rum skapat. Välkommen till Katan!");
  }

  addPlayer(name, isBot = false, colorIdx = null) {
    if (this.players.length >= this.max_players || this.status !== "LOBBY") return null;
    const pid = this.players.length;

    if (colorIdx === null || this.players.some(p => p.color_idx === colorIdx)) {
      const used = new Set(this.players.map(p => p.color_idx));
      for (let i = 0; i < PLAYER_COLORS.length; i++) {
        if (!used.has(i)) {
          colorIdx = i;
          break;
        }
      }
    }

    const colorInfo = PLAYER_COLORS[colorIdx];
    const player = {
      id: pid,
      name,
      is_bot: isBot,
      color_idx: colorIdx,
      color: colorInfo.hex,
      color_dark: colorInfo.dark,
      color_name: colorInfo.name,
      resources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
      dev_cards: [],
      played_dev_cards: [],
      roads_remaining: 15,
      settlements_remaining: 5,
      cities_remaining: 4,
      army_size: 0,
      road_length: 0,
      public_vp: 0,
      total_vp: 0,
      has_played_dev_this_turn: false,
      connected: true,
      pending_discard_count: 0
    };

    this.players.push(player);
    this._addLog(`${name} har gått med i spelet som ${colorInfo.name}.`);
    return pid;
  }

  startGame() {
    if (this.players.length < 2 || this.status !== "LOBBY") return false;
    this.board = new Board(this.board_type, this.players.length);

    const mult = this.players.length >= 7 ? 2 : 1;
    this.dev_deck = shuffle([
      ...Array(14 * mult).fill("knight"),
      ...Array(5 * mult).fill("victory_point"),
      ...Array(2 * mult).fill("road_building"),
      ...Array(2 * mult).fill("year_of_plenty"),
      ...Array(2 * mult).fill("monopoly")
    ]);

    this.status = "SETUP_1";
    this.current_turn_idx = 0;
    this.turn_phase = "SETUP_SETTLEMENT";
    const currentP = this.players[this.current_turn_idx];
    this._addLog(`Spelet startar! ${currentP.name} börjar placera ut första byn.`);
    return true;
  }

  placeSetupSettlement(playerId, vertexId) {
    if (!["SETUP_1", "SETUP_2"].includes(this.status) || this.current_turn_idx !== playerId) return false;
    if (this.turn_phase !== "SETUP_SETTLEMENT") return false;

    const v = this.board.vertices[vertexId];
    if (!v || v.building !== null) return false;

    for (const adjVid of v.adjacent_vertices) {
      if (this.board.vertices[adjVid].building !== null) return false;
    }

    const player = this.players[playerId];
    if (player.settlements_remaining <= 0) return false;

    v.building = { type: "settlement", player_id: playerId };
    player.settlements_remaining--;
    this.last_placed_setup_vertex = vertexId;

    if (this.status === "SETUP_2") {
      const gained = [];
      for (const hid of v.hexes) {
        const res = this.board.hexes[hid].resource;
        if (RESOURCE_TYPES.includes(res)) {
          player.resources[res]++;
          gained.push(res);
        }
      }
      if (gained.length > 0) {
        this._addLog(`${player.name} fick startresurser: ${gained.join(", ")}.`);
      }
    }

    this.turn_phase = "SETUP_ROAD";
    this._addLog(`${player.name} byggde en startby. Placera nu en anslutande väg.`);
    this._updateVictoryPoints();
    return true;
  }

  placeSetupRoad(playerId, edgeId) {
    if (!["SETUP_1", "SETUP_2"].includes(this.status) || this.current_turn_idx !== playerId) return false;
    if (this.turn_phase !== "SETUP_ROAD") return false;

    const edge = this.board.edges[edgeId];
    if (!edge || edge.road !== null) return false;

    if (!this.last_placed_setup_vertex || (edge.v1 !== this.last_placed_setup_vertex && edge.v2 !== this.last_placed_setup_vertex)) {
      return false;
    }

    const player = this.players[playerId];
    if (player.roads_remaining <= 0) return false;

    edge.road = { player_id: playerId };
    player.roads_remaining--;
    this._addLog(`${player.name} byggde en startväg.`);

    if (this.status === "SETUP_1") {
      if (this.current_turn_idx < this.players.length - 1) {
        this.current_turn_idx++;
        this.turn_phase = "SETUP_SETTLEMENT";
      } else {
        this.status = "SETUP_2";
        this.turn_phase = "SETUP_SETTLEMENT";
      }
    } else if (this.status === "SETUP_2") {
      if (this.current_turn_idx > 0) {
        this.current_turn_idx--;
        this.turn_phase = "SETUP_SETTLEMENT";
      } else {
        this.status = "MAIN_GAME";
        this.current_turn_idx = 0;
        this.turn_phase = "BEFORE_ROLL";
        this.dice_rolled = false;
        this._addLog("Startfasen är klar! Huvudspelet börjar.");
      }
    }

    this._updateLongestRoad();
    this._updateVictoryPoints();
    return true;
  }

  rollDice(playerId) {
    if (this.status !== "MAIN_GAME" || this.current_turn_idx !== playerId) return null;
    if (!["BEFORE_ROLL", "ROLL"].includes(this.turn_phase)) return null;

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const total = d1 + d2;
    this.dice = [d1, d2];
    this.dice_rolled = true;

    const player = this.players[playerId];
    this._addLog(`🎲 ${player.name} slog ${total} (${d1} + ${d2})!`);

    if (total === 7) {
      const discardLimit = this.players.length >= 7 ? 8 : 7;
      const playersToDiscard = [];
      for (const p of this.players) {
        const cardCount = Object.values(p.resources).reduce((a, b) => a + b, 0);
        if (cardCount > discardLimit) {
          p.pending_discard_count = Math.floor(cardCount / 2);
          playersToDiscard.push(p.id);
          this._addLog(`⚠️ ${p.name} har ${cardCount} kort och måste slänga ${p.pending_discard_count}.`);
        }
      }

      if (playersToDiscard.length > 0) {
        this.sub_turn_players = playersToDiscard;
        this.turn_phase = "ROBBER_DISCARD";
      } else {
        this.turn_phase = "ROBBER_MOVE";
      }
    } else {
      this._distributeResources(total);
      this.turn_phase = "ACTION";
    }

    return this.dice;
  }

  _distributeResources(rollNumber) {
    const payouts = {};
    this.players.forEach(p => payouts[p.id] = []);

    for (const [hid, h] of Object.entries(this.board.hexes)) {
      if (h.number === rollNumber && hid !== this.board.robber_hex_id) {
        const res = h.resource;
        if (RESOURCE_TYPES.includes(res)) {
          for (const vid of h.vertices) {
            const b = this.board.vertices[vid].building;
            if (b) {
              const count = b.type === "city" ? 2 : 1;
              this.players[b.player_id].resources[res] += count;
              for (let c = 0; c < count; c++) payouts[b.player_id].push(res);
            }
          }
        }
      }
    }

    for (const [pid, resList] of Object.entries(payouts)) {
      if (resList.length > 0) {
        const pname = this.players[pid].name;
        const counts = {};
        resList.forEach(r => counts[r] = (counts[r] || 0) + 1);
        const formatted = Object.entries(counts).map(([r, c]) => `${c} ${r}`).join(", ");
        this._addLog(`🌾 ${pname} fick: ${formatted}.`);
      }
    }
  }

  discardCards(playerId, discards) {
    if (this.turn_phase !== "ROBBER_DISCARD" || !this.sub_turn_players.includes(playerId)) return false;
    const player = this.players[playerId];
    const required = player.pending_discard_count;
    const totalGiven = Object.values(discards).reduce((a, b) => a + b, 0);
    if (totalGiven !== required) return false;

    for (const [res, amt] of Object.entries(discards)) {
      if ((player.resources[res] || 0) < amt || amt < 0) return false;
    }

    for (const [res, amt] of Object.entries(discards)) {
      player.resources[res] -= amt;
    }

    player.pending_discard_count = 0;
    this.sub_turn_players = this.sub_turn_players.filter(id => id !== playerId);
    this._addLog(`${player.name} slängde ${required} kort.`);

    if (this.sub_turn_players.length === 0) {
      this.turn_phase = "ROBBER_MOVE";
    }
    return true;
  }

  moveRobber(playerId, hexId) {
    if (this.turn_phase !== "ROBBER_MOVE" || this.current_turn_idx !== playerId) return false;
    if (hexId === this.board.robber_hex_id || !this.board.hexes[hexId]) return false;

    this.board.robber_hex_id = hexId;
    const player = this.players[playerId];
    this._addLog(`🏴‍☠️ ${player.name} flyttade rövaren till en ny ruta.`);

    const targetPids = new Set();
    for (const vid of this.board.hexes[hexId].vertices) {
      const b = this.board.vertices[vid].building;
      if (b && b.player_id !== playerId) {
        const victim = this.players[b.player_id];
        const cardCount = Object.values(victim.resources).reduce((a, b) => a + b, 0);
        if (cardCount > 0) targetPids.add(b.player_id);
      }
    }

    if (targetPids.size > 0) {
      this.sub_turn_players = [...targetPids];
      this.turn_phase = "ROBBER_STEAL";
    } else {
      this.turn_phase = "ACTION";
    }
    return true;
  }

  stealResource(playerId, victimId) {
    if (this.turn_phase !== "ROBBER_STEAL" || this.current_turn_idx !== playerId) return null;
    if (!this.sub_turn_players.includes(victimId)) return null;

    const victim = this.players[victimId];
    const cards = [];
    for (const [res, count] of Object.entries(victim.resources)) {
      for (let i = 0; i < count; i++) cards.push(res);
    }

    if (cards.length === 0) {
      this.turn_phase = "ACTION";
      return null;
    }

    const stolen = cards[Math.floor(Math.random() * cards.length)];
    victim.resources[stolen]--;
    this.players[playerId].resources[stolen]++;

    this._addLog(`🗡️ ${this.players[playerId].name} stal ett kort från ${victim.name}.`);
    this.turn_phase = "ACTION";
    return stolen;
  }

  canAfford(playerId, itemType) {
    const cost = COSTS[itemType];
    if (!cost) return false;
    const pRes = this.players[playerId].resources;
    return Object.entries(cost).every(([r, amt]) => (pRes[r] || 0) >= amt);
  }

  _deductCost(playerId, itemType) {
    const cost = COSTS[itemType];
    for (const [r, amt] of Object.entries(cost)) {
      this.players[playerId].resources[r] -= amt;
    }
  }

  buildRoad(playerId, edgeId) {
    if (this.status !== "MAIN_GAME" || (this.current_turn_idx !== playerId && this.turn_phase !== "SPECIAL_BUILD")) return false;
    if (!["ACTION", "SPECIAL_BUILD"].includes(this.turn_phase)) return false;

    const player = this.players[playerId];
    if (player.roads_remaining <= 0 || !this.canAfford(playerId, "road")) return false;

    const edge = this.board.edges[edgeId];
    if (!edge || edge.road !== null) return false;

    let canConnect = false;
    for (const vid of [edge.v1, edge.v2]) {
      const v = this.board.vertices[vid];
      if (v.building && v.building.player_id === playerId) {
        canConnect = true;
        break;
      }
      const enemyBldg = v.building && v.building.player_id !== playerId;
      if (!enemyBldg) {
        for (const adjEid of v.edges) {
          if (adjEid !== edgeId && this.board.edges[adjEid].road && this.board.edges[adjEid].road.player_id === playerId) {
            canConnect = true;
            break;
          }
        }
      }
      if (canConnect) break;
    }

    if (!canConnect) return false;

    this._deductCost(playerId, "road");
    edge.road = { player_id: playerId };
    player.roads_remaining--;
    this._addLog(`🛤️ ${player.name} byggde en väg.`);

    this._updateLongestRoad();
    this._updateVictoryPoints();
    return true;
  }

  buildSettlement(playerId, vertexId) {
    if (this.status !== "MAIN_GAME" || (this.current_turn_idx !== playerId && this.turn_phase !== "SPECIAL_BUILD")) return false;
    if (!["ACTION", "SPECIAL_BUILD"].includes(this.turn_phase)) return false;

    const player = this.players[playerId];
    if (player.settlements_remaining <= 0 || !this.canAfford(playerId, "settlement")) return false;

    const v = this.board.vertices[vertexId];
    if (!v || v.building !== null) return false;

    for (const adjVid of v.adjacent_vertices) {
      if (this.board.vertices[adjVid].building !== null) return false;
    }

    const hasRoad = v.edges.some(eid => this.board.edges[eid].road && this.board.edges[eid].road.player_id === playerId);
    if (!hasRoad) return false;

    this._deductCost(playerId, "settlement");
    v.building = { type: "settlement", player_id: playerId };
    player.settlements_remaining--;
    this._addLog(`🏠 ${player.name} byggde en by!`);

    this._updateLongestRoad();
    this._updateVictoryPoints();
    return true;
  }

  buildCity(playerId, vertexId) {
    if (this.status !== "MAIN_GAME" || (this.current_turn_idx !== playerId && this.turn_phase !== "SPECIAL_BUILD")) return false;
    if (!["ACTION", "SPECIAL_BUILD"].includes(this.turn_phase)) return false;

    const player = this.players[playerId];
    if (player.cities_remaining <= 0 || !this.canAfford(playerId, "city")) return false;

    const v = this.board.vertices[vertexId];
    if (!v || !v.building || v.building.type !== "settlement" || v.building.player_id !== playerId) return false;

    this._deductCost(playerId, "city");
    v.building.type = "city";
    player.cities_remaining--;
    player.settlements_remaining++;
    this._addLog(`🏰 ${player.name} uppgraderade en by till en stad!`);

    this._updateVictoryPoints();
    return true;
  }

  buyDevCard(playerId) {
    if (this.status !== "MAIN_GAME" || this.current_turn_idx !== playerId || this.turn_phase !== "ACTION") return null;
    if (this.dev_deck.length === 0 || !this.canAfford(playerId, "dev_card")) return null;

    this._deductCost(playerId, "dev_card");
    const card = this.dev_deck.pop();
    this.players[playerId].dev_cards.push(card);
    this._addLog(`📜 ${this.players[playerId].name} köpte ett utvecklingskort.`);
    this._updateVictoryPoints();
    return card;
  }

  playDevCard(playerId, cardType, extraData = {}) {
    if (this.status !== "MAIN_GAME" || this.current_turn_idx !== playerId) return false;
    const player = this.players[playerId];
    if (player.has_played_dev_this_turn && cardType !== "victory_point") return false;
    const cardIdx = player.dev_cards.indexOf(cardType);
    if (cardIdx === -1) return false;

    if (cardType === "knight") {
      player.dev_cards.splice(cardIdx, 1);
      player.played_dev_cards.push("knight");
      player.army_size++;
      player.has_played_dev_this_turn = true;
      this._addLog(`⚔️ ${player.name} spelade en Riddare!`);
      this._updateLargestArmy();
      this.turn_phase = "ROBBER_MOVE";
      return true;
    } else if (cardType === "year_of_plenty") {
      const { res1, res2 } = extraData;
      if (RESOURCE_TYPES.includes(res1) && RESOURCE_TYPES.includes(res2)) {
        player.dev_cards.splice(cardIdx, 1);
        player.played_dev_cards.push("year_of_plenty");
        player.resources[res1]++;
        player.resources[res2]++;
        player.has_played_dev_this_turn = true;
        this._addLog(`✨ ${player.name} tog 1 ${res1} och 1 ${res2} via Överflöd.`);
        return true;
      }
    } else if (cardType === "monopoly") {
      const { resource } = extraData;
      if (RESOURCE_TYPES.includes(resource)) {
        player.dev_cards.splice(cardIdx, 1);
        player.played_dev_cards.push("monopoly");
        let total = 0;
        this.players.forEach(other => {
          if (other.id !== playerId) {
            const count = other.resources[resource] || 0;
            if (count > 0) {
              other.resources[resource] = 0;
              total += count;
            }
          }
        });
        player.resources[resource] += total;
        player.has_played_dev_this_turn = true;
        this._addLog(`💰 ${player.name} tog monopol på ${resource} och fick ${total} kort!`);
        return true;
      }
    }

    return false;
  }

  bankTrade(playerId, giveRes, getRes) {
    if (this.status !== "MAIN_GAME" || this.current_turn_idx !== playerId || this.turn_phase !== "ACTION") return false;
    if (!RESOURCE_TYPES.includes(giveRes) || !RESOURCE_TYPES.includes(getRes) || giveRes === getRes) return false;

    const ports = this._getPlayerPorts(playerId);
    let rate = 4;
    if (ports.includes(`${giveRes}_2_1`)) rate = 2;
    else if (ports.includes("generic_3_1")) rate = 3;

    const player = this.players[playerId];
    if ((player.resources[giveRes] || 0) < rate) return false;

    player.resources[giveRes] -= rate;
    player.resources[getRes]++;
    this._addLog(`🤝 ${player.name} bytte ${rate} ${giveRes} mot 1 ${getRes} med banken/hamnen.`);
    return true;
  }

  proposeTrade(playerId, offer, target) {
    if (this.status !== "MAIN_GAME" || this.current_turn_idx !== playerId || this.turn_phase !== "ACTION") return false;
    const player = this.players[playerId];
    for (const [r, amt] of Object.entries(offer)) {
      if ((player.resources[r] || 0) < amt || amt < 0) return false;
    }
    const offerTotal = Object.values(offer).reduce((a, b) => a + b, 0);
    const targetTotal = Object.values(target).reduce((a, b) => a + b, 0);
    if (offerTotal === 0 || targetTotal === 0) return false;

    this.current_trade = {
      proposer_id: playerId,
      offer,
      target,
      accepted_by: []
    };

    const offerStr = Object.entries(offer).filter(([k, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(", ");
    const targetStr = Object.entries(target).filter(([k, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(", ");
    this._addLog(`📢 ${player.name} vill byta: [${offerStr}] mot [${targetStr}].`);
    return true;
  }

  acceptTradeProposal(playerId) {
    if (!this.current_trade || playerId === this.current_trade.proposer_id) return false;
    const target = this.current_trade.target;
    const player = this.players[playerId];
    for (const [r, amt] of Object.entries(target)) {
      if ((player.resources[r] || 0) < amt) return false;
    }

    if (!this.current_trade.accepted_by.includes(playerId)) {
      this.current_trade.accepted_by.push(playerId);
      this._addLog(`👍 ${player.name} är villig att genomföra bytet!`);
    }
    return true;
  }

  executeTrade(partnerId) {
    if (!this.current_trade) return false;
    const proposerId = this.current_trade.proposer_id;
    if (!this.current_trade.accepted_by.includes(partnerId)) return false;

    const p1 = this.players[proposerId];
    const p2 = this.players[partnerId];
    const { offer, target } = this.current_trade;

    for (const [r, amt] of Object.entries(offer)) {
      if ((p1.resources[r] || 0) < amt) return false;
    }
    for (const [r, amt] of Object.entries(target)) {
      if ((p2.resources[r] || 0) < amt) return false;
    }

    for (const [r, amt] of Object.entries(offer)) {
      p1.resources[r] -= amt;
      p2.resources[r] += amt;
    }
    for (const [r, amt] of Object.entries(target)) {
      p2.resources[r] -= amt;
      p1.resources[r] += amt;
    }

    this._addLog(`🤝 Byte genomfört mellan ${p1.name} och ${p2.name}!`);
    this.current_trade = null;
    return true;
  }

  cancelTrade() {
    this.current_trade = null;
  }

  endTurn(playerId) {
    if (this.status !== "MAIN_GAME" || this.current_turn_idx !== playerId) return false;
    if (!["ACTION", "BEFORE_ROLL"].includes(this.turn_phase) && !this.dice_rolled) return false;

    this.current_trade = null;
    this.players[playerId].has_played_dev_this_turn = false;

    if (this._checkWinner()) return true;

    this.current_turn_idx = (this.current_turn_idx + 1) % this.players.length;
    this.turn_phase = "BEFORE_ROLL";
    this.dice_rolled = false;

    this._addLog(`➡️ Nu är det ${this.players[this.current_turn_idx].name}s tur.`);
    return true;
  }

  _getPlayerPorts(playerId) {
    const ports = [];
    for (const v of Object.values(this.board.vertices)) {
      if (v.building && v.building.player_id === playerId && v.port) {
        ports.push(v.port);
      }
    }
    return ports;
  }

  _updateVictoryPoints() {
    for (const p of this.players) {
      let publicVP = 0;
      for (const v of Object.values(this.board.vertices)) {
        if (v.building && v.building.player_id === p.id) {
          publicVP += v.building.type === "city" ? 2 : 1;
        }
      }
      if (this.longest_road_player_id === p.id) publicVP += 2;
      if (this.largest_army_player_id === p.id) publicVP += 2;

      p.public_vp = publicVP;
      const secretVP = p.dev_cards.filter(c => c === "victory_point").length;
      p.total_vp = publicVP + secretVP;
    }
  }

  _updateLongestRoad() {
    for (const p of this.players) {
      const playerEdges = Object.values(this.board.edges).filter(
        ed => ed.road && ed.road.player_id === p.id
      ).map(ed => ed.id);
      p.road_length = this._calculateLongestRoadForPlayer(p.id, playerEdges);
    }

    let bestPlayer = null;
    let maxLength = 4;
    if (this.longest_road_player_id !== null) {
      maxLength = this.players[this.longest_road_player_id].road_length;
      bestPlayer = this.longest_road_player_id;
    }

    for (const p of this.players) {
      if (p.road_length > maxLength) {
        maxLength = p.road_length;
        bestPlayer = p.id;
      }
    }

    if (bestPlayer !== this.longest_road_player_id && bestPlayer !== null) {
      this.longest_road_player_id = bestPlayer;
      this.longest_road_count = maxLength;
      this._addLog(`🚩 ${this.players[bestPlayer].name} har nu Längsta Vägen (${maxLength} vägar)!`);
    }
  }

  _calculateLongestRoadForPlayer(playerId, playerEdgeIds) {
    if (playerEdgeIds.length === 0) return 0;
    const visited = new Set();

    const dfs = (currentVid, currentLen) => {
      let maxLen = currentLen;
      const v = this.board.vertices[currentVid];
      if (v.building && v.building.player_id !== playerId) return maxLen;

      for (const eid of v.edges) {
        if (playerEdgeIds.includes(eid) && !visited.has(eid)) {
          const ed = this.board.edges[eid];
          const nextVid = ed.v1 === currentVid ? ed.v2 : ed.v1;
          visited.add(eid);
          const len = dfs(nextVid, currentLen + 1);
          visited.delete(eid);
          if (len > maxLen) maxLen = len;
        }
      }
      return maxLen;
    };

    let overallMax = 0;
    for (const eid of playerEdgeIds) {
      const ed = this.board.edges[eid];
      overallMax = Math.max(overallMax, dfs(ed.v1, 0), dfs(ed.v2, 0));
    }
    return overallMax;
  }

  _updateLargestArmy() {
    let bestPlayer = this.largest_army_player_id;
    let maxArmy = bestPlayer !== null ? this.largest_army_count : 2;

    for (const p of this.players) {
      if (p.army_size > maxArmy) {
        maxArmy = p.army_size;
        bestPlayer = p.id;
      }
    }

    if (bestPlayer !== this.largest_army_player_id && bestPlayer !== null) {
      this.largest_army_player_id = bestPlayer;
      this.largest_army_count = maxArmy;
      this._addLog(`🗡️ ${this.players[bestPlayer].name} har nu Största Riddarmakten (${maxArmy} riddare)!`);
    }
  }

  _checkWinner() {
    this._updateVictoryPoints();
    for (const p of this.players) {
      if (p.total_vp >= this.target_vp) {
        this.status = "GAME_OVER";
        this.winner_id = p.id;
        this._addLog(`🏆 GRATTIS! ${p.name} har vunnit spelet med ${p.total_vp} segerpoäng!`);
        return true;
      }
    }
    return false;
  }

  _addLog(text) {
    this.log.push({ text, turn: this.current_turn_idx, status: this.status });
    if (this.log.length > 100) this.log.shift();
  }

  getClientState(viewerPlayerId = null) {
    const playersData = [];
    const effectiveViewer = this.is_pass_and_play ? this.current_turn_idx : viewerPlayerId;

    for (const p of this.players) {
      const copy = { ...p };
      copy.dev_cards_count = p.dev_cards.length;
      copy.resources_count = Object.values(p.resources).reduce((a, b) => a + b, 0);
      if (effectiveViewer !== p.id) {
        copy.dev_cards = Array(p.dev_cards.length).fill("hidden");
      }
      playersData.push(copy);
    }

    return {
      room_id: this.room_id,
      max_players: this.max_players,
      board_type: this.board_type,
      target_vp: this.target_vp,
      status: this.status,
      current_turn_idx: this.current_turn_idx,
      turn_phase: this.turn_phase,
      sub_turn_players: this.sub_turn_players,
      dice: this.dice,
      dice_rolled: this.dice_rolled,
      longest_road_player_id: this.longest_road_player_id,
      longest_road_count: this.longest_road_count,
      largest_army_player_id: this.largest_army_player_id,
      largest_army_count: this.largest_army_count,
      winner_id: this.winner_id,
      players: playersData,
      board: this.board ? this.board.toDict() : null,
      current_trade: this.current_trade,
      log: this.log.slice(-30)
    };
  }
}

window.ClientGameState = ClientGameState;
window.Board = Board;
