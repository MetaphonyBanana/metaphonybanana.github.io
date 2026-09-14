import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HOME_CAMERA_POS, HOME_CAMERA_TARGET, AXIS_LENGTH } from './config.js';
import { TRIPOD_ANGULAR_SPEED } from './universe.js';
import { FINAL_ORBIT_RADIUS, ORBIT_RADIUS_BASE, setOrbitRadius, setOrbitCenter, growOrbitToFull } from './solarSystem.js';
import { GALAXY_RADIUS } from './galaxy.js';
import { createCaptionBox, makeCaptionController } from './captions.js';

// ══════════════════════════════════════════════════════════════
// ── 「レコードプレーヤー(操作パネル)」演出 ───────────────────
// ══════════════════════════════════════════════════════════════
//
// 仕様(ご指示より):
//   1) カメラの背後に、鏡素材の三角錐(頂点の高さ・底面の外接円半径は既存tripod=universe.jsの
//      ものと同じ式を流用。底面は正三角形)を置く。頂点にバナナを乗せる。カメラの位置は常に
//      固定(pan/zoom無効。回転=見回すことだけできる)。
//   2) スクロールでtripod/リング/鏡tripodの入れ替え演出を進める(下スクロール=鏡側へ、
//      上スクロール=元に戻る)。
//      ★ 2026-09-11時点の実装: カメラのposition・向き(OrbitControlsのtarget)は、この演出
//      が続く間ずっと一切動かさない(UNIVERSE_CAMERA_TARGET/POSに固定したまま)。以前は
//      controls.targetをスクロール量に応じてUNIVERSE_CAMERA_TARGET⇔鏡(mirrorLookTarget)
//      の間で補間していたが、それが原因で入れ替え完了後もカメラが動き続け、背景の銀河まで
//      一緒に動いてしまうバグがあった。見た目の変化は、カメラ側ではなくtripodRingSwap.js側で
//      tripod・リング・鏡tripod自体の位置を動かすことだけで表現する。
//   3) 鏡三角錐は、carousel側のtripod(universe.js)と「回転周期・位置を共有」する。
//   4) 鏡クリック → 別ページ(prism.html)へ遷移。
//
// ★ 2026-09-11時点の設計変更(ご指示より):
//   銀河は「先に巨大に表示させておき、右ドラッグで俯瞰後、スクロールで縮小させる」という
//   新しい流れに変わったため、以前あった
//     5) バナナクリックで銀河出現をスクロールで操作できるようにする(galaxy-scrub)
//     6) 銀河クリックで針(needle)が出現し、中心へ向かう
//     7) 針が規定位置に到達したら太陽系(solarSystem)を召喚する
//   の3つはこのファイルの責務ではなくなった。5)は「それ以外の銀河の動き」として削除し、
//   6)7)(針+太陽軌道・太陽系軌道の召喚)は今後の再利用に備えてコメントアウトのみ
//   (削除はしていない)にしてある。右ドラッグ→俯瞰→スクロールでの銀河縮小そのものは
//   別途(main.js側などで)実装される想定。
//
// TRIPOD_*まわりの数値(角度・長さ)はuniverse.jsのものをそのままコピーしている
// (「コピーでよい」とのご指示のため。値を変える場合は両方直す必要がある点に注意)。

// ── 鏡の三角錐(頂点位置の式のみ、コピー元: universe.js) ──────────
const TRIPOD_ANGLE_FROM_VERTICAL_DEG = 54.7356;
const TRIPOD_ANGLE_FROM_VERTICAL = THREE.MathUtils.degToRad(TRIPOD_ANGLE_FROM_VERTICAL_DEG);
const MIRROR_TRIPOD_RADIUS = AXIS_LENGTH * Math.sin(TRIPOD_ANGLE_FROM_VERTICAL); // 底面(正三角形)の外接円半径(=既存tripodの終端3点と同じ式)
export const MIRROR_APEX_HEIGHT = AXIS_LENGTH * Math.cos(TRIPOD_ANGLE_FROM_VERTICAL); // 頂点の高さ(=既存tripodと同じ式。tripodRingSwap.js側がring Bの高さ計算に使うためexport)
const MIRROR_ENV_RESOLUTION = 256;                     // キューブカメラの解像度(仮値。重ければ下げる)
// cubeCameraをmirrorVisualAnchor.positionからどれだけ上にオフセットして置くか(=ピラミッドの
// だいたい中間の高さに撮影点を置くため。仮値)。createRecordDisplay内での初期配置と、
// updateRecordDisplay内での毎フレーム追従の両方で同じ値を使う。
const CUBE_CAMERA_Y_OFFSET = MIRROR_APEX_HEIGHT * 0.5;
const _cubeCameraOffset = new THREE.Vector3(0, CUBE_CAMERA_Y_OFFSET, 0); // 毎フレームのnew Vector3()を避けるための使い回し用
const MIRROR_TARGET_PAGE = 'prism2.html';               // 鏡クリックで遷移する先
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// ── 頂点のバナナ(コピー元: galaxy.js のmakeBananaMesh) ────────────
const BANANA_RADIUS = 1.2;
const BANANA_HIT_RADIUS = 2.6;
export const BANANA_HEIGHT_ABOVE_APEX = AXIS_LENGTH * 0.15; // 頂点よりさらに少し上に乗せる(仮値)

// ══════════════════════════════════════════════════════════════
// ▼▼▼ バナナクリック演出: ①戴冠 → ②バルジ+針+太陽出現 → ③銀河高速回転で中心へ
//     → ④金のリングに接触で太陽系(8惑星)出現 ▼▼▼
// ══════════════════════════════════════════════════════════════

// ── GLBローダー(banana.glb / crown.glb は record.js と同じ階層のdata/配下に置く想定) ──
// ★ import.meta.urlを基準にすることで、index.html(ページ)がどの階層にあっても
//   record.js自身から見た相対位置(js/data/...)で正しく解決されるようにしてある。
//   単なる文字列('./data/banana.glb'など)をそのままGLTFLoader.load()に渡すと、
//   fetch系のURL解決はスクリプトの場所ではなく「ページ(index.html)の場所」基準に
//   なってしまうため、index.htmlと同じ階層に置いたファイルしか見つからない、という
//   問題が起きる(実際に報告があった不具合の原因)。
const BANANA_GLB_PATH = new URL('./data/banana.glb', import.meta.url).href;
const CROWN_GLB_PATH = new URL('./data/crown.glb', import.meta.url).href;
const gltfLoader = new GLTFLoader();

function loadGLTFScene(path) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(path, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

// ── ①戴冠(5秒): crown.glbがバナナの上空からtweenで落下し、着地する ─────
const CORONATION_TEXT = 'I wanted to speak between any two points by way of a foolish circle!\n― Metaphony';
const CORONATION_DURATION = 10.0;             // ①戴冠にかける秒数
const CROWN_DROP_START_HEIGHT = AXIS_LENGTH * 0.6; // バナナの上、どれだけ高い位置から降ってくるか(仮値)
const CROWN_SCALE = 0.2; // 仮値。実際のcrown.glbのサイズを見て調整してください
let coronationCaption = null; // 遅延生成(#axisHint等とは別の、画面下75%専用の要素)

function getCoronationCaption() {
  if (!coronationCaption) {
    // captions.jsのcreateCaptionBoxを流用。画面下75%・水平中央に固定。
    coronationCaption = makeCaptionController(createCaptionBox({ leftPercent: 50, topPercent: 75 }));
  }
  return coronationCaption;
}

// ── ②バルジ(棒状バー+コア)。galaxy.jsの本体バルジと同じ
//    bar_bulge_preview.html由来の形状をそのまま流用し、AXIS_LENGTH基準の
//    ごく小さいスケールでバナナのあった位置(mirrorVisualAnchorの頂点)に
//    出す。galaxy.js側は「銀河本体に常設された巨大なバー」だが、こちらは
//    「戴冠演出の一場面としてバナナの代わりに一瞬現れる小さな echo」という
//    位置づけの別インスタンス(スケールも文脈も違うため、galaxy.js側の
//    定数をそのまま使い回さず、AXIS_LENGTH基準の値をここで別途持つ)。 ──
const BULGE_REVEAL_FADE_DURATION = 3.0;   // ②バナナ消滅+バルジ出現にかける秒数(ご指示通り3秒)
// ★ バナナが完全に消えたのを見せてからバルジが出始めるように、両者の間に
//   ごく短い間(ま)を置く。0にすると従来通り「消滅と同時にフェード開始」に戻る。
const BANANA_TO_BULGE_GAP = 0.4; // 仮値(秒)。「消滅→(間)→出現」を感じさせる程度の長さ
const BULGE_PARTICLE_COUNT = 1800;        // 仮値。分布を密にするため700→1800に増量
const BULGE_BAR_HALF_LENGTH = AXIS_LENGTH * 0.05; // 仮値。頂点に乗る程度の小ささ
const BULGE_BAR_HALF_WIDTH  = BULGE_BAR_HALF_LENGTH * 0.32;
const BULGE_BAR_HALF_HEIGHT = BULGE_BAR_HALF_LENGTH * 0.22;
const BULGE_BAR_TILT = THREE.MathUtils.degToRad(25); // 仮値(galaxy.js側のBAR_TILT_DEGと同じ角度)
// ★ ご指示により、galaxy.js側にあった「元の」バー+コア分布の式(1.8で一様寄りに)へ戻した。
//   以前ここは境界ぼかし(BULGE_EDGE_BLUR)とセットで2.3まで強めていたが、その調整は撤去。
const BULGE_BAR_CONCENTRATION_POWER = 1.8;  // 1.0で一様分布、大きいほど中心へ偏る(galaxy.js側の元の値)
const BULGE_BAR_COLOR = 0xf4e04d;           // バナナと同じ色
const BULGE_CORE_FRACTION = 0.18;           // BULGE_PARTICLE_COUNTのうちコアに割り当てる割合(仮値)
const BULGE_CORE_RADIUS_RATIO = 0.22;       // コア半径 = BULGE_BAR_HALF_LENGTH × この比率(仮値)
const BULGE_CORE_CONCENTRATION_POWER = 2.6; // コアはバーより強めに中心へ偏らせる(仮値。galaxy.js側と同じ値)
const BULGE_CORE_COLOR = 0xfff6c9;          // バー本体よりやや明るい白味がかった黄色(仮値)

// concentrationPower: 1.0で一様分布、大きいほど中心(r=0)寄りに偏る。tiltはバーの
// 長軸をY軸まわりにどれだけ傾けるか(コアは呼び出し側でtilt=0を渡して球形にする)。
// ★ galaxy.js側の元の式そのまま(境界ぼかしの裾は付けず、r∈[0,1]でそのまま打ち切る)。
function sampleBulgeEllipsoidPosition(halfLength, halfWidth, halfHeight, concentrationPower, tilt) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = Math.pow(Math.random(), (1 / 3) * concentrationPower);

  const x0 = r * Math.sin(phi) * Math.cos(theta) * halfLength;
  const y0 = r * Math.cos(phi) * halfHeight;
  const z0 = r * Math.sin(phi) * Math.sin(theta) * halfWidth;

  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);
  const x = x0 * cosT - z0 * sinT;
  const z = x0 * sinT + z0 * cosT;

  return { x, y: y0, z };
}

function sampleBulgeBarPosition() {
  return sampleBulgeEllipsoidPosition(
    BULGE_BAR_HALF_LENGTH, BULGE_BAR_HALF_WIDTH, BULGE_BAR_HALF_HEIGHT,
    BULGE_BAR_CONCENTRATION_POWER, BULGE_BAR_TILT
  );
}

function sampleBulgeCorePosition() {
  const coreRadius = BULGE_BAR_HALF_LENGTH * BULGE_CORE_RADIUS_RATIO;
  // コアはほぼ球形(バーほど扁平にしない)。傾き付与は不要なので直接生成する。
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = Math.pow(Math.random(), (1 / 3) * BULGE_CORE_CONCENTRATION_POWER) * coreRadius;
  return {
    x: r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.cos(phi) * 0.85, // ほんの少しだけ扁平(仮値)
    z: r * Math.sin(phi) * Math.sin(theta),
  };
}

function makeBulgePlaceholder() {
  // バー本体とコアを別のPointsにして、色・粒の大きさを分けて重ねる
  // (galaxy.js本体のバルジと同じ考え方)。フェード演出(startBulgeAndNeedle)
  // が両方まとめて透明度を操作できるよう、group.userData.materialsに
  // 両方のPointsMaterialをまとめておく。
  const coreCount = Math.floor(BULGE_PARTICLE_COUNT * BULGE_CORE_FRACTION);
  const barCount = BULGE_PARTICLE_COUNT - coreCount;

  const barPositions = new Float32Array(barCount * 3);
  for (let i = 0; i < barCount; i++) {
    const p = sampleBulgeBarPosition();
    barPositions[i * 3] = p.x;
    barPositions[i * 3 + 1] = p.y;
    barPositions[i * 3 + 2] = p.z;
  }
  const barGeo = new THREE.BufferGeometry();
  barGeo.setAttribute('position', new THREE.BufferAttribute(barPositions, 3));
  const barMat = new THREE.PointsMaterial({
    color: BULGE_BAR_COLOR,
    size: BULGE_BAR_HALF_LENGTH * 0.12,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const barPoints = new THREE.Points(barGeo, barMat);

  const corePositions = new Float32Array(coreCount * 3);
  for (let i = 0; i < coreCount; i++) {
    const p = sampleBulgeCorePosition();
    corePositions[i * 3] = p.x;
    corePositions[i * 3 + 1] = p.y;
    corePositions[i * 3 + 2] = p.z;
  }
  const coreGeo = new THREE.BufferGeometry();
  coreGeo.setAttribute('position', new THREE.BufferAttribute(corePositions, 3));
  const coreMat = new THREE.PointsMaterial({
    color: BULGE_CORE_COLOR,
    size: BULGE_BAR_HALF_LENGTH * 0.09, // バーより粒は小さく、密集させて「光の塊」に見せる(仮値)
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const corePoints = new THREE.Points(coreGeo, coreMat);

  const group = new THREE.Group();
  group.add(barPoints, corePoints);
  group.visible = false;
  group.userData.materials = [barMat, coreMat];
  return group;
}

// ══════════════════════════════════════════════════════════════
// ▼▼▼ ①戴冠 → ②バルジ+針+太陽出現 → ③銀河高速回転で中心へ
//     → ④金のリングに接触で太陽系(8惑星)出現 ▼▼▼
// ══════════════════════════════════════════════════════════════
const NEEDLE_DIR = new THREE.Vector3(1, 0, 0);          // 「右」= ワールド+X(固定。見た目を見て調整可)
const NEEDLE_RADIUS = AXIS_LENGTH * 0.05;               // 「巨大に太く」の反映(仮値)
const NEEDLE_ARM_LENGTH = AXIS_LENGTH * 3;              // 横棒の長さ(仮値)
const NEEDLE_DROP_HEIGHT = AXIS_LENGTH * 1.2;           // 縦棒の長さ=肘から接地点までの高さ(仮値)
const NEEDLE_COLOR = 0xd9d9d9;                          // 針の色(仮値。金属っぽいグレー)
const NEEDLE_START_RADIUS = GALAXY_RADIUS * 0.94;       // 針先(=太陽の出発点)。「銀河の周縁側」(仮値)
// ★ 2026-09-12 変更: 以前は固定の終端半径(FINAL_ORBIT_RADIUS)まで一定時間で進める
//   設計だったが、「金のリングに(実際に)触れたら」という接触判定に変更した。
//   NEEDLE_MIN_RADIUSは「万一リングに接触しないまま進んでしまった場合の安全な下限」
//   (tweenの目標値そのもの。通常はこれより先にリング接触で早期終了する)。
//   RING_CONTACT_RADIUSは「太陽がリングに触れたとみなす半径」。universe.js側の
//   ゴールドリングの実寸がわかったら、その値に合わせて調整してください
//   (今はsolarSystem.jsのORBIT_RADIUS_BASE=リングが表す主軌道半径、を仮に採用)。
const NEEDLE_MIN_RADIUS = FINAL_ORBIT_RADIUS * 0.5;     // 安全下限(仮値)
const RING_CONTACT_RADIUS = ORBIT_RADIUS_BASE;          // リング接触とみなす半径(仮値。ゴールドリングの実寸に合わせて調整)
const NEEDLE_DRAW_DURATION = 24.0;                      // 「太陽の中心へ向かう速度はかなり遅く」の反映(仮値)
const NEEDLE_DRAW_EASE = 'power1.inOut';
const GROOVE_FADE_OUT_DURATION = 1.5; // 「太陽系の軌道が始まったらフェードアウト」の反映(仮値)
const SOLAR_SYSTEM_GROW_DURATION = 3.2; // ④太陽系がリング半径から本来の大きさへ広がる秒数(仮値)

const GROOVE_COLOR = 0xffee66;    // 既存のtrailLinesと同じ黄色
const GROOVE_MAX_POINTS = 4000;   // 仮値。針の描画秒数に対して十分な点数

function makeNeedleMesh() {
  const mat = new THREE.MeshBasicMaterial({ color: NEEDLE_COLOR, transparent: true, opacity: 0 });
  const armGeo = new THREE.CylinderGeometry(NEEDLE_RADIUS, NEEDLE_RADIUS, NEEDLE_ARM_LENGTH, 12);
  const armMesh = new THREE.Mesh(armGeo, mat);
  armMesh.rotation.z = Math.PI / 2;
  armMesh.position.set(NEEDLE_ARM_LENGTH / 2, NEEDLE_DROP_HEIGHT, 0);
  const dropGeo = new THREE.CylinderGeometry(NEEDLE_RADIUS, NEEDLE_RADIUS, NEEDLE_DROP_HEIGHT, 12);
  const dropMesh = new THREE.Mesh(dropGeo, mat);
  dropMesh.position.set(0, NEEDLE_DROP_HEIGHT / 2, 0);
  const group = new THREE.Group();
  group.add(armMesh, dropMesh);
  group.visible = false;
  group.userData.material = mat;
  return group;
}

function positionNeedleAt(needleGroup, center, radius) {
  const tip = center.clone().addScaledVector(NEEDLE_DIR, radius);
  needleGroup.position.copy(tip);
  return tip;
}

function makeGrooveLine() {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(GROOVE_MAX_POINTS * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({ color: GROOVE_COLOR, transparent: true, opacity: 1 });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  return { line, positions, count: 0 };
}

function resetGroove(groove) {
  groove.count = 0;
  groove.line.geometry.setDrawRange(0, 0);
  groove.line.material.opacity = 1;
}

function appendGroovePoint(groove, localPoint) {
  if (groove.count >= GROOVE_MAX_POINTS) return;
  const i = groove.count * 3;
  groove.positions[i] = localPoint.x;
  groove.positions[i + 1] = localPoint.y;
  groove.positions[i + 2] = localPoint.z;
  groove.count += 1;
  groove.line.geometry.setDrawRange(0, groove.count);
  groove.line.geometry.attributes.position.needsUpdate = true;
}

// ゴールドリング(universe.goldenRing)の「半径」との接触判定用。リングの現在位置は
// tripodRingSwap.js側でY(高さ)が動かされているだけで、中心は原点(XZ)のはずなので、
// ここでは「太陽の現在半径(=galaxyCenterからのXZ距離)」がRING_CONTACT_RADIUS以下に
// なったかどうかだけを見ればよい(リングのYは見ない=真上から見た接触判定)。
function hasTouchedGoldenRing(currentRadius) {
  return currentRadius <= RING_CONTACT_RADIUS;
}

// ③④本編: 銀河周縁から針(+太陽・溝)を出し、金のリングに接触したら太陽系を召喚する。
function playNeedleSequence(record) {
  const { needle, groove, galaxy, solarSystem, galaxyCenter } = record;
  galaxy.needleSpinActive = true; // ③銀河が高速回転を始める(galaxy.js側で速度が切り替わる)
  needle.visible = true;
  needle.userData.material.opacity = 1;
  resetGroove(groove);
  groove.line.visible = true;
  positionNeedleAt(needle, galaxyCenter, NEEDLE_START_RADIUS);

  const tweenState = { radius: NEEDLE_START_RADIUS };
  const tween = gsap.to(tweenState, {
    radius: NEEDLE_MIN_RADIUS, // 通常はここまで到達する前にリング接触で早期終了する(下記onUpdate参照)
    duration: NEEDLE_DRAW_DURATION,
    ease: NEEDLE_DRAW_EASE,
    onUpdate: () => {
      const tipWorld = positionNeedleAt(needle, galaxyCenter, tweenState.radius);
      const local = galaxy.starsGroup.worldToLocal(tipWorld.clone());
      appendGroovePoint(groove, local);

      // ★ ④の接触判定: 毎フレーム、太陽(=針先)がゴールドリングの半径まで
      // 到達したかどうかを見る。到達したらtweenを打ち切り、太陽系を召喚する。
      if (hasTouchedGoldenRing(tweenState.radius)) {
        tween.kill();
        onRingContact(tweenState.radius);
      }
    },
    onComplete: () => {
      // 安全下限まで到達してしまった場合(通常は起きない想定)も、同じ処理で締める。
      onRingContact(tweenState.radius);
    },
  });

  function onRingContact(contactRadius) {
    // ▼ ④太陽系(8惑星)の召喚: リング接触時点の半径からスタートし、本来の大きさまで広がる。
    setOrbitCenter(solarSystem, galaxyCenter);
    setOrbitRadius(solarSystem, contactRadius);
    solarSystem.group.visible = true;
    solarSystem.sunTrailRecording = true; // 太陽自身の軌跡もこの瞬間から記録開始
    solarSystem.sunTrailLastRecorded = -Infinity;
    growOrbitToFull(solarSystem, { duration: SOLAR_SYSTEM_GROW_DURATION });
    // ▲ ここまで
    record.phase = 'done';
    galaxy.needleSpinActive = false; // 銀河の回転を通常速度へ戻す
    needle.visible = false;
    gsap.to(groove.line.material, {
      opacity: 0,
      duration: GROOVE_FADE_OUT_DURATION,
      onComplete: () => { groove.line.visible = false; },
    });
  }
}

// ①②本編: バナナクリックで最初に呼ぶ。戴冠(5秒)→バナナ消滅+バルジ出現(3秒)→playNeedleSequence。
function playCoronationSequence(record) {
  if (record.coronationStarted) return; // 二重発火防止
  record.coronationStarted = true;

  const { bananaMesh, crownGroup, bulge } = record;
  const caption = getCoronationCaption();

  // ① 戴冠(5秒): crown.glbをバナナの上空からtweenで落下させる(mirrorVisualAnchor内のローカル座標)。
  crownGroup.position.copy(bananaMesh.position).add(new THREE.Vector3(0, CROWN_DROP_START_HEIGHT, 0));
  crownGroup.visible = true;
  caption.setText(CORONATION_TEXT);

  gsap.to(crownGroup.position, {
    y: bananaMesh.position.y + BANANA_RADIUS * 0.6, // バナナの上に軽く乗る高さ(仮値)
    duration: CORONATION_DURATION,
    ease: 'bounce.out',
  });

  setTimeout(() => {
    caption.hide();
    startBulgeAndNeedle();
  }, CORONATION_DURATION * 1000);

  // ② バルジ+針+太陽出現(3秒でフェードイン)。バナナは消滅。
  //   ★ 「消滅→(間)→出現」に見えるよう、バナナを隠した直後ではなく
  //     BANANA_TO_BULGE_GAP秒だけ待ってからバルジのフェードインを開始する。
  function startBulgeAndNeedle() {
    bananaMesh.visible = false;
    crownGroup.visible = false; // 王冠もバナナと一緒に役目を終える(仮の挙動。残したい場合は消さない)

    bulge.userData.materials.forEach((m) => { m.opacity = 0; });

    setTimeout(() => {
      bulge.visible = true;
      // bulgeは今はバー+コアの2つのPointsを子に持つGroup。両方のopacityを
      // 同じ進行度から一斉に動かすため、単一のtween変数を経由させる
      // (バラバラのタイミングでフェードすると、コアだけ先に見えてしまう等
      // 不自然になるのを避けるため)。
      const bulgeFade = { t: 0 };
      gsap.to(bulgeFade, {
        t: 1,
        duration: BULGE_REVEAL_FADE_DURATION,
        onUpdate: () => {
          bulge.userData.materials.forEach((m) => { m.opacity = bulgeFade.t; });
        },
      });
    }, BANANA_TO_BULGE_GAP * 1000);

    setTimeout(() => {
      playNeedleSequence(record); // ③④
    }, (BANANA_TO_BULGE_GAP + BULGE_REVEAL_FADE_DURATION) * 1000);
  }
}
// ══════════════════════════════════════════════════════════════
// ▲▲▲ バナナクリック演出 ここまで ▲▲▲
// ══════════════════════════════════════════════════════════════

// ── スクロールによる画面切り替え(carousel⇄鏡) ─────────────
const SCROLL_SWITCH = 600;         // ここまでスクロールすると鏡側を向き切る(仮値。「切り替え方は適当でよい」ため単純な線形)
// 「最後になったら、下スクロールでカメラを引いてレコード全体が見えるように」の反映:
// phase==='done'到達後、さらにこのぶんスクロールするとカメラが引き切る(仮値)。
// ★ 現在、phase==='done'は針の演出(コメントアウト中)からしか到達しないため、
//   このpullback自体は当面発火しない「休眠状態」の仕組みになっている。針を復活させれば
//   そのまま機能する。
const SCROLL_PULLBACK_RANGE = 900;
export const SCROLL_MAX = SCROLL_SWITCH + SCROLL_PULLBACK_RANGE; // main.js側でスクロール量をこの範囲にクランプする
const VIEW_MIX_SMOOTHING = 4.0;    // カメラの向き変更(controls.target)を軽くスムージングする係数(仮値)

// ★ 銀河の「掴んでいた」演出パラメータ(GALAXY_READY_T等)は、銀河の動きそのものを
//   このファイルから削除したため不要になり撤去した。

const RECORD_PULLBACK_DISTANCE = 1; // 「レコード全体が見えるように」引く距離(仮値。カメラFOV次第で要調整。GALAXY_RADIUS依存の計算は撤去したため単純な定数に変更)
const PULLBACK_SMOOTHING = 3.0;    // カメラの引きをスムージングする係数(仮値)

// ── レコード(鏡三角錐)の自転速度 ─────────────────────────
const MIRROR_SPIN_SMOOTHING = 1.5;        // 倍率切り替えをスムージングする係数(仮値。カクツキ防止)
// ★ 以前は「'needle'フェーズ中は速く、galaxy.lapShrunk(太陽系1周後の銀河縮小完了)後は遅く」と
//   していたが、どちらも針・太陽系軌道側の状態なのでコメントアウトし、常に等倍にした。
// const MIRROR_SPIN_FAST_MULTIPLIER = 2.2;  // 'needle'フェーズ中の速度倍率(仮値)
// const MIRROR_SPIN_SLOW_MULTIPLIER = 0.35; // galaxy.lapShrunk(銀河の縮小完了)後の速度倍率(仮値)

// carouselのtripod(HOME_CAMERA_TARGET付近)とカメラの距離をそのまま流用し、カメラを挟んで
// 反対側に鏡三角錐を置く(ご指示「位置を共有させる」の反映: カメラからの距離を共有する)。
function computeMirrorGroupPosition() {
  const camToTripod = new THREE.Vector3().subVectors(HOME_CAMERA_TARGET, HOME_CAMERA_POS);
  const base = HOME_CAMERA_POS.clone().sub(camToTripod);
  base.y -= MIRROR_APEX_HEIGHT * 0.5; // 頂点がだいたいカメラの目の高さに来るよう少し下げる(仮値)
  return base;
}

// 「頂点だけ反映した三角錐、底面は正三角形」── ConeGeometryはradialSegments=3にすると
// そのまま正三角形を底面とする三角錐になる(底面の外接円半径=MIRROR_TRIPOD_RADIUS、
// 頂点の高さ=MIRROR_APEX_HEIGHTは、既存tripodの頂点位置と同じ式を流用している)。
function makeMirrorPyramid(material) {
  const geo = new THREE.ConeGeometry(MIRROR_TRIPOD_RADIUS, MIRROR_APEX_HEIGHT, 3);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = MIRROR_APEX_HEIGHT / 2;
  return mesh;
}

// 「本格的な鏡」: WebGLCubeRenderTarget + CubeCameraで周囲を毎フレーム撮影し、
// それをenvMapとして使う実際の鏡面反射(metalness=1, roughness最小)。
function createMirrorMaterial() {
  const renderTarget = new THREE.WebGLCubeRenderTarget(MIRROR_ENV_RESOLUTION, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cubeCamera = new THREE.CubeCamera(0.1, 2000, renderTarget);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 0.05,
    envMap: renderTarget.texture,
    transparent: true, // tripod/ringスワップ演出(tripodRingSwap.js)でopacityをクロスフェードするため
  });
  return { material, cubeCamera };
}

function makeHitAreaMesh(radius) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false })
  );
}

// ★ 2026-09-12 変更: banana.glb(./data/banana.glb)を読み込んで見た目に使う。
//   GLBの読み込みは非同期なので、当たり判定(hitエリア)と親グループは即座に作って返し、
//   見た目(GLBの中身)は読み込み完了後に子として追加する(=クリック判定は最初から効くが、
//   見た目は一瞬遅れて出てくる。プリロードしておきたい場合は呼び出し側で対応してください)。
// ★ 2026-09-14: GLB読み込みが安定して動くことを確認できたため、読み込み失敗時の
//   procedural(TorusGeometry)フォールバックは撤去した。読み込みに失敗した場合は
//   何も表示されず、コンソールにエラーが出力されるだけになる。
function makeBananaMesh() {
  const group = new THREE.Group();
  group.rotation.set(0.3, 0.5, 0);
  group.add(makeHitAreaMesh(BANANA_HIT_RADIUS));

  loadGLTFScene(BANANA_GLB_PATH).then((glbScene) => {
    group.add(glbScene);
  }).catch((err) => {
    console.error('banana.glbの読み込みに失敗しました。', err);
  });

  return group;
}

// scene/renderer: main.jsと同じもの。
// deps: { camera, galaxy, solarSystem } ── いずれもmain.js側で既に作成済みの「既存インスタンス」を渡す。
// ★ solarSystemは現状(針が無効化されているため)このファイル内では使っていないが、
//   針を復活させたときにそのまま使えるよう引数はそのまま残してある。
export function createRecordDisplay(scene, renderer, { camera, galaxy, solarSystem, universe }) {
  const { material: mirrorMaterial, cubeCamera } = createMirrorMaterial();

  const apex = new THREE.Vector3(0, MIRROR_APEX_HEIGHT, 0);

  // ★ ご指示「二つのtripod・二つの円環を対応させ、スクロールで位置を移動させながら
  //   クロスフェードする」の反映のため、鏡のピラミッド(pyramidMesh)はmirrorGroupの
  //   子ではなく、別の独立したグループ(mirrorVisualAnchor)に入れてある。
  const mirrorGroup = new THREE.Group();

  const mirrorVisualAnchor = new THREE.Group();
  const pyramidMesh = makeMirrorPyramid(mirrorMaterial);
  mirrorVisualAnchor.add(pyramidMesh);

  const bananaMesh = makeBananaMesh();
  bananaMesh.position.copy(apex).add(new THREE.Vector3(0, BANANA_HEIGHT_ABOVE_APEX, 0));
  mirrorVisualAnchor.add(bananaMesh);

  // ① 戴冠用の王冠(crown.glb)。バナナと同じ場所に降ってくるので、mirrorVisualAnchorの子にする。
  const crownGroup = new THREE.Group();
  crownGroup.visible = false;
  mirrorVisualAnchor.add(crownGroup);
  loadGLTFScene(CROWN_GLB_PATH).then((glbScene) => {
    glbScene.scale.setScalar(CROWN_SCALE);
    crownGroup.add(glbScene);
  }).catch((err) => {
    console.error('crown.glbの読み込みに失敗しました。', err);
  });

  // ② バルジ(プレースホルダー)。バナナと同じ場所を起点に生やす。
  const bulge = makeBulgePlaceholder();
  bulge.position.copy(bananaMesh.position);
  mirrorVisualAnchor.add(bulge);

  mirrorVisualAnchor.position.copy(computeMirrorGroupPosition());
  mirrorVisualAnchor.visible = false; // 表示はtripodRingSwap.js側が一元管理する(swapT>=1で表示に切り替わる)
  scene.add(mirrorVisualAnchor);

  // mirrorGroup自体はpyramidMesh・bananaMeshどちらも子に持たなくなり、現在は見た目を
  // 持たない「物理的な鏡の位置」(=cubeCamera・mirrorLookTargetの基準点)としてのみ使う。
  mirrorGroup.position.copy(computeMirrorGroupPosition());
  mirrorGroup.visible = false; // startRecordDisplayまで隠しておく
  scene.add(mirrorGroup);

  // カメラが鏡側を向くときの注視点(=鏡tripod=mirrorVisualAnchorの頂点のワールド座標)。
  // ここでの値はあくまで初期値で、updateRecordDisplay側で毎フレーム
  // mirrorVisualAnchor.positionに追従するよう更新し直す(下記参照)。
  const mirrorLookTarget = new THREE.Vector3(0, mirrorVisualAnchor.position.y + MIRROR_APEX_HEIGHT, 0);

  // 最終段階('done')でカメラを引く方向(=鏡/レコード側から見て、カメラが下がっていく向き)。
  const pullbackDir = HOME_CAMERA_POS.clone().sub(mirrorLookTarget).normalize();

  // ★ バグ修正: 以前はここでmirrorGroup.positionを基準に一度だけcubeCameraの位置を決めて
  //   そのまま放置していた。しかしmirrorGroup自体は「物理的な鏡の位置」の記録用に生成時の
  //   位置(computeMirrorGroupPosition())のまま動かない一方、実際に見えているピラミッド
  //   (mirrorVisualAnchor)はtripodRingSwap.js側で毎フレーム位置(特にy)を動かされる
  //   (tripodの降下に合わせてgroundYまで下りてくる)ため、両者の位置がどんどんズレていき、
  //   「本来ピラミッドがある場所とは全く違う高さ・位置から撮影した環境」がenvMapとして
  //   反射に使われてしまっていた。これが「反射面が裏返って見える/おかしい」ように見えていた
  //   実体だった可能性が高い。以後はupdateRecordDisplay側で毎フレーム
  //   mirrorVisualAnchor.positionに追従させ直す(ここでの初期値はその1フレーム目用)。
  cubeCamera.position.copy(mirrorVisualAnchor.position).add(new THREE.Vector3(0, CUBE_CAMERA_Y_OFFSET, 0));
  scene.add(cubeCamera);

  // ③④ 針(needle)・溝(groove)。針はワールド直下(銀河周縁〜中心を動くため、
  // mirrorVisualAnchorではなくsceneに直接配置)。溝は銀河と一緒に回転して見えるよう
  // galaxy.starsGroupの子にする。
  const needle = makeNeedleMesh();
  scene.add(needle);
  const groove = makeGrooveLine();
  galaxy.starsGroup.add(groove.line);

  return {
    scene, renderer, camera, galaxy, solarSystem, universe,
    mirrorGroup, mirrorVisualAnchor, mirrorVisualHome: mirrorVisualAnchor.position.clone(),
    pyramidMesh, bananaMesh, crownGroup, bulge, needle, groove,
    galaxyCenter: galaxy.starsGroup.position.clone(), // ← 針・太陽軌道の中心(銀河の中心。生成時点で固定)
    coronationStarted: false, // ← バナナクリック演出の二重発火防止
    cubeCamera, mirrorLookTarget,
    viewMixTarget: 0,  // 0=carousel側を向く / 1=鏡側を向く。applyScrollが更新する
    viewMixCurrent: 0, // 実際にcontrols.targetへ適用する、軽くスムージングした値
    mirrorSpinMultiplier: 1, // 鏡(レコード)の自転速度倍率。updateRecordDisplayが目標値へ滑らかに近づける
    pullbackDir,        // ← 最終段階でカメラを引く方向(固定ベクトル)
    pullbackTarget: 0,  // 0〜1。applyScrollが'done'到達後のスクロール量から算出する
    pullbackCurrent: 0, // 実際にカメラへ適用する、軽くスムージングした値
    pullbackApplied: 0, // 直前フレームでcamera.positionへ実際に足した量(次フレームで打ち消すために保持)
    // 'inactive' → 'mirror' → (針を復活させれば 'needle' → 'done' も使える。現状は'mirror'止まり)
    phase: 'inactive',
  };
}

// enterUniverse完了時に呼ぶ: 鏡三角錐(+バナナ)を表示する。
export function startRecordDisplay(record) {
  if (!record || record.phase !== 'inactive') return;
  record.mirrorGroup.visible = true;
  record.phase = 'mirror';
}

// ホイールイベントのたびに呼ぶ: scrollYは0〜SCROLL_MAXにクランプ済みの累積スクロール量
// (呼び出し側=main.jsが管理する)。画面の向き(viewMixTarget)を更新する。
// ★ 以前ここにあった「銀河のscrub量(galaxyRevealT)をスクロール量から計算し、
//   setGalaxyRevealAmountで銀河を出し入れする」処理は削除した。銀河は既にmain.js側の
//   revealGalaxy()でフルサイズ表示済みであり、ここで手を加えるとその状態を壊してしまう
//   (=今回報告のあった「右ドラッグ後に銀河が消える/発生し直す」不具合の原因だった)。
export function applyScroll(record, scrollY) {
  if (!record || record.phase === 'inactive') return;
  record.viewMixTarget = THREE.MathUtils.clamp(scrollY / SCROLL_SWITCH, 0, 1);
  // 「最後になったら」の下スクロールぶん(=SCROLL_SWITCHを使い切った後の残り)を0〜1に正規化。
  // 実際にカメラへ反映するかどうかはupdateRecordDisplay側でphase==='done'を見て判定する。
  const pullbackRangeStart = SCROLL_SWITCH;
  record.pullbackTarget = THREE.MathUtils.clamp((scrollY - pullbackRangeStart) / SCROLL_PULLBACK_RANGE, 0, 1);
}

// クリック時に呼ぶ: 鏡にヒットしていれば処理してtrueを返す。
// raycasterは呼び出し側で既にsetFromCamera済みのものを渡す。
// onNavigate(url): 省略時はrecord.js側でwindow.location.hrefを直接書き換える。
// ★ 以前あった「バナナクリック→galaxy-scrub開始」「銀河クリック→針の演出開始」の
//   2つの分岐は、銀河の動き・針の演出をこのファイルから外したのに合わせて削除した。
export function tryRecordClick(record, raycaster, { onNavigate } = {}) {
  if (!record || record.phase === 'inactive') return false;

  // 鏡: three.jsのRaycasterはvisible=falseでも判定してしまう(明示的にチェックしないと
  // 素通りする)ため、mirrorVisualAnchor.visible(=tripodRingSwap.js側で鏡tripodが実際に
  // 表示に切り替わっているか)を明示的に見て、「出現しているときだけクリック可能」にする。
  if (!record.mirrorVisualAnchor.visible) return false;

  const mirrorHit = raycaster.intersectObject(record.pyramidMesh, true)[0];
  if (mirrorHit) {
    if (onNavigate) onNavigate(MIRROR_TARGET_PAGE);
    else window.location.href = MIRROR_TARGET_PAGE;
    return true;
  }

  // バナナ: ①戴冠 → ②バルジ+針+太陽出現 → ③④銀河高速回転〜太陽系召喚、の一連の演出を開始する。
  // 一度きりの演出なので、coronationStartedで二重発火を防いでいる(演出中の再クリックは無視)。
  if (!record.coronationStarted) {
    const bananaHit = raycaster.intersectObject(record.bananaMesh, true)[0];
    if (bananaHit) {
      playCoronationSequence(record);
      return true;
    }
  }

  return false;
}

// レンダーループから、メインのrenderer.render(...)より前に毎フレーム呼ぶ想定。
// controls: main.js側のOrbitControls(渡すと、スクロールに応じて向きを補間する)。
export function updateRecordDisplay(record, deltaSeconds, controls) {
  if (!record) return;

  // 鏡三角錐(レコード)の自転速度: 現状は常に等倍(針/太陽系軌道側の状態は参照しない)。
  const spinMultiplierTarget = 1;
  const spinSmoothing = 1 - Math.exp(-MIRROR_SPIN_SMOOTHING * deltaSeconds);
  record.mirrorSpinMultiplier = THREE.MathUtils.lerp(record.mirrorSpinMultiplier, spinMultiplierTarget, spinSmoothing);

  if (record.mirrorVisualAnchor.visible) {
    record.mirrorVisualAnchor.rotateOnWorldAxis(WORLD_UP, -TRIPOD_ANGULAR_SPEED * record.mirrorSpinMultiplier * deltaSeconds);
  }

  // ★ 2026-09-11 修正(ご指示反映): 「カメラは常に固定(controls.target/positionを一切
  //   動かさない)」方針に変更した。以前はここでcontrols.targetをUNIVERSE_CAMERA_TARGET⇔
  //   mirrorLookTargetの間で補間していたが、それが「入れ替え完了後もカメラが動き続ける
  //   (=画面奥の銀河まで一緒に動いてしまう)」バグの原因だった。
  //   tripod/リングの入れ替え演出(見え方の変化)は、カメラ側ではなくtripodRingSwap.js側で
  //   tripod・リング・鏡tripod自体の位置を動かすことで表現する(このファイルではcontrols.target
  //   にはもう触れない)。mirrorLookTargetは現在カメラ制御には使っていないが、pullback(休眠中。
  //   phase==='done'到達時のみ有効)の向き計算に使う初期値としてこのまま残してある。
  // ★ controls.update()自体は、record.phase!=='inactive'の間もユーザーのドラッグ操作
  //   (OrbitControlsの自由回転)を反映させるために毎フレーム呼び続ける必要があるため、
  //   このifブロックごと削除はしないこと(削除すると宇宙ページでカメラが一切回せなくなる)。
  if (controls && record.phase !== 'inactive') {
    // mirrorVisualAnchorはtripodRingSwap.js側で位置(y)が決まるため、mirrorLookTargetも
    // 毎フレーム追従させ直す(現状はpullbackDirの初期値計算にしか使っていない休眠中の値)。
    record.mirrorLookTarget.set(0, record.mirrorVisualAnchor.position.y + MIRROR_APEX_HEIGHT, 0);

    const smoothing = 1 - Math.exp(-VIEW_MIX_SMOOTHING * deltaSeconds);
    record.viewMixCurrent = THREE.MathUtils.lerp(record.viewMixCurrent, record.viewMixTarget, smoothing);

    // 直前フレームで足した「カメラを引く」ぶんをいったん取り消してから、controls.update()に
    // 通常のOrbitControls計算(ユーザーのドラッグ回転などの反映。targetは動かしていないので
    // 実質的にはノーオペレーション)をさせる。
    record.camera.position.addScaledVector(record.pullbackDir, -record.pullbackApplied);
    controls.update();

    // 「最後になったら、下スクロールでカメラを引いてレコード全体が見えるように」の反映。
    // phase==='done'は現状(針が無効化中は)到達しないため、この処理は休眠中。
    const pullbackTargetNow = record.phase === 'done' ? record.pullbackTarget : 0;
    const pullbackSmoothing = 1 - Math.exp(-PULLBACK_SMOOTHING * deltaSeconds);
    record.pullbackCurrent = THREE.MathUtils.lerp(record.pullbackCurrent, pullbackTargetNow, pullbackSmoothing);
    record.pullbackApplied = record.pullbackCurrent * RECORD_PULLBACK_DISTANCE;
    record.camera.position.addScaledVector(record.pullbackDir, record.pullbackApplied);
  }

  // 鏡に映るシーンを毎フレーム撮影する(自分自身が映り込まないよう撮影中だけ非表示にする)。
  if (!record.mirrorGroup.visible) return;
  // ★ バグ修正: 撮影(=cubeCamera.update)の直前に、実際に見えているピラミッド
  //   (mirrorVisualAnchor。tripodRingSwap.js側が毎フレーム位置を書き換えている)へ
  //   cubeCameraの位置を追従させ直す。これを怠ると、tripod降下中〜鏡tripod表示中は
  //   撮影位置がピラミッドの実位置から乖離したままになり、反射が実際の見た目と
  //   食い違って見えてしまう(詳細はcreateRecordDisplay側のコメント参照)。
  record.cubeCamera.position.copy(record.mirrorVisualAnchor.position).add(_cubeCameraOffset);
  record.mirrorGroup.visible = false;
  const wasVisualVisible = record.mirrorVisualAnchor.visible;
  record.mirrorVisualAnchor.visible = false;
  record.cubeCamera.update(record.renderer, record.scene);
  record.mirrorGroup.visible = true;
  record.mirrorVisualAnchor.visible = wasVisualVisible;
}

// TODO:
//   - SCROLL_SWITCH / SCROLL_PULLBACK_RANGE / VIEW_MIX_SMOOTHING / MIRROR_ENV_RESOLUTION /
//     BANANA_HEIGHT_ABOVE_APEX / RECORD_PULLBACK_DISTANCE / PULLBACK_SMOOTHING は仮値です。
//   - MIRROR_TARGET_PAGE('prism2.html'): 実際の配置パスに合わせて調整してください。
//   - 針(needle)+太陽軌道・太陽系軌道の召喚は上部でコメントアウトしたまま残してあります。
//     再度有効化する場合は、そのブロックのコメントを外し、import文・createRecordDisplayの
//     needle/groove生成・tryRecordClickの銀河クリック分岐・updateRecordDisplayのphase判定を
//     元に戻してください。
//   - 銀河を「右ドラッグで俯瞰後、スクロールで縮小させる」新しい演出は、このファイルの
//     責務から外れたため未実装のままです(別途main.js側などでの実装を想定)。
//   - RECORD_PULLBACK_DISTANCEは、以前GALAXY_RADIUS基準で計算していたが銀河への依存を
//     切り離したため単純な定数(仮値1)に変更した。実際の見た目に合わせて調整してください。
//   - 鏡は本格的なリアルタイム反射(CubeCamera)なので、解像度(MIRROR_ENV_RESOLUTION)や
//     毎フレームの再撮影が負荷になる場合、フレーム間引き(数フレームに1回だけ更新)などの
//     最適化が今後必要になるかもしれません。
