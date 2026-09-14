import * as THREE from 'three';
import { AXIS_LENGTH, AXIS_COLOR, UNIVERSE_CAMERA_POS, UNIVERSE_CAMERA_TARGET, UNIVERSE_CAMERA_DIR, UNIVERSE_CAMERA_DISTANCE } from './config.js';
import { makeTextSprite } from './axisLabels.js';

// ── 宇宙ページ用の疑似正射影(narrow FOV) ─────────────────────
//   ズーム量はconfig.js側のUNIVERSE_CAMERA_DISTANCEで調整する(小さいほど拡大)。
//   ここではfovだけ固定で指定する。
const UNIVERSE_PSEUDO_ORTHO_FOV_DEG = 2; // 仮値。見た目を見ながら調整してください

// ── 宇宙ページの右ドラッグ用: 疑似正射影 ⇄ 通常の透視図(UNIVERSE_CAMERA_POS基準) ──
//   ★ 2026-09-12 追加: 以前はmain.jsの右ドラッグ処理がsceneSetup.jsの
//   setProjectionMix(ホーム画面用。HOME_CAMERA_POS/HOME_FOV基準)をそのまま流用して
//   いたため、右ドラッグするとカメラがUNIVERSE_CAMERA_POSとは無関係な位置・fovへ
//   飛んでしまっていた(「謎の画角」の原因のひとつ)。
//   ここではUNIVERSE_CAMERA_TARGET/DIR/DISTANCEを基準に同じ考え方(dolly zoom。
//   fovを変えた分だけ距離を変えて、画面上の見た目の大きさをなるべく保つ)で
//   やり直す。DIRはmix=0でもmix=1でも共通なので、「見ている角度(UNIVERSE_CAMERA_POSの
//   角度)」は一切変わらず、距離だけがドラッグ量に応じて変化する。
//
//   ★ 2026-09-12 再変更(ご指示反映): 「あの位置(距離)のまま、fovだけ広角にして
//   迫力を出したい(対象は小さめに写ってよい)」とのことなので、距離とfovを分離した。
//   PERSPECTIVE_REFERENCE_FOV_DEGは「距離を決めるためだけ」に使う基準値(=見え方が
//   気に入っていた元のfov=50のときの距離を再現するためのもの。これ自体は画面には
//   出ない)。実際にcamera.fovへセットするのはUNIVERSE_PERSPECTIVE_FOV_DEGの方で、
//   これを広角(大きい値)にすると、距離はそのままなのに画角だけ広がる → 対象が
//   相対的に小さく、周辺がより歪んで写る(=広角レンズで迫力を出す見た目)。
const UNIVERSE_PERSPECTIVE_REFERENCE_FOV_DEG = 50; // 距離を決めるための基準fov(位置決め専用。変更しない)
const UNIVERSE_PERSPECTIVE_FOV_DEG = 90; // 実際に使う広角fov(仮値。大きいほど広角・迫力が出る。見た目を見ながら調整してください)

export function createUniverseProjectionMixer(camera) {
  const orthoDistance = UNIVERSE_CAMERA_DISTANCE; // mix=0(既定の疑似正射影)での距離
  const orthoHalfFovRad = THREE.MathUtils.degToRad(UNIVERSE_PSEUDO_ORTHO_FOV_DEG / 2);
  const referenceHalfFovRad = THREE.MathUtils.degToRad(UNIVERSE_PERSPECTIVE_REFERENCE_FOV_DEG / 2);
  // 「気に入っていた元の位置」を再現するための距離。UNIVERSE_PERSPECTIVE_FOV_DEGでは
  // なく、常に基準fov(50)から逆算する(=表示fovを広角にしても、この距離は動かない)。
  const perspectiveDistance = orthoDistance * (Math.tan(orthoHalfFovRad) / Math.tan(referenceHalfFovRad));

  // mix: 0(既定の疑似正射影・UNIVERSE_CAMERA_POSそのもの)〜1(同じ角度・同じ距離のまま、fovだけ広角の透視図まで進む)。
  return function setUniverseProjectionMix(mix) {
    const m = THREE.MathUtils.clamp(mix, 0, 1);
    const distance = THREE.MathUtils.lerp(orthoDistance, perspectiveDistance, m);
    camera.fov = THREE.MathUtils.lerp(UNIVERSE_PSEUDO_ORTHO_FOV_DEG, UNIVERSE_PERSPECTIVE_FOV_DEG, m);
    camera.position.copy(UNIVERSE_CAMERA_TARGET).addScaledVector(UNIVERSE_CAMERA_DIR, distance);
    camera.updateProjectionMatrix();
    camera.lookAt(UNIVERSE_CAMERA_TARGET);
    return m;
  };
}

// ══════════════════════════════════════════════════════════════
// ── 「宇宙ページ」: Phase3以降、画面クリックで遷移する別シーン ──────────
// ══════════════════════════════════════════════════════════════
//
// 仕様(ご指示より):
//   - 三軸は「三脚(アンブレラ)」状に組み替えた: 三軸の交点である"頂点"(=原点)は
//     ワールドの高さ軸(world Y)の上に固定し、X/Y/Zそれぞれの終端点は高さ0(y=0)の
//     平面上に120°間隔で配置する。3終端は対称配置なので「頂点→終端」の3本の長さは
//     自動的にすべて等しくなる(=軸の長さは自然に揃う)。
//   - 回転軸はその「高さ軸(world Y)」そのもの。頂点はこの軸の上に乗っているため、
//     このまわりに回してもワールド座標としての頂点自体は動かず、終端3点だけが
//     カルーセルのようにぐるっと回る。固定のワールド軸なので、カメラ向きに依存せず
//     毎フレームcomputeScreenFrame(camera)する必要もない(ジオメトリも増やしていない)。
//   - X/Y/Zの終端点にはaxisLabels.jsのmakeTextSprite()を再利用してラベルを貼ってある。
//     Spriteは常にカメラの方を向くので、三脚がぐるぐる回っても文字は常に読める。
//   - 方程式画像は、頂点(原点)からさらに「高さ軸の正方向」へ掲げる。
//   - 画面クリックのたびに、2枚用意した方程式画像を交互にクロスフェードで切り替える(従来通り)。
//   - マウスが方程式画像に近づくほど、画像の色がじわっと変化する遊び要素を追加した
//     (updateEquationHoverByPointer。詳細は該当セクション参照)。
//   - 視点はenterUniverse時に宇宙ページ専用のカメラ位置(UNIVERSE_CAMERA_POS / UNIVERSE_CAMERA_TARGET。
//     config.js側でHOME_CAMERA_POS / HOME_CAMERA_TARGETとは独立して定義)へ合わせるが、
//     以後カメラのcontrolsは無効化しない(=自由に動かせる)。
//
// main.js側の想定される呼び出し方:
//   import {
//     createUniverse, enterUniverse, toggleUniverseEquation,
//     updateUniverse, updateEquationHoverByPointer,
//     revealTripodRing, liftTripod, startTripodRoofPulse,
//   } from './universe.js';
//   const universe = createUniverse(scene);              // 起動時に1回
//   // Phase3完了後、画面クリックを検知したら:
//   if (!universe.isActive) {
//     enterUniverse(universe, { camera, controls, onComplete: () => {} });
//   } else {
//     toggleUniverseEquation(universe);
//   }
//   // 毎フレームのレンダーループ内(cameraは不要):
//   updateUniverse(universe, deltaSeconds);
//   // pointermoveハンドラ内で(isActiveでない間は内部で即returnするので呼びっぱなしでよい):
//   updateEquationHoverByPointer(universe, camera, e.clientX, e.clientY);
//   // クリック処理内(宇宙ページがアクティブな時のみ判定すればOK):
//   //   raycaster.intersectObject(universe.tripodHitMesh, true)[0] がヒットしたら、
//   //   revealTripodRing / liftTripod / startTripodRoofPulse をまとめて呼ぶ
//   //   (金のリング→円錐状の粒子、の順で出現する一連の演出)。ih.pngはこの後、
//   //   tripodRingSwap.js側がリングの位置(下限にいるか)を見て自動的に出し入れする
//   //   (setIhFade。詳細はtripodRingSwap.js参照)。
//
// ★ 太陽系(solarSystem.js)・銀河(galaxy.js)は方針転換により廃止した。このファイルは
//   それらに依存していない(importもしていない)。

// ── 方程式画像(白背景・黒インクのフラット1枚絵)を、
//    黒背景シーンに映えるテクスチャへ変換する ────────────────────
// 元画像はアルファチャンネルを持たない(RGB)ため、明度からアルファを合成し直す:
// 黒(インク部分)→不透明、白(背景)→透明。RGBは白に塗り替えておくことで、
// SpriteMaterial.color(トーン)で好きな色に染められるようにする。
// 8000px幅の元画像をそのまま処理すると重いので、表示に十分な解像度まで縮小してから処理する。
const CANVAS_MAX_WIDTH = 2400;

export function loadInkTexture(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, CANVAS_MAX_WIDTH / img.naturalWidth);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      let imageData;
      try {
        imageData = ctx.getImageData(0, 0, w, h);
      } catch (err) {
        console.error('loadInkTexture: getImageData失敗', err);
        reject(err);
        return;
      }
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const luminance = (data[i] + data[i + 1] + data[i + 2]) / 3;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 255 - luminance; // 黒(0)→不透明(255)、白(255)→透明(0)
      }
      ctx.putImageData(imageData, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      resolve({ texture, aspect: w / h });
    };
    img.onerror = (err) => {
      console.error('loadInkTexture: 画像読み込み失敗', err);
      reject(err);
    };
    img.src = url;
  });
}

// ── 表示する2枚の方程式画像。クリックのたびにこの順で交互に切り替わる ──────
const EQUATION_IMAGES = [
  { key: 'standard', url: new URL('./data/S_equation.png', import.meta.url).href },      // iħ∂ψ/∂t = Ĥψ
  { key: 'carousel', url: new URL('./data/righthand.png', import.meta.url).href },   // i(h/Carousel)∂ψ/∂t = Ĥψ
];

const EQUATION_WORLD_WIDTH = 7;      // 画像の表示幅(ワールド単位、仮値)
const EQUATION_HEIGHT_ABOVE_APEX = AXIS_LENGTH * 0.15; // 頂点(原点)からさらに外側へどれだけ離すか(仮値)
const EQUATION_CROSSFADE_DURATION = 0.9; // クリックで画像を切り替えるときのクロスフェード秒数

// ── カメラの「平衡感覚」を固定するための首振り角度の制限 ──────────────
// OrbitControls自体はcamera.upを軸にazimuth(水平)/polar(上下)にしか回転しないため、
// 原理上ロール(横に傾く)はしない。ただしpolar角度に制限が無いと、真上・真下(極)を
// 跨いで回り込めてしまい、その瞬間に見た目上「天地がひっくり返った」ように感じられる
// (これが体感上の「平衡感覚が狂う」の正体)。移動・首振り自体は制限せず、
// 「極を跨げない」よう上下の角度だけ制限することで、水平線が常に安定して見えるようにする。
const MIN_POLAR_ANGLE = THREE.MathUtils.degToRad(8);   // ほぼ真上の手前で止める(仮値)
const MAX_POLAR_ANGLE = THREE.MathUtils.degToRad(172); // ほぼ真下の手前で止める(仮値)

// ── 三脚(アンブレラ)状の頂点・終端の座標を決める ──────────────────
// 「頂点(原点)は高さ軸(world Y)の上に固定」「終端3点は高さ0の平面上に120°間隔」という
// 条件を、頂点からの傾き角(TRIPOD_ANGLE_FROM_VERTICAL_DEG)ひとつで決める。
// 対称配置になるので、頂点→終端の距離(=軸の長さ)は3本とも自動的にAXIS_LENGTHで揃う。
const TRIPOD_ANGLE_FROM_VERTICAL_DEG = 54.7356 // 高さ軸から各軸線をどれだけ傾けるか。きれいな角度を採用(仮値、調整可)
const TRIPOD_ANGLE_FROM_VERTICAL = THREE.MathUtils.degToRad(TRIPOD_ANGLE_FROM_VERTICAL_DEG);
// ↓ 金のリング(makeGoldenRing)・円錐状の粒子(makeRoofParticles)の半径として、
//   このファイル内で使う。(以前はsolarSystem.js側の太陽系の公転半径とも揃えていたが、
//   太陽系は廃止したのでその用途は無くなった。exportはこのまま残してある)
export const TRIPOD_RADIUS = AXIS_LENGTH * Math.sin(TRIPOD_ANGLE_FROM_VERTICAL); // 終端3点の、高さ軸からの水平距離
const APEX_HEIGHT   = AXIS_LENGTH * Math.cos(TRIPOD_ANGLE_FROM_VERTICAL); // 頂点(原点)の高さ
// 終端3点・金のリングが乗る「地面」のワールドY。以前はmakeGoldenRing内に0を直書きしていたが、
// tripodRingSwap.js・main.js(銀河の配置)など他ファイルからも同じ基準を参照したいため定数化した。
export const TRIPOD_GROUND_Y = 0;

// 三軸の交点(頂点)。高さ軸(world Y)上に固定。
const ORIGIN = new THREE.Vector3(0, APEX_HEIGHT, 0);

// 高さ0の平面上、高さ軸まわりの角度angleDegの位置に終端点を置く。
function tipOnGroundPlane(angleDeg) {
  const a = THREE.MathUtils.degToRad(angleDeg);
  return new THREE.Vector3(TRIPOD_RADIUS * Math.cos(a), 0, TRIPOD_RADIUS * Math.sin(a));
}

// X/Y/Zの終端。120°ずつずらして三脚状に配置(どの角度をどの軸にするかに意味はなく、見た目の割り当て)。
const AXIS_TIPS = {
  X: tipOnGroundPlane(0),
  Y: tipOnGroundPlane(120),
  Z: tipOnGroundPlane(240),
};

// 回転軸=「高さ軸(world Y)」そのもの。頂点(ORIGIN)はこの軸の直上(x=0, z=0)にあるため、
// このまわりに回転させても頂点自体は動かない ── 終端3点だけがカルーセルのようにぐるっと回る。
// 固定のワールド軸なので、カメラの向きに依存せず毎フレーム計算し直す必要もない。
const ROTATION_AXIS_DIR = new THREE.Vector3(0, 1, 0);

// 頂点からさらに高さ軸の正方向。方程式画像はこの向きに掲げる。
const APEX_OUTWARD_DIR = new THREE.Vector3(0, 1, 0);

// ↓ 太陽系の主軌道(solarSystem.js)・レコードプレーヤー(record.js)側が「三脚頂点からさらに
//   外側」を共有アンカーとして参照するためexportしてある(以前のRECORD_ANCHOR復活)。
export const RECORD_ANCHOR = ORIGIN.clone().addScaledVector(APEX_OUTWARD_DIR, EQUATION_HEIGHT_ABOVE_APEX);

// ── 頂点→各終端の3本の軸線を作る(以前のcreateRotatingAxes()と同じ、追加の辺はなし) ──
function makeAxisLine(tip) {
  const geo = new THREE.BufferGeometry().setFromPoints([ORIGIN, tip]);
  const mat = new THREE.LineBasicMaterial({ color: AXIS_COLOR, transparent: true, opacity: 0 });
  return new THREE.Line(geo, mat);
}

// ── 金のリング(tripodクリックで、ih.pngと一緒にフェードイン) ─────────────
// tripodの終端3点が描く円(=カルーセルの外周、高さ0・半径TRIPOD_RADIUS)をなぞる、
// 金色の細いリング。実際の軸線は回転で位置が変わるが、このリングは終端が通る円周上に
// 固定して置くだけなので、tripodの自転(updateUniverseの回転)に合わせて動かす必要はない
// (円は回転対称なので、動かなくても「ぐるぐる回る三脚の外周をなぞっている」ように見える)。
const RING_COLOR = 0xffcc33;                  // 仮値(金色)
const RING_TUBE_RADIUS = AXIS_LENGTH * 0.018; // リングの太さ(仮値)
const RING_FADE_DURATION = 1.4;               // フェードインの秒数(仮値)

function makeGoldenRing() {
  const geometry = new THREE.TorusGeometry(TRIPOD_RADIUS, RING_TUBE_RADIUS, 12, 96);
  const material = new THREE.MeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2; // Torusは既定でXY平面上の輪になるので、水平(XZ平面)へ寝かせる
  mesh.position.set(0, TRIPOD_GROUND_Y, 0); // 終端3点と同じ高さ
  mesh.visible = false;          // tripodクリックまで隠しておく
  return mesh;
}

// ── tripodクリック判定用の当たり判定 ────────────────────────
// 実際の軸線は細く、そのままだとクリックで狙いにくいため、このプロジェクトの他の
// 隠しボタン(banana・sunなど)と同じ「ほぼ透明の大きめのメッシュ」方式にする。
// tripod全体(頂点〜終端3点)をちょうど包む球を、頂点と終端の中間の高さに置く。
const TRIPOD_HIT_RADIUS = Math.max(APEX_HEIGHT, TRIPOD_RADIUS) * 1.15; // 仮値
function makeTripodHitMesh() {
  const geometry = new THREE.SphereGeometry(TRIPOD_HIT_RADIUS, 16, 16);
  const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, APEX_HEIGHT / 2, 0); // 頂点(y=APEX_HEIGHT)と終端(y=0)のちょうど中間(仮値)
  return mesh;
}

// ── tripodが回転しながら残していく粒子の軌跡(「常時見える円錐」) ─────────
// 以前の「axesGroupの子にして一緒に回す」方式とは逆で、今回は粒子を
// **ワールド空間に固定**する。tripodの3本の脚それぞれについて、実際に今いる
// ワールド座標を一定の回転角おきに記録し、そこに新しい粒子を1個ずつ生成していく
// (=「その位置からリアルタイムで粒子を生成する」)。生成された粒子はもう動かない。
// tripodは回転し続けるので、結果として「軸線が今まさに掃いている最新位置」の周りに、
// 過去に生成された粒子がリング状に取り巻く円錐が常に見える状態になる。
//
// 各粒子は生成された瞬間は透明(alpha=0)で、ROOF_FADE_DURATION秒かけて
// ROOF_MAX_ALPHAまでゆっくり浮かび上がる(「透明度も変える」)。
// また、生成される粒子の色は、tripodの累積回転角を1/6周期(60°)ごとに区切って
// 黄緑↔オレンジを交互に切り替える。これにより、軸線本体の色(白系)+過去の軌跡の
// 黄緑/オレンジの帯、という3色構成の円錐が常時見える形になる。
//
// リングバッファは「ちょうど1周分」の容量にしてあるので、tripodが1周してくる頃には
// ずっと前に生成した粒子の枠を新しい粒子で上書きする形になり、位置はほぼ同じまま
// (毎周、同じ場所が改めてふわっと浮かび上がる)、メモリも増え続けない。
const ROOF_SPAWN_ANGLE_STEP = THREE.MathUtils.degToRad(1); // 1本の脚が何度回転するごとに1粒子生成するか(仮値。以前の3倍の密度)
const ROOF_POINTS_PER_LEG = Math.round((Math.PI * 2) / ROOF_SPAWN_ANGLE_STEP); // 1周ぶんの生成数/脚
const ROOF_RING_CAPACITY = ROOF_POINTS_PER_LEG * 3; // 3脚ぶん(=1周ぶんの総容量)
const ROOF_PARTICLE_JITTER = AXIS_LENGTH * 0.02; // 脚の線からのランダムなブレ幅(仮値。太さの演出)
// ★ 2026-09-12 修正(ご指示反映):「背景(銀河)のせいで屋根の粒子が見えない」への対応。
//   下のROOF_VERTEX_SHADERにある gl_PointSize *= (1.0 / -viewPosition.z) は、カメラからの
//   距離に反比例して点を小さくする(通常の遠近感)ための処理。ところが宇宙ページのカメラは
//   疑似正射影化のためconfig.js側のUNIVERSE_CAMERA_DISTANCEを非常に大きい値(距離約1000)に
//   設定しているため、この除算の分母が以前(距離約85)の10倍以上になり、粒子がほぼ見えない
//   サイズまで縮んでしまっていた。UNIVERSE_CAMERA_DISTANCEに比例してuSize側を底上げする
//   ことで、カメラ距離を今後さらに調整しても見かけの大きさが保たれるようにした。
//   ROOF_VISIBILITY_BOOSTは「もう少し目立たせて」の上乗せぶん(仮値。ブラー/発光は
//   AdditiveBlending+Bloom(main.js側、除外リストに入れていない)がそのまま効くので、
//   まずは粒子自体が見えるサイズに戻すだけで十分目立つはず。それでも足りなければこの値を
//   さらに上げるか、下のROOF_MAX_ALPHAを上げてみてください)。
const ROOF_REFERENCE_DISTANCE = 85; // 旧UNIVERSE_CAMERA_POSの距離感(この比率を基準に補正する)
const ROOF_VISIBILITY_BOOST = 1.5;  // 仮値。この演出だけをさらに目立たせたい場合はここを上げる
const ROOF_PARTICLE_SIZE = AXIS_LENGTH * 0.16
  * Math.max(1, UNIVERSE_CAMERA_DISTANCE / ROOF_REFERENCE_DISTANCE)
  * ROOF_VISIBILITY_BOOST;
export const ROOF_FADE_DURATION = 1.5;           // 1粒子が生成されてからフル不透明になるまでの秒数(仮値)
const ROOF_MAX_ALPHA = 0.9;                      // フル不透明時の上限(0.75→0.9。仮値。さらに目立たせたければ1.0まで上げてよい)
const ROOF_SIXTH = (Math.PI * 2) / 6;            // 「1/6周」= 60°
const ROOF_COLOR_GREEN = new THREE.Color(0xa8e05f);  // 黄緑(仮値)
const ROOF_COLOR_ORANGE = new THREE.Color(0xff8c1a); // オレンジ(仮値)

const ROOF_VERTEX_SHADER = /* glsl */ `
  uniform float uSize;
  uniform float uPixelRatio;
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;
    gl_Position = projectedPosition;
    gl_PointSize = uSize * uPixelRatio;
    gl_PointSize *= (1.0 / -viewPosition.z);
    vColor = aColor;
    vAlpha = aAlpha;
  }
`;
const ROOF_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float strength = 1.0 - smoothstep(0.0, 0.5, distance(gl_PointCoord, vec2(0.5)));
    if (strength <= 0.0 || vAlpha <= 0.0) discard;
    gl_FragColor = vec4(vColor, strength * vAlpha);
  }
`;

// scene直下(ワールド空間に固定)に追加する前提。position/aColor/aAlphaは
// startTripodRoofPulse呼び出し後、updateUniverse側で少しずつ書き込んでいく
// (作成時点では全て「まだ生成されていない」= alpha0の空の状態)。
function makeRoofParticles() {
  const positions = new Float32Array(ROOF_RING_CAPACITY * 3);
  const colors = new Float32Array(ROOF_RING_CAPACITY * 3);
  const alphas = new Float32Array(ROOF_RING_CAPACITY); // 全て0で初期化(=まだ何も見えない)

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: ROOF_VERTEX_SHADER,
    fragmentShader: ROOF_FRAGMENT_SHADER,
    uniforms: {
      uSize: { value: ROOF_PARTICLE_SIZE },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.visible = false; // startTripodRoofPulseまで隠しておく
  points.frustumCulled = false; // ワールド全体に散らばるため、カリングで消えないようにする
  return points;
}

// 1本の脚ぶん、ワールド座標のapex→tipの間に1粒子ぶんの位置をランダムに決めて
// リングバッファのslotへ書き込む(位置・色・alpha=0・経過時間リセット)。
const _roofSpawnPos = new THREE.Vector3();
function spawnRoofParticle(universe, worldOrigin, worldTip, color) {
  const slot = universe.roofWriteIndex;
  universe.roofWriteIndex = (universe.roofWriteIndex + 1) % ROOF_RING_CAPACITY;

  const s = Math.random();
  _roofSpawnPos.copy(worldOrigin).lerp(worldTip, s);
  _roofSpawnPos.x += (Math.random() - 0.5) * ROOF_PARTICLE_JITTER;
  _roofSpawnPos.y += (Math.random() - 0.5) * ROOF_PARTICLE_JITTER;
  _roofSpawnPos.z += (Math.random() - 0.5) * ROOF_PARTICLE_JITTER;

  const posAttr = universe.roofParticles.geometry.attributes.position;
  const colorAttr = universe.roofParticles.geometry.attributes.aColor;
  posAttr.setXYZ(slot, _roofSpawnPos.x, _roofSpawnPos.y, _roofSpawnPos.z);
  colorAttr.setXYZ(slot, color.r, color.g, color.b);
  posAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;
  universe.roofSpawnElapsed[slot] = 0; // フェードインをここから開始
}

// ── ih.png(tripodクリックのシーケンス最後に出現) ────────────────────
// 金のリング(半径TRIPOD_RADIUS。高さはtripodRingSwap.js側で動く)のすこし内側・かつ
// リングより高い位置(IH_ABOVE_RING_MARGIN)を、回転木馬の馬車のように上下にバウンス
// しながら周回させる。
//
// ★ ご指示反映(2回目の修正):
//   1) 前回、front/backの割り当てが逆(180°反転して見える)だった。原因はThree.jsの仕様で、
//      Object3D.lookAt(target)はカメラ/ライト以外(Mesh等)の場合、ローカル「+Z」軸をtargetへ
//      向ける(カメラの場合の-Zとは逆)。これに合わせてfront/backの割り当てを直した
//      (下記のmakeIhObject参照)。
//   2) 「画像そのもの(四角いカード)に厚みが付いているのではなく、画像内の文字自体に厚みを
//      付けたい」とのご指示のため、単純な直方体(Box)をやめ、「同じ絵をごくわずかにずらして
//      何枚も重ねる」印刷レリーフ的な手法に変更した。各層はalphaTestで透明部分を描画しないため、
//      四角いカードの外形は見えず、インクの形(文字部分)だけが厚みを持って見える
//      (=浮世絵の版画を何層も重ねたような「盛り上がり」の質感)。
//   3) 側面(厚み部分)専用の金色(IH_EDGE_COLOR)は廃止。ih自体は元々白(0xffffff)で
//      使われているとのことなので、front/backとも白のみを使う(黄色いブラーの原因だった側面
//      マテリアル自体をなくした)。
//   向きはカメラを追わず、「円の外側(=惑星でいう遠心力方向)」へ固定する
//   (updateIhOrbitPosition内でlookAtにより毎フレーム計算)。
// ★ プロパティ名はuniverse.ihSpriteのまま(main.js側の参照を変えずに済むように)残してあるが、
//   実体はもうTHREE.Spriteではない点に注意。
const IH_IMAGE_URL = new URL('./data/ih.png', import.meta.url).href;
const IH_WORLD_HEIGHT = 8.4;        // 表示の高さ(ワールド単位、仮値。以前の70%に縮小。幅はimg比率から自動計算)
const IH_THICKNESS = IH_WORLD_HEIGHT * 0.1; // 「文字自体の厚み」の総厚さ(ワールド単位、仮値。見ながら調整)
const IH_EXTRUDE_LAYERS = 10;       // 前面・背面それぞれに重ねる薄い層の枚数(仮値。多いほど厚みが滑らかに見えるが重くなる)
const IH_LAYER_ALPHA_TEST = 0.4;    // これ未満のアルファ(=絵の透明な背景部分)は描画しない、が反映される閾値(仮値)
const IH_ORBIT_RADIUS = TRIPOD_RADIUS * 0.85; // リングより「すこし内側」を周回する半径(仮値)
// ★ 2026-09-12 修正(ご指示反映):「ihの高さがおかしいのでリングの上に配置して。ただし
//   下振れの時にリングより低くならないよう少し高めに」への対応。以前はIH_ORBIT_HEIGHTが
//   「金のリングは常にy=0」という前提の絶対的な固定値だったが、tripodRingSwap.js側の
//   変更でリング(universe.goldenRing)自体がcarousel/鏡切り替えに応じて上下に動くように
//   なったため、ih側だけが元の高さに取り残されて「リングとの上下関係がおかしい」状態に
//   なっていた。そこでih側は絶対値ではなく「リングの現在の高さ(universe.goldenRing.
//   position.y。これはtripodRingSwap.js側が毎フレーム書き換える)からの相対的な底上げ量」
//   IH_ABOVE_RING_MARGINへ変更した。下のIH_BOB_AMPLITUDEぶん上下にバウンスしても
//   リングを下回らないよう、IH_ABOVE_RING_MARGIN > IH_BOB_AMPLITUDE にしてある
//   (調整したい場合はこのIH_ABOVE_RING_MARGINを変えてください。値を大きくするほど
//   リングから高く浮きます)。
const IH_ABOVE_RING_MARGIN = AXIS_LENGTH * 0.35; // リングの高さからどれだけ上に配置するか(仮値)
const IH_ORBIT_SPEED = 0.35;        // 周回の角速度(ラジアン/秒、仮値)
const IH_BOB_AMPLITUDE = AXIS_LENGTH * 0.12; // 上下バウンスの振幅(仮値。IH_ABOVE_RING_MARGINより必ず小さくすること)
const IH_BOB_SPEED = 1.6;           // 上下バウンスの速さ(ラジアン/秒、仮値)

// Groupの直下に、front(表)用・back(裏)用それぞれIH_EXTRUDE_LAYERS枚の薄いPlaneを重ねて置く。
// front(表)は無加工のih.pngをそのままz=0〜+halfThicknessへ、back(裏)は左右反転した
// テクスチャをz=0〜-halfThicknessへ(-Z方向を向くようrotation.y=πした状態で)配置する。
// 「front=+Z寄り・無加工テクスチャ」を採用しているのは、Object3D.lookAt(target)が
// Mesh/Group(カメラ・ライト以外)の場合はローカル「+Z」軸をtargetへ向ける仕様のため
// ── updateIhOrbitPositionで「円の外側」をlookAtするだけで、自然にfrontが外側
// (遠心力方向)を向くようになる。
function makeIhObject() {
  const group = new THREE.Group();
  const frontMaterials = [];
  const backMaterials = [];
  const halfThickness = IH_THICKNESS / 2;
  const planeGeometry = new THREE.PlaneGeometry(1, 1); // 全層で共有(幅・高さはgroup.scaleで一括調整)

  for (let i = 0; i < IH_EXTRUDE_LAYERS; i++) {
    const t = IH_EXTRUDE_LAYERS === 1 ? 0 : i / (IH_EXTRUDE_LAYERS - 1); // 0(中央)→1(最も外側)
    const zOffset = t * halfThickness;

    const frontMat = new THREE.MeshBasicMaterial({
      map: null, color: 0xffffff, transparent: true, opacity: 0,
      alphaTest: IH_LAYER_ALPHA_TEST, depthWrite: true, side: THREE.FrontSide,
    });
    const frontPlane = new THREE.Mesh(planeGeometry, frontMat);
    frontPlane.position.z = zOffset; // +Z側(front)
    group.add(frontPlane);
    frontMaterials.push(frontMat);

    const backMat = new THREE.MeshBasicMaterial({
      map: null, color: 0xffffff, transparent: true, opacity: 0,
      alphaTest: IH_LAYER_ALPHA_TEST, depthWrite: true, side: THREE.FrontSide,
    });
    const backPlane = new THREE.Mesh(planeGeometry, backMat);
    backPlane.position.z = -zOffset; // -Z側(back)
    backPlane.rotation.y = Math.PI;  // 法線を-Z方向へ向ける(裏側から見える面にする)
    group.add(backPlane);
    backMaterials.push(backMat);
  }

  group.userData.frontMaterials = frontMaterials;
  group.userData.backMaterials = backMaterials;
  group.visible = false; // setIhFadeで表示に切り替わるまで隠しておく
  return group;
}

// ihの周回位置・向きを、経過秒数(universe.ihElapsed)から計算してmeshへ反映する。
// setIhFade(非表示→表示に切り替わった瞬間の位置合わせ)とupdateUniverse(毎フレーム)の両方から呼ぶ。
const _ihOutwardTarget = new THREE.Vector3();
function updateIhOrbitPosition(universe) {
  const angle = universe.ihElapsed * IH_ORBIT_SPEED;
  const x = IH_ORBIT_RADIUS * Math.cos(angle);
  const z = IH_ORBIT_RADIUS * Math.sin(angle);
  const y = universe.goldenRing.position.y + IH_ABOVE_RING_MARGIN + IH_BOB_AMPLITUDE * Math.sin(universe.ihElapsed * IH_BOB_SPEED);
  universe.ihSprite.position.set(x, y, z);

  // 固定方向: カメラを追わず、「円の外側」(=中心軸から見た放射方向。惑星でいう遠心力の向き)へ
  // 常に固定する。放射方向は角度(x, z)だけで決まり、高さ(y)には依存しない。
  _ihOutwardTarget.set(x * 2, y, z * 2); // 現在位置よりさらに外側の点をlookAtのターゲットにする
  universe.ihSprite.up.set(0, 1, 0);
  universe.ihSprite.lookAt(_ihOutwardTarget);
}

// ── 終端点のラベル(X/Y/Z) ────────────────────────
// axisLabels.jsのmakeTextSprite()を再利用。Spriteは常にカメラを向くので、
// 三脚がぐるぐる回っても文字は常に読める向きのまま保たれる。
const AXIS_LABEL_OFFSET = 1.6;      // 終端よりどれだけ外側にラベルを置くか(線とかぶらないように)
const AXIS_LABEL_WORLD_SIZE = 2.2;  // ラベルの表示サイズ(ワールド単位)

function makeAxisTipLabel(name, tip) {
  const sprite = makeTextSprite(name, {
    canvasWidth: 128,
    canvasHeight: 128,
    worldWidth: AXIS_LABEL_WORLD_SIZE,
    worldHeight: AXIS_LABEL_WORLD_SIZE,
  });
  const dir = tip.clone().sub(ORIGIN).normalize();
  sprite.position.copy(tip).addScaledVector(dir, AXIS_LABEL_OFFSET);
  sprite.material.opacity = 0; // 軸線・数式と一緒にフェードインさせる(enterUniverse側)
  return sprite;
}

function createRotatingAxes() {
  const group = new THREE.Group();
  const xAxis = makeAxisLine(AXIS_TIPS.X);
  const yAxis = makeAxisLine(AXIS_TIPS.Y);
  const zAxis = makeAxisLine(AXIS_TIPS.Z);
  group.add(xAxis, yAxis, zAxis);

  const xLabel = makeAxisTipLabel('X', AXIS_TIPS.X);
  const yLabel = makeAxisTipLabel('Y', AXIS_TIPS.Y);
  const zLabel = makeAxisTipLabel('Z', AXIS_TIPS.Z);
  group.add(xLabel, yLabel, zLabel);

  return {
    group,
    lines: [xAxis, yAxis, zAxis],
    labels: [xLabel, yLabel, zLabel],
  };
}

// ── ワンセットの方程式スプライトを作る(まだテクスチャ未ロード、opacity=0) ──
function makeEquationSprite() {
  const material = new THREE.SpriteMaterial({
    map: null,
    color: EQUATION_COLOR_DEFAULT.clone(),
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(material);
  // 原点から、重心と反対側(APEX_OUTWARD_DIR)へさらに掲げる。
  sprite.position.copy(ORIGIN).addScaledVector(APEX_OUTWARD_DIR, EQUATION_HEIGHT_ABOVE_APEX);
  sprite.visible = false;
  return sprite;
}

// ── マウス接近で色が変化する遊び ────────────────────────
// カーソルが方程式画像(のスクリーン投影位置)へ近づくほど、白 → 虹色(スペクトル)へ
// じわっと変化する。単純な2色補間ではなく、距離(t)をそのままHSLの色相(hue)に
// マッピングしているので、「近づくほど色が濃くなる」だけでなく「近づく過程で
// 赤→橙→…→紫、とスペクトルを掃引していく」ように見える。
export const EQUATION_COLOR_DEFAULT = new THREE.Color(0xffffff);
const EQUATION_HOVER_RADIUS_PX = 240;   // この距離(px)以内に近づくほど色が変わり始める(仮値)
const EQUATION_SPECTRUM_HUE_FAR = 0;    // 半径のふち(t=0側)での色相。赤(仮値)
const EQUATION_SPECTRUM_HUE_NEAR = 300; // 一番近づいたとき(t=1)の色相。紫寄り(仮値。0-360で赤に戻らないよう300止まり)
const EQUATION_SPECTRUM_SATURATION = 0.85;
const EQUATION_SPECTRUM_LIGHTNESS = 0.6;

const _hoverColor = new THREE.Color();
const _hoverSpectrum = new THREE.Color();
const _hoverProjected = new THREE.Vector3();

// main.jsのpointermoveハンドラから毎回呼ぶ想定。宇宙ページが非アクティブ、または
// 表示中の方程式スプライトがまだ無い間は何もしない。
export function updateEquationHoverByPointer(universe, camera, clientX, clientY) {
  if (!universe || !universe.isActive) return;
  const sprite = universe.sprites[universe.equationIndex];
  if (!sprite || !sprite.visible) return;

  sprite.getWorldPosition(_hoverProjected);
  _hoverProjected.project(camera);
  const screenX = (_hoverProjected.x * 0.5 + 0.5) * window.innerWidth;
  const screenY = (1 - (_hoverProjected.y * 0.5 + 0.5)) * window.innerHeight;

  const dist = Math.hypot(clientX - screenX, clientY - screenY);
  const t = THREE.MathUtils.clamp(1 - dist / EQUATION_HOVER_RADIUS_PX, 0, 1);

  const hue = THREE.MathUtils.lerp(EQUATION_SPECTRUM_HUE_FAR, EQUATION_SPECTRUM_HUE_NEAR, t) / 360;
  _hoverSpectrum.setHSL(hue, EQUATION_SPECTRUM_SATURATION, EQUATION_SPECTRUM_LIGHTNESS);
  // t=0(遠い)では白のまま、t=1(近い)に近づくほどスペクトル色が濃く乗る
  _hoverColor.copy(EQUATION_COLOR_DEFAULT).lerp(_hoverSpectrum, t);
  sprite.material.color.copy(_hoverColor);
}

// scene: このシーン専用のTHREE.Sceneでも、既存sceneの続きに追加でもよい
// (main.js側で「Phase3までの要素は隠す/別レイヤーに逃がす」判断をしてから使う想定)。
export function createUniverse(scene) {
  // ★ tripod/ring対応スワップ演出(record.jsのmirrorGroupと位置を入れ替える)のための
  //   ラッパー。axesGroup自体はこれまで通りliftTripod・自転(rotateOnWorldAxis)で
  //   ローカルに動く/回るだけにしておき、スワップ演出はこのtripodAnchor(の.position)
  //   だけを動かすことで、既存のlift・回転ロジックと競合しないようにしてある。
  const tripodAnchor = new THREE.Group();
  scene.add(tripodAnchor);

  const { group: axesGroup, lines: axisLines, labels: axisLabels } = createRotatingAxes();
  tripodAnchor.add(axesGroup);

  const goldenRing = makeGoldenRing();
  scene.add(goldenRing);

  const tripodHitMesh = makeTripodHitMesh();
  scene.add(tripodHitMesh);

  // tripodが回転しながら残していく粒子の軌跡。ワールド空間に固定するので、
  // axesGroupの子ではなくsceneに直接追加する。
  const roofParticles = makeRoofParticles();
  scene.add(roofParticles);

  const ihSprite = makeIhObject();
  scene.add(ihSprite);
  new THREE.TextureLoader().load(
    IH_IMAGE_URL,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      const aspect = texture.image.width / texture.image.height;

      // 裏面(back)用に、左右反転したテクスチャを別途用意する。
      // BoxGeometryの-Z面(front)と+Z面(back)は互いに逆向きなので、同じUVのまま貼ると
      // 裏面の絵が鏡文字になってしまう。repeat.x=-1 + offset.x=1で水平反転し、
      // 裏側から見ても正しく読める「裏返し表示」にする。
      const backTexture = texture.clone();
      backTexture.wrapS = THREE.RepeatWrapping;
      backTexture.repeat.x = -1;
      backTexture.offset.x = 1;
      backTexture.needsUpdate = true;

      ihSprite.userData.frontMaterials.forEach((m) => { m.map = texture; m.needsUpdate = true; });
      ihSprite.userData.backMaterials.forEach((m) => { m.map = backTexture; m.needsUpdate = true; });
      // 厚み(Z)はジオメトリ側に焼き込み済みなので、ここではX/Y(幅・高さ)だけをscaleで合わせる。
      ihSprite.scale.set(IH_WORLD_HEIGHT * aspect, IH_WORLD_HEIGHT, 1);
    },
    undefined,
    (err) => console.error('createUniverse: ih.pngの読み込みに失敗', err)
  );

  // 2枚とも同じワールド位置に重ねて置き、クリック時はopacityのクロスフェードだけで切り替える。
  // ★ axesGroupの子にすることで、liftTripod(tripodの浮上)に数式も一緒についてくる。
  //   位置は原点(頂点)からの相対座標のままなので、tripodの自転そのものには影響を受けない
  //   (回転軸=world Yの直上にあるため、回転させても見た目の位置は変わらない)。
  const sprites = EQUATION_IMAGES.map(() => makeEquationSprite());
  for (const sprite of sprites) axesGroup.add(sprite);

  // テクスチャは起動時に一度だけ非同期ロードしておく(クリックのたびに読み直さない)。
  const texturesReady = EQUATION_IMAGES.map((asset, i) =>
    loadInkTexture(asset.url).then(({ texture, aspect }) => {
      const sprite = sprites[i];
      sprite.material.map = texture;
      sprite.material.needsUpdate = true;
      sprite.scale.set(EQUATION_WORLD_WIDTH, EQUATION_WORLD_WIDTH / aspect, 1);
      return { texture, aspect };
    }).catch((err) => {
      console.error(`createUniverse: 方程式画像(${asset.key})の読み込みに失敗`, err);
      return null;
    })
  );

  return {
    axesGroup,
    tripodAnchor,       // ← tripod/ring対応スワップ演出用。axesGroup全体の親(通常は原点のまま)
    axisLines,
    axisLabels,        // ← 追加: X/Y/Z終端のラベルsprite群(頂点とともに三脚を構成)
    goldenRing,         // ← tripodクリックで出現する金のリング(地面に固定、tripodと一緒には上がらない)
    tripodHitMesh,      // ← tripodクリック判定用(main.js側でraycastする)
    tripodRingRevealed: false, // ← 出現済みフラグ(二重フェードイン防止)
    tripodLifted: false,       // ← tripod浮上、二重発火防止
    roofParticles,             // ← tripodが残す粒子の軌跡(ワールド固定、scene直下)
    roofPulseActive: false,    // ← 生成ループが開始済みかどうか
    roofWriteIndex: 0,         // ← リングバッファの次の書き込み位置
    roofSpawnElapsed: new Float32Array(ROOF_RING_CAPACITY).fill(-1), // ← 各slotの生成からの経過秒数。-1=未生成
    roofLegSpawnAngle: [0, 0, 0], // ← 各脚ごとの「前回生成からの累積回転角」
    roofColorAngle: 0,             // ← 色帯切り替え用の累積回転角(2πで折り返す)
    ihSprite,           // ← tripodクリックで出現するih.png
    ihRevealed: false,  // ← 出現済みフラグ(二重フェードイン防止)
    // ★ 2026-09-12 追加: 「左右同時ドラッグ(疑似正射影⇄透視図の切り替え)を
    //   完了するまでは、ihを出現させたくない」とのご指示。tripodRingSwap.js側は
    //   リングの高さだけを見てsetIhFadeを毎フレーム呼び続けるので、その呼び出し自体を
    //   条件分岐で止めるのではなく、setIhFade側でこのフラグを見て「ロック中は常に
    //   非表示のまま」に強制する(=呼び出し元は変更不要)。unlockIh()でロック解除する。
    ihUnlocked: false,
    ihElapsed: 0,       // ← 出現してからの経過秒数(周回・バウンスの位相計算に使う)
    // ★ ihの「素の」不透明度(出現時のフェードインだけを反映した値。0〜1)。
    //   tripodRingSwap.js側が「tripodが動き始めたらすぐ消える」ための倍率(0〜1)を
    //   これに掛け合わせて最終的なopacityを決める(=どちらのフェードも独立に共存できる)。
    ihBaseOpacity: 0,
    sprites,           // [standard, carousel] の順
    texturesReady,     // Promise配列。enterUniverse側でPromise.allしてから表示する
    equationIndex: 0,  // 現在表示中の画像インデックス
    isActive: false,   // まだ「宇宙ページ」に入っていない(=Phase3までのシーンにいる)状態かどうか
  };
}

// ── tripodクリックで呼ぶ: 金のリングをフェードインさせる ─────────────
// リング自体は地面(y=0)に固定のまま。tripodがliftTripodで浮上しても、リングは
// 「元いた場所の目印」としてそのまま残る想定。
export function revealTripodRing(universe, { duration = RING_FADE_DURATION, onComplete } = {}) {
  if (universe.tripodRingRevealed) return;
  universe.tripodRingRevealed = true;
  universe.goldenRing.visible = true;
  gsap.to(universe.goldenRing.material, {
    opacity: 1,
    duration,
    ease: 'power1.out',
    onComplete: () => { if (onComplete) onComplete(); },
  });
}

// ── tripodクリックで呼ぶ: tripod自体を持ち上げる ────────────────────
const TRIPOD_LIFT_HEIGHT = APEX_HEIGHT * 0.9; // 浮上後の高さ(仮値)
const TRIPOD_LIFT_DURATION = 2.4;             // 浮上にかける秒数(仮値)

export function liftTripod(universe, { duration = TRIPOD_LIFT_DURATION, onComplete } = {}) {
  if (universe.tripodLifted) return;
  universe.tripodLifted = true;
  gsap.to(universe.axesGroup.position, {
    y: TRIPOD_LIFT_HEIGHT,
    duration,
    ease: 'power2.inOut',
    onComplete: () => { if (onComplete) onComplete(); },
  });
}

// ── tripodクリックで呼ぶ: 粒子の生成ループを開始する(以後、永久に続く) ─────
// 実際の生成・フェードイン・色帯の計算はupdateUniverse側で毎フレーム行う。ここでは
// 「開始する」フラグを立てて、粒子群を表示状態にするだけ。
export function startTripodRoofPulse(universe) {
  if (universe.roofPulseActive) return;
  universe.roofPulseActive = true;
  universe.roofParticles.visible = true;
}

// ── ih.pngの出現/消滅 ─────────────────────────────────────
// ★ 2026-09-12 再変更(ご指示反映):「単純にゴールドリングが下限にあるときだけihが
//   存在するようにしてほしい。中間位置のリングでもihが見えているのが気になる(屋根の
//   粒子と視覚的にぶつかる)」への対応。
//   前回実装(revealIh/hideIhをgsapで独立にタイマー駆動する方式)は、hide側の
//   フェードアウトに一定の秒数(IH_FADE_OUT_DURATION)をかけていたため、その間に
//   リング自体はどんどん下限から離れて中間位置まで進んでしまい、「ihがまだ薄っすら
//   残ったまま中間位置に居座って見える」原因になっていた。
//   そこで、時間で駆動する独立のフェードtweenはやめ、「リングが今どれだけ下限に
//   近いか(swapT)」だけを毎フレーム直接不透明度に反映する方式に変更した
//   (=tripodRingSwap.js側のsetIhFade呼び出し。下限からごく近い狭い範囲でだけ
//   フェードし、それ以外の範囲(中間位置を含む)ではopacity=0・非表示になる)。
//   record.viewMixCurrent自体が既にスクロールを指数スムージングしているため、
//   別途フェード用のtweenを持たなくても見た目は滑らかになる。

// tripodRingSwap.js側から毎フレーム呼ぶ: fade(0〜1、下限にどれだけ近いか)をそのまま
// ih.pngの不透明度として反映する。fade<=0ならその場で非表示にする(存在しない扱い)。
export function setIhFade(universe, fade) {
  // ★ 2026-09-12 追加: 左右同時ドラッグ(疑似正射影⇄透視図の切り替え)が完了するまでは、
  // fadeの値に関わらず常に非表示にする。
  if (!universe.ihUnlocked) {
    universe.ihRevealed = false;
    universe.ihBaseOpacity = 0;
    universe.ihSprite.visible = false;
    return;
  }
  const wasRevealed = universe.ihRevealed;
  universe.ihRevealed = fade > 0;
  universe.ihBaseOpacity = fade;
  if (universe.ihRevealed && !wasRevealed) {
    // 非表示→表示に切り替わった瞬間: 1フレーム目に古い位置(原点など)へ一瞬映るのを
    // 防ぐため、表示状態にする前に現在のリング位置基準で向き・座標を合わせておく。
    updateIhOrbitPosition(universe);
  }
  universe.ihSprite.visible = universe.ihRevealed;
}

// 左右同時ドラッグ完了(main.js側、record.perspectiveActiveがtrueになった瞬間)に呼ぶ。
// 以後はsetIhFadeの通常ロジック(リングの高さに応じたフェード)が有効になる。
export function unlockIh(universe) {
  universe.ihUnlocked = true;
}

// ── 毎フレーム呼ぶ: 3本の軸線(+ラベル)を「高さ軸(world Y)」まわりに、カルーセルのように
//    ぐるっと回転させる(座標変換のみ。線やジオメトリは増やしていない) ──
// 頂点(ORIGIN)はこの軸の直上にあるため、回転させても頂点自体はワールド座標上で動かない。
// 固定のワールド軸なので、カメラの向きに依存しない。そのためcameraは不要。
const ANGULAR_SPEED = 0.18; // ラジアン/秒。仮値、見ながら調整してください
// ↓ record.js側の鏡三角錐が「回転周期を共有」するためexportしてある(ご指示反映)。
export const TRIPOD_ANGULAR_SPEED = ANGULAR_SPEED;

const _roofWorldOrigin = new THREE.Vector3();
const _roofWorldTip = new THREE.Vector3();
const ROOF_LEG_TIPS = [AXIS_TIPS.X, AXIS_TIPS.Y, AXIS_TIPS.Z];

export function updateUniverse(universe, deltaSeconds, camera) {
  if (!universe.isActive) return;
  const rotationDelta = -ANGULAR_SPEED * deltaSeconds;
  universe.axesGroup.rotateOnWorldAxis(ROTATION_AXIS_DIR, rotationDelta);

  if (universe.roofPulseActive) {
    // rotateOnWorldAxisの直後、localToWorldで最新のワールド座標を取るためには
    // matrixWorldを明示的に更新しておく必要がある(render()まで待つと1フレーム遅れるため)。
    universe.axesGroup.updateMatrixWorld(true);

    const rotationStep = Math.abs(rotationDelta);

    // 色帯(1/6周=60°ごとに黄緑⇔オレンジを切り替え)。生成される新しい粒子の色を決めるだけで、
    // 過去に生成済みの粒子の色は変わらない(=円周上に交互の帯として固定される)。
    universe.roofColorAngle = (universe.roofColorAngle + rotationStep) % (Math.PI * 2);
    const bandIndex = Math.floor(universe.roofColorAngle / ROOF_SIXTH) % 2;
    const spawnColor = bandIndex === 0 ? ROOF_COLOR_GREEN : ROOF_COLOR_ORANGE;

    // 3本の脚それぞれについて、「前回の生成からどれだけ回転したか」を個別に積算し、
    // ROOF_SPAWN_ANGLE_STEPを超えるたびにワールド座標を取って1粒子生成する
    // (1フレームでの回転量がステップ幅を超えるほど速い場合に備え、whileで複数回に分けて処理する)。
    universe.axesGroup.localToWorld(_roofWorldOrigin.copy(ORIGIN));
    ROOF_LEG_TIPS.forEach((tip, legIndex) => {
      universe.roofLegSpawnAngle[legIndex] += rotationStep;
      while (universe.roofLegSpawnAngle[legIndex] >= ROOF_SPAWN_ANGLE_STEP) {
        universe.roofLegSpawnAngle[legIndex] -= ROOF_SPAWN_ANGLE_STEP;
        universe.axesGroup.localToWorld(_roofWorldTip.copy(tip));
        spawnRoofParticle(universe, _roofWorldOrigin, _roofWorldTip, spawnColor);
      }
    });

    // 全slotのフェードイン(生成からの経過秒数→alpha)を毎フレーム更新する。
    // ROOF_RING_CAPACITYは「薄くてよい」程度の個数なので、全走査してもコストは小さい。
    const alphaAttr = universe.roofParticles.geometry.attributes.aAlpha;
    for (let i = 0; i < ROOF_RING_CAPACITY; i++) {
      if (universe.roofSpawnElapsed[i] < 0) continue; // 未生成のslotはずっと透明のまま
      universe.roofSpawnElapsed[i] += deltaSeconds;
      const progress = Math.min(universe.roofSpawnElapsed[i] / ROOF_FADE_DURATION, 1);
      alphaAttr.array[i] = progress * ROOF_MAX_ALPHA;
    }
    alphaAttr.needsUpdate = true;
  }

  // ih.pngの周回・上下バウンス+フェードのopacity反映(表示中の間、続ける)。
  // ★ 2026-09-12 変更(ご指示反映): tripodRingSwap.js側のsetIhFadeが毎フレーム更新する
  //   universe.ihBaseOpacity(=リング下限からの近さ)をそのままここで書き込む。
  if (universe.ihRevealed) {
    universe.ihElapsed += deltaSeconds;
    updateIhOrbitPosition(universe);
    const ihMats = universe.ihSprite.userData.frontMaterials.length
      ? [...universe.ihSprite.userData.frontMaterials, ...universe.ihSprite.userData.backMaterials]
      : [];
    for (const m of ihMats) m.opacity = universe.ihBaseOpacity;
  }

  // 平衡感覚の防御的な保険: 万一どこか別の処理がcamera.upを書き換えても、
  // 宇宙ページにいる間は毎フレーム(0,1,0)に戻し、水平線が傾いたままにならないようにする。
  if (camera) camera.up.set(0, 1, 0);
}

// ── Phase3以降、最初の画面クリックで呼ぶ: 宇宙ページへ入る ──────────────
// axes / axisLabels / equationAssembly側の要素(既存の三軸・数式・カルーセル)を
// 隠す処理は、呼び出し側(main.js)がこの関数を呼ぶ前後で行ってください
// (どのオブジェクトを隠すべきかはmain.js側の現在の状態管理に依存するため、
//  このモジュール単体では判断できません)。
export function enterUniverse(universe, { camera, controls, duration = 1.6, onComplete } = {}) {
  if (universe.isActive) return;
  universe.isActive = true;

  // 視点は宇宙ページ専用のカメラ位置(UNIVERSE_CAMERA_POS/TARGET)へ合わせる。
  // ★ 以前はHOME_CAMERA_POS/TARGETをそのまま使っていたが、HOME_CAMERA_DIRを
  //   宇宙ページ用に下げた際、同じ定数を参照しているmain.js(イントロ)・record.js
  //   (鏡演出)側にも影響が出てしまったため、宇宙ページ専用の定数に切り替えた。
  // ★ 2026-09-12 変更: 「左ドラッグでの視点変更が銀河同期回転の演出を妨げる」との
  //   ご指示により、以後カメラはcontrols経由では動かさない(下のcontrolsブロックで
  //   controls.enabled=falseにする)。カメラの動きはmain.js側の専用コード
  //   (位置固定/銀河同期の自動回転/右ドラッグでの引き)がすべて担当する。
  if (camera) {
    // ズーム量はconfig.js側のUNIVERSE_CAMERA_DISTANCEで決まる(DIR×DISTANCEで
    // 組み立て済みのUNIVERSE_CAMERA_POSをそのまま使うだけでよい)。fovは疑似正射影用に
    // 固定で狭める。距離を詰めて拡大したいときは、ここではなくconfig.jsの
    // UNIVERSE_CAMERA_DISTANCEを小さくすること(欠けるのは想定内)。
    camera.position.copy(UNIVERSE_CAMERA_POS);
    camera.up.set(0, 1, 0);
    camera.fov = UNIVERSE_PSEUDO_ORTHO_FOV_DEG;

    // ★ 2026-09-12 追加: sceneSetup.jsのmakeProjectionMixerがcamera.farを底上げ
    //   しているのは「ホーム画面用のHOME_CAMERA_DISTANCE(=34)を疑似正射影に変換した
    //   distance(≈908)」ベースの値(≈1042)で、宇宙ページのUNIVERSE_CAMERA_DISTANCEは
    //   考慮されていない。宇宙ページ側のdistanceがこれを超えると、カメラ自身がfar平面
    //   より遠くに位置することになり、tripodなど注視点付近が描画されなくなる
    //   (真っ暗/一部だけ欠けるなど)。ここでUNIVERSE_CAMERA_DISTANCE分を踏まえて
    //   明示的に底上げしておく(奥行きの余裕として+200)。
    const requiredFar = UNIVERSE_CAMERA_TARGET.distanceTo(UNIVERSE_CAMERA_POS) + 200;
    if (camera.far < requiredFar) {
      camera.far = requiredFar;
    }

    camera.updateProjectionMatrix();
    camera.lookAt(UNIVERSE_CAMERA_TARGET);
  }
  if (controls) {
    controls.target.copy(UNIVERSE_CAMERA_TARGET);
    // ★ 2026-09-12 変更: 「左ドラッグで角度を変えられる仕様が、銀河を背景として
    //   固定して見せる演出(カメラの銀河同期回転)を妨げる」とのご指示のため、
    //   宇宙ページではcontrols自体を無効化する(以前はrotateだけ有効なまま残って
    //   いた。pan/zoomはmain.js側で個別にfalseにしていたが、そもそも全部まとめて
    //   ここで止めてしまう方が確実)。カメラの動き(位置固定/銀河同期回転/右ドラッグ
    //   での引き)は全てmain.js側の専用コードで制御する。
    controls.enabled = false;
    controls.update();
  }

  // テクスチャがまだロード中の可能性があるので、揃うまで待ってからフェードインする。
  Promise.all(universe.texturesReady).then(() => {
    const firstSprite = universe.sprites[universe.equationIndex];
    firstSprite.visible = true;

    const fadeTargets = [
      ...universe.axisLines.map((l) => l.material),
      ...universe.axisLabels.map((s) => s.material),
      firstSprite.material,
    ];
    gsap.to(fadeTargets, {
      opacity: 1,
      duration,
      ease: 'power1.out',
      onComplete: () => { if (onComplete) onComplete(); },
    });
  });
}

// ── 宇宙ページ内でのクリック: もう一方の方程式画像へクロスフェードする ──────
export function toggleUniverseEquation(universe) {
  if (!universe.isActive) return;
  const fromIndex = universe.equationIndex;
  const toIndex = (fromIndex + 1) % universe.sprites.length;
  const fromSprite = universe.sprites[fromIndex];
  const toSprite = universe.sprites[toIndex];

  toSprite.visible = true;
  toSprite.material.opacity = 0;
  toSprite.material.color.copy(EQUATION_COLOR_DEFAULT); // 前回のホバー色を引き継がない
  gsap.to(toSprite.material, { opacity: 1, duration: EQUATION_CROSSFADE_DURATION, ease: 'power1.inOut' });
  gsap.to(fromSprite.material, {
    opacity: 0,
    duration: EQUATION_CROSSFADE_DURATION,
    ease: 'power1.inOut',
    onComplete: () => { fromSprite.visible = false; },
  });

  universe.equationIndex = toIndex;
}

// TODO:
//     0°に近いほど3本が高さ軸に沿って細く立ち、90°に近いほど平べったく広がる。見ながら調整してください。
//   - AXIS_LABEL_OFFSET / AXIS_LABEL_WORLD_SIZE(ラベルの位置・サイズ)も仮値です。
//   - EQUATION_WORLD_WIDTH / EQUATION_HEIGHT_ABOVE_APEX / ANGULAR_SPEED は仮値。実際に見て調整してください。
//   - EQUATION_COLOR_HOVER / EQUATION_HOVER_RADIUS_PX(マウス接近での色変化)も仮値。
//     色味や反応距離はお好みで調整してください。
//   - RING_COLOR / RING_TUBE_RADIUS / RING_FADE_DURATION(金のリング)も仮値。
//   - TRIPOD_HIT_RADIUS(tripodクリック判定用の球の大きさ・位置)も仮値。実際にクリックしてみて、
//     狙いにくい/広すぎる場合は半径や中心のy座標を調整してください。
//   - TRIPOD_LIFT_HEIGHT / TRIPOD_LIFT_DURATION(tripodの浮上)も仮値。
//   - ROOF_SPAWN_ANGLE_STEP(何度おきに1粒生成するか、密度)/ ROOF_PARTICLE_JITTER(太さ)/
//     ROOF_PARTICLE_SIZE(ROOF_REFERENCE_DISTANCE・ROOF_VISIBILITY_BOOST経由でUNIVERSE_CAMERA_
//     DISTANCEに連動して自動調整) / ROOF_FADE_DURATION(フェードインの速さ)/
//     ROOF_MAX_ALPHA(最大不透明度)/ ROOF_COLOR_GREEN / ROOF_COLOR_ORANGE(色帯の2色)も仮値。
//     生成間隔・色帯の周期(1/6周)はANGULAR_SPEEDと連動しているので、ANGULAR_SPEEDを
//     変えると自動的に一緒に変わる。
//   - IH_WORLD_HEIGHT / IH_ORBIT_RADIUS / IH_ABOVE_RING_MARGIN / IH_ORBIT_SPEED /
//     IH_BOB_AMPLITUDE / IH_BOB_SPEED(ih.png)も仮値。IH_ORBIT_RADIUSは
//     「リングより少し内側」、IH_ABOVE_RING_MARGINは「リング(現在の高さ)からどれだけ
//     上に浮かせるか」のつもりでそれぞれ仮の値にしてあります(IH_BOB_AMPLITUDEより
//     大きい値にしておかないと、バウンスの下振れでリングを下回ってしまうので注意)。
//   - main.js側の統合ポイント(5箇所):
//       1) createUniverse(scene) を起動時に1回呼ぶ。
//       2) Phase3完了後の画面クリックで、既存シーン要素を隠してから enterUniverse(...) を呼ぶ。
//          (2回目以降のクリックは isActive を見て toggleUniverseEquation(universe) を呼ぶ)
//       3) レンダーループ内で updateUniverse(universe, deltaSeconds) を毎フレーム呼ぶ(cameraは渡さなくてよい)。
//       4) pointermoveハンドラ内で updateEquationHoverByPointer(universe, camera, e.clientX, e.clientY) を呼ぶ。
//       5) クリック処理内で universe.tripodHitMesh をraycast判定し、ヒットしたら
//          revealTripodRing / liftTripod / startTripodRoofPulse をまとめて呼ぶ
//          (リング形成・浮上・粒子の明滅開始は同時。ihはtripodRingSwap.js側が
//          リングの位置を見て自動的に出し入れするので、ここでは呼ばなくてよい)。
