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
import { createHotspots } from './hotspots.js';
import { createDialogue } from './dialogue.js';
import { createIntroSequence } from './introSequence.js';
import { getAxisStationView, flyToAxisStation } from './config.js';
import { createAxisStationOverlay } from './axisStationOverlay.js';
import { createAxisConstellationOverlay } from './axisConstellationOverlay.js';
import { AXIS_CONTENT } from './data/axisContent.js';
import { createFinale, runFinale, handleIconClick } from './finale.js';
import { createEquationAssembly, startPhase1 } from './equationAssembly.js';

// YZパネルクリック時、メインカメラをビリヤード専用ページと同じ構図にする。
const BILLIARD_CAMERA_POS = new THREE.Vector3(AXIS_LENGTH / 2, -AXIS_LENGTH / 2, AXIS_LENGTH / 2);
const BILLIARD_CAMERA_TARGET = new THREE.Vector3(AXIS_LENGTH / 2, AXIS_LENGTH / 2, 0); // パネル中央(=9,9,0)
const BILLIARD_TRANSITION_DURATION = 1.3; // yzPanel.js のRIPPLE_SPEEDと揃えている(パネル対角線を走り抜ける時間)

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
  zOverlayActive = false;
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
    if (finaleIconHit) {
      handleIconClick({
        finale,
        onNextPhase: () => {
          startPhase1({
            assembly: equationAssembly,
            existingISprite: finale.iSprite,
            camera,
            starField, // ← 星→ψ→=の収束(schrodinger-sequence-timeline.md ⑸〜⑺)に使う
            onHbarArrived: () => { console.log('ħがiに到着'); },
            onEquationComplete: () => { console.log('①(iħ∂ψ/∂t=Ĥψ)完成'); },
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
      const title = AXIS_CONTENT.Y.origin?.title;
      if (title) dialogue.show(title, axisStationOverlay.yOriginDot);
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

    if (name !== 'Z') zWave.reset(); // Z以外へ移動するときはらせんを消しておく

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
          // カメラが完全に静止してから、原点(画面左)→先端(画面右)へ
          // ガウス波束のらせんを伸ばす(その後は毎フレームupdate()でゆっくり回り続ける)
          const waveProgress = { t: 0 };
          gsap.to(waveProgress, {
            t: 1,
            duration: 2.2,
            ease: 'power2.out',
            onUpdate: () => zWave.reveal(waveProgress.t),
          });
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
  yzPanel.update(clock.getElapsedTime());
  bananaState.mesh.rotation.y += state === 'idle' ? 0.004 : 0;
  render();
}
animate();