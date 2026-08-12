import * as THREE from 'three';
import { AXIS_WORLD_DIR, AXIS_LENGTH } from './config.js';

// ── 方程式 iħ∂ψ/∂t = Ĥψ の組み立て演出(schrodinger-sequence-timeline.md 参照) ──
//
// ★ 設計変更(camera.add方式):
// このPhase 1〜2の間、カメラは FINALE_DEST に静止したまま動かない
// (finale.js の travelToDest 完了後の状態のまま)。カメラが動かないなら、
// 全シンボルのスプライトを scene ではなく camera の子として追加してしまえば、
// カメラのローカル+X/+Yがそのまま「画面の右/上」になるので、
// SCREEN_RIGHT_DIR / SCREEN_UP_DIR のような変換ベクトルを別途計算する必要が
// なくなる(=finale.jsのcomputeUp()に依存しなくてよくなる)。
//
// 軸(origin/Z軸終端/X軸終端)のような「本物の3D世界座標」も、camera.worldToLocal()
// で一度だけローカル座標に変換しておけば、以降のアニメーションは全部
// ローカル座標(≒画面座標)だけで設計できる。これにより:
//   ・以前の HAM_PATH_LIFT_RATIO / HBAR_PATH_LIFT_RATIO のような
//     「理由を説明できない見た目補正」が不要になる
//   ・軸を歩く区間の経路も、3Dの物理的制約を気にせず「画面上でどう動いたら
//     気持ちいいか」だけで自由にキーフレームを足せる

// ── キャリブレーション: なぜこれが要るか ────────────────────
// hamiltonian.png / hbar.png / i.png / derivative.png は、方程式全体の画像から
// シンボルごとに個別に切り抜かれたPNG。切り抜き時にキャンバスがグリフごとに
// タイトにトリミングされているため、4枚を単純に同じY座標へ並べると、
// 「文字としてのスケールは合っているのに、縦位置(ベースライン)だけズレる」問題が起きる
// (例: iはドットと本体の間の余白が大きい/∂ψ/∂tは上下に長い、等、グリフごとに
//  キャンバス内の余白の取られ方が違うため)。
//
// これを解決するため、方程式全体を写した1枚の元画像(S_equation-1.png、8000×3237px)から
// 各グリフの実際のバウンディングボックス(ピクセル座標)を計測した。
// 計測の結果、個別切り抜きPNGは元画像に対して常に約0.887倍の拡大率で書き出されている
// ことが確認できた(4シンボルとも誤差1%未満で一致)ので、この係数を使えば
// 「元画像上でのグリフ同士の相対位置」をそのまま個別PNGの配置に変換できる。
const CROP_TO_MASTER_SCALE = 0.887; // 仮(実測値は0.883〜0.891、平均を採用。ズレが気になれば要再計測)

// 元画像(S_equation-1.png)上での各グリフのバウンディングボックス [x0,y0,x1,y1](px、画像座標=Y下向き)
// 「=」の中心Yを基準線(baseline)として、他のシンボルはそこからの相対位置で配置する。
const MASTER_BBOX = {
  i:           { bbox: [104,  1166, 495,  2159] },
  hbar:        { bbox: [728,  1112, 1453, 2159] },
  derivative:  { bbox: [1640, 89,   3495, 3183] }, // ∂ψ/∂t 分数全体
  equals:      { bbox: [4128, 1598, 5111, 1943] }, // ← 基準線はここ
  hamiltonian: { bbox: [5652, 776,  6892, 2143] },
  psiFinal:    { bbox: [6976, 1112, 7870, 2439] },
};
const BASELINE_MASTER_Y = (MASTER_BBOX.equals.bbox[1] + MASTER_BBOX.equals.bbox[3]) / 2; // 1770.5

// 個別切り抜きPNG側のデータ(キャンバスサイズ + アルファのタイトbbox)。
// キャンバスサイズ・alphaBboxは実測値(Pythonで測定済み)。urlはこのプロジェクトの
// アセット配置に合わせて変更してください(現状は main.js と同階層想定)。
export const SYMBOL_ASSETS = {
  hbar: {
    url: new URL('./hbar.png', import.meta.url).href,
    canvas: [865, 1266],
    alphaBbox: [24, 50, 842, 1225],
    master: MASTER_BBOX.hbar,
  },
  derivative: {
    url: new URL('./derivative.png', import.meta.url).href,
    canvas: [2226, 3671],
    alphaBbox: [55, 104, 2150, 3605],
    master: MASTER_BBOX.derivative,
  },
  hamiltonian: {
    url: new URL('./hamiltonian.png', import.meta.url).href,
    canvas: [1499, 1661],
    alphaBbox: [46, 59, 1449, 1603],
    master: MASTER_BBOX.hamiltonian,
  },
  // psiFinal / equals: derivative.pngと同じ縦の切り出し窓(キャンバス高さ3671で共通)で
  // 書き出されているので、本来はsymbolWorldYの計算に頼らなくても3枚とも同じYで揃うはず。
  psiFinal: {
    url: new URL('./psi.png', import.meta.url).href,
    canvas: [1198, 3671],
    alphaBbox: [38, 1269, 1046, 2766],
    master: MASTER_BBOX.psiFinal,
  },
  equals: {
    url: new URL('./equals.png', import.meta.url).href,
    canvas: [2085, 3671],
    alphaBbox: [497, 1814, 1606, 2203],
    master: MASTER_BBOX.equals,
  },
  // i.png: 以前は「既存の緑iをそのまま流用」する方針だったが、緑iは画像自体が
  // 着色済み(material.colorでは染め直せない)ため、色変化の演出にはこちらの
  // 白インク版を使う。既存の緑iとクロスフェードで入れ替える(startPhase1内)。
  i: {
    url: new URL('./i.png', import.meta.url).href,
    canvas: [585, 1302],
    alphaBbox: [65, 108, 504, 1228],
    master: MASTER_BBOX.i,
  },
};

// ── 個別切り抜きPNGの「キャンバス中心」と「グリフの実中心(alphaBboxの中心)」のズレ ──
// Three.jsのSpriteはテクスチャの中心(=キャンバス中心)をposition.yに置くため、
// キャンバスに余白があると、そのままでは意図した位置からズレる。ここで補正する。
function contentCenterPx([x0, y0, x1, y1]) {
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

// ── EQUATION_SCALE: 元画像の1pxを、ローカル空間で何ユニットにするか(仮・要調整) ──
export const EQUATION_SCALE = 0.00115; // 仮

// symbolKey(SYMBOL_ASSETSのキー)から、ローカル空間でのスプライトサイズを計算する。
export function symbolWorldSize(symbolKey) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const scale = EQUATION_SCALE * CROP_TO_MASTER_SCALE;
  return {
    width: asset.canvas[0] * scale,
    height: asset.canvas[1] * scale,
  };
}

// symbolKeyの「上下オフセット量」をスカラーで返す(=からの符号付き距離、ローカル単位)。
// equationRowY: 「=」の基準線をローカル空間のどのYに置くか(呼び出し側が決める。通常は0)
export function symbolWorldY(symbolKey, equationRowY) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const scale = EQUATION_SCALE * CROP_TO_MASTER_SCALE;

  // 1) 元画像上での「基準線からのズレ」をローカル距離に変換(画像は+Yが下なので符号反転)
  const masterCenterY = contentCenterPx(asset.master.bbox).y;
  const targetOffset = (BASELINE_MASTER_Y - masterCenterY) * EQUATION_SCALE;

  // 2) 個別PNG側の「キャンバス中心 vs グリフ実中心」のズレを補正
  const canvasCenterY = asset.canvas[1] / 2;
  const contentCenterY = contentCenterPx(asset.alphaBbox).y;
  const paddingCorrection = (contentCenterY - canvasCenterY) * scale;

  return equationRowY + targetOffset + paddingCorrection;
}

// symbolKeyの「左右オフセット量」をスカラーで返す(=からの符号付き距離、ローカル単位)。
// equationCenterX: 数式全体(「=」中心)をローカル空間のどのXに置くか(通常は0)
export function symbolWorldX(symbolKey, equationCenterX) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const scale = EQUATION_SCALE * CROP_TO_MASTER_SCALE;
  const baselineMasterX = contentCenterPx(MASTER_BBOX.equals.bbox).x;

  const masterCenterX = contentCenterPx(asset.master.bbox).x;
  const targetOffset = (masterCenterX - baselineMasterX) * EQUATION_SCALE;

  const canvasCenterX = asset.canvas[0] / 2;
  const contentCenterX = contentCenterPx(asset.alphaBbox).x;
  const paddingCorrection = (contentCenterX - canvasCenterX) * scale;

  return equationCenterX + targetOffset + paddingCorrection;
}

// ── symbolKeyの「ローカル空間での最終目標座標」を返す ─────────────
// basePointLocal: 通常は「頂点(=既存の緑いiの位置)」をカメラのローカル空間に
// 変換した座標(startPhase1側でcamera.worldToLocal()して渡す)。
// カメラのローカル+Xがそのまま画面の右、+Yがそのまま画面の上、+Zが画面の手前
// (カメラは-Z方向を見る)なので、オフセットをそのままx/yへ足すだけでよい。
// z(奥行き)はbasePointLocalと同じ値をそのまま使う=常にiと同じ「面」に揃う。
function symbolRightOffset(symbolKey) {
  return symbolWorldX(symbolKey, 0);
}

export function symbolLocalTargetPosition(symbolKey, basePointLocal) {
  return new THREE.Vector3(
    basePointLocal.x + symbolRightOffset(symbolKey),
    basePointLocal.y + symbolWorldY(symbolKey, 0),
    basePointLocal.z
  );
}

// ── アンカー方式について ──────────────────────────
// 2つの置き方をサポートする:
//
// (A) 中心アンカー(デフォルト、center=0.5,0.5) + ベースライン計算(symbolWorldY/X)
//     … i / derivative / 最終位置に収まったĤ・ħ のように「数式内の正しい
//     縦位置」に置きたい記号向け。
//
// (B) 上端アンカー(center=(0.5, topAnchorY)) … Ĥ/ħ が軸線上を歩いている間だけ使う。
//     Sprite.center を変えると、position がスプライトの中心ではなく指定した点になる
//     (center.y=1が上端、0が下端)。キャンバスに余白があるとキャンバス上端≠文字上端に
//     なるので、alphaBboxのy0(上端の余白ぶん)を引いて、実際の文字の上端に位置基準を
//     一致させている。position.y にそのまま「軸線のY座標」を渡せば、文字の一番上が
//     軸線に接するように置ける。
//
// ⚠ 上端アンカー→中心アンカーへ切り替える瞬間、position自体は変えずに
//   center(=描画の基準点)だけ変えると、見た目がその場でパッと(文字の高さの
//   半分ぶん)ズレる。switchToCenterAnchor() でその分をposition側に
//   同時補正することで、見た目を動かさずにアンカーだけ切り替えられる。
export function topAnchorCenter(symbolKey) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const canvasH = asset.canvas[1];
  const contentTopPx = asset.alphaBbox[1]; // 上端の余白(px)
  return new THREE.Vector2(0.5, 1 - contentTopPx / canvasH);
}

// center(アンカー)を上端→中心に切り替える。position(ローカル座標)を
// 同時に補正して、切り替わった瞬間の見た目のジャンプをなくす。
// sprite は camera の子である前提(=position はローカルY、SCREEN_UP相当は+Y)。
function switchToCenterAnchor(sprite, symbolKey) {
  const oldCenterY = sprite.center.y;
  const height = symbolWorldSize(symbolKey).height;
  sprite.center.set(0.5, 0.5);
  sprite.position.y += (0.5 - oldCenterY) * height;
}

// ── シンボルスプライトの生成 ──────────────────────
// PNG自体は白インク+アルファで書き出したものを使う想定(黒のままだとSpriteMaterial.colorを
// 掛けても「黒×色=黒」にしかならず、染色できないため)。白なら「白×色=色」になるので、
// ここのSYMBOL_COLORを変えるだけで自由に色を変えられる。
export const SYMBOL_COLOR = 0xbfe9ff; // 仮。config.js の AXIS_COLOR と同じ値
const textureLoader = new THREE.TextureLoader();

// anchor: 'center'(デフォルト) | 'top' … 'top'ならtopAnchorCenter()を使う(Ĥ/ħ向け)
function makeSymbolSprite(symbolKey, { anchor = 'center' } = {}) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const texture = textureLoader.load(asset.url);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: SYMBOL_COLOR, // ← 白インクのテクスチャをこの色で染める
    transparent: true,
    depthWrite: false,
    depthTest: false, // ← camera.add方式では常に手前に見せたいのでZテストを切る(仮。不要なら削除可)
    opacity: 0, // 初期状態は非表示(フェードインはアニメ側で制御)
  });
  const sprite = new THREE.Sprite(material);
  const { width, height } = symbolWorldSize(symbolKey);
  sprite.scale.set(width, height, 1);
  if (anchor === 'top') sprite.center.copy(topAnchorCenter(symbolKey));
  sprite.visible = false;
  sprite.renderOrder = 999; // depthTest:falseと合わせて、常に手前に描画されるようにする(仮)
  sprite.userData.symbolKey = symbolKey;
  sprite.userData.anchor = anchor;
  return sprite;
}

// i と = と 最終ψ はまだ用意できていない(i=既存の緑icon流用、=と最終ψは未取得の別素材)。
// 呼び出し側(main.js想定)で、返ってきたspritesを好きなタイミングでvisible/opacityを
// 切り替えつつ、schrodinger-sequence-timeline.mdのステップ⑴〜⑺のアニメーションに使う。
const AXIS_WALKING_SYMBOLS = new Set(['hamiltonian', 'hbar']); // ← 軸線上を歩く記号は上端アンカー

// 動作確認用プレビュー配置(camera.add直後の見た目確認用)に使う、
// カメラ正面のやや手前の基準点(ローカル座標)。数式のスケール感を見るためだけの仮値。
const PREVIEW_DEPTH = 10;

// ── 経路の開始点・終点(ローカル座標)。ここを直接編集して調整する ──
// null のままなら「軸の実座標(origin/Z軸終端/X軸終端)」を自動変換した値を使う。
// Vector3を入れれば、そちらが優先される(=軸の実座標と無関係に自由な位置を指定できる)。
//   ローカル座標の意味: x=右がプラス、y=上がプラス、z=カメラに近づく方向がプラス
//   (カメラは-Z方向を見ているので、画面に映したいなら通常zは負の値)
//
//   hamiltonian: start=原点側、end=Z軸終端側(⑴で start→end、⑷で end→start に戻る)
//   hbar:        start=X軸終端側、end=頂点側(既存の緑iの位置。通常はnullのままでよい)
const MANUAL_PATH = {
  hamiltonian: {
    start: new THREE.Vector3(0,7,-31), // 例: new THREE.Vector3(-3, -2, -12)
    end: new THREE.Vector3(-11,-3,-31), // 例: new THREE.Vector3(4, 3, -12)
  },
  hbar: {
    start: new THREE.Vector3(11, -3, -31) , // 例: new THREE.Vector3(6, -1.5, -10) ← X軸終端をここで細かく指定できる
    end: new THREE.Vector3(0, 7, -31),
  },
};

// scene: シンボルは描画リスト上scene配下にある必要はないが、将来的な後方互換や
// デバッグ用にsceneも受け取れるようにしておく(現状は未使用でもOK)。
// camera: 必須。スプライトはこのcameraの子として追加する(=カメラのローカル空間に固定)。
//   ⚠ camera自身がsceneのシーングラフに繋がっていないと、camera.add()した
//   子は描画されない。sceneSetup.js側で `scene.add(camera)` されているか要確認。
export function createEquationAssembly(scene, camera) {
  const sprites = {};
  for (const key of Object.keys(SYMBOL_ASSETS)) {
    const anchor = AXIS_WALKING_SYMBOLS.has(key) ? 'top' : 'center';
    const sprite = makeSymbolSprite(key, { anchor });
    camera.add(sprite); // ← scene.addではなくcamera.add: カメラのローカル空間に固定する
    sprites[key] = sprite;
  }

  // 動作確認用: カメラ正面のやや手前(PREVIEW_DEPTH)を基準点として、
  // 「もし今すぐ最終形に並べたら」の位置に置いてみる(見た目確認用の仮配置)。
  const previewBase = new THREE.Vector3(0, 0, -PREVIEW_DEPTH);
  for (const key of Object.keys(sprites)) {
    sprites[key].position.copy(symbolLocalTargetPosition(key, previewBase));
  }

  return { sprites };
}

// ── Phase 1 開始: iクリック(finale.js側でキャプションを消した直後)に呼ぶ ──────
//
// existingISprite: finale.js が返す iSprite(頂点に既にいる緑いi、ワールド座標)を渡す。
// camera: startPhase1の間ずっと静止している前提のカメラ(FINALE_DESTで静止済み)。
//   worldToLocal変換に使うほか、一度だけ呼べば十分(毎フレーム呼ぶ必要はない)。
// onHbarArrived: ħが到着した瞬間に呼ばれる(色変化などは呼び出し側 or 次の実装で)。
export function startPhase1({ assembly, existingISprite, camera, onHbarArrived }) {
  camera.updateMatrixWorld(); // worldToLocalの前に念のため最新化しておく

  // 「頂点(=既存の緑いiの位置)」をカメラのローカル空間に変換。
  // 以降、このvertexLocalを基準に、全部ローカル座標だけでレイアウトする。
  const vertexWorld = existingISprite.getWorldPosition(new THREE.Vector3());
  const vertexLocal = camera.worldToLocal(vertexWorld.clone());

  // 「原点」「Z軸終端」「X軸終端」も一度だけローカル座標に変換しておく(フォールバック用)。
  // カメラは静止しているのでこの変換値はアニメーション中ずっと使い回せる。
  const originLocal = camera.worldToLocal(new THREE.Vector3(0, 0, 0));
  const zAxisEndLocal = camera.worldToLocal(
    AXIS_WORLD_DIR.Z.clone().normalize().multiplyScalar(AXIS_LENGTH)
  );
  const xAxisEndLocal = camera.worldToLocal(
    AXIS_WORLD_DIR.X.clone().normalize().multiplyScalar(AXIS_LENGTH)
  );

  // MANUAL_PATHに値が入っていればそちらを優先、無ければ軸の実座標を使う。
  const hamStart = MANUAL_PATH.hamiltonian.start ?? originLocal;
  const hamEnd = MANUAL_PATH.hamiltonian.end ?? zAxisEndLocal;
  const hbarStart = MANUAL_PATH.hbar.start ?? xAxisEndLocal;
  const hbarEnd = MANUAL_PATH.hbar.end ?? vertexLocal;

  // ── ∂ψ/∂t: 最終位置で静止したまま15秒フェードイン ──
  const derivativeSprite = assembly.sprites.derivative;
  derivativeSprite.position.copy(symbolLocalTargetPosition('derivative', vertexLocal));
  derivativeSprite.visible = true;
  derivativeSprite.material.opacity = 0;
  gsap.to(derivativeSprite.material, {
    opacity: 1,
    duration: 15,
    ease: 'power1.out',
  });

  // ── Ĥ: hamStart → hamEnd → hamStart → 数式内の最終位置(ドキュメント⑴・⑶・⑷・⑸) ──
  // start/endはMANUAL_PATH.hamiltonianで直接指定できる(未指定ならorigin/zAxisEndを使用)。
  const hamiltonianSprite = assembly.sprites.hamiltonian;
  hamiltonianSprite.position.copy(hamStart);
  hamiltonianSprite.visible = true;
  hamiltonianSprite.material.opacity = 0;
  gsap.to(hamiltonianSprite.material, { opacity: 1, duration: 0.6, ease: 'power1.out' });

  const outbound = { t: 0 };
  gsap.to(outbound, {
    t: 1,
    duration: 15, // ∂ψ/∂tのフェードイン(15秒)と同時に到着させる(ドキュメント⑶)
    ease: 'power1.inOut',
    onUpdate: () => {
      hamiltonianSprite.position.lerpVectors(hamStart, hamEnd, outbound.t);
    },
    onComplete: () => {
      const inbound = { t: 0 };
      gsap.to(inbound, {
        t: 1,
        duration: 4, // ドキュメント⑷
        ease: 'power2.inOut',
        onUpdate: () => {
          hamiltonianSprite.position.lerpVectors(hamEnd, hamStart, inbound.t);
        },
        onComplete: () => {
          // ⑸: 原点に帰還 → 数式内の最終位置へ。
          const hamTarget = symbolLocalTargetPosition('hamiltonian', vertexLocal);
          switchToCenterAnchor(hamiltonianSprite, 'hamiltonian'); // 上端→中心アンカーへ(見た目ジャンプなし)
          gsap.to(hamiltonianSprite.position, {
            x: hamTarget.x,
            y: hamTarget.y,
            z: hamTarget.z,
            duration: 0.8,
            ease: 'power2.out',
          });
        },
      });
    },
  });

  // ── ħ: hbarStart → hbarEnd、4秒 ──
  // start/endはMANUAL_PATH.hbarで直接指定できる(未指定ならxAxisEnd/vertexを使用)。
  const hbarSprite = assembly.sprites.hbar;
  hbarSprite.position.copy(hbarStart);
  hbarSprite.visible = true;
  hbarSprite.material.opacity = 0;
  gsap.to(hbarSprite.material, { opacity: 1, duration: 0.6, ease: 'power1.out' }); // 出発時にさっと現れる

  const travel = { t: 0 };
  gsap.to(travel, {
    t: 1,
    duration: 7,
    ease: 'power2.inOut', // 仮。axisCamera.jsの遷移と近い緩急にしてある
    onUpdate: () => {
      hbarSprite.position.lerpVectors(hbarStart, hbarEnd, travel.t);
    },
    onComplete: () => {
      // ここでħが頂点(=既存の緑i)に重なる。
      if (onHbarArrived) onHbarArrived({ hbarSprite, existingISprite, vertexLocal });
      settleIAndHbar({ assembly, existingISprite, hbarSprite, vertexLocal });
    },
  });

  return { vertexLocal, originLocal, zAxisEndLocal, xAxisEndLocal };
}

// ── ⑵: ħ到着後 → iの色変化 → iħが左へ移動 ──────────────────
// 既存の緑いi(i-icon.png)は画像自体が着色済みで material.color では
// 綺麗に染め直せないため、「色変化」は次の3ステップで表現する:
//   1) 白インク版のi(assembly.sprites.i、SYMBOL_COLORで着色済み)を、
//      既存の緑iと全く同じ位置に重ねてフェードイン
//   2) 同時に既存の緑iをフェードアウト(=見た目としては色が変わったように見える)
//   3) 色が変わったあと、新しいi・ħの両方を最終位置へ移動(1秒)。
const I_COLOR_CHANGE_DURATION = 1; // ドキュメントの「1+1秒」の前半
const I_HBAR_MOVE_DURATION = 3;    // 同、後半

function settleIAndHbar({ assembly, existingISprite, hbarSprite, vertexLocal }) {
  // ħは「軸を歩く」区間が終わったので、ここで上端→中心アンカーに切り替える
  // (見た目のジャンプなし)。
  switchToCenterAnchor(hbarSprite, 'hbar');

  const newISprite = assembly.sprites.i;
  newISprite.position.copy(vertexLocal); // 既存の緑iと全く同じ場所に重ねて登場させる
  newISprite.visible = true;
  newISprite.material.opacity = 0;

  const tl = gsap.timeline();
  tl.to(newISprite.material, { opacity: 1, duration: I_COLOR_CHANGE_DURATION, ease: 'power1.inOut' }, 0);
  tl.to(existingISprite.material, { opacity: 0, duration: I_COLOR_CHANGE_DURATION, ease: 'power1.inOut' }, 0);
  tl.call(() => { existingISprite.visible = false; });

  const iTarget = symbolLocalTargetPosition('i', vertexLocal);
  const hbarTarget = symbolLocalTargetPosition('hbar', vertexLocal);
  tl.to(newISprite.position, { x: iTarget.x, y: iTarget.y, z: iTarget.z, duration: I_HBAR_MOVE_DURATION, ease: 'power2.inOut' }, I_COLOR_CHANGE_DURATION);
  tl.to(hbarSprite.position, { x: hbarTarget.x, y: hbarTarget.y, z: hbarTarget.z, duration: I_HBAR_MOVE_DURATION, ease: 'power2.inOut' }, I_COLOR_CHANGE_DURATION);
}

// TODO: runEquationAssembly({ scene, camera, assembly, existingGreenI, onComplete })
// schrodinger-sequence-timeline.md の ⑴〜⑺ 全体を実装する本体(startPhase1はその一部)。
// 以下、まだ手を付けていない残りの項目:
//   - 星→ψへのGPUモーフ(stars.js側の拡張が必要、ドキュメント⑸・⑹。Ĥの帰還完了をトリガーに開始)
//     ※星は camera の子ではなく scene 直下のワールド座標オブジェクトのはずなので、
//       ψの最終見た目位置(=psiFinalスプライトのローカル位置)をワールド座標へ
//       変換してあげる必要がある(camera.localToWorld()を使う)。
//   - 「=」のフェードイン(ドキュメント⑺、①完成。vertexLocal に
//     equalsスプライトをフェードインすればよいはず)