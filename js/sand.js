import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

// Shared by the terrain mound and the falling grains so grains land on the surface.
export const MOUND_A = 1.0, MOUND_S = 1.9;

// ---------- deterministic value noise (tileable when given a period) ----------
const P = new Uint8Array(512);
{
  let s = 1337; const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
}
export const hash = (x, y) => P[(P[x & 255] + (y & 255)) & 511] / 255;
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
export function noise(x, y, per = 256) {
  const xi = Math.floor(x), yi = Math.floor(y), u = fade(x - xi), v = fade(y - yi);
  const x0 = ((xi % per) + per) % per, y0 = ((yi % per) + per) % per, x1 = (x0 + 1) % per, y1 = (y0 + 1) % per;
  const a = hash(x0, y0), b = hash(x1, y0), c = hash(x0, y1), d = hash(x1, y1);
  return a + (b - a) * u + (c - a + (d - c - b + a) * u) * v;
}
export function fbm(x, y, oct = 5, per = 256) {
  let s = 0, a = .5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f, per * f); f *= 2; a *= .5; }
  return s / (1 - Math.pow(.5, oct));
}

const canvasTex = (img, srgb) => {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

// ---------- sand surface: albedo with mineral grains + wind-ripple normal map ----------
export function sandTextures(N = 1024) {
  const H = new Float32Array(N * N), col = new ImageData(N, N), R = 6, PER = 4;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, i = y * N + x, o = i * 4;
    const warp = fbm(u * PER, v * PER, 3, PER);
    const ph = ((v * R + warp * 1.8 + .12 * Math.sin(u * Math.PI * 4)) % 1 + 1) % 1;
    const rip = ph < .72 ? ph / .72 : (1 - ph) / .28;          // gentle windward slope, steep lee
    const g = hash(x, y);
    H[i] = rip * .75 + g * .3;
    const tone = fbm(u * 16, v * 16, 3, 16);
    const k = (.84 + tone * .24) * (.9 + g * .2) * (.93 + rip * .1);
    col.data[o] = 206 * k; col.data[o + 1] = 162 * k; col.data[o + 2] = 112 * k; col.data[o + 3] = 255;
    if (g > .986) { col.data[o] *= .5; col.data[o + 1] *= .45; col.data[o + 2] *= .4; }       // dark mineral
    else if (g < .01) { col.data[o] = 255; col.data[o + 1] = 246; col.data[o + 2] = 226; }     // quartz glint
  }
  const nor = new ImageData(N, N), s = 2.4;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const l = H[y * N + (x - 1 + N) % N], r = H[y * N + (x + 1) % N];
    const d = H[((y - 1 + N) % N) * N + x], t = H[((y + 1) % N) * N + x];
    const nx = (l - r) * s, ny = (t - d) * s, len = Math.hypot(nx, ny, 1), o = (y * N + x) * 4;
    nor.data[o] = (nx / len * .5 + .5) * 255; nor.data[o + 1] = (ny / len * .5 + .5) * 255;
    nor.data[o + 2] = (1 / len * .5 + .5) * 255; nor.data[o + 3] = 255;
  }
  return { map: canvasTex(col, true), normal: canvasTex(nor, false) };
}

// Dark stone for the museum pedestal.
export function stoneTexture(N = 512) {
  const img = new ImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, k = .75 + fbm(u * 8, v * 8, 5, 8) * .35 + (hash(x, y) - .5) * .08, o = (y * N + x) * 4;
    img.data[o] = 70 * k; img.data[o + 1] = 58 * k; img.data[o + 2] = 49 * k; img.data[o + 3] = 255;
  }
  return canvasTex(img, true);
}

// ---------- dunes, with a sand mound in the centre the rose rises from ----------
export function createTerrain(maps, seg = 360) {
  const size = 240, g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
    const ridge = 1 - Math.abs(fbm(x * .02 + 7, z * .045, 4) * 2 - 1);
    const dunes = (ridge * ridge * 9 + fbm(x * .007, z * .007, 3) * 12 - 7) * THREE.MathUtils.smoothstep(r, 6, 34);
    p.setY(i, dunes + (fbm(x * .2, z * .2, 3) - .5) * .18);
  }
  g.computeVertexNormals();
  for (const t of [maps.map, maps.normal]) t.repeat.set(size / 8, size / 8);
  const mat = new THREE.MeshStandardMaterial({ map: maps.map, normalMap: maps.normal, normalScale: new THREE.Vector2(.9, .9), roughness: 1, envMapIntensity: .12 });
  const mound = { value: 1 };
  mat.onBeforeCompile = s => {
    s.uniforms.uMound = mound;
    s.vertexShader = 'uniform float uMound;\n' + s.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float mh = uMound * ${MOUND_A.toFixed(3)} * exp(-dot(position.xz, position.xz) / ${MOUND_S.toFixed(3)});
        vec2 mg = -mh * 2.0 * position.xz / ${MOUND_S.toFixed(3)};
        objectNormal = normalize(objectNormal + vec3(-mg.x, 0.0, -mg.y));`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y += mh;');
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true; mesh.userData.mound = mound;
  return mesh;
}

const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);

// ---------- grains that encrust the rose and pour off as it rises ----------
// Fully scroll-driven (no time state) so scrolling back up reverses it exactly.
export function createPour(roseMesh, count, startY) {
  const sampler = new MeshSurfaceSampler(roseMesh).build();
  const start = new Float32Array(count * 3), vel = new Float32Array(count * 3), delay = new Float32Array(count), rnd = new Float32Array(count * 2);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const rise = t => { const s = Math.min(Math.max(t, 0), 1); return startY * (1 - s * s * (3 - 2 * s)); };
  for (let i = 0; i < count; i++) {
    sampler.sample(p, n); p.addScaledVector(n, .006);
    start.set([p.x, p.y, p.z], i * 3);
    vel.set([n.x * .22 + (Math.random() - .5) * .16, n.y * .12 + Math.random() * .14, n.z * .22 + (Math.random() - .5) * .16], i * 3);   // slide off, don't spray
    let e = 1; for (let t = 0; t <= 1; t += .01) if (rise(t) + p.y > .3) { e = t; break; }   // when the grain clears the sand
    delay[i] = Math.min(e + Math.random() * .2, .8);                                            // every grain lets go before the t = 1 stop
    rnd.set([Math.random(), Math.random()], i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(start, 3));
  g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
  g.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 2));
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: { ...fogUniforms(), uT: { value: 0 }, uScale: { value: 1 }, uSize: { value: .0058 }, uMound: { value: 1 }, uStartY: { value: startY },
      uC1: { value: new THREE.Color(0xdcc29a) }, uC2: { value: new THREE.Color(0xa88559) } },   // the terrain's own sand tones
    vertexShader: `
      attribute vec3 aVel; attribute float aDelay; attribute vec2 aRnd;
      uniform float uT, uScale, uSize, uMound, uStartY;
      varying float vShade, vTone;
      #include <fog_pars_vertex>
      float rise(float t){ float s = clamp(t, 0., 1.); return uStartY * (1. - s * s * (3. - 2. * s)); }
      float ground(vec2 xz){ return uMound * ${MOUND_A.toFixed(3)} * exp(-dot(xz, xz) / ${MOUND_S.toFixed(3)}); }
      void main(){
        float g = 4.5, ft = max(uT - aDelay, 0.) * 3.4;
        vec3 o = position + vec3(0., rise(min(uT, aDelay)), 0.);
        float c = o.y - ground(o.xz);
        float th = (aVel.y + sqrt(max(aVel.y * aVel.y + 2. * g * c, 0.))) / g;
        float tt = min(ft, th);
        vec3 p = o + aVel * tt + vec3(0., -.5 * g * tt * tt, 0.);
        float settle = clamp((ft - th) / .35, 0., 1.);   // landed grains sink into the dune instead of leaving a speckled ring
        if (ft >= th) p.y = ground(p.xz) + aRnd.x * .01 * (1. - settle);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = uSize * (.6 + aRnd.y * .8) * uScale / -mvPosition.z * (1. - settle) * (1. - smoothstep(.9, .97, uT));   // rose is clean at the stop
        vShade = .74 + aRnd.x * .22; vTone = aRnd.y;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uC1, uC2; varying float vShade, vTone;
      #include <fog_pars_fragment>
      void main(){
        vec2 c = gl_PointCoord * 2. - 1.; float d = dot(c, c); if (d > 1.) discard;
        float l = vShade * (.85 + .2 * (1. - d)) * (1. + .12 * (c.y - c.x));
        gl_FragColor = vec4(mix(uC2, uC1, vTone) * l, 1.);
        #include <fog_fragment>
      }`
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
  return pts;
}

// ---------- airborne sand: calm drift, sandstorm, or dust motes in the gallery spotlight ----------
export function createDrift(count) {
  const seed = new Float32Array(count * 3), rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) { seed.set([Math.random(), Math.random(), Math.random()], i * 3); rnd[i] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(seed, 3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const u = { uOffset: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(30, 3, 30) },
    uLow: { value: 2.5 }, uMax: { value: 6 }, uOpacity: { value: .5 }, uScale: { value: 1 }, uSize: { value: .02 }, uStretch: { value: 0 },
    uColor: { value: new THREE.Color(0xe0c08f) }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    fog: true, transparent: true, depthWrite: false,
    uniforms: { ...fogUniforms(), ...u },
    vertexShader: `
      attribute float aRnd;
      uniform vec3 uOffset, uCenter, uBox; uniform float uLow, uScale, uSize, uTime, uMax;
      varying float vA, vR;
      #include <fog_pars_vertex>
      void main(){
        vec3 q = fract(position + uOffset * (.6 + aRnd * .8) / uBox);
        vec3 p = uCenter + vec3(q.x - .5, pow(q.y, uLow), q.z - .5) * uBox;
        p.y += sin(uTime * 1.7 + position.x * 40.) * .04;
        vA = smoothstep(0., .12, q.x) * smoothstep(1., .88, q.x) * smoothstep(0., .12, q.z) * smoothstep(1., .88, q.z);
        vR = aRnd;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = uSize * (.5 + aRnd) * uScale / -mvPosition.z;
        vA *= 1. - smoothstep(uMax, uMax * 1.8, gl_PointSize);   // near-camera specks would read as out-of-focus blobs
        gl_PointSize = min(gl_PointSize, uMax * 1.8);
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity; varying float vA, vR;
      #include <fog_pars_fragment>
      void main(){
        vec2 c = gl_PointCoord * 2. - 1.; float d = dot(c, c); if (d > 1.) discard;
        gl_FragColor = vec4(uColor * (.8 + .4 * vR), pow(1. - d, 1.5) * uOpacity * vA * (.4 + .6 * vR));
        #include <fog_fragment>
      }`
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
  return pts;
}
