const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const track = require('../track');
const { rooms, tick, gateCrossing, raceProgress, handleMessage } = require('../server');

function peer() {
  return { id: crypto.randomUUID(), room: null, closed: false, lastAction: 0,
    socket: { writableLength: 0, write() {} } };
}
function act(p, message) { p.lastAction = 0; handleMessage(p, JSON.stringify(message)); }
function cleanup() {
  for (const room of rooms.values()) { clearTimeout(room.countdownTimer); clearInterval(room.timer); }
  rooms.clear();
}

function atGate(gate, distance, lane = 0) {
  const point = track.points[track.gates[gate]], tangent = track.tangent(track.gates[gate]);
  return { x: point.x + tangent.x * distance - tangent.y * lane,
    y: point.y + tangent.y * distance + tangent.x * lane, angle: tangent.angle };
}

test('checkpoint crossing requires physically passing the line in the right direction', () => {
  const before = atGate(0, -5), after = atGate(0, 5);
  assert.ok(Math.abs(gateCrossing(before.x, before.y, after.x, after.y, 0) - .5) < 1e-9);
  assert.equal(gateCrossing(after.x, after.y, before.x, before.y, 0), null);
  const short = atGate(0, -1);
  assert.equal(gateCrossing(before.x, before.y, short.x, short.y, 0), null);
  const outsideBefore = atGate(0, -5, track.ROAD_HALF + 5);
  const outsideAfter = atGate(0, 5, track.ROAD_HALF + 5);
  assert.equal(gateCrossing(outsideBefore.x, outsideBefore.y, outsideAfter.x, outsideAfter.y, 0), null);
});

test('position follows the start line and the last validated checkpoint', () => {
  const atIndex = (nextGate, index) => ({ nextGate, trackIndex: index, ...track.points[index] });
  assert.equal(raceProgress(atIndex(1, track.count - 2)), -2);
  assert.equal(raceProgress(atIndex(1, 1)), 1);
  assert.ok(raceProgress(atIndex(2, track.gates[3])) < track.gates[2]);
  assert.equal(raceProgress(atIndex(3, track.gates[2] + 2)), track.gates[2] + 2);
  const index = 40, point = track.points[index], tangent = track.tangent(index);
  const behind = { nextGate: 1, trackIndex: index, x: point.x - tangent.x, y: point.y - tangent.y };
  const ahead = { nextGate: 1, trackIndex: index, x: point.x + tangent.x, y: point.y + tangent.y };
  assert.ok(raceProgress(ahead) > raceProgress(behind));
});

test('skipped and out-of-order checkpoints do not advance a lap', () => {
  cleanup();
  const a = peer(); act(a, { type: 'create', name: 'A' });
  const room = a.room; act(a, { type: 'start' });
  clearTimeout(room.countdownTimer); room.phase = 'playing';
  const racer = room.players[0];
  function pass(gate) {
    Object.assign(racer, atGate(gate, -2));
    racer.speed = 315; racer.input.throttle = true;
    tick(room, 1 / 60);
  }
  pass(0); pass(2); pass(3);
  assert.equal(racer.lap, 0);
  assert.equal(racer.nextGate, 1);
  pass(1); pass(3);
  assert.equal(racer.nextGate, 2);
  pass(2); pass(3); pass(0);
  assert.equal(racer.lap, 1);
  assert.equal(racer.finishedAt, null);
  cleanup();
});

test('two racers finish only after their own third lap', () => {
  cleanup();
  const a = peer(), b = peer();
  act(a, { type: 'create', name: 'A' });
  const room = a.room;
  act(b, { type: 'join', code: room.code, name: 'B' });
  act(a, { type: 'start' });
  clearTimeout(room.countdownTimer); room.phase = 'playing';
  const [first, second] = room.players;
  function passGate(player, gate) {
    Object.assign(player, atGate(gate, -2));
    player.speed = 315;
    player.input.throttle = true;
    tick(room, 1 / 60);
  }
  function passLap(player) { for (const gate of [1, 2, 3, 0]) passGate(player, gate); }
  for (let i = 0; i < 2; i++) { passLap(first); passLap(second); }
  assert.equal(first.lap, 2); assert.equal(second.lap, 2);
  assert.equal(first.finishedAt, null); assert.equal(second.finishedAt, null);
  passGate(first, 1); // A is physically ahead on the track, but B completes an extra lap.
  passLap(second);
  assert.equal(first.finishedAt, null);
  assert.equal(second.lap, 3);
  assert.notEqual(second.finishedAt, null);
  assert.equal(room.phase, 'playing');
  for (const gate of [2, 3, 0]) passGate(first, gate);
  assert.equal(first.lap, 3);
  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.results.map(p => p.name), ['B', 'A']);
  assert.equal(room.timedOut, false);
  cleanup();
});

test('nearest track sample cannot award an early lap', () => {
  cleanup();
  const a = peer(); act(a, { type: 'create', name: 'A' });
  const room = a.room; act(a, { type: 'start' });
  clearTimeout(room.countdownTimer); room.phase = 'playing';
  const racer = room.players[0];
  Object.assign(racer, atGate(0, -4));
  racer.nextGate = 0; racer.lap = 2; racer.speed = 60;
  racer.input.throttle = false;
  tick(room, 1 / 60);
  assert.equal(racer.trackIndex, 0); // The nearest sample has crossed; the kart has not.
  assert.equal(racer.lap, 2);
  assert.equal(racer.finishedAt, null);
  racer.speed = 315; racer.input.throttle = true;
  tick(room, 1 / 60);
  assert.equal(racer.lap, 3);
  assert.notEqual(racer.finishedAt, null);
  cleanup();
});

test('same-tick finishes are ordered by the actual line crossing time', () => {
  cleanup();
  const a = peer(), b = peer();
  act(a, { type: 'create', name: 'A' });
  const room = a.room;
  act(b, { type: 'join', code: room.code, name: 'B' });
  act(a, { type: 'start' });
  clearTimeout(room.countdownTimer); room.phase = 'playing';
  const [first, second] = room.players;
  Object.assign(first, atGate(0, -4, -27));
  Object.assign(second, atGate(0, -1, 27));
  for (const racer of [first, second]) {
    racer.lap = 2; racer.nextGate = 0; racer.speed = 315; racer.input.throttle = true;
  }
  tick(room, 1 / 60);
  assert.ok(second.finishedAt < first.finishedAt);
  assert.equal(second.rank, 1);
  assert.equal(first.rank, 2);
  assert.deepEqual(room.results.map(p => p.name), ['B', 'A']);
  cleanup();
});

test('time limit marks unfinished racers as DNF', () => {
  cleanup();
  const a = peer(), b = peer();
  act(a, { type: 'create', name: 'A' });
  const room = a.room;
  act(b, { type: 'join', code: room.code, name: 'B' });
  act(a, { type: 'start' });
  clearTimeout(room.countdownTimer); room.phase = 'playing';
  room.elapsed = 179.99;
  tick(room, 1 / 60);
  assert.equal(room.phase, 'finished');
  assert.equal(room.timedOut, true);
  assert.ok(room.results.every(p => p.time === null));
  cleanup();
});

test('crossing after the three-minute deadline is not a finish', () => {
  cleanup();
  const a = peer(); act(a, { type: 'create', name: 'A' });
  const room = a.room; act(a, { type: 'start' });
  clearTimeout(room.countdownTimer); room.phase = 'playing';
  const racer = room.players[0];
  Object.assign(racer, atGate(0, -4));
  racer.lap = 2; racer.nextGate = 0; racer.speed = 315; racer.input.throttle = true;
  room.elapsed = 179.99;
  tick(room, 1 / 60);
  assert.equal(room.phase, 'finished');
  assert.equal(room.timedOut, true);
  assert.equal(racer.finishedAt, null);
  assert.equal(room.results[0].time, null);
  cleanup();
});

test('room limit, host start, three laps, item use, and rematch', () => {
  cleanup();
  const host = peer(); act(host, { type: 'create', name: 'Host' });
  const room = host.room;
  assert.equal(room.players.length, 1);
  assert.equal(room.multiplayer, false);
  const others = Array.from({ length: 8 }, peer);
  for (const p of others) act(p, { type: 'join', code: room.code, name: 'Guest' });
  assert.equal(room.players.length, 8);
  assert.equal(others[7].room, null);
  act(others[0], { type: 'start' });
  assert.equal(room.phase, 'lobby');
  act(host, { type: 'start' });
  assert.equal(room.phase, 'countdown');
  assert.equal(room.multiplayer, true);
  clearTimeout(room.countdownTimer);
  room.phase = 'playing';
  const racer = room.players[0];
  for (const p of room.players.slice(1)) p.finishedAt = .5;
  racer.item = 'boost'; room.elapsed = 1;
  act(host, { type: 'use' });
  assert.equal(racer.item, null);
  assert.ok(racer.boostUntil > room.elapsed);
  for (let lap = 0; lap < 3; lap++) {
    for (const gate of [1, 2, 3, 0]) {
      Object.assign(racer, atGate(gate, -2));
      racer.speed = 315; racer.input.throttle = true;
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
