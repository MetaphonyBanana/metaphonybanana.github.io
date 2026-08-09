import * as THREE from 'three';
import { HOME_CAMERA_POS } from './config.js';
// gsapは index.html でグローバル読み込みしているため、ここでは import せずそのまま使う。

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3(0, 0, 0);

// 球面座標(r=原点からの距離, theta=水平角=atan2(x,z), phi=極角=acos(y/r))
function smoothstep(x, a, b) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function toSpherical(v) {
  const r = v.length() || 1;
  return {
    r,
    theta: Math.atan2(v.x, v.z),
    phi: Math.acos(THREE.MathUtils.clamp(v.y / r, -1, 1)),
  };
}
function fromSpherical(r, theta, phi) {
  return new THREE.Vector3(
    r * Math.sin(phi) * Math.sin(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.cos(theta)
  );
}

// ── 軸ステーション: 3軸すべてに対して対称な位置を求める ──────────────────
//
// これまでは sideDir = cross(axisDir, up) で位置を決めていたが、外積の符号が
// 軸によって反転するため、X軸だけホームの反対側(原点を挟んだ逆象限)に飛んでしまい
// 「Xだけ位置がおかしい」問題が起きていた。
//
// 代わりに、ホーム位置(HOME_CAMERA_POS)から軸方向の成分だけを取り除いた
// 「軸に直交する残りの方向」を station の方向として使う。ホーム位置は
// (1,1,1)方向で3軸に対して完全に対称なので、これで導出すれば
// X/Y/Zどの軸でも原点からの距離・見た目の「感じ」が自動的に揃う。
//
// カメラの上方向upは、軸方向dが画面の右方向になるように
//   up = normalize(cross(d, forward))       (forward = camera→注視点の方向)
// から逆算している(この式なら cross(forward, up) = d になる=画面右がd)。
export function getAxisStationView(axisWorldDir, axisLength) {
  const d = axisWorldDir.clone().normalize();
  const R = HOME_CAMERA_POS.length();
  const home = HOME_CAMERA_POS.clone().normalize();

  const stationDir = home.clone()
    .sub(d.clone().multiplyScalar(home.dot(d)))
    .normalize();

  const position = stationDir.clone().multiplyScalar(R); // 原点からの距離Rを保ったまま、軸に直交する側へ
  const mid = d.clone().multiplyScalar(axisLength / 2);     // 軸の中点(最終的な注視点)

  const forward = mid.clone().sub(position).normalize();
  const up = new THREE.Vector3().crossVectors(d, forward).normalize();

  return { position, target: mid, up };
}

// ── ホーム→軸ステーションへ、原点からの距離を保ったまま回転させる ──────────
//
// 1) 序盤〜中盤: 原点からの距離(半径)を保ったまま、原点を向いたまま球面上を回転する
//    (「位置は固定されたまま、軸がぐるっと回る」ように見える)
// 2) 終盤(smoothstepで滑らかに): 位置はそのまま、注視点だけ原点→軸の中点へ、
//    upだけworld+Y→軸専用upへ寄せていく(「軸の中点と直交する視点になる」仕上げ)
//
// どの軸に遷移するときも同じ導出方法・同じ回転の仕方になるので、構図が揃う。
export function flyToAxisStation(camera, controls, view, opts = {}) {
  const { duration = 2.2, onComplete } = opts;
  if (controls) controls.enabled = false;

  const start = toSpherical(camera.position.clone());
  const end = toSpherical(view.position.clone());

  const TWO_PI = Math.PI * 2;
  // 常に「最短経路」で回す(=どの軸へ行くときも90度以内で回る)。
  // ホーム位置(1,1,1)は対称なので、X軸への遷移とY軸への遷移は互いに逆向き
  // (鏡写しの関係)になる。もし常に同じ回転方向(時計回り/反時計回り)を
  // 強制すると、その裏返しの軸だけ大回り(最大で315度)になってしまうため、
  // 「毎回同じ回転方向」ではなく「毎回同じ、短くて自然な回転」を優先している。
  let dTheta = (((end.theta - start.theta) % TWO_PI) + TWO_PI) % TWO_PI; // 0〜2π
  if (dTheta > Math.PI) dTheta -= TWO_PI; // -π〜πの最短方向にする

  const progress = { t: 0 };
  const lookAtPoint = new THREE.Vector3();

  return gsap.to(progress, {
    t: 1,
    duration,
    ease: 'power2.inOut',
    onUpdate: () => {
      const t = progress.t;
      const theta = start.theta + dTheta * t;
      const phi = THREE.MathUtils.lerp(start.phi, end.phi, t);
      const r = THREE.MathUtils.lerp(start.r, end.r, t);
      camera.position.copy(fromSpherical(r, theta, phi));

      const settle = smoothstep(t, 0.55, 1.0); // 後半45%だけ注視点/upを軸専用の値へ寄せる
      lookAtPoint.lerpVectors(ORIGIN, view.target, settle);
      camera.up.copy(WORLD_UP).lerp(view.up, settle).normalize();
      camera.lookAt(lookAtPoint);
    },
    onComplete: () => {
      camera.position.copy(view.position);
      camera.up.copy(view.up);
      camera.lookAt(view.target);
      if (controls) {
        controls.target.copy(view.target);
        controls.enabled = true;
        controls.update();
      }
      if (onComplete) onComplete();
    }
  });
}
