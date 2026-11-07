import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const { lerp, clamp, degToRad } = THREE.MathUtils;
const V3 = THREE.Vector3;

/* ───────────────────────── layout of the stations ───────────────────────── */

// CSS3D works in pixels, the scene in metres. K is metres -> css units.
const K = 360;

// Each DOM panel lives on an object in the room. pos = centre of the panel, yaw = rotation about Y
// (0 faces +z, i.e. toward the gallery). w/h are css pixels, wpp = metres per css pixel.
const PANELS = {
  'p-home':     { station: 0, pos: [0, 2.55, 1.6],     yaw: 0,    w: 1000, h: 380, wpp: 0.0046, kind: 'float' },
  'p-about':    { station: 1, pos: [4.4, 1.95, -3.9],  yaw: -0.2, w: 880,  h: 540, wpp: 0.0026, kind: 'board', paper: 0xe3d6bb },
  'p-projects': { station: 2, pos: [-1.9, 1.95, -4.4], yaw: 0.25, w: 1060, h: 520, wpp: 0.0028, kind: 'board', paper: 0x2b2018 },
  'p-contact':  { station: 3, pos: [0, 1.35, -6.35],   yaw: 0,    w: 700,  h: 250, wpp: 0.0028, kind: 'plate' },
};

// fillH / fillW = how much of the viewport the station's panels should occupy
const STATIONS = [
  { name: 'Atrium',            panels: ['p-home'],     fov: 40, fillH: 0.5,  fillW: 0.8,  lift: -0.5, tOff: 0 },
  { name: 'Witness Stand',     panels: ['p-about'],    fov: 38, fillH: 0.72, fillW: 0.86, lift: 0.05, tOff: 0 },
  { name: 'Exhibits',          panels: ['p-projects'], fov: 38, fillH: 0.72, fillW: 0.86, lift: 0.05, tOff: 0 },
  { name: 'Bench',             panels: ['p-contact'],  fov: 38, fillH: 0.52, fillW: 0.8,  lift: 0.4,  tOff: 0.02 },
];

const SUN_DIR = new V3(-22, -11, -6).normalize(); // direction the light travels

/* ───────────────────────── procedural textures ───────────────────────── */

function hash2(x, y) { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
}
function fbm(x, y, o = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2; a *= 0.5; } return s; }

function canvasTex(w, h, draw, mirror = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = mirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function tiled(tex, rx, ry) { const t = tex.clone(); t.repeat.set(rx, ry); t.needsUpdate = true; return t; }

function pixelTex(w, h, fn, mirror = true) {
  return canvasTex(w, h, (g) => {
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [r, gg, b] = fn(x / w, y / h, x, y), i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, mirror);
}

function woodTex(dark, light) {
  return pixelTex(512, 512, (u, v) => {
    const warp = fbm(u * 3, v * 5) * 5;
    const ring = 0.5 + 0.5 * Math.sin((v * 16 + warp) * Math.PI * 2);
    const streak = fbm(u * 5, v * 150, 3);
    const t = clamp(ring * 0.5 + streak * 0.55, 0, 1);
    return [lerp(dark[0], light[0], t), lerp(dark[1], light[1], t), lerp(dark[2], light[2], t)];
  });
}

function plasterTex() {
  return pixelTex(512, 512, (u, v, x, y) => {
    const n = fbm(u * 7, v * 7, 4), sp = hash2(x, y) - 0.5;
    const k = 0.93 + n * 0.12 + sp * 0.025;
    return [236 * k, 220 * k, 200 * k];
  });
}

function floorTex() {
  return pixelTex(1024, 1024, (u, v, x, y) => {
    const tx = Math.floor(x / 512), ty = Math.floor(y / 512);
    const dark = (tx + ty) % 2 === 1;
    const lx = x % 512, ly = y % 512;
    const base = dark ? [150, 128, 112] : [218, 205, 182];
    const vein = Math.abs(Math.sin((u * 9 + fbm(u * 5, v * 5, 4) * 7) * Math.PI));
    const vk = vein < 0.05 ? 0.82 : 1;
    const cloud = 0.9 + fbm(u * 6 + tx, v * 6 + ty, 3) * 0.18;
    const grout = lx < 3 || ly < 3 || lx > 508 || ly > 508 ? 0.45 : 1;
    const k = vk * cloud * grout;
    return [base[0] * k, base[1] * k, base[2] * k];
  }, false);
}

function skyTex() {
  return canvasTex(512, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#9fb2dd'); gr.addColorStop(0.45, '#dcc9d6'); gr.addColorStop(0.8, '#fbe0c0'); gr.addColorStop(1, '#fff0d4');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,120,150,0.35)';
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.86 - fbm(x / 90, 3, 3) * 38);
    g.lineTo(w, h); g.fill();
  }, false);
}

function sealTex() {
  return canvasTex(512, 512, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#1d2740'; g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d6b25f'; g.lineWidth = 6;
    g.beginPath(); g.arc(c, c, c - 26, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(c, c, c - 44, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(c, 150); g.lineTo(c, 380); g.moveTo(c - 70, 392); g.lineTo(c + 70, 392); g.stroke();
    g.beginPath(); g.moveTo(c - 120, 190); g.lineTo(c + 120, 190); g.stroke();
    g.lineWidth = 3;
    for (const s of [-1, 1]) {
      const x = c + s * 120;
      g.beginPath(); g.moveTo(x, 190); g.lineTo(x - 42, 275); g.moveTo(x, 190); g.lineTo(x + 42, 275); g.stroke();
      g.beginPath(); g.arc(x, 275, 42, 0, Math.PI); g.stroke();
    }
    g.beginPath(); g.arc(c, 140, 12, 0, Math.PI * 2); g.stroke();
  }, false);
}

function flagTex() {
  return canvasTex(512, 340, (g, w, h) => {
    g.fillStyle = '#1c2a52'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d6b25f'; g.lineWidth = 8; g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#d6b25f';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 36 : 82;
      g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
    g.fillRect(0, h - 26, w, 26);
  }, false);
}

function spriteTex() {
  return canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }, false);
}

/* ───────────────────────── post-processing film pass ───────────────────────── */

const FilmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.045 }, uCA: { value: 0.0014 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uCA; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      vec2 o = d * r2 * uCA * 8.0;
      vec3 c = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, c * vec3(1.04, 1.0, 0.94), 0.6);
      c = mix(vec3(l), c, 1.05);
      float n = h(floor(vUv * uRes) + vec2(mod(uTime * 37.0, 289.0), mod(uTime * 91.0, 311.0))) - 0.5;
      c += n * uGrain * (1.1 - l);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/* ───────────────────────── main entry ───────────────────────── */

export async function createCourtroom({ stage, panels, dock, onStation }) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const lowPower = coarse || Math.min(innerWidth, innerHeight) < 600;

  let W = innerWidth, H = innerHeight;
  const DPR = Math.min(devicePixelRatio || 1, lowPower ? 1.5 : 2);

  /* renderer / scene / camera */
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(DPR);
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1009);
  scene.fog = new THREE.FogExp2(0x8a6c52, 0.012);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 60);

  /* ───── materials ───── */
  let counselFig, skyMat, shaftMat;
  const woodDark = woodTex([58, 34, 20], [104, 64, 36]);
  const woodMid = woodTex([96, 62, 36], [150, 102, 62]);
  const M = {
    walnut: new THREE.MeshStandardMaterial({ map: woodDark, roughness: 0.4, envMapIntensity: 0.7 }),
    walnutPanel: new THREE.MeshStandardMaterial({ map: woodDark, color: 0xc9b3a0, roughness: 0.45, envMapIntensity: 0.7 }),
    oak: new THREE.MeshStandardMaterial({ map: woodMid, roughness: 0.5, envMapIntensity: 0.6 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xe6d9c0, roughness: 0.6, envMapIntensity: 0.4 }),
    plaster: new THREE.MeshStandardMaterial({ map: tiled(plasterTex(), 5, 1.75), roughness: 0.95, envMapIntensity: 0.3 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0xcdb8a2, roughness: 1, envMapIntensity: 0.2 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a24d, metalness: 0.9, roughness: 0.3, envMapIntensity: 1.2 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x4a1f1c, roughness: 0.55, envMapIntensity: 0.8 }),
    fabric: new THREE.MeshStandardMaterial({ color: 0x3b2a3d, roughness: 0.9, envMapIntensity: 0.3 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xece2cc, roughness: 0.9, envMapIntensity: 0.3 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xbfd0d8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45, envMapIntensity: 1.5 }),
    bulb: new THREE.MeshStandardMaterial({ color: 0x221a10, emissive: 0xffc47a, emissiveIntensity: 5 }),
  };
  const floorMat = new THREE.MeshStandardMaterial({ map: tiled(floorTex(), 6, 10), roughness: 0.26, envMapIntensity: 0.85 });

  /* ───── geometry helpers ───── */
  const geoCache = new Map();
  const boxGeo = (w, h, d) => {
    const k = `${w}|${h}|${d}`;
    if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
    return geoCache.get(k);
  };
  function mesh(geo, mat, x, y, z, parent, cast = true) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true;
    parent.add(m); return m;
  }
  const box = (w, h, d, mat, x, y, z, parent = scene, cast = true) => mesh(boxGeo(w, h, d), mat, x, y, z, parent, cast);
  const cyl = (rt, rb, h, mat, x, y, z, parent = scene, seg = 20) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, parent);
  function strut(a, b, r, mat, parent) {
    const va = new V3(...a), vb = new V3(...b), len = va.distanceTo(vb);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new V3(0, 1, 0), vb.clone().sub(va).normalize());
    m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  const group = (x = 0, y = 0, z = 0, ry = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g); return g; };

  /* ───── shell ───── */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 20), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  const plane = (w, h, mat, x, y, z, ry, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.receiveShadow = true; scene.add(m); return m;
  };
  const plasterFor = (w, h) => { const m = M.plaster.clone(); m.map = tiled(M.plaster.map, w / 4, h / 4); return m; };
  plane(20, 7, plasterFor(20, 7), -6, 3.5, 0, Math.PI / 2);          // left wall
  plane(12, 7, plasterFor(12, 7), 0, 3.5, 10, Math.PI);              // back wall
  plane(12, 7, plasterFor(12, 7), 0, 3.5, -10, 0);                   // front wall
  plane(12, 20, M.ceiling, 0, 7, 0, 0, Math.PI / 2);                 // ceiling

  // right wall with tall windows (extruded so the sun really passes through the openings)
  const WIN_Z = [-7.5, -3.5, 0.5, 4.5], WIN_W = 1.9, WIN_Y0 = 2.9, WIN_Y1 = 6.1;
  {
    const shape = new THREE.Shape();
    shape.moveTo(-10, 0); shape.lineTo(10, 0); shape.lineTo(10, 7); shape.lineTo(-10, 7); shape.lineTo(-10, 0);
    for (const zc of WIN_Z) {
      const sx = -zc, hole = new THREE.Path();
      hole.moveTo(sx - WIN_W / 2, WIN_Y0); hole.lineTo(sx + WIN_W / 2, WIN_Y0); hole.lineTo(sx + WIN_W / 2, WIN_Y1); hole.lineTo(sx - WIN_W / 2, WIN_Y1); hole.lineTo(sx - WIN_W / 2, WIN_Y0);
      shape.holes.push(hole);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
    const m = new THREE.Mesh(geo, plasterFor(1, 1));
    m.material.map = tiled(M.plaster.map, 0.25, 0.25);
    m.rotation.y = Math.PI / 2; m.position.x = 6;
    m.castShadow = true; m.receiveShadow = true; scene.add(m);
  }
  // sky seen through the windows
  {
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(70, 36), (skyMat = new THREE.MeshBasicMaterial({ map: skyTex(), color: new THREE.Color(1.5, 1.45, 1.4), fog: false })));
    sky.position.set(16, 8, -2); sky.rotation.y = -Math.PI / 2; scene.add(sky);
  }
  // window frames
  for (const zc of WIN_Z) {
    const g = group(5.97, 0, zc, 0), cy = (WIN_Y0 + WIN_Y1) / 2, hh = WIN_Y1 - WIN_Y0;
    box(0.1, 0.12, WIN_W + 0.2, M.trim, 0, WIN_Y1 + 0.06, 0, g);
    box(0.3, 0.12, WIN_W + 0.4, M.trim, -0.1, WIN_Y0 - 0.06, 0, g);
    box(0.1, hh, 0.1, M.trim, 0, cy, -WIN_W / 2 - 0.05, g);
    box(0.1, hh, 0.1, M.trim, 0, cy, WIN_W / 2 + 0.05, g);
    box(0.06, hh, 0.06, M.trim, 0.12, cy, 0, g);
    box(0.06, 0.06, WIN_W, M.trim, 0.12, cy + 0.5, 0, g);
    box(0.06, 0.06, WIN_W, M.trim, 0.12, WIN_Y1 - 0.6, 0, g);
  }

  /* wainscot paneling on a wall: group origin on the floor, local +z points into the room */
  function wainscot(x, z, ry, length, h) {
    const g = group(x, 0, z, ry);
    box(length, h, 0.1, M.walnut, 0, h / 2, 0.05, g, false);
    const n = Math.floor(length / 1.35), step = length / n;
    for (let i = 0; i < n; i++) {
      const cx = -length / 2 + step * (i + 0.5);
      box(step - 0.3, h - 0.95, 0.05, M.walnutPanel, cx, 0.32 + (h - 0.95) / 2 + 0.2, 0.125, g, false);
      box(step - 0.18, 0.05, 0.07, M.walnut, cx, 0.32 + (h - 0.95) + 0.2 + 0.03, 0.125, g, false);
      box(step - 0.18, 0.05, 0.07, M.walnut, cx, 0.32 + 0.2 - 0.03, 0.125, g, false);
    }
    box(length, 0.2, 0.16, M.walnut, 0, 0.1, 0.1, g, false);
    box(length, 0.1, 0.2, M.walnut, 0, h + 0.05, 0.1, g, false);
    return g;
  }
  wainscot(-6, 0, Math.PI / 2, 20, 2.6);
  wainscot(6, 0, -Math.PI / 2, 20, 2.6);
  wainscot(0, 10, Math.PI, 12, 2.6);
  wainscot(0, -10, 0, 12, 4.2);

  // coffered ceiling
  for (const z of [-9, -6, -3, 0, 3, 6, 9]) box(12, 0.3, 0.32, M.walnut, 0, 6.85, z, scene, false);
  for (const x of [-4.5, -1.5, 1.5, 4.5]) box(0.32, 0.3, 20, M.walnut, x, 6.82, 0, scene, false);

  // seal + flags on the front wall
  {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.07, 14, 56), M.brass);
    ring.position.set(0, 5.5, -9.93); scene.add(ring);
    const seal = new THREE.Mesh(new THREE.CircleGeometry(0.95, 48), new THREE.MeshStandardMaterial({ map: sealTex(), roughness: 0.5, metalness: 0.3 }));
    seal.position.set(0, 5.5, -9.94); scene.add(seal);
    const ft = flagTex();
    for (const s of [-1, 1]) {
      const px = s * 3.4;
      cyl(0.035, 0.04, 5.2, M.brass, px, 2.6 + 0.2, -9.2);
      mesh(new THREE.SphereGeometry(0.075, 14, 10), M.brass, px, 5.5, -9.2, scene);
      const geo = new THREE.PlaneGeometry(1.5, 1.0, 24, 10);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) { const u = (p.getX(i) + 0.75) / 1.5; p.setZ(i, Math.sin(u * 7 + p.getY(i) * 2) * 0.05 * u); }
      geo.computeVertexNormals();
      const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: ft, roughness: 0.85, side: THREE.DoubleSide }));
      flag.position.set(px - s * 0.78, 4.7, -9.2); flag.castShadow = true; scene.add(flag);
    }
  }

  // back doors
  {
    const g = group(0, 0, 9.95, Math.PI);
    box(3.0, 3.7, 0.18, M.trim, 0, 1.85, 0, g, false);
    for (const s of [-1, 1]) {
      box(1.3, 3.3, 0.1, M.walnut, s * 0.68, 1.65, 0.05, g, false);
      box(0.9, 1.1, 0.05, M.walnutPanel, s * 0.68, 2.3, 0.1, g, false);
      box(0.9, 1.1, 0.05, M.walnutPanel, s * 0.68, 0.95, 0.1, g, false);
      mesh(new THREE.SphereGeometry(0.05, 12, 8), M.brass, s * 0.15, 1.5, 0.14, g, false);
    }
  }

  // pendants
  for (const x of [-3, 3]) for (const z of [-5, 0, 5]) {
    const g = group(x, 0, z);
    cyl(0.01, 0.01, 1.4, M.brass, 0, 6.0, 0, g, 6);
    const shade = mesh(new THREE.CylinderGeometry(0.2, 0.5, 0.36, 24, 1, true), M.brass, 0, 5.2, 0, g);
    shade.material = M.brass.clone(); shade.material.side = THREE.DoubleSide;
    mesh(new THREE.SphereGeometry(0.12, 16, 12), M.bulb, 0, 5.1, 0, g, false);
  }

  /* ───── bar rail ───── */
  for (const s of [-1, 1]) {
    const cx = s * 3.55;
    box(4.9, 0.95, 0.14, M.walnut, cx, 0.5, -0.4);
    for (let i = 0; i < 3; i++) box(1.2, 0.6, 0.05, M.walnutPanel, cx - 1.6 + i * 1.6, 0.5, -0.3, scene, false);
    box(5.0, 0.07, 0.3, M.walnut, cx, 1.02, -0.4);
    box(0.18, 1.18, 0.18, M.walnut, s * 1.1, 0.59, -0.4);
    mesh(new THREE.SphereGeometry(0.1, 14, 10), M.brass, s * 1.1, 1.24, -0.4, scene);
  }

  /* ───── judge's bench (station 3) ───── */
  const bench = group(0, 0, 0);
  box(7, 0.5, 4.2, M.walnut, 0, 0.25, -7.9, bench);
  box(7.2, 0.22, 0.6, M.walnut, 0, 0.11, -5.5, bench);
  box(5.4, 1.4, 1.0, M.walnut, 0, 1.2, -6.9, bench);
  box(5.7, 0.1, 1.25, M.oak, 0, 1.95, -6.85, bench);
  for (const s of [-1, 1]) {
    box(0.8, 0.95, 0.05, M.walnutPanel, s * 1.65, 1.2, -6.38, bench, false);
    box(0.4, 0.95, 0.05, M.walnutPanel, s * 2.4, 1.2, -6.38, bench, false);
  }
  box(0.8, 0.12, 0.8, M.leather, 0, 1.05, -8.3, bench);                    // judge's chair
  box(0.95, 1.7, 0.16, M.leather, 0, 1.7, -8.8, bench);
  box(1.05, 0.14, 0.22, M.walnut, 0, 2.6, -8.8, bench);
  // gavel: mallet head lying along x, handle crossing it at a right angle, resting by its sound block
  {
    const g = new THREE.Group(); g.position.set(-1.1, 2.0, -6.95); g.rotation.y = 0.5; g.scale.setScalar(1.5); bench.add(g);
    cyl(0.1, 0.115, 0.04, M.walnut, 0.34, 0.02, 0.05, g);
    const head = cyl(0.058, 0.058, 0.26, M.walnut, 0, 0.058, 0, g, 24); head.rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) {
      const cap = cyl(0.066, 0.066, 0.03, M.walnut, s * 0.125, 0.058, 0, g, 24); cap.rotation.z = Math.PI / 2;
      const band = cyl(0.061, 0.061, 0.014, M.brass, s * 0.085, 0.058, 0, g, 24); band.rotation.z = Math.PI / 2;
    }
    const handle = cyl(0.016, 0.02, 0.44, M.oak, 0, 0.09, 0.22, g, 12); handle.rotation.x = Math.PI / 2 - 0.12;
    mesh(new THREE.SphereGeometry(0.024, 12, 8), M.oak, 0, 0.12, 0.44, g);
  }
  // scales of justice
  cyl(0.1, 0.13, 0.04, M.brass, 1.3, 2.02, -6.9, bench);
  cyl(0.016, 0.016, 0.55, M.brass, 1.3, 2.3, -6.9, bench, 8);
  box(0.56, 0.015, 0.015, M.brass, 1.3, 2.57, -6.9, bench);
  for (const s of [-1, 1]) {
    cyl(0.1, 0.07, 0.015, M.brass, 1.3 + s * 0.27, 2.26, -6.9, bench);
    strut([1.3 + s * 0.27, 2.57, -6.9], [1.3 + s * 0.35, 2.27, -6.9], 0.003, M.brass, bench);
    strut([1.3 + s * 0.27, 2.57, -6.9], [1.3 + s * 0.19, 2.27, -6.9], 0.003, M.brass, bench);
  }
  // nameplate backing (the contact panel sits on it)
  { const p = PANELS['p-contact'], w = p.w * p.wpp, h = p.h * p.wpp;
    box(w + 0.14, h + 0.14, 0.05, M.brass, p.pos[0], p.pos[1], p.pos[2] - 0.035, bench);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) mesh(new THREE.SphereGeometry(0.018, 8, 6), M.brass, p.pos[0] + sx * (w / 2 + 0.035), p.pos[1] + sy * (h / 2 + 0.035), p.pos[2] - 0.005, bench, false); }

  /* ───── witness stand (station 1) ───── */
  const stand = group(4.4, 0, -6.0);
  box(1.9, 0.4, 1.7, M.walnut, 0, 0.2, 0, stand);
  box(1.9, 1.0, 0.12, M.walnut, 0, 0.9, 0.8, stand);
  box(0.12, 1.0, 1.6, M.walnut, -0.9, 0.9, 0, stand);
  box(0.12, 1.0, 1.6, M.walnut, 0.9, 0.9, 0, stand);
  box(2.0, 0.08, 0.34, M.oak, 0, 1.44, 0.8, stand);
  box(0.6, 0.12, 0.6, M.leather, 0, 0.9, -0.1, stand);
  box(0.6, 0.8, 0.1, M.leather, 0, 1.3, -0.42, stand);
  cyl(0.012, 0.012, 0.32, M.brass, 0.25, 1.64, 0.7, stand, 8);
  mesh(new THREE.SphereGeometry(0.035, 10, 8), M.brass, 0.25, 1.82, 0.7, stand);

  /* ───── jury box ───── */
  {
    const g = group(0, 0, 0);
    box(1.9, 0.3, 4.4, M.walnut, -5.0, 0.15, -4.4, g);
    box(0.8, 0.25, 4.0, M.walnut, -5.45, 0.42, -4.4, g);
    box(0.12, 0.95, 4.4, M.walnut, -4.0, 0.78, -4.4, g);
    box(0.24, 0.07, 4.5, M.oak, -4.0, 1.28, -4.4, g);
    for (const [x, y] of [[-4.6, 0.3], [-5.5, 0.55]]) for (let i = 0; i < 6; i++) {
      const z = -5.9 + i * 0.68;
      box(0.5, 0.08, 0.5, M.fabric, x, y + 0.45, z, g);
      box(0.07, 0.55, 0.5, M.fabric, x - 0.24, y + 0.8, z, g);
      box(0.1, 0.45, 0.1, M.walnut, x, y + 0.22, z, g, false);
    }
  }

  /* ───── counsel tables + chairs ───── */
  for (const s of [-1, 1]) {
    const g = group(s * 1.9, 0, -2.3);
    box(2.3, 0.07, 1.0, M.oak, 0, 0.9, 0, g);
    box(0.06, 0.88, 0.9, M.walnut, -1.1, 0.44, 0, g);
    box(0.06, 0.88, 0.9, M.walnut, 1.1, 0.44, 0, g);
    box(2.2, 0.6, 0.05, M.walnut, 0, 0.55, -0.42, g);
    box(0.32, 0.03, 0.42, M.paper, -0.5, 0.95, 0.05, g);
    box(0.3, 0.02, 0.4, M.paper, -0.45, 0.975, 0.02, g);
    box(0.26, 0.03, 0.34, M.leather, 0.55, 0.95, 0.1, g);
    cyl(0.07, 0.07, 0.24, M.glass, 0.1, 1.07, -0.25, g, 14);
    for (const cx of [-0.55, 0.55]) {
      box(0.52, 0.08, 0.5, M.leather, cx, 0.5, 1.0, g);
      box(0.52, 0.6, 0.07, M.leather, cx, 0.85, 1.25, g);
      box(0.08, 0.5, 0.08, M.walnut, cx, 0.25, 1.0, g, false);
    }
  }

  /* ───── counsel: me, Ace-Attorney style (chunky low-poly), at the right-hand table facing the bench ───── */
  {
    const flat = (color, rough = 0.75, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true, envMapIntensity: 0.4 });
    const soft = (color, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough, side: THREE.DoubleSide, envMapIntensity: 0.4 });
    const skin = flat(0xe0b394, 0.7), skinShade = flat(0xc99577, 0.75), suit = soft(0x3b3e44, 0.8), suitDark = flat(0x2f3237, 0.8), shirt = flat(0xf0ece4, 0.8);
    const shoe = flat(0x16120f, 0.4), dark = flat(0x2a1a14, 0.5);
    // hair cards: strips with a strand alpha-texture whose strands end at random lengths (wispy, feathered tips)
    const cardTex = (() => {
      const W = 128, Hh = 256;
      const c = document.createElement('canvas'); c.width = W; c.height = Hh;
      const g = c.getContext('2d'), img = g.createImageData(W, Hh), d = img.data;
      const NS = 8, str = [];
      for (let i = 0; i < NS; i++) str.push({ u: (i + 0.5) / NS + (hash2(i, 7) - 0.5) * 0.03, len: 0.78 + hash2(i, 3) * 0.22, b: 0.82 + hash2(i, 11) * 0.36, hw: (0.5 / NS) * (1.25 + hash2(i, 5) * 0.3) });
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
        const u = x / W, t = 1 - y / Hh;
        let al = 0, br = 1;
        for (const st of str) {
          const w = st.hw * (1 - Math.pow(t / st.len, 3) * 0.85);
          if (t < st.len && Math.abs(u - st.u) < w) { al = 255; br = st.b * (0.86 + 0.14 * Math.sin(y * 0.12 + st.u * 40)); break; }
        }
        const root = 0.72 + 0.28 * Math.sqrt(t), hi = br > 1.12 ? 1.16 : 1, i4 = (y * W + x) * 4, k = br * root * hi;
        d[i4] = Math.min(255, 214 * k); d[i4 + 1] = Math.min(255, 174 * k); d[i4 + 2] = Math.min(255, 110 * k); d[i4 + 3] = al;
      }
      g.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; return tex;
    })();
    const cardMat = (tint) => new THREE.MeshStandardMaterial({ map: cardTex, color: tint, roughness: 0.75, side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true, envMapIntensity: 0.4 });
    const hairA = cardMat(0xffffff), hairB = cardMat(0xb0aba0), hairC = cardMat(0x8a857c);   // golden top / mid / dark nape under-layer
    const hairBase = flat(0x7d6240, 0.9), browMat = flat(0x8d6e44, 0.8);
    const me = group(1.9, 0, -1.55, Math.PI + 0.05);
    counselFig = me;

    const taper = (a, b, r1, r2, mat, parent, seg = 10) => {
      const va = new V3(...a), vb = new V3(...b), len = va.distanceTo(vb);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, seg), mat);
      m.position.copy(va).add(vb).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new V3(0, 1, 0), vb.clone().sub(va).normalize());
      m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
    };
    const blob = (r, mat, x, y, z, parent, sx = 1, sy = 1, sz = 1, w = 12, h = 9) => {
      const m = mesh(new THREE.SphereGeometry(r, w, h), mat, x, y, z, parent); m.scale.set(sx, sy, sz); return m;
    };

    // legs + shoes
    for (const s of [-1, 1]) {
      taper([s * 0.098, 0.9, 0], [s * 0.092, 0.08, 0.005], 0.085, 0.058, suitDark, me, 10);
      box(0.1, 0.07, 0.27, shoe, s * 0.092, 0.037, 0.05, me);
    }

    // torso (hips at y = 0.86, leaning onto the table). Rounded chest + sloping shoulder yoke instead of a box.
    const torso = new THREE.Group(); torso.position.y = 0.86; torso.rotation.x = 0.2; me.add(torso);
    const chest = mesh(new THREE.CylinderGeometry(0.2, 0.168, 0.62, 18), suit, 0, 0.27, 0, torso); chest.scale.set(1.06, 1, 0.62);
    const tails = mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.22, 18, 1, true), suit, 0, -0.02, 0, torso); tails.scale.set(1.06, 1, 0.64);
    const yoke = mesh(new THREE.SphereGeometry(0.24, 20, 12), suit, 0, 0.55, 0, torso); yoke.scale.set(1.04, 0.27, 0.6);
    cyl(0.064, 0.07, 0.04, shirt, 0, 0.64, 0, torso, 10);                      // shirt collar
    const jc = mesh(new THREE.CylinderGeometry(0.074, 0.088, 0.045, 14, 1, true), suit, 0, 0.62, -0.006, torso, false);
    cyl(0.046, 0.05, 0.1, skin, 0, 0.7, 0, torso, 10);                         // neck
    for (const s of [-1, 1]) blob(0.06, suit, s * 0.238, 0.505, 0, torso, 1, 1.1, 1);

    // arms: shoulder -> elbow -> hand flat on the table
    for (const s of [-1, 1]) {
      const sh = [s * 0.238, 0.5, 0], el = [s * 0.285, 0.31, 0.15], hd = [s * 0.2, 0.172, 0.43];
      taper(sh, el, 0.057, 0.046, suit, torso);
      blob(0.047, suit, el[0], el[1], el[2], torso, 1, 1, 1, 10, 8);
      taper(el, hd, 0.046, 0.04, suit, torso);
      box(0.058, 0.035, 0.03, shirt, hd[0], hd[1] + 0.012, hd[2] - 0.055, torso).rotation.x = -0.5;
      const hand = box(0.07, 0.028, 0.09, skin, hd[0], hd[1] - 0.012, hd[2] + 0.025, torso); hand.rotation.x = -0.2;
      const thumb = box(0.022, 0.02, 0.05, skin, hd[0] - s * 0.04, hd[1] - 0.01, hd[2] + 0.02, torso); thumb.rotation.y = s * 0.25;
    }

    // head
    const head = new THREE.Group(); head.position.set(0, 0.815, 0.012); head.rotation.x = -0.2; head.scale.setScalar(1.08); torso.add(head);
    blob(0.1, skin, 0, 0, 0, head, 0.92, 1.1, 0.98, 14, 10);
    for (const s of [-1, 1]) {
      blob(0.024, skinShade, s * 0.092, -0.005, -0.005, head, 0.45, 1, 0.8, 6, 5);
      blob(0.0105, dark, s * 0.038, 0.012, 0.096, head, 1, 1.3, 0.5, 6, 5);
      const brow = box(0.044, 0.008, 0.008, browMat, s * 0.04, 0.046, 0.095, head, false); brow.rotation.z = s * 0.1;
    }
    blob(0.015, skinShade, 0, -0.012, 0.103, head, 1, 1, 0.9, 6, 5);
    const mouth = mesh(new THREE.TorusGeometry(0.026, 0.004, 4, 10, Math.PI * 0.8), dark, 0, -0.045, 0.098, head, false);
    mouth.rotation.z = Math.PI * 1.1;

    // ── hair: layered strand cards, cut like the reference photo ──
    // golden top layer falls over the temples (ears stay clear); darker, choppy under-layers fan out and flare at the nape
    const P = Math.PI, DEG = P / 180;
    const ELL = { r: 0.111, sy: 1.18, sz: 1.06, cy: 0.012, cz: -0.012 };
    // dark base shell so no scalp shows through between cards (azimuth a = phi - pi/2)
    const baseShell = (phi0, phi1, theta) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.103, 14, 10, phi0, phi1 - phi0, 0, theta), hairBase);
      m.scale.set(1, 1.18, 1.06); m.position.set(0, 0.012, -0.012); m.castShadow = true; head.add(m);
    };
    baseShell(P / 2 + 0.05, P - 0.55, P * 0.36); baseShell(P - 0.55, P + 0.25, P * 0.46); baseShell(P + 0.25, 1.5 * P - 0.05, P * 0.62);
    baseShell(0.55, P / 2 - 0.05, P * 0.36); baseShell(-0.25, 0.55, P * 0.46); baseShell(-P / 2 + 0.05, -0.25, P * 0.62);

    const acc = { A: { p: [], u: [], i: [] }, B: { p: [], u: [], i: [] }, C: { p: [], u: [], i: [] } };
    let sd = 7; const rnd = () => (sd = (sd * 16807 + 11) % 2147483647) / 2147483647;
    // one strip: follows the skull from theta0 to theta1, then hangs `hang` metres, flaring outward by `flare`
    const card = (L, a, th0, th1, hang, flare, width, off, sweep, wave) => {
      const o = acc[L], R = ELL.r + off, rows = [], nA = 9, nH = 5, ph = rnd() * 6.28;
      const surf = (th, aa) => { const st = Math.sin(th); return [R * st * Math.sin(aa), R * ELL.sy * Math.cos(th) + ELL.cy, R * st * Math.cos(aa) * ELL.sz + ELL.cz]; };
      for (let i = 0; i <= nA; i++) { const t = i / nA, aa = a + sweep * t * 0.5; rows.push({ p: surf(th0 + (th1 - th0) * t, aa), a: aa, t: t * 0.5 }); }
      const e = rows[rows.length - 1];
      for (let j = 1; j <= nH; j++) {
        const h = j / nH, aa = a + sweep * (0.5 + 0.5 * h), out = flare * h * h * hang;
        rows.push({ p: [e.p[0] + Math.sin(aa) * out, e.p[1] - hang * h, e.p[2] + Math.cos(aa) * out], a: aa, t: 0.5 + 0.5 * h });
      }
      const base = o.p.length / 3;
      rows.forEach((r, k) => {
        const wob = Math.sin(r.t * P * 2 * wave + ph) * 0.004 * r.t, wx = Math.cos(r.a), wz = -Math.sin(r.a);
        const w = width * lerp(0.35, 1, Math.min(1, r.t * 2.2));
        for (const s of [-1, 1]) { o.p.push(r.p[0] + wx * (s * w / 2 + wob), r.p[1], r.p[2] + wz * (s * w / 2 + wob)); o.u.push(s < 0 ? 0 : 1, r.t); }
        if (k < rows.length - 1) { const q = base + k * 2; o.i.push(q, q + 1, q + 3, q, q + 3, q + 2); }
      });
    };
    // A: golden top layer
    for (let a = -172; a <= 172; a += 5) {
      const ab = Math.abs(a), sg = Math.sign(a);
      if (ab < 13) continue;                                  // the middle part
      const aa = a * DEG + (rnd() - 0.5) * 0.05;
      if (ab < 66) card('A', aa, P * 0.08, P * (0.33 + rnd() * 0.04), 0.03 + rnd() * 0.025, 0.1, 0.052, 0.012, sg * 0.5, 2);      // fringe swept off the part toward the temples
      else if (ab < 112) card('A', aa, P * 0.08, P * (0.41 + rnd() * 0.03), 0.01 + rnd() * 0.015, 0.15, 0.066, 0.012, sg * 0.45, 2); // temples, stopping above the ear
      else card('A', aa, P * 0.08, P * 0.56, 0.045 + rnd() * 0.035, 0.22, 0.07, 0.012 + (rnd() - 0.5) * 0.004, sg * 0.2, 3);       // back of the crown
    }
    // B: mid layer, back half only (starts behind the ears)
    for (let a = 100; a <= 260; a += 5) card('B', a * DEG + (rnd() - 0.5) * 0.06, P * 0.34, P * 0.6, 0.035 + rnd() * 0.04, 0.26, 0.066, 0.003, (a < 180 ? 1 : -1) * 0.08, 3);
    // C: longest, darkest nape layer, flicking outward with ragged, uneven ends
    for (let a = 116; a <= 244; a += 4.5) card('C', a * DEG + (rnd() - 0.5) * 0.06, P * 0.4, P * 0.63, 0.045 + rnd() * 0.06, 0.38, 0.062, -0.003, (a < 180 ? 1 : -1) * 0.1, 4);
    for (const [L, mat] of [['A', hairA], ['B', hairB], ['C', hairC]]) {
      const g = new THREE.BufferGeometry(), o = acc[L];
      g.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(o.u, 2));
      g.setIndex(o.i); g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; head.add(m);
    }
  }

  /* ───── gallery pews ───── */
  for (const s of [-1, 1]) for (const z of [3.4, 5.2, 7.0, 8.8]) {
    const cx = s * 3.5;
    box(4.0, 0.08, 0.5, M.oak, cx, 0.45, z);
    box(4.0, 0.95, 0.09, M.walnut, cx, 0.92, z + 0.28);
    box(4.0, 0.1, 0.16, M.walnut, cx, 1.42, z + 0.28);
    for (const e of [-1, 1]) box(0.1, 1.05, 0.7, M.walnut, cx + e * 2.0, 0.52, z + 0.1);
  }

  /* ───── exhibit boards on easels ───── */
  function board(id) {
    const p = PANELS[id], w = p.w * p.wpp, h = p.h * p.wpp, [px, py, pz] = p.pos;
    const g = group(px, py, pz, p.yaw);
    box(w + 0.18, h + 0.18, 0.06, M.walnut, 0, 0, -0.05, g);
    const paperMat = new THREE.MeshStandardMaterial({ color: p.paper, roughness: 0.9, envMapIntensity: 0.3 });
    box(w, h, 0.03, paperMat, 0, 0, -0.012, g);
    // ledge + legs + brace
    box(w + 0.1, 0.06, 0.14, M.oak, 0, -h / 2 - 0.1, 0.03, g);
    for (const s of [-1, 1]) {
      strut([s * (w / 2 - 0.12), -py, 0.45], [s * (w / 2 - 0.12), -h / 2, -0.04], 0.035, M.oak, g);
    }
    strut([0, -py, -0.95], [0, h / 2 - 0.1, -0.12], 0.03, M.oak, g);
    box(w - 0.4, 0.05, 0.05, M.oak, 0, -py + 0.35, 0.45, g);
    return g;
  }
  board('p-about');
  board('p-projects');

  /* ───── lights ───── */
  const hemi = new THREE.HemisphereLight(0xf1dcc8, 0x6a4a36, 0.5);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffd7a0, 3.8);
  sun.position.copy(SUN_DIR).multiplyScalar(-26);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lowPower ? 2048 : 4096, lowPower ? 2048 : 4096);
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 70 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const pendants = [];
  for (const z of [-5, 0.5, 5.5]) {
    const pl = new THREE.PointLight(0xffc88a, 22, 15, 2); pl.position.set(0, 4.7, z); scene.add(pl); pendants.push(pl);
  }
  const benchSpot = new THREE.SpotLight(0xffe3b8, 110, 16, 0.5, 0.9, 1.6);
  benchSpot.position.set(0, 6.4, -3.2); benchSpot.target.position.set(0, 1.7, -7.2); scene.add(benchSpot, benchSpot.target);
  const standSpot = new THREE.SpotLight(0xffe3b8, 70, 14, 0.45, 0.9, 1.6);
  standSpot.position.set(3.2, 6.4, -2.0); standSpot.target.position.set(4.3, 1.5, -4.6); scene.add(standSpot, standSpot.target);

  /* ───── light shafts + dust ───── */
  const fx = new THREE.Group(); scene.add(fx);
  const WALL_X = 6.0;
  const tEndFor = (y) => Math.min(y / -SUN_DIR.y, (WALL_X + 6) / -SUN_DIR.x);
  {
    const verts = [], fades = [];
    const quad = (a, b, c, d, fa, fb, fc, fd) => { verts.push(...a, ...b, ...c, ...a, ...c, ...d); fades.push(fa, fb, fc, fa, fc, fd); };
    for (const zc of WIN_Z) {
      const zl = zc - WIN_W / 2, zr = zc + WIN_W / 2;
      const near = [[WALL_X, WIN_Y0, zl], [WALL_X, WIN_Y0, zr], [WALL_X, WIN_Y1, zr], [WALL_X, WIN_Y1, zl]];
      const far = near.map((p) => { const t = tEndFor(p[1]); return [p[0] + SUN_DIR.x * t, p[1] + SUN_DIR.y * t, p[2] + SUN_DIR.z * t]; });
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(near[i], near[j], far[j], far[i], 1, 1, 0.18, 0.18); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('aFade', new THREE.Float32BufferAttribute(fades, 1));
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uColor: { value: new THREE.Color(1.0, 0.78, 0.5) }, uI: { value: 0.07 } },
      vertexShader: `attribute float aFade; varying vec3 vN; varying vec3 vV; varying float vF;
        void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); vF = aFade; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uI; varying vec3 vN; varying vec3 vV; varying float vF;
        void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); gl_FragColor = vec4(uColor, f * vF * uI); }`,
    });
    shaftMat = mat;
    const shafts = new THREE.Mesh(geo, mat); shafts.raycast = () => {}; shafts.frustumCulled = false; fx.add(shafts);
  }
  const MOTES = lowPower ? 140 : 320;
  const moteData = [];
  const motePos = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) moteData.push({ w: Math.floor(Math.random() * WIN_Z.length), a: Math.random(), b: Math.random(), s: 0.04 + Math.random() * 0.9, sp: 0.00005 + Math.random() * 0.00015, ph: Math.random() * 6.28 });
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ map: spriteTex(), size: 0.07, color: 0xffe0b0, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false }));
  motes.raycast = () => {}; motes.frustumCulled = false; fx.add(motes);
  function updateMotes(t) {
    for (let i = 0; i < MOTES; i++) {
      const m = moteData[i];
      m.s += m.sp; if (m.s > 0.96) m.s = 0.04;
      const zc = WIN_Z[m.w], y0 = lerp(WIN_Y0, WIN_Y1, m.b), z0 = zc + (m.a - 0.5) * WIN_W;
      const te = tEndFor(y0) * m.s;
      motePos[i * 3] = WALL_X + SUN_DIR.x * te + Math.sin(t * 0.3 + m.ph) * 0.08;
      motePos[i * 3 + 1] = y0 + SUN_DIR.y * te + Math.sin(t * 0.4 + m.ph * 2) * 0.06;
      motePos[i * 3 + 2] = z0 + SUN_DIR.z * te + Math.cos(t * 0.27 + m.ph) * 0.08;
    }
    moteGeo.attributes.position.needsUpdate = true;
  }
  updateMotes(0);

  /* ───── the night shift: my cat (a ragdoll), shell-rendered fur ───── */
  const cat = new THREE.Group();
  {
    const FAWN = new THREE.Color(0xe8e7e5), CREAM = new THREE.Color(0xf3f2f0), SADDLE = new THREE.Color(0xcfcfd0);
    const MASK = new THREE.Color(0x9a9ba1), DARK = new THREE.Color(0x606168), WHITE = new THREE.Color(0xf8f8f7), LIGHTMASK = new THREE.Color(0xb3b4b8);
    const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
    const mixC = (a, b, t) => a.clone().lerp(b, clamp(t, 0, 1));
    const parts = [], v = new V3();
    // geo in cat space: +x toward the head, +y up, belly on y = 0
    const add = (geo, pos, scl, rot, fur, colorFn) => {
      geo.applyMatrix4(new THREE.Matrix4().compose(new V3(...(pos || [0, 0, 0])), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]))), new V3(...(scl || [1, 1, 1]))));
      const p = geo.attributes.position, n = p.count, col = new Float32Array(n * 3), fa = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(p, i);
        const c = colorFn(v), k = 0.92 + fbm(v.x * 40 + 3, v.y * 40 + v.z * 30, 3) * 0.16;
        col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
        fa[i] = typeof fur === 'function' ? fur(v) : fur;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aFur', new THREE.BufferAttribute(fa, 1));
      parts.push(geo);
    };
    const sph = (w = 24, h = 16) => new THREE.SphereGeometry(1, w, h);

    add(sph(), [0, 0.095, 0], [0.26, 0.092, 0.14], null, 1.0, (q) => {
      const c = mixC(CREAM, FAWN, ss(0.06, 0.17, q.y));
      return q.x < 0.02 ? mixC(c, SADDLE, ss(0.12, 0.2, q.y) * ss(0.02, -0.2, q.x)) : c;
    });
    add(sph(), [-0.16, 0.1, 0], [0.13, 0.1, 0.135], null, 1.0, (q) => mixC(CREAM, SADDLE, ss(0.07, 0.19, q.y)));
    add(sph(), [0.16, 0.11, 0], [0.11, 0.1, 0.115], null, 1.1, (q) => (q.x > 0.19 && q.y < 0.17 ? WHITE : mixC(CREAM, FAWN, ss(0.1, 0.2, q.y))));
    add(sph(), [0.24, 0.14, 0], [0.08, 0.085, 0.115], null, 1.35, (q) => mixC(WHITE, CREAM, ss(0.12, 0.22, q.y)));     // the ruff
    // lynx point: white face, gray tabby markings (forehead "M", cheek stripes, eyeliner + white spectacles), gray striped crown
    const band = (x, w = 0.5) => ss(w, 1, 0.5 + 0.5 * Math.sin(x));
    const EYES = [new V3(0.378, 0.188, 0.036), new V3(0.378, 0.188, -0.036)];
    add(sph(96, 72), [0.31, 0.17, 0], [0.082, 0.076, 0.09], null,
      (q) => lerp(0.9, 0.34, ss(0.26, 0.38, q.x)),
      (q) => {
        const x = q.x - 0.31, y = q.y - 0.17, z = q.z, az = Math.abs(z);
        let c = WHITE.clone();
        const front = ss(-0.03, 0.02, x), back = 1 - front;
        // crown and back of the head: gray with tabby rings
        c = mixC(c, mixC(MASK, DARK, band(x * 150 + az * 40, 0.55) * 0.7), back * ss(-0.02, 0.03, y + 0.02));
        // forehead "M": vertical stripes above the eyes
        const fore = front * ss(0.03, 0.05, y) * ss(0.075, 0.03, az);
        c = mixC(c, DARK, fore * band(z * 190 + 1.6, 0.45));
        c = mixC(c, MASK, front * ss(0.045, 0.065, y) * 0.6);
        // cheek stripes sweeping back from the outer eye corners
        const cheek = front * ss(0.045, 0.065, az) * ss(-0.035, -0.005, y) * ss(0.03, 0.0, y);
        c = mixC(c, MASK, cheek * band((y - az * 0.35) * 260, 0.4));
        // eyeliner, then a white "spectacle" ring
        for (const e of EYES) {
          const d = q.distanceTo(e);
          c = mixC(c, WHITE, ss(0.03, 0.02, d));
          c = mixC(c, DARK, ss(0.019, 0.0145, d) * ss(0.0105, 0.013, d));
        }
        return c;
      });
    add(sph(), [0.378, 0.148, 0], [0.034, 0.027, 0.042], null, 0.16, () => WHITE);
    for (const s of [-1, 1]) {
      add(new THREE.ConeGeometry(1, 1, 14), [0.29, 0.255, s * 0.05], [0.032, 0.062, 0.022], [s * 0.42, 0, -0.18], 0.3, () => DARK);
      add(new THREE.CapsuleGeometry(0.026, 0.06, 6, 12), [0.36, 0.028, s * 0.055], null, [0, 0, Math.PI / 2], 0.4, (q) => mixC(CREAM, WHITE, ss(0.36, 0.42, q.x)));
      add(sph(16, 12), [0.415, 0.024, s * 0.055], [0.034, 0.022, 0.03], null, 0.35, () => WHITE);                       // front mitts
      add(sph(), [-0.15, 0.075, s * 0.1], [0.1, 0.07, 0.06], null, 1.0, (q) => mixC(CREAM, SADDLE, ss(0.08, 0.14, q.y)));
      add(new THREE.CapsuleGeometry(0.024, 0.06, 6, 12), [-0.07, 0.024, s * 0.13], null, [0, 0, Math.PI / 2], 0.35, () => WHITE);
    }
    const tail = new THREE.CatmullRomCurve3([[-0.28, 0.09, 0], [-0.4, 0.06, 0.05], [-0.47, 0.045, 0.14], [-0.46, 0.04, 0.25], [-0.38, 0.035, 0.32]].map((p) => new V3(...p)));
    add(new THREE.TubeGeometry(tail, 120, 0.03, 16), null, null, null, 1.7, (q) => mixC(MASK, DARK, band(Math.atan2(q.z - 0.1, q.x + 0.38) * 9, 0.5) * 0.8));

    // shells: each layer pushes the surface out along its normal; strands are cells of a 3D hash that survive
    // only up to their own height, so the coat thins out toward the tips. Lower layers are darker (self-shadowing).
    const furGeo = mergeGeometries(parts);
    const furMat = (layer) => {
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.3 });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uLayer = { value: layer };
        sh.vertexShader = 'attribute float aFur; uniform float uLayer; varying vec3 vFurP;\n' + sh.vertexShader.replace('#include <begin_vertex>',
          `#include <begin_vertex>
          vFurP = position;
          float fl = 0.034 * aFur * uLayer;
          transformed += normal * fl;
          transformed.y -= fl * fl * 14.0;
          transformed.x -= fl * uLayer * 0.35;                         // coat lies back along the body
          transformed += vec3(sin(position.y * 310.0), 0.0, cos(position.x * 290.0)) * fl * 0.18;`);
        sh.fragmentShader = `uniform float uLayer; varying vec3 vFurP;
          float furHash(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }\n` +
          sh.fragmentShader.replace('#include <clipping_planes_fragment>',
            `#include <clipping_planes_fragment>
            if (uLayer > 0.0) {
              vec3 q = vFurP * 760.0;
              float n = furHash(floor(q)), n2 = furHash(floor(q * 0.37) + 17.0), r = length(fract(q) - 0.5);
              if (max(n, n2 * 0.85) < uLayer || r > 0.5 * (1.0 - uLayer * 0.8)) discard;
            }`).replace('#include <color_fragment>', `#include <color_fragment>
            diffuseColor.rgb *= mix(0.62, 1.08, sqrt(uLayer));`);
      };
      return m;
    };
    const LAYERS = lowPower ? 18 : 32;
    for (let i = 0; i < LAYERS; i++) {
      const m = new THREE.Mesh(furGeo, furMat(i / (LAYERS - 1)));
      m.castShadow = i === 0; m.receiveShadow = true; cat.add(m);
    }

    // eyes catch the moonlight; night-wide pupils
    const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x5f8fc4, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, emissive: 0x16304f, emissiveIntensity: 1.2 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1 });
    for (const s of [-1, 1]) {
      const c = new V3(0.378, 0.188, s * 0.036), d = new V3(0.8, 0.12, s * 0.45).normalize();
      mesh(new THREE.SphereGeometry(0.0115, 16, 12), eyeMat, c.x, c.y, c.z, cat, false);
      const pu = mesh(new THREE.SphereGeometry(0.0062, 12, 8), pupilMat, c.x + d.x * 0.0072, c.y + d.y * 0.0072, c.z + d.z * 0.0072, cat, false);
      pu.scale.set(0.6, 1.1, 0.6);
    }
    const nose = mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ color: 0xc98f88, roughness: 0.5 }), 0.412, 0.163, 0, cat, false);
    nose.scale.set(0.009, 0.006, 0.011);
    const wv = [];
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) wv.push(0.405, 0.146, s * 0.026, 0.43 + k * 0.004, 0.135 + (k - 1.5) * 0.01, s * 0.1);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wv, 3));
    cat.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xf2eee6, transparent: true, opacity: 0.3 })));

    // asleep on the papers at the left counsel table, in a moonbeam, head turned toward the gallery
    cat.position.set(-2.0, 0.935, -2.35); cat.rotation.y = -0.9;
    cat.visible = false; scene.add(cat);
  }

  /* ───── wall clock (click it to change the time of day) ───── */
  const clock = group(-5.93, 4.55, -4.0, Math.PI / 2);
  const hourHand = new THREE.Group(), minuteHand = new THREE.Group();
  {
    const R = 0.5;
    const faceTex = canvasTex(512, 512, (g, w) => {
      const c = w / 2;
      g.fillStyle = '#efe6d2'; g.fillRect(0, 0, w, w);
      g.strokeStyle = '#2b2118'; g.fillStyle = '#2b2118';
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2, big = i % 5 === 0, r0 = big ? 214 : 226;
        g.lineWidth = big ? 6 : 2;
        g.beginPath(); g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0); g.lineTo(c + Math.sin(a) * 240, c - Math.cos(a) * 240); g.stroke();
      }
      g.font = '600 44px "Cormorant Garamond", Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'].forEach((t, i) => {
        const a = (i / 12) * Math.PI * 2; g.fillText(t, c + Math.sin(a) * 176, c - Math.cos(a) * 176);
      });
      g.font = 'italic 500 24px "Cormorant Garamond", Georgia, serif'; g.fillText('tempus fugit', c, c + 92);
    }, false);
    const face = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.55, envMapIntensity: 0.5 }));
    face.position.z = 0.045; face.receiveShadow = true; clock.add(face);
    const back = cyl(R + 0.07, R + 0.07, 0.06, M.walnut, 0, 0, 0.02, clock, 48); back.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.025, 0.04, 16, 64), M.brass); rim.position.z = 0.055; rim.castShadow = true; clock.add(rim);
    const handMat = new THREE.MeshStandardMaterial({ color: 0x1d160f, roughness: 0.4, metalness: 0.4 });
    hourHand.position.z = 0.055; minuteHand.position.z = 0.063; clock.add(hourHand, minuteHand);
    box(0.034, 0.26, 0.008, handMat, 0, 0.1, 0, hourHand);
    box(0.02, 0.4, 0.008, handMat, 0, 0.16, 0, minuteHand);
    const cap = cyl(0.025, 0.025, 0.02, M.brass, 0, 0, 0.07, clock, 16); cap.rotation.x = Math.PI / 2;
  }
  const clockSpin = { h: 0 };
  function updateClock() {
    const d = new Date();
    const hrs = (d.getHours() % 12) + d.getMinutes() / 60 + d.getSeconds() / 3600 + clockSpin.h;
    hourHand.rotation.z = -(hrs / 12) * Math.PI * 2;
    minuteHand.rotation.z = -(hrs - Math.floor(hrs)) * Math.PI * 2;
  }

  /* ───── day <-> night ───── */
  const moon = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.35, 2.2), transparent: true, opacity: 0, fog: false }));
  moon.position.set(15.9, 7.5, 1.0); moon.rotation.y = -Math.PI / 2; scene.add(moon);

  const envMats = [];
  scene.traverse((o) => {
    for (const m of o.material ? [].concat(o.material) : []) if (m.envMapIntensity !== undefined && !envMats.some((e) => e.m === m)) envMats.push({ m, base: m.envMapIntensity });
  });
  const C = (h) => new THREE.Color(h), RGB = (r, g, b) => new THREE.Color(r, g, b);
  // keyframes: day → sunset → dusk → night (sunrise plays the same path backwards)
  const KEYS = [0, 0.38, 0.62, 1];
  const LOOK = {
    sun: [C(0xffd7a0), C(0xff8a45), C(0xd0708f), C(0x9fb6e8)], sunI: [3.8, 3.3, 0.9, 2.0],
    hemiSky: [C(0xf1dcc8), C(0xf4b48a), C(0x6a4f7a), C(0x2a3550)], hemiGround: [C(0x6a4a36), C(0x6a3a26), C(0x2a1f22), C(0x14110e)], hemiI: [0.5, 0.45, 0.3, 0.2],
    sky: [RGB(1.5, 1.45, 1.4), RGB(1.9, 0.95, 0.6), RGB(0.55, 0.32, 0.6), RGB(0.09, 0.12, 0.25)],
    fog: [C(0x8a6c52), C(0x9a5c3a), C(0x3a2a3a), C(0x141a26)], bg: [C(0x1a1009), C(0x1e0f08), C(0x120c14), C(0x07090f)],
    shaft: [RGB(1, 0.78, 0.5), RGB(1, 0.55, 0.3), RGB(0.8, 0.45, 0.6), RGB(0.55, 0.7, 1)], shaftI: [0.07, 0.09, 0, 0.06],
    mote: [C(0xffe0b0), C(0xffc090), C(0xd0a0c0), C(0xbfd0ff)], moteO: [0.7, 0.75, 0.4, 0.45],
    pend: [22, 20, 9, 0], bulb: [5, 5, 2.2, 0], bench: [110, 90, 25, 0], stand: [70, 60, 16, 0],
    expo: [0.72, 0.74, 0.82, 0.95], envK: [1, 0.9, 0.5, 0.3],
  };
  const ramp = (arr, t, out) => {
    let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1]) i++;
    const k = clamp((t - KEYS[i]) / (KEYS[i + 1] - KEYS[i]), 0, 1);
    return out ? out.copy(arr[i]).lerp(arr[i + 1], k) : lerp(arr[i], arr[i + 1], k);
  };

  // soft dissolve for whoever is in the room: a per-pixel threshold injected into every material
  const figFade = { value: 1 }, catFade = { value: 0 };
  const fadeable = (root, u) => {
    const seen = new Set();
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    root.traverse((o) => {
      if (o.castShadow) o.customDepthMaterial = depth;
      for (const m of (o.material ? [].concat(o.material) : []).concat(o.castShadow ? [depth] : [])) {
        if (seen.has(m)) continue; seen.add(m);
        const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
        m.onBeforeCompile = (sh, r) => {
          prev.call(m, sh, r);
          sh.uniforms.uFade = u;
          sh.fragmentShader = 'uniform float uFade;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>',
            `#include <clipping_planes_fragment>
            if (uFade < 0.999) { float dz = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453); if (dz > uFade) discard; }`);
        };
        m.customProgramCacheKey = () => key + '|fade';
        m.needsUpdate = true;
      }
    });
    return (f) => { root.visible = f > 0.002; };
  };
  const setFig = fadeable(counselFig, figFade), setCat = fadeable(cat, catFade);

  const env = { t: 0 };
  let night = false;
  function applyEnv(t) {
    ramp(LOOK.sun, t, sun.color); sun.intensity = ramp(LOOK.sunI, t);
    ramp(LOOK.hemiSky, t, hemi.color); ramp(LOOK.hemiGround, t, hemi.groundColor); hemi.intensity = ramp(LOOK.hemiI, t);
    for (const pl of pendants) pl.intensity = ramp(LOOK.pend, t);
    M.bulb.emissiveIntensity = ramp(LOOK.bulb, t);
    benchSpot.intensity = ramp(LOOK.bench, t); standSpot.intensity = ramp(LOOK.stand, t);
    ramp(LOOK.sky, t, skyMat.color);
    ramp(LOOK.fog, t, scene.fog.color); ramp(LOOK.bg, t, scene.background);
    ramp(LOOK.shaft, t, shaftMat.uniforms.uColor.value); shaftMat.uniforms.uI.value = ramp(LOOK.shaftI, t);
    ramp(LOOK.mote, t, motes.material.color); motes.material.opacity = ramp(LOOK.moteO, t);
    moon.material.opacity = ss01(0.55, 1, t);
    renderer.toneMappingExposure = ramp(LOOK.expo, t);
    const ek = ramp(LOOK.envK, t);
    for (const e of envMats) e.m.envMapIntensity = e.base * ek;
    figFade.value = 1 - ss01(0.3, 0.6, t); setFig(figFade.value);
    catFade.value = ss01(0.5, 0.85, t); setCat(catFade.value);
  }
  const ss01 = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  let envTween = null;
  function toggleNight() {
    night = !night;
    document.documentElement.classList.toggle('night', night);
    const D = reduced ? 0.01 : 4.5;
    envTween?.kill();
    envTween = gsap.timeline()
      .to(env, { t: night ? 1 : 0, duration: D, ease: 'sine.inOut', onUpdate: () => applyEnv(env.t) }, 0)
      .to(clockSpin, { h: Math.round(clockSpin.h / 12) * 12 + 12, duration: D, ease: 'power3.inOut' }, 0);
  }
  applyEnv(0);

  /* ───── css3d layer (the page content, living on the objects above) ───── */
  const cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(W, H);
  Object.assign(cssRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  stage.appendChild(cssRenderer.domElement);
  const cssScene = new THREE.Scene();
  const cssCamera = new THREE.PerspectiveCamera(40, W / H, 0.1, 10000);

  const panelEls = {};
  for (const [id, p] of Object.entries(PANELS)) {
    const el = panels.querySelector('#' + id);
    el.style.width = p.w + 'px'; el.style.height = p.h + 'px';
    panelEls[id] = el;
    const obj = new CSS3DObject(el);
    const n = new V3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    obj.position.set(p.pos[0] + n.x * 0.012, p.pos[1], p.pos[2] + n.z * 0.012).multiplyScalar(K);
    obj.rotation.y = p.yaw;
    obj.scale.setScalar(p.wpp * K);
    cssScene.add(obj);
  }

  /* ───── post ───── */
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: lowPower ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(DPR); composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, { focus: 5, aperture: 0.0006, maxblur: 0.008 });
  const bokehRender = bokeh.render.bind(bokeh);
  bokeh.render = (...a) => { fx.visible = false; bokehRender(...a); fx.visible = true; };
  bokeh.enabled = !lowPower;
  composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), lowPower ? 0.18 : 0.26, 0.6, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const film = new ShaderPass(FilmShader);
  film.uniforms.uRes.value.set(W * DPR, H * DPR);
  composer.addPass(film);

  /* ───── camera rig ───── */
  let docked = false;
  const computeDocked = () => W < 760 || W / H < 0.95 || H < 560;
  docked = computeDocked();

  function poseFor(i) {
    const st = STATIONS[i], ps = st.panels.map((id) => PANELS[id]);
    const tanV = Math.tan(degToRad(st.fov / 2)), tanH = tanV * camera.aspect;
    let minX = 1e9, maxX = -1e9, hMax = 0, cy = 0, cz = 0, nx = 0, nz = 0;
    for (const p of ps) {
      const hw = (p.w * p.wpp) / 2, hh = (p.h * p.wpp) / 2;
      minX = Math.min(minX, p.pos[0] - hw); maxX = Math.max(maxX, p.pos[0] + hw);
      hMax = Math.max(hMax, hh * 2); cy += p.pos[1]; cz += p.pos[2];
      nx += Math.sin(p.yaw); nz += Math.cos(p.yaw);
    }
    const c = new V3((minX + maxX) / 2, cy / ps.length, cz / ps.length);
    const n = new V3(nx, 0, nz).normalize();
    const fillH = docked ? 0.4 : st.fillH, fillW = docked ? 0.8 : st.fillW;
    const dist = Math.max(0.9, hMax / (2 * tanV * fillH), (maxX - minX) / (2 * tanH * fillW));
    return {
      px: c.x + n.x * dist, py: c.y + n.y * dist + st.lift, pz: c.z + n.z * dist,
      tx: c.x, ty: c.y + st.tOff, tz: c.z, fov: st.fov,
    };
  }

  const rig = { px: 0, py: 1.65, pz: 9.3, tx: 0, ty: 2.3, tz: 0, fov: 44, arc: 0 };
  let cur = -1, tween = null, activeCall = null;

  function setActive(station) {
    for (const [id, el] of Object.entries(panelEls)) el.classList.toggle('active', PANELS[id].station === station);
    if (docked) fillDock(station);
  }
  function fillDock(station) {
    dock.classList.remove('in');
    dock.innerHTML = '';
    if (station < 0) return;
    for (const id of STATIONS[station].panels) {
      const c = panelEls[id].cloneNode(true);
      c.removeAttribute('id'); c.removeAttribute('style'); c.classList.add('active');
      dock.appendChild(c);
    }
    dock.scrollTop = 0;
    requestAnimationFrame(() => dock.classList.add('in'));
  }

  function goTo(i, { instant = false } = {}) {
    i = clamp(i, 0, STATIONS.length - 1);
    const first = cur === -1;
    cur = i;
    onStation?.(i, STATIONS[i]);
    const pose = poseFor(i);
    tween?.kill(); activeCall?.kill(); gsap.killTweensOf(rig);
    setActive(-1);

    const travel = Math.hypot(pose.px - rig.px, pose.py - rig.py, pose.pz - rig.pz);
    const D = instant || reduced ? 0.01 : first ? 2.8 : clamp(1.25 + travel * 0.09, 1.5, 2.5);
    const amp = instant || reduced ? 0 : clamp(travel * 0.07, 0.15, 0.85);

    tween = gsap.timeline();
    tween.to(rig, { px: pose.px, py: pose.py, pz: pose.pz, fov: pose.fov, duration: D, ease: 'power3.inOut' }, 0);
    tween.to(rig, { tx: pose.tx, ty: pose.ty, tz: pose.tz, duration: D * 0.9, ease: 'power2.inOut' }, D * 0.1);
    tween.to(rig, { arc: amp, duration: D * 0.5, ease: 'sine.out' }, 0);
    tween.to(rig, { arc: 0, duration: D * 0.5, ease: 'sine.inOut' }, D * 0.5);
    activeCall = gsap.delayedCall(D * 0.62, () => setActive(i));
  }

  /* ───── pointer parallax ───── */
  let mx = 0, my = 0, smx = 0, smy = 0, hasPointer = false;
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    hasPointer = true;
    mx = (e.clientX / W) * 2 - 1; my = -((e.clientY / H) * 2 - 1);
  });

  /* ───── the clock is the one thing in the room you can click ───── */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const overClock = (e) => {
    ndc.set((e.clientX / W) * 2 - 1, -((e.clientY / H) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.isMesh && h.object.visible);
    let o = hit?.object;
    while (o && o !== clock) o = o.parent;
    return !!o;
  };
  let hoverQ = false, lastMove = null, downAt = null;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    lastMove = e;
    if (hoverQ) return;
    hoverQ = true;
    requestAnimationFrame(() => { hoverQ = false; stage.style.cursor = lastMove && overClock(lastMove) ? 'pointer' : ''; });
  });
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    if (overClock(e)) toggleNight();
  });

  /* ───── resize ───── */
  function resize() {
    W = innerWidth; H = innerHeight;
    renderer.setSize(W, H); composer.setSize(W, H);
    cssRenderer.setSize(W, H);
    film.uniforms.uRes.value.set(W * DPR, H * DPR);
    camera.aspect = W / H; cssCamera.aspect = W / H;
    const wasDocked = docked;
    docked = computeDocked();
    document.documentElement.classList.toggle('docked', docked);
    cssRenderer.domElement.style.display = docked ? 'none' : '';
    if (docked) camera.setViewOffset(W, H, 0, H * 0.16, W, H); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (cur >= 0 && !tween?.isActive()) {
      const p = poseFor(cur);
      Object.assign(rig, p);
      if (wasDocked !== docked) setActive(cur);
    }
  }
  let rzT;
  addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(resize, 80); });
  resize();

  /* ───── render loop ───── */
  const up = new V3(0, 1, 0), base = new V3(), tgt = new V3(), fwd = new V3(), right = new V3(), look = new V3();
  let frame = 0, lastFov = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const t = now / 1000;
    frame++;

    if (!reduced) {
      const idleX = Math.sin(t * 0.31) * 0.45, idleY = Math.sin(t * 0.23) * 0.3;
      const tx = hasPointer ? mx : idleX, ty = hasPointer ? my : idleY;
      smx += (tx - smx) * 0.045; smy += (ty - smy) * 0.045;
    }

    base.set(rig.px, rig.py + rig.arc, rig.pz);
    tgt.set(rig.tx, rig.ty, rig.tz);
    fwd.subVectors(tgt, base); const dist = fwd.length(); fwd.normalize();
    right.crossVectors(fwd, up).normalize();
    const px = clamp(dist * 0.05, 0.1, 0.3);
    camera.position.copy(base).addScaledVector(right, smx * px).addScaledVector(up, smy * px * 0.55);
    look.copy(tgt).addScaledVector(right, smx * px * 0.35);
    camera.lookAt(look);

    const fov = rig.fov + rig.arc * 1.6;
    if (Math.abs(fov - lastFov) > 0.001) { camera.fov = fov; camera.updateProjectionMatrix(); lastFov = fov; }

    bokeh.uniforms.focus.value = camera.position.distanceTo(tgt);
    film.uniforms.uTime.value = frame % 997;
    if (!reduced) updateMotes(t);
    updateClock();

    composer.render();

    if (!docked) {
      cssCamera.position.copy(camera.position).multiplyScalar(K);
      cssCamera.quaternion.copy(camera.quaternion);
      cssCamera.fov = camera.fov;
      cssCamera.updateProjectionMatrix();
      cssRenderer.render(cssScene, cssCamera);
    }
  }
  requestAnimationFrame(loop);

  // let the first frames compile shaders before the intro starts
  await new Promise((r) => setTimeout(r, 60));
  composer.render();

  return {
    goTo,
    toggleNight,
    get current() { return cur; },
    count: STATIONS.length,
    stations: STATIONS,
  };
}
