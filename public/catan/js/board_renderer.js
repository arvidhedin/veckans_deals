/**
 * Board Renderer: High-Precision SVG Renderer for Catan
 * Replicates the Colonist.io look & feel with rich styling, crisp graphics, and touch overlays.
 */

class BoardRenderer {
  constructor(svgId) {
    this.svg = document.getElementById(svgId);
    this.hexesLayer = document.getElementById('hexes-layer');
    this.portsLayer = document.getElementById('ports-layer');
    this.tokensLayer = document.getElementById('number-tokens-layer');
    this.edgesLayer = document.getElementById('edges-layer');
    this.verticesLayer = document.getElementById('vertices-layer');
    this.robberLayer = document.getElementById('robber-layer');
    this.overlayLayer = document.getElementById('interactive-overlay-layer');

    this.hexSize = 50.0;
    this.activeOverlayCallback = null;
  }

  render(boardData, players) {
    if (!boardData) return;

    this.boardData = boardData;
    this.clearAll();
    this.renderHexes(boardData.hexes);
    this.renderPorts(boardData.ports, boardData);
    this.renderEdges(boardData.edges, players);
    this.renderVertices(boardData.vertices, players);
    this.renderNumberTokens(boardData.hexes);
    this.renderRobber(boardData.robber_hex_id, boardData.hexes);
  }

  clearAll() {
    this.hexesLayer.innerHTML = '';
    this.portsLayer.innerHTML = '';
    this.tokensLayer.innerHTML = '';
    this.edgesLayer.innerHTML = '';
    this.verticesLayer.innerHTML = '';
    this.robberLayer.innerHTML = '';
    this.clearOverlay();
  }

  clearOverlay() {
    this.overlayLayer.innerHTML = '';
    this.activeOverlayCallback = null;
  }

  // --- HEX TILES ---
  renderHexes(hexes) {
    const hexGrads = {
      wood: 'url(#wood-grad)',
      brick: 'url(#brick-grad)',
      sheep: 'url(#sheep-grad)',
      wheat: 'url(#wheat-grad)',
      ore: 'url(#ore-grad)',
      desert: 'url(#desert-grad)'
    };

    const resIcons = {
      wood: '🌲',
      brick: '🧱',
      sheep: '🐑',
      wheat: '🌾',
      ore: '⛰️',
      desert: '🌵'
    };

    for (const [hid, h] of Object.entries(hexes)) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'hex-group');
      g.setAttribute('data-hex-id', hid);

      // Points of pointy-top hex
      const points = [];
      const angles = [30, 90, 150, 210, 270, 330];
      for (const a of angles) {
        const rad = (Math.PI / 180) * a;
        const x = h.cx + this.hexSize * Math.cos(rad);
        const y = h.cy + this.hexSize * Math.sin(rad);
        points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }

      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', points.join(' '));
      poly.setAttribute('class', `hex-tile hex-${h.resource}`);
      poly.setAttribute('fill', hexGrads[h.resource] || '#444');
      g.appendChild(poly);

      // Subtle resource icon stamp in the upper half
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      icon.setAttribute('x', h.cx);
      icon.setAttribute('y', h.cy - (h.resource === 'desert' ? 0 : 20));
      icon.setAttribute('font-size', '14px');
      icon.setAttribute('text-anchor', 'middle');
      icon.setAttribute('opacity', '0.7');
      icon.setAttribute('pointer-events', 'none');
      icon.textContent = resIcons[h.resource] || '';
      g.appendChild(icon);

      this.hexesLayer.appendChild(g);
    }
  }

  // --- NUMBER TOKENS ---
  renderNumberTokens(hexes) {
    const pipMap = { 2: 1, 12: 1, 3: 2, 11: 2, 4: 3, 10: 3, 5: 4, 9: 4, 6: 5, 8: 5 };

    for (const [hid, h] of Object.entries(hexes)) {
      if (h.number === null || h.resource === 'desert') continue;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'token-group');
      g.setAttribute('transform', `translate(${h.cx}, ${h.cy + 4})`);
      g.setAttribute('pointer-events', 'none');

      // Token background circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', '17');
      circle.setAttribute('class', 'number-token-bg');
      g.appendChild(circle);

      // Number text
      const isRed = (h.number === 6 || h.number === 8);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('y', '-2');
      text.setAttribute('class', `number-token-text ${isRed ? 'red-number' : 'standard-number'}`);
      text.textContent = h.number;
      g.appendChild(text);

      // Probability pips
      const pips = pipMap[h.number] || 1;
      const startX = -((pips - 1) * 3.5) / 2;
      for (let i = 0; i < pips; i++) {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', startX + i * 3.5);
        dot.setAttribute('cy', '8.5');
        dot.setAttribute('r', '1.2');
        dot.setAttribute('class', `pip-dot ${isRed ? 'red-pip' : ''}`);
        g.appendChild(dot);
      }

      this.tokensLayer.appendChild(g);
    }
  }

  // --- PORTS / HARBORS ---
  renderPorts(ports, boardData = this.boardData) {
    if (!ports) return;

    const portLabels = {
      generic_3_1: '3:1 ⛵',
      wood_2_1: '2:1 🌲',
      brick_2_1: '2:1 🧱',
      sheep_2_1: '2:1 🐑',
      wheat_2_1: '2:1 🌾',
      ore_2_1: '2:1 🪨'
    };

    const portTheme = {
      generic_3_1: { border: '#f59e0b', bg: '#0b1b2b', label: '3:1 ⛵' },
      wood_2_1:    { border: '#22c55e', bg: '#0b2615', label: '2:1 🌲' },
      brick_2_1:   { border: '#ea580c', bg: '#2b140b', label: '2:1 🧱' },
      sheep_2_1:   { border: '#84cc16', bg: '#172b0b', label: '2:1 🐑' },
      wheat_2_1:   { border: '#eab308', bg: '#2b230b', label: '2:1 🌾' },
      ore_2_1:     { border: '#94a3b8', bg: '#18202b', label: '2:1 🪨' }
    };

    ports.forEach((p) => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'port-group');
      g.setAttribute('pointer-events', 'none');

      const v1 = boardData?.vertices?.[p.v1];
      const v2 = boardData?.vertices?.[p.v2];
      const theme = portTheme[p.type] || { border: '#f59e0b', bg: '#0b1b2b', label: portLabels[p.type] || '3:1' };

      if (!v1 || !v2) {
        // Fallback without vertices
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        badge.setAttribute('x', p.x - 26);
        badge.setAttribute('y', p.y - 12);
        badge.setAttribute('width', '52');
        badge.setAttribute('height', '24');
        badge.setAttribute('rx', '12');
        badge.setAttribute('class', 'port-badge-bg');
        badge.setAttribute('fill', theme.bg);
        badge.setAttribute('stroke', theme.border);
        g.appendChild(badge);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', p.x);
        text.setAttribute('y', p.y + 0.5);
        text.setAttribute('class', 'port-badge-text');
        text.textContent = theme.label;
        g.appendChild(text);

        this.portsLayer.appendChild(g);
        return;
      }

      // Edge midpoint
      const mx = (v1.x + v2.x) / 2.0;
      const my = (v1.y + v2.y) / 2.0;

      // Find the adjacent land hex to determine the outward normal towards water
      let nx = 0, ny = 0;
      const sharedHexId = (v1.hexes || []).find(hId => (v2.hexes || []).includes(hId));
      const landHex = sharedHexId && boardData?.hexes ? boardData.hexes[sharedHexId] : null;

      if (landHex) {
        const dx = mx - landHex.cx;
        const dy = my - landHex.cy;
        const len = Math.hypot(dx, dy) || 1;
        nx = dx / len;
        ny = dy / len;
      } else {
        const len = Math.hypot(mx, my) || 1;
        nx = mx / len;
        ny = my / len;
      }

      // Harbor badge coordinates floating in the water offshore
      const badgeDist = 28;
      const bx = mx + nx * badgeDist;
      const by = my + ny * badgeDist;

      // 1. Two wooden pier bridges from the two vertices (v1, v2) out to the badge
      [v1, v2].forEach((v) => {
        // Dark pier shadow for depth
        const pierShadow = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        pierShadow.setAttribute('x1', v.x);
        pierShadow.setAttribute('y1', v.y);
        pierShadow.setAttribute('x2', bx);
        pierShadow.setAttribute('y2', by);
        pierShadow.setAttribute('stroke', '#09131d');
        pierShadow.setAttribute('stroke-width', '6.5');
        pierShadow.setAttribute('stroke-linecap', 'round');
        g.appendChild(pierShadow);

        // Wooden plank pier
        const pier = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        pier.setAttribute('x1', v.x);
        pier.setAttribute('y1', v.y);
        pier.setAttribute('x2', bx);
        pier.setAttribute('y2', by);
        pier.setAttribute('class', 'port-dock-line');
        g.appendChild(pier);
      });

      // 2. Mooring dock posts on the two vertices (indicates valid harbor settlement spots)
      [v1, v2].forEach((v) => {
        const post = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        post.setAttribute('cx', v.x);
        post.setAttribute('cy', v.y);
        post.setAttribute('r', '4.5');
        post.setAttribute('class', 'port-post');
        g.appendChild(post);
      });

      // 3. Harbor badge pill floating in water
      const badgeW = 52;
      const badgeH = 24;

      const badge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      badge.setAttribute('x', bx - badgeW / 2);
      badge.setAttribute('y', by - badgeH / 2);
      badge.setAttribute('width', badgeW);
      badge.setAttribute('height', badgeH);
      badge.setAttribute('rx', badgeH / 2);
      badge.setAttribute('class', 'port-badge-bg');
      badge.setAttribute('fill', theme.bg);
      badge.setAttribute('stroke', theme.border);
      g.appendChild(badge);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', bx);
      text.setAttribute('y', by + 0.5);
      text.setAttribute('class', 'port-badge-text');
      text.textContent = theme.label;
      g.appendChild(text);

      this.portsLayer.appendChild(g);
    });
  }

  // --- EDGES & ROADS ---
  renderEdges(edges, players) {
    const playerColors = {};
    if (players) {
      players.forEach(p => playerColors[p.id] = p.color || '#fff');
    }

    for (const [eid, ed] of Object.entries(edges)) {
      if (!ed.road) continue;

      // Draw road
      const color = playerColors[ed.road.player_id] || '#ffffff';
      const v1 = ed.v1_data || this._extractCoords(ed.v1);
      const v2 = ed.v2_data || this._extractCoords(ed.v2);

      if (v1 && v2) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', v1.x);
        line.setAttribute('y1', v1.y);
        line.setAttribute('x2', v2.x);
        line.setAttribute('y2', v2.y);
        line.setAttribute('class', 'road-bar');
        line.setAttribute('stroke', color);
        this.edgesLayer.appendChild(line);
      }
    }
  }

  // --- VERTICES & BUILDINGS ---
  renderVertices(vertices, players) {
    const playerColors = {};
    if (players) {
      players.forEach(p => playerColors[p.id] = p.color || '#fff');
    }

    for (const [vid, v] of Object.entries(vertices)) {
      if (!v.building) continue;

      const pid = v.building.player_id;
      const color = playerColors[pid] || '#fff';
      const isCity = v.building.type === 'city';

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${v.x}, ${v.y})`);

      if (isCity) {
        // City: 2-tier fortified castle
        const cityPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        // Castle path: tower left, dip, tower right, base
        cityPath.setAttribute('d', 'M -14 8 L -14 -4 L -9 -9 L -4 -4 L -4 -12 L 4 -12 L 4 -4 L 9 -9 L 14 -4 L 14 8 Z');
        cityPath.setAttribute('fill', color);
        cityPath.setAttribute('stroke', '#1e293b');
        cityPath.setAttribute('stroke-width', '1.5');
        cityPath.setAttribute('class', 'city-shape');
        g.appendChild(cityPath);
      } else {
        // Settlement: Gable-roof house
        const housePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        housePath.setAttribute('d', 'M -9 7 L -9 -2 L 0 -10 L 9 -2 L 9 7 Z');
        housePath.setAttribute('fill', color);
        housePath.setAttribute('stroke', '#1e293b');
        housePath.setAttribute('stroke-width', '1.5');
        housePath.setAttribute('class', 'settlement-shape');
        g.appendChild(housePath);
      }

      this.verticesLayer.appendChild(g);
    }
  }

  // --- ROBBER ---
  renderRobber(robberHexId, hexes) {
    if (!robberHexId || !hexes || !hexes[robberHexId]) return;
    const h = hexes[robberHexId];

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'robber-pawn');
    g.setAttribute('transform', `translate(${h.cx}, ${h.cy - 12})`);

    // Stylized Robber silhouette (cylinder pawn with cap)
    const base = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    base.setAttribute('cx', '0');
    base.setAttribute('cy', '12');
    base.setAttribute('rx', '9');
    base.setAttribute('ry', '4');
    base.setAttribute('fill', '#111');
    base.setAttribute('opacity', '0.5');
    g.appendChild(base);

    const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    body.setAttribute('d', 'M -8 11 C -7 5 -4 0 -4 -4 C -7 -6 -6 -12 0 -12 C 6 -12 7 -6 4 -4 C 4 0 7 5 8 11 Z');
    body.setAttribute('fill', '#1e293b');
    body.setAttribute('stroke', '#0f172a');
    body.setAttribute('stroke-width', '1.5');
    g.appendChild(body);

    // Menacing eye slot or badge
    const badge = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    badge.setAttribute('cx', '0');
    badge.setAttribute('cy', '-7');
    badge.setAttribute('r', '2.5');
    badge.setAttribute('fill', '#ef4444');
    g.appendChild(badge);

    this.robberLayer.appendChild(g);
  }

  // --- INTERACTIVE TOUCH OVERLAYS (LARGE TOUCH TARGETS >= 40PX) ---
  showVertexTargets(validVertexIds, vertices, onSelect) {
    this.clearOverlay();
    this.activeOverlayCallback = onSelect;

    validVertexIds.forEach((vid) => {
      const v = vertices[vid];
      if (!v) return;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'touch-vertex-group');

      // Visual indicator dot: crisp, elegant, completely static (r=7.5)
      const visualDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      visualDot.setAttribute('cx', v.x);
      visualDot.setAttribute('cy', v.y);
      visualDot.setAttribute('r', '7.5');
      visualDot.setAttribute('class', 'touch-target-vertex');

      // Large invisible touch hitbox (48px diameter for effortless mobile tapping)
      const hitbox = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hitbox.setAttribute('cx', v.x);
      hitbox.setAttribute('cy', v.y);
      hitbox.setAttribute('r', '24');
      hitbox.setAttribute('fill', 'transparent');
      hitbox.setAttribute('cursor', 'pointer');

      const clickHandler = (e) => {
        e.stopPropagation();
        this.clearOverlay();
        if (window.soundEffects) window.soundEffects.playBuild();
        onSelect(vid);
      };

      g.addEventListener('click', clickHandler);
      hitbox.addEventListener('click', clickHandler);
      visualDot.addEventListener('click', clickHandler);

      g.appendChild(visualDot);
      g.appendChild(hitbox);
      this.overlayLayer.appendChild(g);
    });
  }

  showEdgeTargets(validEdgeIds, edges, vertices, onSelect) {
    this.clearOverlay();
    this.activeOverlayCallback = onSelect;

    validEdgeIds.forEach((eid) => {
      const ed = edges[eid];
      if (!ed) return;
      const v1 = vertices[ed.v1];
      const v2 = vertices[ed.v2];
      if (!v1 || !v2) return;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'touch-edge-group');

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', v1.x);
      line.setAttribute('y1', v1.y);
      line.setAttribute('x2', v2.x);
      line.setAttribute('y2', v2.y);
      line.setAttribute('class', 'touch-target-edge');

      // Transparent hit box for easy finger tapping (32px wide)
      const hitbox = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hitbox.setAttribute('x1', v1.x);
      hitbox.setAttribute('y1', v1.y);
      hitbox.setAttribute('x2', v2.x);
      hitbox.setAttribute('y2', v2.y);
      hitbox.setAttribute('stroke', 'transparent');
      hitbox.setAttribute('stroke-width', '32');
      hitbox.setAttribute('cursor', 'pointer');

      const clickHandler = (e) => {
        e.stopPropagation();
        this.clearOverlay();
        if (window.soundEffects) window.soundEffects.playBuild();
        onSelect(eid);
      };

      g.addEventListener('click', clickHandler);
      line.addEventListener('click', clickHandler);
      hitbox.addEventListener('click', clickHandler);

      g.appendChild(line);
      g.appendChild(hitbox);
      this.overlayLayer.appendChild(g);
    });
  }

  showHexTargets(validHexIds, hexes, onSelect) {
    this.clearOverlay();
    this.activeOverlayCallback = onSelect;

    validHexIds.forEach((hid) => {
      const h = hexes[hid];
      if (!h) return;

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', h.cx);
      circle.setAttribute('cy', h.cy);
      circle.setAttribute('r', '32');
      circle.setAttribute('class', 'touch-target-hex');

      circle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearOverlay();
        onSelect(hid);
      });

      this.overlayLayer.appendChild(circle);
    });
  }

  _extractCoords(vid) {
    // vid format: v_123_456
    const parts = vid.split('_');
    if (parts.length >= 3) {
      return { x: parseFloat(parts[1]), y: parseFloat(parts[2]) };
    }
    return null;
  }
}

window.BoardRenderer = BoardRenderer;
