import * as THREE from 'three';

// ── 定数 ───────────────────────────────────────
export const AXIS_LENGTH = 18;
export const AXIS_COLOR  = 0xbfe9ff;          // 三軸すべて同じ色
export const ARCHER_POS  = new THREE.Vector3(0, 24, 380);   // 射手座(星空は半径150〜500の球殻なので、その中で目立つ奥行きに配置)
export const AXIS_X_FAR  = new THREE.Vector3(0, 0, 120);    // Xの刃跡トラベル開始点(遠方から飛んでくる距離)
export const AXIS_X_ANCHOR_Z = AXIS_LENGTH;                 // X軸の実長(他の2軸と揃える)。刃跡はこの点を固定端として原点へ向かって刻まれる

// 概念軸 → world軸の対応(方向ベクトル)。カメラ演出や軸クリック判定で共通利用する。
export const AXIS_WORLD_DIR = {
  X: new THREE.Vector3(0, 0, 1), // 概念X(矢/刃跡)→world +Z
  Y: new THREE.Vector3(1, 0, 0), // 概念Y(長辺)→world +X
  Z: new THREE.Vector3(0, 1, 0), // 概念Z(短辺)→world +Y
};

// ── ホーム(操作可能)状態のデフォルトカメラ ──────
// 3軸(world +X, +Y, +Z)すべてが原点から等しい角度=120度に見える対角(1,1,1)方向に配置。
// target を原点ぴったりにするのが対称性を保つポイント(ずらすと3軸の見た目の間隔が均等でなくなる)。
export const HOME_CAMERA_DISTANCE = 34;
export const HOME_CAMERA_TARGET = new THREE.Vector3(0, 0, 0);
export const HOME_CAMERA_POS = new THREE.Vector3(1, 1, 1)
  .normalize()
  .multiplyScalar(HOME_CAMERA_DISTANCE);

// ── 軸クリック時の「カメラステーション」演出パラメータ ──
// (位置そのものはaxisCamera.jsがHOME_CAMERA_POSから対称に導出するため、
//  ここでは遷移にかける時間だけを持つ)
export const AXIS_STATION = {
  duration: 2.2,  // 遷移(回転+仕上げ)にかける秒数
};

// 概念軸 → world軸: 概念X(矢/刃跡)→world Z, 概念Y(長辺)→world X, 概念Z(短辺)→world Y

// ── チューニング用パラメータ(ここをいじって調整) ──
export const TUNE = {
  // 星
  starSize: 0.2,          // (現在の星空はシェーダー独自のサイズ計算のため未使用。旧実装の名残)
  starBrightMin: 0.3,     // 同上
  starBrightMax: 2.2,     // 同上
  // bloom(発光ポストプロセス)
  bloomStrength: 1.3,     // 全体の発光の強さ
  bloomRadius: 0.35,      // にじみの広がり
  bloomThreshold: 0.35,   // これより暗いものは光らない(下げるほど星も光り始める)
  // Xの刃跡(travelMarker)
  travelDuration: 3.0,    // 到達までの秒数。短いほど速い
  travelEase: 'power2.in',// 'power2.in'=加速して到達 / 'power2.out'=急減速して止まる(スケートの制動感) / 'back.out(1.4)'=行き過ぎて戻る
  // 破砕(Blenderの破片が多い場合の間引き上限)
  maxActiveShards: 200,   // 実際に描画・爆散させる破片の最大数。多いほど重くなる(現行データは187個)
};
