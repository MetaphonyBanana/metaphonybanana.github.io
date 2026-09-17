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

// ── 2026-09-17 追加: 円盤の境界フェード ────────────────────
// 外周(および中心に穴をあけたときの内周)を、粒子ごとのalphaで滑らかに減衰させて
// 「縁がぷつりと切れる」のを防ぐ。値はGALAXY_RADIUSに対する比率(仮値)。
const GALAXY_OUTER_FADE = 0.30;     // 外周側: 半径のこの割合ぶんの幅をかけて0へ
const GALAXY_INNER_FADE = 0.35;     // 内周側: innerRadiusのこの割合ぶんの幅をかけて0へ(穴があるときのみ)
const GALAXY_EDGE_SIZE_FALLOFF = 0.55; // 縁で粒を小さくする度合い(0=変えない、1=完全に消える手前まで細る)

// ── 2026-09-17 追加: 「腕の強調」演出用パラメータ ───────────────────
// ご指示反映: 「固定三本の腕を太くする」演出。GALAXY_BRANCHES=9本のうち3個おき
// (=120°間隔で均等)の3本だけを対象にし、setGalaxyArmEmphasis(galaxy, 0〜1)で
// 太さ・明るさを外部からアニメーションできるようにする。
//   - main.js側: 最後の俯瞰視点(telescopeモード突入)になったタイミングで0→1
//   - 将来追加予定のレコードのアーム(tonearm)を円盤に置くギミック: 1→0
//     (=今の常時の静かな見た目に戻す)を想定している(現時点では呼び出し元は
//     まだ実装されていない)。
export const GALAXY_ARM_EMPHASIS_BRANCHES = [0, 3, 6]; // 9本中3個おき=120°間隔で均等な3本
const GALAXY_ARM_THICKEN_STRENGTH = 1.4;   // 強調時、対象の腕の粒を最大(1+この値)倍太くする(仮値)
const GALAXY_ARM_BRIGHTEN_STRENGTH = 0.9;  // 強調時、対象の腕の粒を最大(1+この値)倍明るくする(仮値)


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
  uniform float uNearFadeStart;
  uniform float uNearFadeRange;
  uniform float uMaxPixelSize;
  uniform float uArmEmphasis;         // 0=通常、1=強調full(setGalaxyArmEmphasisで外部からtween)
  uniform float uArmThickenStrength;  // 強調時の太さ倍率の強さ(bulge側は0=無効)
  uniform float uArmBrightenStrength; // 強調時の明るさ倍率の強さ(bulge側は0=無効)
  attribute float aScale;
  attribute float aAlpha;
  attribute float aArmWeight; // 0/1: 強調対象の腕(GALAXY_ARM_EMPHASIS_BRANCHES)に属するか
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vColorBoost;
  void main() {
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;
    gl_Position = projectedPosition;

    gl_PointSize = uSize * aScale * uPixelRatio;
    gl_PointSize *= (1.0 / -viewPosition.z);

    // ★ 2026-09-17 追加: 強調対象の腕の粒だけ、uArmEmphasisに応じて太く・明るくする。
    float armBoost = aArmWeight * uArmEmphasis;
    gl_PointSize *= 1.0 + armBoost * uArmThickenStrength;

    // ★ 2026-09-17 追加: 画面上の見かけサイズに上限を設ける。カメラが極端に近づいても
    //   「ベタ塗りの巨大な正方形」までは膨らまなくなる(=バルジ対策その2)。
    //   uMaxPixelSize未指定(0)のときは無効(既定の1/-viewPosition.z減衰のみ)。
    if (uMaxPixelSize > 0.0) {
      gl_PointSize = min(gl_PointSize, uMaxPixelSize);
    }

    vColor = aColor;
    vColorBoost = 1.0 + armBoost * uArmBrightenStrength;
    // ★ 2026-09-17 追加: カメラが粒に近づきすぎたとき(=バルジのように大きいsizeを
    //   持つ粒にカメラが接近して、テクスチャなしの円が画面いっぱいの「巨大なドット」に
    //   見えてしまうケース)に、距離に応じてアルファを落として消す。銀河本体側は
    //   常に十分遠いので、uNearFadeStart=0/uNearFadeRange=1(実質無効)で呼べばよい。
    float viewDist = -viewPosition.z;
    float nearFade = smoothstep(uNearFadeStart, uNearFadeStart + max(uNearFadeRange, 0.0001), viewDist);
    vAlpha = aAlpha * nearFade;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vColorBoost;
  void main() {
    float strength = distance(gl_PointCoord, vec2(0.5));
    strength = 1.0 - smoothstep(0.0, 0.5, strength);
    if (strength <= 0.0) discard;
    gl_FragColor = vec4(vColor * vColorBoost, strength * uAlpha * vAlpha);
  }
`;

// ── ジオメトリ生成: 位置・色・サイズ属性をJS側で一度だけ計算する ─────────
// 渦巻き円盤のみ(中心の棒状バルジは撤去済み。上部コメント参照)。
// ★ 2026-09-16 追加(ご指示反映): 「バルジ出現の際に銀河に穴をあけて、バルジから
//   腕が生えてるように見せたい」への対応。bar_bulge_preview.htmlのGALAXY_INNER_RADIUS
//   と同じ考え方で、innerRadius(既定0=以前と同じ、中心まで詰まった円盤)を受け取り、
//   半径を[innerRadius, GALAXY_RADIUS]の範囲にリマップして中心に穴を作れるようにした。
function buildGalaxyGeometry(innerRadius = 0) {
  const totalCount = GALAXY_PARTICLE_COUNT;

  const positions = new Float32Array(totalCount * 3);
  const colors = new Float32Array(totalCount * 3);
  const scales = new Float32Array(totalCount);
  const alphas = new Float32Array(totalCount);
  const armWeights = new Float32Array(totalCount);

  // 外周/内周のフェード幅(ワールド単位)。0除算を避けるため下限を持たせる。
  const outerFadeWidth = Math.max(GALAXY_RADIUS * GALAXY_OUTER_FADE, 1e-6);
  const innerFadeWidth = innerRadius > 0 ? Math.max(innerRadius * GALAXY_INNER_FADE, 1e-6) : 0;

  const smoothstep = (edge0, edge1, x) => {
    const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
    return t * t * (3 - 2 * t);
  };

  for (let i = 0; i < totalCount; i++) {
    const i3 = i * 3;

    const radius = innerRadius + Math.pow(Math.random(), 0.7) * (GALAXY_RADIUS - innerRadius);
    const armIndex = i % GALAXY_BRANCHES;
    const branchAngle = (armIndex / GALAXY_BRANCHES) * Math.PI * 2;
    const spinAngle = radius * GALAXY_SPIN * 0.02;

    // ★ 2026-09-17 修正: 腕からのブレを等方(球面上で一様な向き)にする。
    //   以前はX/Zに「同じ大きさ・符号だけランダム」な値を足していたため、ブレの向きが
    //   常に対角4方向(±s, ±s)に限られ、稀に大きく外れる粒子が四隅に集中して、
    //   銀河の周縁が四角いシルエットに見えていた。向きを球面上で一様にサンプリングし、
    //   大きさだけをrandomStrengthで決めることで、どの方位にも等確率で散る=円状になる。
    const randomStrength = Math.pow(Math.random(), GALAXY_RANDOMNESS_POWER) * GALAXY_RANDOMNESS * radius;
    const dirTheta = Math.random() * Math.PI * 2;
    const dirY = Math.random() * 2 - 1;          // cos(φ)を一様に取ると球面上で一様になる
    const dirXZ = Math.sqrt(1 - dirY * dirY);
    const randomX = Math.cos(dirTheta) * dirXZ * randomStrength;
    const randomY = dirY * randomStrength * GALAXY_FLATTEN; // Y方向だけ薄くして円盤にする
    const randomZ = Math.sin(dirTheta) * dirXZ * randomStrength;

    const x = Math.cos(branchAngle + spinAngle) * radius + randomX;
    const z = Math.sin(branchAngle + spinAngle) * radius + randomZ;

    positions[i3] = x;
    positions[i3 + 1] = randomY;
    positions[i3 + 2] = z;

    const mixedColor = GALAXY_INSIDE_COLOR.clone().lerp(GALAXY_OUTSIDE_COLOR, radius / GALAXY_RADIUS);
    colors[i3] = mixedColor.r;
    colors[i3 + 1] = mixedColor.g;
    colors[i3 + 2] = mixedColor.b;

    // ★ 2026-09-17 追加: 境界フェード。ブレを足した「実際の」XZ半径で判定するので、
    //   腕から外へ飛び出した粒子も含めて縁が滑らかに消える。
    const finalRadius = Math.hypot(x, z);
    let edge = 1 - smoothstep(GALAXY_RADIUS - outerFadeWidth, GALAXY_RADIUS, finalRadius);
    if (innerFadeWidth > 0) {
      // 中心に穴があるとき(バルジ出現時)は、穴のふちも同様にぼかす。
      edge *= smoothstep(innerRadius, innerRadius + innerFadeWidth, finalRadius);
    }

    alphas[i] = edge;
    // 縁では粒そのものも細らせると、フェードがより自然に見える。
    const sizeJitter = Math.random() * 0.7 + 0.3; // 大きさに個体差をつける(0.3〜1.0)
    scales[i] = sizeJitter * (1 - GALAXY_EDGE_SIZE_FALLOFF * (1 - edge));

    // 強調対象の3本の腕(GALAXY_ARM_EMPHASIS_BRANCHES)に属する粒だけ1、それ以外は0。
    armWeights[i] = GALAXY_ARM_EMPHASIS_BRANCHES.includes(armIndex) ? 1 : 0;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aArmWeight', new THREE.BufferAttribute(armWeights, 1));
  return geometry;
}

// ── 2026-09-16 追加: バルジ出現のタイミングでrecord.js側から呼んでもらい、円盤の
//    中心にinnerRadius分の穴をあける(=そこから先はバルジが埋める想定)。
//    ジオメトリを丸ごと作り直して差し替える、簡易な実装(アニメーションなし。
//    「出現の際に」という一度きりのタイミングなので、瞬時の切り替えで十分という判断)。
export function setGalaxyInnerRadius(galaxy, innerRadius) {
  if (!galaxy || !galaxy.points) return;
  const newGeometry = buildGalaxyGeometry(innerRadius);
  galaxy.points.geometry.dispose();
  galaxy.points.geometry = newGeometry;
}

// ── 2026-09-17 追加: 固定3本の腕(GALAXY_ARM_EMPHASIS_BRANCHES)の強調度を設定する。
//    amountは0(通常)〜1(太さ・明るさとも最大)。値そのものを毎フレーム/tweenの
//    onUpdateから渡す想定(このモジュール自体はアニメーションしない。呼び出し側の
//    main.js/record.js側でgsap.toなどを使ってamountを0→1、1→0とtweenしてください)。
export function setGalaxyArmEmphasis(galaxy, amount) {
  if (!galaxy || !galaxy.material) return;
  galaxy.material.uniforms.uArmEmphasis.value = amount;
}

// ── 2026-09-17 追加: 銀河・バルジなど「Points+この円形ソフトシェーダー」を使う
//    描画すべてで共有するマテリアル生成関数。record.js側のバルジも同じ質感
//    (円形フォールオフ・縁のフェード・近接時のサイズ上限とフェード)を使えるよう
//    export している。
//   - size: uSize(基準の点サイズ)
//   - nearFadeStart/nearFadeRange: この距離(ワールド単位)より近づくとアルファが
//     落ちて消える。銀河のように常に十分遠い場合は0のままでよい(実質無効)。
//   - maxPixelSize: 画面上の見かけサイズの上限(px)。0で無効。
export function createStarPointsMaterial({
  size,
  nearFadeStart = 0,
  nearFadeRange = 1,
  maxPixelSize = 0,
  armThickenStrength = 0,
  armBrightenStrength = 0,
} = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uSize: { value: size },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uAlpha: { value: 1 },
      uNearFadeStart: { value: nearFadeStart },
      uNearFadeRange: { value: nearFadeRange },
      uMaxPixelSize: { value: maxPixelSize },
      uArmEmphasis: { value: 0 }, // setGalaxyArmEmphasisで0〜1をtweenする
      uArmThickenStrength: { value: armThickenStrength },
      uArmBrightenStrength: { value: armBrightenStrength },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function buildGalaxyMaterial() {
  return createStarPointsMaterial({
    size: GALAXY_POINT_SIZE,
    armThickenStrength: GALAXY_ARM_THICKEN_STRENGTH,
    armBrightenStrength: GALAXY_ARM_BRIGHTEN_STRENGTH,
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
