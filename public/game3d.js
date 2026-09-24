import { createScene } from '/scene3d.js';
import { rankRacers, createLeaderboard } from '/leaderboard.js';

(() => {
  'use strict';
  const track = window.KartTrack, physics = window.KartPhysics, $ = id => document.getElementById(id);
  const canvas = $('gameCanvas'), view = createScene(canvas, track);
  const panels = ['homePanel', 'lobbyPanel', 'resultPanel', 'countdown', 'raceHud', 'leaderboard', 'touchControls'];
  const leaderboard = createLeaderboard($('leaderboard'));
  const controls = { throttle: false, brake: false, left: false, right: false, drift: false };
  const state = { socket: null, id: null, room: null, race: null, prediction: null, samples: new Map(),
    sequence: 0, round: -1, soloPending: false, toastTimer: 0 };
  const touchDevice = matchMedia('(pointer: coarse)').matches || window.innerWidth < 700;
  const nameInput = $('nameInput');
  nameInput.value = localStorage.getItem('kart-friends-name') || '';
  $('codeInput').value = new URLSearchParams(location.search).get('room')?.slice(0, 5).toUpperCase() || '';

  function visible(id, show) { $(id).classList.toggle('hidden', !show); }
  function toast(message) {
    $('toast').textContent = message; visible('toast', true);
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => visible('toast', false), 3500);
  }
  function send(message) {
    if (state.socket?.readyState !== WebSocket.OPEN) { toast('Koneksi belum siap. Coba lagi sebentar.'); return false; }
    state.socket.send(JSON.stringify(message)); return true;
  }
  function connect() {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${scheme}//${location.host}/ws`);
    state.socket = ws;
    ws.onopen = () => { $('connectionDot').classList.add('online'); $('connectionText').textContent = 'Online'; };
    ws.onclose = () => {
      $('connectionDot').classList.remove('online'); $('connectionText').textContent = 'Terputus';
      state.room = null; state.race = null; state.id = null; state.prediction = null; state.samples.clear(); showPhase();
      toast('Koneksi terputus. Menghubungkan kembali…');
      setTimeout(connect, 1500);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = event => {
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'joined') state.id = msg.id;
      else if (msg.type === 'room') {
        if (state.round !== msg.round) { state.prediction = null; state.samples.clear(); state.round = msg.round; }
        state.room = msg; showPhase();
        if (state.soloPending && msg.phase === 'lobby' && msg.hostId === state.id) {
          state.soloPending = false; setTimeout(() => send({ type: 'start' }), 420);
        }
      } else if (msg.type === 'state') {
        receiveState(msg); updateHud();
      } else if (msg.type === 'error') toast(msg.message);
    };
  }
  connect();
  function playerName() {
    const name = nameInput.value.trim().slice(0, 16) || 'Pembalap';
    localStorage.setItem('kart-friends-name', name);
    return name;
  }
  $('createBtn').onclick = () => { state.soloPending = false; send({ type: 'create', name: playerName() }); };
  $('soloBtn').onclick = () => { state.soloPending = true; if (!send({ type: 'create', name: playerName() })) state.soloPending = false; };
  $('joinBtn').onclick = () => send({ type: 'join', name: playerName(), code: $('codeInput').value.trim().toUpperCase() });
  $('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
  $('startBtn').onclick = $('rematchBtn').onclick = () => send({ type: 'start' });
  $('leaveBtn').onclick = () => { send({ type: 'leave' }); state.room = null; state.race = null; state.id = null;
    state.prediction = null; state.samples.clear(); $('codeInput').value = '';
    history.replaceState(null, '', location.pathname); showPhase(); };
  $('copyBtn').onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${state.room.code}`;
    try { await navigator.clipboard.writeText(url); toast('Tautan undangan disalin!'); }
    catch { toast(`Bagikan kode ${state.room.code}`); }
  };
  function roster() {
    const room = state.room;
    $('roomCode').textContent = room.code;
    $('playerCount').textContent = `${room.players.length} / 8`;
    $('roster').replaceChildren(...room.players.map(p => {
      const row = document.createElement('div'); row.className = 'racer';
      const dot = document.createElement('span'); dot.className = 'racer-swatch'; dot.style.background = p.color;
      const name = document.createElement('span'); name.className = 'racer-name'; name.textContent = p.name;
      row.append(dot, name);
      if (p.id === room.hostId) { const host = document.createElement('small'); host.textContent = 'HOST'; row.append(host); }
      return row;
    }));
  }
  function resultRows() {
    $('results').replaceChildren(...state.room.results.map(p => {
      const row = document.createElement('div'); row.className = 'result-row';
      const place = document.createElement('strong'); place.textContent = String(p.place).padStart(2, '0');
      const dot = document.createElement('span'); dot.className = 'racer-swatch'; dot.style.background = p.color;
      const name = document.createElement('span'); name.className = 'result-name'; name.textContent = p.name;
      const time = document.createElement('span'); time.className = 'result-time';
      time.textContent = p.time == null ? `DNF · ${p.lap}/${state.room.laps}` : formatTime(p.time);
      row.append(place, dot, name, time); return row;
    }));
  }
  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60), rest = seconds % 60;
    return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
  }
  function showPhase() {
    const phase = state.room?.phase;
    for (const id of panels) visible(id, false);
    visible('leaveBtn', !!phase);
    if (!phase) visible('homePanel', true);
    else if (phase === 'lobby') {
      visible('lobbyPanel', true); roster();
      visible('startBtn', state.room.hostId === state.id);
      visible('waitingText', state.room.hostId !== state.id);
      history.replaceState(null, '', `?room=${state.room.code}`);
    } else if (phase === 'countdown') visible('countdown', true);
    else if (phase === 'playing') {
      visible('raceHud', true);
      visible('leaderboard', state.room.multiplayer);
      visible('touchControls', touchDevice && !localPlayer()?.finishedAt);
    } else if (phase === 'finished') {
      $('resultTitle').textContent = state.room.timedOut ? 'Waktu habis.' : 'Garis finis.';
      $('resultCopy').textContent = state.room.timedOut
        ? 'Batas 3 menit tercapai. Peringkat dihitung dari lap dan checkpoint; pembalap yang belum finis bertanda DNF.'
        : 'Tiga lap selesai. Siapa yang naik podium?';
      visible('resultPanel', true); resultRows();
      visible('rematchBtn', state.room.hostId === state.id);
      visible('rematchWaiting', state.room.hostId !== state.id);
    }
    updateHud();
  }
  function localPlayer() { return state.race?.players.find(p => p.id === state.id); }
  function updateHud() {
    if (state.room?.phase !== 'playing') return;
    const me = localPlayer(); if (!me) return;
    $('checkpointWarning').textContent = me.missedCheckpoint == null ? ''
      : `${me.missedCheckpoint === 0 ? 'Garis finis' : `Checkpoint ${me.missedCheckpoint}`} terlewat — putar balik!`;
    visible('checkpointWarning', me.missedCheckpoint != null && me.finishedAt == null);
    $('lapValue').innerHTML = `${Math.min(3, me.lap + 1)}<span>/3</span>`;
    const racers = rankRacers(state.race.players, track.count);
    if (state.room.multiplayer) leaderboard.update(state.room, racers, state.id);
    const remaining = Math.max(0, Math.ceil(state.room.raceLimit - state.race.elapsed));
    $('raceTime').textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
    $('positionValue').innerHTML = `${racers.findIndex(p => p.id === state.id) + 1}<span>/${racers.length}</span>`;
    $('speedValue').textContent = Math.round(Math.max(0, me.speed) * .8);
    const icon = { boost: '⚡', shield: '⬡', trap: '▲' };
    const label = { boost: 'BOOST', shield: 'SHIELD', trap: 'JEBAKAN' };
    $('itemIcon').textContent = icon[me.item] || '◇';
    $('itemLabel').textContent = label[me.item] || 'ITEM';
    $('itemButton').disabled = !me.item || me.finishedAt != null;
    const finished = me.finishedAt != null;
    visible('spectateBanner', finished);
    visible('touchControls', touchDevice && !finished);
    if (finished) {
      const next = state.race.players.find(p => p.finishedAt == null);
      $('spectateName').textContent = next ? `Menonton ${state.room.players.find(p => p.id === next.id)?.name || 'pembalap lain'}` : 'Menunggu hasil akhir';
    }
  }
  function useItem() { if (state.room?.phase === 'playing') send({ type: 'use' }); }
  $('itemButton').onclick = useItem;
  const keys = { ArrowUp: 'throttle', KeyW: 'throttle', ArrowDown: 'brake', KeyS: 'brake', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ShiftLeft: 'drift', ShiftRight: 'drift' };
  document.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (state.room?.phase !== 'playing') return;
    if (keys[e.code]) { controls[keys[e.code]] = true; e.preventDefault(); }
    if ((e.code === 'Space' || e.code === 'KeyE') && !e.repeat) { useItem(); e.preventDefault(); }
  });
  document.addEventListener('keyup', e => { if (keys[e.code]) { controls[keys[e.code]] = false; e.preventDefault(); } });
  function releaseControls() {
    Object.keys(controls).forEach(key => controls[key] = false);
    if (state.room?.phase === 'playing' && state.socket?.readyState === WebSocket.OPEN)
      state.socket.send(JSON.stringify({ type: 'input', seq: ++state.sequence, ...controls }));
  }
  window.addEventListener('blur', releaseControls);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseControls(); });
  document.querySelectorAll('[data-control]').forEach(button => {
    const key = button.dataset.control;
    button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); controls[key] = true; button.classList.add('active'); });
    const release = e => { e.preventDefault(); controls[key] = false; button.classList.remove('active'); };
    button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release);
  });
  setInterval(() => {
    if (document.hidden || state.room?.phase !== 'playing' || localPlayer()?.finishedAt != null || state.socket?.readyState !== WebSocket.OPEN) return;
    const sequence = ++state.sequence, input = { ...controls };
    state.socket.send(JSON.stringify({ type: 'input', seq: sequence, ...input }));
    if (state.prediction?.body) {
      physics.stepKart(state.prediction.body, input, 1 / 60, state.prediction.effects);
      state.prediction.history.push({ seq: sequence, input });
      if (state.prediction.history.length > 120) state.prediction.history.shift();
    }
  }, 1000 / 60);

  function receiveState(snapshot) {
    state.race = snapshot;
    const arrival = performance.now();
    for (const player of snapshot.players) {
      if (player.id === state.id) continue;
      const samples = state.samples.get(player.id) || [];
      samples.push({ at: arrival, player });
      if (samples.length > 6) samples.shift();
      state.samples.set(player.id, samples);
    }
    for (const id of state.samples.keys()) if (!snapshot.players.some(p => p.id === id)) state.samples.delete(id);
    const serverKart = snapshot.players.find(p => p.id === state.id);
    if (!serverKart) return;
    const body = { x: serverKart.x, y: serverKart.y, angle: serverKart.angle, speed: serverKart.speed };
    if (!state.prediction || state.room?.phase !== 'playing' || serverKart.finishedAt != null) {
      state.prediction = { body, visual: { ...body }, history: [], effects: { boost: serverKart.boost, stunned: serverKart.stunned } };
      return;
    }
    const prediction = state.prediction;
    prediction.effects = { boost: serverKart.boost, stunned: serverKart.stunned };
    prediction.history = prediction.history.filter(frame => frame.seq > serverKart.ack);
    for (const frame of prediction.history) physics.stepKart(body, frame.input, 1 / 60, prediction.effects);
    prediction.body = body;
    if (Math.hypot(prediction.visual.x - body.x, prediction.visual.y - body.y) > 100) prediction.visual = { ...body };
  }
  function remotePlayer(player, targetTime) {
    const samples = state.samples.get(player.id);
    if (!samples?.length) return player;
    let older = samples[0], newer = samples[samples.length - 1];
    for (let i = 0; i < samples.length - 1; i++) {
      if (samples[i].at <= targetTime && targetTime <= samples[i + 1].at) {
        older = samples[i]; newer = samples[i + 1]; break;
      }
      if (targetTime > samples[i + 1].at) older = newer = samples[i + 1];
    }
    const span = newer.at - older.at;
    const blend = span > 0 ? Math.max(0, Math.min(1, (targetTime - older.at) / span)) : 0;
    const angleDelta = Math.atan2(Math.sin(newer.player.angle - older.player.angle),
      Math.cos(newer.player.angle - older.player.angle));
    return { ...player, x: older.player.x + (newer.player.x - older.player.x) * blend,
      y: older.player.y + (newer.player.y - older.player.y) * blend,
      angle: older.player.angle + angleDelta * blend };
  }
  function draw(time) {
    const racers = state.race?.players || [];
    const targetTime = performance.now() - 90;
    const renderPlayers = racers.map(player => {
      if (player.id !== state.id) return remotePlayer(player, targetTime);
      const prediction = state.prediction;
      if (!prediction?.body || state.room?.phase !== 'playing' || player.finishedAt != null) return player;
      const visual = prediction.visual, body = prediction.body;
      const distance = Math.hypot(visual.x - body.x, visual.y - body.y);
      const factor = distance > 35 ? .4 : .25;
      visual.x += (body.x - visual.x) * factor;
      visual.y += (body.y - visual.y) * factor;
      visual.angle += Math.atan2(Math.sin(body.angle - visual.angle), Math.cos(body.angle - visual.angle)) * factor;
      visual.speed += (body.speed - visual.speed) * factor;
      return { ...player, ...visual };
    });
    view.render({ players: renderPlayers, metadata: state.room?.players || [], race: state.race,
      localId: state.id, multiplayer: state.room?.multiplayer, time });
    if (state.room?.phase === 'countdown')
      $('countdownNumber').textContent = Math.max(1, Math.ceil((state.room.startsAt - Date.now()) / 1000));
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
