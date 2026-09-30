// Procedural floor generator: room graph + corridors + typed rooms + prop/trap/pentagram placement + light baking.
import { RNG, grng } from './util.js';
import { GameMap } from './map.js';
import { WALL, FLOOR, CEIL, DECAL } from './textures.js';
import { THEMES, PROPS } from './data.js';
import { bakeTorchKernel, applyKernel } from './renderer.js';

const MAPW = 60, MAPH = 60;

function rectsOverlap(a, b, pad) {
  return !(a.x + a.w + pad <= b.x - 0 || b.x + b.w + pad <= a.x - 0 || a.y + a.h + pad <= b.y - 0 || b.y + b.h + pad <= a.y - 0);
}
const inside = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
const inRing = (r, x, y) => x >= r.x - 1 && y >= r.y - 1 && x <= r.x + r.w && y <= r.y + r.h && !inside(r, x, y);
const inExpanded = (r, x, y, m) => x >= r.x - m && y >= r.y - m && x <= r.x + r.w - 1 + m && y <= r.y + r.h - 1 + m;

export function generateFloor(seed, floorIndex, themeIndex, opts = {}) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const rng = new RNG((seed * 7919 + floorIndex * 104729 + attempt * 31337) >>> 0);
    const f = tryGenerate(rng, floorIndex, themeIndex, opts);
    if (f) return f;
  }
  throw new Error('floor generation failed');
}

function tryGenerate(rng, floorIndex, themeIndex, opts) {
  const theme = THEMES[themeIndex % THEMES.length];
  const map = new GameMap(MAPW, MAPH, { ambient: theme.ambient, fog: theme.fog, fogDensity: theme.fogDensity, name: theme.name });
  map.wall.fill(theme.wall[0]);
  const targetRooms = Math.min(13, 10 + Math.floor(floorIndex / 2));
  const rooms = [];
  for (let i = 0; i < 500 && rooms.length < targetRooms; i++) {
    const w = rng.int(6, 11), h = rng.int(6, 10);
    const x = rng.int(3, MAPW - w - 4), y = rng.int(3, MAPH - h - 4);
    const r = { x, y, w, h };
    let ok = true;
    for (const o of rooms) if (rectsOverlap({ x: x - 3, y: y - 3, w: w + 6, h: h + 6 }, o, 0)) { ok = false; break; }
    if (ok) rooms.push(r);
  }
  if (rooms.length < 8) return null;
  rooms.forEach((r, i) => {
    r.id = i; r.cx = r.x + (r.w >> 1); r.cy = r.y + (r.h >> 1); r.doors = []; r.links = []; r.type = 'plain';
    r.pentagrams = []; r.traps = []; r.crystals = []; r.chests = []; r.props = []; r.torches = []; r.statue = null; r.shop = []; r.lights = [];
    r.free = new Set(); r.depth = 0;
  });

  // --- MST (Prim) on centers
  const inTree = new Set([0]); const edges = [];
  const dist = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
  while (inTree.size < rooms.length) {
    let best = null;
    for (const i of inTree) for (const r of rooms) {
      if (inTree.has(r.id)) continue;
      const d = dist(rooms[i], r) + rng.float(0, 4);
      if (!best || d < best.d) best = { a: i, b: r.id, d };
    }
    edges.push([best.a, best.b]); inTree.add(best.b);
  }
  const deg = new Array(rooms.length).fill(0);
  edges.forEach(([a, b]) => { deg[a]++; deg[b]++; });
  const leafSet = rooms.filter((r) => deg[r.id] === 1).map((r) => r.id);
  if (leafSet.length < 3) return null;

  // --- role assignment (need graph distances)
  const adj = (edgeList) => { const g = rooms.map(() => []); edgeList.forEach(([a, b]) => { g[a].push(b); g[b].push(a); }); return g; };
  const bfs = (g, s) => { const d = new Array(rooms.length).fill(-1); d[s] = 0; const q = [s]; while (q.length) { const u = q.shift(); for (const v of g[u]) if (d[v] < 0) { d[v] = d[u] + 1; q.push(v); } } return d; };
  let g = adj(edges);
  const start = rng.pick(leafSet.length ? leafSet : rooms.map((r) => r.id));
  const dS = bfs(g, start);
  const order = rooms.map((r) => r.id).sort((a, b) => dS[b] - dS[a]);
  const exit = order.find((i) => i !== start);
  const dE = bfs(g, exit);
  const portal = order.find((i) => i !== start && i !== exit && dS[i] >= 2 && deg[i] >= 2) ?? order.find((i) => i !== start && i !== exit);
  const storeCand = leafSet.filter((i) => i !== start && i !== exit && i !== portal);
  const wantStore = floorIndex !== 5 || rng.chance(0.5);
  const store = wantStore && storeCand.length ? rng.pick(storeCand) : -1;
  rooms[start].type = 'start'; rooms[exit].type = 'exit'; rooms[portal].type = 'portal';
  if (store >= 0) rooms[store].type = 'store';

  // extra loop edges (only between rooms with degree>=2, never the store)
  const extra = [];
  for (let k = 0; k < 4; k++) {
    const a = rng.pick(rooms), b = rooms.slice().sort((p, q) => dist(a, p) - dist(a, q))[rng.int(1, 3)];
    if (!b || a.id === b.id || a.id === store || b.id === store) continue;
    if (deg[a.id] < 2 || deg[b.id] < 2) continue;
    if (edges.some(([p, q]) => (p === a.id && q === b.id) || (p === b.id && q === a.id)) || extra.some(([p, q]) => (p === a.id && q === b.id) || (p === b.id && q === a.id))) continue;
    if (dist(a, b) > 32) continue;
    extra.push([a.id, b.id]);
  }
  const allEdges = edges.concat(extra);

  // --- paint rings & floors
  const nWall = theme.wall.length;
  for (const r of rooms) {
    let wallTex = rng.pick(theme.wall), floorTex = rng.pick(theme.floor), ceilTex = theme.ceil;
    if (r.type === 'store') { wallTex = WALL.store; floorTex = FLOOR.wood; }
    else if (r.type === 'portal') { wallTex = WALL.portal; floorTex = FLOOR.flag; }
    r.wallTex = wallTex; r.floorTex = floorTex; r.ceilTex = ceilTex;
  }
  // roll room types for the rest
  const remaining = rooms.filter((r) => r.type === 'plain');
  const leafRemaining = remaining.filter((r) => deg[r.id] === 1);
  if (floorIndex >= 1 && leafRemaining.length && rng.chance(0.55)) rooms[rng.pick(leafRemaining).id].type = 'treasure';
  for (const r of rooms) {
    if (r.type !== 'plain') continue;
    const roll = rng.next();
    r.type = roll < 0.42 ? 'monster' : roll < 0.62 ? 'trap' : roll < 0.88 ? 'mixed' : (floorIndex >= 1 && rng.chance(0.5) ? 'curse' : 'monster');
  }
  if (!rooms.some((r) => r.type === 'curse') && rng.chance(0.4)) { const c = rooms.filter((r) => r.type === 'monster' || r.type === 'mixed'); if (c.length) rng.pick(c).type = 'curse'; }
  for (const r of rooms) {
    if (r.type === 'treasure') { r.wallTex = WALL.gold; r.floorTex = FLOOR.goldTile; }
    if (r.type === 'curse') { r.wallTex = WALL.altar; r.floorTex = FLOOR.altar; }
    if (r.type === 'start' && floorIndex === 0) { r.wallTex = WALL.brick; r.floorTex = FLOOR.flag; }
  }
  for (const r of rooms) {
    for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (!map.inBounds(x, y)) continue;
      const ci = y * MAPW + x;
      if (inside(r, x, y)) { map.wall[ci] = 0; map.floor[ci] = r.floorTex; map.ceil[ci] = r.ceilTex; map.roomId[ci] = r.id; }
      else map.wall[ci] = r.wallTex;
    }
  }
  // accent walls: an occasional accent panel on the ring
  for (const r of rooms) {
    if (r.type === 'store' || r.type === 'portal' || r.type === 'treasure' || r.type === 'curse') continue;
    for (let i = 0; i < 3; i++) {
      const side = rng.int(0, 3), t = rng.int(1, (side < 2 ? r.w : r.h) - 2);
      const x = side === 0 ? r.x + t : side === 1 ? r.x + t : side === 2 ? r.x - 1 : r.x + r.w;
      const y = side === 0 ? r.y - 1 : side === 1 ? r.y + r.h : r.y + t;
      if (rng.chance(0.6)) { map.wall[y * MAPW + x] = theme.accent; if (side < 2) { const x2 = Math.min(r.x + r.w - 1, x + 1); map.wall[y * MAPW + x2] = theme.accent; } }
    }
  }

  // --- corridors
  const isCorridor = (x, y) => map.wall[y * MAPW + x] === 0 && map.roomId[y * MAPW + x] < 0;
  const doorCells = new Map();
  const carve = (a, b, hFirst) => {
    const ax = a.cx, ay = a.cy, bx = b.cx, by = b.cy;
    const path = [];
    const stepH = (y, x0, x1) => { const s = Math.sign(x1 - x0); for (let x = x0; x !== x1 + s; x += s) path.push([x, y]); };
    const stepV = (x, y0, y1) => { const s = Math.sign(y1 - y0); for (let y = y0; y !== y1 + s; y += s) path.push([x, y]); };
    if (hFirst) { stepH(ay, ax, bx); stepV(bx, ay, by); } else { stepV(ax, ay, by); stepH(by, ax, bx); }
    // validity: no cell may lie in another room's expanded rect
    for (const [x, y] of path) for (const o of rooms) {
      if (o === a || o === b) continue;
      if (inExpanded(o, x, y, 1)) return null;
    }
    // ring cells of a/b may only be crossed at the real entry/exit (adjacent to that room's interior)
    for (let i = 0; i < path.length; i++) {
      const [x, y] = path[i];
      for (const rm of [a, b]) {
        if (!inRing(rm, x, y)) continue;
        const prev = path[i - 1], next = path[i + 1];
        const touches = (prev && inside(rm, prev[0], prev[1])) || (next && inside(rm, next[0], next[1]));
        if (!touches) return null;
      }
    }
    return path;
  };
  const linkInfo = [];
  for (const [ai, bi] of allEdges) {
    const a = rooms[ai], b = rooms[bi];
    let hf = rng.chance(0.5);
    let path = carve(a, b, hf) || carve(a, b, !hf);
    if (!path) { if (edges.some(([p, q]) => p === ai && q === bi)) return null; continue; }
    const doorsHere = [];
    for (const [x, y] of path) {
      if (!map.inBounds(x, y)) return null;
      const ci = y * MAPW + x;
      const ra = inRing(a, x, y), rb = inRing(b, x, y);
      if (ra || rb) {
        if (!doorCells.has(ci)) { doorCells.set(ci, { x, y, rooms: [ra ? a : b] }); doorsHere.push({ x, y, room: ra ? a : b }); }
        else doorsHere.push({ x, y, room: ra ? a : b });
      } else if (!inside(a, x, y) && !inside(b, x, y)) {
        if (map.wall[ci] !== 0 || map.floor[ci] === 0) { map.wall[ci] = 0; map.floor[ci] = corridorFloor(theme, rng); map.ceil[ci] = theme.ceil; }
      }
    }
    linkInfo.push({ a: ai, b: bi, path, doors: doorsHere });
    a.links.push(bi); b.links.push(ai);
  }
  // corridor walls: cells adjacent to corridor floor that still have room texture stay; fine.
  // create doors
  for (const [ci, d] of doorCells) {
    const room = d.rooms[0];
    map.floor[ci] = room.floorTex; map.ceil[ci] = room.ceilTex;
    const door = map.addDoor(d.x, d.y, WALL.door, { room: room.id });
    room.doors.push(door);
  }
  // connectivity check over open cells (doors count as open)
  if (!connected(map, rooms[start])) return null;

  // corridor wall tex + roomId for door cells
  for (let y = 1; y < MAPH - 1; y++) for (let x = 1; x < MAPW - 1; x++) {
    const ci = y * MAPW + x;
    if (isCorridor(x, y) && map.floor[ci]) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = (y + dy) * MAPW + x + dx;
        if (map.wall[ni] !== 0 && !(map.doorIdx[ni] >= 0) && !ringOfAny(rooms, x + dx, y + dy)) map.wall[ni] = theme.wall[0];
      }
    }
  }
  for (const room of rooms) for (const door of room.doors) { map.roomId[door.y * MAPW + door.x] = -1; }

  // depth from start
  g = adj(linkInfo.map((l) => [l.a, l.b]));
  const dd = bfs(g, start);
  rooms.forEach((r) => (r.depth = dd[r.id]));

  // --- populate rooms
  const floor = { map, rooms, theme, themeIndex, floorIndex, start: rooms[start], exit: rooms[exit], portal: rooms[portal], store: store >= 0 ? rooms[store] : null, links: linkInfo, seed: rng.s };
  for (const r of rooms) populate(r, floor, rng, floorIndex, theme);
  // store sign on neighbor's door
  if (floor.store) {
    const li = linkInfo.find((l) => l.a === floor.store.id || l.b === floor.store.id);
    if (li) {
      const other = rooms[li.a === floor.store.id ? li.b : li.a];
      const dcell = li.doors.find((d) => d.room === other);
      if (dcell) other.props.push({ kind: 'sign', x: dcell.x + 0.5, y: dcell.y + 0.5, doorX: dcell.x, doorY: dcell.y, room: other.id });
      floor.storeSign = dcell;
    }
  }
  if (!validateReach(floor)) return null;
  bakeLights(floor, rng);
  return floor;
}

function corridorFloor(theme, rng) { return theme.floor[0]; }
function ringOfAny(rooms, x, y) { for (const r of rooms) if (inRing(r, x, y)) return true; return false; }

function connected(map, startRoom) {
  const seen = new Uint8Array(map.w * map.h);
  const q = [[startRoom.cx, startRoom.cy]]; seen[startRoom.cy * map.w + startRoom.cx] = 1;
  let count = 0;
  while (q.length) {
    const [x, y] = q.pop(); count++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (!map.inBounds(nx, ny)) continue;
      const ni = ny * map.w + nx; if (seen[ni]) continue;
      const open = map.wall[ni] === 0 || map.doorIdx[ni] >= 0;
      if (!open) continue; seen[ni] = 1; q.push([nx, ny]);
    }
  }
  // every room center reachable
  for (const r of [startRoom]) { /* start ok */ }
  return true && roomsAllSeen(map, seen);
}
function roomsAllSeen(map, seen) {
  // any open interior cell not reached => disconnected
  for (let i = 0; i < seen.length; i++) if (map.roomId[i] >= 0 && map.wall[i] === 0 && !seen[i]) return false;
  return true;
}

// ---------------- room population ----------------
function populate(r, floor, rng, fi, theme) {
  const { map } = floor;
  // reserve door mouths
  const reserved = new Set();
  for (const d of r.doors) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) reserved.add((d.x + dx) + ',' + (d.y + dy));
  }
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!reserved.has(x + ',' + y)) r.free.add(x + ',' + y);
  const takeAt = (x, y) => { r.free.delete(x + ',' + y); };
  const pickFree = (pred) => {
    const cands = [...r.free].map((s) => s.split(',').map(Number)).filter(([x, y]) => !pred || pred(x, y));
    if (!cands.length) return null; const c = rng.pick(cands); takeAt(c[0], c[1]); return c;
  };
  const edgeFree = (x, y) => x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
  const innerFree = (x, y) => x > r.x + 1 && y > r.y + 1 && x < r.x + r.w - 2 && y < r.y + r.h - 2;
  const nearD = (x, y, d) => Math.abs(x - r.cx) <= d && Math.abs(y - r.cy) <= d;
  const push = (arr, o) => { arr.push(o); return o; };

  // exit trapdoor in a corner first, with a clear approach
  if (r.type === 'exit') {
    const corners = [[r.x, r.y], [r.x + r.w - 1, r.y], [r.x, r.y + r.h - 1], [r.x + r.w - 1, r.y + r.h - 1]].filter(([x, y]) => !reserved.has(x + ',' + y));
    const c = corners.length ? rng.pick(corners) : [r.x, r.y];
    r.trapdoor = { x: c[0] + 0.5, y: c[1] + 0.5, cx: c[0], cy: c[1] };
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) takeAt(c[0] + dx, c[1] + dy);
  }
  // wall-mounted torches
  const nTorch = r.type === 'store' ? 3 : r.type === 'curse' ? 1 : rng.int(1, 3);
  const torchSlots = wallSlots(r, rng, r.doors);
  for (let i = 0; i < Math.min(nTorch, torchSlots.length); i++) {
    const s = torchSlots[i];
    r.torches.push(s);
  }
  // type-specific
  const big = r.w >= 8 && r.h >= 8;
  if (r.type === 'monster' || r.type === 'mixed' || r.type === 'curse' || r.type === 'exit' || (r.type === 'treasure' && rng.chance(0.75))) {
    let n = r.type === 'treasure' ? rng.int(1, 2) : r.type === 'curse' ? rng.int(3, 4) : r.type === 'exit' ? rng.int(2, 3) : rng.int(1, 3 + (fi >= 3 ? 1 : 0));
    if (r.w * r.h < 50) n = Math.min(n, 2);
    for (let i = 0; i < n; i++) { const c = pickFree((x, y) => !edgeFree(x, y) && !nearD(x, y, 0)); if (c) push(r.pentagrams, { x: c[0] + 0.5, y: c[1] + 0.5, cx: c[0], cy: c[1], used: false }); }
  }
  if (r.type === 'trap' || r.type === 'mixed' || (r.type === 'exit' && rng.chance(0.6))) {
    const nT = rng.int(2, 4);
    for (let i = 0; i < nT; i++) {
      const kind = rng.weighted(['spikes', 'flame', 'saw', 'darts', 'crusher'], (k) => ({ spikes: 3, flame: 2, saw: 2, darts: 2, crusher: 1.5 }[k]));
      if (kind === 'flame' || kind === 'darts') {
        const slot = wallSlots(r, rng, r.doors, true)[0];
        if (slot) push(r.traps, { kind, x: slot.x, y: slot.y, dir: slot.dir, wall: true, room: r.id });
      } else if (kind === 'saw') {
        const c = pickFree((x, y) => innerFree(x, y) && x + 3 < r.x + r.w - 1);
        if (c) { push(r.traps, { kind, x: c[0] + 0.5, y: c[1] + 0.5, dir: 0, track: 3, room: r.id }); takeAt(c[0] + 1, c[1]); takeAt(c[0] + 2, c[1]); }
      } else {
        const c = pickFree((x, y) => innerFree(x, y));
        if (c) push(r.traps, { kind, x: c[0] + 0.5, y: c[1] + 0.5, dir: 0, room: r.id });
      }
    }
    if (r.type === 'trap' || rng.chance(0.4)) {
      const nc = r.type === 'trap' ? rng.int(1, 3) : rng.int(0, 1);
      for (let i = 0; i < nc; i++) { const c = pickFree((x, y) => !nearD(x, y, 0)); if (c) push(r.crystals, { x: c[0] + 0.5, y: c[1] + 0.5, cx: c[0], cy: c[1] }); }
    }
    if (r.type === 'trap' && r.crystals.length === 0) { const c = pickFree(); if (c) push(r.crystals, { x: c[0] + 0.5, y: c[1] + 0.5, cx: c[0], cy: c[1] }); }
  }
  // statue (max one)
  if (['monster', 'mixed', 'curse', 'exit', 'trap'].includes(r.type) && rng.chance(0.65)) {
    const c = pickFree((x, y) => edgeFree(x, y) && !corner(r, x, y));
    if (c) r.statue = { x: c[0] + 0.5, y: c[1] + 0.5, cx: c[0], cy: c[1], kind: rng.pick(['sentinel', 'gargoyle', 'golem']), used: false };
  }
  // portal room
  if (r.type === 'portal') {
    r.portalPos = { x: r.cx + 0.5, y: r.cy + 0.5, cx: r.cx, cy: r.cy };
    for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2], [0, -2], [0, 2], [-2, 0], [2, 0]]) {
      const x = r.cx + dx, y = r.cy + dy;
      if (x > r.x && y > r.y && x < r.x + r.w - 1 && y < r.y + r.h - 1 && !reserved.has(x + ',' + y) && !(Math.abs(dx) + Math.abs(dy) === 2 && false)) { push(r.props, { kind: 'pillar', x: x + 0.5, y: y + 0.5, cx: x, cy: y }); takeAt(x, y); }
    }
    for (const [x, y] of [[r.x, r.y], [r.x + r.w - 1, r.y], [r.x, r.y + r.h - 1], [r.x + r.w - 1, r.y + r.h - 1]]) if (!reserved.has(x + ',' + y)) { push(r.chests, { x: x + 0.5, y: y + 0.5, cx: x, cy: y, tier: 1 }); takeAt(x, y); }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) takeAt(r.cx + dx, r.cy + dy);
  }
  if (r.type === 'store') {
    const rowY = r.y + Math.max(1, (r.h >> 1) - 1);
    const n = Math.min(r.w - 2, 6);
    for (let i = 0; i < n; i++) { const x = r.x + 1 + i; push(r.shop, { x: x + 0.5, y: rowY + 0.5, slot: i }); takeAt(x, rowY); }
    r.storeSafe = true;
  }
  // chests
  if (r.type === 'treasure') {
    const n = rng.int(3, 5); for (let i = 0; i < n; i++) { const c = pickFree((x, y) => edgeFree(x, y) || i > 2); if (c) push(r.chests, { x: c[0] + 0.5, y: c[1] + 0.5, cx: c[0], cy: c[1], tier: 2, locked: rng.chance(0.4), guarded: true }); }
  } else if (r.type !== 'store' && r.type !== 'portal' && r.type !== 'start') {
    if (rng.chance(0.85)) { const c = pickFree((x, y) => edgeFree(x, y)); if (c) push(r.chests, { x: c[0] + 0.5, y: c[1] + 0.5, cx: c[0], cy: c[1], tier: 0, locked: rng.chance(0.15), trapped: rng.chance(0.2) }); }
  } else if (r.type === 'start' && rng.chance(0.6)) { const c = pickFree((x, y) => edgeFree(x, y)); if (c) push(r.chests, { x: c[0] + 0.5, y: c[1] + 0.5, cx: c[0], cy: c[1], tier: 0 }); }
  // scenery
  if (r.type !== 'store') {
    const nDest = rng.int(2, r.type === 'start' ? 3 : 7);
    for (let i = 0; i < nDest; i++) {
      const c = pickFree((x, y) => edgeFree(x, y) || rng.chance(0.15));
      if (c) push(r.props, { kind: rng.pick(theme.props), x: c[0] + 0.5 + rng.float(-0.2, 0.2), y: c[1] + 0.5 + rng.float(-0.2, 0.2), cx: c[0], cy: c[1] });
    }
    if (big && r.type !== 'portal' && rng.chance(0.55)) {
      for (const [dx, dy] of [[2, 2], [r.w - 3, 2], [2, r.h - 3], [r.w - 3, r.h - 3]]) {
        const x = r.x + dx, y = r.y + dy; if (r.free.has(x + ',' + y)) { push(r.props, { kind: 'pillar', x: x + 0.5, y: y + 0.5, cx: x, cy: y }); takeAt(x, y); }
      }
    }
    if (rng.chance(0.4) && r.type !== 'portal') { const c = pickFree((x, y) => edgeFree(x, y) && !corner(r, x, y)); if (c) push(r.props, { kind: rng.pick(['sarcophagus', 'chains', 'brazier', 'fountain']), x: c[0] + 0.5, y: c[1] + 0.5, cx: c[0], cy: c[1] }); }
    if (r.type === 'monster' && rng.chance(0.5)) { const c = pickFree((x, y) => innerFree(x, y) && !nearD(x, y, 1)); if (c) push(r.props, { kind: 'chandelier', x: c[0] + 0.5, y: c[1] + 0.5, cx: c[0], cy: c[1] }); }
  }
  // lights
  if (r.type === 'curse') r.lights.push({ x: r.cx + 0.5, y: r.cy + 0.5, radius: 9, color: [1.0, 0.1, 0.08], power: 0.9 });
  if (r.type === 'portal') r.lights.push({ x: r.cx + 0.5, y: r.cy + 0.5, radius: 8, color: [0.25, 0.7, 1.0], power: 1.2 });
  if (r.type === 'treasure') r.lights.push({ x: r.cx + 0.5, y: r.cy + 0.5, radius: 8, color: [1.0, 0.8, 0.3], power: 0.7 });
  if (r.type === 'store') r.lights.push({ x: r.cx + 0.5, y: r.cy + 0.5, radius: 9, color: [1.0, 0.75, 0.4], power: 0.8 });
  r.needsClear = r.pentagrams.length > 0 || r.crystals.length > 0;
  r.cleared = !r.needsClear; r.locked = false; r.visited = false; r.liveMonsters = 0;
}
const corner = (r, x, y) => (x === r.x || x === r.x + r.w - 1) && (y === r.y || y === r.y + r.h - 1);

// Slots along the inner face of the walls, away from doors. dir: direction the object faces (into room).
function wallSlots(r, rng, doors, forTrap = false) {
  const slots = [];
  const doorNear = (x, y) => doors.some((d) => Math.abs(d.x - x) <= 1 && Math.abs(d.y - y) <= 1);
  for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
    if (!doorNear(x, r.y - 1)) slots.push({ x: x + 0.5, y: r.y + 0.08, dir: Math.PI / 2, wallCell: [x, r.y - 1] });
    if (!doorNear(x, r.y + r.h)) slots.push({ x: x + 0.5, y: r.y + r.h - 0.08, dir: -Math.PI / 2, wallCell: [x, r.y + r.h] });
  }
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
    if (!doorNear(r.x - 1, y)) slots.push({ x: r.x + 0.08, y: y + 0.5, dir: 0, wallCell: [r.x - 1, y] });
    if (!doorNear(r.x + r.w, y)) slots.push({ x: r.x + r.w - 0.08, y: y + 0.5, dir: Math.PI, wallCell: [r.x + r.w, y] });
  }
  rng.shuffle(slots);
  // spread torches: greedy min-distance
  const out = [];
  for (const s of slots) { if (out.every((o) => Math.hypot(o.x - s.x, o.y - s.y) > (forTrap ? 1.5 : 3.2))) out.push(s); }
  return out;
}

// ---------------- lighting ----------------
function bakeLights(floor, rng) {
  const { map, rooms, theme } = floor;
  map.torches = [];
  const col = theme.torch.map((c) => c * 1.3);
  const addAnim = (x, y, radius, color, kind, extra = {}) => {
    const k = bakeTorchKernel(map, x, y, radius);
    applyKernel(map.light, k, color[0], color[1], color[2], 1.0);
    const tor = Object.assign({ x, y, kernel: k, color, phase: rng.float(0, 6.28), cur: 1, kind, room: -1 }, extra);
    map.torches.push(tor); return tor;
  };
  for (const r of rooms) {
    for (const t of r.torches) {
      // light source pushed slightly into the room
      const lx = t.x + Math.cos(t.dir) * 0.35, ly = t.y + Math.sin(t.dir) * 0.35;
      t.light = addAnim(lx, ly, 6.4, col, 'torch', { room: r.id });
    }
    for (const l of r.lights) addAnim(l.x, l.y, l.radius, l.color.map((c) => c * l.power), r.type === 'curse' ? 'curse' : r.type === 'portal' ? 'portal' : 'steady', { room: r.id });
    for (const p of r.pentagrams) addAnim(p.x, p.y, 2.8, [0.75, 0.08, 0.05], 'pent', { pent: p, room: r.id });
    if (r.trapdoor) addAnim(r.trapdoor.x, r.trapdoor.y, 3.4, [0.35, 0.22, 0.07], 'steady', { room: r.id });
  }
  // corridor torches (dim, sparse)
  const seen = new Set();
  for (const l of floor.links) {
    const mid = l.path[l.path.length >> 1];
    if (!mid || rng.chance(0.5)) continue;
    const key = mid[0] + ',' + mid[1]; if (seen.has(key)) continue; seen.add(key);
    if (map.wall[mid[1] * map.w + mid[0]] !== 0 || map.roomId[mid[1] * map.w + mid[0]] >= 0) continue;
    const k = bakeTorchKernel(map, mid[0] + 0.5, mid[1] + 0.5, 4.5);
    applyKernel(map.light, k, col[0], col[1], col[2], 0.55);
  }
}

// ---------------- special maps ----------------
export function baseSpecialMap(w, h, themeIdx, extraTheme = {}) {
  const th = THEMES[themeIdx];
  const map = new GameMap(w, h, Object.assign({ ambient: th.ambient, fog: th.fog, fogDensity: th.fogDensity, name: th.name }, extraTheme));
  map.wall.fill(th.wall[0]);
  return { map, th };
}
export function carveRoom(map, r, floorTex, ceilTex, wallTex, id) {
  for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
    const ci = y * map.w + x;
    if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) { map.wall[ci] = 0; map.floor[ci] = floorTex; map.ceil[ci] = ceilTex; map.roomId[ci] = id; }
    else map.wall[ci] = wallTex;
  }
}
export function torchLightList(map, torches, color) {
  map.torches = [];
  for (const t of torches) {
    const lx = t.x + Math.cos(t.dir) * 0.35, ly = t.y + Math.sin(t.dir) * 0.35;
    const k = bakeTorchKernel(map, lx, ly, 8);
    applyKernel(map.light, k, color[0], color[1], color[2], 1.0);
    const tor = { x: lx, y: ly, kernel: k, color, phase: grng.next() * 6.28, cur: 1 }; map.torches.push(tor); t.light = tor;
  }
}

// The sealed antechamber for the opening free-for-all.
export function buildOpeningRoom(seed) {
  const { map, th } = baseSpecialMap(24, 24, 0);
  const r = { x: 5, y: 5, w: 14, h: 14, id: 0 };
  carveRoom(map, r, FLOOR.altar, CEIL.dark, WALL.altar, 0);
  // mural inscription wall at the north
  for (let x = r.x + 3; x < r.x + r.w - 3; x++) map.wall[(r.y - 1) * map.w + x] = WALL.mural;
  for (let x = r.x + 4; x < r.x + r.w - 4; x++) map.wall[(r.y + r.h) * map.w + x] = WALL.royalGlyph;
  const torches = [];
  for (let i = 0; i < 4; i++) torches.push({ x: r.x + 2.5 + i * 3.4, y: r.y + 0.08, dir: Math.PI / 2 }, { x: r.x + 2.5 + i * 3.4, y: r.y + r.h - 0.08, dir: -Math.PI / 2 });
  torchLightList(map, torches, [1.0, 0.35, 0.2]);
  const cx = r.x + 7, cy = r.y + 7;
  map.decal[cy * map.w + cx] = DECAL.pentagram;
  const pillars = [[r.x + 3, r.y + 3], [r.x + r.w - 4, r.y + 3], [r.x + 3, r.y + r.h - 4], [r.x + r.w - 4, r.y + r.h - 4]];
  const k = bakeTorchKernel(map, cx + 0.5, cy + 0.5, 7); applyKernel(map.light, k, 0.9, 0.12, 0.08, 0.9);
  const spawns = [[r.x + 1.5, r.y + 1.5, Math.PI / 4], [r.x + r.w - 1.5, r.y + 1.5, (3 * Math.PI) / 4], [r.x + r.w - 1.5, r.y + r.h - 1.5, (5 * Math.PI) / 4], [r.x + 1.5, r.y + r.h - 1.5, (7 * Math.PI) / 4]];
  return { map, rooms: [Object.assign(r, { type: 'opening', doors: [], pentagrams: [], traps: [], crystals: [], chests: [], props: pillars.map(([x, y]) => ({ kind: 'pillar', x: x + 0.5, y: y + 0.5, cx: x, cy: y })), torches, shop: [], statue: null, lights: [], free: new Set(), cx: cx, cy: cy, needsClear: false, cleared: true, links: [] })], theme: th, opening: true, spawns, altar: { x: cx + 0.5, y: cy + 0.5 } };
}

// Pre-boss chamber + boss arena in one map.
export function buildBossMap(bossId) {
  const { map, th } = baseSpecialMap(46, 46, 4, { ambient: [0.05, 0.035, 0.05] });
  const pre = { x: 18, y: 36, w: 10, h: 6, id: 0, type: 'preboss' };
  const arena = { x: 8, y: 6, w: 30, h: 24, id: 1, type: 'arena' };
  carveRoom(map, pre, FLOOR.royalFlag, CEIL.royal, WALL.gold, 0);
  const AR = { sand: [FLOOR.sand, WALL.sand], heart: [FLOOR.flesh, WALL.flesh] }[bossId] || [FLOOR.altar, WALL.altar];
  carveRoom(map, arena, AR[0], CEIL.dark, AR[1], 1);
  // corridor + boss gate
  for (let y = arena.y + arena.h + 1; y < pre.y - 1; y++) { const ci = y * map.w + 23; map.wall[ci] = 0; map.floor[ci] = FLOOR.royalFlag; map.ceil[ci] = CEIL.royal; }
  const gateY = arena.y + arena.h; map.wall[gateY * map.w + 23] = 0; map.floor[gateY * map.w + 23] = FLOOR.royalFlag; map.ceil[gateY * map.w + 23] = CEIL.royal;
  const gate = map.addDoor(23, pre.y - 1, WALL.door, { room: 0 });
  map.floor[(pre.y - 1) * map.w + 23] = FLOOR.royalFlag; map.ceil[(pre.y - 1) * map.w + 23] = CEIL.royal;
  const gate2 = map.addDoor(23, arena.y + arena.h, WALL.door, { room: 1 });
  map.floor[(arena.y + arena.h) * map.w + 23] = FLOOR.royalFlag; map.ceil[(arena.y + arena.h) * map.w + 23] = CEIL.royal;
  for (let y = arena.y + arena.h + 1; y < pre.y - 1; y++) for (const x of [22, 24]) map.wall[y * map.w + x] = WALL.gold;
  // arena torches / braziers
  const torches = [];
  for (let i = 0; i < 6; i++) torches.push({ x: arena.x + 2.5 + i * 5, y: arena.y + 0.08, dir: Math.PI / 2 }, { x: arena.x + 2.5 + i * 5, y: arena.y + arena.h - 0.08, dir: -Math.PI / 2 });
  for (let i = 0; i < 4; i++) torches.push({ x: arena.x + 0.08, y: arena.y + 3 + i * 6, dir: 0 }, { x: arena.x + arena.w - 0.08, y: arena.y + 3 + i * 6, dir: Math.PI });
  const preTorches = [{ x: pre.x + 2.5, y: pre.y + 0.08, dir: Math.PI / 2 }, { x: pre.x + 7.5, y: pre.y + 0.08, dir: Math.PI / 2 }, { x: pre.x + 2.5, y: pre.y + pre.h - 0.08, dir: -Math.PI / 2 }, { x: pre.x + 7.5, y: pre.y + pre.h - 0.08, dir: -Math.PI / 2 }];
  torchLightList(map, torches.concat(preTorches), [1.0, 0.4, 0.22]);
  const k = bakeTorchKernel(map, arena.x + arena.w / 2, arena.y + arena.h / 2, 12); applyKernel(map.light, k, 0.8, 0.12, 0.1, 0.7);
  const k2 = bakeTorchKernel(map, pre.x + 5, pre.y + 3, 7); applyKernel(map.light, k2, 0.3, 0.8, 0.9, 0.9);
  // arena pillars
  const props = [];
  for (const [x, y] of [[arena.x + 5, arena.y + 18], [arena.x + 24, arena.y + 18], [arena.x + 5, arena.y + 10], [arena.x + 24, arena.y + 10]]) props.push({ kind: 'pillar', x: x + 0.5, y: y + 0.5, cx: x, cy: y });
  pre.torches = preTorches; arena.torches = torches;
  return {
    map, theme: th, boss: bossId, rooms: [Object.assign(pre, { doors: [gate], pentagrams: [], traps: [], crystals: [], chests: [], props: [], shop: [], statue: null, lights: [], links: [], cx: pre.x + 5, cy: pre.y + 3, needsClear: false, cleared: true }),
      Object.assign(arena, { doors: [gate2], pentagrams: [], traps: [], crystals: [], chests: [], props, shop: [], statue: null, lights: [], links: [], cx: arena.x + 15, cy: arena.y + 12, needsClear: false, cleared: true })],
    gate, gate2, preRoom: pre, arena, fountain: { x: pre.x + 5, y: pre.y + 3 },
  };
}

// Reject layouts where solid props box in something the hero needs (trapdoor, portal, chests, stands, pentagrams).
function validateReach(floor) {
  const { map, rooms } = floor, W = map.w;
  const solid = new Uint8Array(map.w * map.h);
  for (const r of rooms) {
    for (const p of r.props) if (p.cx !== undefined && PROPS[p.kind] && PROPS[p.kind].solid) solid[p.cy * W + p.cx] = 1;
    for (const c of r.chests) solid[c.cy * W + c.cx] = 1;
    for (const c of r.crystals) solid[c.cy * W + c.cx] = 1;
    if (r.statue) solid[r.statue.cy * W + r.statue.cx] = 1;
    for (const s of r.shop) solid[(s.y | 0) * W + (s.x | 0)] = 1;
  }
  const seen = new Uint8Array(map.w * map.h);
  const q = [[floor.start.cx, floor.start.cy]];
  if (solid[floor.start.cy * W + floor.start.cx]) return false;
  seen[floor.start.cy * W + floor.start.cx] = 1;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, ni = ny * W + nx;
      if (!map.inBounds(nx, ny) || seen[ni] || solid[ni]) continue;
      if (map.wall[ni] !== 0 && map.doorIdx[ni] < 0) continue;
      seen[ni] = 1; q.push([nx, ny]);
    }
  }
  const nearSeen = (cx, cy) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen[(cy + dy) * W + cx + dx]);
  for (const r of rooms) {
    let any = false;
    for (let y = r.y; y < r.y + r.h && !any; y++) for (let x = r.x; x < r.x + r.w; x++) if (seen[y * W + x]) { any = true; break; }
    if (!any) return false;
    for (const c of r.chests) if (!nearSeen(c.cx, c.cy)) return false;
    for (const c of r.crystals) if (!nearSeen(c.cx, c.cy)) return false;
    for (const p of r.pentagrams) if (!seen[p.cy * W + p.cx]) return false;
    for (const s of r.shop) if (!nearSeen(s.x | 0, s.y | 0)) return false;
    if (r.statue && !nearSeen(r.statue.cx, r.statue.cy)) return false;
  }
  if (!seen[floor.exit.trapdoor.cy * W + floor.exit.trapdoor.cx]) return false;
  if (!seen[floor.portal.portalPos.cy * W + floor.portal.portalPos.cx]) return false;
  return true;
}
