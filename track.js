// Shared track geometry for the server and browser. All coordinates are game units.
(function (root, factory) {
  const track = factory();
  if (typeof module === 'object' && module.exports) module.exports = track;
  else root.KartTrack = track;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const WIDTH = 1200, HEIGHT = 820, ROAD_HALF = 64, SAMPLES_PER_BEND = 24;
  const anchors = [
    [595, 125], [805, 128], [1000, 207], [1085, 362],
    [1034, 530], [880, 654], [682, 670], [520, 613],
    [348, 678], [182, 591], [119, 420], [164, 251], [333, 152]
  ];
  function catmull(a, b, c, d, t) {
    const t2 = t * t, t3 = t2 * t;
    return .5 * ((2 * b) + (-a + c) * t + (2*a - 5*b + 4*c - d) * t2 + (-a + 3*b - 3*c + d) * t3);
  }
  const points = [];
  for (let i = 0; i < anchors.length; i++) {
    const prev = anchors[(i - 1 + anchors.length) % anchors.length];
    const a = anchors[i], b = anchors[(i + 1) % anchors.length], next = anchors[(i + 2) % anchors.length];
    for (let j = 0; j < SAMPLES_PER_BEND; j++) {
      const t = j / SAMPLES_PER_BEND;
      points.push({ x: catmull(prev[0], a[0], b[0], next[0], t), y: catmull(prev[1], a[1], b[1], next[1], t) });
    }
  }
  const count = points.length;
  function tangent(index) {
    const a = points[(index - 1 + count) % count], b = points[(index + 1) % count];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    return { x: Math.cos(angle), y: Math.sin(angle), angle };
  }
  function nearest(x, y) {
    let index = 0, distanceSq = Infinity;
    for (let i = 0; i < count; i++) {
      const dx = x - points[i].x, dy = y - points[i].y, d = dx*dx + dy*dy;
      if (d < distanceSq) { index = i; distanceSq = d; }
    }
    return { index, distance: Math.sqrt(distanceSq) };
  }
  const gates = [0, Math.floor(count / 4), Math.floor(count / 2), Math.floor(count * 3 / 4)];
  const itemIndices = [33, 89, 145, 203, 260];
  return { WIDTH, HEIGHT, ROAD_HALF, points, count, tangent, nearest, gates, itemIndices };
});
