import * as THREE from 'three';
import { AXIS_LENGTH, AXIS_COLOR, HOME_CAMERA_POS, HOME_CAMERA_TARGET } from './config.js';
import { makeTextSprite } from './axisLabels.js';

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
//   - 視点はenterUniverse時にホームポジション(HOME_CAMERA_POS / HOME_CAMERA_TARGET)へ合わせるが、
//     以後カメラのcontrolsは無効化しない(=自由に動かせる)。
//   - hotspots.js と同じ考え方(小さな球+判定用の大きな透明球)で、宇宙ページ内にもクリック可能な
//     セリフ用の点(hotspotMeshes)を追加した。実際のセリフ・位置は仮置きなので差し替えてください。
//
// main.js側の想定される呼び出し方:
//   import {
//     createUniverse, enterUniverse, toggleUniverseEquation,
//     updateUniverse, updateEquationHoverByPointer,
//   } from './universe.js';
//   // TRIPOD_RADIUS(tripodの回転軌道半径)はsolarSystem.js側が直接importして、
//   // 太陽系の公転半径をtripodと揃えるのに使う(main.js側で中継する必要はない)。
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
//   // クリック処理内では、既存のhotspots.js用raycastと同じパターンで
//   // universe.hotspotMeshes も判定してあげてください
//   // (raycaster.intersectObjects(universe.hotspotMeshes) → 親のuserData.textsを読む)。

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
  { key: 'carousel', url: new URL('./data/final_equation.png', import.meta.url).href },   // i(h/Carousel)∂ψ/∂t = Ĥψ
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
// ↓ solarSystem.js側で「tripodの回転軌道(終端3点が描く円)と同じ半径」を太陽系側の
//   公転半径として揃えるために参照する。将来tripod=カルーセルの屋根、太陽系の軌道=
//   ステージとして重ねるための共通サイズなのでexportしておく。
export const TRIPOD_RADIUS = AXIS_LENGTH * Math.sin(TRIPOD_ANGLE_FROM_VERTICAL); // 終端3点の、高さ軸からの水平距離
const APEX_HEIGHT   = AXIS_LENGTH * Math.cos(TRIPOD_ANGLE_FROM_VERTICAL); // 頂点(原点)の高さ

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

// ── 頂点→各終端の3本の軸線を作る(以前のcreateRotatingAxes()と同じ、追加の辺はなし) ──
function makeAxisLine(tip) {
  const geo = new THREE.BufferGeometry().setFromPoints([ORIGIN, tip]);
  const mat = new THREE.LineBasicMaterial({ color: AXIS_COLOR, transparent: true, opacity: 0 });
  return new THREE.Line(geo, mat);
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

// ── 宇宙ページ用hotspot(セリフ星) ──────────────────────
// hotspots.js と同じ考え方: 見た目は小さな球、判定は別途大きめの透明球を子として持たせる。
// ★ 位置・セリフは仮置きです。実際に表示したい内容へ差し替えてください。
const UNIVERSE_HOTSPOTS = [
  { pos: [90, -160, -70], text: [ {text: 'Life is a gift horse in my opinion', work: 'J.D. Salinger — Teddy'}] },
  { pos: [-100, 100, 55], text: [{text: 'When the horse arrived, it turned out indeed to be a superlative animal.', work: 'J.D. Salinger — Raise High the Roof Beam, Carpenters'}] },
  { pos: [6, -8, 8], text: ['（C・宇宙ページ 3）'] },
];
const HOTSPOT_HIT_RADIUS = 1.6; // ← 宇宙ページはhotspots.js(スケール100〜380)よりだいぶ狭いスケールなので縮小してある

function createUniverseHotspots(scene) {
  const hotspotMeshes = [];
  const hotspotGeo = new THREE.SphereGeometry(0.12, 12, 12);
  const hitGeo = new THREE.SphereGeometry(HOTSPOT_HIT_RADIUS, 12, 12);

  UNIVERSE_HOTSPOTS.forEach((h) => {
    // 見た目は他の演出と合わせてフェードインさせたいのでtransparent+opacity0で開始する
    // (hotspots.js本体は最初から不透明だが、宇宙ページは軸・方程式と一緒にフェードで登場させる)。
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0 });
    const m = new THREE.Mesh(hotspotGeo, mat);
    m.position.set(...h.pos);
    m.userData.texts = h.text;

    const hitArea = new THREE.Mesh(
      hitGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false })
    );
    m.add(hitArea);

    scene.add(m);
    hotspotMeshes.push(m);
  });
  return hotspotMeshes;
}

// scene: このシーン専用のTHREE.Sceneでも、既存sceneの続きに追加でもよい
// (main.js側で「Phase3までの要素は隠す/別レイヤーに逃がす」判断をしてから使う想定)。
export function createUniverse(scene) {
  const { group: axesGroup, lines: axisLines, labels: axisLabels } = createRotatingAxes();
  scene.add(axesGroup);

  // 2枚とも同じワールド位置に重ねて置き、クリック時はopacityのクロスフェードだけで切り替える。
  const sprites = EQUATION_IMAGES.map(() => makeEquationSprite());
  for (const sprite of sprites) scene.add(sprite);

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

  const hotspotMeshes = createUniverseHotspots(scene);

  return {
    axesGroup,
    axisLines,
    axisLabels,        // ← 追加: X/Y/Z終端のラベルsprite群(頂点とともに三脚を構成)
    hotspotMeshes,     // ← 追加: クリックでセリフを出すためのhotspot群
    sprites,           // [standard, carousel] の順
    texturesReady,     // Promise配列。enterUniverse側でPromise.allしてから表示する
    equationIndex: 0,  // 現在表示中の画像インデックス
    isActive: false,   // まだ「宇宙ページ」に入っていない(=Phase3までのシーンにいる)状態かどうか
  };
}

// ── 毎フレーム呼ぶ: 3本の軸線(+ラベル)を「高さ軸(world Y)」まわりに、カルーセルのように
//    ぐるっと回転させる(座標変換のみ。線やジオメトリは増やしていない) ──
// 頂点(ORIGIN)はこの軸の直上にあるため、回転させても頂点自体はワールド座標上で動かない。
// 固定のワールド軸なので、カメラの向きに依存しない。そのためcameraは不要。
const ANGULAR_SPEED = 0.18; // ラジアン/秒。仮値、見ながら調整してください

export function updateUniverse(universe, deltaSeconds, camera) {
  if (!universe.isActive) return;
  universe.axesGroup.rotateOnWorldAxis(ROTATION_AXIS_DIR, -ANGULAR_SPEED * deltaSeconds);
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

  // 視点はホームポジションと同じ座標へ合わせる。以後カメラは自由に動かせる
  // (以前のようにcontrols.enabled=falseで固定しない)。
  if (camera) {
    camera.position.copy(HOME_CAMERA_POS);
    camera.up.set(0, 1, 0);
    camera.lookAt(HOME_CAMERA_TARGET);
  }
  if (controls) {
    controls.target.copy(HOME_CAMERA_TARGET);
    // 極(真上/真下)を跨げないようにして、平衡感覚が狂う(天地反転して見える)のを防ぐ。
    // 移動(pan/zoom)・首振り(azimuth/polar回転)自体はそのまま自由に使える。
    controls.minPolarAngle = MIN_POLAR_ANGLE;
    controls.maxPolarAngle = MAX_POLAR_ANGLE;
    controls.enabled = true;
    controls.update();
  }

  // テクスチャがまだロード中の可能性があるので、揃うまで待ってからフェードインする。
  Promise.all(universe.texturesReady).then(() => {
    const firstSprite = universe.sprites[universe.equationIndex];
    firstSprite.visible = true;

    const fadeTargets = [
      ...universe.axisLines.map((l) => l.material),
      ...universe.axisLabels.map((s) => s.material),
      ...universe.hotspotMeshes.map((m) => m.material),
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
//   - UNIVERSE_HOTSPOTS の座標・セリフは仮です。実際に表示したい内容へ差し替えてください。
//   - main.js側の統合ポイント(4箇所):
//       1) createUniverse(scene) を起動時に1回呼ぶ。
//       2) Phase3完了後の画面クリックで、既存シーン要素を隠してから enterUniverse(...) を呼ぶ。
//          (2回目以降のクリックは isActive を見て toggleUniverseEquation(universe) を呼ぶ)
//       3) レンダーループ内で updateUniverse(universe, deltaSeconds) を毎フレーム呼ぶ(cameraは渡さなくてよい)。
//       4) pointermoveハンドラ内で updateEquationHoverByPointer(universe, camera, e.clientX, e.clientY) を呼ぶ。
//       5) クリック判定に universe.hotspotMeshes も追加する(既存hotspots.jsのraycast処理と同じパターンでOK)。