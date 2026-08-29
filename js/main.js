import * as THREE from 'three';
import {
  ARCHER_POS, AXIS_X_FAR, TUNE,
  AXIS_WORLD_DIR, AXIS_LENGTH, AXIS_STATION,
  HOME_CAMERA_POS, HOME_CAMERA_TARGET,
} from './config.js';
import { createSceneSetup } from './sceneSetup.js';
import { createStars } from './stars.js';
import { createSagittarius } from './sagittarius.js';
import { createArcherArt } from './archerArt.js';
import { createArrow } from './introActors.js';
import { createBanana } from './banana.js';
import { createAxes } from './axes.js';
import { createZAxisWave } from './zAxisWave.js';
import { createAxisLabels } from './axisLabels.js';
import { createYZPanel } from './yzPanel.js';
import { createBilliardTable } from './billiardTable.js';
import { createBananafish } from './bananafish.js';
import { createHotspots } from './hotspots.js';
import { createDialogue } from './dialogue.js';
import { createIntroSequence } from './introSequence.js';
import { getAxisStationView, flyToAxisStation } from './config.js';
import { createAxisStationOverlay } from './axisStationOverlay.js';
import { createAxisConstellationOverlay } from './axisConstellationOverlay.js';
import { AXIS_CONTENT } from './data/axisContent.js';
import { createFinale, runFinale, handleIconClick } from './finale.js';
import { createEquationAssembly, startPhase1, zoomToEquation, startPhase3, cyclePhase3Stage } from './equationAssembly.js';
import { playOriginBurst } from './originBurst.js';
import { createUniverse, enterUniverse, toggleUniverseEquation, updateUniverse, updateEquationHoverByPointer } from './universe.js';
import { createSolarSystem, updateSolarSystem, generatePlanetTrails, PERSONAL_PAGE_URL } from './solarSystem.js';

// YZパネルクリック時、メインカメラをビリヤード専用ページと同じ構図にする。
const BILLIARD_CAMERA_POS = new THREE.Vector3(AXIS_LENGTH / 2, -AXIS_LENGTH / 2, AXIS_LENGTH / 2);
const BILLIARD_CAMERA_TARGET = new THREE.Vector3(AXIS_LENGTH / 2, AXIS_LENGTH / 2, 0); // パネル中央(=9,9,0)
const BILLIARD_TRANSITION_DURATION = 1.3; // yzPanel.js のRIPPLE_SPEEDと揃えている(パネル対角線を走り抜ける時間)

const SAGITTARIUS_MESSAGE = { text: 'Shirley you said you were sagitarius\nbut your only taurus bring your skates\nwhen you come over to my house', work: 'The Catcher in the Rye'}

// 隠しボタン「i」(虚数単位)をクリックしたときに表示するメッセージ。
// 今は仮のプレースホルダーなので、実際の演出(別ページ遷移・特別なダイアログ等)に合わせて差し替えてください。
const IMAGINARY_BUTTON_MESSAGE = 'A ZEN KOAN';

// 2点間をなめらかに補間するだけのシンプルなカメラフライト(flyToAxisStationの球面補間とは別物。
// ホーム⇄軸ステーションの往復ではなく、パネル→ビリヤード専用ページの「覗き込む」動きに使う)
//
// camera.up は直前の軸ステーション用のカスタムup(world上向きとは限らない)を引き継いだままなので、
// ここで明示的にworld上向き(0,1,0)へ補間しないと、lookAt()の基準が崩れてカメラが逆さまになる。
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function flyCameraLinear(camera, controls, targetPos, targetLookAt, duration, onComplete) {
  if (controls) controls.enabled = false;
  const startPos = camera.position.clone();
  const startTarget = controls ? controls.target.clone() : new THREE.Vector3();
  const startUp = camera.up.clone();
  const progress = { t: 0 };
  const lookAt = new THREE.Vector3();

  return gsap.to(progress, {
    t: 1,
    duration,
    ease: 'power2.inOut',
    onUpdate: () => {
      camera.position.lerpVectors(startPos, targetPos, progress.t);
      lookAt.lerpVectors(startTarget, targetLookAt, progress.t);
      camera.up.copy(startUp).lerp(WORLD_UP, progress.t).normalize();
      camera.lookAt(lookAt);
    },
    onComplete: () => {
      camera.position.copy(targetPos);
      camera.up.copy(WORLD_UP);
      camera.lookAt(targetLookAt);
      if (controls) {
        controls.target.copy(targetLookAt);
        controls.enabled = true;
        controls.update();
      }
      if (onComplete) onComplete();
    }
  });
}

// ── シーン一式のセットアップ ─────────────────────
const { scene, camera, renderer, controls, composer, lookTarget, excludeFromBloom, render } = createSceneSetup();

const starField = createStars(scene, 3000);
const clock = new THREE.Clock();

const hotspotMeshes = createHotspots(scene);

const finale = createFinale(scene);
let finaleActive = false; // フィナーレ開始後はcameraBusy/controlsとは別に、全インタラクションを止める
// ⚠ iアイコンはtravelToOrigin途中(p.t>0.85)でフェードイン・クリック判定ONになるが、
// その時点ではまだカメラはtravelToDestの途中(FINALE_DESTへ移動中)のことがある。
// startPhase1はcomputeScreenFrame(camera)でその瞬間のカメラ姿勢を確定させてしまうため、
// カメラが完全に静止する前にクリックされると、以後の記号・星の配置が全部
// 「中途半端な姿勢」を基準にしてズレる。これを防ぐため、travelToDest完了(onDone)まで
// iクリックの処理自体を保留するフラグ。
let finaleCameraSettled = false;

// ── Phase3(数式クリックでのズーム・②③④展開)関連の状態 ──
let equationComplete = false; // ①(iħ∂ψ/∂t=Ĥψ)が完成した瞬間にtrueへ
let equationZoomed = false;   // 数式へズームイン済みか
let equationVertexWorld = null; // ズーム・Phase3配置計算に使う頂点(=緑iだった場所)のワールド座標
let equationFrame = null;       // computeScreenFrame(camera)のスナップショット(ズーム時のカメラ姿勢基準)

const { state: bananaState, triggerShatter } = createBanana(scene);

const archer = createSagittarius(scene, ARCHER_POS);
archer.visible = false;

// オープニング演出でのみ浮かび上がる射手座アートワーク(3D空間に固定されたSprite)。
// ARCHER_POSからのオフセットで配置。ズレを直したい場合はこのVector3を調整する。
const archerArtPos = new THREE.Vector3(
  ARCHER_POS.x + 54,
  ARCHER_POS.y - 40,
  ARCHER_POS.z
);
const archerArt = createArcherArt(scene, archerArtPos, { width: 288, height: 192, blurPX: 3 });

const arrowGroup = createArrow(scene);

const equationAssembly = createEquationAssembly(scene, camera);
// 数式シンボルのBloom(発光・にじみ)強度。0=完全になし、1=通常の他の発光と同じ強さ。
// 見た目を見ながらこの値だけ調整すればOK。
const EQUATION_BLOOM_INTENSITY = 0.8;
Object.values(equationAssembly.sprites).forEach((sprite) => excludeFromBloom(sprite, EQUATION_BLOOM_INTENSITY));
const axes = createAxes(scene);
const universe = createUniverse(scene); // ← Phase3以降、画面クリックで遷移する「宇宙ページ」(星なし・回転する三軸+方程式画像)
// バナナ惑星+それを中心にバナナ型軌道で回る太陽系(8惑星入れ子)。宇宙ページ限定の装飾。
// anchorはuniverse.jsの三脚(tripod)と重ならない位置に仮置き(座標は見た目を見ながら調整してください)。
const solarSystem = createSolarSystem(scene, new THREE.Vector3(AXIS_LENGTH * 1.4, AXIS_LENGTH * 0.25, 0));
const zWave = createZAxisWave(scene); // Z軸:ガウス波束のらせん(軸到達後にreveal、その後ゆっくり位相回転)
const axisLabels = createAxisLabels(scene); // 三軸(X/Y/Z)のラベル(home状態になったら表示)
const axisStationOverlay = createAxisStationOverlay(scene); // X/Y軸ステーション限定の追加表示(終端・原点の点+タイトル)
const axisConstellationOverlay = createAxisConstellationOverlay(scene); // Teddy/Catcherクリック時の星座風画像(現時点ではTeddyのみ画像あり)
const yzPanel = createYZPanel(scene); // Y軸ステーション時、YZ平面(概念Y全長×概念Z全長)に浮かぶ反射・透明パネル
const billiardTable = createBilliardTable({
  // ビリヤード台を閉じたら、Y軸ステーションの視点へカメラを戻す(軸クリック時と同じ飛び方)
  onClose: () => {
    cameraBusy = true;
    const view = getAxisStationView(AXIS_WORLD_DIR.Y, AXIS_LENGTH);
    flyToAxisStation(camera, controls, view, {
      duration: AXIS_STATION.duration,
      onComplete: () => {
        cameraBusy = false;
        currentAxisView = 'Y';
        yzPanel.setActive(true);
        showYOverlay(); // ビリヤード台から戻ってきたら、Y軸ステーションの追加表示も出し直す
      }
    });
  }
});

// Y軸原点の点をクリックしたときに開く「A Perfect Day for Bananafish」専用ページ。
// billiardTableと全く同じ仕組み(独立オーバーレイ+onCloseでYステーションへ戻す)。
const bananafish = createBananafish({
  onClose: () => {
    cameraBusy = true;
    const view = getAxisStationView(AXIS_WORLD_DIR.Y, AXIS_LENGTH);
    flyToAxisStation(camera, controls, view, {
      duration: AXIS_STATION.duration,
      onComplete: () => {
        cameraBusy = false;
        currentAxisView = 'Y';
        yzPanel.setActive(true);
        showYOverlay(); // バナナフィッシュのページから戻ってきたら、Y軸ステーションの追加表示も出し直す
      }
    });
  }
});

const dialogue = createDialogue(camera);

const intro = createIntroSequence({
  camera, controls, lookTarget, archer, arrowGroup,
  bananaState, triggerShatter, axes,
  TUNE, ARCHER_POS, AXIS_X_FAR,
  HOME_CAMERA_POS, HOME_CAMERA_TARGET,
  archerArt,
});

// ── クリック処理 ───────────────────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let cameraBusy = false; // 軸間を移動中は多重クリックを無視する
let panelTransitioning = false;
let currentAxisView = null; // 現在到達しているステーションの軸名('X'/'Y'/'Z'/null=まだどこにも到達していない)

// ── Y軸ステーション限定の追加表示(終端の点+「Nine Stories」)のオン/オフ ──
// 表示中はY軸ラベルの「Y」の文字を消し、代わりに終端の点とタイトルを出す。
// カメラが動いた(=controlsの'change')ら元の状態(Yの文字だけの通常表示)に戻す。
let yOverlayActive = false;

function showYOverlay() {
  axisLabels.sprites.Y.visible = false;
  axisStationOverlay.showY();
  yOverlayActive = true;
}

function hideYOverlay() {
  if (!yOverlayActive) return;
  axisLabels.sprites.Y.visible = true;
  axisStationOverlay.hideY();
  axisConstellationOverlay.hideTeddyImage(); // ← Teddyクリックで出した星座風画像もここで消す
  dialogue.hide(); // 終端の点のセリフを表示中だった場合、10秒タイマーでの誤復帰を防ぐため即閉じる
  yOverlayActive = false;
}

// ── X軸ステーション限定の追加表示のオン/オフ(Yと同じ考え方) ──
let xOverlayActive = false;

function showXOverlay() {
  axisLabels.sprites.X.visible = false;
  axisStationOverlay.showX();
  axes.setXFlowActive(true); // ← The Catcher in the Rye表示と同じ条件でX軸の流れ演出をオンにする
  xOverlayActive = true;
}

function hideXOverlay() {
  if (!xOverlayActive) return;
  axisLabels.sprites.X.visible = true;
  axisStationOverlay.hideX();
  axes.setXFlowActive(false); // ← 同上、オフに戻す
  axisConstellationOverlay.hideCatcherImage(); // ← Catcherの星座風画像もここで消す
  dialogue.hide(); // 原点付近の点のセリフを表示中だった場合、10秒タイマーでの誤復帰を防ぐため即閉じる
  xOverlayActive = false;
}

// ── Z軸ステーション限定の追加表示のオン/オフ(X/Yと同じ考え方) ──
let zOverlayActive = false;

function showZOverlay() {
  axisLabels.sprites.Z.visible = false;
  axisStationOverlay.showZ();
  zOverlayActive = true;
}

function hideZOverlay() {
  if (!zOverlayActive) return;
  axisLabels.sprites.Z.visible = true;
  axisStationOverlay.hideZ();
  dialogue.hide(); // 原点/終端の点のセリフを表示中だった場合、10秒タイマーでの誤復帰を防ぐため即閉じる
  // ※ ここでzWave.reset()は呼ばない。hideZOverlay()は「空白クリックで点/タイトル表示だけ戻す」ケースでも
  //   呼ばれるため、カメラがZステーションに留まったままでも、らせんまで消えてしまっていた(意図しない挙動)。
  //   らせんを消すのは「別の軸へ実際に移動するとき」(下のaxisHit処理)とPhase3突入時のみにする。
  zOverlayActive = false;
}

// Z軸原点クリックで、ガウス波束のらせんを原点(画面左)→先端(画面右)へ伸ばして発生させる。
// 既に発生中/発生済みの状態で再度クリックされた場合も、最初からやり直す(reset→reveal)。
let zWaveRevealTween = null;
function triggerZWave() {
  zWaveRevealTween?.kill();
  zWave.reset();
  const waveProgress = { t: 0 };
  zWaveRevealTween = gsap.to(waveProgress, {
    t: 1,
    duration: 2.2,
    ease: 'power2.out',
    onUpdate: () => zWave.reveal(waveProgress.t),
  });
}

// ── Phase3: 数式ズーム時、軸まわりの表示を消す ──
// axisLabels/axisStationOverlayはSpriteのopacityを掴めるので滑らかにフェードできるが、
// axes(軸ライン本体)・zWave(らせん)は現状fadeOut()のようなメソッドを持たないため、
// 「あれば呼ぶ」という保険付きの実装にしてある(typeof判定)。
// axes.js/zAxisWave.js側に fadeOut(duration) を生やしてもらえれば、自動的に滑らかになる。
function fadeOutAxisVisuals(duration = 1.2) {
  hideXOverlay();
  hideYOverlay();
  hideZOverlay();

  [axisLabels.sprites.X, axisLabels.sprites.Y, axisLabels.sprites.Z].forEach((sprite) => {
    if (!sprite || !sprite.visible) return;
    gsap.to(sprite.material, {
      opacity: 0,
      duration,
      ease: 'power1.out',
      onComplete: () => { sprite.visible = false; },
    });
  });

  yzPanel.setActive(false);

  if (typeof axes.fadeOut === 'function') axes.fadeOut(duration);
  // zWaveにfadeOut()は実装されていない(常にこのtypeofチェックがfalseになり無視されていた)。
  // Phase3以降で万一まだ再生中でも確実に消えるよう、reset()で強制停止する(フェードなし・即座に非表示)。
  zWave.reset();
}

// 以前はここで controls の 'change'(カメラが少しでも動いた瞬間)を監視して
// Y/Xステーションの追加表示を即座に元へ戻していたが、カメラ操作に対してシビアすぎたため撤廃。
// 代わりに、下のクリックハンドラの末尾で「何もない場所をクリックした」ことを条件に元へ戻すようにしている。

// YZ平面パネルのクリック処理:
// 1) 原点側の角から波紋を発生させる
// 2) それに合わせてメインカメラをビリヤード専用ページと同じ位置・向きへ運ぶ
// 3) 到着したら画面をビリヤード台へ切り替える(オーバーレイをshow)
function onYZPanelClick() {
  if (cameraBusy) return;
  cameraBusy = true;
  panelTransitioning = true; 
  hideYOverlay(); // ビリヤード台へ移動するので、Y軸ステーションの追加表示は元に戻しておく
  hideXOverlay(); // 念のためX側も(通常はYステーションでしか起きない操作だが、状態を必ず揃えておく)

  yzPanel.ripple(clock.getElapsedTime());

  flyCameraLinear(camera, controls, BILLIARD_CAMERA_POS, BILLIARD_CAMERA_TARGET, BILLIARD_TRANSITION_DURATION, () => {
    panelTransitioning = false; 
    yzPanel.setActive(false); // パネル自体は非表示に戻す(戻ってきたときにonCloseで再度有効化する)
    billiardTable.show();
    // cameraBusyはtrueのまま維持(オーバーレイが画面全体を覆っている間、下のシーンはクリックできない)。
    // billiardTable側の「← 戻る」でonCloseが呼ばれ、そこでYステーションへ戻す。
  });
}
// ── シーン切り替え時の「継ぎ目隠し」用オーバーレイ ──────────────
// 数式Phase3→宇宙ページの遷移で、カメラが瞬時にジャンプする一方
// 旧スプライトのフェードアウトが1.2秒かけて続いていたため、新カメラのフレームの中に
// 旧数式の残骸が一瞬映り込んでいた(カメラのカットとフェードのタイミングがズレていたのが原因)。
// three.js側で全部のタイミングを丁寧に揃える代わりに、DOM側の単純な黒オーバーレイで
// 「見えない一瞬」を作り、その裏で瞬時に切り替えてしまう(fadeIn→onMid→fadeOut)。
const transitionOverlay = document.createElement('div');
Object.assign(transitionOverlay.style, {
  position: 'fixed',
  inset: '0',
  background: '#000',
  opacity: '0',
  pointerEvents: 'none',
  zIndex: '9999',
  transition: 'opacity 0.3s ease',
});
document.body.appendChild(transitionOverlay);

function fadeTransition({ fadeInDuration = 0.3, hold = 0.15, fadeOutDuration = 0.3, onMid, onDone } = {}) {
  transitionOverlay.style.transition = `opacity ${fadeInDuration}s ease`;
  transitionOverlay.style.opacity = '1';
  setTimeout(() => {
    if (onMid) onMid(); // ← 画面が完全に黒い間に、旧要素の消灯・カメラジャンプを済ませる
    setTimeout(() => {
      transitionOverlay.style.transition = `opacity ${fadeOutDuration}s ease`;
      transitionOverlay.style.opacity = '0';
      if (onDone) setTimeout(onDone, fadeOutDuration * 1000);
    }, hold * 1000);
  }, fadeInDuration * 1000);
}

renderer.domElement.addEventListener('click', (e) => {
  if (intro.getState() === 'idle') { intro.startSequence(); return; }

  // フィナーレ中でも「i」アイコンだけは特別にクリックを許可する
  // (ただし、カメラがFINALE_DESTに完全に静止してから。理由は finaleCameraSettled の定義部を参照)
  if (finaleActive) {
    if (!finaleCameraSettled) return; // カメラがまだ動いている間はiクリックを一切処理しない

    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const finaleIconHit = finale.iHitArea.visible
      ? raycaster.intersectObject(finale.iHitArea)[0]
      : null;
    // ①完成後、数式そのもの(表示中のシンボルスプライト)をクリックしたらズーム→Phase3。
    if (equationComplete) {
      const p3 = equationAssembly.phase3;

      if (universe.isActive) {
        // ── 宇宙ページ内のクリック判定 ──────────────────
        // ★以前のバグ: ここが無く、下のvisibleSymbols(equationAssembly/p3のスプライトのみ)を
        //   判定していたため、宇宙ページ突入後は対象スプライトが全部visible=falseになっており
        //   eqHitが絶対にヒットしない(=toggleUniverseEquationに永遠に到達できない)状態だった。
        const activeEqSprite = universe.sprites[universe.equationIndex];
        const uEqHit = (activeEqSprite && activeEqSprite.visible)
          ? raycaster.intersectObject(activeEqSprite)[0]
          : null;
        if (uEqHit) {
          toggleUniverseEquation(universe);
          return;
        }

        // 宇宙ページ用hotspot(セリフ星)。既存hotspots.jsと同じ判定パターン。
        const uniHotspotHit = raycaster.intersectObjects(universe.hotspotMeshes)[0];
        if (uniHotspotHit) {
          const starMesh = uniHotspotHit.object.userData.texts ? uniHotspotHit.object : uniHotspotHit.object.parent;
          const texts = starMesh.userData.texts;
          dialogue.show(texts[Math.floor(Math.random() * texts.length)], starMesh);
          return;
        }

        // バナナ惑星クリック → 個人ページへ(月面基地ページ、URLは仮のプレースホルダー)
        if (solarSystem.group.visible) {
          const bananaHit = raycaster.intersectObject(solarSystem.bananaMesh, true)[0];
          if (bananaHit) {
            window.location.href = PERSONAL_PAGE_URL;
            return;
          }

          // 太陽クリック → 8惑星ぶんの黄色い軌跡を一括生成(一度生成したら永続。二度目以降は何もしない)
          const sunHit = raycaster.intersectObject(solarSystem.sunMesh, true)[0];
          if (sunHit) {
            generatePlanetTrails(solarSystem);
            return;
          }
        }
        return; // 宇宙ページ内では、ここまでの判定以外は無視
      }

      const visibleSymbols = [
        ...Object.values(equationAssembly.sprites),
        ...(p3 ? Object.values(p3.sprites) : []),
      ].filter((s) => s && s.visible);
      const eqHit = raycaster.intersectObjects(visibleSymbols)[0];
      if (eqHit) {
        if (!equationZoomed) {
          // 1クリック目: 軸まわりをフェードアウトしつつ数式へズーム
          equationZoomed = true;
          fadeOutAxisVisuals(1.2);
          zoomToEquation({
            camera, controls,
            vertexWorld: equationVertexWorld,
            frame: equationFrame,
            duration: 1.6,
            onComplete: () => {
              // ズーム完了後の最初のクリックで②③④の自動展開を開始する
              startPhase3({ assembly: equationAssembly, camera, onComplete: () => {
                console.log('Phase3(②③④)展開完了');
              } });
            },
          });
        } else if (p3 && p3.stage === 'stage4' && !p3.busy) {
          // Phase3(④)到達後の追加クリックで「宇宙ページ」へ遷移する(1回目のみ。以降はuniverse.isActiveの分岐へ)
          // 旧シーンのフェードアウトとカメラのジャンプ(enterUniverse内で瞬時に発生)の
          // タイミングがズレて残像が見えていたため、黒オーバーレイで一瞬隠している間に
          // 旧要素を即座に消灯し、カメラも切り替える。
          fadeTransition({
            onMid: () => {
              axes.fadeOut(0.1); // オーバーレイが晴れる前に消え切るよう、ごく短時間に
              axisLabels.hide();
              const oldSprites = [
                ...Object.values(equationAssembly.sprites),
                ...Object.values(p3.sprites),
              ].filter((s) => s && s.visible);
              oldSprites.forEach((s) => {
                s.material.opacity = 0;
                s.visible = false;
              });

              enterUniverse(universe, {
                camera, controls,
                duration: 1.0, // オーバーレイが晴れた後の新シーンのフェードイン
                onComplete: () => {
                  solarSystem.group.visible = true; // 宇宙ページ到達と同時にバナナ+太陽系も出す
                  console.log('宇宙ページへ遷移完了');
                },
              });
            },
          });
        }
        return;
      }
    }

    if (finaleIconHit) {
      handleIconClick({
        finale,
        onNextPhase: () => {
          // まず原点で「黄色い輝点(十字フレア)+青い同心円」を一度だけ再生し、
          // それが完全に終わってからĤ(=startPhase1本体)を登場させる。
          playOriginBurst({
            scene,
            onComplete: () => {
              const result = startPhase1({
                assembly: equationAssembly,
                existingISprite: finale.iSprite,
                camera,
                starField, // ← 星→ψ→=の収束(schrodinger-sequence-timeline.md ⑸〜⑺)に使う
                onHbarArrived: () => { console.log('ħがiに到着'); },
                onEquationComplete: () => {
                  console.log('①(iħ∂ψ/∂t=Ĥψ)完成');
                  equationComplete = true; // ← ここから数式クリックでのズームを受け付ける
                },
              });
              equationVertexWorld = result.vertexWorld;
              equationFrame = result.frame;
            },
          });
        },
      });
    }
    return; // i 以外は引き続き無視
  }

  // ★ここが消えていた本来のトリガー。フィナーレ未開始時に星を押すとここで開始する
  const finaleHit = raycaster.intersectObject(finale.star)[0];
  if (finaleHit) {
    finaleActive = true;
    cameraBusy = true; // 念のため既存の排他制御にも乗せておく
    runFinale({
      camera, controls, dialogue, finale,
      onOrigin: () => { /* 必要ならここで公案の見た目切り替え等 */ },
      onDone: () => {
        finaleCameraSettled = true; // ← カメラがFINALE_DESTに完全静止。ここで初めてiクリックを受け付ける
      },
    });
    return;
  }

  if (intro.getState() !== 'home' || cameraBusy) return;

  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const starHit = raycaster.intersectObjects(hotspotMeshes)[0];

  if (intro.getState() !== 'home' || cameraBusy) return;

  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
const panelHit = yzPanel.isActive() ? raycaster.intersectObject(yzPanel.mesh)[0] : null;
if (panelHit) {
  onYZPanelClick();
  return;
}

if (starHit) {
  // hitAreaがヒットした場合、親(実際の星メッシュ)まで遡ってuserDataを取る
  const starMesh = starHit.object.userData.texts ? starHit.object : starHit.object.parent;
  const texts = starMesh.userData.texts;
  const text = texts[Math.floor(Math.random() * texts.length)];

  dialogue.show(text, starMesh);
  return;
}

// 射手座(sagittarius.js)はどれかの星をクリックしたら、星座全体(星+線)を消して
// 固定セリフ(SAGITTARIUS_MESSAGE)を1つだけ表示する。
if (archer.visible) {
  const archerHit = raycaster.intersectObjects(archer.userData.stars, true)[0];
  if (archerHit) {
    archer.visible = false; // 星も線も子要素なので、これで射手座全体が消える
    dialogue.show(SAGITTARIUS_MESSAGE, archer);
    return;
  }
}


  if (axisStationOverlay.yEndDot.visible) {
    const endHit = raycaster.intersectObject(axisStationOverlay.yEndDot, true)[0];
    if (endHit) {
      const title = AXIS_CONTENT.Y.end?.title;
      if (title) dialogue.show(title, axisStationOverlay.yEndDot);
      axisConstellationOverlay.showTeddyImage(); // ← Teddyの星座風画像(Cat.png)をフェードイン
      return;
    }
  }

  if (axisStationOverlay.yOriginDot.visible) {
    const yOriginHit = raycaster.intersectObject(axisStationOverlay.yOriginDot, true)[0];
    if (yOriginHit) {
      // セリフの代わりに、専用ページ(bananafish.js)をオーバーレイで開く
      // (YZパネル→ビリヤード台と同じ「フルスクリーンオーバーレイへ切り替える」導線)。
      // onCloseが呼ばれるまでcameraBusyをtrueのまま維持する(billiardTable呼び出し時と同じ)。
      cameraBusy = true;
      hideYOverlay();
      bananafish.show();
      return;
    }
  }

  // 隠しボタン「i」(Yステーション限定)。他の点(yEndDot等)と同じく、iHit.visibleで判定する。
  // クリック時の挙動はここが仮実装(ダイアログ表示)なので、必要な演出に差し替えてください。
  if (axisStationOverlay.iHit.visible) {
    const iHitResult = raycaster.intersectObject(axisStationOverlay.iHit)[0];
    if (iHitResult) {
      dialogue.show(IMAGINARY_BUTTON_MESSAGE, axisStationOverlay.iHit);
      return;
    }
  }

  if (axisStationOverlay.xEndDot.visible) {
    const xEndHit = raycaster.intersectObject(axisStationOverlay.xEndDot, true)[0];
    if (xEndHit) {
      const title = AXIS_CONTENT.X.end?.title;
      if (title) dialogue.show(title, axisStationOverlay.xEndDot);
      axisConstellationOverlay.showCatcherImage(); // ← Catcherの星座風画像(Catcher1.png)をフェードイン
      return;
    }
  }

  if (axisStationOverlay.xOriginDot.visible) {
    const originHit = raycaster.intersectObject(axisStationOverlay.xOriginDot, true)[0];
    if (originHit) {
      const title = AXIS_CONTENT.X.origin?.title;
      if (title) dialogue.show(title, axisStationOverlay.xOriginDot);
      return;
    }
  }

  if (axisStationOverlay.zOriginDot.visible) {
    const zOriginHit = raycaster.intersectObject(axisStationOverlay.zOriginDot, true)[0];
    if (zOriginHit) {
      const title = AXIS_CONTENT.Z.origin?.title;
      if (title) dialogue.show(title, axisStationOverlay.zOriginDot);
      triggerZWave(); // ← 原点クリックをトリガーに、らせんを発生させる
      return;
    }
  }

  if (axisStationOverlay.zEndDot.visible) {
    const zEndHit = raycaster.intersectObject(axisStationOverlay.zEndDot, true)[0];
    if (zEndHit) {
      const title = AXIS_CONTENT.Z.end?.title;
      if (title) dialogue.show(title, axisStationOverlay.zEndDot);
      return;
    }
  }

  const axisHit = raycaster.intersectObjects(axes.axisHitAreas)[0];
  if (axisHit) {
    const name = axisHit.object.userData.axisName;
    // TODO: 到達後にAXIS_CONTENT[name]を参照して、原点の点や軸ラベルを実際に表示する(次のステップ。X/Yは実装済み)
    const view = getAxisStationView(AXIS_WORLD_DIR[name], AXIS_LENGTH);
    cameraBusy = true;
    hideYOverlay(); // 別の軸(または再度Y軸)へ移動するので、いったん通常表示に戻す
    hideXOverlay(); // 同上(X軸)
    hideZOverlay(); // 同上(Z軸)
    yzPanel.setActive(false); // 移動中はいったん隠す(到達後、Y軸であれば再度表示する)
    // 別の軸(Z以外)へ実際に移動するときだけ、らせんを消す(同じZへの再訪問なら消さない)
    if (name !== 'Z') {
      zWaveRevealTween?.kill();
      zWave.reset();
    }

    flyToAxisStation(camera, controls, view, {
      duration: AXIS_STATION.duration,
      onComplete: () => {
        cameraBusy = false;
        currentAxisView = name;
        yzPanel.setActive(name === 'Y'); // Y軸ステーションに到達したときだけYZパネルを有効化する
        if (name === 'Y') showYOverlay(); // Y軸ステーション到達時だけ、終端の点+「Nine Stories」を表示する
        if (name === 'X') showXOverlay(); // X軸ステーション到達時だけ、終端の点+タイトル+原点付近の点を表示する
        if (name === 'Z') {
          showZOverlay(); // Z軸ステーション到達時だけ、原点/終端の点+「Glass Saga」タイトルを表示する
          // らせんの発生は原点クリック時(triggerZWave)に変更したため、到達時には何もしない
        }
      }
    });
    return;
  }

  // ここまでのどれにもヒットしなかった = 何もない場所をクリックした。
  // Y/Xステーションの追加表示(Teddyの点・タイトル・隠しiボタン等)が出ている場合は、ここで元に戻す。
  // (以前はカメラをちょっと動かしただけで戻ってしまっていたが、操作としてシビアすぎたため、
  //  「空白クリック」を明示的な条件にした)
  if (yOverlayActive) hideYOverlay();
  if (xOverlayActive) hideXOverlay();
  if (zOverlayActive) hideZOverlay();
});

// ── YZパネル/隠しiボタンのホバー処理 ──
// (YZパネル:マウスを乗せると反射ガラスとして浮かび上がる / iボタン:Yステーション限定、ホバーで浮かび上がる)
renderer.domElement.addEventListener('pointermove', (e) => {
  // 宇宙ページ内: マウスが方程式画像に近づくほど色がじわっと変化する遊び。
  // isActiveでない間はuniverse.js側で即returnするので、呼びっぱなしで無害。
  updateEquationHoverByPointer(universe, camera, e.clientX, e.clientY);

  const inputEnabled = !cameraBusy && intro.getState() === 'home';

  if (!inputEnabled) {
    if (yzPanel.isHovered() && !panelTransitioning) yzPanel.setHovered(false); 
    if (axisStationOverlay.isIHovered()) axisStationOverlay.setIHovered(false);
    if (renderer.domElement.style.cursor !== 'default') renderer.domElement.style.cursor = 'default';
    return;
  }

  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const panelHit = yzPanel.isActive() ? raycaster.intersectObject(yzPanel.mesh)[0] : null;
  if (yzPanel.isActive()) yzPanel.setHovered(!!panelHit);

  // 隠しiボタン(Yステーション限定)。iHit.visible(=showY/hideYで切り替え)のときだけ判定する。
  const iHitActive = axisStationOverlay.iHit.visible;
  const iHit = iHitActive ? raycaster.intersectObject(axisStationOverlay.iHit)[0] : null;
  if (iHitActive) axisStationOverlay.setIHovered(!!iHit);
  else if (axisStationOverlay.isIHovered()) axisStationOverlay.setIHovered(false);

  renderer.domElement.style.cursor = (panelHit || iHit) ? 'pointer' : 'default';
});

// ── レンダーループ ─────────────────────────────
let labelsShown = false;
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta(); // ← 宇宙ページの回転(updateUniverse)用。フレームの最初に1回だけ呼ぶこと
  const state = intro.getState();
  // home状態になったら、カメラの向きは controls(自由視点)か
  // 軸ステーションへの遷移アニメーション自身が管理するので、lookTargetへの追従は止める
  if (state !== 'home') camera.lookAt(lookTarget);
  if (state === 'home' && !cameraBusy && !finaleActive) controls.update();
  if (state === 'home' && !labelsShown) { labelsShown = true; axisLabels.show(); }
  dialogue.updatePosition();
  starField.update(clock.getElapsedTime());
  // らせんの位相回転更新でここが万一例外を投げても、レンダーループ全体(=軸クリックの見た目上の反応)が
  // 止まってしまわないようtry/catchで隔離しておく
  try { zWave.update(clock.getElapsedTime()); } catch (err) { console.error('zWave.update failed:', err); }
  try { axes.update(clock.getElapsedTime()); } catch (err) { console.error('axes.update failed:', err); } // 軸ラインの「原点方向へ流れる光」アニメーション
  updateUniverse(universe, delta, camera); // 宇宙ページの三軸回転(固定軸まわりのカルーセル回転。isActiveがfalseの間は内部で即returnするので無害)
  updateSolarSystem(solarSystem, clock.getElapsedTime()); // バナナ惑星+太陽系(group.visible=falseの間は内部で即returnするので無害)
  yzPanel.update(clock.getElapsedTime());
  bananaState.mesh.rotation.y += state === 'idle' ? 0.004 : 0;
  render();
}
animate();