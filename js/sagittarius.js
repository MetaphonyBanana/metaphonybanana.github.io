import * as THREE from 'three';

// ── 射手座(「ティーポット」型のアステリズムを星+線で表現) ──
// 中心(ARCHER_POS)からのオフセットで各星を配置。500スケールの奥行きでも
// くっきり読み取れるよう、頂点間の間隔を大きめ(数十単位)に取っている。
const SAGITTARIUS_SHAPE = [
  [  0,  20,   0 ], // 0 蓋
  [-12,  0,   4 ], // 1 左のふち
  [-28,  -1,   0 ], // 2 左肩
  [-11, -24,  -3 ], // 3 左下(底)
  [ 30, -13,   3 ], // 4 右下(底)
  [ 40,  -5,   0 ], // 5 右肩(注ぎ口の付け根)
  [ 28,   8,  -4 ], // 6 注ぎ口の先
  [18,   7,   5 ], // 7
  [-19,   52,   5 ],  //8
  [-51,   15,   5 ], //9
  [-19,   -37,   5 ], //10
];
const SAGITTARIUS_EDGES = [
  [0,1], [1,2], [2,3], [3,4], [4,5], [5,6], [6,7], [7,0], [4,7], // 本体の輪郭+注ぎ口
  [1,7], [1,3],                                     // 持ち手
];

export function createSagittarius(scene, center) {
  const group = new THREE.Group();
  group.position.copy(center);

  const starMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff });
  const starGeo = new THREE.SphereGeometry(1.1, 1, 1);
  const stars = SAGITTARIUS_SHAPE.map(([x, y, z]) => {
    const s = new THREE.Mesh(starGeo, starMat);
    s.position.set(x, y, z);
    group.add(s);
    return s;
  });

  const linePts = [];
  SAGITTARIUS_EDGES.forEach(([a, b]) => linePts.push(stars[a].position, stars[b].position));
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(linePts),
    new THREE.LineBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.4 })
  );
  group.add(lines);

  scene.add(group);
  return group;
}
