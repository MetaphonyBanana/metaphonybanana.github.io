import * as THREE from 'three';
import { TRIPOD_RADIUS } from './universe.js';
import { SUN_ORBIT_PERIOD } from './solarSystem.js';

// ══════════════════════════════════════════════════════════════
// ── 「天の川銀河」: 宇宙ページ(universe.js)のtripod直下に浮かぶ巨大な銀河 ──
// ══════════════════════════════════════════════════════════════
//
// 仕様(ご指示より):
//   - WebGLRenderer前提(WebGPU/TSLは使わない)。位置はJS側で一度だけ計算して
//     BufferGeometryに焼き込み、描画だけGPUに任せる古典的な渦巻き銀河ジェネレーターの手法
//     (Bruno Simon式のアルゴリズム)。見た目重視とのことで8万パーティクル。
//   - solarSystem.jsのORBIT_CENTER(tripod直下・太陽系の公転軌道の中心)と同じ点を
//     銀河の中心として再利用する(main.js側でimportして渡す)。太陽系(太陽・8惑星・
//     軌跡・ih)とは別レイヤーとして共存させる。
//   - サイズは「巨大」とのことなので、tripodの回転軌道半径(TRIPOD_RADIUS)を基準に
//     その数倍の半径を持たせ、tripod・太陽系をまるごと包み込むスケール感にしてある。
//   - カメラから見えていなくてよいとのことなので、登場は太陽系(solarSystem.js)と
//     同じ扱い ── 宇宙ページ到達と同時に、フェードや拡大なしでいきなりフルサイズ
//     表示する(revealGalaxy)。以後、明示的に操作しない限り常にフルサイズのまま
//     (銀河そのものの拡大・縮小演出は廃止済み。詳細は末尾のTODO参照)。
//   - ★ 2026-09-14: 中心の棒状バルジ(バー+コア)は撤去した。「バルジが登場する」
//     演出はrecord.js側の戴冠シーケンス(バナナ消滅→バルジがフェードイン→針→太陽系召喚)
//     が本来の担当であり、あちらは意図通り最初は隠れていて、演出のタイミングで初めて
//     フェードインする。ところがこちらgalaxy.js側にも同じ見た目のバー+コアを銀河本体に
//     常設で焼き込んでいた(2026-09-13追加分)ため、宇宙ページに着いた瞬間から
//     revealGalaxyで銀河ごと即座にフル表示されてしまい、「バルジは演出で登場するはず
//     なのに最初から見えている」という状態になっていた。この銀河本体側の常設バルジを
//     削除し、円盤(渦巻き)だけの銀河に戻すことで、バルジの「登場」はrecord.js側の
//     演出だけが担う形に一本化した。
//   - 銀河の中心には何も置かない(旧・銀河本体のバナナ/クリックでの収束演出は削除済み。
//     現在の「バナナ」はrecord.js側にある、鏡三角錐の頂点に乗る別インスタンス)。
//
// main.js側の想定される呼び出し方:
//   import { createGalaxy, revealGalaxy, updateGalaxy } from './galaxy.js';
//   const galaxy = createGalaxy(scene, GALAXY_ANCHOR); // createSolarSystemの近くで1回
//   // enterUniverse()完了時など、宇宙ページに入ったタイミングで(solarSystemと同時):
//   revealGalaxy(galaxy);
//   // 毎フレームのレンダーループ内:
//   updateGalaxy(galaxy, deltaSeconds);
//   // record.js側の戴冠演出(playNeedleSequence)が銀河を一時的に高速回転させたいときは、
//   // galaxy.needleSpinActiveをtrue/falseに切り替えるだけでよい(updateGalaxy側が見る)。

// ── 銀河の形状パラメータ(仮値。見ながら調整してください) ──────────────
const GALAXY_PARTICLE_COUNT = 80000;
export const GALAXY_RADIUS = TRIPOD_RADIUS *8; // 「巨大」なので、tripod・太陽系をまるごと包む規模に(以前の2倍。仮値)
// ↑ record.js側がNEEDLE_START_RADIUS(針先=太陽の出発点を「銀河の周縁側」に置く)の
//   計算に参照するためexportした。
const GALAXY_BRANCHES = 9;          // 渦の腕の本数
const GALAXY_SPIN = -8.4;           // 半径に対する巻き付きの強さ(符号を反転=渦の巻き方向を逆に)
const GALAXY_RANDOMNESS = 0.75;     // 腕からのブレの強さ(半径に対する比率)
const GALAXY_RANDOMNESS_POWER = 4;  // 大きいほど「腕の近くに密集・稀に大きく外れる」分布になる
const GALAXY_FLATTEN = 0.25;        // 円盤の厚み(Y方向だけXZより浅くする比率)

const GALAXY_INSIDE_COLOR = new THREE.Color(0xffd9a0);  // 中心側。暖色(仮値)
const GALAXY_OUTSIDE_COLOR = new THREE.Color(0x3a6fd8); // 外側の腕。寒色(仮値)

const GALAXY_POINT_SIZE = 68;       // Pointsの基準サイズ(以前の2倍。仮値。uSizeとして渡す)

// ── 自転の演出パラメータ ─────────────────────────────
const ROTATION_AXIS_DIR = new THREE.Vector3(0, 1, 0);
export const ROTATION_DIRECTION = -1;       // 自転の向き(+1/-1)。以前と逆回転にしたいのでマイナスに
// ご指示「銀河の回転も太陽系と同じ速度にして」の反映: 以前は独自の固定値(2π/3秒=3秒で1周)
// だったが、solarSystem.jsのSUN_ORBIT_PERIOD(太陽が主軌道を1周する秒数)から直接導出し、
// 銀河の自転も「太陽系の公転と同じ周期」でぴったり1周するようにした。
// ★ 2026-09-12 追加: main.js側で「カメラも銀河と同じ速度で回転させたい」との
//   ご指示があったため、他ファイルから参照できるようexportした(値自体は変更なし)。
export const ANGULAR_SPEED = (2 * Math.PI) / SUN_ORBIT_PERIOD; // ラジアン/秒
// ご指示「レコードの針が出現して、太陽が中心に到達するまでのみ、銀河の回転を1秒で半周する
// 速度にして」の反映。半周(π radian)を1秒でこなす速さ=πラジアン/秒。
// record.js側がplayNeedleSequenceの開始〜完了の間だけgalaxy.needleSpinActiveをtrueにする。
const NEEDLE_SPIN_MAGNITUDE = Math.PI; // ラジアン/秒(=1秒で半周)

// ── Points用シェーダー ────────────────────────────────
// 円形のソフトフォールアウト + 距離に応じたサイズ減衰 + 全体をuAlphaで一括フェード。
const VERTEX_SHADER = /* glsl */ `
  uniform float uSize;
  uniform float uPixelRatio;
  attribute float aScale;
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;
    gl_Position = projectedPosition;

    gl_PointSize = uSize * aScale * uPixelRatio;
    gl_PointSize *= (1.0 / -viewPosition.z);

    vColor = aColor;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uAlpha;
  varying vec3 vColor;
  void main() {
    float strength = distance(gl_PointCoord, vec2(0.5));
    strength = 1.0 - smoothstep(0.0, 0.5, strength);
    if (strength <= 0.0) discard;
    gl_FragColor = vec4(vColor, strength * uAlpha);
  }
`;

// ── ジオメトリ生成: 位置・色・サイズ属性をJS側で一度だけ計算する ─────────
// 渦巻き円盤のみ(中心の棒状バルジは撤去済み。上部コメント参照)。
function buildGalaxyGeometry() {
  const totalCount = GALAXY_PARTICLE_COUNT;

  const positions = new Float32Array(totalCount * 3);
  const colors = new Float32Array(totalCount * 3);
  const scales = new Float32Array(totalCount);

  for (let i = 0; i < totalCount; i++) {
    const i3 = i * 3;

    const radius = Math.pow(Math.random(), 0.7) * GALAXY_RADIUS;
    const branchAngle = ((i % GALAXY_BRANCHES) / GALAXY_BRANCHES) * Math.PI * 2;
    const spinAngle = radius * GALAXY_SPIN * 0.02;

    const randomSign = () => (Math.random() < 0.5 ? 1 : -1);
    const randomStrength = Math.pow(Math.random(), GALAXY_RANDOMNESS_POWER) * GALAXY_RANDOMNESS * radius;
    const randomX = randomSign() * randomStrength;
    const randomY = randomSign() * randomStrength * GALAXY_FLATTEN;
    const randomZ = randomSign() * randomStrength;

    positions[i3] = Math.cos(branchAngle + spinAngle) * radius + randomX;
    positions[i3 + 1] = randomY;
    positions[i3 + 2] = Math.sin(branchAngle + spinAngle) * radius + randomZ;

    const mixedColor = GALAXY_INSIDE_COLOR.clone().lerp(GALAXY_OUTSIDE_COLOR, radius / GALAXY_RADIUS);
    colors[i3] = mixedColor.r;
    colors[i3 + 1] = mixedColor.g;
    colors[i3 + 2] = mixedColor.b;

    scales[i] = Math.random() * 0.7 + 0.3; // 大きさに個体差をつける(0.3〜1.0)
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  return geometry;
}

function buildGalaxyMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uSize: { value: GALAXY_POINT_SIZE },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uAlpha: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// scene: universe.js/solarSystem.jsと同じシーンに追加する想定。
// anchor: 銀河の中心にするワールド座標。main.js側でrecord.jsのバナナが最終的に着地する
//         座標から計算したもの(GALAXY_ANCHOR)を渡す想定。
export function createGalaxy(scene, anchor) {
  const geometry = buildGalaxyGeometry();
  const material = buildGalaxyMaterial();
  const points = new THREE.Points(geometry, material);
  // 8万パーティクルへの標準のPoints raycastは重く、かつこの銀河自体はもうクリック対象では
  // ないので無効化しておく(no-op化)。
  points.raycast = () => {};

  // starsGroup: 銀河のパーティクルだけを持つグループ。ここをrotateすることで自転を表現する。
  const starsGroup = new THREE.Group();
  starsGroup.position.copy(anchor);
  starsGroup.add(points);
  starsGroup.visible = false; // revealGalaxyまで隠しておく(solarSystem.groupと同じ扱い)
  scene.add(starsGroup);

  return {
    starsGroup,
    points,
    material,
    state: 'hidden', // 'hidden' → 'idle'
    needleSpinActive: false, // ← record.js側がplayNeedleSequence中だけtrueにする(「1秒で半周」の速さになる)
  };
}

// ── 宇宙ページ到達と同時に呼ぶ: solarSystem.group.visible = true と同じ扱いで、
//    フェードや拡大演出なしにいきなりフルサイズで表示する ──────────────
export function revealGalaxy(galaxy) {
  if (!galaxy || galaxy.state !== 'hidden') return;
  galaxy.starsGroup.visible = true;
  galaxy.state = 'idle';
}

// ── 毎フレーム呼ぶ: 銀河をworld Yまわりに自転させる(state==='idle'の間) ──
export function updateGalaxy(galaxy, deltaSeconds) {
  if (!galaxy || galaxy.state === 'hidden') return;
  const magnitude = galaxy.needleSpinActive ? NEEDLE_SPIN_MAGNITUDE : ANGULAR_SPEED;
  galaxy.starsGroup.rotateOnWorldAxis(ROTATION_AXIS_DIR, ROTATION_DIRECTION * magnitude * deltaSeconds);
}

// TODO:
//   - GALAXY_RADIUS(=TRIPOD_RADIUS*8)を含む形状パラメータ(GALAXY_PARTICLE_COUNT /
//     GALAXY_BRANCHES / GALAXY_SPIN / GALAXY_RANDOMNESS(_POWER) / GALAXY_FLATTEN /
//     GALAXY_POINT_SIZE)は全て仮値です。実際に見ながら調整してください。
//   - GALAXY_INSIDE_COLOR / GALAXY_OUTSIDE_COLOR も仮値(暖色→寒色のグラデーション)。
//   - ANGULAR_SPEED / ROTATION_DIRECTION / NEEDLE_SPIN_MAGNITUDEも仮値。ROTATION_DIRECTIONは
//     +1/-1で自転の向きを切り替えられます(GALAXY_SPINの符号と合わせて渦の見え方が決まります)。
//   - リサイズ時にuPixelRatioを更新したい場合は、resizeハンドラから
//     galaxy.material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2)
//     を呼んでください(このモジュール単体ではresizeイベントを監視していません)。
//   - ★ 2026-09-14: 銀河そのものの拡大・縮小(バナナクリックでの収束消滅・スクロールでの
//     出し入れ・ドラッグでの掴み移動など)は仕様として廃止されたため、関連コードは
//     すべて削除しました。削除したもの: 中心の棒状バルジ(バー+コア。上部コメント参照)、
//     銀河本体のバナナ(makeBananaMesh)とその当たり判定、掴み判定用の透明球
//     (GRAB_HIT_RADIUS)、placeGalaxyAt / flyGalaxyTo / collapseGalaxy / uncollapseGalaxy /
//     setGalaxyRevealAmount / revealBanana の各関数、およびそれらが使っていた
//     COLLAPSE_* 定数・collapseSpinMagnitude / revealSpinMagnitude・'static' /
//     'collapsing' / 'revealing' / 'done' の各state。現在galaxy.stateは
//     'hidden'→'idle'の2値のみです。銀河は一度revealGalaxyされたら、明示的な
//     操作手段がない(=常にフルサイズ・等速自転のまま)状態になっています。