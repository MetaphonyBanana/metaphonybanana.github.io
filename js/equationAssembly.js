import * as THREE from 'three';

// ── 方程式 iħ∂ψ/∂t = Ĥψ の組み立て演出(schrodinger-sequence-timeline.md 参照) ──
//
// ★ 設計変更(ワールド空間方式。camera.add方式から全面書き直し):
// 記号(Ĥ・ħ・∂ψ/∂t・i・=・ψ)も星(stars.js)も、**全部ワールド空間の
// 同じ1つの座標系**に置く。カメラの子(camera.add)にはしない。
//
// カメラがどんな向きを向いていても、「画面の右」「画面の上」に対応する
// ワールド方向ベクトルは、カメラのmatrixWorldの列から一度取り出すだけで求まる
// (computeScreenFrame参照)。これさえあれば、
//   位置 = 頂点(ワールド座標) + 右ベクトル×オフセット + 上ベクトル×オフセット
// という単純な足し算だけで、記号も星の収束先も同じ式で配置できる。
//
// これにより:
//   ・worldToLocal/localToWorldの往復が不要になる
//     (=「変換のタイミングでカメラや対象が動いていたらズレる」という脆さが構造的になくなる)
//   ・EQUATION_SCALEを上げてもZ(奥行き)が不自然に巨大化しない
//     (そもそも「カメラからの距離」を暗黙に使っていた計算が無くなったため)
//   ・星の収束先とpsi.pngスプライトの位置が、最初から同じ座標系・同じ式で
//     計算されるので、両者がズレる余地がない

// ── カメラの実際の姿勢から「画面の右/上/前方」ベクトルを取り出す ──────────
// カメラのmatrixWorldの列0=ローカルX(右)、列1=ローカルY(上)、
// forwardはcamera.getWorldDirection()(カメラが向いている方向)で取得する。
// Phase 1〜2の間カメラが静止している前提なので、これは一度だけ呼べば十分。
export function computeScreenFrame(camera) {
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward); // 正規化済みで返る
  const cameraPos = camera.getWorldPosition(new THREE.Vector3());
  return { right, up, forward, cameraPos };
}

// frame(computeScreenFrameの戻り値)を使って、「カメラからdepthだけ前方、
// 画面のscreenX(右方向)・screenY(上方向)だけずれた点」のワールド座標を返す。
// hbar/hamiltonianの「軸を歩いている」区間の経路(MANUAL_PATH)に使う。
function planePoint(frame, depth, screenX, screenY) {
  return frame.cameraPos.clone()
    .addScaledVector(frame.forward, depth)
    .addScaledVector(frame.right, screenX)
    .addScaledVector(frame.up, screenY);
}

// ── キャリブレーション: なぜこれが要るか ────────────────────
// hamiltonian.png / hbar.png / i.png / derivative.png は、方程式全体の画像から
// シンボルごとに個別に切り抜かれたPNG。切り抜き時にキャンバスがグリフごとに
// タイトにトリミングされているため、4枚を単純に同じY座標へ並べると、
// 「文字としてのスケールは合っているのに、縦位置(ベースライン)だけズレる」問題が起きる。
//
// これを解決するため、方程式全体を写した1枚の元画像(S_equation-1.png、8000×3237px)から
// 各グリフの実際のバウンディングボックス(ピクセル座標)を計測した。
// 計測の結果、個別切り抜きPNGは元画像に対して常に約0.887倍の拡大率で書き出されている
// ことが確認できた(4シンボルとも誤差1%未満で一致)ので、この係数を使えば
// 「元画像上でのグリフ同士の相対位置」をそのまま個別PNGの配置に変換できる。
const CROP_TO_MASTER_SCALE = 0.887; // 仮(実測値は0.883〜0.891、平均を採用)

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

// 個別切り抜きPNG側のデータ(キャンバスサイズ + アルファのタイトbbox)。実測値。
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
  i: {
    url: new URL('./i.png', import.meta.url).href,
    canvas: [585, 1302],
    alphaBbox: [65, 108, 504, 1228],
    master: MASTER_BBOX.i,
  },
};

// Three.jsのSpriteはテクスチャの中心(=キャンバス中心)をposition.yに置くため、
// キャンバスに余白があると、そのままでは意図した位置からズレる。ここで補正する。
function contentCenterPx([x0, y0, x1, y1]) {
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

// ── EQUATION_SCALE: 元画像の1pxを、ワールド空間で何ユニットにするか(仮・要調整) ──
export const EQUATION_SCALE = 0.00115; // 仮

export function symbolWorldSize(symbolKey) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const scale = EQUATION_SCALE * CROP_TO_MASTER_SCALE;
  return {
    width: asset.canvas[0] * scale,
    height: asset.canvas[1] * scale,
  };
}

// symbolKeyの「上下オフセット量」をスカラーで返す(=からの符号付き距離)。
// このスカラーに frame.up を掛けて足すことで、実際のワールド座標に変換する。
export function symbolWorldY(symbolKey, baseOffset = 0) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const scale = EQUATION_SCALE * CROP_TO_MASTER_SCALE;

  const masterCenterY = contentCenterPx(asset.master.bbox).y;
  const targetOffset = (BASELINE_MASTER_Y - masterCenterY) * EQUATION_SCALE; // 画像は+Yが下なので符号反転

  const canvasCenterY = asset.canvas[1] / 2;
  const contentCenterY = contentCenterPx(asset.alphaBbox).y;
  const paddingCorrection = (contentCenterY - canvasCenterY) * scale;

  return baseOffset + targetOffset + paddingCorrection;
}

// symbolKeyの「左右オフセット量」をスカラーで返す(=からの符号付き距離)。
export function symbolWorldX(symbolKey, baseOffset = 0) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const scale = EQUATION_SCALE * CROP_TO_MASTER_SCALE;
  const baselineMasterX = contentCenterPx(MASTER_BBOX.equals.bbox).x;

  const masterCenterX = contentCenterPx(asset.master.bbox).x;
  const targetOffset = (masterCenterX - baselineMasterX) * EQUATION_SCALE;

  const canvasCenterX = asset.canvas[0] / 2;
  const contentCenterX = contentCenterPx(asset.alphaBbox).x;
  const paddingCorrection = (contentCenterX - canvasCenterX) * scale;

  return baseOffset + targetOffset + paddingCorrection;
}

// ── 微調整用の手動オフセット(frame.right / frame.up 方向のスカラー)。──
// 「ほんの少し左上に」なら、そのシンボルのキーに小さめの負のx・正のyを入れる。
const SYMBOL_MANUAL_OFFSET = {
  psiFinal: { x: 0, y: 0 }, // 仮。必要なら調整してください
};

// symbolKeyの「ワールド空間での最終目標座標」を返す。
// vertexWorld: 頂点(=既存の緑いiのワールド座標)。
// frame: computeScreenFrame(camera) の戻り値。
export function symbolWorldPosition(symbolKey, vertexWorld, frame) {
  const manual = SYMBOL_MANUAL_OFFSET[symbolKey] ?? { x: 0, y: 0 };
  return vertexWorld.clone()
    .addScaledVector(frame.right, symbolWorldX(symbolKey, 0) + manual.x)
    .addScaledVector(frame.up, symbolWorldY(symbolKey, 0) + manual.y);
}

// ── 星→グリフ収束: PNGのアルファ情報から「文字の形をした点群」を作る ──────
const GLYPH_ALPHA_THRESHOLD = 80;
const GLYPH_SAMPLE_STEP = 2;
const GLYPH_MAX_POINTS = 6000;

const glyphPointsCache = {}; // symbolKey -> Promise<Array<{u:number, v:number}>>
// u,v は「そのシンボルの中心を(0,0)とした、幅・高さに対する比率」(-0.5〜0.5)。
// vは画像が+Y下向きなのに対しワールドのframe.upは上向きなので反転済み。

function sampleGlyphPoints(symbolKey) {
  if (glyphPointsCache[symbolKey]) return glyphPointsCache[symbolKey];
  const asset = SYMBOL_ASSETS[symbolKey];
  glyphPointsCache[symbolKey] = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      let data;
      try {
        data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      } catch (err) {
        console.error(`sampleGlyphPoints(${symbolKey}): getImageData失敗`, err);
        resolve([]);
        return;
      }
      const { width, height } = canvas;
      const points = [];
      for (let y = 0; y < height; y += GLYPH_SAMPLE_STEP) {
        for (let x = 0; x < width; x += GLYPH_SAMPLE_STEP) {
          const alpha = data[(y * width + x) * 4 + 3];
          if (alpha > GLYPH_ALPHA_THRESHOLD) {
            points.push({ u: x / width - 0.5, v: 0.5 - y / height });
          }
        }
      }
      if (points.length > GLYPH_MAX_POINTS) {
        for (let i = points.length - 1; i > GLYPH_MAX_POINTS; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [points[i], points[j]] = [points[j], points[i]];
        }
        points.length = GLYPH_MAX_POINTS;
      }
      resolve(points);
    };
    img.onerror = (err) => {
      console.error(`sampleGlyphPoints(${symbolKey}): 画像読み込み失敗`, err);
      resolve([]);
    };
    img.src = asset.url;
  });
  return glyphPointsCache[symbolKey];
}

// symbolKeyの形をした「星の収束先」をワールド座標でcount個生成する。
// basePointWorld: そのシンボルの中心位置(ワールド座標。通常はsymbolWorldPosition()の結果)
// frame: computeScreenFrame(camera) の戻り値(right/upベクトルだけ使う)。
// ⚠ 以前あったcamera.localToWorld()の呼び出しは不要になった
// (=基準点も方向ベクトルも、最初からワールド空間の値をそのまま使っているため)。
export async function computeGlyphWorldPoints(symbolKey, { frame, basePointWorld, count }) {
  const points = await sampleGlyphPoints(symbolKey);
  if (points.length === 0) return [];
  const { width, height } = symbolWorldSize(symbolKey);
  const result = [];
  for (let i = 0; i < count; i++) {
    const p = points[Math.floor(Math.random() * points.length)];
    result.push(
      basePointWorld.clone()
        .addScaledVector(frame.right, p.u * width)
        .addScaledVector(frame.up, p.v * height)
    );
  }
  return result;
}

// ── 星の収束オーケストレーション ──────────────────────
export const STAR_CONVERGENCE = {
  psiFinal: { count: 'all', duration: 60 },
};

// ── 星の収束(ψが形作られていく間)に同期して表示するセリフ(画面右) ────────
const CONVERGENCE_QUOTES = ['Out of this quietness, and entirely in key with it, Seymour called to me.','It came as a pleasant shock that there was a third person in the universe,','and to this feeling was added the justness of its being too.',
'With the canopy lights behind him, his face was shadowed, dimmed out.','From the way he was balanced on the curb edge, from the position of his hands, from — well,',{ text:'the quantity x itself,', duration: 5 },{ text:'I knew as well then as I know now that he was immensely conscious himself of the magic hour of the day.', duration: 15},
];
const CONVERGENCE_QUOTE_INTERVAL = 7.0; // デフォルトの表示間隔(秒)。個別に変えたい場合は下記参照。

// ── Ĥが軸を歩いている間(⑴〜⑷)に同期して表示するセリフ(画面左、psi側と対称) ──
// 仮のプレースホルダー。実際に出したいセリフに差し替えてください。
const HAMILTONIAN_QUOTES = ['What I’m mainly trying to do here, though, is to find the firmest way of suggesting that', 'this curious footlight-and-three-ring heritage has been an almost ubiquitous','and entirely significant reality in the lives of all seven children in our family.',
];
const HAMILTONIAN_QUOTE_INTERVAL = 5;

// ── ①(iħ∂ψ/∂t=Ĥψ)完成と同時に、数式の上へ10秒だけ表示するワンフレーズ ──
// 仮のプレースホルダー。実際に出したいフレーズに差し替えてください。
const EQUATION_COMPLETE_PHRASE = 'It’s “If a body meet a body coming through the rye”!';
const EQUATION_COMPLETE_PHRASE_DURATION = 10;

// leftPercent/topPercent: 画面に対する%位置(CSSのleft/topにそのまま使う)。
// psi用は右(75%)、ham用は左(25%)というように、呼び出し側で対称に配置する。
function createCaptionBox({ leftPercent = 75, topPercent = 50 } = {}) {
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.left = `${leftPercent}%`;
  el.style.top = `${topPercent}%`;
  el.style.transform = 'translate(-50%, -50%)';
  el.style.maxWidth = '520px';
  el.style.padding = '0';
  el.style.background = 'none';
  el.style.border = 'none';
  el.style.boxShadow = 'none';
  el.style.color = '#eef7ff';
  el.style.fontFamily = "'Cormorant Garamond', 'Times New Roman', serif";
  el.style.fontStyle = 'italic';
  el.style.fontWeight = '500';
  el.style.fontSize = '23px';
  el.style.lineHeight = '1.7';
  el.style.textAlign = 'center';
  el.style.letterSpacing = '0.01em';
  el.style.textShadow = '0 0 14px rgba(140, 195, 255, 0.65), 0 1px 3px rgba(0, 0, 0, 0.85)';
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  el.style.transition = 'opacity 0.7s ease, transform 0.7s ease';
  el.style.whiteSpace = 'pre-line';
  el.style.userSelect = 'none';
  el.style.zIndex = '1000';
  document.body.appendChild(el);
  return el;
}

function makeCaptionController(el) {
  const FADE_DURATION_MS = 700;
  let currentText = '';
  let pendingTimer = null;

  function applyNewText(text) {
    currentText = text;
    el.textContent = text;
    if (text.length > 0) {
      requestAnimationFrame(() => { el.style.opacity = '1'; });
    }
  }

  function setText(text) {
    if (text === currentText) return;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    const hadContent = currentText.length > 0;
    if (hadContent) {
      el.style.opacity = '0';
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        applyNewText(text);
      }, FADE_DURATION_MS);
    } else {
      applyNewText(text);
    }
  }

  function hide() { setText(''); }

  // 動的に配置し直したいキャプション(=完成フレーズ用)のためのポジション変更。
  // テキストの表示状態には触れない(位置だけ動かす)。
  function setPosition(leftPercent, topPercent) {
    el.style.left = `${leftPercent}%`;
    el.style.top = `${topPercent}%`;
  }

  return { setText, hide, setPosition };
}

// ── 汎用: セリフを順番に表示していくコントローラー ──────────────────
// quotes: 文字列の配列、または {text, duration} オブジェクトの配列。
//   文字列だけならdefaultDuration(秒)で一定間隔表示(従来通りの挙動)。
//   {text, duration}にすれば、セリフごとに表示時間を個別に変えられる
//   (例: [{ text: '短いセリフ', duration: 3 }, { text: '長めのセリフ...', duration: 9 }])。
function startQuoteSequence(caption, quotes, { defaultDuration = 7.0 } = {}) {
  if (!quotes || quotes.length === 0) return { stop: () => {} };

  const normalized = quotes.map((q) =>
    typeof q === 'string'
      ? { text: q, duration: defaultDuration }
      : { text: q.text, duration: q.duration ?? defaultDuration }
  );

  let idx = 0;
  let timer = null;
  let stopped = false;

  function showNext() {
    if (stopped || idx >= normalized.length) return;
    const { text, duration } = normalized[idx];
    caption.setText(text);
    idx++;
    if (idx < normalized.length) {
      timer = setTimeout(showNext, duration * 1000);
    }
  }
  showNext();

  function stop() {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = null; }
    caption.hide();
  }
  return { stop };
}

function startConvergenceCaption(caption) {
  return startQuoteSequence(caption, CONVERGENCE_QUOTES, { defaultDuration: CONVERGENCE_QUOTE_INTERVAL });
}

function startHamiltonianCaption(caption) {
  return startQuoteSequence(caption, HAMILTONIAN_QUOTES, { defaultDuration: HAMILTONIAN_QUOTE_INTERVAL });
}

// ワールド座標をビューポートに対する%位置(left%/top%としてそのまま使える値)に変換する。
// cameraが静止している前提(Phase 1の間はそう)なので、呼ぶタイミングは一度でよい。
function worldToScreenPercent(worldPos, camera) {
  const ndc = worldPos.clone().project(camera);
  return {
    leftPercent: (ndc.x * 0.5 + 0.5) * 100,
    topPercent: (1 - (ndc.y * 0.5 + 0.5)) * 100,
  };
}

// ①完成の瞬間、数式の少し上にワンフレーズを表示し、10秒後に消す。
// anchorWorld: フレーズを置く基準点のワールド座標(呼び出し側で「数式の上」あたりを渡す)。
function showEquationCompletePhrase(caption, camera, anchorWorld) {
  if (!EQUATION_COMPLETE_PHRASE) return;
  const { leftPercent, topPercent } = worldToScreenPercent(anchorWorld, camera);
  caption.setPosition(leftPercent, topPercent);
  caption.setText(EQUATION_COMPLETE_PHRASE);
  setTimeout(() => caption.hide(), EQUATION_COMPLETE_PHRASE_DURATION * 1000);
}

// starFieldの未割当プールから星を取り出し、symbolKeyの形へ収束させる。
function convergeStarsToSymbol(symbolKey, { starField, frame, basePointWorld, onComplete }) {
  const cfg = STAR_CONVERGENCE[symbolKey];
  const count = cfg.count === 'all' ? starField.remainingCount() : cfg.count;
  const duration = cfg.duration;
  const indices = starField.pickUnassigned(count);
  if (indices.length === 0) {
    console.warn(`convergeStarsToSymbol(${symbolKey}): 未割当の星が残っていません`);
    if (onComplete) onComplete([]);
    return;
  }
  computeGlyphWorldPoints(symbolKey, { frame, basePointWorld, count: indices.length }).then((worldPoints) => {
    if (worldPoints.length === 0) {
      console.warn(`convergeStarsToSymbol(${symbolKey}): グリフ点群が空でした(画像読み込み失敗?)`);
      if (onComplete) onComplete([]);
      return;
    }
    starField.morphStarsToPoints(indices, worldPoints, {
      duration,
      onComplete: () => { if (onComplete) onComplete(indices); },
    });
  });
}

// ψを構成する星の集合を、本物のpsi.pngスプライトへクロスフェードする。
// ★変更: 直列(星が消え切ってからpsi.pngを出す)だと、その境目に「どちらも
// 見えていない/薄い瞬間」ができてしまうため、星のフェードアウトとpsi.pngの
// フェードインを同時に走らせる本来のクロスフェードにした。
// 収束時のψ形状は基準点(basePointWorld)を中心にした点群のばらつきであり、
// psi.pngもまったく同じ基準点(symbolWorldPosition('psiFinal', ...))から
// 配置されるため、重なって見える一瞬があっても位置のズレとしては視認され
// にくいはず(検証済み: 星の位置は基準点から1〜4ユニット程度の、
// 文字の形として正常な範囲に収まっている)。
const STAR_FADE_OUT_DURATION = 1.5;
const PSI_PNG_FADE_IN_DURATION = 1.5;

function fadeStarsThenShowPsiPng({ assembly, starField, psiIndices, vertexWorld, frame, onComplete }) {
  if (!psiIndices || psiIndices.length === 0) {
    if (onComplete) onComplete();
    return;
  }
  starField.markAsGlyph(psiIndices);

  const psiSprite = assembly.sprites.psiFinal;
  psiSprite.position.copy(symbolWorldPosition('psiFinal', vertexWorld, frame));
  psiSprite.visible = true;
  psiSprite.material.opacity = 0;

  // 両方のアニメーションが完了してから初めてonCompleteを呼ぶ(片方が先に
  // 終わってももう片方を待つ。durationを別々に変えても壊れないようにするため)。
  let pending = 2;
  const settle = () => { if (--pending === 0 && onComplete) onComplete(); };

  starField.fadeGlyph(STAR_FADE_OUT_DURATION, settle);
  gsap.to(psiSprite.material, {
    opacity: 1,
    duration: PSI_PNG_FADE_IN_DURATION,
    ease: 'power1.inOut',
    onComplete: settle,
  });
}

// ── アンカー方式について ──────────────────────────
// (A) 中心アンカー(デフォルト) … i / derivative / 最終位置に収まったĤ・ħ 向け。
// (B) 上端アンカー … Ĥ/ħ が「軸を歩いている」間だけ使う。文字の上端が
//     経路のラインに接するように見せたいときに使う。
export function topAnchorCenter(symbolKey) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const canvasH = asset.canvas[1];
  const contentTopPx = asset.alphaBbox[1];
  return new THREE.Vector2(0.5, 1 - contentTopPx / canvasH);
}

// center(アンカー)を上端→中心に切り替える。見た目のジャンプが出ないよう、
// ズレた分だけposition側(frame.up方向)に同時補正する。
function switchToCenterAnchor(sprite, symbolKey, frame) {
  const oldCenterY = sprite.center.y;
  const height = symbolWorldSize(symbolKey).height;
  sprite.center.set(0.5, 0.5);
  sprite.position.addScaledVector(frame.up, (0.5 - oldCenterY) * height);
}

// ── シンボルスプライトの生成 ──────────────────────
export const SYMBOL_COLOR = 0xbfe9ff; // 仮。config.js の AXIS_COLOR と同じ値

// Ĥ・ħ・iは薄い水色のままだと半透明フェード中に見えにくかったため白で染める。
// 他のシンボルもトーンを揃えるため同じく白。
const SYMBOL_COLOR_OVERRIDES = {
  hamiltonian: 0xffffff,
  hbar: 0xffffff,
  i: 0xffffff,
  derivative: 0xffffff,
  psiFinal: 0xffffff,
  equals: 0xffffff,
};

const textureLoader = new THREE.TextureLoader();

function makeSymbolSprite(symbolKey, { anchor = 'center' } = {}) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const texture = textureLoader.load(asset.url);
  texture.colorSpace = THREE.SRGBColorSpace;
  // 元画像の解像度が表示サイズに対してかなり大きく、デフォルトのミップマップ
  // (トライリニア)補間だと必要以上に輪郭がにじんで見えていたため、
  // ミップマップを切ってリニア補間のみにする。
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: SYMBOL_COLOR_OVERRIDES[symbolKey] ?? SYMBOL_COLOR,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(material);
  const { width, height } = symbolWorldSize(symbolKey);
  sprite.scale.set(width, height, 1);
  if (anchor === 'top') sprite.center.copy(topAnchorCenter(symbolKey));
  sprite.visible = false;
  sprite.userData.symbolKey = symbolKey;
  sprite.userData.anchor = anchor;
  return sprite;
}

const AXIS_WALKING_SYMBOLS = new Set(['hamiltonian', 'hbar']); // ← 軸線上を歩く記号は上端アンカー

// scene: 記号はここに直接scene.add()する(ワールド空間に固定。カメラの子にはしない)。
// camera: 初期プレビュー配置のためにcomputeScreenFrame()するのに使う。
export function createEquationAssembly(scene, camera) {
  const sprites = {};
  for (const key of Object.keys(SYMBOL_ASSETS)) {
    const anchor = AXIS_WALKING_SYMBOLS.has(key) ? 'top' : 'center';
    const sprite = makeSymbolSprite(key, { anchor });
    scene.add(sprite); // ← ワールド空間に直接置く
    sprites[key] = sprite;
  }

  // 動作確認用: カメラの現在位置の少し前方を頂点の仮位置として、
  // 「もし今すぐ最終形に並べたら」を見た目確認用に配置しておく。
  const frame = computeScreenFrame(camera);
  const previewVertex = frame.cameraPos.clone().addScaledVector(frame.forward, 10);
  for (const key of Object.keys(sprites)) {
    sprites[key].position.copy(symbolWorldPosition(key, previewVertex, frame));
  }

  const captionEl = createCaptionBox({ leftPercent: 75, topPercent: 50 }); // ψ用(画面右)
  const caption = makeCaptionController(captionEl);

  const hamCaptionEl = createCaptionBox({ leftPercent: 25, topPercent: 50 }); // Ĥ用(画面左、psiと対称)
  const hamCaption = makeCaptionController(hamCaptionEl);

  const completePhraseEl = createCaptionBox({ leftPercent: 50, topPercent: 50 }); // ①完成フレーズ用(位置は表示時に動的に上書きする)
  const completePhraseCaption = makeCaptionController(completePhraseEl);

  return { sprites, caption, hamCaption, completePhraseCaption };
}

// ── 軸を歩く経路(hbar/hamiltonian専用) ──────────────────────
// ご要望通り「奥行き(カメラからの距離)は固定、画面の右/上方向にだけ動く」経路にしてある。
// depth: カメラから頂点までの距離をそのまま使う(=歩いている間も、最終的に収まる
//   場所と近い奥行きになるので、サイズ感が唐突に変わらない)。
// screenX/screenY: 画面の右・上方向へのオフセット(仮値。見ながら調整してください)。
//   ハミルトニアン: start=(0,7) → end=(-11,-3) (⑴で start→end、⑷で end→start)
//   ħ:          start=(11,-3) → end=(0,7)
function buildWalkPaths(frame, depth) {
  return {
    hamiltonian: {
      start: planePoint(frame, depth, 0, 7),
      end: planePoint(frame, depth, -11, -3),
    },
    hbar: {
      start: planePoint(frame, depth, 11, -3),
      end: planePoint(frame, depth, 0, 7),
    },
  };
}

// ── Phase 1 開始: iクリック(finale.js側でキャプションを消した直後)に呼ぶ ──────
//
// existingISprite: finale.js が返す iSprite(頂点に既にいる緑いi、ワールド座標)。
// camera: startPhase1の間ずっと静止している前提のカメラ(FINALE_DESTで静止済み)。
//   computeScreenFrame()に一度使うだけ(毎フレーム呼ぶ必要はない)。
// starField: main.js の createStars() が返すオブジェクト。
// onEquationComplete: ①(iħ∂ψ/∂t=Ĥψ)が完全に出来上がった瞬間に呼ばれる。
export function startPhase1({ assembly, existingISprite, camera, starField, onHbarArrived, onEquationComplete }) {
  const frame = computeScreenFrame(camera);
  const vertexWorld = existingISprite.getWorldPosition(new THREE.Vector3());
  const depth = vertexWorld.clone().sub(frame.cameraPos).dot(frame.forward); // カメラ→頂点の投影距離

  const walk = buildWalkPaths(frame, depth);
  const hamStart = walk.hamiltonian.start;
  const hamEnd = walk.hamiltonian.end;
  const hbarStart = walk.hbar.start;
  const hbarEnd = walk.hbar.end;

  // ── ∂ψ/∂t: 最終位置で静止したまま15秒フェードイン ──
  const derivativeSprite = assembly.sprites.derivative;
  derivativeSprite.position.copy(symbolWorldPosition('derivative', vertexWorld, frame));
  derivativeSprite.visible = true;
  derivativeSprite.material.opacity = 0;
  gsap.to(derivativeSprite.material, {
    opacity: 1,
    duration: 15,
    delay: 1,
    ease: 'power2.in',
  });

  // ── Ĥ: hamStart → hamEnd → hamStart → 数式内の最終位置(ドキュメント⑴・⑶・⑷・⑸) ──
  const hamiltonianSprite = assembly.sprites.hamiltonian;
  hamiltonianSprite.position.copy(hamStart);
  hamiltonianSprite.visible = true;
  hamiltonianSprite.material.opacity = 0;
  gsap.to(hamiltonianSprite.material, { opacity: 1, duration: 0.6, ease: 'power1.out' });

  // Ĥが軸を歩いている間(⑴〜⑷)だけ、画面左にセリフを流す(psi側と対称)。
  const hamCaptionSeq = startHamiltonianCaption(assembly.hamCaption);

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
          hamCaptionSeq.stop(); // 軸歩き終了。ここでĤ用セリフも締める
          // ⑸: 原点に帰還 → 数式内の最終位置へ。
          const hamTarget = symbolWorldPosition('hamiltonian', vertexWorld, frame);
          switchToCenterAnchor(hamiltonianSprite, 'hamiltonian', frame);
          gsap.to(hamiltonianSprite.position, {
            x: hamTarget.x,
            y: hamTarget.y,
            z: hamTarget.z,
            duration: 0.8,
            ease: 'power2.out',
            onComplete: () => {
              // Ĥの帰還完了をトリガーに、星の収束を開始する(ドキュメント⑸・⑹)。
              if (!starField) return;
              starField.setRotationEnabled(false);
              const convergenceCaption = startConvergenceCaption(assembly.caption);

              // 直前の頂点のワールド座標を改めて取得(既存の緑iが動いていないか一応再確認)。
              const freshVertexWorld = existingISprite.getWorldPosition(new THREE.Vector3());
              const psiBase = symbolWorldPosition('psiFinal', freshVertexWorld, frame);

              convergeStarsToSymbol('psiFinal', {
                starField, frame, basePointWorld: psiBase,
                onComplete: (psiIndices) => {
                  convergenceCaption.stop();
                  fadeStarsThenShowPsiPng({
                    assembly, starField, psiIndices, vertexWorld: freshVertexWorld, frame,
                    onComplete: () => {
                      // ⑺: 「=」をフェードインで出現させる(①完成、Phase 2完了→Phase 3へ)。
                      const equalsSprite = assembly.sprites.equals;
                      equalsSprite.position.copy(symbolWorldPosition('equals', freshVertexWorld, frame));
                      equalsSprite.visible = true;
                      equalsSprite.material.opacity = 0;
                      gsap.to(equalsSprite.material, {
                        opacity: 1,
                        duration: 2,
                        delay: 2,
                        ease: 'power1.out',
                        onComplete: () => { 
                          // ①(iħ∂ψ/∂t=Ĥψ)完成と同時に、数式の少し上へワンフレーズを10秒表示する。
                          // ∂ψ/∂t(derivative)が数式内で一番上に来る記号なので、その上端を基準点にする。
                          const derivativeSprite = assembly.sprites.derivative;
                          const phraseAnchor = derivativeSprite.position.clone()
                            .addScaledVector(frame.up, symbolWorldSize('derivative').height / 2 + 0.5);
                          showEquationCompletePhrase(assembly.completePhraseCaption, camera, phraseAnchor);
                          if (onEquationComplete) onEquationComplete();
                        },
                      });
                    },
                  });
                },
              });
            },
          });
        },
      });
    },
  });

  // ── ħ: hbarStart → hbarEnd、7秒 ──
  const hbarSprite = assembly.sprites.hbar;
  hbarSprite.position.copy(hbarStart);
  hbarSprite.visible = true;
  hbarSprite.material.opacity = 0;
  gsap.to(hbarSprite.material, { opacity: 1, duration: 0.6, ease: 'power1.out' });

  const travel = { t: 0 };
  gsap.to(travel, {
    t: 1,
    duration: 7,
    ease: 'power2.inOut',
    onUpdate: () => {
      hbarSprite.position.lerpVectors(hbarStart, hbarEnd, travel.t);
    },
    onComplete: () => {
      // ここでħが頂点(=既存の緑i)に重なる。
      if (onHbarArrived) onHbarArrived({ hbarSprite, existingISprite, vertexWorld });
      settleIAndHbar({ assembly, existingISprite, hbarSprite, vertexWorld, frame });
    },
  });

  return { vertexWorld, frame };
}

// ── ⑵: ħ到着後 → iの色変化 → iħが最終位置へ移動 ──────────────────
// 既存の緑いi(i-icon.png)は画像自体が着色済みでmaterial.colorでは染め直せないため、
// 「色変化」は次の3ステップで表現する:
//   1) 白インク版のi(assembly.sprites.i)を、既存の緑iと同じ位置にクロスフェードで重ねる
//   2) 同時に既存の緑iをフェードアウト
//   3) 色が変わったあと、新しいi・ħの両方を最終位置へ移動
const I_COLOR_CHANGE_DURATION = 1;
const I_HBAR_MOVE_DURATION = 3;

function settleIAndHbar({ assembly, existingISprite, hbarSprite, vertexWorld, frame }) {
  switchToCenterAnchor(hbarSprite, 'hbar', frame); // 「軸を歩く」区間の終わり(見た目ジャンプなし)

  const newISprite = assembly.sprites.i;
  newISprite.position.copy(vertexWorld); // 既存の緑iと全く同じ場所に重ねて登場させる
  newISprite.visible = true;
  newISprite.material.opacity = 0;

  const tl = gsap.timeline();
  tl.to(newISprite.material, { opacity: 1, duration: I_COLOR_CHANGE_DURATION, ease: 'power1.inOut' }, 0);
  tl.to(existingISprite.material, { opacity: 0, duration: I_COLOR_CHANGE_DURATION, ease: 'power1.inOut' }, 0);
  tl.call(() => { existingISprite.visible = false; });

  const iTarget = symbolWorldPosition('i', vertexWorld, frame);
  const hbarTarget = symbolWorldPosition('hbar', vertexWorld, frame);
  tl.to(newISprite.position, { x: iTarget.x, y: iTarget.y, z: iTarget.z, duration: I_HBAR_MOVE_DURATION, ease: 'power2.inOut' }, I_COLOR_CHANGE_DURATION);
  tl.to(hbarSprite.position, { x: hbarTarget.x, y: hbarTarget.y, z: hbarTarget.z, duration: I_HBAR_MOVE_DURATION, ease: 'power2.inOut' }, I_COLOR_CHANGE_DURATION);
}

// TODO:
//   - buildWalkPaths()のscreenX/screenY値(0,7 / -11,-3 / 11,-3)は前バージョンからの
//     引き継ぎ値。ワールド空間方式でも見た目が近くなるはずだが、実際に見て微調整が必要。
//   - STAR_CONVERGENCE の count/duration は仮値。
//   - GLYPH_SAMPLE_STEP / GLYPH_ALPHA_THRESHOLD も画像次第で調整が必要かもしれない。