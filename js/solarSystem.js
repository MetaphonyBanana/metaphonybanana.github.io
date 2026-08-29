import * as THREE from 'three';
import { TRIPOD_RADIUS } from './universe.js';

// ══════════════════════════════════════════════════════════════
// ── 宇宙ページ最終装飾: バナナ惑星 + tripod直下を公転する太陽系(将来カルーセルの一部) ──
// ══════════════════════════════════════════════════════════════
//
// ★ 方針変更: バナナ惑星はもう「公転の中心」ではない。位置は従来どおり(anchor引数)
//   そのまま据え置き、太陽の公転軌道(sunGroupが辿るorbitCurve)はバナナとは無関係に、
//   tripod(universe.js)の真下・tripodの回転軌道(TRIPOD_RADIUS)と同じ半径の円として
//   独立に配置する。tripod=カルーセルの屋根 / この太陽系の軌道=カルーセルのステージ、
//   という構成にするため、tripod足元(y=0)とステージ面の間に高さ方向のスペース
//   (STAGE_HEIGHT_BELOW_TRIPOD)を確保してある。
//
// 全体サイズはSOLAR_SYSTEM_SCALEで半分に縮小(太陽・惑星本体と、惑星ごとの太陽からの
// 距離)。ただし主軌道半径(ORBIT_RADIUS)だけはtripodの回転軌道と揃える必要があるため、
// スケールの対象外でTRIPOD_RADIUSをそのまま採用している。
//
// 階層構造(入れ子の公転):
//   group (このシステム全体)
//     ├─ bananaMesh (固定。位置はanchor引数のまま変更なし。クリックで個人ページへ)
//     ├─ sunGroup   (軌道(tripod直下・tripodと同半径の正円)上を移動)
//     │     ├─ sunMesh (クリックで8惑星の軌跡の記録を開始)
//     │     └─ planetPivot[i] (ローカルY軸回りに回転) → planetMesh[i] (太陽からの距離=軌道半径)
//     ├─ trailLines[i] (太陽クリック後、各惑星につき1本生成される黄色い細線。実際に通った位置を随時追記していく)
//     └─ ihSprite (カルーセルの馬。太陽と同じ軌道・同じ角速度で、位相を少し遅らせて追従しつつ上下にバウンスする。
//                  太陽系が最初の1周を終えたタイミングでフェードイン出現する)
//
// ── 公転面を直交させる仕組み ────────────────────────────
// 太陽グループ(sunGroup)を「軌道上の現在位置」に置くだけでなく、
// 「ローカルY軸がその地点での進行方向(接線=tangent)と一致する」ように毎フレーム向きも合わせる。
// すると、惑星の公転面(ローカルXZ平面。pivot.rotation.yで回る面)は常に進行方向と直交した状態を
// 保ったまま、太陽と一緒に軌道に沿って運ばれることになる。これにより、惑星が実際にたどる
// 世界座標上の軌跡は、軌道の周りに巻きつく「らせん」になる ── というのが今回の見た目の仕組み。
// 軌道自体が正円の間はまっすぐな円筒らせん、将来バナナ型へ変形すればバナナ状のらせんになる。

// ── クリックで飛ぶ個人ページ。まだURLが無いのでプレースホルダー ──
export const PERSONAL_PAGE_URL = 'https://example.com/moon-base'; // ← 実際のURLが決まったら差し替え

// ── 太陽系全体を半分サイズにする ────────────────────────────
// 太陽・惑星本体の大きさ、および各惑星の太陽からの距離(orbit)に適用する。
// 主軌道半径(ORBIT_RADIUS。tripodと揃える方)は対象外 ── 詳細はORBIT_RADIUSの定義を参照。
const SOLAR_SYSTEM_SCALE = 0.5;

// ── バナナ惑星(クリック対象) ──────────────────────────
// 既存のbanana.js(オープニングで割れるバナナ)の資産を流用できるなら、そちらの
// ジオメトリ/マテリアルに差し替えると見た目の一貫性が出ます。ここでは依存を増やさないよう、
// TorusGeometryを部分的な弧(アーク)にして「三日月/バナナ」らしい曲がった塊に見せる
// プレースホルダーにしてあります。
const BANANA_RADIUS = 1.4;          // 曲率半径(仮値)
const BANANA_TUBE = 0.42;           // 太さ(仮値)
const BANANA_ARC = Math.PI * 0.78;  // 弧の角度(仮値。大きいほど曲がりが強い)
const BANANA_COLOR = 0xf4e04d;
const BANANA_HIT_RADIUS = 2.6;      // クリック判定用の当たり判定半径(見た目より広め。他の隠しボタンと同じ考え方)

function makeHitAreaMesh(radius) {
  // このプロジェクトの他の隠しボタンと同じ方式: visible=trueのままほぼ完全に透明にする。
  // visible=falseの当たり判定はraycastが拾わない環境があるため避ける。
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false })
  );
}

function makeBananaMesh() {
  const geo = new THREE.TorusGeometry(BANANA_RADIUS, BANANA_TUBE, 12, 32, BANANA_ARC);
  const mat = new THREE.MeshBasicMaterial({ color: BANANA_COLOR });
  const mesh = new THREE.Mesh(geo, mat);
  // Torusは既定でXY平面上に弧を描くので、正面から見やすい向きへ少し傾けておく(仮値)
  mesh.rotation.set(0.3, 0.5, 0);
  mesh.add(makeHitAreaMesh(BANANA_HIT_RADIUS));
  mesh.userData.isBananaPlanet = true;
  return mesh;
}

// ── 太陽が辿る軌道 ────────────────────────────────
// 現状は正円(ORBIT_BEND=0, ORBIT_HEIGHT_WOBBLE=0)。
// 将来「黄色いリング(=このモジュールで生成する軌跡)をクリックしたら、正円→バナナ型へ
// 変形させて巨大バナナの絵を描く」という構想があるため、バナナ側の目標パラメータ
// (BANANA_TARGET_BEND / BANANA_TARGET_HEIGHT_WOBBLE)は変形先の参考値として残してある。
// 今回はこの2つをまだ使っていない(実装は正円のみ)。
// r(θ) = ORBIT_RADIUS + ORBIT_BEND * sin(θ)^2 という式を使っており、ORBIT_BENDを0以外に
// すると片側だけが外側に張り出したバナナ/三日月状の非対称カーブになる(将来の変形先の式)。
// 基準半径: tripod(universe.js)の回転軌道(終端3点が描く円)とサイズを揃える。
// ここは「太陽系を半分に」のSOLAR_SYSTEM_SCALEの対象外(tripod=屋根と直径を一致させる必要があるため)。
const ORBIT_RADIUS = TRIPOD_RADIUS;
const ORBIT_BEND = 0;                  // 0=正円。バナナへ変形するときはここをBANANA_TARGET_BENDへ近づけていく想定
const ORBIT_HEIGHT_WOBBLE = 0;         // 0=完全に平面的な正円。バナナ変形時はBANANA_TARGET_HEIGHT_WOBBLEへ
const BANANA_TARGET_BEND = 5;          // (未使用・将来用)バナナ変形時の膨らみの強さ目標値
const BANANA_TARGET_HEIGHT_WOBBLE = 1.2; // (未使用・将来用)バナナ変形時の上下うねり目標値
const ORBIT_CURVE_POINTS = 64;         // 曲線を近似する制御点の数
const SUN_ORBIT_PERIOD = 40;           // 太陽が軌道を1周するのにかかる秒数(仮値)

function makeOrbitCurve(center) {
  const pts = [];
  for (let i = 0; i < ORBIT_CURVE_POINTS; i++) {
    const theta = (i / ORBIT_CURVE_POINTS) * Math.PI * 2;
    const r = ORBIT_RADIUS + ORBIT_BEND * Math.sin(theta) * Math.sin(theta);
    const x = center.x + r * Math.cos(theta);
    const z = center.z + r * Math.sin(theta);
    const y = center.y + ORBIT_HEIGHT_WOBBLE * Math.sin(theta * 2);
    pts.push(new THREE.Vector3(x, y, z));
  }
  // closed=trueで滑らかな閉曲線にする(始点と終点が自然につながる)
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
}

// ── 太陽本体 ────────────────────────────────────
const SUN_RADIUS = 0.9 * SOLAR_SYSTEM_SCALE;
const SUN_COLOR = 0xffcc55;
const SUN_HIT_RADIUS = 1.8 * SOLAR_SYSTEM_SCALE; // クリックしやすいよう見た目より広めの当たり判定(比率は維持)

function makeSunMesh() {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(SUN_RADIUS, 24, 24),
    new THREE.MeshBasicMaterial({ color: SUN_COLOR })
  );
  mesh.add(makeHitAreaMesh(SUN_HIT_RADIUS));
  mesh.userData.isSun = true;
  return mesh;
}

// ── 8惑星(装飾。実在の縮尺・色にはこだわらず仮の見た目) ─────────────
// 各惑星は「pivot(太陽グループの原点を軸に回転)→その子として軌道半径分だけ離れた惑星メッシュ」
// という、three.jsで定番の入れ子公転パターン。
// speedは「1秒あたりの角速度(rad/秒)」に変換して使う(ANGULAR_SPEED_SCALEで調整)。
// フレームごとの加算(旧実装)ではなく経過時間から直接角度を計算する方式にしたことで、
// フレームレートに依存せず動く。
const ANGULAR_SPEED_SCALE = 0.6; // 旧実装(1フレームあたりspeed*0.01, 60fps想定)と近い見た目速度になるよう変換
const PLANETS = [
  { name: 'Mercury', radius: 0.12, orbit: 1.4, speed: 4.1, color: 0xb1b1b1 },
  { name: 'Venus',   radius: 0.18, orbit: 1.9, speed: 3.0, color: 0xe0c16c },
  { name: 'Earth',   radius: 0.19, orbit: 2.5, speed: 2.4, color: 0x5b9bd5 },
  { name: 'Mars',    radius: 0.15, orbit: 3.1, speed: 1.9, color: 0xc1440e },
  { name: 'Jupiter', radius: 0.42, orbit: 4.1, speed: 1.1, color: 0xd9a066 },
  { name: 'Saturn',  radius: 0.36, orbit: 5.0, speed: 0.85, color: 0xe3c98f },
  { name: 'Uranus',  radius: 0.28, orbit: 5.8, speed: 0.6, color: 0x9fe0e0 },
  { name: 'Neptune', radius: 0.27, orbit: 6.5, speed: 0.47, color: 0x5b6ee1 },
// ↑ radius(惑星本体の大きさ)・orbit(太陽からの距離)は、下でSOLAR_SYSTEM_SCALEを掛けて半分にする(speed/colorはそのまま)。
].map((p) => ({ ...p, radius: p.radius * SOLAR_SYSTEM_SCALE, orbit: p.orbit * SOLAR_SYSTEM_SCALE }));

function makePlanets(sunGroup) {
  const pivots = [];
  PLANETS.forEach((p) => {
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(p.radius, 14, 14),
      new THREE.MeshBasicMaterial({ color: p.color })
    );
    mesh.position.set(p.orbit, 0, 0);
    pivot.add(mesh);
    pivot.userData.mesh = mesh; // 軌跡記録時に実際のワールド座標を取るための参照
    pivot.userData.orbitRadius = p.orbit;
    pivot.userData.angularSpeed = p.speed * ANGULAR_SPEED_SCALE; // rad/秒
    // 惑星ごとに初期角度をばらけさせる(全部が一直線に並んで見えるのを避ける、仮値)
    pivot.userData.initialAngle = Math.random() * Math.PI * 2;
    sunGroup.add(pivot);
    pivots.push(pivot);
  });
  return pivots;
}

// ── 黄色い軌跡(trail) ────────────────────────────────
// 「実際にその瞬間その瞬間で惑星がどこにいたか」を毎フレーム(一定間隔)記録して線を伸ばす方式。
// 事前に1周分をまとめて計算する旧方式だと、惑星の周期と太陽の公転周期が揃っていないため
// クリック時点の実際の位相と軌跡の始点(位相ゼロ)がズレて、2周目以降に見た目が噛み合わなく
// なる問題があった。実際の位置をそのまま記録する今の方式ならズレようがない。
// リングバッファで直近TRAIL_MAX_POINTS点だけ保持し続け、それより古い点は自然に消えていく
// (=太陽の直近1周分の軌跡が常に表示される)。
const TRAIL_COLOR = 0xffee66;    // 黄色、細い(LineBasicMaterialは基本1px程度の細線になる)
const TRAIL_MAX_POINTS = 720;    // 保持する点の数(仮値。多いほど滑らかで長く残るが重くなる)
const TRAIL_RECORD_INTERVAL = SUN_ORBIT_PERIOD / TRAIL_MAX_POINTS; // 何秒おきに1点記録するか

// ── カルーセルの馬(ih): tripodの屋根の下を、太陽と同じ軌道・同じ角速度で回る飾り ──────
// 見た目はih.png(白背景→透過、黒インク→白不透明への変換を済ませた完成品テクスチャ)を使う。
// 【注意】ih.pngはすでに変換済みなので、universe.jsのloadInkTexture(luminanceからalphaを
// 作り直す関数)には絶対に通さないこと。すでに透過済みの画像を再度通すと、透明ピクセルの
// RGBがdrawImage時に0,0,0へ丸め込まれる(premultiplied alphaの都合)ことがあり、その結果
// 白と透過が入れ替わって見える不具合になる。ここではただのTextureLoaderで読み込むだけでいい。
// 太陽とまったく同じ軌道パラメータtをそのまま使う(=同じ角速度で回転)が、
// IH_PHASE_OFFSETぶん位相を遅らせて、太陽の少し後ろをついてくるように配置する。
// カルーセルの馬らしく、進みながら上下にもバウンスさせる(IH_BOB_*)。
// 出現トリガー: 太陽系が動き出してから最初の1周(SUN_ORBIT_PERIOD秒)を終えたタイミングで
// フェードイン表示する。
// 太陽系よりかなり大きく見せたいので、STAGE_HEIGHT_BELOW_TRIPOD(下記)を広げて、
// tripodの屋根に頭がぶつからないよう軌道全体をさらに下げてある。
const IH_IMAGE_URL = new URL('./data/ih.png', import.meta.url).href;
const IH_WORLD_HEIGHT = 12;        // 表示の高さ(ワールド単位、仮値。かなり大きめ。幅はimg比率から自動計算)
const IH_PHASE_OFFSET = 0.07;      // 太陽より軌道上でどれだけ遅れて追従するか(1周=1.0のうちの割合、仮値)
const IH_BOB_AMPLITUDE = 1.4;      // 上下バウンスの振幅(仮値)
const IH_BOB_SPEED = 1.6;          // 上下バウンスの速さ(ラジアン/秒、仮値)
const IH_FADE_IN_DURATION = 1.2;   // 出現時のフェードイン秒数

function makeIhSprite() {
  const material = new THREE.SpriteMaterial({
    map: null, // テクスチャ読み込み完了後に差し込む
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(material);
  sprite.visible = false; // 出現トリガー(太陽系が1周)まで隠しておく
  return sprite;
}

// 出現トリガー: フェードインして見せる。
function revealIh(solarSystem) {
  solarSystem.ihSprite.visible = true;
  gsap.to(solarSystem.ihSprite.material, {
    opacity: 1,
    duration: IH_FADE_IN_DURATION,
    ease: 'power1.out',
  });
}

const _UP = new THREE.Vector3(0, 1, 0);
const _curvePoint = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _sunQuat = new THREE.Quaternion();
const _planetWorld = new THREE.Vector3();
const _ihPoint = new THREE.Vector3();

// 太陽グループの「向き」を、軌道曲線上のtパラメータでの接線方向に合わせるための共通処理。
function computeSunPose(orbitCurve, t, outPos, outQuat) {
  orbitCurve.getPointAt(t, outPos);
  orbitCurve.getTangentAt(t, _tangent);
  outQuat.setFromUnitVectors(_UP, _tangent);
}

// 惑星1体ぶんのリングバッファ状態を作る。
// buffer: リングバッファ本体(書き込み順)。ordered: 描画用に時系列順へ並べ替えたもの
// (Three.jsのLineは頂点配列の並び順そのまま線を引くので、リングのラップ地点で
//  最新点→最古点へ一直線に飛ぶ線が出ないよう、描画前に必ず時系列順へ整列させる)。
function makeTrailState() {
  return {
    buffer: new Float32Array(TRAIL_MAX_POINTS * 3),
    ordered: new Float32Array(TRAIL_MAX_POINTS * 3),
    writeIndex: 0, // 次に書き込む位置
    count: 0,      // 埋まっている点数(TRAIL_MAX_POINTSで頭打ち)
  };
}

// worldPosを1点、リングバッファに追記して、描画用ジオメトリを更新する。
function recordTrailPoint(trail, worldPos) {
  const idx = trail.writeIndex * 3;
  trail.buffer[idx] = worldPos.x;
  trail.buffer[idx + 1] = worldPos.y;
  trail.buffer[idx + 2] = worldPos.z;
  trail.writeIndex = (trail.writeIndex + 1) % TRAIL_MAX_POINTS;
  trail.count = Math.min(trail.count + 1, TRAIL_MAX_POINTS);

  // バッファが満杯になるまではwriteIndexがそのまま「末尾+1」なので先頭(0)から古い順。
  // 満杯後はwriteIndexの位置が最古の点になる(次に上書きされる場所のため)。
  const start = trail.count < TRAIL_MAX_POINTS ? 0 : trail.writeIndex;
  for (let i = 0; i < trail.count; i++) {
    const srcIdx = ((start + i) % TRAIL_MAX_POINTS) * 3;
    const dstIdx = i * 3;
    trail.ordered[dstIdx] = trail.buffer[srcIdx];
    trail.ordered[dstIdx + 1] = trail.buffer[srcIdx + 1];
    trail.ordered[dstIdx + 2] = trail.buffer[srcIdx + 2];
  }
  trail.geometry.attributes.position.needsUpdate = true;
  trail.geometry.setDrawRange(0, trail.count);
}

// ── 公転軌道の中心(=カルーセルのステージ面) ──────────────────
// tripod(universe.js)の回転軸(world Y、x=0/z=0)上、tripodの足元(y=0)よりさらに
// 下にSTAGE_HEIGHT_BELOW_TRIPODぶん離して置く。
// ih(かなり大きく表示する)がtripodの屋根に頭をぶつけず、かつ軌道自体に埋もれて
// 見えなくならないよう、この値は広めに取ってある(仮値)。
const STAGE_HEIGHT_BELOW_TRIPOD = 18; // 仮値
const ORBIT_CENTER = new THREE.Vector3(0, -STAGE_HEIGHT_BELOW_TRIPOD, 0);

// scene: universe.js と同じシーンに追加する想定。
// anchor: バナナ惑星を置くワールド座標(もう公転の中心ではないので、単にバナナの位置)。
//         見た目の構図として好きな場所を呼び出し側(main.js)で決めて渡してください。
// 太陽の公転軌道自体はanchorとは無関係に、tripod直下・ORBIT_CENTERに固定される。
export function createSolarSystem(scene, anchor) {
  const group = new THREE.Group();
  group.visible = false; // enterUniverse等のフェードインに合わせて、呼び出し側でtrueにする想定
  scene.add(group);

  const bananaMesh = makeBananaMesh();
  bananaMesh.position.copy(anchor); // ← バナナは中心に置かないことにしたので、指定位置にそのまま据え置く
  group.add(bananaMesh);

  const orbitCurve = makeOrbitCurve(ORBIT_CENTER); // ← tripod直下・tripodと同半径の軌道

  const sunGroup = new THREE.Group();
  const sunMesh = makeSunMesh();
  sunGroup.add(sunMesh);
  group.add(sunGroup);

  const planetPivots = makePlanets(sunGroup);

  const ihSprite = makeIhSprite();
  group.add(ihSprite);
  new THREE.TextureLoader().load(
    IH_IMAGE_URL,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      const aspect = texture.image.width / texture.image.height;
      ihSprite.material.map = texture;
      ihSprite.material.needsUpdate = true;
      ihSprite.scale.set(IH_WORLD_HEIGHT * aspect, IH_WORLD_HEIGHT, 1);
    },
    undefined,
    (err) => console.error('createSolarSystem: ih.pngの読み込みに失敗', err)
  );

  return {
    group, bananaMesh, sunGroup, sunMesh, orbitCurve, planetPivots,
    trailLines: [],          // ← 太陽クリック後、{ geometry, line, buffer, ordered, writeIndex, count } を8個ぶん保持
    trailsGenerated: false,  // ← 二重生成防止
    trailLastRecorded: -Infinity, // ← 直近に記録したelapsedSeconds
    ihSprite,
    ihRevealed: false,            // ← 出現済みフラグ(二重フェードイン防止)
    orbitStartElapsedSeconds: null, // ← 最初にupdateSolarSystemが呼ばれたelapsedSeconds(1周判定の基準)
  };
}

// ── 毎フレーム呼ぶ ──────────────────────────────────
export function updateSolarSystem(solarSystem, elapsedSeconds) {
  if (!solarSystem.group.visible) return;

  if (solarSystem.orbitStartElapsedSeconds === null) {
    solarSystem.orbitStartElapsedSeconds = elapsedSeconds;
  }

  const t = (elapsedSeconds / SUN_ORBIT_PERIOD) % 1;
  computeSunPose(solarSystem.orbitCurve, t, _curvePoint, _sunQuat);
  solarSystem.sunGroup.position.copy(_curvePoint);
  solarSystem.sunGroup.quaternion.copy(_sunQuat); // ← 公転面を進行方向と直交させる(らせんの仕組み)

  solarSystem.planetPivots.forEach((pivot) => {
    pivot.rotation.y = pivot.userData.initialAngle + pivot.userData.angularSpeed * elapsedSeconds;
  });

  // 太陽クリック後は、一定間隔ごとに「今実際にいる位置」をそのまま軌跡へ記録していく。
  if (
    solarSystem.trailsGenerated &&
    elapsedSeconds - solarSystem.trailLastRecorded >= TRAIL_RECORD_INTERVAL
  ) {
    solarSystem.trailLastRecorded = elapsedSeconds;
    solarSystem.planetPivots.forEach((pivot, i) => {
      pivot.userData.mesh.getWorldPosition(_planetWorld);
      recordTrailPoint(solarSystem.trailLines[i], _planetWorld);
    });
  }

  // ih(カルーセルの馬): 太陽と同じ軌道を同じ角速度でなぞりつつ、位相をIH_PHASE_OFFSETぶん
  // 遅らせて太陽の後ろをついてくるように配置する。カルーセルの馬らしく上下にもバウンスさせる。
  const ihT = (t - IH_PHASE_OFFSET + 1) % 1;
  solarSystem.orbitCurve.getPointAt(ihT, _ihPoint);
  _ihPoint.y += IH_BOB_AMPLITUDE * Math.sin(elapsedSeconds * IH_BOB_SPEED);
  solarSystem.ihSprite.position.copy(_ihPoint);

  // 太陽系が動き出してから最初の1周を終えたら、ihをフェードインで出現させる。
  if (
    !solarSystem.ihRevealed &&
    elapsedSeconds - solarSystem.orbitStartElapsedSeconds >= SUN_ORBIT_PERIOD
  ) {
    solarSystem.ihRevealed = true;
    revealIh(solarSystem);
  }
}

// ── 太陽クリックで呼ぶ: 8惑星ぶんの軌跡の「記録」を開始する ──────────────
// 一括計算はせず、以後updateSolarSystem側で実際の位置を随時記録していく方式。
export function generatePlanetTrails(solarSystem) {
  if (solarSystem.trailsGenerated) return;
  solarSystem.trailsGenerated = true;
  solarSystem.trailLastRecorded = -Infinity;

  solarSystem.trailLines = solarSystem.planetPivots.map(() => {
    const state = makeTrailState();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(state.ordered, 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({ color: TRAIL_COLOR });
    const line = new THREE.Line(geometry, material);
    solarSystem.group.add(line);
    return { ...state, geometry, line };
  });
}

// ── main.js側の統合ポイント(想定) ──────────────────────
//   1) createUniverse(scene)の近くで1回:
//        // anchorはバナナ惑星の位置のみを指定する(公転軌道はtripod直下に自動配置される)
//        const solarSystem = createSolarSystem(scene, new THREE.Vector3(anchorX, anchorY, anchorZ));
//   2) enterUniverse()完了時など、宇宙ページに入ったタイミングで:
//        solarSystem.group.visible = true;
//   3) レンダーループ内(animate)で毎フレーム:
//        updateSolarSystem(solarSystem, clock.getElapsedTime());
//   4) クリック処理内(宇宙ページがアクティブな時のみ判定すればOK):
//        - バナナ: raycaster.intersectObject(solarSystem.bananaMesh, true)[0] → PERSONAL_PAGE_URLへ遷移
//        - 太陽:   raycaster.intersectObject(solarSystem.sunMesh, true)[0] → generatePlanetTrails(solarSystem)
//
// TODO:
//   - PERSONAL_PAGE_URL: 個人ページのURLが決まり次第差し替え。
//   - anchor(バナナの位置): もう公転の中心ではないので、既存シーンの構図を見ながら
//     好きな場所を決めてください(tripod・太陽系の軌道・ihと重ならない位置が無難)。
//   - STAGE_HEIGHT_BELOW_TRIPOD: tripodの足元(y=0)から太陽系の公転面までの距離(仮値)。
//     ihの上端がtripodの屋根を突き抜けないよう、IH_WORLD_HEIGHT/IH_BOB_AMPLITUDEと
//     見比べながら調整してください。
//   - ORBIT_RADIUS: 現在はtripodのTRIPOD_RADIUSと同じ値(universe.jsからimport)。
//     ORBIT_BEND/ORBIT_HEIGHT_WOBBLEは現状0(正円)。将来「クリックで正円→バナナ型へ変形」
//     させたい場合、この2つをBANANA_TARGET_BEND/BANANA_TARGET_HEIGHT_WOBBLEへ向けて
//     gsapなどで補間し、毎フレームmakeOrbitCurve()を作り直す実装が必要になります。
//   - SOLAR_SYSTEM_SCALE: 太陽・惑星本体の大きさと、惑星ごとの太陽からの距離をまとめて
//     半分にしている倍率。ORBIT_RADIUS(tripodと揃える主軌道)には掛かっていない点に注意。
//   - SUN_ORBIT_PERIOD: 太陽が軌道を1周する速さ。TRAIL_RECORD_INTERVAL・ihの出現タイミングにも影響する。
//   - TRAIL_MAX_POINTS / TRAIL_COLOR: 軌跡の保持点数(=見える長さ)・色。
//   - IH_WORLD_HEIGHT / IH_PHASE_OFFSET / IH_BOB_AMPLITUDE / IH_BOB_SPEED / IH_FADE_IN_DURATION:
//     すべて仮値。大きさ・太陽との距離感・バウンスの揺れ方・出現の速さは見ながら調整してください。
//   - PLANETS: 各惑星の色・速度は仮値(速度が速いほど、軌跡のらせんの巻き数が増える)。
//   - バナナ本体の見た目: 既存banana.jsの資産を流用したい場合は、makeBananaMesh()を
//     そのモデルのgeometry/materialに差し替える形になります。
//   - (見送り) 惑星自身の公転軌道の形を太陽のorbitCurve(将来のバナナ変形含む)に合わせる件:
//     現状はpivotの単純な円運動なので、各惑星ごとにカーブを持たせて補間する実装に
//     組み替える必要があり複雑になるため未着手。必要になったら別途相談してください。