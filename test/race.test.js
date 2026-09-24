const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const track = require('../track');
const { rooms, tick, crossing, handleMessage } = require('../server');

function peer() {
  return { id: crypto.randomUUID(), room: null, closed: false, lastAction: 0,
    socket: { writableLength: 0, write() {} } };
}
function act(p, message) { p.lastAction = 0; handleMessage(p, JSON.stringify(message)); }
function cleanup() {
  for (const room of rooms.values()) { clearTimeout(room.countdownTimer); clearInterval(room.timer); }
  rooms.clear();
}

test('checkpoint crossing accepts forward movement, including wraparound', () => {
  assert.equal(crossing(10, 12, 11), true);
  assert.equal(crossing(track.count - 2, 1, 0), true);
  assert.equal(crossing(12, 10, 11), false);
  assert.equal(crossing(10, 30, 11), false);
});

test('room limit, host start, three laps, item use, and rematch', () => {
  cleanup();
  const host = peer(); act(host, { type: 'create', name: 'Host' });
  const room = host.room;
  assert.equal(room.players.length, 1);
  const others = Array.from({ length: 8 }, peer);
  for (const p of others) act(p, { type: 'join', code: room.code, name: 'Guest' });
  assert.equal(room.players.length, 8);
  assert.equal(others[7].room, null);
  act(others[0], { type: 'start' });
  assert.equal(room.phase, 'lobby');
  act(host, { type: 'start' });
  assert.equal(room.phase, 'countdown');
  clearTimeout(room.countdownTimer);
  room.phase = 'playing';
  const racer = room.players[0];
  for (const p of room.players.slice(1)) p.finishedAt = 10;
  racer.item = 'boost'; room.elapsed = 1;
  act(host, { type: 'use' });
  assert.equal(racer.item, null);
  assert.ok(racer.boostUntil > room.elapsed);
  for (let lap = 0; lap < 3; lap++) {
    for (const gate of [1, 2, 3, 0]) {
      const index = track.gates[gate];
      racer.trackIndex = (index - 1 + track.count) % track.count;
      racer.x = track.points[(index + 1) % track.count].x;
      racer.y = track.points[(index + 1) % track.count].y;
      racer.speed = 0;
      racer.input = { throttle: false, brake: false, left: false, right: false, drift: false };
      tick(room, 1 / 60);
    }
    assert.equal(racer.lap, lap + 1);
  }
  assert.equal(room.phase, 'finished');
  assert.equal(racer.rank, 8); // seven simulated earlier finishers
  assert.equal(room.results.length, 8);
  act(host, { type: 'start' });
  assert.equal(room.phase, 'countdown');
  assert.equal(racer.lap, 0);
  assert.equal(room.round, 2);
  cleanup();
});

test('server moves a kart from input and resolves a shielded trap hit', () => {
  cleanup();
  const a = peer(), b = peer();
  act(a, { type: 'create', name: 'A' });
  const room = a.room;
  act(b, { type: 'join', code: room.code, name: 'B' });
  act(a, { type: 'start' });
  clearTimeout(room.countdownTimer); room.phase = 'playing';
  const kart = room.players[0], rival = room.players[1];
  const initialX = kart.x;
  act(a, { type: 'input', seq: 7, throttle: true, left: false, right: false, brake: false, drift: false });
  assert.equal(kart.inputSeq, 7);
  for (let i = 0; i < 40; i++) tick(room, 1 / 60);
  assert.ok(kart.x > initialX + 20);
  assert.ok(kart.speed > 100);
  kart.item = 'shield'; act(a, { type: 'use' });
  assert.ok(kart.shieldUntil > room.elapsed);
  room.traps.push({ id: 99, owner: rival.id, x: kart.x, y: kart.y, expiresAt: 20 });
  tick(room, 1 / 60);
  assert.equal(kart.shieldUntil, 0);
  assert.equal(kart.stunUntil, 0);
  assert.equal(room.traps.length, 0);
  cleanup();
});
