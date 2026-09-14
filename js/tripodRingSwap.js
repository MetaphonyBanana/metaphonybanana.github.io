import * as THREE from 'three';
import { MIRROR_APEX_HEIGHT, BANANA_HEIGHT_ABOVE_APEX } from './record.js';
import { PHASE_SWAP_END } from './config.js';
import { TRIPOD_GROUND_Y, setIhFade } from './universe.js';

// ══════════════════════════════════════════════════════════════
// ── 切り替え時の座標入れ替え: tripod ⇄ 鏡tripod / リング ⇄ バナナの高さ ─────
// ══════════════════════════════════════════════════════════════
//
// ★ 2026-09-11 設計変更(ご指示反映): 「カメラは一切動かさない(銀河などの背景を
//   完全に固定表示しておきたいため)」という方針に合わせて、この演出のロジックを
//   丸ごと書き換えた。
//
//   これまでは、スクロールに合わせてtripod自体をgroundYまで降下させ、それと
//   歩調を合わせるためにカメラも振り向ける(controls.targetを動かす)必要があった。
//   しかし疑似正射影(狭FOV)のカメラだと、カメラを動かした瞬間に手前のtripod/リング
//   だけでなく、画面奥の銀河(天の川)まで一緒にズレて見えてしまう。銀河はこの演出の
//   「外側」にあるべき背景なので、これは避けたい。
//
//   そこで方針を反転させた: カメラ側では一切吸収せず、tripod・リング・鏡tripodの
//   3者だけで完結させる。
//     - tripod(universe.tripodAnchor)は、この演出の間ずっとREST_Y(後述)に固定。
//       もう降下アニメーションはしない=常時「鏡tripodと同じ場所」に居続ける。
//     - 鏡tripod(record.mirrorVisualAnchor。バナナはその子)も同じREST_Yに固定
//       (以前からの設計のまま、変更なし)。
//     - 動くのはリング(universe.goldenRing)だけ。REST_Y(下=carousel側)⇔
//       バナナの高さ(上=鏡側)の間を、record.viewMixCurrentのスクロール量に応じて
//       上下させる。
//   tripodと鏡tripodは常に同じ場所(REST_Y)に重なっているので、この2つのvisibleを
//   入れ替えるだけで交代演出が成立する(下記updateTripodRingSwap参照)。
//
// ★ 2026-09-12 追加(ご指示反映その1): 一時期、tripod⇔鏡tripodの切り替えをopacityの
//   クロスフェードにしていたが、「フェード仕様を撤廃してほしい」とのご指示により撤去した。
//   以前(クロスフェード導入前)と同じ、swapT>=1を境にしたvisibleの瞬時トグルに戻して
//   ある(下記updateTripodRingSwap参照)。
//
// ★ 2026-09-12 追加(ご指示反映その2): 「クロスフェード中、2つの同じ立体(tripodと
//   鏡tripod)が必ず同じ角度になっているようにしてほしい」への対応。以前は
//   record.js側でmirrorVisualAnchorを「独自に」自転させていたが、起動タイミングの差
//   (tripodはuniverse.isActiveになった瞬間から回転、鏡tripodはそこから約1秒遅れる
//   startRecordDisplay以降にしか回転しない)によって固定の角度ズレが生じていた
//   (詳細はrecord.js側の該当コメント参照)。ここで毎フレーム
//   record.mirrorVisualAnchor.quaternion.copy(universe.axesGroup.quaternion) して
//   しまうことで、鏡tripodの向きを「本物のtripodの現在の向きの複製」にし、速度や
//   タイミングに関係なく常に完全一致させる。
//
// ── REST_Y(tripod・鏡tripodの高さ)/ RING_DOWN_Y(リングの下限)について ──────
//   ★ 2026-09-11 再修正(ご指示反映): 「carousel時の高さを5下げる」対応はいったん撤回。
//   tripod・鏡tripod自体はuniverse.js側のTRIPOD_GROUND_Y(=0。tripod終端3点が乗る
//   「地面」)にそのまま固定する(以前あったREST_Y_DROPは削除)。構図の余裕はここではなく、
//   カメラを離す・角度を水平寄りにする方向(config.jsのUNIVERSE_CAMERA_POS/TARGET)で
//   調整する方針に変更した。
//   ★ 2026-09-11 追加(ご指示反映): 「リングの下限だけ、もう10下げたい」とのことなので、
//   リングの下側(carousel側)の着地点だけを別定数RING_DOWN_Yに切り出し、TRIPOD_GROUND_Yから
//   さらに10下げた。tripod・鏡tripod(REST_Y)はTRIPOD_GROUND_Yのまま変えていないので、
//   リングだけが他の2つより低い位置から上昇してくる見え方になる。
//   ★ tripodHitMesh・roofParticlesなど、この演出と無関係な他の要素は今まで通り
//   TRIPOD_GROUND_Y(=0)基準のままなので、ここを変えても影響しない
//   (universe.js側は一切変更していない)。
const REST_Y = TRIPOD_GROUND_Y;
const RING_DOWN_DROP = 10; // 仮値。リングの下限(carousel側)だけをREST_Yからどれだけ下げるか
const RING_DOWN_Y = REST_Y - RING_DOWN_DROP;

// ★ 2026-09-12 再修正(ご指示反映):「単純にリングが下限にあるときだけihが存在する
//   ようにしてほしい。中間位置のリングでもihが見えているのが気になる(屋根の粒子と
//   視覚的にぶつかる)」への対応。以前はrevealIh/hideIhを時間(秒)で駆動する独立の
//   フェードにしていたが、そのフェード秒数の間にリング自体は中間位置まで進んでしまい、
//   結果的に中間位置でもihがまだ薄っすら見えてしまっていた。
//   そこで「時間」ではなく「リングが今どれだけ下限に近いか(swapT)」だけを毎フレーム
//   直接不透明度に反映する方式に変更した。IH_EDGE_FADE_RANGEというごく狭い範囲だけで
//   フェードし、それ以外(中間位置を含む全域)ではopacity=0・非表示になる。
const IH_EDGE_FADE_RANGE = 0.05; // 仮値。下限(swapT=0)からこの範囲内だけihをフェード表示する

// 0〜1の範囲でt(record.viewMixCurrent)を[a,b]の区間に対して正規化する(a未満は0、b超は1)。
function remap01(t, a, b) {
  return THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
}

// scene/universe/record: それぞれcreateScene的な処理・createUniverse・createRecordDisplayで
// 既に作成済みのインスタンスをそのまま渡す(このファイルでは新規作成しない)。
export function createTripodRingSwap(scene, universe, record) {
  // 表示権はこのモジュールが一元管理する。初期状態は必ず「tripod側」から始める
  // (record.js側で誤ってvisible=trueにされていても、ここで確実に隠しておく)。
  record.mirrorVisualAnchor.visible = false;
  universe.tripodAnchor.visible = true;

  // バナナの高さ(REST_Y + 頂点 + バナナの上乗せ分)。record.js側の設計上、
  // mirrorVisualAnchorは常にREST_Yに固定されるため、これはスクロール量に関係なく
  // 最初から最後まで一定の値になる(=毎フレーム計算し直す必要はない)。
  const bananaY = REST_Y + MIRROR_APEX_HEIGHT + BANANA_HEIGHT_ABOVE_APEX;

  return {
    universe,
    record,
    restY: REST_Y,
    ringDownY: RING_DOWN_Y,
    bananaY,
    swapped: false, // swapT>=1(鏡tripod側へ完全に切り替わった)かどうか。今のところ他ファイルからは未参照
  };
}

// 毎フレーム呼ぶ(main.jsのレンダーループから、updateRecordDisplay(...)の後で)。
// record.phase==='inactive'の間はrecord.viewMixCurrentが常に0のままなので、呼んでも
// 見た目は変化しない(リングがringDownYのまま、tripod/鏡tripodも常にrestYで静止している)。
export function updateTripodRingSwap(swap) {
  const { universe, record, restY, ringDownY, bananaY } = swap;
  const t = record.viewMixCurrent; // 0=carousel側 / 1=鏡側。record.js側のスクロール補間をそのまま流用する
  const swapT = remap01(t, 0, PHASE_SWAP_END);

  // ── ih.pngの出現/消滅(ご指示反映): 「リングが下限にあるときだけ存在する」という
  //   シンプルな条件に変更。swapTが下限(0)からIH_EDGE_FADE_RANGE以内のごく狭い区間だけ
  //   フェード表示し、それ以外(中間位置・鏡側含む全域)では常にopacity=0・非表示にする。
  //   tripodがまだクリックされていない(tripodRingRevealed=false、リング自体が未形成)間は
  //   常に非表示。
  const ihFade = universe.tripodRingRevealed
    ? 1 - remap01(swapT, 0, IH_EDGE_FADE_RANGE)
    : 0;
  setIhFade(universe, ihFade);

  // ── tripod: この演出中ずっとREST_Yに固定する(もう降下アニメーションはしない)。
  //   liftTripod(tripodの浮上。axesGroup.position.yを直接動かす、別機能)がまだtween中の
  //   可能性があるので、その分を毎フレーム打ち消してREST_Yへ引き戻す(=常に「liftされて
  //   いないのと同じ高さ」に固定され続ける)。
  const descendedAnchorY = restY - universe.axesGroup.position.y;
  universe.tripodAnchor.position.set(0, descendedAnchorY, 0);

  // 鏡tripod(+バナナ。その子なので一緒に動く)も、tripodと同じREST_Yに常に固定しておく。
  // x・zは常に0(鏡tripod側はもともとx,z=0に矯正済みなので、ここでも0に保つ)。
  record.mirrorVisualAnchor.position.set(0, restY, 0);

  // ── 角度の同期(ご指示反映): 本物のtripod(universe.axesGroup)の「現在の向き」を
  //   そのまま鏡tripodへ複製する。速度・タイミングに依存する積算方式をやめたことで、
  //   切り替え(visibleの瞬時トグル)の前後を含め常に両者が完全に同じ角度になる。
  record.mirrorVisualAnchor.quaternion.copy(universe.axesGroup.quaternion);

  // ── リング: このモジュールの中で唯一動く要素。RING_DOWN_Y(carousel側=下)→バナナの
  //   高さ(bananaY=鏡側=上)の間を、record.viewMixCurrentのスクロール量(swapT)に応じて
  //   上下させる。カメラは一切動かさないので、この上下移動がそのまま画面上の見た目の
  //   変化になる(=tripod・鏡tripodは静止したまま、リングだけが動いて見える)。
  universe.goldenRing.position.set(0, THREE.MathUtils.lerp(ringDownY, bananaY, swapT), 0);

  // ── tripod⇔鏡tripodの切り替え(ご指示反映: フェード仕様を撤廃し、以前の瞬時トグルに
  //   戻した)。swapT>=1(=鏡側へスクロールし切った)を境に、見た目をそのまま入れ替える。
  const swapped = swapT >= 1;
  universe.tripodAnchor.visible = !swapped;
  record.mirrorVisualAnchor.visible = swapped;
  swap.swapped = swapped;
}

// TODO:
//   - PHASE_SWAP_END・IH_EDGE_FADE_RANGEはどちらも仮値です。見た目を見ながら調整してください。
//   - RING_DOWN_DROP(=10)も仮値です。リングのcarousel側の下限をREST_Yからどれだけ
//     下げるか、見た目を見ながら調整してください。
//   - tripodHitMesh(tripodクリック判定用、universe.js側でsceneに直接addされておりtripodAnchorの
//     子ではない)は今回動かしていません。鏡側表示中にtripodHitMeshへのクリック判定が
//     残ってしまう可能性があるので、必要であれば main.js側でswap.swappedを見て
//     判定自体をスキップするなどの対応を検討してください。
//   - カメラは今回の変更でこのファイル・record.js双方から完全に触らなくなりました
//     (UNIVERSE_CAMERA_POS/TARGETに入ったまま、ユーザーの手動ドラッグ以外では動きません)。
//     「tripod/リングの位置を交代させたのに構図が窮屈」等が起きた場合は、REST_Yをここで
//     いじるのではなく、config.js側のUNIVERSE_CAMERA_POS/TARGET(カメラの距離・角度)を
//     調整する方向で対応してください。