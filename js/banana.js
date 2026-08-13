import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TUNE } from './config.js';

function makePlaceholderBanana() {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(1.1, 0.28, 20, 40, Math.PI * 1.15),
    new THREE.MeshPhysicalMaterial({
      color: 0xeaffef, transmission: 0.9, roughness: 0.05,
      thickness: 0.6, ior: 1.4, transparent: true,
    })
  );
  m.rotation.z = Math.PI * 0.35;
  return m;
}

function makePlaceholderShards(count = 14) {
  const geo = new THREE.TetrahedronGeometry(0.22);
  const arr = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xd8fff0, transparent: true, opacity: 0 });
    const s = new THREE.Mesh(geo, mat);
    s.visible = false;
    arr.push(s);
  }
  return arr;
}

// banana.glb を試みに読み込む。存在しない/失敗した場合はプレースホルダーのまま。
// Blender側の命名規則: 全体メッシュ = "Banana_Whole", 破片群 = "Shard", "Shard.001", "Shard.002"...(Blenderの重複命名はドット区切り)
const SHARD_NAME_RE = /^Shard\d*$/;

function upgradeToGlass(material) {
  // すでにKHR_materials_transmissionが読み込まれていれば(GLTFLoaderがMeshPhysicalMaterial.transmissionに変換済み)、そのまま使う
  if (material && material.isMeshPhysicalMaterial && material.transmission > 0) {
    return material;
  }
  // transmissionが無い場合のみ、three.js側でガラス風に上書きするフォールバック
  console.log('transmissionが検出できなかったため、フォールバックのガラスマテリアルを適用します:', material?.name);
  return new THREE.MeshPhysicalMaterial({
    color: material?.color ? material.color.clone() : new THREE.Color(0xeaffef),
    transmission: 0.9,
    roughness: 0.06,
    thickness: 0.6,
    ior: 1.45,
    clearcoat: 0.3,
    transparent: true,
  });
}

// ── ガラスのバナナ(Blender製 banana.glb を優先、無ければプレースホルダー) ──
// 戻り値の `state.mesh` / `state.shards` はglb読み込み完了時に差し替わるため、
// 呼び出し側は必ず state 経由(state.mesh.xxx)で参照すること。
export function createBanana(scene) {
  const state = {
    mesh: makePlaceholderBanana(),
    shards: makePlaceholderShards(),
  };
  scene.add(state.mesh);
  state.shards.forEach(s => scene.add(s));

  new GLTFLoader().load(
    './banana.glb',
    (gltf) => {
      const whole = gltf.scene.getObjectByName('Banana_Whole');
      let loadedShards = [];
      gltf.scene.traverse(obj => {
        if (obj.isMesh && SHARD_NAME_RE.test(obj.name)) loadedShards.push(obj);
      });

      if (whole) {
        scene.remove(state.mesh);
        whole.material = upgradeToGlass(whole.material);
        state.mesh = whole;
        scene.add(state.mesh);
        console.log('Banana_Whole material:', state.mesh.material.type, 'transmission=', state.mesh.material.transmission);
      }

      if (loadedShards.length) {
        // 破片数が多すぎる場合は間引く(描画コストを抑える)。爆散の見た目はランダム抽出でも十分成立する
        if (loadedShards.length > TUNE.maxActiveShards) {
          loadedShards = loadedShards
            .sort(() => Math.random() - 0.5)
            .slice(0, TUNE.maxActiveShards);
        }
        state.shards.forEach(s => scene.remove(s));
        state.shards = loadedShards;
        state.shards.forEach(s => {
          s.material = upgradeToGlass(s.material);
          s.userData.homePosition = s.position.clone();
          s.visible = false;
          if (!scene.children.includes(s)) scene.add(s);
        });
      }
      console.log(`banana.glb 読み込み成功: whole=${!!whole}, 使用する破片数=${state.shards.length}(元は${loadedShards.length}個検出)`);
    },
    undefined,
    () => console.log('banana.glb が見つからないためプレースホルダーを使用します')
  );

  function triggerShatter() {
    state.shards.forEach(s => {
      const home = s.userData.homePosition || new THREE.Vector3(0, 0, 0);
      s.position.copy(home);
      s.rotation.set(0, 0, 0);
      s.scale.setScalar(1);
      if (s.material) s.material.opacity = 1;
      s.visible = true;
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const dist = 1.5 + Math.random() * 2.5;
      gsap.to(s.position, {
        x: home.x + dir.x * dist, y: home.y + dir.y * dist, z: home.z + dir.z * dist,
        duration: 0.9, ease: 'power2.out'
      });
      gsap.to(s.rotation, { x: Math.random() * 6, y: Math.random() * 6, duration: 0.9 });
      // opacityではなくscaleで消す(透過破片が重なるとソート崩れが出やすいため)
      gsap.to(s.scale, { x: 0, y: 0, z: 0, duration: 0.6, delay: 0.35, onComplete: () => { s.visible = false; } });
    });
  }

  return { state, triggerShatter };
}
