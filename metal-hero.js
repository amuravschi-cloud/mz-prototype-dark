// MZ · Metal Hero — интерактивная 3D-композиция металлопроката (Three.js)
//
//   import { initMetalHero } from './metal-hero.js';
//   const hero = initMetalHero(document.querySelector('#metal-3d'), {
//     card: document.querySelector('#metal-card'),      // карточка-подсказка
//     fadeBehind: document.querySelector('.hero-copy'),  // блок текста, за которым прутки растворяются
//   });
//   hero.dispose();
//
// Внешних текстур нет: металл, окалина, ржавчина и цинк считаются шумом прямо в шейдере.
// За текстом и у карточки прутки плавно уходят под градиент (CSS-маска на canvas), при прокрутке — гаснут.

import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- Каталог позиций (тексты карточек правьте здесь) ----------
export const METAL_ITEMS = [
  {
    id: 'profile', tag: 'Трубы', name: 'Труба профильная', size: '60×60×4 мм',
    specs: [['ГОСТ', '30245-2003'], ['Сталь', 'Ст3сп / 09Г2С'], ['Масса', '6,71 кг/м'], ['Длина', '6 / 12 м']],
    note: 'Каркасы, навесы, ограждения, металлоконструкции.', url: '/catalog/truba-profilnaya',
  },
  {
    id: 'round', tag: 'Трубы', name: 'Труба круглая электросварная', size: 'Ø57×3,5 мм',
    specs: [['ГОСТ', '10704-91'], ['Сталь', 'Ст3сп / 20'], ['Масса', '4,62 кг/м'], ['Длина', '6 / 12 м']],
    note: 'Трубопроводы, опоры, стойки, перила.', url: '/catalog/truba-kruglaya',
  },
  {
    id: 'channel', tag: 'Фасонный прокат', name: 'Швеллер', size: '16П',
    specs: [['ГОСТ', '8240-97'], ['Сталь', 'Ст3сп / 09Г2С'], ['Масса', '14,2 кг/м'], ['Длина', '12 м']],
    note: 'Балки перекрытий, рамы, несущие конструкции.', url: '/catalog/shveller',
  },
  {
    id: 'angle', tag: 'Фасонный прокат', name: 'Уголок равнополочный', size: '63×63×5 мм',
    specs: [['ГОСТ', '8509-93'], ['Сталь', 'Ст3сп'], ['Масса', '4,81 кг/м'], ['Длина', '6 / 12 м']],
    note: 'Обвязки, закладные, стеллажи, усиление проёмов.', url: '/catalog/ugolok',
  },
  {
    id: 'rebar', tag: 'Арматура', name: 'Арматура рифлёная', size: 'А500С Ø16 мм',
    specs: [['ГОСТ', '34028-2016'], ['Класс', 'А500С'], ['Масса', '1,578 кг/м'], ['Длина', '11,7 м']],
    note: 'Армирование фундаментов, плит и стен.', url: '/catalog/armatura',
  },
];

// ---------- Отделка поверхностей (линейные цвета) ----------
// base — цвет металла, rough — шероховатость, streak — продольные риски проката,
// scale — окалина (0..1), rust — ржавчина (0..1), spangle — «цветы» цинка, bump — рельеф
const FINISHES = {
  profile: { base: [0.2, 0.205, 0.215], rough: 0.42, streak: 0.1, scale: 0.5, rust: 0.03, spangle: 0, bump: 0.5, seed: 1.3 },
  round:   { base: [0.18, 0.185, 0.195], rough: 0.44, streak: 0.08, scale: 0.55, rust: 0.04, spangle: 0, bump: 0.5, seed: 7.1 },
  channel: { base: [0.17, 0.175, 0.185], rough: 0.48, streak: 0.07, scale: 0.6, rust: 0.07, spangle: 0, bump: 0.7, seed: 3.7 },
  angle:   { base: [0.19, 0.19, 0.2], rough: 0.46, streak: 0.07, scale: 0.55, rust: 0.1, spangle: 0, bump: 0.7, seed: 5.9 },
  rebar:   { base: [0.15, 0.145, 0.14], rough: 0.55, streak: 0.04, scale: 0.6, rust: 0.38, spangle: 0, bump: 1.1, seed: 9.2 },
};

const GLSL_NOISE = /* glsl */ `
varying vec3 vLPos;
uniform vec3 uBase;
uniform float uRough, uStreak, uScale, uRust, uSpangle, uBump, uSeed;

vec3 mzMod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mzMod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mzPermute(vec4 x){return mzMod289(((x*34.0)+1.0)*x);}
vec4 mzTaylor(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float mzNoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mzMod289(i);
  vec4 p=mzPermute(mzPermute(mzPermute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  vec3 ns=0.142857142857*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 nr=mzTaylor(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=nr.x; p1*=nr.y; p2*=nr.z; p3*=nr.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float mzFbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*mzNoise(p); p=p*2.03+17.1; a*=0.5; } return s; }
float mzHash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
vec3 mzHash3(vec3 p){ return vec3(mzHash(p), mzHash(p+19.19), mzHash(p+47.3)); }
// ячейки Вороного — кристаллы цинка на оцинковке
float mzCell(vec3 p){
  vec3 i=floor(p), f=fract(p); float md=8.0; vec3 id=i;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){
    vec3 g=vec3(float(x),float(y),float(z)); vec3 r=g+mzHash3(i+g)-f; float d=dot(r,r);
    if(d<md){ md=d; id=i+g; }
  }
  return mzHash(id);
}
vec3 mzBumpN(vec3 pos, vec3 n, float h, float k){
  vec3 sx=dFdx(pos), sy=dFdy(pos); vec3 r1=cross(sy,n), r2=cross(n,sx);
  float det=dot(sx,r1); vec2 dh=vec2(dFdx(h),dFdy(h))*k;
  vec3 grad=sign(det)*(dh.x*r1+dh.y*r2);
  return normalize(abs(det)*n-grad);
}
`;

// Тело расчёта поверхности + растворение (вставляется в начало main)
const GLSL_SURFACE = /* glsl */ `
  vec3 q = vLPos * 10.0 + uSeed * 13.0;              // ~1 ед. = 1 см
  // длинные облачные разводы вдоль проката (как на реальной чёрной трубе)
  float cloud = mzFbm(vec3(q.xy * 0.09, q.z * 0.016));
  float cloud2 = mzFbm(vec3(q.xy * 0.32, q.z * 0.05) + 7.0);
  // мягкие продольные полосы от валков
  float streak = mzNoise(vec3(q.xy * 2.2, q.z * 0.05)) * 0.6 + mzNoise(vec3(q.xy * 7.0, q.z * 0.12)) * 0.4;
  float micro = mzNoise(q * 3.0);

  vec3 mzCol = uBase * (0.78 + 0.5 * cloud + 0.16 * cloud2) * (1.0 + uStreak * streak);
  float mzRough = uRough + 0.08 * cloud2 + 0.03 * micro;
  float mzMetal = 0.9;
  float mzH = streak * uStreak * 0.4 + micro * 0.02;

  // оксидная плёнка: светлые пыльные матовые разводы
  if (uScale > 0.0) {
    float ox = smoothstep(0.0, 0.4, cloud * 0.8 + cloud2 * 0.55 + (uScale - 0.5) * 0.6);
    vec3 oxCol = vec3(0.3, 0.305, 0.31) * (0.88 + 0.22 * cloud2);
    mzCol = mix(mzCol, oxCol, ox * 0.5);
    mzRough = mix(mzRough, 0.7, ox * 0.6);
    mzMetal = mix(mzMetal, 0.6, ox * 0.6);
    mzH += ox * 0.08;
  }

  // редкие светлые царапины и потёртости вдоль длины
  float scr = smoothstep(0.55, 0.78, mzNoise(vec3(q.xy * 4.0, q.z * 0.035) + 3.0)) * smoothstep(0.25, 0.6, mzNoise(q * 0.3 + 9.0));
  mzCol = mix(mzCol, vec3(0.42, 0.43, 0.44), scr * 0.35);
  mzRough -= scr * 0.12;

  // цинк: крупные кристаллы, низкий контраст
  if (uSpangle > 0.0) {
    float c = mzCell(q * 0.45 + vec3(0.0, 0.0, cloud * 0.6));
    mzCol *= 0.93 + 0.1 * c;
    mzRough += (c - 0.5) * 0.12;
    mzH += c * 0.06;
  }

  // ржавчина: искажённые пятна + точечные очаги
  if (uRust > 0.0) {
    vec3 w = vec3(mzFbm(q * 0.12), mzFbm(q * 0.12 + 9.0), mzFbm(q * 0.12 + 21.0));
    float rn = 0.5 + 0.5 * mzFbm(q * vec3(0.32, 0.32, 0.16) + w * 2.2);
    float rustMask = smoothstep(0.98 - uRust * 0.62, 1.08 - uRust * 0.62, rn);
    float pits = smoothstep(0.62, 0.8, mzNoise(q * 2.4 + 4.0)) * smoothstep(0.0, 0.3, uRust);
    rustMask = clamp(max(rustMask, pits * 0.8), 0.0, 1.0);
    float rv = 0.5 + 0.5 * mzNoise(q * 1.6 + 2.0);
    vec3 rustCol = mix(vec3(0.085, 0.032, 0.012), vec3(0.32, 0.12, 0.035), rv);
    rustCol = mix(rustCol, vec3(0.42, 0.2, 0.06), smoothstep(0.75, 1.0, rn) * 0.6);
    mzCol = mix(mzCol, rustCol, rustMask);
    mzRough = mix(mzRough, 0.88, rustMask);
    mzMetal = mix(mzMetal, 0.12, rustMask);
    mzH += rustMask * (0.35 + 0.4 * mzNoise(q * 4.5));
  }
  mzRough = clamp(mzRough, 0.08, 1.0);

`;

function makeMaterial(fin, shared) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 1, roughness: 0.4, envMapIntensity: 1.0,
    clearcoat: fin.clearcoat || 0, clearcoatRoughness: 0.35,
  });
  const uniforms = {
    uBase: { value: new THREE.Vector3(...fin.base) },
    uRough: { value: fin.rough }, uStreak: { value: fin.streak }, uScale: { value: fin.scale },
    uRust: { value: fin.rust }, uSpangle: { value: fin.spangle }, uBump: { value: fin.bump },
    uSeed: { value: fin.seed },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_NOISE)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + GLSL_SURFACE)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mzCol;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mzRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mzMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = mzBumpN(-vViewPosition, normal, mzH, uBump * 0.012);');
  };
  mat.customProgramCacheKey = () => 'mz-metal';
  mat.userData.uniforms = uniforms;
  return mat;
}

// ---------- Окружение «цех/склад»: тёмное помещение, мягкий свет сверху, полоса сбоку ----------
function makeWarehouseEnv() {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(20, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vD; void main(){ float t = smoothstep(-0.4, 0.7, vD.y); gl_FragColor = vec4(mix(vec3(0.02,0.021,0.024), vec3(0.16,0.165,0.17), t), 1.0); }',
    })
  );
  env.add(room);
  const panel = (w, h, color, k, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...look); env.add(m);
  };
  panel(14, 9, 0xfff6ec, 2.6, [0, 9, 1], [0, 0, 0]);        // большой софтбокс сверху
  panel(2.2, 12, 0xdfe8ff, 1.6, [-9, 3, -2], [0, 0, 0]);    // холодная полоса слева-сзади
  panel(1.4, 10, 0xffffff, 1.2, [8, 2, 5], [0, 0, 0]);      // узкий блик справа-спереди
  panel(16, 6, 0xf4f6f8, 0.8, [0, 1.5, 12], [0, 0, 0]);    // мягкая заливка спереди
  return env;
}

// ---------- Геометрия профилей (поперечник в XY, длина вдоль Z) ----------
const LEN = 7.5;

function roundedRectPath(p, x, y, w, h, r) {
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  p.lineTo(x + w, y + h - r);
  p.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  p.lineTo(x + r, y + h);
  p.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(x, y + r);
  p.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return p;
}

const EXTRUDE = { depth: LEN, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 2, curveSegments: 32, steps: 1 };

function extrude(shape, len = LEN) {
  let geo = new THREE.ExtrudeGeometry(shape, { ...EXTRUDE, depth: len });
  geo.center();
  return toCreasedNormals(geo, THREE.MathUtils.degToRad(35));
}

function geoProfileTube(len = LEN) {
  const a = 0.6, t = 0.04;
  const s = roundedRectPath(new THREE.Shape(), -a / 2, -a / 2, a, a, 0.07);
  s.holes.push(roundedRectPath(new THREE.Path(), -a / 2 + t, -a / 2 + t, a - 2 * t, a - 2 * t, 0.035));
  return extrude(s, len);
}

function geoRoundPipe(len = LEN) {
  const R = 0.285, t = 0.035;
  const s = new THREE.Shape(); s.absarc(0, 0, R, 0, Math.PI * 2, false);
  const h = new THREE.Path(); h.absarc(0, 0, R - t, 0, Math.PI * 2, true);
  s.holes.push(h);
  return extrude(s, len);
}

function geoChannel(len = LEN) {
  // 16П: h=160, b=64, s=5, t=8.4
  const k = 0.0042, h = 160 * k, b = 64 * k, tw = 6 * k, tf = 9 * k, rr = 8 * k;
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(b, 0); s.lineTo(b, tf); s.lineTo(tw + rr, tf);
  s.quadraticCurveTo(tw, tf, tw, tf + rr);
  s.lineTo(tw, h - tf - rr);
  s.quadraticCurveTo(tw, h - tf, tw + rr, h - tf);
  s.lineTo(b, h - tf); s.lineTo(b, h); s.lineTo(0, h); s.lineTo(0, 0);
  return extrude(s, len);
}

function geoAngle(len = LEN) {
  const a = 0.52, t = 0.055, rr = 0.05;
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(a, 0); s.lineTo(a, t); s.lineTo(t + rr, t);
  s.quadraticCurveTo(t, t, t, t + rr);
  s.lineTo(t, a); s.lineTo(0, a); s.lineTo(0, 0);
  return extrude(s, len);
}

function geoRebar(LEN_ = LEN) {
  const LEN = LEN_, r = 0.11, parts = [];
  const core = new THREE.CylinderGeometry(r, r, LEN, 40, 1, false);
  core.rotateX(Math.PI / 2);
  parts.push(core);
  for (const side of [-1, 1]) {           // продольные рёбра
    const rib = new THREE.BoxGeometry(0.03, 0.035, LEN);
    rib.translate(side * (r + 0.005), 0, 0);
    parts.push(rib);
  }
  const pitch = 0.11;                      // серповидные поперечные рёбра
  const n = Math.floor(LEN / pitch);
  for (let i = 0; i < n; i++) {
    for (const side of [0, 1]) {
      const z = -LEN / 2 + pitch / 2 + i * pitch + (side ? pitch / 2 : 0);
      if (z > LEN / 2 - 0.03) continue;
      const arc = new THREE.TorusGeometry(r, 0.018, 6, 18, Math.PI * 0.82);
      arc.rotateZ(side === 0 ? Math.PI * 0.09 : Math.PI * 1.09);
      arc.rotateX(side === 0 ? 0.32 : -0.32);
      arc.translate(0, 0, z);
      parts.push(arc);
    }
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}


// --- дополнительные профили для картинок каталога ---
function iBeamShape(h, b, tw, tf, r) {
  const s = new THREE.Shape(), H = h / 2, B = b / 2, T = tw / 2;
  s.moveTo(-B, -H); s.lineTo(B, -H); s.lineTo(B, -H + tf); s.lineTo(T + r, -H + tf);
  s.quadraticCurveTo(T, -H + tf, T, -H + tf + r); s.lineTo(T, H - tf - r);
  s.quadraticCurveTo(T, H - tf, T + r, H - tf); s.lineTo(B, H - tf); s.lineTo(B, H);
  s.lineTo(-B, H); s.lineTo(-B, H - tf); s.lineTo(-T - r, H - tf);
  s.quadraticCurveTo(-T, H - tf, -T, H - tf - r); s.lineTo(-T, -H + tf + r);
  s.quadraticCurveTo(-T, -H + tf, -T - r, -H + tf); s.lineTo(-B, -H + tf); s.lineTo(-B, -H);
  return s;
}
const geoBeam = (len = LEN) => extrude(iBeamShape(0.62, 0.32, 0.04, 0.055, 0.05), len);
const geoEuroBeam = (len = LEN) => extrude(iBeamShape(0.52, 0.52, 0.045, 0.07, 0.06), len);
function geoRoundBar(len = LEN) { const g = new THREE.CylinderGeometry(0.16, 0.16, len, 48); g.rotateX(Math.PI / 2); return g; }
const geoSquare = (len = LEN) => extrude(roundedRectPath(new THREE.Shape(), -0.16, -0.16, 0.32, 0.32, 0.018), len);
const geoStrip = (len = LEN) => extrude(roundedRectPath(new THREE.Shape(), -0.32, -0.045, 0.64, 0.09, 0.012), len);
function geoSheets(len = LEN) {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.BoxGeometry(1.5, 0.035, len);
    g.translate((i % 2 ? 0.03 : -0.02) + i * 0.012, i * 0.05, (i % 3) * 0.02);
    parts.push(g.toNonIndexed());
  }
  const m = mergeGeometries(parts); m.center(); return m;
}
function geoCoil() {
  const s = new THREE.Shape(); s.absarc(0, 0, 0.8, 0, Math.PI * 2, false);
  const h = new THREE.Path(); h.absarc(0, 0, 0.34, 0, Math.PI * 2, true); s.holes.push(h);
  return extrude(s, 0.95);
}
function geoWireCoil(R, tube, turns, pitch) {
  const parts = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i < turns; i++) {
    const t = new THREE.TorusGeometry(R + rnd() * 0.05, tube, 8, 120);
    t.rotateX(rnd() * 0.08); t.rotateY(rnd() * 0.08);
    t.translate(rnd() * 0.04, rnd() * 0.04, i * pitch);
    parts.push(t.toNonIndexed());
  }
  const m = mergeGeometries(parts); m.center(); return m;
}
const geoWireRod = () => geoWireCoil(0.72, 0.034, 12, 0.07);
const geoWire = () => geoWireCoil(0.6, 0.016, 22, 0.034);

const BUILDERS = { profile: geoProfileTube, round: geoRoundPipe, channel: geoChannel, angle: geoAngle, rebar: geoRebar };

// Композиция: каждый пруток лежит в своей вертикальной плоскости (свой слой по глубине)
// и наклонён в ней на свой угол — спереди получается перекрёстная «штриховка».
// Слои разнесены на радиус описанной окружности сечения + зазор, поэтому изделия
// не пересекаются ни при покачивании, ни при вращении вокруг своей оси.
// order — порядок слоёв от дальнего к ближнему; tilt — наклон в плоскости экрана; y — высота центра.
const LAYOUT = {
  channel: { order: 0, tilt: 0.16, y: 0.3, roll: -Math.PI / 2, spin: 0.12 },
  profile: { order: 1, tilt: -0.1, y: 1.05, roll: 0.3, spin: 0.15 },
  round: { order: 2, tilt: -0.04, y: -0.25, roll: 0, spin: -0.1 },
  angle: { order: 3, tilt: -0.2, y: -0.75, roll: -Math.PI * 0.75, spin: -0.14 },
  rebar: { order: 4, tilt: 0.14, y: -1.2, roll: 0, spin: 0.2 },
};
const GAP = 0.14;

// ---------- Инициализация ----------
export function initMetalHero(container, options = {}) {
  const items = options.items || METAL_ITEMS;
  const card = options.card || null;
  const fadeEl = options.fadeBehind || null;
  const rightReserve = options.rightReserve ?? 360; // px справа под карточку
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover)');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'pan-y';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = makeWarehouseEnv();
  const envRT = pmrem.fromScene(envScene, 0.035);
  scene.environment = envRT.texture;

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  const CAM_DIST = 11.5;
  camera.position.set(0, 2.8, CAM_DIST);
  camera.lookAt(0, 0, 0);

  const key = new THREE.DirectionalLight(0xfff4e8, 1.6);
  key.position.set(4, 6, 6);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 0.9);
  rim.position.set(-6, 2, -5);
  scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.12));

  const shared = {};

  const root = new THREE.Group();   // вращение пользователем / авто
  const tilt = new THREE.Group();   // параллакс от мыши
  tilt.add(root);
  scene.add(tilt);

  // строим и раскладываем по слоям глубины без пересечений
  const meshes = [];
  const built = items.filter((it) => BUILDERS[it.id]).map((item, i) => {
    const mesh = new THREE.Mesh(BUILDERS[item.id](), makeMaterial(FINISHES[item.id], shared));
    const L = LAYOUT[item.id] || { order: i, tilt: 0, y: 0, roll: 0, spin: 0.1 };
    mesh.rotation.z = L.roll;
    const along = new THREE.Group();      // длина изделия — вдоль оси X
    along.rotation.y = Math.PI / 2;
    along.add(mesh);
    const holder = new THREE.Group();     // слой: позиция по глубине и наклон в плоскости
    holder.rotation.z = L.tilt;
    holder.add(along);
    const pos = mesh.geometry.attributes.position;
    let r = 0;
    for (let k = 0; k < pos.count; k++) r = Math.max(r, Math.hypot(pos.getX(k), pos.getY(k)));
    return { item, mesh, holder, r: r * 1.05, L, i };
  }).sort((p, q) => p.L.order - q.L.order);
  const depth = built.reduce((s, b) => s + b.r * 2, 0) + GAP * (built.length - 1);
  let cursor = -depth / 2;
  for (const b of built) {
    b.holder.position.set(0, b.L.y, cursor + b.r);
    cursor += b.r * 2 + GAP;
    root.add(b.holder);
    b.mesh.userData = { item: b.item, holder: b.holder, phase: b.i * 1.3, baseY: b.L.y, hover: 0, spin: b.L.spin };
    meshes.push(b.mesh);
  }

  // ---------- Взаимодействие ----------
  const pointer = new THREE.Vector2(-10, -10);
  const ray = new THREE.Raycaster();
  let hovered = null;
  let dragging = false, lastX = 0, lastY = 0, velY = 0, velX = 0;
  let rotY = 0, rotX = 0, swayT = 0;
  let lastInteract = -1e9;
  let px = 0, py = 0;
  let downX = 0, downY = 0;
  let scrollP = 0;
  let fadeCss = { a: -2, b: -1, c: 1e6, d: 1e6 + 1 }; // те же зоны в CSS-пикселях — для наведения

  const el = renderer.domElement;
  const toNDC = (e) => {
    const r = el.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    px = pointer.x; py = pointer.y;
  };

  const onDown = (e) => {
    dragging = true; lastX = downX = e.clientX; lastY = downY = e.clientY;
    velX = velY = 0; lastInteract = performance.now();
    if (e.pointerType === 'mouse') el.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    toNDC(e);
    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      velY = dx * 0.005; velX = dy * 0.003;
      rotY += velY; rotX = THREE.MathUtils.clamp(rotX + velX, -0.45, 0.45);
      lastInteract = performance.now();
    }
  };
  const onUp = (e) => {
    dragging = false;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) < 8) { toNDC(e); pick(e.pointerType !== 'mouse'); }
  };
  // на тач-экранах карточка остаётся после тапа (pointerleave приходит сразу после касания)
  let overCard = false;
  const onLeave = (e) => {
    if (card && e.relatedTarget && card.contains(e.relatedTarget)) { overCard = true; return; } // ушли на карточку — держим её
    pointer.set(-10, -10); px = py = 0; if (!dragging && canHover.matches) setHover(null);
  };
  const onCardLeave = (e) => {
    overCard = false;
    if (e.relatedTarget === el) return;
    pointer.set(-10, -10); px = py = 0; if (canHover.matches) setHover(null);
  };
  card?.addEventListener('pointerleave', onCardLeave);

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerleave', onLeave);

  const _v = new THREE.Vector3();
  function isDissolvedAt(point) {
    if (scrollP > 0.35) return true;
    _v.copy(point).project(camera);
    const x = (_v.x * 0.5 + 0.5) * el.clientWidth;
    return x < fadeCss.a + (fadeCss.b - fadeCss.a) * 0.6 || x > (fadeCss.c + fadeCss.d) / 2;
  }

  function pick(fromTap = false) {
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(meshes, false).find((h) => !isDissolvedAt(h.point));
    const m = hit ? hit.object : null;
    if (fromTap && m === hovered) { setHover(null); return; }
    setHover(m);
  }

  function setHover(m) {
    if (m === hovered) return;
    hovered = m;
    el.style.cursor = m ? 'pointer' : 'grab';
    if (card) (options.renderCard || renderCard)(card, m ? m.userData.item : null);
    options.onHover?.(m ? m.userData.item : null);
  }

  // ---------- Размер, зоны растворения, прокрутка ----------
  let visible = true;
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; }, { threshold: 0 });
  io.observe(container);

  const updateFade = () => {
    const cr = el.getBoundingClientRect();
    const w = cr.width;
    const wide = w >= 900;
    let a = -2, b = -1, c = 1e6, d = 1e6 + 1;
    if (fadeEl && wide) {
      const tr = fadeEl.getBoundingClientRect();
      const overlap = tr.right > cr.left && tr.bottom > cr.top && tr.top < cr.bottom;
      if (overlap) {
        a = tr.left + tr.width * 0.3 - cr.left;    // здесь прутки уже полностью скрыты
        b = tr.right + 160 - cr.left;             // отсюда начинают уходить под градиент
      }
    }
    if (wide && card) { c = w - rightReserve; d = w - rightReserve * 0.45; }
    fadeCss = { a, b, c, d };
    // плавное исчезновение под градиентом: маска на canvas (работает на любом фоне)
    const stops = [];
    if (a > -1) stops.push(`transparent ${Math.max(a, 0)}px`, `#000 ${b}px`); else stops.push('#000 0px');
    if (c < 1e5) stops.push(`#000 ${c}px`, `transparent ${d}px`); else stops.push('#000 100%');
    let mask = `linear-gradient(90deg, ${stops.join(', ')})`;
    if (!wide) mask = 'linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent), linear-gradient(180deg, transparent, #000 28%, #000 88%, transparent)';
    el.style.maskImage = mask; el.style.webkitMaskImage = mask;
    el.style.maskComposite = wide ? 'add' : 'intersect';
    el.style.webkitMaskComposite = wide ? 'source-over' : 'source-in';
  };

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    el.style.width = w + 'px'; el.style.height = h + 'px';
    camera.aspect = w / h;
    const narrow = w / h < 1;
    camera.position.z = narrow ? CAM_DIST / Math.max(w / h, 0.5) * 0.95 : CAM_DIST;
    camera.position.y = narrow ? 2.2 : 2.8;
    camera.lookAt(0, 0, 0);
    // на широком экране сдвигаем композицию вправо, в свободную от текста зону
    const shift = w >= 900 ? (options.shiftX ?? 0.13) : 0;
    camera.setViewOffset(w, h, -w * shift, 0, w, h);
    camera.updateProjectionMatrix();
    updateFade();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  el.style.cursor = 'grab';

  const onScroll = () => {
    const r = container.getBoundingClientRect();
    scrollP = THREE.MathUtils.clamp(-r.top / (r.height * 0.75), 0, 1);
    // при прокрутке композиция плавно гаснет
    el.style.opacity = String(1 - THREE.MathUtils.smoothstep(scrollP, 0.05, 0.8));
    if (scrollP > 0.35 && hovered) setHover(null);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- Цикл ----------
  const clock = new THREE.Clock();
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!visible) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const idle = performance.now() - lastInteract > 1800 && !hovered && !dragging;

    if (!dragging) {
      rotY += velY; rotX = THREE.MathUtils.clamp(rotX + velX, -0.45, 0.45);
      velY *= 0.93; velX *= 0.9;
      if (idle) {
        // мягкое покачивание вместо полного оборота — прутки не «смотрят» в камеру
        rotY = Math.atan2(Math.sin(rotY), Math.cos(rotY));
        swayT += dt * (reduced ? 0.3 : 1);
        const target = Math.sin(swayT * 0.22) * 0.7;
        rotY += (target - rotY) * Math.min(dt * 0.6, 1);
        rotX += (0 - rotX) * dt * 0.8;
      }
      if (pointer.x > -2 && canHover.matches && !overCard) pick();
    }

    root.rotation.y = rotY + scrollP * 0.9;
    root.rotation.x = rotX;
    tilt.position.y = scrollP * 0.8;
    tilt.rotation.y += (px * 0.2 - tilt.rotation.y) * dt * 3;
    tilt.rotation.x += (-py * 0.1 - tilt.rotation.x) * dt * 3;

    for (const m of meshes) {
      const u = m.userData;
      u.hover += ((m === hovered ? 1 : 0) - u.hover) * Math.min(dt * 8, 1);
      u.holder.position.y = u.baseY + (reduced ? 0 : Math.sin(t * 0.9 + u.phase) * 0.03);
      const s = 1 + u.hover * 0.05;
      m.scale.set(s, s, 1);
      if (!reduced) m.rotation.z += dt * u.spin * (1 - u.hover * 0.8);
      m.material.envMapIntensity = hovered ? (m === hovered ? 1.4 : 0.55) : 1.0;
    }

    renderer.render(scene, camera);
  };
  loop();

  return {
    renderer, scene, camera,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      window.removeEventListener('scroll', onScroll);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      card?.removeEventListener('pointerleave', onCardLeave);
      meshes.forEach((m) => { m.geometry.dispose(); m.material.dispose(); });
      envRT.dispose(); pmrem.dispose(); renderer.dispose();
      el.remove();
    },
  };
}

// ---------- Карточка ----------
function renderCard(card, item) {
  if (!item) { card.classList.remove('is-visible'); return; }
  card.innerHTML = `
    <div class="mc-tag">${item.tag}</div>
    <div class="mc-name">${item.name}</div>
    <div class="mc-size">${item.size}</div>
    <dl class="mc-specs">${item.specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <p class="mc-note">${item.note}</p>
    <a class="mc-link" href="${item.url}">Смотреть в каталоге →</a>`;
  card.classList.add('is-visible');
}


// ---------- Картинки номенклатуры: тот же металл, тот же свет ----------
// id — ключи каталога сайта (products[].id). Возвращает { id: dataURL } с прозрачным фоном.
const THUMB = {
  armatura:    { geo: () => geoRebar(2.6), fin: 'rebar' },
  pipes_prof:  { geo: () => geoProfileTube(2.4), fin: 'profile' },
  pipes_round: { geo: () => geoRoundPipe(2.4), fin: 'round' },
  sheets:      { geo: () => geoSheets(2.2), fin: 'channel', view: 'flat' },
  sheets_coil: { geo: geoCoil, fin: 'galv', view: 'coil' },
  beams:       { geo: () => geoBeam(2.4), fin: 'channel' },
  channels:    { geo: () => geoChannel(2.4), fin: 'channel' },
  round_bar:   { geo: () => geoRoundBar(2.6), fin: 'angle' },
  euro_beam:   { geo: () => geoEuroBeam(2.2), fin: 'channel' },
  angles:      { geo: () => geoAngle(2.4), fin: 'angle' },
  square:      { geo: () => geoSquare(2.6), fin: 'profile' },
  strip:       { geo: () => geoStrip(2.4), fin: 'angle', view: 'flat' },
  wire_rod:    { geo: geoWireRod, fin: 'rebar', view: 'coil' },
  wire:        { geo: geoWire, fin: 'profile', view: 'coil' },
};
FINISHES.galv = { base: [0.5, 0.51, 0.52], rough: 0.34, streak: 0.05, scale: 0.25, rust: 0, spangle: 1, bump: 0.3, seed: 4.4 };

export async function renderProductThumbs(ids, { width = 520, height = 390 } = {}) {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(makeWarehouseEnv(), 0.035);
  const scene = new THREE.Scene();
  scene.environment = envRT.texture;
  const key = new THREE.DirectionalLight(0xfff4e8, 1.8); key.position.set(3, 6, 5);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 0.8); rim.position.set(-5, 2, -4);
  scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.12));
  const camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 100);
  const out = {};
  for (const id of ids) {
    const t = THUMB[id]; if (!t) continue;
    const mesh = new THREE.Mesh(t.geo(), makeMaterial(FINISHES[t.fin], {}));
    const g = new THREE.Group(); g.add(mesh);
    if (t.view === 'coil') { g.rotation.set(-0.35, 0.75, 0); }
    else if (t.view === 'flat') { g.rotation.set(0.0, 0.62, 0); }
    else { g.rotation.set(0.0, 0.7, 0); }
    scene.add(g);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    const sph = box.getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(0, 0.42, 1).normalize();
    const dist = sph.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.66;
    camera.position.copy(sph.center).addScaledVector(dir, dist);
    camera.lookAt(sph.center);
    renderer.render(scene, camera);
    out[id] = canvas.toDataURL('image/webp', 0.9);
    scene.remove(g); mesh.geometry.dispose(); mesh.material.dispose();
    await new Promise((r) => setTimeout(r, 0));
  }
  envRT.dispose(); pmrem.dispose(); renderer.dispose(); renderer.forceContextLoss?.();
  return out;
}
