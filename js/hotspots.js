import * as THREE from 'three';

// ── 星に紐づくセリフ(位置と台詞のペア) ───────────
const HOTSPOTS = [
   //X
  { pos: [-20, -80, 100],  text: ['It\'s "If a body meet a body coming through the rye"!\n─Phoebe Caulfield','Aren\'t you gonna ride too?'] },
  { pos: [-80, -130, 100],  text: ['This is a people shooting hat.\n─Holden Caulfield',
                                  'Mine came from Mark Cross.\n─Holden Caulfield']
   },
  { pos: [-250, -130, 150],  text: ['Go home and get your bike and meet me in front of Bobby\'s house. Hurry up.',
                                    'Allie had this left-handed fielder’s mitt.\nHe was left-handed.','He never got sore about anything'
  ] },
  //Y
  { pos: [250, -150, -90],  text: ['gift horse\n─Teddy',
                                   'triumvirate\n─Teddy'
  ] },
  { pos: [20, -150, -80],  text: ['Did the tigers run all around that tree?\n─Sybil Carpenter',
                                 'Here comes a wave.\n─Sybil Carpenter']
   },
  { pos: [-10, -100, -70],  text: ['What did one wall say to the other wall?\n—For Esmé','He was rather like a christmas tree whose lights, wired in series, must all go out if even one bulb is defective.\n—For Esmé',
'The door banged open without having been wrapped on. X raised his head, turned it, and corporal Z standing in the door.\n—For Esmé'] },
  //Z
  { pos: [-100, 250, -140], text: ['All we do our whole lives is go from one little piece of Holy Ground to the next.\n─Seymour Glass'] },
  { pos: [-70, 40, -140], text: ['I was Mercury himself.\n─Buddy Glass',
                                 'This which, I suggest, though possibly not to everyone’s taste, is highly literate vaudeville\n─Buddy Glass'
  ] },
  { pos: [-200,160, -100],   text: ['Keep me up till five only because all your stars are out, and for other reason.\n─Seymour Glass',
                              'This lad instantaneously translated every word to perfection except “vague,” which quite means an ocean wave, as well as being captivated by the beauty\!\n─Seymour Glass'
   ]
  },

];

// ← 見た目のサイズはそのまま(0.35)。星は原点から100〜380くらい離れた位置に置かれていて、
//   画面上でこの小ささをピクセル単位でクリックするのはほぼ不可能に近いため、
//   axisStationOverlay.jsのmakeDotと同じパターンで「判定専用の大きな透明球」を子として追加する。
const HOTSPOT_HIT_RADIUS = 16; // ← 星までの距離が大きいので、他の点(DOT_HIT_RADIUS=1.1)よりだいぶ広めにしてある

export function createHotspots(scene) {
  const hotspotMeshes = [];
  const hotspotGeo = new THREE.SphereGeometry(0.35, 12, 12);
  const hitGeo = new THREE.SphereGeometry(HOTSPOT_HIT_RADIUS, 12, 12);

  HOTSPOTS.forEach(h => {
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
    const m = new THREE.Mesh(hotspotGeo, mat);
    m.position.set(...h.pos);
    m.userData.texts = h.text;

    // 判定専用の当たり判定球(見た目にはほぼ影響しないよう、限りなく透明)。
    // material.visible=falseだとraycastが環境によって拾わないことがあるため、
    // 他の箇所(yzPanel.mesh / axisStationOverlayのhitArea)と同じく
    // visible=trueのままopacityをほぼ0にする方式にする。
    const hitArea = new THREE.Mesh(
      hitGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false })
    );
    m.add(hitArea);

    scene.add(m);
    hotspotMeshes.push(m);
  });
  return hotspotMeshes;
}
