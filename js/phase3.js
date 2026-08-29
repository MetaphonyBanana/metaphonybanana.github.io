import * as THREE from 'three';
import { computeScreenFrame } from './screenFrame.js';
import { showWearItAWhilePhrase } from './captions.js';
import {
  SYMBOL_ASSETS,
  EQUATION_SCALE,
  CROP_TO_MASTER_SCALE,
  MASTER_BBOX,
  BASELINE_MASTER_Y,
  contentCenterPx,
} from './symbolAssets.js';

// ════════════════════════════════════════════════════════════════
// ── Phase 3: iħ項の②③④ 差し替え(schrodinger-sequence-timeline.md 参照) ──
// ════════════════════════════════════════════════════════════════
//
// ①(iħ、Phase1で完成済み) → ②i(h/2π) → ③i(h/Carousel) → ④(iがhに乗ったもの)/Carousel
//
// ①の「i」はどの段階でも位置が変わらない…わけではなく、②③④と進むにつれて実際は左へ
// 移動していく(実測して判明)。①の「ħ」(=assembly.sprites.hbar)も同様に、まず左へ
// 移動してから上昇してhへ変化する。
//
// 配置はすべて「=」記号を共通の原点とした絶対座標(マスター画像換算px)で管理する。
// 3枚の完成equation画像(2pi-equation.png/carousel.png/final.png)はそれぞれ縮尺が違う
// (PHASE3_IMAGE_SCALE参照)ので、各画像内の「=」の実測位置を基準に、
// (raw - その画像のequals中心)/その画像のscale + マスターのequals中心
// という変換で、全ステージを同じ「マスター座標」に正規化している。
// こうすることで、Phase1のi・ħの静止位置(MASTER_BBOX.i/hbarから直接計算できる)と、
// ②③④での位置を同じ物差しで比較・補間できる。

// 新規5アセット(2026-08-16: i_on_hは使わないことにしたので除外。
// 個別に計測したi・hの着地位置が正しければ、合成グリフに差し替えなくても
// 違和感のない着地になる。むしろi_on_h.pngは別アセットゆえの微妙なズレ(誤差)が
// 目立ってしまうとのフィードバックがあったため)。
// ── 2026-08-16 再計測: 元画像(2pi.png/carousel_equation.png/final.png)から
// 白文字・透過背景で切り抜き直したため、canvas(切り抜きPNGのピクセルサイズ)を
// 実測値に更新した。以前の値は元画像が失われる前の暫定値。
export const PHASE3_ASSETS = {
  h2:        { url: new URL('./data/h_v2.png', import.meta.url).href,          canvas: [813, 1089] },
  twoPi:     { url: new URL('./data/twopi.png', import.meta.url).href,          canvas: [1552, 1053] },
  barTwoPi:  { url: new URL('./data/bar_2pi.png', import.meta.url).href,        canvas: [1712, 182] },
  carousel:  { url: new URL('./data/carousel_word.png', import.meta.url).href,  canvas: [2658, 579] },
  barWide:   { url: new URL('./data/bar_carousel.png', import.meta.url).href,   canvas: [2905, 172] },
};

// 元画像1pxをワールド空間で何ユニットにするか(Phase1のEQUATION_SCALEをそのまま流用)。
export const PHASE3_SCALE = EQUATION_SCALE;

// ── 実測スケール補正(重要) ──────────────────────────
// 今回渡された3枚の完成equation画像(2pi-equation.png/carousel.png/final.png)は、
// いずれも8000px幅だが、実際にはそれぞれ独自の縮小率でレイアウトされていることが
// 実測でわかった(carousel.pngは「Carousel」という長い単語が入る分、equation全体が
// 縮小されている、など)。
//
// これを補正するため、全ステージ・Phase1と共通で「絵柄も位置も変化しない」要素である
// ∂ψ/∂t(derivative)のバウンディングボックスを各画像で実測し、Phase1のMASTER_BBOX.derivative
// (=1855×3094px、マスター画像上での実測値)と比較して、画像ごとのスケール係数を求めた。
//
//   stage2 (2pi.png):              ∂ψ/∂t実測 1622×2710px → 1855×3094比で 0.8751倍
//   stage3 (carousel_equation.png): ∂ψ/∂t実測 1355×2266px → 同 0.7314倍
//   stage4 (final.png):            ∂ψ/∂t実測 1440×2406px → 同 0.7770倍
// (2026-08-16: 元画像から再計測した値に更新。連結成分検出による自動計測で、
//  幅比・高比の誤差はいずれも0.2%未満で一致している)
const PHASE3_IMAGE_SCALE = {
  stage2: 0.8751,
  stage3: 0.7314,
  stage4: 0.7770,
};

// PHASE3_ASSETSの各キーが、どのステージ画像から切り出されたか
// (=どのPHASE3_IMAGE_SCALEで補正すべきか)のマップ。
// carousel/barWideはstage4(final.png)でも再利用するが、切り出し元はstage3(carousel.png)。
const PHASE3_ASSET_SOURCE_STAGE = {
  h2: 'stage2',
  twoPi: 'stage2',
  barTwoPi: 'stage2',
  carousel: 'stage3',
  barWide: 'stage3',
};

// 元画像固有のpx値を、「マスター画像(S_equation-1.png)換算のpx値」に変換する。
function toMasterPx(px, stageKey) {
  return px / PHASE3_IMAGE_SCALE[stageKey];
}

export function phase3SymbolWorldSize(key) {
  const asset = PHASE3_ASSETS[key];
  const stageKey = PHASE3_ASSET_SOURCE_STAGE[key];
  return {
    width: toMasterPx(asset.canvas[0], stageKey) * PHASE3_SCALE,
    height: toMasterPx(asset.canvas[1], stageKey) * PHASE3_SCALE,
  };
}

// BAR_WIDTH_PX(元画像pxでの"インク"だけの幅)を、そのバーの見た目の全長が
// 正しくその幅になるようワールド幅に変換する。
//
// ★2026-08-16 修正: 切り出したPNG(barTwoPi/barWide)は、インクの周囲に
// 余白(パディング)を持たせてクロップしている。THREE.Spriteのscale.xは
// キャンバス全体(余白込み)の幅に対応するため、単純に
// toMasterPx(widthPx)*PHASE3_SCALE をscale.xへ入れると、
// 「インク部分の見た目の幅」が意図した長さより
// (widthPx / canvas幅)倍だけ短くなってしまっていた
// (carousel用バーで実測: 2505/2905 ≈ 86%の長さしかなかった)。
// キャンバス幅とインク幅の比率で逆補正し、インク部分が正しい長さになるようにする。
function fractionBarWorldWidth(widthPx, stageKey, assetKey) {
  const canvasPx = PHASE3_ASSETS[assetKey].canvas[0];
  const targetInkWorldWidth = toMasterPx(widthPx, stageKey) * PHASE3_SCALE;
  return targetInkWorldWidth * (canvasPx / widthPx);
}

// バーの実測幅(元画像px、各ステージ画像内で直接計測)。
const BAR_WIDTH_PX = {
  stage2: 1412, // 2pi.png実測(2026-08-16再計測)
  stage3: 2505, // carousel_equation.png実測(2026-08-16再計測)
  stage4: 2661, // final.png実測(2026-08-16再計測)
};

// ── バー高さの微調整(手動) ──────────────────────────
// (2026-08-16: 「=」基準点の補正後も、carousel側(stage3/4)のバーがderivativeより
//  わずかに高く見える、とのフィードバック。計測上は誤差1px未満で原因を特定できず、
//  EQUATION_SCALE/CROP_TO_MASTER_SCALEが「仮」の近似値であることに起因する残差と思われる。
//  マイナス値でバーを下げる。ワールド単位。見た目を見ながら微調整してください。)
const STAGE_BAR_Y_NUDGE = {
  stage2: 0,
  stage3: 0, // 仮。まだ高く見えるなら -0.005 刻みくらいで試してください
  stage4: 0,
};

// ── 「=」を共通原点とした絶対座標系 ──────────────────────
// マスター画像上での「=」中心(=Phase1のBASELINE_MASTER_Y・baselineMasterXそのもの)。
const EQUALS_MASTER = {
  x: contentCenterPx(MASTER_BBOX.equals.bbox).x, // 4619.5
  y: BASELINE_MASTER_Y,                          // 1770.5
};

// 各equation画像内で実測した「=」の中心(px、その画像自身の座標系)。
const STAGE_EQUALS_RAW = {
  stage2: { x: 4932.5, y: 1672.0 }, // 2pi.png実測(2026-08-16再計測)
  stage3: { x: 5497.5, y: 1448.0 }, // carousel_equation.png実測(2026-08-16再計測)
  stage4: { x: 5339.5, y: 1538.0 }, // final.png実測(2026-08-16再計測)
};

// 各ステージ画像内で実測した各パーツの中心(px、その画像自身の座標系、Y下向き)。
// (2026-08-16: 元画像から再計測した値に更新。連結成分検出による自動計測)
const STAGE_RAW_CENTERS = {
  stage2: { // i (h/2π) ← 2pi.png実測
    i:     { x: 285.5,  y: 1575.5 },
    h:     { x: 1374.5, y: 680.5 },
    bar:   { x: 1358.0, y: 1672.0 },
    denom: { x: 1372.0, y: 2457.5 }, // 2π
  },
  stage3: { // i (h/Carousel) ← carousel_equation.png実測
    i:     { x: 288.5,  y: 1367.0 },
    h:     { x: 1861.0, y: 619.0 },
    bar:   { x: 1847.5, y: 1448.0 },
    denom: { x: 1851.0, y: 1923.5 }, // Carousel
  },
  stage4: { // (iがhに乗ったもの)/Carousel ← final.png実測
    // 2026-08-16 再々測(重要な修正): 以前の`merged`は「i_on_h」全体を1個の
    // バウンディングボックスとして1点だけ実測した値だった。これをiとhの共通の
    // 着地点として使うと、hの着地位置とiの着地位置の違い(=iが実際にどれだけ
    // 移動してhに飛び乗るか)が完全に無視されてしまい、iの飛び乗り位置が
    // おかしく見える原因になっていた。
    // final.pngを2値化してconnected componentを抽出すると、iのループ(ドット無し、
    // 上部の渦巻き)とhの本体(アセンダー+ボウル)は実際にはインクが繋がっておらず
    // 別々の連結成分として分離できる(2026-08-16 実測で確認)。そこでstage3と同じ
    // 「bbox中心」方式で、hとiそれぞれの実測値を個別に持つようにした。
    //   h実測bbox: x[1307,1868] y[575,1381] → 中心(1587.5, 978.0)
    //   i実測bbox: x[1608,1909] y[310,831]  → 中心(1758.5, 570.5)
    h: { x: 1587.5, y: 978.0 },
    i: { x: 1758.5, y: 570.5 },
    bar:    { x: 1462.5, y: 1537.5 },
    denom:  { x: 1466.5, y: 2044.0 }, // Carousel
  },
};

// stageKey内のraw px中心を、マスター座標(px)へ変換する。
// (raw - そのステージのequals中心) / そのステージのscale + マスターのequals中心
function stageCenterToMasterPx(stageKey, partKey) {
  const raw = STAGE_RAW_CENTERS[stageKey][partKey];
  const eq = STAGE_EQUALS_RAW[stageKey];
  const scale = PHASE3_IMAGE_SCALE[stageKey];
  return {
    x: (raw.x - eq.x) / scale + EQUALS_MASTER.x,
    y: (raw.y - eq.y) / scale + EQUALS_MASTER.y,
  };
}

// マスター座標(px、Y下向き)を、frame基準のワールド座標へ変換する。
// (symbolWorldX/Yと同じ変換規則: 「=」原点からの相対距離 × EQUATION_SCALE、Yは符号反転)
function masterPxToWorld(masterPt, vertexWorld, frame) {
  const dx = (masterPt.x - EQUALS_MASTER.x) * EQUATION_SCALE;
  const dy = -(masterPt.y - EQUALS_MASTER.y) * EQUATION_SCALE;
  return vertexWorld.clone().addScaledVector(frame.right, dx).addScaledVector(frame.up, dy);
}

// stageKey内のpartKeyのワールド座標を直接返す(上2つの合成、一番よく使う)。
function stagePartWorld(stageKey, partKey, vertexWorld, frame) {
  const pos = masterPxToWorld(stageCenterToMasterPx(stageKey, partKey), vertexWorld, frame);
  // バーのみ、見た目の微調整用にY方向へ追加オフセットをかけられるようにする。
  if (partKey === 'bar') {
    const nudge = STAGE_BAR_Y_NUDGE[stageKey] || 0;
    if (nudge) pos.addScaledVector(frame.up, nudge);
  }
  return pos;
}

// ワールド座標 ⇔ frame基準ローカルオフセット(rx, ry)の相互変換。
// 「xだけ動かして、yは今の値のまま」のような軸別アニメーションに使う。
function worldToLocalOffset(pos, vertexWorld, frame) {
  const rel = pos.clone().sub(vertexWorld);
  return { rx: rel.dot(frame.right), ry: rel.dot(frame.up) };
}
function localOffsetToWorld(rx, ry, vertexWorld, frame) {
  return vertexWorld.clone().addScaledVector(frame.right, rx).addScaledVector(frame.up, ry);
}

// Ĥ・ħ・iなど他の記号と同じ白トーンに揃える(phase1.js側のSYMBOL_COLOR_OVERRIDES.hbarと同値)。
const PHASE3_COLOR = 0xffffff;

const phase3TextureLoader = new THREE.TextureLoader();

function makePhase3Sprite(key) {
  const asset = PHASE3_ASSETS[key];
  const texture = phase3TextureLoader.load(asset.url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: PHASE3_COLOR,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(material);
  const { width, height } = phase3SymbolWorldSize(key);
  sprite.scale.set(width, height, 1);
  sprite.visible = false;
  sprite.userData.symbolKey = key;
  return sprite;
}

// createEquationAssembly()から一度だけ呼ぶ。Phase3用の6スプライトを作ってsceneに追加する。
// 戻り値はassembly.phase3としてぶら下げる想定。
export function createPhase3Assets(scene) {
  const sprites = {};
  for (const key of Object.keys(PHASE3_ASSETS)) {
    const sprite = makePhase3Sprite(key);
    scene.add(sprite);
    sprites[key] = sprite;
  }
  return {
    sprites,
    stage: 'hbar', // 'hbar' | 'stage2' | 'stage3' | 'stage4' ← 現在の表示形態
    busy: false,   // 遷移アニメーション中の多重クリック防止
  };
}

// ── 各ステージ遷移の尺(秒)。仮値、見ながら調整してください ──
const STAGE_TRANSITION = {
  toStage2: {
    moveLeft: 4.4,   // ⑴ i・hbarが左へ移動(見た目はまだ変化しない) ※元の速度の1/4
    riseMorph: 4.0,  // ⑵ hbarが上昇しながらhへクロスフェード ※元の速度の1/4
    barGrow: 3.2,    // ⑵ バーがscale.xで0→実寸に伸びる ※元の速度の1/4
    denomFade: 4.0,  // ⑵ 2πがフェードインする ※元の速度の1/4
  },
  toStage3: { moveDuration: 1.2, spinDuration: 4.8 }, // ⑴bar伸長+2π→分母中心+h→分子中心 → ⑵分母が回転してCarouselへ(順番に発生。回転は1/4速度に減速)
  toStage4: { hMove: 0.7, gapBeforeHop: 2, hop: 0.8, merge: 0.6 },  // ⑴hが先に歩いて着地 → (2秒静止) → ⑵iがジャンプして乗る → ⑶最終微調整
  toStage2FromStage4: { fadeOut: 0.6, fadeIn: 0.8 }, // ④→②の循環(クロスフェードのみ、簡易)
};

// ── ①→②(2段階) ──────────────────────────────
// ⑴ i・hbar(ħ)を「左へ」移動させる(この時点ではまだ見た目は変わらない。yは触らない)。
// ⑵ hbarが上昇しながらhへクロスフェードし、同時にバーが伸び、2πがフェードインする。
function transitionToStage2({ assembly, frame, onComplete }) {
  const p3 = assembly.phase3;
  const vertexWorld = assembly.__phase3VertexWorld; // startPhase3側で保存
  const hbarSprite = assembly.sprites.hbar;
  const iSprite = assembly.sprites.i;

  const hSprite = p3.sprites.h2;
  const barSprite = p3.sprites.barTwoPi;
  const denomSprite = p3.sprites.twoPi;

  // ── 目標位置(マスター座標から計算した絶対ワールド座標) ──
  const iTarget = stagePartWorld('stage2', 'i', vertexWorld, frame);
  const hTarget = stagePartWorld('stage2', 'h', vertexWorld, frame);
  const barTarget = stagePartWorld('stage2', 'bar', vertexWorld, frame);
  const denomTarget = stagePartWorld('stage2', 'denom', vertexWorld, frame);

  // ⑴の「左移動だけ」の中間目標: hTargetのx(rx)だけを使い、yはhbarの今のy(ry)のまま。
  const hbarStartOffset = worldToLocalOffset(hbarSprite.position, vertexWorld, frame);
  const hTargetOffset = worldToLocalOffset(hTarget, vertexWorld, frame);
  const hbarLeftWorld = localOffsetToWorld(hTargetOffset.rx, hbarStartOffset.ry, vertexWorld, frame);

  const { moveLeft, riseMorph, barGrow, denomFade } = STAGE_TRANSITION.toStage2;
  const barTargetWidth = fractionBarWorldWidth(BAR_WIDTH_PX.stage2, 'stage2', 'barTwoPi');

  const tl = gsap.timeline({ onComplete });

  // hbarが上昇を始める(riseMorph、時刻moveLeft)より前に、3秒だけワンフレーズを表示する。
  // moveLeft(⑴の尺、既定4.4秒)の間に収まる長さなので、hbarが上がり始める前に必ず消え終わる。
  tl.call(() => { showWearItAWhilePhrase(assembly.completePhraseCaption); }, null, 0);

  // ⑴ i・hbarが左へ移動(テクスチャはまだ変化しない)
  tl.to(iSprite.position, { x: iTarget.x, y: iTarget.y, z: iTarget.z, duration: moveLeft, ease: 'power2.inOut' }, 0);
  tl.to(hbarSprite.position, { x: hbarLeftWorld.x, y: hbarLeftWorld.y, z: hbarLeftWorld.z, duration: moveLeft, ease: 'power2.inOut' }, 0);

  // ⑵ hbarとhが「同じ軌道」を一緒に上昇しながらクロスフェードする。
  // ★従来はhbarSpriteがhbarLeftWorldに留まったままopacityだけ下げていたため、
  //   「静止したħが薄れる隣で、hだけが単独で浮き上がる」ように見えてしまっていた。
  //   ここでは両スプライトの位置を毎フレーム同じ値(riseProgressで補間した1点)に
  //   揃えることで、1本の記号がその場で姿を変えながら上昇するように見せる。
  hSprite.position.copy(hbarLeftWorld); // 左移動が終わった場所(=hのx、hbarの元y)から出発
  hSprite.visible = true;
  hSprite.material.opacity = 0;

  const riseProgress = { t: 0 };
  tl.to(riseProgress, {
    t: 1,
    duration: riseMorph,
    ease: 'power2.out',
    onUpdate: () => {
      const pos = hbarLeftWorld.clone().lerp(hTarget, riseProgress.t);
      hbarSprite.position.copy(pos);
      hSprite.position.copy(pos);
    },
  }, moveLeft);
  tl.to(hbarSprite.material, { opacity: 0, duration: riseMorph, ease: 'power1.inOut' }, moveLeft);
  tl.to(hSprite.material, { opacity: 1, duration: riseMorph, ease: 'power1.inOut' }, moveLeft);
  tl.call(() => { hbarSprite.visible = false; }, null, moveLeft + riseMorph);

  // ⑵ バーが0→実寸に伸びる
  barSprite.position.copy(barTarget);
  barSprite.scale.x = 0;
  barSprite.visible = true;
  barSprite.material.opacity = 0;
  tl.to(barSprite.material, { opacity: 1, duration: barGrow, ease: 'power1.out' }, moveLeft + riseMorph * 0.5);
  tl.to(barSprite.scale, { x: barTargetWidth, duration: barGrow, ease: 'power2.out' }, moveLeft + riseMorph * 0.5);

  // ⑵ 2πがフェードイン
  denomSprite.position.copy(denomTarget);
  denomSprite.visible = true;
  denomSprite.material.opacity = 0;
  tl.to(denomSprite.material, { opacity: 1, duration: denomFade, ease: 'power1.out' }, moveLeft + riseMorph * 0.5 + barGrow * 0.5);
}

// ── ②→③(2段階。ご指摘により分離): ────────────────────────
// ⑴ バーが伸長し、2π(まだ2πのまま)が新しい分母中心へ、hが新しい分子中心へ移動する。
//    この段階ではまだ回転もCarouselも出てこない。
// ⑵ ⑴で収まった位置のまま、分母がその場で回転してCarouselへ入れ替わる。
// ── Spriteの鏡映(左右反転)ヘルパー ──────────────────────
// ★重要: THREE.Spriteは object.scale.x に負の値を入れても見た目は反転しない。
// Sprite用の内蔵シェーダー(three.js の ShaderLib.sprite)は、スケールを
// `length(modelMatrix[0].xyz)` というベクトルの「長さ」から再計算しており、
// これは符号を持たない(常に非負)。つまりscale.xの符号情報はシェーダーの
// 時点で失われてしまうため、「negative scale.x = 鏡映」という一般的な
// Mesh/PlaneGeometryでの手法はSpriteには通用しない
// (以前 Math.abs(Math.cos(angle)) を外しただけでは反転して見えなかったのはこのため)。
//
// 代わりに、テクスチャのrepeat/offsetを操作してUV自体を反転させる
// (repeat.x = -1, offset.x = 1 で「サンプリング座標を左右逆にする」)。
// こちらはシェーダー側のスケール正規化の影響を受けないので、Spriteでも
// 確実に鏡映表示になる。
function setSpriteMirrored(sprite, mirrored) {
  const texture = sprite.material.map;
  if (!texture) return;
  const targetRepeatX = mirrored ? -1 : 1;
  if (texture.repeat.x === targetRepeatX) return; // 毎フレーム無駄にneedsUpdateを立てない
  texture.repeat.x = targetRepeatX;
  texture.offset.x = mirrored ? 1 : 0;
  texture.needsUpdate = true;
}

function transitionToStage3({ assembly, frame, onComplete }) {
  const p3 = assembly.phase3;
  const vertexWorld = assembly.__phase3VertexWorld;
  const iSprite = assembly.sprites.i;

  const hSprite = p3.sprites.h2;
  const twoPiSprite = p3.sprites.twoPi;
  const carouselSprite = p3.sprites.carousel;
  const barFrom = p3.sprites.barTwoPi;
  const barTo = p3.sprites.barWide;

  const iTarget = stagePartWorld('stage3', 'i', vertexWorld, frame);
  const hTarget = stagePartWorld('stage3', 'h', vertexWorld, frame);
  const barTarget = stagePartWorld('stage3', 'bar', vertexWorld, frame);
  const toDenomPos = stagePartWorld('stage3', 'denom', vertexWorld, frame);
  // twoPiSpriteはtransitionToStage2の時点でstage2の分母位置(fromDenomPos)に
  // 置かれたままここへ来る。ここではその位置からtoDenomPosへ移動させる。

  const { moveDuration, spinDuration } = STAGE_TRANSITION.toStage3;
  const barToTargetWidth = fractionBarWorldWidth(BAR_WIDTH_PX.stage3, 'stage3', 'barWide');

  const tl = gsap.timeline({ onComplete });

  // ── ⑴ バーの伸長 + 2πが分母中心へ + hが分子中心へ(まだ回転しない) ──
  tl.to(iSprite.position, { x: iTarget.x, y: iTarget.y, z: iTarget.z, duration: moveDuration, ease: 'power2.inOut' }, 0);
  tl.to(hSprite.position, { x: hTarget.x, y: hTarget.y, z: hTarget.z, duration: moveDuration, ease: 'power2.inOut' }, 0);
  // ★2026-08-16 再修正: 前回 position.x を直接tweenしたが、frame.right/frame.upは
  //   必ずしもワールドの生のX/Y軸と平行とは限らないため、position.xだけを動かしても
  //   「左右方向だけの移動」にはならない(実際にはまだ縦方向にもズレていた)。
  //   worldToLocalOffset/localOffsetToWorldでframe基準のオフセットに変換し、
  //   rx(左右)だけをtoDenomPosに合わせ、ry(上下)は現在値のまま保持する。
  const twoPiStartOffset = worldToLocalOffset(twoPiSprite.position, vertexWorld, frame);
  const toDenomOffset = worldToLocalOffset(toDenomPos, vertexWorld, frame);
  const twoPiXOnlyTarget = localOffsetToWorld(toDenomOffset.rx, twoPiStartOffset.ry, vertexWorld, frame);
  tl.to(twoPiSprite.position, { x: twoPiXOnlyTarget.x, y: twoPiXOnlyTarget.y, z: twoPiXOnlyTarget.z, duration: moveDuration, ease: 'power2.inOut' }, 0);

  barTo.position.copy(barFrom.position);
  barTo.scale.x = barFrom.scale.x;
  barTo.visible = true;
  barTo.material.opacity = 0;
  tl.to(barFrom.material, { opacity: 0, duration: moveDuration, ease: 'power1.inOut' }, 0);
  tl.to(barTo.material, { opacity: 1, duration: moveDuration, ease: 'power1.inOut' }, 0);
  // ★2026-08-16 修正: barの伸長(position・scale.x)がiの移動(power2.inOut)と
  //   違うイージング(power2.out)だったため、時間は同じでも速度カーブが噛み合わず
  //   「iにbarが突き刺さりながら進む」ように見えていた。iと同じイージングに揃える。
  tl.to(barTo.position, { x: barTarget.x, y: barTarget.y, z: barTarget.z, duration: moveDuration, ease: 'power2.inOut' }, 0);
  tl.to(barTo.scale, { x: barToTargetWidth, duration: moveDuration, ease: 'power2.inOut' }, 0);
  tl.call(() => { barFrom.visible = false; }, null, moveDuration);

  // ── ⑵ ⑴完了後、分母がその場(toDenomPos)で回転してCarouselへ ──
  // (コインが裏返る演出: 前半は2πを回して隠す、後半でCarouselを回しながら見せる)
  carouselSprite.position.copy(toDenomPos);
  carouselSprite.rotation.z = Math.PI; // 裏面から始める
  carouselSprite.visible = true;
  carouselSprite.material.opacity = 0;

  const spinState = { t: 0 };
  tl.to(spinState, {
    t: 1,
    duration: spinDuration,
    ease: 'power1.inOut',
    onUpdate: () => {
      const angle = spinState.t * Math.PI * 2; // 0→360°
      twoPiSprite.rotation.z = angle;
      carouselSprite.rotation.z = Math.PI + angle;
      // scale.xをcos的に潰すと「回転して薄く見える」疑似3D感が出る(大きさは常にabsでOK。
      // Spriteはscale.xの符号を無視するため、反転自体はsetSpriteMirrored()で別途行う)。
      const cosAngle = Math.cos(angle);
      const twoPiSquash = Math.abs(cosAngle);
      twoPiSprite.scale.x = phase3SymbolWorldSize('twoPi').width * twoPiSquash;
      // 90°〜270°(cos(angle)が負の区間)は鏡映画像として見せる=「2πが裏返る」演出。
      setSpriteMirrored(twoPiSprite, cosAngle < 0);

      // carouselは270°〜360°の区間(cos(angle)は0→1で常に非負)にしか見せないため反転不要。
      const carouselSquash = Math.abs(cosAngle);
      carouselSprite.scale.x = phase3SymbolWorldSize('carousel').width * carouselSquash;
      // 切り替えタイミングを180°(t=0.5)→270°(t=0.75)に変更:
      // 2πを270°まで見せ(90°〜270°は反転した状態で見える)、残り90°でCarouselに差し替える。
      if (spinState.t < 0.75) {
        twoPiSprite.material.opacity = 1;
        carouselSprite.material.opacity = 0;
      } else {
        twoPiSprite.material.opacity = 0;
        carouselSprite.material.opacity = 1;
      }
    },
    onComplete: () => {
      twoPiSprite.visible = false;
      twoPiSprite.rotation.z = 0;
      twoPiSprite.scale.x = phase3SymbolWorldSize('twoPi').width;
      setSpriteMirrored(twoPiSprite, false); // 次回(Phase4循環時)のために鏡映状態を必ずリセット
      carouselSprite.rotation.z = 0;
      carouselSprite.scale.x = phase3SymbolWorldSize('carousel').width;
      carouselSprite.material.opacity = 1;
    },
  }, moveDuration); // ← ⑴の終了時刻から開始(=完全に順番。同時発生させない)
}

// ── ③→④: 「h」が先に歩いて着地し、そのあと「i」がジャンプしてhの上に飛び乗り、
// iħ→i_on_hへ融合する。
// ★2026-08-16 全面書き直し(重要な修正): 従来は「iとhを同じ着地点(merged、
//   i_on_h全体を1点として実測した値)へ向けて同時に歩み寄らせる」実装だったが、
//   これだとhの本当の目的地とiの本当の目的地の違い=iが実際にどれだけ移動して
//   hに飛び乗るか、が完全に無視されてしまい、iの飛び乗り位置がおかしく見えて
//   いた。final.pngを2値化してconnected component解析したところ、iのループ
//   (ドット無し、hのアセンダー右上にある渦巻き)とhの本体(アセンダー+ボウル)は
//   インクが繋がっておらず別々の連結成分に分離できたため、それぞれのbbox中心を
//   個別に実測し直した(STAGE_RAW_CENTERS.stage4.h / .i、詳細はそちらのコメント
//   参照)。今回はその実測値を使い、要望通り
//     ⑴ hが先に(直線的に)歩いて自分の着地点(stage4実測のh位置)へ到着
//     ⑵ 少し遅れてiが放物線を描いてジャンプし、hのアセンダー上の着地点
//       (stage4実測のi位置)へ飛び乗る
//   の順で動かす。両者が着地したら、h+i全体のbbox中心(mergedGlyph)に置いた
//   i_on_h.png(実際に繋がった筆致のアート)へクロスフェードする。h_v2.png単体と
//   i.png単体をただ重ねるだけでは、final.pngのような「iのループがhのアセンダーへ
//   一本の線として繋がる」形は再現できない(別々に描かれた字形なので)ため、
//   着地の瞬間だけi_on_h.pngへ差し替えてfinal.pngの見た目に忠実に寄せる…という
//   設計にしていたが、2026-08-16: i_on_h.pngは個別のiSprite/hSpriteとは別途
//   切り抜いたアセットのため、実測値同士のわずかな誤差が「着地の瞬間だけ絵柄が
//   すり替わる」ことでかえって目立ってしまう、とのフィードバックがあり撤去。
//   iSprite・hSpriteをそのまま着地させ、個別のスプライトのまま重ねて表示する。 ──
function transitionToStage4({ assembly, frame, onComplete }) {
  const p3 = assembly.phase3;
  const vertexWorld = assembly.__phase3VertexWorld;
  const iSprite = assembly.sprites.i; // ここまでstage3の位置にいる「i」
  const hSprite = p3.sprites.h2;
  const carouselSprite = p3.sprites.carousel;
  const barSprite = p3.sprites.barWide;

  // 実測ジャンプ元: stage3(carousel_equation.png)実測のi・h位置
  const hopStart = stagePartWorld('stage3', 'i', vertexWorld, frame);

  // 実測着地先: stage4(final.png)実測のh・i個別位置(★同じ点ではない)
  const hTarget = stagePartWorld('stage4', 'h', vertexWorld, frame);
  const iTarget = stagePartWorld('stage4', 'i', vertexWorld, frame);
  const barTarget = stagePartWorld('stage4', 'bar', vertexWorld, frame);
  const toDenomPos = stagePartWorld('stage4', 'denom', vertexWorld, frame);

  const { hMove, gapBeforeHop, hop, merge } = STAGE_TRANSITION.toStage4;

  const tl = gsap.timeline({ onComplete });

  // ⑴ hが先に、直線的に歩いて自分の着地点(hTarget)へ到着する。
  tl.to(hSprite.position, { x: hTarget.x, y: hTarget.y, z: hTarget.z, duration: hMove, ease: 'power2.inOut' }, 0);

  // ⑵ hが完全に止まってから2秒待ち、そのあとiが放物線を描いてジャンプし、
  //   hのアセンダー上の着地点(iTarget)へ飛び乗る。
  // ★2026-08-16 修正: 以前は「hの到着間際にiの助走を重ねる」演出(動く馬に飛び乗る
  //   イメージ)だったが、ご要望により「hが完全に止まる→2秒間→iが動き出す」という
  //   明確に区切られた順番に変更。
  const hopStartTime = hMove + gapBeforeHop;
  const hopPeak = { t: 0 };
  const arcHeight = phase3SymbolWorldSize('h2').height * 0.5;
  tl.to(hopPeak, {
    t: 1,
    duration: hop,
    ease: 'power1.inOut',
    onUpdate: () => {
      const t = hopPeak.t;
      const arc = Math.sin(t * Math.PI) * arcHeight;
      iSprite.position.lerpVectors(hopStart, iTarget, t).addScaledVector(frame.up, arc);
    },
  }, hopStartTime);

  // 両者が着地する時刻。i_on_hへの融合クロスフェードは行わない
  // (iSprite・hSpriteはそのまま不透明で残り、着地位置で重なって見える)。
  const landTime = hopStartTime + hop;

  // Carousel・バーはstage3とほぼ同じ位置なので、わずかな最終微調整だけ
  tl.to(carouselSprite.position, { x: toDenomPos.x, y: toDenomPos.y, z: toDenomPos.z, duration: merge, ease: 'power2.out' }, landTime);
  tl.to(barSprite.position, { x: barTarget.x, y: barTarget.y, z: barTarget.z, duration: merge, ease: 'power2.out' }, landTime);
}

// ── ④→②(循環): Phase4で式を再クリックしたときに使う想定。
// 2026-08-16: i_on_hを廃止したので、stage4で見えているのはhSprite・iSpriteその
// ものになった。これらをstage2位置へ移すには、①一旦フェードアウト(今の位置のまま)
// →②見えなくなったところで位置だけ差し替え→③新しい位置でフェードイン、という
// 順序にしないと「移動が一瞬で見える(ジャンプ)」になってしまうので、その順で行う。──
function transitionStage4ToStage2({ assembly, frame, onComplete }) {
  const p3 = assembly.phase3;
  const vertexWorld = assembly.__phase3VertexWorld;
  const hPos = stagePartWorld('stage2', 'h', vertexWorld, frame);
  const denomPos = stagePartWorld('stage2', 'denom', vertexWorld, frame);
  const barPos = stagePartWorld('stage2', 'bar', vertexWorld, frame);
  const iTarget = stagePartWorld('stage2', 'i', vertexWorld, frame);

  const carouselSprite = p3.sprites.carousel;
  const barWide = p3.sprites.barWide;
  const barTwoPi = p3.sprites.barTwoPi;
  const twoPiSprite = p3.sprites.twoPi;
  const hSprite = p3.sprites.h2;
  const iSprite = assembly.sprites.i;

  const { fadeOut, fadeIn } = STAGE_TRANSITION.toStage2FromStage4;

  twoPiSprite.position.copy(denomPos);
  twoPiSprite.rotation.z = 0;
  twoPiSprite.scale.x = phase3SymbolWorldSize('twoPi').width;
  setSpriteMirrored(twoPiSprite, false); // ④→②で再利用するときも鏡映状態を必ずリセットしておく
  twoPiSprite.visible = true;
  twoPiSprite.material.opacity = 0;

  barTwoPi.position.copy(barPos);
  barTwoPi.scale.x = fractionBarWorldWidth(BAR_WIDTH_PX.stage2, 'stage2', 'barTwoPi');
  barTwoPi.visible = true;
  barTwoPi.material.opacity = 0;

  const tl = gsap.timeline({ onComplete });
  // stage4で見えているh・i(今の位置のまま)と、carousel/barWideを一緒にフェードアウト。
  tl.to([hSprite.material, iSprite.material, carouselSprite.material, barWide.material], {
    opacity: 0, duration: fadeOut, ease: 'power1.in',
  }, 0);
  tl.call(() => {
    carouselSprite.visible = false;
    barWide.visible = false;
    // 見えなくなったところで、h・iをstage2の位置へ再配置する(ジャンプが見えない)。
    hSprite.position.copy(hPos);
    iSprite.position.copy(iTarget);
  }, null, fadeOut);
  // 2π・barTwoPiは新規登場なので少し早めにクロスフェード開始してOK。
  tl.to([twoPiSprite.material, barTwoPi.material], {
    opacity: 1, duration: fadeIn, ease: 'power1.out',
  }, fadeOut * 0.5);
  // h・iはstage2位置へ移ってから(=fadeOut完了後)フェードイン開始。
  tl.to([hSprite.material, iSprite.material], {
    opacity: 1, duration: fadeIn, ease: 'power1.out',
  }, fadeOut);
}

// ステージ間の「静止時間」(秒)。ご要望により、2π出現後に2秒設ける。
// (h→iの間の2秒は、より正確には「hが動いた後・iが動く前」の間なので、
//  ここではなくtransitionToStage4内のgapBeforeHopで扱う)
const STAGE_TRANSITION_HOLD = {
  afterStage2: 2, // 2πが出現した直後の静止
};

function holdThen(seconds, fn) {
  if (!seconds) { fn(); return; }
  gsap.delayedCall(seconds, fn);
}

// ── Phase3オーケストレーション本体 ──────────────────────
// 数式(完成した①iħ∂ψ/∂t=Ĥψ)をクリックした瞬間にmain.jsから一度だけ呼ぶ。
// ②→③→④を自動で連続再生する(ドキュメントの「クリックで自動変化開始」)。
// onStageChange(stageName)は各ステージに切り替わった瞬間に呼ばれる(効果音やログ用、任意)。
export function startPhase3({ assembly, camera, onStageChange, onComplete }) {
  const p3 = assembly.phase3;
  if (!p3 || p3.busy || p3.stage !== 'hbar') return;
  p3.busy = true;

  const frame = computeScreenFrame(camera);
  // 全ステージの位置計算(stagePartWorld)が基準にする頂点。
  //
  // ★2026-08-16 修正: 以前は assembly.sprites.equals.position をそのままvertexWorldに
  // 使っていたが、これは「=」記号の"インク中心"(視覚的な基準線)ではなく、
  // "キャンバス中心"(スプライトの位置そのもの)だった。makeSymbolSprite配置時、
  // equals.pngはキャンバス内でインクが下寄り(非対称な余白)なため、symbolWorldYが
  // paddingCorrection分だけキャンバスをずらして配置している
  // (= 結果としてスプライト位置はインク中心から上にズレている)。
  //
  // Phase3側の全計算(stagePartWorld・EQUALS_MASTER・STAGE_EQUALS_RAW)は
  // 「=」のインク中心そのものを基準線(オフセット0)とみなして設計されているため、
  // このズレがPhase3のi・h・バー・分母すべてに一律に伝播し、
  // derivativeのバーと高さが合わない/iが移動中に浮き上がって見える原因になっていた。
  //
  // ここでequals自身のpaddingCorrectionを逆算して差し引き、真のインク中心
  // (=Phase1がderivative等の基準にしている点、と同じ点)をvertexWorldとして使う。
  const equalsAsset = SYMBOL_ASSETS.equals;
  const equalsScale = EQUATION_SCALE * CROP_TO_MASTER_SCALE;
  const equalsCanvasCenter = { x: equalsAsset.canvas[0] / 2, y: equalsAsset.canvas[1] / 2 };
  const equalsContentCenter = contentCenterPx(equalsAsset.alphaBbox);
  const equalsPaddingCorrection = {
    x: (equalsContentCenter.x - equalsCanvasCenter.x) * equalsScale,
    y: (equalsContentCenter.y - equalsCanvasCenter.y) * equalsScale,
  };
  const vertexWorld = assembly.sprites.equals.position.clone()
    .addScaledVector(frame.right, -equalsPaddingCorrection.x)
    .addScaledVector(frame.up, -equalsPaddingCorrection.y);
  assembly.__phase3VertexWorld = vertexWorld;

  transitionToStage2({
    assembly, frame,
    onComplete: () => {
      p3.stage = 'stage2';
      if (onStageChange) onStageChange('stage2');
      holdThen(STAGE_TRANSITION_HOLD.afterStage2, () => {
        transitionToStage3({
          assembly, frame,
          onComplete: () => {
            p3.stage = 'stage3';
            if (onStageChange) onStageChange('stage3');
            transitionToStage4({
              assembly, frame,
              onComplete: () => {
                p3.stage = 'stage4';
                p3.busy = false;
                if (onStageChange) onStageChange('stage4');
                if (onComplete) onComplete();
              },
            });
          },
        });
      });
    },
  });
}

// ── Phase4想定: ④の状態で式を再クリックするたびに②へ戻り、以後②→③→④を繰り返す。
// (③→④、④→②のみ実装。②→③はtransitionToStage3を再利用) ──
export function cyclePhase3Stage({ assembly, camera, onStageChange, onComplete }) {
  const p3 = assembly.phase3;
  if (!p3 || p3.busy) return;
  if (p3.stage !== 'stage4') return; // ②③の途中では割り込ませない(単純化)
  p3.busy = true;

  const frame = computeScreenFrame(camera);
  transitionStage4ToStage2({
    assembly, frame,
    onComplete: () => {
      p3.stage = 'stage2';
      if (onStageChange) onStageChange('stage2');
      holdThen(STAGE_TRANSITION_HOLD.afterStage2, () => {
        transitionToStage3({
          assembly, frame,
          onComplete: () => {
            p3.stage = 'stage3';
            if (onStageChange) onStageChange('stage3');
            transitionToStage4({
              assembly, frame,
              onComplete: () => {
                p3.stage = 'stage4';
                p3.busy = false;
                if (onStageChange) onStageChange('stage4');
                if (onComplete) onComplete();
              },
            });
          },
        });
      });
    },
  });
}

// TODO(Phase3):
//   - STAGE_RAW_CENTERS/STAGE_EQUALS_RAWは3枚の完成画像から実測した値。「=」を共通原点に
//     PHASE3_IMAGE_SCALEで画像ごとの縮小率を補正しているので、Ĥ・ψ・derivativeとの
//     サイズ・位置の整合性は取れているはず。ズレが残る場合はPHASE3_IMAGE_SCALEまたは
//     STAGE_RAW_CENTERS/STAGE_EQUALS_RAWの実測値を見直してください。
//   - ⑶(②→③)で「i, h/2π」がさらに左へ動く量・タイミングは実測ベースだが、
//     見た目のスピード感(moveDuration/spinDurationとの前後関係)はまだ仮。
//   - transitionToStage3の「回転して裏返る」演出はscale.x(cos疑似3D)+テクスチャUV反転
//     (setSpriteMirrored)によるフェイクで、実際に3D回転(rotation.y等)させたい場合は
//     Spriteではなく PlaneGeometry への変更が必要
//     (SpriteはmodelMatrixの列ベクトルの長さでスケールを再計算するため、negative scale.x
//     では鏡映できない点に注意。setSpriteMirrored()のコメント参照)。
//   - transitionStage4ToStage2は簡易クロスフェード。「iがhから飛び降りる」逆再生モーションに
//     差し替えたい場合はtransitionToStage4のhopアニメーションを参考に。