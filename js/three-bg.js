(function(){
const container = document.getElementById('bg3d');
const W = window.innerWidth, H = window.innerHeight;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, W/H, 0.1, 100);
camera.position.set(0, 0.5, 6.5);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(W, H);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const C = new THREE.Color();

// ── starfield (tiny specks only, no visible squares) ──
function starLayer(count, spread, size, hue, sat) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const r = spread[0] + Math.random() * (spread[1] - spread[0]);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i3+1] = r * Math.sin(phi) * Math.sin(theta) * 0.3;
    pos[i3+2] = r * Math.cos(phi);
    C.setHSL(hue, sat, 0.25 + Math.random() * 0.5);
    col[i3] = C.r; col[i3+1] = C.g; col[i3+2] = C.b;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
    size, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, depthWrite: false
  })));
}
starLayer(2500, [20, 40], 0.02, 0.58, 0.1);
starLayer(800, [10, 22], 0.035, 0.55, 0.2);

// ── large torus knot (surface particles) ──
const tkGeo = new THREE.TorusKnotGeometry(1.6, 0.55, 200, 28);
const tkPosA = tkGeo.getAttribute('position').array;
const tkCount = 3500;
const tkPts = new Float32Array(tkCount * 3);
const tkCol = new Float32Array(tkCount * 3);
for (let i = 0; i < tkCount; i++) {
  const idx = Math.floor(Math.random() * tkPosA.length / 3) * 3;
  const x = tkPosA[idx] + (Math.random() - 0.5) * 0.006;
  const y = tkPosA[idx + 1] + (Math.random() - 0.5) * 0.006;
  const z = tkPosA[idx + 2] + (Math.random() - 0.5) * 0.006;
  const l = 1.6 / Math.sqrt(x * x + y * y + z * z);
  tkPts[i * 3] = x * l; tkPts[i * 3 + 1] = y * l; tkPts[i * 3 + 2] = z * l;
  C.setHSL(0.52 + Math.random() * 0.08, 0.7, 0.35 + Math.random() * 0.3);
  tkCol[i * 3] = C.r; tkCol[i * 3 + 1] = C.g; tkCol[i * 3 + 2] = C.b;
}
const tkMesh = new THREE.Points(
  new THREE.BufferGeometry()
    .setAttribute('position', new THREE.BufferAttribute(tkPts, 3))
    .setAttribute('color', new THREE.BufferAttribute(tkCol, 3)),
  new THREE.PointsMaterial({ size: 0.04, vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, depthWrite: false })
);
scene.add(tkMesh);
tkGeo.dispose();

// ── inner glow ──
const sp = new Float32Array(600 * 3);
const sc = new Float32Array(600 * 3);
for (let i = 0; i < 600; i++) {
  const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), r = 0.45 + Math.random() * 0.2;
  sp[i * 3] = r * Math.sin(ph) * Math.cos(th);
  sp[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
  sp[i * 3 + 2] = r * Math.cos(ph);
  C.setHSL(0.54, 0.8, 0.2 + Math.random() * 0.3);
  sc[i * 3] = C.r; sc[i * 3 + 1] = C.g; sc[i * 3 + 2] = C.b;
}
const core = new THREE.Points(
  new THREE.BufferGeometry()
    .setAttribute('position', new THREE.BufferAttribute(sp, 3))
    .setAttribute('color', new THREE.BufferAttribute(sc, 3)),
  new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, depthWrite: false })
);
scene.add(core);

// ── dense orbital rings ──
function ring(radius, count, size, hue, thick, op) {
  const p = new Float32Array(count * 3), c = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const rad = radius + (Math.random() - 0.5) * thick;
    p[i * 3] = Math.cos(a) * rad;
    p[i * 3 + 1] = (Math.random() - 0.5) * thick * 0.15;
    p[i * 3 + 2] = Math.sin(a) * rad;
    C.setHSL(hue + (Math.random() - 0.5) * 0.04, 0.6, 0.3 + Math.random() * 0.3);
    c[i * 3] = C.r; c[i * 3 + 1] = C.g; c[i * 3 + 2] = C.b;
  }
  return new THREE.Points(
    new THREE.BufferGeometry()
      .setAttribute('position', new THREE.BufferAttribute(p, 3))
      .setAttribute('color', new THREE.BufferAttribute(c, 3)),
    new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, opacity: op,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, depthWrite: false })
  );
}
const r1 = ring(2.3, 1200, 0.035, 0.56, 0.06, 0.5);
r1.rotation.x = 0.4;
scene.add(r1);
const r2 = ring(3.0, 900, 0.03, 0.52, 0.08, 0.35);
r2.rotation.x = -0.3; r2.rotation.z = 0.5;
scene.add(r2);
const r3 = ring(3.8, 700, 0.025, 0.50, 0.1, 0.2);
r3.rotation.x = 0.7; r3.rotation.z = -0.3;
scene.add(r3);

// ── wide dust ring ──
const dp = new Float32Array(800 * 3), dc = new Float32Array(800 * 3);
for (let i = 0; i < 800; i++) {
  const a = Math.random() * Math.PI * 2, rad = 2.5 + Math.random() * 1.8;
  dp[i * 3] = Math.cos(a) * rad;
  dp[i * 3 + 1] = (Math.random() - 0.5) * 0.6;
  dp[i * 3 + 2] = Math.sin(a) * rad;
  C.setHSL(0.54, 0.4, 0.1 + Math.random() * 0.15);
  dc[i * 3] = C.r; dc[i * 3 + 1] = C.g; dc[i * 3 + 2] = C.b;
}
const dust = new THREE.Points(
  new THREE.BufferGeometry()
    .setAttribute('position', new THREE.BufferAttribute(dp, 3))
    .setAttribute('color', new THREE.BufferAttribute(dc, 3)),
  new THREE.PointsMaterial({ size: 0.025, vertexColors: true, transparent: true, opacity: 0.25,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, depthWrite: false })
);
scene.add(dust);

// ── orbiting particle clusters ──
const clusters = [];
for (let ci = 0; ci < 6; ci++) {
  const n = 60;
  const p = new Float32Array(n * 3), c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    const r = 0.06 + Math.random() * 0.08;
    p[i * 3] = r * Math.sin(ph) * Math.cos(th);
    p[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    p[i * 3 + 2] = r * Math.cos(ph);
    C.setHSL(0.56 + Math.random() * 0.08, 0.7, 0.4 + Math.random() * 0.3);
    c[i * 3] = C.r; c[i * 3 + 1] = C.g; c[i * 3 + 2] = C.b;
  }
  const mesh = new THREE.Points(
    new THREE.BufferGeometry()
      .setAttribute('position', new THREE.BufferAttribute(p, 3))
      .setAttribute('color', new THREE.BufferAttribute(c, 3)),
    new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, depthWrite: false })
  );
  const a = (ci / 6) * Math.PI * 2;
  mesh.userData = { angle: a, radius: 3.0 + Math.random() * 1.0, speed: 0.003 + Math.random() * 0.003, yOff: (Math.random() - 0.5) * 1.5, phase: Math.random() * 6.28 };
  scene.add(mesh);
  clusters.push(mesh);
}

// ── flowing energy stream ──
const streamCount = 600;
const sp2 = new Float32Array(streamCount * 3), sc2 = new Float32Array(streamCount * 3);
for (let i = 0; i < streamCount; i++) {
  const t = i / streamCount;
  const a = t * Math.PI * 4;
  const rad = 1.6 + Math.sin(a * 0.5) * 0.8;
  sp2[i * 3] = Math.cos(a) * rad + (Math.random() - 0.5) * 0.03;
  sp2[i * 3 + 1] = Math.sin(a * 0.7) * 0.6 + (Math.random() - 0.5) * 0.03;
  sp2[i * 3 + 2] = Math.sin(a) * rad + (Math.random() - 0.5) * 0.03;
  C.setHSL(0.50 + t * 0.12, 0.6, 0.25 + Math.random() * 0.25);
  sc2[i * 3] = C.r; sc2[i * 3 + 1] = C.g; sc2[i * 3 + 2] = C.b;
}
const stream = new THREE.Points(
  new THREE.BufferGeometry()
    .setAttribute('position', new THREE.BufferAttribute(sp2, 3))
    .setAttribute('color', new THREE.BufferAttribute(sc2, 3)),
  new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, depthWrite: false })
);
scene.add(stream);

// ── mouse ──
let mx = 0, my = 0, sx = 0, sy = 0;
window.addEventListener('mousemove', e => {
  mx = (e.clientX / W) * 2 - 1;
  my = -(e.clientY / H) * 2 + 1;
});
window.addEventListener('touchmove', e => {
  const t = e.touches[0];
  if (t) { mx = (t.clientX / W) * 2 - 1; my = -(t.clientY / H) * 2 + 1; }
});

// ── resize ──
window.addEventListener('resize', () => {
  const ww = window.innerWidth, wh = window.innerHeight;
  camera.aspect = ww / wh;
  camera.updateProjectionMatrix();
  renderer.setSize(ww, wh);
});

// ── animate ──
function anim() {
  requestAnimationFrame(anim);
  const t = performance.now() / 1000;

  sx += (mx - sx) * 0.03;
  sy += (my - sy) * 0.03;

  tkMesh.rotation.y = t * 0.06 + sx * 0.2;
  tkMesh.rotation.x = Math.sin(t * 0.04) * 0.05 + sy * 0.1;
  core.rotation.y = tkMesh.rotation.y * 0.7;
  core.rotation.x = tkMesh.rotation.x * 0.7;

  r1.rotation.y += 0.005;
  r2.rotation.y -= 0.004;
  r3.rotation.y += 0.003;
  dust.rotation.y += 0.003;

  // animate stream
  const spArr = stream.geometry.attributes.position.array;
  for (let i = 0; i < streamCount; i++) {
    const i3 = i * 3;
    const tOff = t * 0.15;
    const a = (i / streamCount) * Math.PI * 4 + tOff;
    const rad = 1.6 + Math.sin(a * 0.5) * 0.8;
    spArr[i3] = Math.cos(a) * rad + (Math.random() - 0.5) * 0.003;
    spArr[i3 + 1] = Math.sin(a * 0.7) * 0.6 + (Math.random() - 0.5) * 0.003;
    spArr[i3 + 2] = Math.sin(a) * rad + (Math.random() - 0.5) * 0.003;
  }
  stream.geometry.attributes.position.needsUpdate = true;

  // orbit clusters
  clusters.forEach(cl => {
    cl.userData.angle += cl.userData.speed;
    cl.position.x = Math.cos(cl.userData.angle) * cl.userData.radius;
    cl.position.z = Math.sin(cl.userData.angle) * cl.userData.radius;
    cl.position.y = cl.userData.yOff + Math.sin(t * 0.5 + cl.userData.phase) * 0.3;
    cl.rotation.x += 0.008;
    cl.rotation.y += 0.012;
  });

  camera.position.x = Math.sin(t * 0.04) * 0.25;
  camera.position.y = 0.5 + Math.sin(t * 0.06) * 0.1;
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}
anim();
})();
