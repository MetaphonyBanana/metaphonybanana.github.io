import * as THREE from 'three';
import { AXIS_LENGTH } from './config.js';

// ── 原点でのバースト演出(クリック直後、Ĥが登場する前に一度だけ再生) ──────
//
// 2段構成:
//   1) 黄色い輝点(十字に長く伸びるフレア)
//   2) 「(AXIS_LENGTH,0,0)(0,AXIS_LENGTH,0)(0,0,AXIS_LENGTH)の3点を通る円
//      (=正三角形の外接円)」のサイズ・向き・重心を基準に、
//      a) 軸上(ラッパのイメージ): 対称位相(π差)の呼吸リング(sin波で
//         膨張・収縮する2本の線)が、原点→重心を素早く小刻みに振動しながら
//         伝っていく。振幅は現れた直後は小さく、次第に大きく育っていく。
//      b) 重心に到達したら、そこでバトンタッチして、三軸それぞれの終点
//         (GROUND_VERTEX_A/B/C)を波源に、正弦波の波紋(=一定間隔で並ぶ
//         複数の同心円)が平面上を外側へ広がっていく。3つの波源の波が
//         重なるところは加算合成でより明るくなり、干渉して見える。
//      これを3回、タイミングだけずらして繰り返す。
//
// 色はどちらの段階も同じ考え方: 色相(hue)は固定(標準的な青)、
// 明度(lightness)や不透明度だけで明るさ・残像を表現する。
//
// 終わったらシーンから自分で片付ける(=呼び出し側は onComplete を待って
// 次の演出に進むだけでよい)。

const ORIGIN = new THREE.Vector3(0, 0, 0);

// ── 色(共通): 標準的な青のhue固定、明度だけenvelopeで動かす ──────────
const BEAM_HUE = 0.61;        // 標準的な青
const BEAM_SATURATION = 1.0;
const BEAM_LIGHTNESS_MIN = 0.12; // 暗い側
const BEAM_LIGHTNESS_MAX = 0.48; // 明るい側(白飛びを抑えて青みを残す)

// ── 1) 輝点(十字を長く伸ばしたstarburst) ────────────────────
const FLASH_COLOR_CORE = 'rgba(255,250,190,0.8)';
const FLASH_COLOR_MID = 'rgba(255, 225, 20, 0.55)';
const FLASH_COLOR_EDGE = 'rgba(255,200,40,0)';
const FLASH_COLOR_SPIKE_NEAR = 'rgba(255,220,90,0.6)';
const FLASH_COLOR_SPIKE_MID = 'rgba(255,195,40,0.3)';
const FLASH_COLOR_SPIKE_FAR = 'rgba(255,195,40,0)';

function makeFlashTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  ctx.globalCompositeOperation = 'lighter';

  const coreRadius = size * 0.11;
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius);
  coreGrad.addColorStop(0, FLASH_COLOR_CORE);
  coreGrad.addColorStop(0.35, FLASH_COLOR_MID);
  coreGrad.addColorStop(1, FLASH_COLOR_EDGE);
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
  ctx.fill();

  const spikeLength = size * 0.68;
  const spikeBaseWidth = size * 0.022;
  function drawSpike(angle) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const grad = ctx.createLinearGradient(0, 0, 0, -spikeLength);
    grad.addColorStop(0, FLASH_COLOR_SPIKE_NEAR);
    grad.addColorStop(0.35, FLASH_COLOR_SPIKE_MID);
    grad.addColorStop(1, FLASH_COLOR_SPIKE_FAR);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-spikeBaseWidth / 2, 0);
    ctx.lineTo(spikeBaseWidth / 2, 0);
    ctx.lineTo(0, -spikeLength);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  drawSpike(0);
  drawSpike(Math.PI / 2);
  drawSpike(Math.PI);
  drawSpike(-Math.PI / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createFlashSprite() {
  const texture = makeFlashTexture();
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 999;
  sprite.scale.set(0.001, 0.001, 1);
  return sprite;
}

// ── 幾何の基準値: (AXIS_LENGTH,0,0)(0,AXIS_LENGTH,0)(0,0,AXIS_LENGTH)の
//    正三角形から、重心・外接円半径・向き(法線)を一度だけ計算しておく ────
const GROUND_VERTEX_A = new THREE.Vector3(AXIS_LENGTH, 0, 0);
const GROUND_VERTEX_B = new THREE.Vector3(0, AXIS_LENGTH, 0);
const GROUND_VERTEX_C = new THREE.Vector3(0, 0, AXIS_LENGTH);
const GROUND_CENTROID = GROUND_VERTEX_A.clone().add(GROUND_VERTEX_B).add(GROUND_VERTEX_C).multiplyScalar(1 / 3);
const GROUND_NORMAL = new THREE.Vector3(1, 1, 1).normalize();
const RING_FINAL_RADIUS = GROUND_VERTEX_A.distanceTo(GROUND_CENTROID); // 外接円半径
const AXIS_TRAVEL_LENGTH = ORIGIN.distanceTo(GROUND_CENTROID);        // 原点→重心の距離

// ── 2a) 軸上(ラッパのイメージ): 対称位相の呼吸リング ──────────────────
// 半径1の単位円(線)を1つだけ作り、毎フレーム scale で半径を表現する(軽量)。
// 位相をπずらした2本を重ねることで「片方が膨らむ時、もう片方が縮む」対称位相にする。
// ラッパの振動のように、素早い振動数で小刻みに揺れながら原点→重心を伝う。
// 現れた直後は振幅を小さく始めて、次第にフルの振幅まで育っていく。
const RING_LINE_SEGMENTS = 96;
const BREATHE_FREQUENCY = 9.0;        // rad/sec。ラッパの振動を意識してかなり速めに
const BREATHE_AMPLITUDE_RATIO = 0.18; // 基準半径に対する振幅の割合(フル状態)
const BREATHE_AMPLITUDE_RAMP_START = 0.08; // 現れた直後の振幅倍率(フルに対する割合。小さく始める)
const BREATHE_HUE_SWING = 0.045;      // 呼吸にあわせてhueを±この範囲で揺らす(青の範囲に収まる程度)
const BREATHE_LINE_OPACITY = 0.85;
const BREATHE_RING_AXIAL_OFFSET = 0.4; // 対の片方だけ、軸方向にこのぶんずらす(ワールド単位、仮)

function createBreathingRing(phaseOffset, axialOffset = 0) {
  const points = [];
  for (let i = 0; i <= RING_LINE_SEGMENTS; i++) {
    const angle = (i / RING_LINE_SEGMENTS) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color().setHSL(BEAM_HUE, BEAM_SATURATION, BEAM_LIGHTNESS_MAX),
    transparent: true,
    opacity: 0, // タイムラインでフェードインさせる
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const line = new THREE.LineLoop(geometry, material);
  line.renderOrder = 999;
  line.userData.phaseOffset = phaseOffset;
  line.userData.axialOffset = axialOffset;
  return line;
}

// progress: 0→1で原点→重心。呼吸リングは軸上だけの担当(重心到達後は
// 平面波源にバトンタッチしてフェードアウトする)。
function updateBreathingRing(line, elapsedSeconds, progress) {
  const phase = line.userData.phaseOffset;
  const axialOffset = line.userData.axialOffset;
  const axisT = THREE.MathUtils.clamp(progress, 0, 1);

  const baseRadius = axisT * RING_FINAL_RADIUS;

  // 振幅は現れた直後、じわじわ小さい状態から立ち上げる(いきなりフルで脈打たない)。
  const ampT = THREE.MathUtils.smoothstep(axisT, 0, 1);
  const ampScale = THREE.MathUtils.lerp(BREATHE_AMPLITUDE_RAMP_START, 1, ampT);

  const breathe = Math.sin(elapsedSeconds * BREATHE_FREQUENCY + phase) * baseRadius * BREATHE_AMPLITUDE_RATIO * ampScale;
  const radius = Math.max(baseRadius + breathe, 0.001);
  line.scale.setScalar(radius);

  // 対の片方(axialOffset != 0)だけ、軸方向に少しずらして位置させる。
  // 原点付近で急に後ろへ飛び出さないよう、axisTに応じてオフセットも
  // 0から徐々にかかるようにしている。
  const travel = axisT * AXIS_TRAVEL_LENGTH + axialOffset * axisT;
  line.position.copy(GROUND_NORMAL).multiplyScalar(travel);

  const hue = BEAM_HUE + Math.sin(elapsedSeconds * BREATHE_FREQUENCY + phase) * BREATHE_HUE_SWING;
  line.material.color.setHSL(hue, BEAM_SATURATION, BEAM_LIGHTNESS_MAX);
}

// 対称位相(π差)の2本を1組として作る。片方だけ軸方向にオフセットして、
// 最大/最小それぞれの瞬間に2本が同じ位置で完全に重ならないようにする。
function createBreathingRingPair() {
  const defaultNormal = new THREE.Vector3(0, 0, 1);
  const quat = new THREE.Quaternion().setFromUnitVectors(defaultNormal, GROUND_NORMAL);

  const ringA = createBreathingRing(0, 0);
  const ringB = createBreathingRing(Math.PI, -BREATHE_RING_AXIAL_OFFSET);
  ringA.quaternion.copy(quat);
  ringB.quaternion.copy(quat);

  return {
    ringA,
    ringB,
    update(elapsedSeconds, progress) {
      updateBreathingRing(ringA, elapsedSeconds, progress);
      updateBreathingRing(ringB, elapsedSeconds, progress);
    },
  };
}

// ── 2b) 平面上: 三軸の終点(GROUND_VERTEX_A/B/C)をそれぞれ波源として、
//    正弦波の波紋(=一定間隔で並ぶ複数の同心円=波の山)を外側へ広げていく。
//    3つの波源から出た波が重なるところは加算合成(AdditiveBlending)でより明るくなり、
//    干渉しているように見える。すべて青のLineLoop(線のリング)で表現する。
//    波紋はメッシュではなく「先頭の波面+後ろに続く残像リング数本」という
//    離散的な同心円の集まりとして表現し、後ろのリングほど暗く残像として残す。
const PLANE_WAVE_SOURCES_LOCAL = [GROUND_VERTEX_A, GROUND_VERTEX_B, GROUND_VERTEX_C];
const PLANE_WAVE_MAX_RADIUS = RING_FINAL_RADIUS * 2.2; // 波源からどこまで広がるか(仮。対辺・対頂点まで届く程度)
const PLANE_WAVE_WAVELENGTH = 0.85;  // 波の山と山の間隔(ワールド単位、仮。正弦波の周期に相当)
const PLANE_WAVE_RING_COUNT = 4;     // 先頭の波面+残像何本を同時に描くか
const PLANE_WAVE_RING_DECAY = 0.55;  // 先頭から残像リングへ向けての減衰(大きいほど残像は短い)
const PLANE_WAVE_MAX_OPACITY = 0.6;
const PLANE_WAVE_LINE_SEGMENTS = 96;

function createPlaneWaveRingSet() {
  // 単位円をPLANE_WAVE_RING_COUNT本あらかじめ作っておき、半径はscaleで表現する
  // (=メッシュのように頂点を再計算する必要がなく軽い)。
  return Array.from({ length: PLANE_WAVE_RING_COUNT }, () => {
    const points = [];
    for (let i = 0; i <= PLANE_WAVE_LINE_SEGMENTS; i++) {
      const angle = (i / PLANE_WAVE_LINE_SEGMENTS) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color().setHSL(BEAM_HUE, BEAM_SATURATION, BEAM_LIGHTNESS_MAX),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const line = new THREE.LineLoop(geometry, material);
    line.renderOrder = 999;
    return line;
  });
}

// frontRadius: 波の先端が波源からどこまで届いたか(0〜PLANE_WAVE_MAX_RADIUS)
// opacityEnvelope: フェードイン/アウト用の全体倍率(0〜1)
function updatePlaneWaveRingSet(rings, frontRadius, opacityEnvelope) {
  rings.forEach((line, k) => {
    // k=0が波の先頭(最前面)、kが増えるほど後ろに続く残像(=前の波の山)
    const radius = frontRadius - k * PLANE_WAVE_WAVELENGTH;
    if (radius <= 0.001) {
      line.material.opacity = 0;
      return;
    }
    line.scale.setScalar(radius);
    const ringEnvelope = Math.exp(-k * PLANE_WAVE_RING_DECAY);
    line.material.opacity = PLANE_WAVE_MAX_OPACITY * ringEnvelope * opacityEnvelope;
    const lightness = THREE.MathUtils.lerp(BEAM_LIGHTNESS_MIN, BEAM_LIGHTNESS_MAX, ringEnvelope);
    line.material.color.setHSL(BEAM_HUE, BEAM_SATURATION, lightness);
  });
}

// 3つの波源(GROUND_VERTEX_A/B/C)それぞれに、リングの束を1つずつ配置する
function createPlaneWaveSources() {
  const defaultNormal = new THREE.Vector3(0, 0, 1);
  const quat = new THREE.Quaternion().setFromUnitVectors(defaultNormal, GROUND_NORMAL);

  return PLANE_WAVE_SOURCES_LOCAL.map((sourcePosition) => {
    const rings = createPlaneWaveRingSet();
    rings.forEach((line) => {
      line.quaternion.copy(quat);
      line.position.copy(sourcePosition);
    });
    return { rings, sourcePosition };
  });
}

// ── 2c) 交点を光の粒で強調 ────────────────────────────────
// 3波源(A/B/C)から出ている「同じk番目(=先頭から数えて何本目か)」の波の輪は、
// 常に同じ半径になる(frontRadiusを共有しているため)。この輪どうしの
// 交点(円と円の交差点)を毎フレーム計算し、そこに小さな光の粒を置くことで、
// 「波が重なって強め合っている場所」を直接的に見せる。

// 平面の2D基底(GROUND_NORMALに直交する2本)。3波源の位置はこの平面上にあるので、
// 円と円の交点計算は2Dで行い、最後に3Dへ戻す。
const PLANE_BASIS_U = (() => {
  const arbitrary = Math.abs(GROUND_NORMAL.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3().crossVectors(GROUND_NORMAL, arbitrary).normalize();
})();
const PLANE_BASIS_V = new THREE.Vector3().crossVectors(GROUND_NORMAL, PLANE_BASIS_U).normalize();

function projectTo2D(point3D) {
  const rel = point3D.clone().sub(GROUND_CENTROID);
  return { x: rel.dot(PLANE_BASIS_U), y: rel.dot(PLANE_BASIS_V) };
}
function projectTo3D(point2D) {
  return GROUND_CENTROID.clone()
    .addScaledVector(PLANE_BASIS_U, point2D.x)
    .addScaledVector(PLANE_BASIS_V, point2D.y);
}
const PLANE_WAVE_SOURCES_2D = PLANE_WAVE_SOURCES_LOCAL.map(projectTo2D);
const PLANE_WAVE_SOURCE_PAIRS = [[0, 1], [1, 2], [2, 0]]; // 3波源から作れる組み合わせ

// 2つの円(中心c1/c2、半径r1/r2)の交点を求める(0〜2点)
function circleIntersections(c1, r1, c2, r2) {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6 || d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hSq = r1 * r1 - a * a;
  if (hSq < 0) return [];
  const h = Math.sqrt(hSq);
  const mx = c1.x + (a * dx) / d;
  const my = c1.y + (a * dy) / d;
  const rx = -dy * (h / d);
  const ry = dx * (h / d);
  return [
    { x: mx + rx, y: my + ry },
    { x: mx - rx, y: my - ry },
  ];
}

// 交点1つあたり最大 3組(A-B, B-C, C-A) × PLANE_WAVE_RING_COUNT本 × 2点
const INTERSECTION_SPRITE_COUNT = PLANE_WAVE_SOURCE_PAIRS.length * PLANE_WAVE_RING_COUNT * 2;
const INTERSECTION_SPRITE_SIZE = 0.4;   // 光の粒の大きさ(ワールド単位、仮)
const INTERSECTION_MAX_OPACITY = 1.0;

function makeSparkleTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, 'rgba(235,245,255,0.95)');
  grad.addColorStop(0.4, 'rgba(140,190,255,0.6)');
  grad.addColorStop(1, 'rgba(80,140,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const SPARKLE_TEXTURE = makeSparkleTexture(); // 全スプライトで共有(テクスチャは使い回してよい)

function createIntersectionSpritePool() {
  return Array.from({ length: INTERSECTION_SPRITE_COUNT }, () => {
    const material = new THREE.SpriteMaterial({
      map: SPARKLE_TEXTURE,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 1000; // リングより手前に描かれてほしい
    sprite.scale.setScalar(INTERSECTION_SPRITE_SIZE);
    return sprite;
  });
}

// frontRadius/opacityEnvelopeはupdatePlaneWaveRingSetと同じ値を共有する
// (=波の輪と交点の光は常に同じ広がり方・明るさの基準で動く)。
function updateIntersectionSprites(sprites, frontRadius, opacityEnvelope) {
  const points = [];
  for (let k = 0; k < PLANE_WAVE_RING_COUNT; k++) {
    const radius = frontRadius - k * PLANE_WAVE_WAVELENGTH;
    if (radius <= 0.001) continue;
    const ringEnvelope = Math.exp(-k * PLANE_WAVE_RING_DECAY) * opacityEnvelope;
    if (ringEnvelope <= 0.01) continue;
    PLANE_WAVE_SOURCE_PAIRS.forEach(([i, j]) => {
      const hits = circleIntersections(
        PLANE_WAVE_SOURCES_2D[i], radius,
        PLANE_WAVE_SOURCES_2D[j], radius,
      );
      hits.forEach((pt) => points.push({ pt, envelope: ringEnvelope }));
    });
  }

  sprites.forEach((sprite, idx) => {
    const entry = points[idx];
    if (!entry) {
      sprite.material.opacity = 0;
      return;
    }
    sprite.position.copy(projectTo3D(entry.pt));
    sprite.material.opacity = INTERSECTION_MAX_OPACITY * entry.envelope;
  });
}

// ── 演出タイミング(すべて仮値。見ながら調整してください) ──────────────
const FLASH_WORLD_SIZE = 3.0;
const FLASH_POP_DURATION = 0.35;
const FLASH_HOLD = 0.1;
const FLASH_FADE_DURATION = 0.5;
const FLASH_PEAK_OPACITY = 0.55;

const RING_START_DELAY = 0.15;    // 輝点が弾けてから1本目のリングが伸び始めるまでの遅延
const RING_STAGGER = 0.45;        // 3回分、それぞれの開始タイミングのずれ
const RING_TRAVEL_DURATION = 4.0; // 1本のリングが原点→重心(軸上)まで伝う時間(=ゆっくり)
const RING_FADE_IN_DURATION = 0.2;
const RING_FADE_OUT_DURATION = 0.35; // リングが平面波源にバトンタッチする際のフェードアウト時間

const PLANE_WAVE_FADE_IN_DURATION = 0.25;
const PLANE_WAVE_EXPAND_DURATION = 2.4;   // 波源からPLANE_WAVE_MAX_RADIUSまで広がる時間
const PLANE_WAVE_FADE_OUT_DURATION = 1.2; // 広がりきった波紋がフェードアウトする時間

// scene: 追加/削除に使う。camera: 現状は使っていないが、将来カメラに応じた
// 見え方の調整が必要になった場合のために引数だけ残してある。
// onComplete: 演出が完全に終わった(=シーンから片付いた)タイミングで呼ばれる。
export function playOriginBurst({ scene, camera, onComplete }) {
  // ── 1) 輝点 ──
  const flashSprite = createFlashSprite();
  flashSprite.position.copy(ORIGIN);
  scene.add(flashSprite);

  // ── 2) 呼吸リング(軸上)+平面波源(三軸の干渉)+交点の光を3組(タイミングだけずらす) ──
  const groups = Array.from({ length: 3 }, () => ({
    ringPair: createBreathingRingPair(),
    planeWaveSources: createPlaneWaveSources(),
    intersectionSprites: createIntersectionSpritePool(),
  }));
  groups.forEach(({ ringPair, planeWaveSources, intersectionSprites }) => {
    scene.add(ringPair.ringA);
    scene.add(ringPair.ringB);
    planeWaveSources.forEach(({ rings: waveRings }) => {
      waveRings.forEach((line) => scene.add(line));
    });
    intersectionSprites.forEach((sprite) => scene.add(sprite));
  });

  // 呼吸(sin波の脈動)は経過時間ベースで動かすので、演出開始時刻を記録しておく
  const clockStart = performance.now();

  const tl = gsap.timeline({
    onComplete: () => {
      // 使い捨て演出なので、自分で後片付けまでする(シーン・GPUリソースを残さない)。
      scene.remove(flashSprite);
      flashSprite.material.map.dispose();
      flashSprite.material.dispose();

      groups.forEach(({ ringPair, planeWaveSources, intersectionSprites }) => {
        scene.remove(ringPair.ringA);
        scene.remove(ringPair.ringB);
        ringPair.ringA.geometry.dispose();
        ringPair.ringA.material.dispose();
        ringPair.ringB.geometry.dispose();
        ringPair.ringB.material.dispose();

        planeWaveSources.forEach(({ rings: waveRings }) => {
          waveRings.forEach((line) => {
            scene.remove(line);
            line.geometry.dispose();
            line.material.dispose();
          });
        });

        intersectionSprites.forEach((sprite) => {
          scene.remove(sprite);
          sprite.material.dispose(); // SPARKLE_TEXTUREは全スプライト共有なのでここではdisposeしない
        });
      });

      if (onComplete) onComplete();
    },
  });

  // ── 輝点: 膨らむ→少し保持→フェードアウト ──
  tl.to(flashSprite.scale, {
    x: FLASH_WORLD_SIZE,
    y: FLASH_WORLD_SIZE,
    duration: FLASH_POP_DURATION,
    ease: 'power2.out',
  }, 0);
  tl.to(flashSprite.material, {
    opacity: FLASH_PEAK_OPACITY,
    duration: FLASH_POP_DURATION * 0.6,
    ease: 'power1.out',
  }, 0);
  tl.to(flashSprite.material, {
    opacity: 0,
    duration: FLASH_FADE_DURATION,
    ease: 'power2.in',
  }, FLASH_POP_DURATION + FLASH_HOLD);

  // ── 呼吸リング(軸上)→平面波源(三軸の干渉): 3組とも同じアニメーションを、
  //    開始タイミングだけずらして再生 ──
  groups.forEach(({ ringPair, planeWaveSources, intersectionSprites }, i) => {
    const start = RING_START_DELAY + i * RING_STAGGER;

    tl.to(ringPair.ringA.material, {
      opacity: BREATHE_LINE_OPACITY,
      duration: RING_FADE_IN_DURATION,
      ease: 'power1.out',
    }, start);
    tl.to(ringPair.ringB.material, {
      opacity: BREATHE_LINE_OPACITY,
      duration: RING_FADE_IN_DURATION,
      ease: 'power1.out',
    }, start);

    // 軸上(原点→重心)を等速で伝う。振幅の立ち上がりはupdateBreathingRing内で
    // 別途担っているので、ここでは進み方だけを単純な線形にしている。
    const ringProgress = { value: 0 };
    tl.to(ringProgress, {
      value: 1,
      duration: RING_TRAVEL_DURATION,
      ease: 'none',
      onUpdate: () => {
        ringPair.update((performance.now() - clockStart) / 1000, ringProgress.value);
      },
    }, start);

    // 軸終端(=重心)に到着したタイミングで、呼吸リング→平面波源へバトンタッチ。
    const arrival = start + RING_TRAVEL_DURATION;

    tl.to(ringPair.ringA.material, {
      opacity: 0,
      duration: RING_FADE_OUT_DURATION,
      ease: 'power1.in',
    }, arrival);
    tl.to(ringPair.ringB.material, {
      opacity: 0,
      duration: RING_FADE_OUT_DURATION,
      ease: 'power1.in',
    }, arrival);

    // 平面波源: 三軸それぞれの終点から正弦波リング(先頭+残像数本)が広がっていく。
    // frontRadiusとopacityは別々のプロパティなので、同じオブジェクトに対して
    // 独立したトゥイーンとして扱える。
    const planeWaveState = { frontRadius: 0, opacity: 0 };
    const refreshPlaneWave = () => {
      planeWaveSources.forEach(({ rings: waveRings }) => {
        updatePlaneWaveRingSet(waveRings, planeWaveState.frontRadius, planeWaveState.opacity);
      });
      updateIntersectionSprites(intersectionSprites, planeWaveState.frontRadius, planeWaveState.opacity);
    };
    tl.to(planeWaveState, {
      opacity: 1,
      duration: PLANE_WAVE_FADE_IN_DURATION,
      ease: 'power1.out',
      onUpdate: refreshPlaneWave,
    }, arrival);
    tl.to(planeWaveState, {
      frontRadius: PLANE_WAVE_MAX_RADIUS,
      duration: PLANE_WAVE_EXPAND_DURATION,
      ease: 'power2.out',
      onUpdate: refreshPlaneWave,
    }, arrival);
    tl.to(planeWaveState, {
      opacity: 0,
      duration: PLANE_WAVE_FADE_OUT_DURATION,
      ease: 'power1.in',
      onUpdate: refreshPlaneWave,
    }, arrival + PLANE_WAVE_EXPAND_DURATION - PLANE_WAVE_FADE_OUT_DURATION);
  });

  return tl;
}