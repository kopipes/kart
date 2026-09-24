(() => {
  'use strict';
  const track = window.KartTrack, $ = id => document.getElementById(id);
  const canvas = $('gameCanvas'), ctx = canvas.getContext('2d');
  const panels = ['homePanel', 'lobbyPanel', 'resultPanel', 'countdown', 'raceHud', 'touchControls'];
  const controls = { throttle: false, brake: false, left: false, right: false, drift: false };
  const state = { socket: null, id: null, room: null, race: null, display: new Map(), soloPending: false, toastTimer: 0 };
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
      state.room = null; state.race = null; state.id = null; showPhase();
      toast('Koneksi terputus. Menghubungkan kembali…');
      setTimeout(connect, 1500);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = event => {
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'joined') state.id = msg.id;
      else if (msg.type === 'room') {
        state.room = msg; showPhase();
        if (state.soloPending && msg.phase === 'lobby' && msg.hostId === state.id) {
          state.soloPending = false; setTimeout(() => send({ type: 'start' }), 420);
        }
      } else if (msg.type === 'state') {
        state.race = msg; updateHud();
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
    $('codeInput').value = ''; history.replaceState(null, '', location.pathname); showPhase(); };
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
      time.textContent = p.time == null ? 'DNF' : formatTime(p.time);
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
      visible('touchControls', touchDevice && !localPlayer()?.finishedAt);
    } else if (phase === 'finished') {
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
    $('lapValue').innerHTML = `${Math.min(3, me.lap + 1)}<span>/3</span>`;
    const racers = [...state.race.players].sort((a, b) => {
      if (a.finishedAt != null && b.finishedAt != null) return a.finishedAt - b.finishedAt;
      if (a.finishedAt != null) return -1; if (b.finishedAt != null) return 1;
      return b.lap * track.count + b.progress - a.lap * track.count - a.progress;
    });
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
  window.addEventListener('blur', () => Object.keys(controls).forEach(key => controls[key] = false));
  document.querySelectorAll('[data-control]').forEach(button => {
    const key = button.dataset.control;
    button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); controls[key] = true; button.classList.add('active'); });
    const release = e => { e.preventDefault(); controls[key] = false; button.classList.remove('active'); };
    button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release);
  });
  setInterval(() => {
    if (state.room?.phase === 'playing' && !localPlayer()?.finishedAt && state.socket?.readyState === WebSocket.OPEN)
      state.socket.send(JSON.stringify({ type: 'input', ...controls }));
  }, 50);

  const scenery = [];
  let seed = 82405;
  function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  for (let i = 0; i < 170; i++) {
    const x = 25 + random() * 1150, y = 25 + random() * 770;
    if (track.nearest(x, y).distance > 108) scenery.push({ x, y, size: 9 + random() * 15, kind: random() });
  }
  function pathLoop() {
    ctx.beginPath(); ctx.moveTo(track.points[0].x, track.points[0].y);
    for (let i = 1; i < track.count; i++) ctx.lineTo(track.points[i].x, track.points[i].y);
    ctx.closePath();
  }
  function drawScenery() {
    ctx.fillStyle = '#638e63'; ctx.fillRect(-100, -100, 1400, 1020);
    ctx.strokeStyle = '#ffffff0a'; ctx.lineWidth = 1;
    for (let x = 0; x < 1200; x += 45) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 820); ctx.stroke(); }
    for (let y = 0; y < 820; y += 45) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke(); }
    for (const s of scenery) {
      if (s.kind < .78) {
        ctx.fillStyle = '#345f44'; ctx.beginPath(); ctx.ellipse(s.x + 4, s.y + 6, s.size * .85, s.size * .5, .4, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = s.kind < .4 ? '#275f48' : '#39724c'; ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#76a36b'; ctx.beginPath(); ctx.arc(s.x - s.size*.3, s.y - s.size*.3, s.size*.45, 0, Math.PI*2); ctx.fill();
      } else {
        ctx.fillStyle = '#e0c975'; ctx.beginPath(); ctx.arc(s.x, s.y, 2, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#f6e6a6'; ctx.beginPath(); ctx.arc(s.x+5, s.y+2, 1.5, 0, Math.PI*2); ctx.fill();
      }
    }
    ctx.fillStyle = '#466f5b'; ctx.beginPath(); ctx.ellipse(555, 391, 152, 92, -.2, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#7ba88b'; ctx.beginPath(); ctx.ellipse(555, 391, 139, 79, -.2, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#8ebbb0'; ctx.beginPath(); ctx.ellipse(530, 370, 60, 20, -.2, 0, Math.PI*2); ctx.fill();
  }
  function drawTrack() {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    pathLoop(); ctx.strokeStyle = '#274b3d'; ctx.lineWidth = 174; ctx.stroke();
    pathLoop(); ctx.strokeStyle = '#e5d9b9'; ctx.lineWidth = 151; ctx.stroke();
    pathLoop(); ctx.strokeStyle = '#b85147'; ctx.lineWidth = 143; ctx.stroke();
    pathLoop(); ctx.strokeStyle = '#414a48'; ctx.lineWidth = 128; ctx.stroke();
    pathLoop(); ctx.strokeStyle = '#4a5350'; ctx.lineWidth = 104; ctx.stroke();
    pathLoop(); ctx.setLineDash([18, 26]); ctx.strokeStyle = '#d5d7bf83'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.setLineDash([]);
    for (let i = 0; i < track.count; i += 8) {
      const p = track.points[i], t = track.tangent(i), nx = -t.y, ny = t.x;
      ctx.strokeStyle = i % 16 ? '#f7ead8' : '#e66f59'; ctx.lineWidth = 6;
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(p.x + nx * side * 67, p.y + ny * side * 67);
        ctx.lineTo(p.x + nx * side * 74, p.y + ny * side * 74); ctx.stroke();
      }
    }
    const start = track.points[0], dir = track.tangent(0);
    ctx.save(); ctx.translate(start.x, start.y); ctx.rotate(dir.angle);
    for (let y = -60; y < 60; y += 12) for (let x = -8; x < 8; x += 8) {
      ctx.fillStyle = (Math.floor((y+60)/12) + Math.floor((x+8)/8)) % 2 ? '#fff7df' : '#26322d';
      ctx.fillRect(x, y, 8, 12);
    }
    ctx.restore();
    for (const gate of track.gates.slice(1)) {
      const p = track.points[gate], t = track.tangent(gate);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(t.angle); ctx.strokeStyle = '#f2c74a99'; ctx.lineWidth = 3;
      ctx.setLineDash([7, 8]); ctx.beginPath(); ctx.moveTo(0, -54); ctx.lineTo(0, 54); ctx.stroke(); ctx.restore(); ctx.setLineDash([]);
    }
  }
  function drawBox(box, time) {
    if (!box.ready) return;
    const bob = Math.sin(time * .004 + box.id) * 3;
    ctx.save(); ctx.translate(box.x, box.y + bob); ctx.rotate(time * .0015);
    ctx.fillStyle = '#203e39'; ctx.fillRect(-16, -16, 32, 32);
    ctx.fillStyle = '#e9c852'; ctx.fillRect(-12, -12, 24, 24);
    ctx.strokeStyle = '#fff3bd'; ctx.lineWidth = 2; ctx.strokeRect(-12, -12, 24, 24);
    ctx.rotate(-time * .0015); ctx.fillStyle = '#203e39'; ctx.font = '900 19px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', 0, -1);
    ctx.restore();
  }
  function drawTrap(trap) {
    ctx.save(); ctx.translate(trap.x, trap.y); ctx.fillStyle = '#ed674c';
    ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(17, 14); ctx.lineTo(-17, 14); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#fff2cf'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-7, 4); ctx.lineTo(7, 4); ctx.stroke(); ctx.restore();
  }
  function drawKart(p, meta, time) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
    if (p.boost) { ctx.fillStyle = '#ffc94d8c'; ctx.beginPath(); ctx.moveTo(-20, -7); ctx.lineTo(-43 - Math.sin(time*.03)*9, 0); ctx.lineTo(-20, 7); ctx.fill(); }
    ctx.fillStyle = '#102b26aa'; ctx.beginPath(); ctx.ellipse(4, 5, 29, 18, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#1b2525';
    for (const x of [-15, 14]) for (const y of [-16, 16]) ctx.fillRect(x - 6, y - 4, 12, 8);
    ctx.fillStyle = meta?.color || '#f7c843';
    ctx.beginPath(); ctx.roundRect(-22, -13, 46, 26, 8); ctx.fill();
    ctx.fillStyle = '#fcf7e5'; ctx.fillRect(18, -10, 5, 6); ctx.fillRect(18, 4, 5, 6);
    ctx.fillStyle = '#16332b'; ctx.beginPath(); ctx.roundRect(-2, -10, 16, 20, 5); ctx.fill();
    ctx.fillStyle = '#e8d9a3'; ctx.beginPath(); ctx.arc(4, 0, 7, 0, Math.PI*2); ctx.fill();
    if (p.shield) { ctx.strokeStyle = '#83eef0'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 32, 0, Math.PI*2); ctx.stroke(); }
    if (p.stunned) { ctx.fillStyle = '#fff4a1'; ctx.font = '22px system-ui'; ctx.fillText('✦', -1, -24); }
    ctx.restore();
    ctx.fillStyle = p.id === state.id ? '#fff5cb' : '#e9f1df'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.font = '900 12px system-ui'; ctx.strokeStyle = '#163327'; ctx.lineWidth = 3;
    const label = (meta?.name || 'Pembalap').slice(0, 12);
    ctx.strokeText(label, p.x, p.y - 28); ctx.fillText(label, p.x, p.y - 28);
  }
  function smoothPlayers() {
    const target = state.race?.players || [];
    for (const p of target) {
      const d = state.display.get(p.id);
      if (!d) state.display.set(p.id, { ...p });
      else {
        d.x += (p.x - d.x) * .28; d.y += (p.y - d.y) * .28;
        d.angle += Math.atan2(Math.sin(p.angle - d.angle), Math.cos(p.angle - d.angle)) * .28;
        Object.assign(d, { boost: p.boost, shield: p.shield, stunned: p.stunned, finishedAt: p.finishedAt });
      }
    }
    for (const id of state.display.keys()) if (!target.some(p => p.id === id)) state.display.delete(id);
  }
  function draw(time) {
    const width = canvas.clientWidth, height = canvas.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width*dpr) || canvas.height !== Math.round(height*dpr)) {
      canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    smoothPlayers();
    const fit = Math.min(width / track.WIDTH, height / track.HEIGHT) * .97;
    const scale = width < 700 ? Math.max(fit, Math.min(width / 560, height / 680)) : fit;
    let focus = state.display.get(state.id);
    if (focus?.finishedAt != null) focus = [...state.display.values()].find(p => p.finishedAt == null) || focus;
    const cameraX = width < 700 && focus ? focus.x : track.WIDTH / 2;
    const cameraY = width < 700 && focus ? focus.y : track.HEIGHT / 2;
    ctx.translate(width/2, height/2); ctx.scale(scale, scale); ctx.translate(-cameraX, -cameraY);
    drawScenery(); drawTrack();
    for (const b of state.race?.boxes || track.itemIndices.map((i, id) => ({ id, ...track.points[i], ready: true }))) drawBox(b, time);
    for (const t of state.race?.traps || []) drawTrap(t);
    const players = [...state.display.values()];
    for (const p of players) if (p.id !== state.id) drawKart(p, state.room?.players.find(m => m.id === p.id), time);
    const local = state.display.get(state.id);
    if (local) drawKart(local, state.room?.players.find(m => m.id === local.id), time);
    if (state.room?.phase === 'countdown') {
      const count = Math.max(1, Math.ceil((state.room.startsAt - Date.now()) / 1000));
      $('countdownNumber').textContent = count;
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
