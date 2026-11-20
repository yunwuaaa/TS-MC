/* ========================================================
   老宅 · 三层（PHP 版 · 地图重做版）
   ======================================================== */

const errEl = document.getElementById('err');
function showErr(msg) {
  errEl.style.display = 'block';
  errEl.textContent = '⚠ ' + msg;
  console.error(msg);
}
window.addEventListener('error', e => showErr(e.message || '未知错误'));
window.addEventListener('unhandledrejection',
  e => showErr((e.reason && e.reason.message) || String(e.reason)));

/* ---------- 加载 Three.js ---------- */
const startBtnEl = document.getElementById('startBtn');
async function loadThree() {
  const urls = [
    'https://unpkg.com/three@0.160.0/build/three.module.js',
    'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
    'https://fastly.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
    'https://esm.sh/three@0.160.0'
  ];
  let last;
  for (let i = 0; i < urls.length; i++) {
    startBtnEl.textContent = `正在加载引擎 (${i+1}/${urls.length})…`;
    try { return await import(urls[i]); }
    catch (e) { console.warn('CDN 失败', urls[i], e); last = e; }
  }
  throw last;
}
let THREE;
try {
  THREE = await loadThree();
  startBtnEl.textContent = '点击开始';
} catch (e) {
  startBtnEl.textContent = '引擎加载失败：请检查网络后刷新页面';
  startBtnEl.style.color = '#ff6666';
  startBtnEl.style.fontSize = '14px';
  startBtnEl.style.animation = 'none';
  throw e;
}

const SECRET_CODE = String(window.GAME_CONFIG?.code || '000');

/* ---------- 常量 ---------- */
const TILE      = 2.8;
const WALL_H    = 3.0;
const PLAYER_R  = 0.45;
const PLAYER_EYE= 1.65;
const CROUCH_EYE= 0.95;
const MW = 19, MH = 15;

/* ---------- ASCII 地图 ----------
   # 墙  . 地板  D 大门
   S 上楼  s 下楼  A 上阁楼  a 下阁楼
   B 矮柜  W 衣柜  T 桌子
---------------------------------- */
const CHAR_TYPE = { '#':1, '.':0, 'D':4, 'S':5, 's':6, 'A':7, 'a':8,
                    'B':9, 'W':10, 'T':11 };
const SOLID_TYPE = new Set([1, 4, 9, 10, 11]);

const FLOOR_MAPS = [
  // 一层：6 个房间 + 中央横向走廊，楼梯在右下角
  [
    '###################',
    '#B....#..T..#..W..#',
    '#.....#.....#.....#',
    '#.....#.....#.....#',
    '#..B..#.....#.....#',
    '#.....#.....#.....#',
    '#.....#.....#.....#',
    '#.................#',
    '#.................#',
    '#.................#',
    '#.....#.....#.....#',
    '#..W..#.....#..B..#',
    '#.....#.....#.....#',
    '#.....#.....#..S..#',
    '#########D#########'
  ],
  // 二层：与一层相同的房间骨架，卧室 + 阁楼口
  [
    '###################',
    '#T....#..T..#.....#',
    '#.....#.....#.....#',
    '#.....#.....#..W..#',
    '#.....#.....#.....#',
    '#.....#.....#.....#',
    '#.....#.....#.....#',
    '#........A........#',
    '#.................#',
    '#.................#',
    '#.....#.....#.....#',
    '#..W..#.....#..B..#',
    '#.....#.....#.....#',
    '#.....#.....#..s..#',
    '###################'
  ],
  // 阁楼：狭小储物空间，木箱在中央偏南
  [
    '###################',
    '###################',
    '###################',
    '###################',
    '###################',
    '#####..........####',
    '#####..W.......####',
    '#####....a.....####',
    '#####..........####',
    '#####..........####',
    '#####..........####',
    '#####..........####',
    '###################',
    '###################',
    '###################'
  ]
];

const MAPS = FLOOR_MAPS.map(rows =>
  rows.map(row =>
    [...row].map(ch => CHAR_TYPE[ch] ?? 0)
  )
);
const FLOOR_NAMES = ['一层', '二层', '阁楼'];

function cellType(fi, gx, gz) {
  if (gx < 0 || gz < 0 || gx >= MW || gz >= MH) return 1;
  return MAPS[fi][gz][gx];
}
function solidAt(fi, gx, gz) { return SOLID_TYPE.has(cellType(fi, gx, gz)); }

function canMove(fi, x, z, r) {
  const x0 = Math.floor((x-r)/TILE), x1 = Math.floor((x+r)/TILE);
  const z0 = Math.floor((z-r)/TILE), z1 = Math.floor((z+r)/TILE);
  for (let gz = z0; gz <= z1; gz++)
    for (let gx = x0; gx <= x1; gx++)
      if (solidAt(fi, gx, gz)) return false;
  return true;
}
function hasLOS(fi, x1, z1, x2, z2) {
  const steps = 22;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const z = z1 + (z2 - z1) * t;
    if (solidAt(fi, Math.floor(x/TILE), Math.floor(z/TILE))) return false;
  }
  return true;
}
const gw = (gx, gz) => ({ x: gx*TILE + TILE/2, z: gz*TILE + TILE/2 });

/* ---------- 音频 ---------- */
let actx = null;
function initAudio() {
  if (!actx) { try { actx = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){ return; } }
  if (actx.state === 'suspended') actx.resume();
}
function noiseBurst(dur, freq, vol, q = 1) {
  if (!actx) return;
  const len = Math.floor(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/len, 2);
  const src = actx.createBufferSource(); src.buffer = buf;
  const f = actx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = actx.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(actx.destination);
  src.start();
}
function tone(freq, dur, type = 'sine', vol = .1, slide = null) {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, actx.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, actx.currentTime + dur);
  g.gain.setValueAtTime(vol, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + dur);
  o.connect(g).connect(actx.destination);
  o.start(); o.stop(actx.currentTime + dur + .03);
}
const sfxStep   = () => noiseBurst(.07, 280, .05);
const sfxPickup = () => { tone(660,.1,'triangle',.08); tone(990,.16,'triangle',.05); };
const sfxCaught = () => { tone(90,.8,'sawtooth',.2,40); noiseBurst(.5,900,.16,1.4); };
const sfxUnlock = () => { tone(440,.08,'square',.08); tone(660,.14,'square',.06); };
const sfxHeart  = () => { tone(58,.14,'sine',.13); setTimeout(() => tone(48,.2,'sine',.1),160); };
const sfxStairs = () => { noiseBurst(.12,200,.08); setTimeout(() => noiseBurst(.1,160,.06),140); };
const sfxWin    = () => { tone(392,.3,'sine',.1); setTimeout(()=>tone(523,.3,'sine',.1),200); setTimeout(()=>tone(659,.6,'sine',.1),400); };
const sfxSwing  = () => noiseBurst(.14, 520, .09, .8);
const sfxHit    = () => { tone(150,.12,'square',.14,70); noiseBurst(.22,340,.13,1.1); };
const sfxStun   = () => { tone(220,.5,'sawtooth',.10,60); noiseBurst(.6,180,.10,.7); };
const sfxEquip  = () => { tone(520,.06,'square',.07); tone(780,.10,'square',.05); };

/* ---------- 渲染器 / 场景 / 相机 ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.042);

const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.08, 80);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.AmbientLight(0x405060, 1.1));
scene.add(new THREE.HemisphereLight(0x506080, 0x181818, 0.55));

const flashlight = new THREE.SpotLight(0xffe8c0, 220, 40, Math.PI/5, 0.5, 1.4);
flashlight.position.set(0.28, -0.15, 0);
flashlight.target.position.set(0, -0.2, -1);
camera.add(flashlight);
camera.add(flashlight.target);
const fill = new THREE.PointLight(0x8090a0, 3, 8, 2);
camera.add(fill);


/* ---------- 性能：共享几何体 / 材质缓存 ---------- */
const GEO_CACHE = new Map();
function boxGeo(w, h, d) {
  const k = `b${w},${h},${d}`;
  let g = GEO_CACHE.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); GEO_CACHE.set(k, g); }
  return g;
}
const MAT_CACHE = new Map();
function stdMat(color, opts = {}) {
  const k = color + '|' + JSON.stringify(opts);
  let m = MAT_CACHE.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, ...opts }); MAT_CACHE.set(k, m); }
  return m;
}
function makeBox(w, h, d, color, opts) {
  return new THREE.Mesh(boxGeo(w, h, d), stdMat(color, opts));
}

/* ---------- 楼层渲染 ---------- */
const levelGroups = [];

function buildLevel(fi) {
  const g = new THREE.Group();
  const map = MAPS[fi];

  const floorColor = [0x3a2a1e, 0x332a22, 0x241a12][fi];
  const floorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(MW*TILE, MH*TILE),
    stdMat(floorColor, { roughness: 1 })
  );
  floorMesh.rotation.x = -Math.PI/2;
  floorMesh.position.set(MW*TILE/2, 0, MH*TILE/2);
  g.add(floorMesh);

  const ceilMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(MW*TILE, MH*TILE),
    stdMat(0x121014, { roughness: 1 })
  );
  ceilMesh.rotation.x = Math.PI/2;
  ceilMesh.position.set(MW*TILE/2, WALL_H, MH*TILE/2);
  g.add(ceilMesh);

  // 墙
  const walls = [];
  for (let z = 0; z < MH; z++)
    for (let x = 0; x < MW; x++)
      if (map[z][x] === 1) walls.push(gw(x, z));

  if (walls.length) {
    const im = new THREE.InstancedMesh(boxGeo(TILE, WALL_H, TILE), stdMat(0x4a3a2a, { roughness: .95 }), walls.length);
    im.castShadow = false; im.receiveShadow = false;
    const d = new THREE.Object3D();
    walls.forEach((w, i) => {
      d.position.set(w.x, WALL_H/2, w.z);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  }

  // 家具 / 楼梯 / 门
  for (let z = 0; z < MH; z++) {
    for (let x = 0; x < MW; x++) {
      const v = map[z][x];
      if (v <= 1) continue;
      const w = gw(x, z);

      if (v === 9) {   // 矮柜
        const m = makeBox(TILE*0.85, 1.0, TILE*0.85, 0x5a4030, { roughness: .9 });
        m.position.set(w.x, 0.5, w.z); g.add(m);
      } else if (v === 10) {  // 衣柜
        const m = makeBox(TILE*0.8, 2.2, TILE*0.8, 0x3a2818, { roughness: .9 });
        m.position.set(w.x, 1.1, w.z); g.add(m);
      } else if (v === 11) {  // 桌子
        const top = makeBox(TILE*0.9, 0.1, TILE*0.7, 0x6a4a2a, { roughness: .85 });
        top.position.set(w.x, 0.9, w.z); g.add(top);
        for (const [dx, dz] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
          const leg = makeBox(0.08, 0.85, 0.08, 0x3a2818, { roughness: .9 });
          leg.position.set(w.x + dx*TILE*0.35, 0.45, w.z + dz*TILE*0.28);
          g.add(leg);
        }
      } else if (v >= 5 && v <= 8) {  // 楼梯
        for (let s = 0; s < 6; s++) {
          const step = makeBox(TILE*0.88, 0.13, TILE*0.16, 0x6a5038, { roughness: .9 });
          step.position.set(w.x, 0.065 + s*0.11, w.z + TILE*0.38 - s*TILE*0.13);
          g.add(step);
        }
      } else if (v === 4) {  // 大门
        const door = makeBox(TILE*0.92, 2.6, 0.28, 0x6a4520, { roughness: .85 });
        door.position.set(w.x, 1.3, w.z); g.add(door);
        const knob = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 10, 10),
          stdMat(0xd0a860, { metalness: .9, roughness: .3 })
        );
        knob.position.set(w.x + 0.9, 1.2, w.z - 0.18); g.add(knob);
      }
    }
  }

  return g;
}

FLOOR_MAPS.forEach((_, i) => {
  const g = buildLevel(i);
  g.visible = (i === 0);
  scene.add(g);
  levelGroups.push(g);
});

/* ---------- 道具 ---------- */
const ITEMS = [
  { id:'crowbar', floor:0, gx:2.5, gz:3.5, type:'crowbar', taken:false },
  { id:'note1',   floor:1, gx:2.5, gz:1.5, type:'note',    taken:false },
  // 消防斧：放在二层右上卧室中央，是唯一的反击手段
  { id:'fireaxe', floor:1, gx:14.5, gz:4.5, type:'fireaxe', taken:false },
];

function makeItemMesh(type) {
  if (type === 'fireaxe') {
    const g = new THREE.Group();
    const metal = stdMat(0xd0d8e0, {
      metalness: .85, roughness: .3,
      emissive: 0x5080a0, emissiveIntensity: 1.1
    });
    const wood = stdMat(0x8a4418, { roughness: .65, emissive: 0x3a1c08, emissiveIntensity: .5 });
    // 竖直握持姿态：柄朝下、斧头在上，比横放更容易被看见
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.05,.055,1.1,10), wood);
    shaft.position.y = -0.15; g.add(shaft);
    const head = new THREE.Mesh(boxGeo(.30,.30,.11), metal);
    head.position.set(0, 0.5, 0); g.add(head);
    const tip = new THREE.Mesh(boxGeo(.13,.15,.09), metal);
    tip.position.set(.10, 0.70, 0); tip.rotation.z = -.5; g.add(tip);
    // 远处也能发现的光柱标记
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(.13, .34, 3.0, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x5fd0ff, transparent: true, opacity: .16,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    beam.position.y = 1.0;
    beam.renderOrder = 2;
    g.add(beam);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(.09, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xaee8ff })
    );
    core.position.y = 0.5; g.add(core);
    g.userData.beacon = beam;
    return g;
  }
  if (type === 'key') {
    const g = new THREE.Group();
    const mat = stdMat(0xe0c060, {
      metalness: .9, roughness: .3,
      emissive: 0x6a5010, emissiveIntensity: .9
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.13,.028,8,14), mat);
    ring.position.x = -.2; g.add(ring);
    const stem = new THREE.Mesh(boxGeo(.34,.05,.05), mat);
    stem.position.set(.05, 0, 0); g.add(stem);
    const tooth = new THREE.Mesh(boxGeo(.06,.13,.05), mat);
    tooth.position.set(.18, -.08, 0); g.add(tooth);
    return g;
  }
  if (type === 'crowbar') {
    const g = new THREE.Group();
    const mat = stdMat(0x8a5a30, {
      metalness: .7, roughness: .5,
      emissive: 0x402008, emissiveIntensity: .6
    });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,.9,8), mat);
    shaft.rotation.z = Math.PI/2; g.add(shaft);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(.12,.035,8,12,Math.PI), mat);
    hook.position.set(.5, 0, 0); hook.rotation.y = Math.PI/2; g.add(hook);
    return g;
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(.55,.38),
    stdMat(0xd8d0b0, {
      roughness: .9,
      emissive: 0x6a6050, emissiveIntensity: 1.0, side: THREE.DoubleSide
    })
  );
  return m;
}

ITEMS.forEach(it => {
  const m = makeItemMesh(it.type);
  m.position.set(it.gx*TILE, 0.75, it.gz*TILE);
  m.rotation.y = Math.random() * Math.PI * 2;
  levelGroups[it.floor].add(m);
  it.mesh = m;
});

/* ---------- 阁楼木箱 ---------- */
const CHEST = { floor:2, x: 9.5*TILE, z: 9.5*TILE };
const chestMesh = makeBox(1.2, 1.0, 1.0, 0x5a3a1a, { roughness: .85 });
chestMesh.position.set(CHEST.x, 0.5, CHEST.z);
levelGroups[2].add(chestMesh);

/* ---------- 楼梯 / 出口位置（与地图格子对齐） ---------- */
const STAIRS = {
  0: [{ label:'上楼', tx:15, tz:13, to:1, sx:15, sz:13 }],
  1: [
    { label:'下楼',   tx:15, tz:13, to:0, sx:15, sz:13 },
    { label:'上阁楼', tx:9,  tz:7,  to:2, sx:9,  sz:7  }
  ],
  2: [{ label:'下阁楼', tx:9, tz:7, to:1, sx:9, sz:7 }]
};

const DOOR_POS = gw(9, 14);

/* ---------- 游戏状态 ---------- */
const G = {
  floor: 0,
  inventory: new Set(),
  doorUnlocked: false,
  doorChainBroken: false,
  chestOpen: false,
  won: false,
  started: false,
  tempMsgUntil: 0,
  weapon: null,        // 当前手持武器 id
  swingUntil: 0,       // 挥击动作结束时间
  swingCooldown: 0,    // 下次可挥击时间
  nextSwingId: 0       // 挥击序号（避免一次挥击重复命中）
};

/* ---------- 武器定义 ----------
   fireaxe 消防斧：近战，击退 + 击晕
   -------------------------------- */
const WEAPONS = {
  fireaxe: {
    id: 'fireaxe',
    name: '消防斧',
    range: 3.2,        // 攻击距离
    arc: Math.PI * 0.6,// 攻击扇形角度
    damage: 34,        // 每次伤害
    knockback: 5.5,    // 击退强度
    stun: 2.6,         // 击晕秒数
    cooldown: 0.75,    // 攻击间隔
    swingTime: 0.42    // 挥击动画时长
  }
};

const player = { x: 9.5*TILE, z: 12.5*TILE, noise:0, crouching:false };
let yaw = Math.PI, pitch = 0;
let stepTimer = 0, heartbeatTimer = 0;
let dragging = false;

camera.position.set(player.x, PLAYER_EYE, player.z);
camera.rotation.y = yaw;

/* ---------- 奶奶 ---------- */
function createGrannyModel() {
  const root = new THREE.Group();
  const skin  = stdMat(0xc8b898, { roughness: .9, emissive: 0x2a2010, emissiveIntensity: .3 });
  const dress = stdMat(0x5a4a5a, { roughness: 1 });
  const eyeMat= stdMat(0xff3030, { emissive: 0xff0000, emissiveIntensity: 4 });

  const body = new THREE.Mesh(new THREE.ConeGeometry(.52, 1.5, 10), dress);
  body.position.y = .75; root.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.28, 14, 14), skin);
  head.position.y = 1.62; root.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(.3, 14, 14, 0, Math.PI*2, 0, Math.PI/2),
    stdMat(0x9a9a9a, { roughness: 1 })
  );
  hair.position.y = 1.64; root.add(hair);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(.045,8,8), eyeMat);
  eyeL.position.set(-.09, 1.66, -.25); root.add(eyeL);
  const eyeR = eyeL.clone(); eyeR.position.x = .09; root.add(eyeR);
  const armGeo = new THREE.CylinderGeometry(.06,.06,.85,6);
  const armL = new THREE.Mesh(armGeo, skin);
  armL.position.set(-.45, 1.15, 0); armL.rotation.z = .18; root.add(armL);
  const armR = new THREE.Mesh(armGeo, skin);
  armR.position.set(.45, 1.15, 0); armR.rotation.z = -.18; root.add(armR);
  root.userData.armL = armL;
  root.userData.armR = armR;
  root.userData.eyeMat = eyeMat;
  root.userData.bodyMat = dress;
  return root;
}
const grannyGroup = new THREE.Group();
const grannyModel = createGrannyModel();
grannyGroup.add(grannyModel);
scene.add(grannyGroup);

const granny = {
  x: 15.5*TILE, z: 12.5*TILE, floor: 0,
  faceYaw: 0, walkPhase: 0,
  state: 'PATROL', target: null, lastKnown: null,
  wanderTarget: null,
  searchTimer: 0, loseTimer: 0,
  anger: 0, caughtCooldown: 0, followTimer: 0,
  hp: 100,            // 生命值，被斧头砍会掉
  stunUntil: 0,       // 眩晕结束时间（performance.now 毫秒）
  knockVX: 0, knockVZ: 0,  // 击退速度
  flashUntil: 0       // 受击白闪
};

/* ---------- 输入 ---------- */
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
    player.crouching = true; e.preventDefault();
  }
  if (e.code === 'KeyE' && !keypadOpen) tryInteract();
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') player.crouching = false;
});

const canvasEl = renderer.domElement;
let locked = false;
function tryLock() {
  const p = canvasEl.requestPointerLock && canvasEl.requestPointerLock();
  if (p && p.catch) p.catch(err => console.warn('Pointer lock 失败:', err));
}
canvasEl.addEventListener('click', () => {
  if (G.started && !G.won && !locked && !keypadOpen) tryLock();
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvasEl;
});
canvasEl.addEventListener('mousedown', e => {
  dragging = true;
  if (e.button === 0 && locked && !keypadOpen) swingWeapon();   // 左键挥击
});
document.addEventListener('mouseup', () => { dragging = false; });
document.addEventListener('mousemove', e => {
  if (!G.started || G.won || keypadOpen) return;
  if (locked) {
    yaw   -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.0022;
  } else if (dragging) {
    yaw   -= e.movementX * 0.005;
    pitch -= e.movementY * 0.005;
  }
  pitch = Math.max(-1.3, Math.min(1.3, pitch));
});

document.getElementById('overlay').addEventListener('click', () => {
  initAudio();
  document.getElementById('overlay').style.display = 'none';
  G.started = true;
  tryLock();
});
document.getElementById('winScreen').addEventListener('click', () => location.reload());
buildWeaponView();   // 初始化手持武器视图

/* ---------- UI ---------- */
const statusEl   = document.getElementById('statusText');
const noiseBar   = document.getElementById('noiseBar');
const invEl      = document.getElementById('invText');
const promptEl   = document.getElementById('prompt');
const dangerEl   = document.getElementById('danger');
const flashEl    = document.getElementById('flash');
const fadeEl     = document.getElementById('fade');
const floorNameEl= document.getElementById('floorName');

function showPrompt(msg, ms = 2200) {
  G.tempMsgUntil = performance.now() + ms;
  promptEl.textContent = msg;
  promptEl.classList.add('show');
}
function updateInv() {
  const names = { crowbar:'撬棍', key:'钥匙', note:'纸条' };
  const arr = [...G.inventory].map(k => names[k] || k);
  if (G.weapon && WEAPONS[G.weapon]) arr.push(WEAPONS[G.weapon].name + '(手持)');
  invEl.textContent = arr.length ? arr.join(' · ') : '无';
}

/* ---------- 交互检测 ---------- */
function findInteractable() {
  const f = G.floor, px = player.x, pz = player.z;
  let best = null, bestD = Infinity;

  for (const it of ITEMS) {
    if (it.floor !== f || it.taken) continue;
    const d = Math.hypot(px - it.gx*TILE, pz - it.gz*TILE);
    if (d < 2.4 && d < bestD) { bestD = d; best = { kind:'item', item: it }; }
  }
  if (f === 0) {
    const d = Math.hypot(px - DOOR_POS.x, pz - DOOR_POS.z);
    if (d < 3.6 && d < bestD) { bestD = d; best = { kind:'door' }; }
  }
  if (f === 2 && !G.chestOpen) {
    const d = Math.hypot(px - CHEST.x, pz - CHEST.z);
    if (d < 2.4 && d < bestD) { bestD = d; best = { kind:'chest' }; }
  }
  for (const st of (STAIRS[f] || [])) {
    const c = gw(st.tx, st.tz);
    const d = Math.hypot(px - c.x, pz - c.z);
    if (d < 2.2 && d < bestD) { bestD = d; best = { kind:'stairs', stair: st }; }
  }
  return best;
}

function getPromptText() {
  const it = findInteractable();
  if (!it) return '';
  if (it.kind === 'item') {
    if (it.item.type === 'crowbar') return '[E] 拾取撬棍';
    if (it.item.type === 'fireaxe') return G.weapon ? '[E] 换上消防斧' : '[E] 拾取消防斧';
    return '[E] 查看纸条';
  }
  if (it.kind === 'stairs') return '[E] ' + it.stair.label;
  if (it.kind === 'chest') return '[E] 打开木箱';
  if (it.kind === 'door') {
    if (!G.inventory.has('key')) return '[E] 主锁锁着（需要钥匙）';
    if (!G.doorUnlocked) return '[E] 用钥匙开主锁';
    if (!G.doorChainBroken)
      return G.inventory.has('crowbar') ? '[E] 用撬棍撬铁链' : '[E] 铁链拴着（需要撬棍）';
    return '[E] 输入密码';
  }
  return '';
}

/* ---------- 交互逻辑 ---------- */
function tryInteract() {
  if (!G.started || G.won) return;
  const target = findInteractable();
  if (!target) return;

  if (target.kind === 'item') {
    const it = target.item;
    it.taken = true;
    it.mesh.visible = false;
    sfxPickup();
    if (it.type === 'crowbar') {
      G.inventory.add('crowbar');
      showPrompt('拿到了一根撬棍。也许能撬开点什么。', 2600);
    } else if (it.type === 'fireaxe') {
      G.weapon = 'fireaxe';
      sfxEquip();
      showPrompt('捡起一把消防斧。她再靠近，就给她一下——左键挥击。', 4200);
    } else {
      G.inventory.add('note');
      showPrompt(`纸条：「阁楼的木箱里有大门钥匙。密码是 ${SECRET_CODE}。」`, 5000);
    }
    updateInv();
    return;
  }

  if (target.kind === 'chest') {
    if (!G.inventory.has('crowbar')) {
      showPrompt('木箱被钉死了。徒手打不开。', 2200);
      return;
    }
    G.chestOpen = true;
    chestMesh.rotation.x = -0.5;
    chestMesh.position.y = 0.35;
    G.inventory.add('key');
    updateInv();
    sfxPickup();
    showPrompt(`撬开了木箱。里面有一把钥匙，和一张写着「${SECRET_CODE}」的纸条。`, 5000);
    return;
  }

  if (target.kind === 'door') {
    if (!G.doorUnlocked) {
      if (!G.inventory.has('key')) { showPrompt('主锁锁着。需要一把钥匙。', 2200); return; }
      G.doorUnlocked = true;
      sfxUnlock();
      showPrompt('主锁开了。但门上还拴着一条粗铁链。', 3000);
      return;
    }
    if (!G.doorChainBroken) {
      if (!G.inventory.has('crowbar')) { showPrompt('铁链很粗，徒手弄不断。需要工具。', 2400); return; }
      G.doorChainBroken = true;
      sfxUnlock();
      showPrompt('铁链被撬断了。门把手上挂着一个密码锁。', 3000);
      return;
    }
    openKeypad();
    return;
  }

  if (target.kind === 'stairs') {
    goToFloor(target.stair.to, target.stair.sx, target.stair.sz);
  }
}

/* ---------- 楼层切换 ---------- */
function goToFloor(fi, sx, sz) {
  sfxStairs();
  fadeEl.style.opacity = '1';
  setTimeout(() => {
    G.floor = fi;
    player.x = sx*TILE + TILE/2;
    player.z = sz*TILE + TILE/2;
    player.noise = 0;
    camera.position.set(player.x, PLAYER_EYE, player.z);
    levelGroups.forEach((g, i) => g.visible = (i === fi));
    floorNameEl.textContent = FLOOR_NAMES[fi];

    if (granny.floor !== fi) {
      granny.followTimer = 4.5;
      grannyModel.rotation.x = 0;      // 防止倒地姿态带到别的楼层
      grannyModel.position.y = 0;
      granny.state = 'SEARCH';
      grannyGroup.visible = false;
    } else {
      grannyGroup.visible = true;
    }
    setTimeout(() => { fadeEl.style.opacity = '0'; }, 60);
  }, 220);
}

/* ---------- 密码键盘 ---------- */
let keypadOpen = false;
let kpInput = '';
const keypadEl  = document.getElementById('keypad');
const kpDisplay = document.getElementById('kpDisplay');

function renderKp() {
  kpDisplay.textContent = kpInput.padEnd(3, '_').split('').join(' ');
  kpDisplay.classList.remove('err');
}
function openKeypad() {
  keypadOpen = true;
  kpInput = '';
  renderKp();
  keypadEl.classList.add('on');
  try { document.exitPointerLock(); } catch(e) {}
}
function closeKeypad() {
  keypadOpen = false;
  keypadEl.classList.remove('on');
  tryLock();
}
keypadEl.addEventListener('click', e => {
  const k = e.target.dataset && e.target.dataset.k;
  if (!k) return;
  if (k === 'C') { kpInput = ''; renderKp(); return; }
  if (k === 'E') {
    if (kpInput.length !== 3) return;
    submitCode(kpInput);
    return;
  }
  if (kpInput.length < 3) { kpInput += k; renderKp(); }
});
document.getElementById('kpClose').addEventListener('click', closeKeypad);

async function submitCode(code) {
  try {
    const res = await fetch('api.php?action=verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'code=' + encodeURIComponent(code)
    });
    const data = await res.json();
    if (data.ok) {
      closeKeypad();
      win(data.elapsed);
    } else {
      kpDisplay.classList.add('err');
      setTimeout(() => { kpInput = ''; renderKp(); }, 500);
    }
  } catch (err) {
    showErr('验证失败：' + err.message);
    kpDisplay.classList.add('err');
    setTimeout(() => { kpInput = ''; renderKp(); }, 500);
  }
}

function win(elapsed) {
  G.won = true;
  sfxWin();
  try { document.exitPointerLock(); } catch(e) {}
  const stats = document.getElementById('winStats');
  if (typeof elapsed === 'number') {
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    stats.textContent = `逃脱用时 ${m} 分 ${s} 秒`;
  }
  document.getElementById('winScreen').style.display = 'flex';
}

/* ---------- 玩家 ---------- */
function updatePlayer(dt) {
  let f = 0, r = 0;
  if (keys['KeyW'] || keys['ArrowUp'])    f += 1;
  if (keys['KeyS'] || keys['ArrowDown'])  f -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) r += 1;
  if (keys['KeyA'] || keys['ArrowLeft'])  r -= 1;

  const moving = (f !== 0 || r !== 0);
  const sprinting = moving && keys['ShiftLeft'] && !player.crouching;
  const speed = player.crouching ? 1.8 : (sprinting ? 6.2 : 4.0);

  if (moving && !keypadOpen) {
    const len = Math.hypot(f, r); f /= len; r /= len;
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const dx = (-sy*f + cy*r) * speed * dt;
    const dz = (-cy*f - sy*r) * speed * dt;
    if (canMove(G.floor, player.x + dx, player.z, PLAYER_R)) player.x += dx;
    if (canMove(G.floor, player.x, player.z + dz, PLAYER_R)) player.z += dz;

    if (!player.crouching) {
      stepTimer += dt;
      const interval = sprinting ? .3 : .45;
      if (stepTimer > interval) { stepTimer = 0; sfxStep(); }
    }
  }

  const targetEye = player.crouching ? CROUCH_EYE : PLAYER_EYE;
  camera.position.x += (player.x - camera.position.x) * Math.min(1, dt*20);
  camera.position.z += (player.z - camera.position.z) * Math.min(1, dt*20);
  camera.position.y += (targetEye - camera.position.y) * Math.min(1, dt*8);
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  const noiseTarget = (moving && !keypadOpen)
    ? (player.crouching ? 8 : sprinting ? 90 : 35) : 0;
  player.noise += (noiseTarget - player.noise) * Math.min(1, dt * 2.6);

  if (player.noise > 45 && granny.state !== 'CHASE' && granny.floor === G.floor) {
    granny.target = { x: player.x, z: player.z };
    granny.state = 'INVESTIGATE';
  }
}


/* ---------- 武器：挥击 ---------- */
const weaponViewEl = document.getElementById('weaponView');

function swingWeapon() {
  if (!G.started || G.won || keypadOpen) return;
  if (!G.weapon) return;                       // 空手不能攻击
  const w = WEAPONS[G.weapon];
  const now = performance.now();
  if (now < G.swingCooldown) return;

  G.swingCooldown = now + w.cooldown * 1000;
  G.swingUntil    = now + w.swingTime * 1000;
  G.nextSwingId++;
  sfxSwing();

  // 同层且在前方扇形范围内才判命中
  if (granny.floor !== G.floor) return;
  const dx = granny.x - player.x, dz = granny.z - player.z;
  const dist = Math.hypot(dx, dz);
  if (dist > w.range) return;

  // 面向向量（yaw 与相机一致）
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const cosA = (dx * fx + dz * fz) / (dist || 1);
  if (cosA < Math.cos(w.arc / 2)) return;      // 不在扇形内

  // 命中！
  granny.hp -= w.damage;
  granny.flashUntil = now + 160;
  granny.knockVX += (dx / dist) * w.knockback;
  granny.knockVZ += (dz / dist) * w.knockback;
  granny.stunUntil = Math.max(granny.stunUntil, now + w.stun * 1000);
  granny.state = 'STUN';
  granny.caughtCooldown = Math.max(granny.caughtCooldown, w.stun);
  sfxHit();
  sfxStun();

  if (granny.hp <= 0) {
    grannyDown();
  } else {
    showPrompt(`砍中了！她踉跄后退（剩余 ${Math.max(0, granny.hp)}）`, 1600);
  }
}

/* 击倒：暂时瘫倒，几秒后会在别处重新站起来 */
function grannyDown() {
  G.wasDownAt = performance.now();
  granny.downUntil = performance.now() + 9000;
  granny.state = 'DOWN';
  granny.stunUntil = 0;
  granny.hp = 100;                 // 倒地后恢复，避免永久无敌
  showPrompt('她倒下了。趁现在，快找出口——但她会醒。', 3600);
  sfxCaught();
}

/* 手持武器视图模型（贴在相机右下角） */
let weaponViewModel = null;
function buildWeaponView() {
  if (!weaponViewEl || weaponViewModel) return;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
  const root = new THREE.Group();
  const metal = stdMat(0xb8c0c8, { metalness: .85, roughness: .35, emissive: 0x203040, emissiveIntensity: .5 });
  const wood  = stdMat(0x7a3a1a, { roughness: .7 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.05,.055,1.1,10), wood);
  shaft.rotation.z = Math.PI/2; root.add(shaft);
  const head = new THREE.Mesh(boxGeo(.11,.36,.28), metal);
  head.position.set(.6, .17, 0); root.add(head);
  root.position.set(.18, -.22, -.5);
  root.rotation.set(-0.2, 0.3, 0);
  scene.add(root);
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const pl = new THREE.DirectionalLight(0xffe8c0, 2.2);
  pl.position.set(1, 2, 2); scene.add(pl);

  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.setSize(220, 220);
  r.domElement.style.width = '100%';
  r.domElement.style.height = '100%';
  weaponViewEl.appendChild(r.domElement);
  weaponViewModel = { renderer: r, scene, cam, root, baseRot: root.rotation.clone() };
}
function updateWeaponView(dt, now) {
  if (!weaponViewModel) return;
  weaponViewEl.style.display = G.weapon ? 'block' : 'none';
  if (!G.weapon) return;
  const m = weaponViewModel;
  const swinging = now < G.swingUntil;
  const t = swinging ? 1 - (G.swingUntil - now) / (WEAPONS[G.weapon].swingTime * 1000) : 0;
  // 挥击时斧头向前劈下再收回
  m.root.rotation.x = m.baseRot.x - (swinging ? Math.sin(t * Math.PI) * 1.1 : 0);
  m.root.rotation.z = m.baseRot.z + (swinging ? Math.sin(t * Math.PI) * 0.5 : 0);
  m.root.position.y = -.22 + (swinging ? Math.sin(t * Math.PI) * 0.06 : 0);
  m.renderer.render(m.scene, m.cam);
}

/* ---------- 奶奶 AI ---------- */
function updateGranny(dt) {
  if (granny.caughtCooldown > 0) granny.caughtCooldown -= dt;
  granny.anger = Math.max(0, granny.anger - dt*12);

  const nowMs = performance.now();

  // 击退位移（每帧衰减）
  if (granny.knockVX !== 0 || granny.knockVZ !== 0) {
    const kx = granny.knockVX * dt, kz = granny.knockVZ * dt;
    if (canMove(granny.floor, granny.x + kx, granny.z, 0.55)) granny.x += kx;
    if (canMove(granny.floor, granny.x, granny.z + kz, 0.55)) granny.z += kz;
    const damp = Math.max(0, 1 - dt * 6);
    granny.knockVX *= damp; granny.knockVZ *= damp;
    if (Math.abs(granny.knockVX) < .05) granny.knockVX = 0;
    if (Math.abs(granny.knockVZ) < .05) granny.knockVZ = 0;
  }

  // 倒地：躺一会儿后换个远点重新站起来
  if (granny.state === 'DOWN') {
    grannyGroup.position.set(granny.x, 0, granny.z);
    grannyModel.rotation.x = -Math.PI / 2 * 0.85;      // 向后倒
    grannyModel.position.y = 0.25;
    if (nowMs >= granny.downUntil) {
      grannyModel.rotation.x = 0;
      grannyModel.position.y = 0;
      reviveGranny();
    }
    return;
  }

  // 眩晕：原地踉跄，不追不抓
  if (nowMs < granny.stunUntil) {
    granny.state = 'STUN';
    grannyGroup.position.set(granny.x, 0, granny.z);
    granny.walkPhase += dt * 6;
    grannyModel.userData.armL.rotation.x = Math.sin(granny.walkPhase) * 0.5;
    grannyModel.userData.armR.rotation.x = Math.sin(granny.walkPhase + 1) * 0.5;
    grannyModel.position.y = Math.abs(Math.sin(granny.walkPhase * 1.3)) * 0.06;
    return;
  }
  if (granny.state === 'STUN') { granny.state = 'SEARCH'; granny.searchTimer = 2.5; }

  if (granny.floor !== G.floor) {
    granny.followTimer -= dt;
    grannyGroup.visible = false;
    if (granny.followTimer <= 0) {
      granny.floor = G.floor;
      const st = (STAIRS[G.floor] || [])[0];
      let spawn = { x: player.x + 6, z: player.z + 6 };
      if (st) {
        const c = gw(st.tx, st.tz);
        spawn = { x: c.x, z: c.z };
      }
      granny.x = Math.max(TILE, Math.min((MW-1)*TILE, spawn.x));
      granny.z = Math.max(TILE, Math.min((MH-1)*TILE, spawn.z));
      granny.state = 'SEARCH';
      granny.searchTimer = 6;
      granny.lastKnown = { x: player.x, z: player.z };
      granny.wanderTarget = null;
      grannyGroup.visible = true;
      sfxHeart();
    }
    return;
  }

  const dxp = player.x - granny.x;
  const dzp = player.z - granny.z;
  const distP = Math.hypot(dxp, dzp);

  const sees = distP < 20 && hasLOS(G.floor, granny.x, granny.z, player.x, player.z);
  const notices = sees && (!player.crouching || distP < 6 || player.noise > 55);

  if (notices) {
    if (granny.state !== 'CHASE') { sfxHeart(); granny.anger = 40; }
    granny.state = 'CHASE';
    granny.lastKnown = { x: player.x, z: player.z };
    granny.loseTimer = 0;
    granny.anger = Math.min(100, granny.anger + dt*35);
  }

  let target = null, speed = 0;

  if (granny.state === 'CHASE') {
    target = granny.lastKnown;
    speed = 3.4 + granny.anger * 0.008;
    if (!notices) {
      granny.loseTimer += dt;
      if (granny.loseTimer > 3.5) {
        granny.state = 'SEARCH';
        granny.searchTimer = 4.5;
        granny.loseTimer = 0;
      }
    } else granny.loseTimer = 0;
  } else if (granny.state === 'INVESTIGATE') {
    target = granny.target; speed = 2.4;
    if (target && Math.hypot(target.x-granny.x, target.z-granny.z) < 1.8) {
      granny.state = 'SEARCH'; granny.searchTimer = 3;
      granny.lastKnown = { ...target }; granny.target = null;
    }
  } else if (granny.state === 'SEARCH') {
    speed = 1.6; granny.searchTimer -= dt;
    if (granny.lastKnown) {
      const t = performance.now() / 650;
      target = {
        x: granny.lastKnown.x + Math.cos(t) * 3,
        z: granny.lastKnown.z + Math.sin(t) * 3
      };
    }
    if (granny.searchTimer <= 0) { granny.state = 'PATROL'; granny.lastKnown = null; }
  } else {
    // PATROL：随机游走
    speed = 1.5;
    if (!granny.wanderTarget ||
        Math.hypot(granny.wanderTarget.x - granny.x, granny.wanderTarget.z - granny.z) < 1.5) {
      let found = false;
      for (let tries = 0; tries < 40; tries++) {
        const tx = Math.floor(Math.random() * (MW - 2)) + 1;
        const tz = Math.floor(Math.random() * (MH - 2)) + 1;
        if (!solidAt(granny.floor, tx, tz)) {
          granny.wanderTarget = gw(tx, tz);
          found = true;
          break;
        }
      }
      if (!found) granny.wanderTarget = { x: granny.x, z: granny.z };
    }
    target = granny.wanderTarget;
  }

  if (target) {
    const dx = target.x - granny.x, dz = target.z - granny.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.5) {
      const step = speed * dt;
      const nx = granny.x + (dx/d)*step;
      const nz = granny.z + (dz/d)*step;
      if (canMove(granny.floor, nx, granny.z, 0.55)) granny.x = nx;
      if (canMove(granny.floor, granny.x, nz, 0.55)) granny.z = nz;
      granny.faceYaw = Math.atan2(-dx, -dz);
    }
  }

  grannyGroup.position.set(granny.x, 0, granny.z);
  const cur = grannyGroup.rotation.y;
  let diff = granny.faceYaw - cur;
  while (diff >  Math.PI) diff -= Math.PI*2;
  while (diff < -Math.PI) diff += Math.PI*2;
  grannyGroup.rotation.y = cur + diff * Math.min(1, dt*6);

  granny.walkPhase += dt * speed * 2.4;
  const swing = Math.sin(granny.walkPhase) * 0.4;
  grannyModel.userData.armL.rotation.x =  swing;
  grannyModel.userData.armR.rotation.x = -swing;
  grannyModel.position.y = Math.abs(Math.sin(granny.walkPhase)) * 0.05;

  // 受击闪红
  const hitFlash = nowMs < granny.flashUntil;
  grannyModel.userData.eyeMat.emissiveIntensity = hitFlash ? 12 : 4;
  grannyModel.userData.bodyMat.color.setHex(hitFlash ? 0xaa5555 : 0x5a4a5a);

  if (distP < 1.5 && granny.caughtCooldown <= 0) caught();
}

/* ---------- 被抓 ---------- */
function caught() {
  granny.caughtCooldown = 2;

  G.inventory.clear();
  G.doorUnlocked = false;
  G.doorChainBroken = false;
  G.chestOpen = false;
  chestMesh.rotation.x = 0;
  chestMesh.position.y = 0.5;
  for (const it of ITEMS) {
    it.taken = false;
    it.mesh.visible = true;
  }
  updateInv();

  G.floor = 0;
  player.x = 9.5*TILE; player.z = 12.5*TILE;
  player.noise = 0;
  camera.position.set(player.x, PLAYER_EYE, player.z);
  yaw = Math.PI; pitch = 0;
  levelGroups.forEach((g, i) => g.visible = (i === 0));
  floorNameEl.textContent = FLOOR_NAMES[0];

  granny.floor = 0;
  granny.x = 15.5*TILE; granny.z = 12.5*TILE;
  granny.state = 'PATROL';
  granny.target = null; granny.lastKnown = null;
  granny.wanderTarget = null; granny.anger = 0;
  granny.hp = 100;
  granny.stunUntil = 0; granny.downUntil = 0;
  granny.knockVX = 0; granny.knockVZ = 0;
  grannyModel.rotation.x = 0;
  grannyModel.position.y = 0;
  G.weapon = null;                 // 被抓会丢掉武器
  G.swingCooldown = 0;
  grannyGroup.visible = true;

  sfxCaught();
  flashEl.style.opacity = '0.8';
  setTimeout(() => flashEl.style.opacity = '0', 500);
  showPrompt('……她抓住了你。所有东西都回到了原处。', 3200);
}

/* ---------- 奶奶倒地后重新现身（远端随机点） ---------- */
function reviveGranny() {
  const f = G.floor;
  let spawn = null;
  for (let i = 0; i < 60; i++) {
    const tx = Math.floor(Math.random() * (MW - 2)) + 1;
    const tz = Math.floor(Math.random() * (MH - 2)) + 1;
    if (solidAt(f, tx, tz)) continue;
    const c = gw(tx, tz);
    if (Math.hypot(c.x - player.x, c.z - player.z) > 10 * TILE) { spawn = c; break; }
  }
  if (!spawn) {
    // 退而求其次：取最远的可行格
    let bestD = -1;
    for (let tz = 1; tz < MH - 1; tz++)
      for (let tx = 1; tx < MW - 1; tx++) {
        if (solidAt(f, tx, tz)) continue;
        const c = gw(tx, tz);
        const d = Math.hypot(c.x - player.x, c.z - player.z);
        if (d > bestD) { bestD = d; spawn = c; }
      }
  }
  if (!spawn) spawn = { x: player.x + 6 * TILE, z: player.z };

  granny.floor = f;
  granny.x = Math.max(TILE, Math.min((MW - 1) * TILE, spawn.x));
  granny.z = Math.max(TILE, Math.min((MH - 1) * TILE, spawn.z));
  granny.hp = 100;
  granny.knockVX = 0; granny.knockVZ = 0;
  granny.state = 'SEARCH';
  granny.searchTimer = 6;
  granny.lastKnown = { x: player.x, z: player.z };
  granny.wanderTarget = null;
  granny.caughtCooldown = 1.5;
  grannyGroup.visible = true;
  spawnDust(granny.x, granny.z);
  sfxHeart();
  showPrompt('……地板又在响。她站起来了。', 3000);
}

/* ---------- UI 更新 ---------- */
function updateUI() {
  noiseBar.style.width = player.noise + '%';

  if (granny.state === 'DOWN' && granny.floor === G.floor) {
    statusEl.textContent = '她倒下了 — 快跑！';
    statusEl.style.color = '#6aff8a';
    dangerEl.style.opacity = 0;
  } else if (granny.state === 'STUN' && granny.floor === G.floor) {
    statusEl.textContent = '她踉跄了 — 补一下或跑';
    statusEl.style.color = '#8ac0ff';
    dangerEl.style.opacity = 0.1;
  } else if (granny.state === 'CHASE' && granny.floor === G.floor) {
    statusEl.textContent = '被追逐！';
    statusEl.style.color = '#ff4444';
    const d = Math.hypot(player.x - granny.x, player.z - granny.z);
    dangerEl.style.opacity = Math.max(0, 1 - d/18) * 0.7;
  } else if (granny.state === 'INVESTIGATE' && granny.floor === G.floor) {
    statusEl.textContent = '她听到了动静…';
    statusEl.style.color = '#e0a040';
    dangerEl.style.opacity = 0.12;
  } else if (granny.state === 'SEARCH' && granny.floor === G.floor) {
    statusEl.textContent = '她在附近搜索…';
    statusEl.style.color = '#c0c040';
    dangerEl.style.opacity = 0.18;
  } else {
    statusEl.textContent = G.weapon ? '潜行中 · 持斧' : '潜行中';
    statusEl.style.color = '#d0b070';
    dangerEl.style.opacity = 0;
  }

  if (granny.state === 'CHASE' && granny.floor === G.floor) {
    const d = Math.hypot(player.x - granny.x, player.z - granny.z);
    if (d < 16) {
      heartbeatTimer -= 1/60;
      if (heartbeatTimer <= 0) {
        sfxHeart();
        heartbeatTimer = Math.max(0.35, d / 14);
      }
    }
  }

  if (performance.now() < G.tempMsgUntil) return;
  const text = getPromptText();
  if (promptEl.textContent !== text) promptEl.textContent = text;
  promptEl.classList.toggle('show', !!text);
}

/* ---------- 主循环 ---------- */
let lastTime = performance.now();
let frameId = 0;
function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (G.started && !G.won) {
    if (!keypadOpen) updatePlayer(dt);
    updateGranny(dt);
    updateUI();
    // 手电：低频轻微抖动，每 3 帧更新一次即可，肉眼无差
    if ((frameId & 3) === 0) {
      flashlight.intensity = 210 + Math.sin(now * 0.008) * 15 + (Math.random() - 0.5) * 12;
    }

    for (const it of ITEMS) {
      if (it.taken) continue;
      it.mesh.rotation.y += dt * 1.2;
      it.mesh.position.y = 0.75 + Math.sin(now * 0.003) * 0.1;
      // 消防斧的光柱做呼吸，远看更容易注意到
      const beacon = it.mesh.userData.beacon;
      if (beacon) {
        beacon.material.opacity = .12 + Math.sin(now * 0.004) * .07;
        beacon.rotation.y -= dt * 0.6;
      }
    }
  }
  updateWeaponView(dt, now);
  renderer.render(scene, camera);
  frameId++;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});