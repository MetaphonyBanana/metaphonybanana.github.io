import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── ビリヤード台オーバーレイ(Nine Ball Break Cosmos) ─────────────────────
// ユーザー提供の参考実装(nine_ball_break_cosmos.html)をほぼそのまま移植したもの。
// 「つなぐことに特化」の方針により、変更は最小限に留めている:
//   - メインシーンとはWebGLコンテキストを分離した、独立canvas+独立rAFループの
//     フルスクリーンHTMLオーバーレイとして実装(最も手数が少ない繋ぎ方)
//   - カメラの初期位置だけ変更: 元は卓の奥行き(Z)方向から見る構図だったが、
//     指定により「ラック側が左・キューボール側が右」に見えるよう、
//     world +X側から卓を横から見る構図にした(仰角の数値13.5/15.5はそのまま流用)。
//     ラックは+Z、キューボールは-Zに配置されているため、+X側から見れば
//     ラックが画面左、キューボールが画面右に来る。
//   - 閉じるボタン(← 戻る)を追加し、YZパネル経由でのみ出入りできるようにした
//   - hint/replayのDOM idはメイン側の#hintと衝突するため、オーバーレイ内で
//     動的に要素を生成する形に変更した(ロジックは元のまま)
export function createBilliardTable(opts = {}) {
  const { onClose } = opts;
  const overlay = document.createElement('div');
  overlay.className = 'billiard-overlay';
  document.body.appendChild(overlay);

  const hint = document.createElement('div');
  hint.className = 'billiard-hint';
  hint.textContent = 'DRAG TO ORBIT · SCROLL TO ZOOM';
  overlay.appendChild(hint);

  const replayBtn = document.createElement('div');
  replayBtn.className = 'billiard-replay';
  replayBtn.textContent = '◎ REPLAY BREAK';
  overlay.appendChild(replayBtn);

  const closeBtn = document.createElement('div');
  closeBtn.className = 'billiard-close';
  closeBtn.textContent = '← 戻る';
  overlay.appendChild(closeBtn);

  // セリフの星(5個)のテキスト表示用
  const starDialogueEl = document.createElement('div');
  starDialogueEl.className = 'billiard-dialogue';
  overlay.appendChild(starDialogueEl);

  // ポケット(作品名)のホバーツールチップ用
  const pocketTooltipEl = document.createElement('div');
  pocketTooltipEl.className = 'billiard-pocket-tooltip';
  overlay.appendChild(pocketTooltipEl);

  let rafId = null;


/* ---------------------------------------------------------------
   BASIC SETUP
--------------------------------------------------------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
overlay.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05030f, 0.018);

const camera = new THREE.PerspectiveCamera(42, innerWidth/innerHeight, 0.1, 300);
camera.position.set(15.5, 13.5, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0.3);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 6;
controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

addEventListener("resize", () => {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------------------------------------------------------------
   COSMIC ENVIRONMENT (background + reflection source + stars)
--------------------------------------------------------------- */
function buildCosmosTexture(){
  const w = 1024, h = 512;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");

  // 元の宇宙(index.html)に合わせ、ほぼ黒一色の背景にする(カラフルな星雲ブロブは廃止)
  const g = ctx.createLinearGradient(0,0,0,h);
  g.addColorStop(0.0, "#05050a");
  g.addColorStop(0.5, "#06060f");
  g.addColorStop(1.0, "#05050a");
  ctx.fillStyle = g;
  ctx.fillRect(0,0,w,h);

  // (背景の星は廃止 — 代わりに5つのセリフの星を実体として浮かべる)

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const cosmosTex = buildCosmosTexture();
scene.background = cosmosTex;
scene.environment = cosmosTex;

/* ---------------------------------------------------------------
   LIGHTS — simple but fantastical
--------------------------------------------------------------- */
scene.add(new THREE.AmbientLight(0x6a5acd, 0.35));

const hemi = new THREE.HemisphereLight(0x9fb8ff, 0x1a0a30, 0.5);
scene.add(hemi);

const keyLight = new THREE.PointLight(0xaea2ff, 18, 30, 2);
keyLight.position.set(-4.5, 6.5, 3.5);
scene.add(keyLight);

const rimLight = new THREE.PointLight(0x38e8ff, 14, 28, 2);
rimLight.position.set(5.5, 4.5, -4.5);
scene.add(rimLight);

const warmLight = new THREE.PointLight(0xff7fd1, 8, 22, 2);
warmLight.position.set(0, 3, 6.5);
scene.add(warmLight);

/* ---------------------------------------------------------------
   TABLE GEOMETRY CONSTANTS
--------------------------------------------------------------- */
const HALF_X = 3.6;             // half-width  (short rail direction)
const HALF_Z = 7.2;             // half-length (long rail direction) — exact 2:1 table
const BALL_R = 0.26;
const POCKET_R = 0.52;
const POCKET_CAPTURE = 0.30;
const CORNER_INSET = 0.32;
const SIDE_INSET = 0.18;

const corners = [
  new THREE.Vector2( HALF_X-CORNER_INSET,  HALF_Z-CORNER_INSET),
  new THREE.Vector2(-HALF_X+CORNER_INSET,  HALF_Z-CORNER_INSET),
  new THREE.Vector2( HALF_X-CORNER_INSET, -HALF_Z+CORNER_INSET),
  new THREE.Vector2(-HALF_X+CORNER_INSET, -HALF_Z+CORNER_INSET),
];
const sidePockets = [
  new THREE.Vector2( HALF_X-SIDE_INSET, 0),
  new THREE.Vector2(-HALF_X+SIDE_INSET, 0),
];
const pockets = [...corners, ...sidePockets]; // all 6 pockets
const TARGET_POCKET = corners[0].clone(); // the "wormhole" pocket the ripple is tied to

/* ---------------------------------------------------------------
   WATER SURFACE (custom shader — translucent, ever-moving)
--------------------------------------------------------------- */
const waterGeo = new THREE.PlaneGeometry(HALF_X*2, HALF_Z*2, 140, 280);
waterGeo.rotateX(-Math.PI/2);

const waterUniforms = {
  uTime:        { value: 0 },
  uRippleOrigin:{ value: TARGET_POCKET.clone() },
  uRippleStart: { value: -999 },
  uRippleAmp:   { value: 0.34 },
  uRippleSpeed: { value: 3.4 },
  uSplashStart: { value: -999 },
  uSplashOrigin:{ value: TARGET_POCKET.clone() },
  uCamPos:      { value: camera.position.clone() },
  uColorDeep:   { value: new THREE.Color(0x0a0e3a) },
  uColorShallow:{ value: new THREE.Color(0x3a6bd6) },
  uColorGlow:   { value: new THREE.Color(0xaf7dff) },
};

const waterMat = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  transparent: true,
  side: THREE.DoubleSide,
  depthWrite: false,
  vertexShader: `
    uniform float uTime;
    uniform vec2  uRippleOrigin;
    uniform float uRippleStart;
    uniform float uRippleAmp;
    uniform float uRippleSpeed;
    uniform float uSplashStart;
    uniform vec2  uSplashOrigin;

    varying vec3 vWorldPos;
    varying vec3 vViewPos;
    varying float vElevation;

    float wave(vec2 p, float t){
      float w = 0.0;
      w += sin(p.x*0.42 + t*0.55) * 0.018;
      w += sin(p.y*0.33 - t*0.42) * 0.016;
      w += sin((p.x+p.y)*0.23 + t*0.30) * 0.014;
      w += sin((p.x-p.y)*0.55 + t*0.8) * 0.006;
      return w;
    }

    float ripple(vec2 p, vec2 origin, float startT, float amp, float speed, float freq, float decay){
      if(startT < -500.0) return 0.0;
      float age = uTime - startT;
      if(age < 0.0) return 0.0;
      float d = distance(p, origin);
      float front = speed * age;
      float band = smoothstep(front - 1.4, front, d) * (1.0 - smoothstep(front, front + 1.4, d));
      float env = exp(-decay * age);
      return sin(d*freq - age*speed*freq) * amp * env * band;
    }

    void main(){
      vec3 pos = position;
      float base = wave(pos.xz, uTime);
      float r1 = ripple(pos.xz, uRippleOrigin, uRippleStart, uRippleAmp, uRippleSpeed, 2.6, 0.35);
      float r2 = ripple(pos.xz, uSplashOrigin, uSplashStart, 0.5, 4.2, 3.4, 1.1);
      float elevation = base + r1 + r2;
      pos.y += elevation;
      vElevation = elevation;

      vec4 worldPos = modelMatrix * vec4(pos,1.0);
      vWorldPos = worldPos.xyz;
      vec4 viewPos = viewMatrix * worldPos;
      vViewPos = viewPos.xyz;
      gl_Position = projectionMatrix * viewPos;
    }
  `,
  fragmentShader: `
    uniform vec3 uColorDeep;
    uniform vec3 uColorShallow;
    uniform vec3 uColorGlow;
    uniform vec3 uCamPos;
    varying vec3 vWorldPos;
    varying vec3 vViewPos;
    varying float vElevation;

    void main(){
      vec3 fdx = dFdx(vViewPos);
      vec3 fdy = dFdy(vViewPos);
      vec3 normal = normalize(cross(fdx, fdy));
      vec3 viewDir = normalize(-vViewPos);
      float fresnel = pow(1.0 - clamp(dot(normal, viewDir),0.0,1.0), 2.6);

      vec3 base = mix(uColorDeep, uColorShallow, clamp(vElevation*4.0+0.5,0.0,1.0));
      vec3 col = mix(base, uColorGlow, fresnel*0.7);
      col += vec3(0.5,0.65,1.0) * smoothstep(0.09, 0.16, vElevation) * 0.6;

      float alpha = 0.62 + fresnel*0.3;
      gl_FragColor = vec4(col, clamp(alpha,0.0,0.92));
    }
  `
});
const water = new THREE.Mesh(waterGeo, waterMat);
scene.add(water);
// (no solid plane sits beneath the water any more — nothing to expose
//  when the waves dip low, the cosmos simply shows through)

/* ---------------------------------------------------------------
   POCKETS — glowing white wormholes
--------------------------------------------------------------- */
function buildWormholeTexture(){
  const s = 256;
  const c = document.createElement("canvas");
  c.width = s; c.height = s;
  const ctx = c.getContext("2d");
  const rg = ctx.createRadialGradient(s/2,s/2,0, s/2,s/2, s/2);
  rg.addColorStop(0.0, "rgba(255,255,255,1.0)");
  rg.addColorStop(0.2, "rgba(255,255,255,0.95)");
  rg.addColorStop(0.5, "rgba(220,235,255,0.55)");
  rg.addColorStop(0.8, "rgba(180,210,255,0.15)");
  rg.addColorStop(1.0, "rgba(180,210,255,0.0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0,0,s,s);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
const wormholeTex = buildWormholeTexture();
const pocketMeshes = [];

function buildPocket(c, isTarget){
  const group = new THREE.Group();
  group.position.set(c.x, 0, c.y);
  scene.add(group);

  // the pocket itself — a simple dark circle, the mouth of the hole
  const hole = new THREE.Mesh(
    new THREE.CircleGeometry(POCKET_R*0.62, 32),
    new THREE.MeshBasicMaterial({ color:0x000000 })
  );
  hole.rotation.x = -Math.PI/2;
  hole.position.y = 0.01;
  group.add(hole);

  // radiant white light pouring straight up out of the hole's center —
  // a wide soft halo plus a small blazing core, stacked for real punch
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(POCKET_R*1.8, 32),
    new THREE.MeshBasicMaterial({
      map: wormholeTex, color: 0xffffff,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false,
      opacity: isTarget ? 1.0 : 0.75
    })
  );
  glow.rotation.x = -Math.PI/2;
  glow.position.y = 0.02;
  group.add(glow);

  const core = new THREE.Mesh(
    new THREE.CircleGeometry(POCKET_R*0.55, 24),
    new THREE.MeshBasicMaterial({
      map: wormholeTex, color: 0xffffff,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false,
      opacity: isTarget ? 1.0 : 0.9
    })
  );
  core.rotation.x = -Math.PI/2;
  core.position.y = 0.03;
  group.add(core);

  const light = new THREE.PointLight(0xffffff, isTarget ? 9 : 5, isTarget ? 6.5 : 4.5, 2);
  light.position.y = 0.4;
  group.add(light);

  // ホバー判定用の当たり判定(見た目には出ない、少し広めの円盤)
  const hitArea = new THREE.Mesh(
    new THREE.CircleGeometry(POCKET_R * 1.6, 24),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitArea.rotation.x = -Math.PI / 2;
  hitArea.position.y = 0.05;
  group.add(hitArea);

  return { group, glow, core, light, hitArea, isTarget, pos:c };
}

// 各ポケットに対応する作品名(仮テキスト。あとで差し替え可)
const POCKET_WORKS = [
  'A Perfect Day for Bananafish',
  'Hapworth 16, 1924',
  'Teddy',
  'Hapworth companion piece?',
  'Down at the Dinghy',
  '?',
];

pockets.forEach((c, idx) => {
  const p = buildPocket(c, idx === 0);
  p.workTitle = POCKET_WORKS[idx] ?? '';
  pocketMeshes.push(p);
});
const targetGlow = pocketMeshes[0].light;

/* ---------------------------------------------------------------
   BALL TEXTURES (simple canvas number labels)
--------------------------------------------------------------- */
const BALL_COLORS = {
  1:"#e8c34a", 2:"#3f7fe0", 3:"#e04b4b", 4:"#8a4fd6",
  5:"#e0813a", 6:"#39a35c", 7:"#8a3f2a", 8:"#1b1b22", 9:"#e8c34a",
};
function makeBallTexture(num){
  const s = 256;
  const c = document.createElement("canvas");
  c.width = s; c.height = s;
  const ctx = c.getContext("2d");
  ctx.clearRect(0,0,s,s);

  const isStripe = num === 9;
  ctx.fillStyle = "rgba(255,255,255,0.0)";
  ctx.fillRect(0,0,s,s);

  // circular label band
  const bandY = s*0.5, bandH = s*0.44;
  if(isStripe){
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(0, bandY-bandH/2, s, bandH);
    ctx.fillStyle = BALL_COLORS[num];
    ctx.fillRect(0, bandY-bandH/2, s, bandH*0.28);
    ctx.fillRect(0, bandY+bandH/2-bandH*0.28, s, bandH*0.28);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath(); ctx.arc(s/2,s/2, s*0.23, 0, Math.PI*2); ctx.fill();
  }
  ctx.fillStyle = "#141018";
  ctx.font = "bold 90px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(num), s/2, s/2+4);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------------------------------------------------------
   BALLS — semi-transparent glass/mirror spheres + white cue ball
--------------------------------------------------------------- */
const ballGeo = new THREE.SphereGeometry(BALL_R, 48, 48);
const balls = []; // {mesh, pos:Vector2, vel:Vector2, sunk, sinking, isCue}

function addBall(num, isCue=false){
  let mat;
  if(isCue){
    mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.08,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      transmission: 0.06,
      thickness: 0.4,
      envMapIntensity: 1.4,
    });
  } else {
    mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(BALL_COLORS[num]),
      map: makeBallTexture(num),
      roughness: 0.05,
      metalness: 0.0,
      transmission: 0.82,
      thickness: 0.9,
      ior: 1.45,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.6,
      attenuationColor: new THREE.Color(BALL_COLORS[num]),
      attenuationDistance: 0.6,
    });
  }
  const mesh = new THREE.Mesh(ballGeo, mat);
  mesh.position.y = BALL_R;
  scene.add(mesh);
  const b = {
    mesh,
    pos: new THREE.Vector2(0,0),
    vel: new THREE.Vector2(0,0),
    spin: new THREE.Vector3((Math.random()-0.5),(Math.random()-0.5),(Math.random()-0.5)),
    sunk:false, sinking:false, sinkT:0, num, isCue
  };
  balls.push(b);
  return b;
}

/* nine-ball diamond rack, apex on the foot spot (accurate standard geometry:
   apex 1/4 of the table length from the foot rail), centred on x=0 */
const rackOrder = [1,2,3,4,9,5,6,7,8]; // 9 goes to the centre slot
const rackPositions = [];
const APEX_Z = HALF_Z * 0.5; // foot spot
{
  const spacing = BALL_R*2 + 0.01; // balls racked touching, small tolerance
  const rows = [1,2,3,2,1];
  rows.forEach((count,row)=>{
    const z = APEX_Z + row*spacing*0.8660254; // sqrt(3)/2 row pitch for a tight triangle
    const rowWidth = (count-1)*spacing;
    for(let i=0;i<count;i++){
      const x = -rowWidth/2 + i*spacing;
      rackPositions.push(new THREE.Vector2(x,z));
    }
  });
}

rackOrder.forEach((num,i)=>{
  const b = addBall(num,false);
  b.pos.copy(rackPositions[i]);
});

const cue = addBall(0,true);

/* ---------------------------------------------------------------
   DIALOGUE STARS — 太陽のまわりを公転する5つのガラス玉の惑星(クリックでセリフ表示)
--------------------------------------------------------------- */
const SUN_POS = new THREE.Vector3(0, 15, 0); // テーブル中心(x=0, z=0)の真上

const DIALOGUE_STARS = [
  // 水星風・金星風・地球風・火星風・土星風、の太陽系カラーで内側から外側へ
  { texts: ['（ここにセリフ1）', '（ここにセリフ1-b）'], color: '#a3a3a3', orbitRadius: 4.5,  orbitSpeed: 0.30, tilt: 0.10 },
  { texts: ['The Ocean Full of Bowling Balls'],                        color: '#e7cf9e', orbitRadius: 6.5,  orbitSpeed: 0.23, tilt: 0.16 },
  { texts: ['（ここにセリフ3）', '（ここにセリフ3-b）'], color: '#4f92d6', orbitRadius: 8.6,  orbitSpeed: 0.18, tilt: 0.20 },
  { texts: ['（ここにセリフ4）'],                        color: '#d18d78', orbitRadius: 10.6, orbitSpeed: 0.14, tilt: 0.14 },
  { texts: ['（ここにセリフ5）', '（ここにセリフ5-b）'], color: '#e0c073', orbitRadius: 12.8, orbitSpeed: 0.10, tilt: 0.24 },
];

// 淡い発光グロー用テクスチャ(色を指定できる汎用版)。ブルームが無い分の光を補う
function buildGlowTexture(rgb){
  const s = 128;
  const c = document.createElement("canvas");
  c.width = s; c.height = s;
  const ctx = c.getContext("2d");
  const rg = ctx.createRadialGradient(s/2,s/2,0, s/2,s/2, s/2);
  rg.addColorStop(0.0, `rgba(${rgb},0.9)`);
  rg.addColorStop(0.4, `rgba(${rgb},0.4)`);
  rg.addColorStop(1.0, `rgba(${rgb},0.0)`);
  ctx.fillStyle = rg;
  ctx.fillRect(0,0,s,s);
  return new THREE.CanvasTexture(c);
}
const planetGlowTex = buildGlowTexture('225,235,255');
const sunGlowTex = buildGlowTexture('255,205,130');

// 太陽(中心の発光球。クリック対象ではない演出のみ)
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(1.9, 24, 24),
  new THREE.MeshBasicMaterial({ color: 0xff401f })
);
sun.position.copy(SUN_POS);
const sunCorona = new THREE.Sprite(new THREE.SpriteMaterial({
  map: sunGlowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
}));
sunCorona.scale.set(8, 8, 1);
sun.add(sunCorona);
const sunLight = new THREE.PointLight(0xffdca8, 14, 50, 2);
sun.add(sunLight);
scene.add(sun);

const planetGeo = new THREE.SphereGeometry(1.0, 32, 32);
const dialogueStars = DIALOGUE_STARS.map((d, i) => {
  // ガラス玉のような透過素材(太陽光を受けて光る)
  const star = new THREE.Mesh(planetGeo, new THREE.MeshPhysicalMaterial({
    color: d.color,
    transmission: 1,
    thickness: 1.3,
    roughness: 0.06,
    metalness: 0,
    ior: 1.45,
    emissive: d.color,
    emissiveIntensity: 0.4,
    transparent: true,
  }));
  star.userData.texts = d.texts;
  star.userData.spin = 0.06 + Math.random() * 0.05;
  star.userData.orbitRadius = d.orbitRadius;
  star.userData.orbitSpeed = d.orbitSpeed;
  star.userData.tilt = d.tilt;
  star.userData.angle = i * (Math.PI * 2 / DIALOGUE_STARS.length);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: planetGlowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.set(3.2, 3.2, 1);
  star.add(glow); // 星が非表示になればグローも一緒に消える

  scene.add(star);
  return star;
});

let activeDialogueStar = null;
let dialogueStarTimer = null;
const dialogueStarOffset = new THREE.Vector3(0, 1.4, 0);

function showDialogueStar(text, starMesh) {
  if (activeDialogueStar && activeDialogueStar !== starMesh) activeDialogueStar.visible = true;
  starDialogueEl.textContent = text;
  starDialogueEl.classList.add('show');
  activeDialogueStar = starMesh || null;
  if (activeDialogueStar) activeDialogueStar.visible = false; // 星を消してそこにセリフを表示する
  updateDialogueStarPosition();
  clearTimeout(dialogueStarTimer);
  dialogueStarTimer = setTimeout(() => {
    starDialogueEl.classList.remove('show');
    if (activeDialogueStar) activeDialogueStar.visible = true; // セリフが終わったら星を戻す
    activeDialogueStar = null;
  }, 10000);
}

function updateDialogueStarPosition() {
  if (!activeDialogueStar) return;
  const v = activeDialogueStar.position.clone().add(dialogueStarOffset).project(camera);
  starDialogueEl.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
  starDialogueEl.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
}
const HEAD_Z = -HALF_Z * 0.55; // head spot, behind the head string

/* accurate straight break: cue ball on the centre line at the head spot,
   struck dead-centre into the apex ball — a real, powerful break shot */
function setupBreakShot(speed){
  const apex = balls[0]; // ball #1 is rack index 0 == apex
  cue.pos.set(0, HEAD_Z);
  const dir = apex.pos.clone().sub(cue.pos).normalize();
  cue.vel.copy(dir.multiplyScalar(speed));
}

/* ---------------------------------------------------------------
   PHYSICS SIM (runs once for the break, then settles)
--------------------------------------------------------------- */
let simActive = false;
let simSettleTimer = 0;
let firstImpactDone = false;
const FRICTION = 0.24;   // lighter drag so balls keep rebounding off the rails
const RESTITUTION = 0.92; // lively rail bounces, easy to see the wall collisions at work
const STOP_EPS = 0.02;
const REST_EPS = 0.045;   // below this speed a ball is treated as fully at rest —
                           // stops the endless tiny impulse/overlap jitter that used
                           // to keep the settled rack "breathing" forever

function resetBallVisualPositions(){
  balls.forEach(b=>{
    b.sunk=false; b.sinking=false; b.sinkT=0;
    b.mesh.visible = true;
    b.mesh.scale.setScalar(1);
    b.mesh.position.set(b.pos.x, BALL_R, b.pos.y);
  });
}

function startBreak(){
  // reset positions
  rackOrder.forEach((num,i)=>{ balls[i].pos.copy(rackPositions[i]); });
  setupBreakShot(17.5); // a real break-shot speed
  resetBallVisualPositions();
  waterUniforms.uRippleStart.value = -999;   // fires on first contact, not now
  waterUniforms.uSplashStart.value = -999;
  firstImpactDone = false;
  simActive = true;
  simSettleTimer = 0;
  hint.style.opacity = "1";
}

function resolvePocket(b, dt){
  for(const c of pockets){
    const d = b.pos.distanceTo(c);
    if(d < POCKET_R + BALL_R*0.4 && !b.sunk && !b.sinking){
      // gentle suction as it nears the pocket
      const pull = c.clone().sub(b.pos).normalize().multiplyScalar(4.5*dt);
      b.vel.add(pull);
    }
    if(d < POCKET_CAPTURE && !b.sunk && !b.sinking){
      b.sinking = true;
      b.sinkT = 0;
      // every pocket splashes where the ball actually went in
      waterUniforms.uSplashStart.value = clock.elapsedTime;
      waterUniforms.uSplashOrigin.value.copy(c);
      return;
    }
  }
}

function stepPhysics(dt){
  const sub = 8; // more substeps needed at break-shot speeds to avoid tunnelling
  const sdt = dt/sub;
  for(let s=0;s<sub;s++){
    balls.forEach(b=>{
      if(b.sunk || b.sinking) return;
      b.pos.addScaledVector(b.vel, sdt);

      // wall bounce against the rectangular rails (skip near a pocket mouth)
      const nearPocket = pockets.some(c=>b.pos.distanceTo(c) < POCKET_R+BALL_R);
      if(!nearPocket){
        if(b.pos.x >  HALF_X-BALL_R){ b.pos.x =  HALF_X-BALL_R; b.vel.x *= -RESTITUTION; }
        if(b.pos.x < -HALF_X+BALL_R){ b.pos.x = -HALF_X+BALL_R; b.vel.x *= -RESTITUTION; }
        if(b.pos.y >  HALF_Z-BALL_R){ b.pos.y =  HALF_Z-BALL_R; b.vel.y *= -RESTITUTION; }
        if(b.pos.y < -HALF_Z+BALL_R){ b.pos.y = -HALF_Z+BALL_R; b.vel.y *= -RESTITUTION; }
      }
    });

    // pairwise collisions
    for(let i=0;i<balls.length;i++){
      const a = balls[i];
      if(a.sunk||a.sinking) continue;
      for(let j=i+1;j<balls.length;j++){
        const b = balls[j];
        if(b.sunk||b.sinking) continue;
        const delta = b.pos.clone().sub(a.pos);
        const dist = delta.length();
        const minDist = BALL_R*2;
        // two balls that are both essentially at rest need no correction —
        // this is what kept the racked balls "breathing" before contact
        const bothResting = a.vel.lengthSq() < REST_EPS*REST_EPS && b.vel.lengthSq() < REST_EPS*REST_EPS;
        if(!bothResting && dist>0 && dist < minDist){
          const n = delta.multiplyScalar(1/dist);
          const overlap = (minDist-dist)/2;
          a.pos.addScaledVector(n,-overlap);
          b.pos.addScaledVector(n, overlap);
          const rv = b.vel.clone().sub(a.vel);
          const velAlongNormal = rv.dot(n);
          if(velAlongNormal < 0){
            const impulse = n.clone().multiplyScalar(velAlongNormal);
            a.vel.add(impulse);
            b.vel.sub(impulse);

            // fire the pocket-portal ripple the instant the cue ball
            // actually strikes the rack — not at the moment the shot starts
            if(!firstImpactDone && (a.isCue || b.isCue)){
              firstImpactDone = true;
              waterUniforms.uRippleStart.value = clock.elapsedTime;
              waterUniforms.uRippleOrigin.value.copy(TARGET_POCKET);
            }
          }
        }
      }
    }

    // friction (light — this is a break shot, balls should keep travelling
    // and bouncing off the rails rather than settle immediately)
    const damp = Math.pow(1-FRICTION, sdt);
    balls.forEach(b=>{
      if(b.sunk || b.sinking) return;
      b.vel.multiplyScalar(damp);
      // snap tiny residual velocity to true zero so resting balls stop
      // exchanging micro-impulses and actually come to rest
      if(b.vel.lengthSq() < REST_EPS*REST_EPS*0.25) b.vel.set(0,0);
    });
  }

  balls.forEach(b=>{ if(!b.sunk && !b.sinking) resolvePocket(b, dt); });
}

function updateSinking(dt){
  balls.forEach(b=>{
    if(b.sinking && !b.sunk){
      b.sinkT += dt;
      const t = Math.min(b.sinkT/0.7, 1);
      b.mesh.position.y = BALL_R - t*0.9;
      b.mesh.scale.setScalar(1-t*0.9);
      const c = pockets.reduce((best,c)=> b.pos.distanceTo(c) < b.pos.distanceTo(best)?c:best, pockets[0]);
      b.pos.lerp(c, 0.06);
      if(t>=1){ b.sunk=true; b.sinking=false; b.mesh.visible=false; }
    }
  });
}

function syncMeshes(dt){
  balls.forEach(b=>{
    if(b.sunk) return;
    if(!b.sinking) b.mesh.position.set(b.pos.x, BALL_R, b.pos.y);
    if(!b.isCue){
      b.mesh.rotation.x += b.spin.x*dt*b.vel.length()*1.4;
      b.mesh.rotation.z += b.spin.z*dt*b.vel.length()*1.4;
    } else {
      b.mesh.rotation.x += b.vel.y*dt*1.6;
      b.mesh.rotation.z -= b.vel.x*dt*1.6;
    }
  });
}

/* ---------------------------------------------------------------
   MAIN LOOP
--------------------------------------------------------------- */
const clock = new THREE.Clock();
replayBtn.addEventListener("click", startBreak);

/* ---------------------------------------------------------------
   INTERACTION — 星のクリック(セリフ表示) / ポケットのホバー(作品名表示)
--------------------------------------------------------------- */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function setPointerFromEvent(e){
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

renderer.domElement.addEventListener('click', (e) => {
  setPointerFromEvent(e);
  const starHit = raycaster.intersectObjects(dialogueStars)[0];
  if (starHit) {
    const texts = starHit.object.userData.texts;
    const text = texts[Math.floor(Math.random() * texts.length)];
    showDialogueStar(text, starHit.object);
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  setPointerFromEvent(e);
  const hitAreas = pocketMeshes.map(p => p.hitArea);
  const pocketHit = raycaster.intersectObjects(hitAreas)[0];
  if (pocketHit) {
    const p = pocketMeshes.find(pm => pm.hitArea === pocketHit.object);
    pocketTooltipEl.textContent = p.workTitle;
    pocketTooltipEl.style.left = `${e.clientX}px`;
    pocketTooltipEl.style.top = `${e.clientY}px`;
    pocketTooltipEl.classList.add('show');
    renderer.domElement.style.cursor = 'default';
  } else {
    pocketTooltipEl.classList.remove('show');
  }
});

function loop(){
  rafId = requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.033);
  const t = clock.elapsedTime;

  waterUniforms.uTime.value = t;
  waterUniforms.uCamPos.value.copy(camera.position);

  if(simActive){
    stepPhysics(dt);
    updateSinking(dt);
    syncMeshes(dt);
    const totalSpeed = balls.reduce((s,b)=> s + (b.sunk?0:b.vel.length()), 0);
    if(totalSpeed < STOP_EPS){
      simSettleTimer += dt;
      if(simSettleTimer > 1.0){
        simActive = false;
        hint.style.opacity = "0";
      }
    } else {
      simSettleTimer = 0;
    }
  }

  dialogueStars.forEach(p => {
    if (!p.visible) return; // セリフ表示中の星は公転を止め、消えた場所を維持する
    p.rotation.y += dt * p.userData.spin;
    p.userData.angle += dt * p.userData.orbitSpeed;
    const a = p.userData.angle;
    p.position.set(
      SUN_POS.x + p.userData.orbitRadius * Math.cos(a),
      SUN_POS.y + p.userData.tilt * Math.sin(a),
      SUN_POS.z + p.userData.orbitRadius * Math.sin(a)
    );
  });
  updateDialogueStarPosition();

  pocketMeshes.forEach(p=>{
    const pulse = Math.sin(t*1.1 + p.pos.x) * 0.5 + 0.5;
    p.light.intensity = (p.isTarget ? 9 : 5) + pulse * (p.isTarget ? 2.0 : 1.0);
    const baseOpacity = p.isTarget ? 1.0 : 0.75;
    p.glow.material.opacity = Math.min(1, baseOpacity + pulse * 0.1);
    p.core.material.opacity = Math.min(1, (p.isTarget ? 1.0 : 0.9) + pulse * 0.1);
  });

  controls.update();
  renderer.render(scene, camera);
}

  function show() {
    overlay.classList.add('show');
    startBreak();
    if (!rafId) loop();
  }

  function hide() {
    overlay.classList.remove('show');
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    clearTimeout(dialogueStarTimer);
    starDialogueEl.classList.remove('show');
    if (activeDialogueStar) { activeDialogueStar.visible = true; activeDialogueStar = null; }
    pocketTooltipEl.classList.remove('show');
  }

  closeBtn.addEventListener('click', () => {
    hide();
    if (onClose) onClose();
  });

  return { show, hide, isVisible: () => overlay.classList.contains('show') };
}
