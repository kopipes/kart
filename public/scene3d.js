import * as THREE from '/vendor/three.module.min.js';

const X0 = 600, Z0 = 410;
const at = (x, y, height = 0) => new THREE.Vector3(x - X0, height, y - Z0);
const material = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

export function createScene(canvas, track) {
  const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 700;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor('#a9d4bf');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#a9d4bf');
  scene.fog = new THREE.Fog('#a9d4bf', 500, 1150);
  const camera = new THREE.PerspectiveCamera(mobile ? 74 : 66, 1, .5, 1500);
  scene.add(new THREE.HemisphereLight('#f9f5db', '#476c4b', 2.1));
  const sun = new THREE.DirectionalLight('#fff2d3', 2.3);
  sun.position.set(-240, 400, -180); scene.add(sun);

  const grass = new THREE.Mesh(new THREE.PlaneGeometry(2700, 2300), material('#6c9a68'));
  grass.rotation.x = -Math.PI / 2; grass.position.y = -1.5; scene.add(grass);
  const infield = new THREE.Mesh(new THREE.CircleGeometry(160, 24), material('#83aaa0'));
  infield.rotation.x = -Math.PI / 2; infield.scale.set(1.5, .75, 1); infield.position.set(-35, -1.35, -20); scene.add(infield);

  function road(halfWidth, y, color) {
    const positions = new Float32Array(track.count * 2 * 3);
    const indices = new Uint16Array(track.count * 6);
    for (let i = 0; i < track.count; i++) {
      const p = track.points[i], t = track.tangent(i);
      const nx = -t.y, nz = t.x;
      positions.set([p.x - X0 + nx * halfWidth, y, p.y - Z0 + nz * halfWidth,
        p.x - X0 - nx * halfWidth, y, p.y - Z0 - nz * halfWidth], i * 6);
      const next = (i + 1) % track.count, o = i * 6;
      indices.set([i*2, next*2, i*2+1, i*2+1, next*2, next*2+1], o);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material(color, { side: THREE.DoubleSide }));
    scene.add(mesh);
  }
  road(88, -.8, '#305a49');
  road(77, -.55, '#d8d2b3');
  road(73, -.35, '#dc6551');
  road(65, -.1, '#414c49');
  road(53, -.075, '#4a5652');

  function stripeInstances(segments, width, length, height, color) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(length, .18, width),
      new THREE.MeshBasicMaterial({ color }), segments.length);
    const dummy = new THREE.Object3D();
    segments.forEach((s, i) => {
      const p = track.points[s.index], t = track.tangent(s.index);
      dummy.position.set(p.x - X0 - t.y * s.offset, height, p.y - Z0 + t.x * s.offset);
      dummy.rotation.set(0, -t.angle, 0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  }
  const curbWhite = [], curbRed = [], centerDashes = [];
  for (let i = 0; i < track.count; i += 6) {
    for (const side of [-1, 1]) (Math.floor(i / 6) % 2 ? curbRed : curbWhite).push({ index: i, offset: side * 70 });
    if (i % 12 === 0) centerDashes.push({ index: i, offset: 0 });
  }
  stripeInstances(curbWhite, 7, 28, -.18, '#fff3dd');
  stripeInstances(curbRed, 7, 28, -.18, '#d65247');
  stripeInstances(centerDashes, 2.5, 17, .05, '#e9e4c3');
  const checkWhite = [], checkDark = [];
  const start = track.points[0], startAngle = track.tangent(0).angle;
  const checkerGeo = new THREE.BoxGeometry(8, .15, 10), checkerDummy = new THREE.Object3D();
  for (let row = -6; row <= 5; row++) for (let col = 0; col < 2; col++) {
    const nx = -Math.sin(startAngle), nz = Math.cos(startAngle);
    const hx = Math.cos(startAngle), hz = Math.sin(startAngle);
    const obj = { x: start.x - X0 + nx * (row * 10 + 5) + hx * (col * 8 - 4),
      z: start.y - Z0 + nz * (row * 10 + 5) + hz * (col * 8 - 4) };
    ((row + col) % 2 ? checkDark : checkWhite).push(obj);
  }
  for (const [cells, color] of [[checkWhite, '#fbf5df'], [checkDark, '#263632']]) {
    const mesh = new THREE.InstancedMesh(checkerGeo, new THREE.MeshBasicMaterial({ color }), cells.length);
    cells.forEach((cell, i) => { checkerDummy.position.set(cell.x, .12, cell.z); checkerDummy.rotation.y = -startAngle;
      checkerDummy.updateMatrix(); mesh.setMatrixAt(i, checkerDummy.matrix); });
    mesh.instanceMatrix.needsUpdate = true; scene.add(mesh);
  }

  let seed = 82405;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const trees = [], rocks = [];
  for (let i = 0; i < 220; i++) {
    const x = 20 + random() * 1160, z = 20 + random() * 780;
    if (track.nearest(x, z).distance < 105) continue;
    const size = 10 + random() * 14;
    (random() < .76 ? trees : rocks).push({ x, z, size, tint: random() });
  }
  function instancedNature(items, geometry, baseY, baseColor, scaleFor) {
    const mesh = new THREE.InstancedMesh(geometry, material(baseColor), items.length);
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    items.forEach((item, i) => {
      dummy.position.set(item.x - X0, baseY + scaleFor(item).y * .5, item.z - Z0);
      dummy.scale.set(scaleFor(item).x, scaleFor(item).y, scaleFor(item).z);
      dummy.rotation.set(0, item.tint * Math.PI * 2, 0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      color.setHSL(.34 + item.tint * .06, .35, .27 + item.tint * .14); mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }
  instancedNature(trees, new THREE.ConeGeometry(1, 1, 6), -1.1, '#fff', t => ({ x: t.size, y: t.size * 2.2, z: t.size }));
  instancedNature(rocks, new THREE.IcosahedronGeometry(1, 0), -1, '#c8d4b3', t => ({ x: t.size*.65, y: t.size*.35, z: t.size*.7 }));
  const posts = [];
  for (let i = 4; i < track.count; i += 16) for (const side of [-1, 1]) posts.push({ index: i, offset: side * 92 });
  const postMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(2, 2, 15, 5), material('#e8d39b'), posts.length);
  const postDummy = new THREE.Object3D();
  posts.forEach((post, i) => { const p = track.points[post.index], t = track.tangent(post.index);
    postDummy.position.set(p.x - X0 - t.y * post.offset, 6.5, p.y - Z0 + t.x * post.offset);
    postDummy.updateMatrix(); postMesh.setMatrixAt(i, postDummy.matrix); });
  postMesh.instanceMatrix.needsUpdate = true; scene.add(postMesh);

  const arch = new THREE.Group(); arch.position.copy(at(start.x, start.y)); arch.rotation.y = -startAngle;
  const archMat = material('#f4c84c'), darkMat = material('#17332b');
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(9, 43, 9), archMat);
    post.position.set(0, 20, side * 79); arch.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(12, 11, 167), archMat);
  beam.position.set(0, 44, 0); arch.add(beam);
  const signCanvas = document.createElement('canvas'); signCanvas.width = 512; signCanvas.height = 128;
  const signCtx = signCanvas.getContext('2d');
  signCtx.fillStyle = '#17332b'; signCtx.fillRect(0, 0, 512, 128);
  signCtx.fillStyle = '#f4c84c'; signCtx.textAlign = 'center'; signCtx.textBaseline = 'middle';
  signCtx.font = '900 59px system-ui'; signCtx.fillText('KART FRIENDS', 256, 64);
  const signTexture = new THREE.CanvasTexture(signCanvas); signTexture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(70, 17),
    new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.DoubleSide }));
  sign.rotation.y = -Math.PI / 2; sign.position.set(-6.2, 44, 0); arch.add(sign);
  scene.add(arch);

  const bodyGeo = new THREE.BoxGeometry(39, 8, 25), noseGeo = new THREE.BoxGeometry(17, 6, 29);
  const wheelGeo = new THREE.CylinderGeometry(6.2, 6.2, 6, 8);
  const cockpitGeo = new THREE.BoxGeometry(18, 7, 19), helmetGeo = new THREE.SphereGeometry(7, 8, 6);
  const sharedWheelMat = material('#1a2727'), sharedCockpitMat = material('#244347');
  const sharedHelmetMat = material('#ffe8a8');
  const shadowGeo = new THREE.CircleGeometry(30, 16);
  const shadowMat = new THREE.MeshBasicMaterial({ color: '#1b4130', transparent: true, opacity: .28, depthWrite: false });
  function mergeParts(parts) {
    const positions = [], normals = [];
    for (const [source, x, y, z, rx = 0] of parts) {
      const copy = source.clone();
      const transform = new THREE.Matrix4().makeRotationX(rx);
      transform.setPosition(x, y, z); copy.applyMatrix4(transform);
      const geometry = copy.index ? copy.toNonIndexed() : copy;
      const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
      for (let i = 0; i < p.count; i++) {
        positions.push(p.getX(i), p.getY(i), p.getZ(i));
        normals.push(n.getX(i), n.getY(i), n.getZ(i));
      }
      if (geometry !== copy) geometry.dispose();
      copy.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return merged;
  }
  const paintGeo = mergeParts([[bodyGeo, 0, 9, 0], [noseGeo, 18, 7, 0],
    [new THREE.BoxGeometry(5, 3, 33), -20, 17, 0]]);
  const wheelParts = [];
  for (const x of [-14, 15]) for (const z of [-17, 17]) wheelParts.push([wheelGeo, x, 6, z, Math.PI/2]);
  const wheelsGeo = mergeParts(wheelParts);
  const lampGeo = new THREE.BoxGeometry(3, 4, 5);
  const lampsGeo = mergeParts([[lampGeo, 27, 10, -9], [lampGeo, 27, 10, 9]]);
  function makeName(name) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#18362ccc'; g.beginPath(); g.roundRect(3, 7, 250, 50, 18); g.fill();
    g.fillStyle = '#fff7dc'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 30px system-ui'; g.fillText(name.slice(0, 14), 128, 31);
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    label.scale.set(43, 11, 1); label.position.y = 36;
    return label;
  }
  function makeKart(color, name) {
    const root = new THREE.Group(), paint = material(color), highlight = material('#fff4d3');
    const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.rotation.x = -Math.PI/2; shadow.position.y = .12; root.add(shadow);
    root.add(new THREE.Mesh(paintGeo, paint));
    root.add(new THREE.Mesh(wheelsGeo, sharedWheelMat));
    root.add(new THREE.Mesh(lampsGeo, highlight));
    const cockpit = new THREE.Mesh(cockpitGeo, sharedCockpitMat); cockpit.position.set(-5, 15, 0); root.add(cockpit);
    const helmet = new THREE.Mesh(helmetGeo, sharedHelmetMat); helmet.position.set(-6, 19, 0); root.add(helmet);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(7, 27, 6), new THREE.MeshBasicMaterial({ color: '#f9c34d' }));
    flame.rotation.z = Math.PI/2; flame.position.set(-32, 8, 0); flame.visible = false; root.add(flame);
    const shield = new THREE.Mesh(new THREE.SphereGeometry(34, 12, 8),
      new THREE.MeshBasicMaterial({ color: '#7ee4e3', transparent: true, opacity: .18, depthWrite: false }));
    shield.position.y = 13; shield.visible = false; root.add(shield);
    const label = makeName(name); root.add(label);
    scene.add(root);
    return { root, flame, shield, label, ownedMaterials: [paint, highlight, flame.material, shield.material] };
  }
  const cars = new Map(), boxes = new Map(), traps = new Map();
  const boxGeo = new THREE.BoxGeometry(18, 18, 18), boxMat = material('#f6cb51');
  const boxEdgeGeo = new THREE.EdgesGeometry(boxGeo), boxEdgeMat = new THREE.LineBasicMaterial({ color: '#fff5b7' });
  const trapGeo = new THREE.ConeGeometry(15, 28, 4), trapMat = material('#f06b4d');
  function syncCars(players, meta, time, localId) {
    const seen = new Set();
    for (const p of players) {
      seen.add(p.id);
      let car = cars.get(p.id);
      if (!car) { car = makeKart(meta.get(p.id)?.color || '#f7c843', meta.get(p.id)?.name || 'Pembalap'); cars.set(p.id, car); }
      car.root.position.copy(at(p.x, p.y)); car.root.rotation.y = -p.angle;
      car.flame.visible = !!p.boost; car.shield.visible = !!p.shield;
      car.label.visible = p.id !== localId;
      if (p.boost) car.flame.scale.set(1, .8 + Math.sin(time*.03)*.25, 1);
    }
    for (const [id, car] of cars) if (!seen.has(id)) {
      scene.remove(car.root); car.label.material.map.dispose(); car.label.material.dispose();
      car.ownedMaterials.forEach(m => m.dispose()); cars.delete(id);
    }
  }
  function syncBoxes(data, time) {
    const seen = new Set();
    for (const b of data) {
      seen.add(b.id);
      let box = boxes.get(b.id);
      if (!box) {
        box = new THREE.Group(); box.add(new THREE.Mesh(boxGeo, boxMat), new THREE.LineSegments(boxEdgeGeo, boxEdgeMat));
        scene.add(box); boxes.set(b.id, box);
      }
      box.visible = b.ready;
      box.position.copy(at(b.x, b.y, 21 + Math.sin(time*.003 + b.id)*4));
      box.rotation.y = time*.0014 + b.id;
    }
    for (const [id, box] of boxes) if (!seen.has(id)) { scene.remove(box); boxes.delete(id); }
  }
  function syncTraps(data) {
    const seen = new Set();
    for (const t of data) {
      seen.add(t.id);
      let trap = traps.get(t.id);
      if (!trap) { trap = new THREE.Mesh(trapGeo, trapMat); scene.add(trap); traps.set(t.id, trap); }
      trap.position.copy(at(t.x, t.y, 13));
    }
    for (const [id, trap] of traps) if (!seen.has(id)) { scene.remove(trap); traps.delete(id); }
  }

  const desired = new THREE.Vector3(), lookDesired = new THREE.Vector3(), look = new THREE.Vector3();
  let cameraReady = false, lastTime = 0, frameAverage = 16.7, qualityTime = 0, diagnosticsTime = 0;
  let pixelRatio = Math.min(devicePixelRatio || 1, mobile ? 1.2 : 1.5);
  const maxRatio = pixelRatio, minRatio = .7;
  let width = 0, height = 0;
  function resize() {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    if (w === width && h === height) return;
    width = w; height = h; renderer.setPixelRatio(pixelRatio); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function render({ players = [], metadata = [], race, localId, time }) {
    resize();
    const dt = lastTime ? Math.min(.1, (time - lastTime) / 1000) : 1/60;
    if (lastTime && time - lastTime < 100) frameAverage += ((time - lastTime) - frameAverage) * .05;
    lastTime = time;
    const meta = new Map(metadata.map(p => [p.id, p]));
    syncCars(players, meta, time, localId);
    const boxData = race?.boxes || track.itemIndices.map((index, id) => ({ id, ...track.points[index], ready: true }));
    syncBoxes(boxData, time); syncTraps(race?.traps || []);
    let focus = players.find(p => p.id === localId);
    if (focus?.finishedAt != null) focus = players.find(p => p.finishedAt == null) || focus;
    if (!focus) {
      const index = Math.floor(time * .007) % track.count;
      focus = { ...track.points[index], angle: track.tangent(index).angle };
    }
    const dx = Math.cos(focus.angle), dz = Math.sin(focus.angle);
    desired.set(focus.x - X0 - dx * (mobile ? 108 : 98), mobile ? 62 : 57,
      focus.y - Z0 - dz * (mobile ? 108 : 98));
    lookDesired.set(focus.x - X0 + dx * (mobile ? 112 : 115), 10,
      focus.y - Z0 + dz * (mobile ? 112 : 115));
    if (!cameraReady) { camera.position.copy(desired); look.copy(lookDesired); cameraReady = true; }
    else {
      const factor = 1 - Math.exp(-dt * 6);
      camera.position.lerp(desired, factor); look.lerp(lookDesired, factor);
    }
    camera.lookAt(look);
    // A trailing kart can sit between the chase camera and its target on the grid.
    // Hide only karts immediately around the camera; they reappear as they move away.
    for (const [id, car] of cars) {
      const gap = Math.hypot(car.root.position.x - camera.position.x, car.root.position.z - camera.position.z);
      car.root.visible = id === focus.id || gap > 72;
    }
    renderer.render(scene, camera);
    const targetMs = mobile ? 33.3 : 16.7;
    if (document.visibilityState === 'visible' && time - qualityTime > 2000) {
      if (frameAverage > targetMs * 1.05 && pixelRatio > minRatio) pixelRatio = Math.max(minRatio, pixelRatio - .15);
      else if (frameAverage < targetMs * .66 && pixelRatio < maxRatio) pixelRatio = Math.min(maxRatio, pixelRatio + .1);
      renderer.setPixelRatio(pixelRatio); renderer.setSize(width, height, false);
      qualityTime = time;
    }
    if (time - diagnosticsTime > 500) {
      window.__kartPerf = { fps: Math.round(1000 / frameAverage), frameMs: Math.round(frameAverage * 10) / 10,
        drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        pixelRatio: Math.round(pixelRatio * 100) / 100 };
      canvas.dataset.fps = String(window.__kartPerf.fps);
      canvas.dataset.drawCalls = String(window.__kartPerf.drawCalls);
      canvas.dataset.triangles = String(window.__kartPerf.triangles);
      canvas.dataset.pixelRatio = String(window.__kartPerf.pixelRatio);
      diagnosticsTime = time;
    }
  }
  return { render };
}
