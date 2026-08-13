import * as THREE from 'three';
// gsapは index.html でグローバル読み込みしているため、ここでは import せずそのまま使う。

// ── 定数 ───────────────────────────────────────
export const AXIS_LENGTH = 18;
export const AXIS_COLOR  = 0xbfe9ff;
export const ARCHER_POS  = new THREE.Vector3(0, 24, 380);
export const AXIS_X_FAR  = new THREE.Vector3(0, 0, 120);
export const AXIS_X_ANCHOR_Z = AXIS_LENGTH;

export const AXIS_WORLD_DIR = {
  X: new THREE.Vector3(0, 0, 1),
  Y: new THREE.Vector3(1, 0, 0),
  Z: new THREE.Vector3(0, 1, 0),
};

export const HOME_CAMERA_DISTANCE = 34;
export const HOME_CAMERA_TARGET = new THREE.Vector3(0, 0, 0);
export const HOME_CAMERA_POS = new THREE.Vector3(1, 1, 1)
  .normalize()
  .multiplyScalar(HOME_CAMERA_DISTANCE);

export const AXIS_STATION = {
  duration: 2.2,
};

export const TUNE = {
  starSize: 0.2,
  starBrightMin: 0.3,
  starBrightMax: 2.2,
  bloomStrength: 1.3,
  bloomRadius: 0.35,
  bloomThreshold: 0.35,
  travelDuration: 3.0,
  travelEase: 'power2.in',
  maxActiveShards: 200,
};

// ── 球面座標 ─────────────────────────────────
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

// ── 軸ステーション: 3軸それぞれの位置を求める ──────────────────
const STATION_HEIGHT = 16;
const STATION_SIDE   = 20;
const STATION_DEPTH  = 24;

export function getAxisStationView(axisWorldDir, axisLength) {
  const d = axisWorldDir.clone().normalize();
  const target = d.clone().multiplyScalar(axisLength / 2);
  const position = target.clone();

  if (Math.abs(d.x) > 0.5) {
    // d = world X (概念Y軸)
    position.y += STATION_HEIGHT;
    position.z += STATION_DEPTH;
  } else if (Math.abs(d.z) > 0.5) {
    // d = world Z (概念X軸)
    position.x += STATION_SIDE;
    position.y += STATION_HEIGHT;
  } else {
    // d = world Y (概念Z軸)
    position.x += STATION_SIDE;
    position.z += STATION_DEPTH;
  }

  // upは固定値ではなく、軸方向dとカメラ→注視点の向きから毎回算出する。
  // cross(d, forward)はdと直交するので、upがdと重なって退化することがない
  // → どの軸でも「軸自身は画面の横(right)」「upは軸と垂直」が保証される。
  const forward = target.clone().sub(position).normalize();
  const up = new THREE.Vector3().crossVectors(d, forward).normalize();

  return { position, target, up };
}

// ── ホーム→軸ステーションへの遷移 ──────────────────
export function flyToAxisStation(camera, controls, view, opts = {}) {
  const { duration = 2.2, onComplete } = opts;
  if (controls) controls.enabled = false;

  const start = toSpherical(camera.position.clone());
  const end = toSpherical(view.position.clone());

  const TWO_PI = Math.PI * 2;
  let dTheta = (((end.theta - start.theta) % TWO_PI) + TWO_PI) % TWO_PI;
  if (dTheta > Math.PI) dTheta -= TWO_PI;

  const startQuat = camera.quaternion.clone();
  const endQuat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(view.position, view.target, view.up)
  );

  const progress = { t: 0 };

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
      camera.quaternion.slerpQuaternions(startQuat, endQuat, t);
    },
    onComplete: () => {
      camera.position.copy(view.position);
      camera.quaternion.copy(endQuat);
      camera.up.copy(view.up);
      if (controls) {
        controls.target.copy(view.target);
        controls.enabled = true;
        controls.update();
      }
      if (onComplete) onComplete();
    }
  });
}