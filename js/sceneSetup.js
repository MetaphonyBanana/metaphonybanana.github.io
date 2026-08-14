import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TUNE, HOME_CAMERA_POS } from './config.js';

// ── 最終合成シェーダー: 通常レンダリング結果(baseTexture)に
//    Bloom専用パスの結果(bloomTexture)を加算するだけのシンプルなシェーダー ──
const mixShader = {
  uniforms: {
    baseTexture: { value: null },
    bloomTexture: { value: null },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D baseTexture;
    uniform sampler2D bloomTexture;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
    }
  `,
};

// ── 基本セットアップ ───────────────────────────
export function createSceneSetup() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
  camera.position.copy(HOME_CAMERA_POS); // 演出開始時からホームポジションに据え置く(以前はStep6で別途移動していた)
  scene.add(camera); // ← 追加: camera.add(sprite)した子を描画するのに必要
  const lookTarget = new THREE.Vector3(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enabled = false; // 演出中は無効

  // ── Bloom(発光・にじみ)を掛けたくないオブジェクトの管理 ────────────
  // 数式シンボル(i, hbar, hamiltonian, derivative等)のように「くっきり見せたい」
  // ものはexcludeFromBloom(object)で登録する。Bloom専用パスをレンダリングする
  // 直前だけ一時的にvisible=falseにして除外し、直後に元へ戻す
  // (three.js公式のSelective Bloom例と同じ考え方。星やガラスなど他の発光は
  //  そのまま残る)。
  // 数式シンボル(i, hbar, hamiltonian, derivative等)のように「Bloomを弱めに
  // したい」ものはexcludeFromBloom(object, intensity)で登録する。intensityは
  // 0(完全に発光なし)〜1(通常通りフルに発光)の倍率。Bloom専用パスを
  // レンダリングする直前だけ一時的にopacityをintensity倍に下げて弱め、
  // 直後に元のopacityへ戻す(three.js公式のSelective Bloom例の応用。
  // 星やガラスなど登録していないものはそのままフルに発光する)。
  const noBloomObjects = new Map(); // object → intensity(0〜1)
  function excludeFromBloom(object, intensity = 0) {
    noBloomObjects.set(object, intensity);
  }
  function dimNoBloomObjects() {
    noBloomObjects.forEach((intensity, obj) => {
      obj.userData.__prevOpacity = obj.material.opacity;
      obj.material.opacity = obj.material.opacity * intensity;
    });
  }
  function restoreNoBloomObjects() {
    noBloomObjects.forEach((intensity, obj) => {
      obj.material.opacity = obj.userData.__prevOpacity;
    });
  }

  // ── ① Bloom専用コンポーザー: 除外オブジェクトを隠した状態のシーンをレンダリングし、
  //    UnrealBloomPassをかける。renderToScreen=falseなので画面には出さず、
  //    結果は bloomComposer.renderTarget2 に溜まる(②の合成で使う)。
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    TUNE.bloomStrength, TUNE.bloomRadius, TUNE.bloomThreshold
  );
  bloomComposer.addPass(bloomPass);

  // ── ② 最終コンポーザー: 通常のシーン(除外オブジェクトも含め全部見える状態)を
  //    レンダリングし、そこに①のbloomTextureを加算合成する。
  //    数式シンボルは①に映っていないので、ここでは自分自身の見た目のまま
  //    (にじみなし)で重なる。
  const mixPass = new ShaderPass(new THREE.ShaderMaterial({
    uniforms: {
      baseTexture: { value: null },
      bloomTexture: { value: bloomComposer.renderTarget2.texture },
    },
    vertexShader: mixShader.vertexShader,
    fragmentShader: mixShader.fragmentShader,
  }), 'baseTexture');
  mixPass.needsSwap = true;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(mixPass);
  composer.addPass(new OutputPass());

  // main.js の animate() 内、これまでの composer.render() の代わりに呼ぶ関数。
  // ①除外オブジェクトを隠す→②Bloom専用パスを描く→③元に戻す→④通常合成、の順。
  function render() {
    dimNoBloomObjects();
    bloomComposer.render();
    restoreNoBloomObjects();
    composer.render();
  }

  // トーンマッピング: 星やガラスの明るさが1.0を超えても自然に発光して見えるようにする
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ガラスの透過(Transmission)表現に必要な簡易環境マップ
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  scene.add(new THREE.AmbientLight(0x8899ff, 0.6));
  const keyLight = new THREE.PointLight(0xffffff, 40, 100);
  keyLight.position.set(5, 8, 10);
  scene.add(keyLight);

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    bloomComposer.setSize(innerWidth, innerHeight); // ← Bloom専用コンポーザーも一緒にリサイズする
  });

  return { scene, camera, renderer, controls, composer, lookTarget, excludeFromBloom, render };
}