// Kart Friends: dependency-free, authoritative multiplayer server.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const track = require('./track');

const PORT = Number(process.env.PORT || 3217);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PLAYERS = 8, TICK = 1 / 60, LAPS = 3, RACE_LIMIT = 180;
const COLORS = ['#f7c843', '#ff6868', '#57cbd3', '#a782f3', '#ff9a51', '#8ed66e', '#e684bd', '#79a6ff'];
const rooms = new Map(), peers = new Set();
const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['public/index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/game.js', ['public/game.js', 'text/javascript; charset=utf-8']],
  ['/track.js', ['track.js', 'text/javascript; charset=utf-8']]
]);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  }
  const asset = assets.get(url.pathname);
  if (!asset || req.method !== 'GET') { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  fs.createReadStream(path.join(__dirname, asset[0])).pipe(res);
});

function frame(payload, opcode = 1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (data.length < 126) return Buffer.concat([Buffer.from([0x80 | opcode, data.length]), data]);
  const head = Buffer.alloc(4);
  head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(data.length, 2);
  return Buffer.concat([head, data]);
}
function send(peer, message) {
  if (!peer || peer.closed) return;
  if (peer.socket.writableLength > 256 * 1024) return peer.socket.destroy();
  peer.socket.write(frame(JSON.stringify(message)));
}
function broadcast(room, message) { for (const p of room.players) send(p.peer, message); }
function cleanName(value) {
  return (typeof value === 'string' ? value : '').replace(/[\x00-\x1f\x7f<>]/g, '').trim().slice(0, 16) || 'Pembalap';
}
function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from(crypto.randomBytes(5), n => alphabet[n % alphabet.length]).join(''); } while (rooms.has(code));
  return code;
}
function positionAtGrid(i) {
  const lane = i % 2 ? 27 : -27, back = 48 + Math.floor(i / 2) * 47;
  const p = track.points[0], t = track.tangent(0);
  return { x: p.x - t.x * back - t.y * lane, y: p.y - t.y * back + t.x * lane, angle: t.angle };
}
function makePlayer(peer, name, color) {
  return { peer, id: peer.id, name: cleanName(name), color, x: 0, y: 0, angle: 0, speed: 0,
    input: { throttle: false, brake: false, left: false, right: false, drift: false },
    lap: 0, nextGate: 1, trackIndex: 0, item: null, boostUntil: 0, shieldUntil: 0, stunUntil: 0,
    finishedAt: null, rank: null, offroad: false, lastItemAt: 0 };
}
function roomSnapshot(room) {
  return { type: 'room', code: room.code, phase: room.phase, hostId: room.hostId, round: room.round,
    startsAt: room.startsAt, elapsed: room.elapsed, laps: LAPS,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, lap: p.lap, finishedAt: p.finishedAt, rank: p.rank })),
    results: room.results };
}
function stateSnapshot(room) {
  return { type: 'state', phase: room.phase, elapsed: room.elapsed, now: Date.now(),
    players: room.players.map(p => ({ id: p.id, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
      angle: p.angle, speed: Math.round(p.speed), lap: p.lap, progress: p.trackIndex,
      item: p.item, boost: room.elapsed < p.boostUntil, shield: room.elapsed < p.shieldUntil,
      stunned: room.elapsed < p.stunUntil, finishedAt: p.finishedAt, rank: p.rank })),
    boxes: room.boxes.map(b => ({ id: b.id, x: b.x, y: b.y, ready: b.readyAt <= room.elapsed })),
    traps: room.traps.map(t => ({ id: t.id, x: t.x, y: t.y })) };
}
function addPlayer(room, peer, name) {
  const used = new Set(room.players.map(p => p.color));
  const color = COLORS.find(c => !used.has(c));
  const player = makePlayer(peer, name, color);
  room.players.push(player); peer.room = room;
  send(peer, { type: 'joined', id: peer.id });
  broadcast(room, roomSnapshot(room));
}
function createRoom(peer, name) {
  if (rooms.size >= 500) return send(peer, { type: 'error', message: 'Server sedang penuh. Coba lagi sebentar.' });
  leave(peer);
  const room = { code: roomCode(), hostId: peer.id, phase: 'lobby', players: [], round: 0, startsAt: null,
    elapsed: 0, timer: null, countdownTimer: null, boxes: [], traps: [], nextTrapId: 1, results: [] };
  rooms.set(room.code, room); addPlayer(room, peer, name);
}
function joinRoom(peer, code, name) {
  const room = rooms.get((typeof code === 'string' ? code : '').trim().toUpperCase());
  if (!room) return send(peer, { type: 'error', message: 'Kode ruang tidak ditemukan.' });
  if (room.phase !== 'lobby') return send(peer, { type: 'error', message: 'Balapan sudah dimulai. Tunggu sesi berikutnya.' });
  if (room.players.length >= MAX_PLAYERS) return send(peer, { type: 'error', message: 'Ruang penuh (maksimal 8 pemain).' });
  leave(peer); addPlayer(room, peer, name);
}
function leave(peer) {
  const room = peer.room;
  if (!room) return;
  peer.room = null;
  const i = room.players.findIndex(p => p.peer === peer);
  if (i < 0) return;
  room.players.splice(i, 1);
  if (!room.players.length) {
    clearInterval(room.timer); clearTimeout(room.countdownTimer); rooms.delete(room.code); return;
  }
  if (room.hostId === peer.id) room.hostId = room.players[0].id;
  if (room.phase === 'playing' && room.players.every(p => p.finishedAt !== null)) finish(room);
  else broadcast(room, roomSnapshot(room));
}
function start(room) {
  if (!['lobby', 'finished'].includes(room.phase)) return;
  clearInterval(room.timer); clearTimeout(room.countdownTimer);
  room.round++; room.phase = 'countdown'; room.startsAt = Date.now() + 3000;
  room.elapsed = 0; room.results = []; room.traps = []; room.nextTrapId = 1;
  room.boxes = track.itemIndices.map((index, id) => ({ id, x: track.points[index].x, y: track.points[index].y, readyAt: 0 }));
  room.players.forEach((p, i) => {
    Object.assign(p, positionAtGrid(i), { speed: 0, lap: 0, nextGate: 1, trackIndex: 0, item: null,
      boostUntil: 0, shieldUntil: 0, stunUntil: 0, finishedAt: null, rank: null, offroad: false, lastItemAt: 0 });
    p.input = { throttle: false, brake: false, left: false, right: false, drift: false };
  });
  broadcast(room, roomSnapshot(room)); broadcast(room, stateSnapshot(room));
  room.countdownTimer = setTimeout(() => {
    if (room.phase !== 'countdown') return;
    room.phase = 'playing'; room.startsAt = null;
    broadcast(room, roomSnapshot(room));
    room.timer = setInterval(() => tick(room, TICK), 1000 / 60);
  }, 3000);
}
function crossing(from, to, gate) {
  const distance = (to - from + track.count) % track.count;
  const towardGate = (gate - from + track.count) % track.count;
  return distance > 0 && distance <= 9 && towardGate > 0 && towardGate <= distance;
}
function useItem(room, p) {
  if (room.phase !== 'playing' || p.finishedAt !== null || !p.item || room.elapsed - p.lastItemAt < .25) return;
  const item = p.item; p.item = null; p.lastItemAt = room.elapsed;
  if (item === 'boost') p.boostUntil = Math.max(p.boostUntil, room.elapsed + 2.2);
  else if (item === 'shield') p.shieldUntil = room.elapsed + 5;
  else if (item === 'trap') {
    room.traps.push({ id: room.nextTrapId++, owner: p.id, x: p.x - Math.cos(p.angle) * 36,
      y: p.y - Math.sin(p.angle) * 36, expiresAt: room.elapsed + 14 });
  }
}
function tick(room, dt) {
  if (room.phase !== 'playing') return;
  room.elapsed += dt;
  for (const p of room.players) {
    if (p.finishedAt !== null) continue;
    const input = p.input, stunned = room.elapsed < p.stunUntil;
    const before = p.trackIndex;
    const nearBefore = track.nearest(p.x, p.y);
    const offroad = nearBefore.distance > track.ROAD_HALF - 10;
    p.offroad = offroad;
    const boost = room.elapsed < p.boostUntil;
    const maxSpeed = stunned ? 72 : offroad ? 130 : boost ? 440 : 315;
    if (input.throttle && !stunned) p.speed += (boost ? 420 : 290) * dt;
    else if (input.brake) p.speed -= 330 * dt;
    else p.speed *= Math.pow(.985, dt * 60);
    if (input.brake && p.speed > 0) p.speed -= 180 * dt;
    p.speed = Math.max(-95, Math.min(maxSpeed, p.speed));
    if (offroad && p.speed > maxSpeed) p.speed = Math.max(maxSpeed, p.speed - 350 * dt);
    if (stunned) p.speed *= Math.pow(.95, dt * 60);
    const steer = Number(input.right) - Number(input.left);
    const steeringGrip = Math.min(1, Math.abs(p.speed) / 95);
    p.angle += steer * (input.drift ? 3.85 : 2.9) * steeringGrip * Math.sign(p.speed || 1) * dt;
    if (input.drift) p.speed *= Math.pow(.994, dt * 60);
    p.x = Math.max(15, Math.min(track.WIDTH - 15, p.x + Math.cos(p.angle) * p.speed * dt));
    p.y = Math.max(15, Math.min(track.HEIGHT - 15, p.y + Math.sin(p.angle) * p.speed * dt));
    const near = track.nearest(p.x, p.y);
    p.trackIndex = near.index;
    if (near.distance < track.ROAD_HALF - 6 && crossing(before, near.index, track.gates[p.nextGate])) {
      if (p.nextGate === 0) {
        p.lap++;
        if (p.lap >= LAPS) {
          p.finishedAt = room.elapsed; p.rank = room.players.filter(q => q.finishedAt !== null).length;
          p.speed = 0; p.input = { throttle: false, brake: false, left: false, right: false, drift: false };
        }
      }
      p.nextGate = (p.nextGate + 1) % 4;
    }
    if (!p.item) for (const box of room.boxes) {
      if (box.readyAt > room.elapsed || Math.hypot(p.x - box.x, p.y - box.y) > 30) continue;
      p.item = ['boost', 'shield', 'trap'][crypto.randomInt(3)];
      box.readyAt = room.elapsed + 8;
      break;
    }
  }
  room.traps = room.traps.filter(t => t.expiresAt > room.elapsed);
  for (const t of [...room.traps]) for (const p of room.players) {
    if (p.id === t.owner || p.finishedAt !== null || Math.hypot(p.x - t.x, p.y - t.y) > 25) continue;
    if (p.shieldUntil > room.elapsed) p.shieldUntil = 0;
    else { p.stunUntil = room.elapsed + 1.15; p.speed *= .3; }
    room.traps.splice(room.traps.indexOf(t), 1);
    break;
  }
  // A finished player remains in the room and receives state updates to spectate.
  if (room.players.every(p => p.finishedAt !== null) || room.elapsed >= RACE_LIMIT) return finish(room);
  if (Math.floor(room.elapsed * 20) !== Math.floor((room.elapsed - dt) * 20)) broadcast(room, stateSnapshot(room));
}
function finish(room) {
  if (room.phase !== 'playing') return;
  room.phase = 'finished'; clearInterval(room.timer); room.timer = null;
  const ranked = [...room.players].sort((a, b) => {
    if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
    if (a.finishedAt !== null) return -1;
    if (b.finishedAt !== null) return 1;
    return (b.lap * track.count + b.trackIndex) - (a.lap * track.count + a.trackIndex);
  });
  room.results = ranked.map((p, i) => ({ id: p.id, name: p.name, color: p.color, place: i + 1,
    time: p.finishedAt, lap: p.lap }));
  broadcast(room, stateSnapshot(room)); broadcast(room, roomSnapshot(room));
}
function handleMessage(peer, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg !== 'object') return;
  const now = Date.now();
  if (['create', 'join', 'leave', 'start'].includes(msg.type)) {
    if (now - peer.lastAction < 350) return;
    peer.lastAction = now;
  }
  if (msg.type === 'create') createRoom(peer, msg.name);
  else if (msg.type === 'join') joinRoom(peer, msg.code, msg.name);
  else if (msg.type === 'leave') leave(peer);
  else if (msg.type === 'start' && peer.room?.hostId === peer.id) start(peer.room);
  else if (msg.type === 'input' && peer.room?.phase === 'playing') {
    const p = peer.room.players.find(x => x.peer === peer);
    if (p && p.finishedAt === null) for (const key of ['throttle', 'brake', 'left', 'right', 'drift']) p.input[key] = msg[key] === true;
  } else if (msg.type === 'use' && peer.room?.phase === 'playing') {
    const p = peer.room.players.find(x => x.peer === peer);
    if (p) useItem(peer.room, p);
  }
}
function handleFrames(peer, bytes) {
  peer.lastSeen = Date.now(); peer.buffer = Buffer.concat([peer.buffer, bytes]);
  if (peer.buffer.length > 8192) return peer.socket.destroy();
  while (peer.buffer.length >= 2) {
    const first = peer.buffer[0], second = peer.buffer[1];
    let length = second & 127, offset = 2;
    if (length === 126) { if (peer.buffer.length < 4) return; length = peer.buffer.readUInt16BE(2); offset = 4; }
    else if (length === 127) return peer.socket.destroy();
    if (!(second & 128) || length > 4096 || !(first & 128)) return peer.socket.destroy();
    if (peer.buffer.length < offset + 4 + length) return;
    const mask = peer.buffer.subarray(offset, offset + 4);
    const data = Buffer.from(peer.buffer.subarray(offset + 4, offset + 4 + length));
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    peer.buffer = peer.buffer.subarray(offset + 4 + length);
    const opcode = first & 15;
    if (opcode === 8) { peer.socket.end(); return; }
    if (opcode === 9) { peer.socket.write(frame(data, 10)); continue; }
    if (opcode === 10) continue;
    if (opcode === 1) handleMessage(peer, data.toString('utf8'));
    else return peer.socket.destroy();
  }
}
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket' || !req.headers['sec-websocket-key']) return socket.destroy();
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin).host; } catch { return socket.destroy(); }
    if (origin !== req.headers.host) return socket.destroy();
  }
  const ip = socket.remoteAddress;
  if (peers.size >= 1000 || [...peers].filter(p => p.ip === ip).length >= 20) return socket.destroy();
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const peer = { id: crypto.randomUUID(), ip, socket, room: null, buffer: Buffer.alloc(0), closed: false, lastSeen: Date.now(), lastAction: 0 };
  peers.add(peer);
  socket.on('data', bytes => handleFrames(peer, bytes));
  socket.on('close', () => { peer.closed = true; peers.delete(peer); leave(peer); });
  socket.on('error', () => { peer.closed = true; peers.delete(peer); leave(peer); });
  if (head.length) handleFrames(peer, head);
});
const heartbeat = setInterval(() => {
  const now = Date.now();
  for (const peer of peers) {
    if (now - peer.lastSeen > 65000 || peer.socket.writableLength > 256 * 1024) peer.socket.destroy();
    else if (!peer.closed) peer.socket.write(frame(Buffer.alloc(0), 9));
  }
}, 25000);
heartbeat.unref();
if (require.main === module) server.listen(PORT, HOST, () => console.log(`Kart Friends ready at http://${HOST}:${PORT}`));
module.exports = { server, rooms, peers, tick, start, finish, crossing, positionAtGrid, handleMessage };
