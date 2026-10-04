import * as THREE from 'three';
import Lenis from 'lenis';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { sandTextures, stoneTexture, createTerrain, createPour, createDrift } from './sand.js';

// Swap this for the high-resolution museum clip. Landscape fills the screen;
// portrait is shown sharp in the centre over a blurred fill.
const VIDEO_SRC = 'assets/museum.mp4';

const MOBILE = matchMedia('(max-width: 760px)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const START_Y = -1.0;       // rose depth when buried
const SWAP_T = 1.7;         // timeline point where the sandstorm hides the desert → gallery switch
const R0 = .6;              // rose heading while in the desert

// ---------- timeline helpers ----------
const clamp01 = x => Math.min(Math.max(x, 0), 1);
const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
const EASE = { io: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, in: t => t * t * t, out: t => 1 - Math.pow(1 - t, 3), lin: t => t };
function track(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1], f = EASE[e || 'io']((t - t0) / (t1 - t0));
      return Array.isArray(v0) ? v0.map((a, j) => a + (v1[j] - a) * f) : v0 + (v1 - v0) * f;
    }
  }
  return keys[keys.length - 1][1];
}

// Section index = timeline unit: 0 hero · 1 rise · 2 resin · 3 detail · 4 closer · 5 museum · 6 home · 7 object
const K = {
  //            camera xyz        target xyz      screen shift
  cam: [[0, [0, .55, 5.6, 0, .4, 0, .14]],
        [.95, [2.3, 1.35, 4.6, 0, .95, 0, .2]],
        [SWAP_T, [2.8, 1.5, 3.2, 0, 1, 0, .1]],
        [2.25, [-2.6, 1.7, 4.4, 0, .95, 0, -.2]],
        [3, [1.25, 1.6, 2.45, 0, 1.05, 0, -.24]],
        [4, [0, 3.8, 2.3, 0, .95, 0, .2]],
        [4.62, [0, 1.42, .16, 0, .95, -.1, 0], 'in'],
        [5.9, [0, 2.4, 4.6, 0, .5, 0, .18]],
        [6.65, [.4, 1.9, 3.8, 0, .4, 0, .18]],
        [7.35, [0, 1.6, 6.4, 0, 1.05, 0, .18]]],
  fog: [[0, .0065], [1.2, .009], [SWAP_T, .6, 'in'], [2.15, 0, 'out']],
  storm: [[1.15, 0], [SWAP_T, 1, 'in'], [2.15, 0, 'out']],
  resin: [[2.1, 0], [3, 1]],
  exposure: [[0, .82], [SWAP_T, .82], [2, 1], [4.05, 1], [4.6, 3.4, 'in'], [4.62, 1]],
  bloom: [[0, .2], [4.05, .2], [4.6, 1.5, 'in'], [4.62, .25]],
  flash: [[4.4, 0], [4.6, 1, 'in'], [4.95, 0, 'out']],
  video: [[4.56, 0], [4.6, 1, 'lin']],
  iris: [[5.85, 1], [6.15, 0, 'in']],
  hots: [[2.7, 0], [2.85, 1], [3.35, 1], [3.5, 0]],
  tint: [[0, [1, .8, .6]], [5.9, [1, .8, .6]], [6.05, [.9, .12, .3]], [6.85, [.9, .12, .3]], [7.2, [1, .85, .68]]],
  homeY: [[5.85, 1.35], [6.45, .045]],
  roseScale: [[5.8, 1], [5.85, .42], [6.9, .42], [7.2, 1]],
  lid: [[5.85, [0, 1.9, .35]], [6.4, [0, 1.9, .35]], [6.7, [0, .84, 0]], [6.8, [0, .84, 0]], [7.12, [4.5, 6.5, -1.2]]],
  unfold: [[6.85, 0], [7.12, 1]],
  vitrine: [[7.1, 0], [7.42, 1]],
};

// ---------- renderer / scene ----------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const DPR = Math.min(devicePixelRatio, MOBILE ? 1.5 : 1.75);
renderer.setPixelRatio(DPR);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, .03, 600);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
scene.fog = new THREE.FogExp2(0xdcb486, .0065);

// sky: golden-hour gradient + sun in the desert, dark gallery backdrop afterwards
const sun = new THREE.DirectionalLight(0xffc68a, 3.2);
sun.position.set(-6, 4.2, -4);
const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uSun: { value: sun.position.clone().normalize() }, uStudio: { value: 0 }, uTint: { value: new THREE.Vector3(1, .8, .6) } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position.z = gl_Position.w; }`,
  fragmentShader: `
    uniform vec3 uSun, uTint; uniform float uStudio; varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir); float h = d.y;
      vec3 top = vec3(.16, .3, .55), hor = vec3(1., .7, .42), low = vec3(.78, .55, .34);
      vec3 c = h > 0. ? mix(hor, top, pow(h, .45)) : mix(hor, low, pow(-h, .4));
      float s = max(dot(d, uSun), 0.);
      c += vec3(1., .72, .42) * (pow(s, 6.) * .45 + pow(s, 80.) * .8) + vec3(1., .92, .75) * smoothstep(.9993, .9997, s) * 8.;
      vec3 studio = uTint * (.012 + .05 * exp(-pow(h - .05, 2.) * 7.));
      gl_FragColor = vec4(mix(c, studio, uStudio), 1.);
    }`
}));
sky.renderOrder = -1; scene.add(sky);

// lights
const hemi = new THREE.HemisphereLight(0x9fb6e0, 0xa8743f, .45); scene.add(hemi);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: .5, far: 30 });
sun.shadow.bias = -.0004; sun.shadow.normalBias = .02; scene.add(sun);
const fill = new THREE.DirectionalLight(0xffe2c0, .45); fill.position.set(4, 2, 6); scene.add(fill);
const spot = new THREE.SpotLight(0xffe2c4, 0, 0, .42, .75, 0);
spot.position.set(2.4, 7.5, 3.6); spot.target.position.set(0, .7, 0);
spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.bias = -.0003; spot.shadow.normalBias = .02;
scene.add(spot, spot.target);
const rim = new THREE.DirectionalLight(0xdcdfff, 0); rim.position.set(-3, 3, -5); scene.add(rim);

// ---------- loading ----------
const manager = new THREE.LoadingManager();
const pctEl = document.getElementById('pct'), barEl = document.getElementById('bar');
manager.onProgress = (_, l, t) => { pctEl.textContent = Math.round(l / t * 100) + '%'; barEl.style.transform = `scaleX(${l / t})`; };
manager.itemStart('rose.bin'); manager.itemStart(VIDEO_SRC);
const texLoader = new THREE.TextureLoader(manager);
const tex = (f, srgb) => { const t = texLoader.load('assets/' + f); t.anisotropy = renderer.capabilities.getMaxAnisotropy(); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };

// ---------- desert ----------
const desert = new THREE.Group(); scene.add(desert);
const terrain = createTerrain(sandTextures(MOBILE ? 512 : 1024), MOBILE ? 220 : 360); desert.add(terrain);
const drift = createDrift(MOBILE ? 5000 : 14000); scene.add(drift);
let pour = null;

// ---------- gallery ----------
const gallery = new THREE.Group(); gallery.visible = false; scene.add(gallery);
const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ color: 0x0e0a08, roughness: .95, envMapIntensity: .2 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -1.2; floor.receiveShadow = true; gallery.add(floor);
const stone = stoneTexture();
const pedestal = new THREE.Mesh(new RoundedBoxGeometry(2.8, 1.2, 2.8, 4, .03), new THREE.MeshStandardMaterial({ map: stone, color: 0x9a8a7c, roughness: .82 }));
pedestal.position.y = -.6; pedestal.receiveShadow = pedestal.castShadow = true; gallery.add(pedestal);
gallery.add(plaque());

function plaque() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const x = c.getContext('2d');
  const paint = () => {
    const g = x.createLinearGradient(0, 0, 1024, 256);
    g.addColorStop(0, '#9c7a3c'); g.addColorStop(.5, '#e2c27a'); g.addColorStop(1, '#8a6a32');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 256);
    x.fillStyle = '#2a1d0c'; x.textAlign = 'center';
    x.font = '600 76px "Cormorant Garamond", serif'; x.fillText('DESERT ROSE', 512, 118);
    x.font = '30px "JetBrains Mono", monospace'; x.fillText('RESIN  ·  10 × 10 CM  ·  QATAR', 512, 188);
  };
  paint();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (!x.redrawn) document.fonts.ready.then(() => { x.redrawn = true; paint(); t.needsUpdate = true; });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(.9, .225), new THREE.MeshStandardMaterial({ map: t, metalness: .85, roughness: .35 }));
  m.position.set(0, -.42, 1.402); return m;
}

// gift box in Qatar maroon with a gold ribbon; walls hinge outward to unbox
const box = (() => {
  const g = new THREE.Group(), W = 1.3, H = .7, T = .04;
  const maroon = new THREE.MeshPhysicalMaterial({ color: 0x4a0a1c, roughness: .62, sheen: .35, sheenColor: new THREE.Color(0xa8405c), sheenRoughness: .6 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8b25e, metalness: 1, roughness: .26 });
  const add = (parent, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  add(g, new THREE.BoxGeometry(W, T, W), maroon, 0, T / 2, 0);
  const walls = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group(); pivot.rotation.y = i * Math.PI / 2; g.add(pivot);
    const hinge = new THREE.Group(); hinge.position.set(0, T, W / 2); pivot.add(hinge);
    add(hinge, new THREE.BoxGeometry(W, H, T), maroon, 0, H / 2, -T / 2);
    add(hinge, new THREE.BoxGeometry(.14, H, T * 1.3), gold, 0, H / 2, -T / 2);
    walls.push(hinge);
  }
  const lid = new THREE.Group(); g.add(lid);
  add(lid, new RoundedBoxGeometry(W + .08, .2, W + .08, 3, .02), maroon, 0, 0, 0);
  add(lid, new THREE.BoxGeometry(W + .1, .205, .14), gold, 0, 0, 0);
  add(lid, new THREE.BoxGeometry(.14, .205, W + .1), gold, 0, 0, 0);
  for (const s of [-1, 1]) { const b = add(lid, new THREE.TorusGeometry(.13, .035, 12, 32), gold, s * .12, .16, 0); b.rotation.set(0, Math.PI / 2, s * .5); b.scale.z = .6; }
  g.visible = false; gallery.add(g);
  return { g, walls, lid };
})();

// museum vitrine
const vitrine = new THREE.Group(); vitrine.visible = false; gallery.add(vitrine);
const glassGeo = new THREE.BoxGeometry(2.5, 2.4, 2.5);
const glass = new THREE.Mesh(glassGeo, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .04, transparent: true, opacity: .035, envMapIntensity: 1, depthWrite: false }));
const edges = new THREE.LineSegments(new THREE.EdgesGeometry(glassGeo), new THREE.LineBasicMaterial({ color: 0xf5dfbd, transparent: true, opacity: .45 }));
vitrine.add(glass, edges);

// ---------- the rose (photo-scanned sculpture) ----------
const rose = new THREE.Group(); scene.add(rose);
let roseMat = null, roseMesh = null;
const hotPts = [];
fetch('assets/rose.bin').then(r => r.arrayBuffer()).then(b => {
  const [nv, ni] = new Uint32Array(b, 0, 2), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b, 8, nv * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b, 8 + nv * 12, nv * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b, 8 + nv * 24, nv * 2), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(b, 8 + nv * 32, ni), 1));
  roseMat = new THREE.MeshPhysicalMaterial({
    map: tex('rose_color.jpg', true), normalMap: tex('rose_normal.jpg'), aoMap: tex('rose_ao.jpg'),
    roughness: .95, clearcoat: 0, clearcoatRoughness: .25, envMapIntensity: .35
  });
  roseMesh = new THREE.Mesh(g, roseMat);
  roseMesh.castShadow = roseMesh.receiveShadow = true;
  rose.add(roseMesh);
  // hotspot anchors: crown, widest petal, front petal
  const p = g.attributes.position, best = [[-1e9, 0], [-1e9, 0], [-1e9, 0]];
  for (let i = 0; i < p.count; i++) {
    const s = [p.getY(i), p.getX(i) + p.getY(i) * .3, p.getZ(i) - Math.abs(p.getY(i) - .7)];
    s.forEach((v, k) => { if (v > best[k][0]) best[k] = [v, i]; });
  }
  best.forEach(([, i]) => hotPts.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i))));
  pour = createPour(roseMesh, MOBILE ? 16000 : 45000, START_Y);
  pour.rotation.y = R0; desert.add(pour);
  manager.itemEnd('rose.bin');
});

// ---------- museum video (scroll-scrubbed) ----------
const vLayer = document.getElementById('museum'), vCan = document.getElementById('museumCanvas'), vCtx = vCan.getContext('2d');
const vid = document.getElementById('museumVideo');
let vReady = false, vSeeking = false, vSeekAt = 0, vDone = false;
const videoDone = () => { if (!vDone) { vDone = true; manager.itemEnd(VIDEO_SRC); } };
setTimeout(videoDone, 8000);          // never let a slow or unsupported video hold the page hostage
fetch(VIDEO_SRC).then(r => r.blob()).then(b => {
  vid.addEventListener('loadeddata', () => {
    vid.play().then(() => vid.pause()).catch(() => {});
    vReady = true; drawVideo(); videoDone();
  }, { once: true });
  vid.src = URL.createObjectURL(b); vid.load();
}).catch(videoDone);
vid.addEventListener('seeked', () => { vSeeking = false; drawVideo(); });
function drawVideo() {
  const W = vCan.width, H = vCan.height, vw = vid.videoWidth, vh = vid.videoHeight;
  if (!vw || !W) return;
  const draw = s => vCtx.drawImage(vid, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
  const cover = Math.max(W / vw, H / vh), contain = Math.min(W / vw, H / vh);
  if (vw / vh >= (W / H) * .75) draw(cover);
  else { vCtx.filter = 'blur(40px) brightness(.5)'; draw(cover * 1.1); vCtx.filter = 'none'; draw(contain); }
}
function scrubVideo(f) {
  if (!vReady || !vid.duration) return;
  const want = f * (vid.duration - .05);
  if (vSeeking && performance.now() - vSeekAt > 400) vSeeking = false;
  if (!vSeeking && Math.abs(vid.currentTime - want) > 1 / 60) { vSeeking = true; vSeekAt = performance.now(); vid.currentTime = want; }
}

// ---------- post-processing ----------
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: MOBILE ? 0 : 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .2, .6, .86); composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb *= mix(1., smoothstep(.95, .25, length(vUv - .5)), .5);
      c.rgb += (h(vUv * 1000. + fract(uTime)) - .5) * .035;
      gl_FragColor = c;
    }`
});
composer.addPass(grade);

// ---------- scroll ----------
history.scrollRestoration = 'manual'; scrollTo(0, 0);
const lenis = new Lenis({ lerp: REDUCED ? 1 : .085, smoothWheel: true });
lenis.stop();
const sections = [...document.querySelectorAll('[data-sec]')];
let tops = [], heights = [];
const measure = () => { tops = sections.map(s => s.offsetTop); heights = sections.map(s => s.offsetHeight); };
function timeline(y) {
  let i = 0; while (i < sections.length - 1 && y >= tops[i + 1]) i++;
  return i + clamp01((y - tops[i]) / heights[i]);
}
document.querySelectorAll('[data-go]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); lenis.scrollTo(sections[+a.dataset.go], { duration: 2.2 });
}));
const io = new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('in', e.isIntersecting)), { threshold: .35 });
document.querySelectorAll('.card').forEach(c => io.observe(c));

// drag to turn (final chapter)
const drag = { angle: 0, vel: 0, down: false, x: 0, on: false };
addEventListener('pointerdown', e => { if (drag.on && !e.target.closest('a,button')) { drag.down = true; drag.x = e.clientX; } });
addEventListener('pointermove', e => { if (drag.down) { const dx = e.clientX - drag.x; drag.x = e.clientX; drag.vel = dx * .008; drag.angle += drag.vel; } });
addEventListener('pointerup', () => drag.down = false);

// ---------- resize ----------
let W = 1, H = 1;
function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setSize(W, H); composer.setSize(W, H); bloom.resolution.set(W, H);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  vCan.width = W * Math.min(devicePixelRatio, 2); vCan.height = H * Math.min(devicePixelRatio, 2); drawVideo();
  measure();
}
addEventListener('resize', resize); resize();

// ---------- frame ----------
const hud = { count: document.getElementById('count'), nav: [...document.querySelectorAll('nav a')], prog: document.getElementById('prog'),
  flash: document.getElementById('flash'), hots: [...document.querySelectorAll('.hot')] };
const CH = [1, 1, 2, 2, 3, 3, 4, 5];
const pos = new THREE.Vector3(), tgt = new THREE.Vector3(), v3 = new THREE.Vector3();
let introAt = 0, started = false, lastNow = 0, lastCh = 0;

function update(t, time, dt) {
  const inDesert = t < SWAP_T;
  desert.visible = inDesert; gallery.visible = !inDesert;
  document.body.classList.toggle('desert', inDesert);

  // atmosphere + light
  scene.fog.density = track(K.fog, t);
  sky.material.uniforms.uStudio.value = inDesert ? 0 : 1;
  sky.material.uniforms.uTint.value.fromArray(track(K.tint, t));
  hemi.color.setHex(inDesert ? 0x9fb6e0 : 0xffe2c4); hemi.groundColor.setHex(inDesert ? 0xa8743f : 0x2a1a10);
  sun.intensity = inDesert ? 2.1 : 0; hemi.intensity = inDesert ? .45 : .12;
  fill.intensity = inDesert ? .22 : .3; spot.intensity = inDesert ? 0 : 3.4; rim.intensity = inDesert ? 0 : .7;
  renderer.toneMappingExposure = track(K.exposure, t);
  bloom.strength = track(K.bloom, t);

  // sand
  const mound = 1 - .82 * smooth(t);
  terrain.userData.mound.value = mound;
  if (pour) { const u = pour.material.uniforms; u.uT.value = t; u.uMound.value = mound; u.uScale.value = H * DPR * .5 * camera.projectionMatrix.elements[5]; }
  const storm = track(K.storm, t), du = drift.material.uniforms;
  du.uScale.value = H * DPR * .5 * camera.projectionMatrix.elements[5]; du.uTime.value = time;
  if (inDesert) {
    const wind = 1.2 + storm * 14;
    du.uOffset.value.x += wind * dt; du.uOffset.value.z += wind * .25 * dt;
    du.uCenter.value.set(camera.position.x * (1 - storm) , -.1, camera.position.z * (1 - storm) - 3 * storm);
    du.uBox.value.set(30 - storm * 18, 3 + storm * 4, 30 - storm * 18);
    du.uLow.value = 2.5 - storm * 1.5; du.uSize.value = .02 + storm * .03; du.uOpacity.value = .5 + storm * .5;
    du.uColor.value.setRGB(.88, .72, .5);
  } else {                                   // dust motes drifting through the spotlight
    du.uOffset.value.x += .05 * dt; du.uOffset.value.y += .03 * dt;
    du.uCenter.value.set(0, -.2, 0); du.uBox.value.set(5, 4, 5); du.uLow.value = 1;
    du.uSize.value = .0055; du.uOpacity.value = .35 * Math.max(storm, 1 - track(K.video, t)); du.uColor.value.setRGB(1, .88, .7);
  }

  // rose
  if (roseMat) {
    const k = track(K.resin, t);
    roseMat.roughness = .95 - .4 * k; roseMat.clearcoat = .4 * k; roseMat.envMapIntensity = .35 + .4 * k;
  }
  const s = track(K.roseScale, t);
  rose.scale.setScalar(s);
  rose.position.y = t < 5.85 ? START_Y * (1 - smooth(t)) : track(K.homeY, t);
  drag.on = t > 7.2; document.body.classList.toggle('grab', drag.on);
  if (!drag.down) { drag.angle += drag.vel; drag.vel *= .94; }
  rose.rotation.y = inDesert ? R0 : R0 + (t - SWAP_T) * 1.1 + time * .05 + drag.angle;

  // gift box + vitrine
  box.g.visible = t > 5.8;
  const lid = track(K.lid, t); box.lid.position.set(lid[0], lid[1], 0); box.lid.rotation.set(0, 0, lid[2]);
  const un = track(K.unfold, t); box.walls.forEach(w => w.rotation.x = un * Math.PI / 2);
  const vt = track(K.vitrine, t);
  vitrine.visible = vt > .001; vitrine.position.y = 1.25 + (1 - vt) * 4; glass.material.opacity = .035 * vt; edges.material.opacity = .45 * vt;

  // camera
  const c = track(K.cam, t);
  pos.set(c[0], c[1], c[2]); tgt.set(c[3], c[4], c[5]);
  let shift = c[6], lift = 0;
  const intro = REDUCED ? 0 : 1 - EASE.out(clamp01((time - introAt) / 3.2));
  pos.z += intro * 2.4; pos.y += intro * .5;
  if (storm > 0) { pos.x += Math.sin(time * 23) * .025 * storm; pos.y += Math.sin(time * 31) * .018 * storm; }
  if (camera.aspect < 1) { pos.sub(tgt).multiplyScalar(1 + (1 - camera.aspect) * 1.1).add(tgt); shift = 0; lift = .17 * (1 - (t > 4 && t < 4.6 ? smooth((t - 4) / .5) : 0)); }   // centre again for the dive
  camera.position.copy(pos); camera.lookAt(tgt);
  camera.setViewOffset(W, H, -shift * W, lift * H, W, H);
  sky.position.copy(camera.position);

  // museum video, flash, iris
  const vo = track(K.video, t), iris = track(K.iris, t);
  vLayer.style.opacity = vo;
  vLayer.style.clipPath = iris < 1 ? `circle(${iris * 75}% at 50% 50%)` : 'none';
  if (vo > 0) {
    const f = clamp01((t - 4.6) / 1.25);
    scrubVideo(f); vCan.style.transform = `scale(${1.08 - .08 * f})`;
  }
  hud.flash.style.opacity = track(K.flash, t);

  // hotspots
  const ho = track(K.hots, t);
  hud.hots.forEach((el, i) => {
    el.style.opacity = ho;
    if (ho > 0 && roseMesh && hotPts[i]) {
      v3.copy(hotPts[i]).applyMatrix4(roseMesh.matrixWorld).project(camera);
      el.style.transform = `translate(${(v3.x * .5 + .5) * W}px, ${(-v3.y * .5 + .5) * H}px)`;
    }
  });

  // HUD
  const ch = CH[Math.min(Math.floor(t), 7)];
  if (ch !== lastCh) { lastCh = ch; hud.count.textContent = `0${ch} / 05`; hud.nav.forEach((a, i) => a.classList.toggle('on', i === ch - 1)); }
  hud.prog.style.transform = `scaleY(${clamp01(lenis.scroll / (document.documentElement.scrollHeight - H))})`;

  return vo >= 1 && iris >= 1 && track(K.flash, t) < .01;   // true when the video fully covers the 3D scene
}

renderer.setAnimationLoop(now => {
  const dt = Math.min((now - lastNow) / 1000, .05); lastNow = now;
  const time = now / 1000;
  lenis.raf(now);
  const t = timeline(lenis.scroll);
  rose.updateMatrixWorld();
  const covered = update(t, time, dt);
  grade.uniforms.uTime.value = time;
  if (!covered) composer.render();
});

manager.onLoad = () => {
  if (started) return; started = true;
  measure(); introAt = performance.now() / 1000;
  document.body.classList.add('ready');
  lenis.start();
  // deep link for review: index.html#t=4.3 jumps to that point in the timeline
  const m = location.hash.match(/t=([\d.]+)/);
  if (m) { const t = +m[1], i = Math.min(Math.floor(t), sections.length - 1); lenis.scrollTo(tops[i] + (t - i) * heights[i], { immediate: true, force: true }); introAt = -99; }
};
