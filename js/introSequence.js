// ── オープニング演出タイムライン + 状態管理 ─────
// state: 'idle'(クリック待ち) → 'playing'(演出中) → 'home'(トップページ状態)
// gsapは index.html でグローバル読み込みしているため、ここでは import せずそのまま使う。
export function createIntroSequence(deps) {
  const {
    camera, controls, lookTarget, archer, arrowGroup,
    bananaState, triggerShatter, axes,
    TUNE, ARCHER_POS, AXIS_X_FAR,
    HOME_CAMERA_POS, HOME_CAMERA_TARGET,
  } = deps;

  let state = 'idle';

  function setHomeState() {
    state = 'home';
    controls.enabled = true;
    controls.target.copy(HOME_CAMERA_TARGET);
    document.getElementById('axisHint').classList.add('show');
  }

  function startSequence() {
    if (state !== 'idle') return;
    state = 'playing';
    document.getElementById('hint').classList.add('hidden');

    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });

    // 1) カメラが振り返る
    tl.set(archer, { visible: true });
    tl.to(lookTarget, { x: ARCHER_POS.x, y: ARCHER_POS.y, z: ARCHER_POS.z, duration: 1.4 });
    tl.to({}, { duration: 0.3 }); // 溜め

    // 2) 矢が放たれ、カメラも視線を戻す
    tl.set(arrowGroup, { visible: true });
    tl.set(arrowGroup.position, { x: ARCHER_POS.x, y: ARCHER_POS.y, z: ARCHER_POS.z });
    tl.to(arrowGroup.position, {
      x: 0, y: 0, z: 0, duration: 2.0, ease: 'power1.in',
      onComplete: () => { arrowGroup.visible = false; bananaState.mesh.visible = false; triggerShatter(); }
    }, 'fly');
    tl.to(lookTarget, { x: 0, y: 0, z: 0, duration: 2.0, ease: 'power1.inOut' }, 'fly');

    // 3) 破砕を見せる間(スカラー)
    tl.to({}, { duration: 0.9 });

    // 4) Y軸が伸びる
    tl.to(axes.yAxis.scale, { y: 1, duration: 1.1, ease: 'power2.out' });

    // 5) Xが刃跡風に到達 ― 刃(travelMarker)が遠方から原点へ走り、
    //    通り抜けた軌跡がそのままX軸として刻まれていく(原点からではなく逆向きに伸びる)
    tl.set(axes.travelMarker, { visible: true });
    tl.set(axes.travelMarker.position, { x: AXIS_X_FAR.x, y: AXIS_X_FAR.y, z: AXIS_X_FAR.z });
    tl.call(() => axes.updateXAxisTrail(AXIS_X_FAR.z));
    tl.to(axes.travelMarker.position, {
      z: 0, duration: TUNE.travelDuration, ease: TUNE.travelEase,
      onUpdate: () => axes.updateXAxisTrail(axes.travelMarker.position.z),
      onComplete: () => {
        axes.travelMarker.visible = false;
        axes.updateXAxisTrail(0);
      }
    });

    // 6) Z軸が伸びる。同時に、カメラを「3軸が120度に見える」対称なデフォルト位置へ寄せていく
    tl.to(axes.zAxis.scale, { y: 1, duration: 3.1, ease: 'power2.out' });
    tl.to(camera.position, {
      x: HOME_CAMERA_POS.x, y: HOME_CAMERA_POS.y, z: HOME_CAMERA_POS.z,
      duration: 3.1, ease: 'power2.out'
    }, '<');

    // 7) トップページ状態へ
    tl.call(setHomeState);
  }

  return {
    startSequence,
    getState: () => state,
  };
}
