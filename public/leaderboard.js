export function rankRacers(players, trackCount) {
  return [...players].sort((a, b) => {
    if (a.finishedAt != null && b.finishedAt != null) return a.finishedAt - b.finishedAt;
    if (a.finishedAt != null) return -1;
    if (b.finishedAt != null) return 1;
    return (b.lap * trackCount + b.progress) - (a.lap * trackCount + a.progress);
  });
}

export function createLeaderboard(container) {
  const list = container.querySelector('#leaderboardRows');
  const rows = new Map();
  const setText = (element, value) => {
    if (element.textContent !== value) element.textContent = value;
  };

  function makeRow() {
    const root = document.createElement('div');
    root.className = 'leaderboard-row';
    const place = document.createElement('strong');
    place.className = 'leaderboard-place';
    const swatch = document.createElement('span');
    swatch.className = 'leaderboard-swatch';
    const name = document.createElement('span');
    name.className = 'leaderboard-name';
    const lap = document.createElement('span');
    lap.className = 'leaderboard-lap';
    const speed = document.createElement('span');
    speed.className = 'leaderboard-speed';
    root.append(place, swatch, name, lap, speed);
    return { root, place, swatch, name, lap, speed };
  }

  return {
    update(room, racers, localId) {
      const metadata = new Map(room.players.map(player => [player.id, player]));
      const active = new Set(racers.map(player => player.id));
      for (const [id, row] of rows) {
        if (active.has(id)) continue;
        row.root.remove();
        rows.delete(id);
      }
      racers.forEach((player, index) => {
        let row = rows.get(player.id);
        if (!row) { row = makeRow(); rows.set(player.id, row); }
        const info = metadata.get(player.id);
        const finished = player.finishedAt != null;
        setText(row.place, String(index + 1).padStart(2, '0'));
        setText(row.name, `${info?.name || 'Pembalap'}${player.id === localId ? ' · KAMU' : ''}`);
        setText(row.lap, `${Math.min(room.laps, player.lap)}/${room.laps}`);
        setText(row.speed, finished ? 'FINIS' : String(Math.round(Math.max(0, player.speed) * .8)));
        if (info && row.color !== info.color) {
          row.swatch.style.backgroundColor = info.color;
          row.color = info.color;
        }
        row.root.classList.toggle('is-you', player.id === localId);
        row.root.classList.toggle('is-finished', finished);
        if (list.children[index] !== row.root) list.insertBefore(row.root, list.children[index] || null);
      });
    }
  };
}
