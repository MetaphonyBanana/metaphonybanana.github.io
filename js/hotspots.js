import * as THREE from 'three';

// ── 星に紐づくセリフ(位置と台詞のペア) ───────────
const HOTSPOTS = [
   //X
  { pos: [-20, -80, 100],  text: ['It\'s "If a body meet a body coming through the rye"!\n─Phoebe Caulfield'] },
  { pos: [-80, -130, 100],  text: ['This is a people shooting hat.\n─Holden Caulfield',
                                  'Mine came from Mark Cross.\n─Holden Caulfield']
   },
  { pos: [-250, -130, 100],  text: ['Go home and get your bike and meet me in front of Bobby\'s house. Hurry up.',
                                    'Allie had this left-handed fielder’s mitt.\nHe was left-handed.'
  ] },
  //Y
  { pos: [250, -150, -90],  text: ['gift horse\n─Teddy',
                                   'triumvirate\n─Teddy'
  ] },
  { pos: [20, -150, -80],  text: ['Did the tigers run all around that tree?\n─Sybil Carpenter',
                                 'Here comes a wave.\n─Sybil Carpenter']
   },
  { pos: [-10, -100, -70],  text: ['What did one wall say to the other wall?\n─Charles'] },
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

export function createHotspots(scene) {
  const hotspotMeshes = [];
  const hotspotGeo = new THREE.SphereGeometry(0.35, 12, 12);
  HOTSPOTS.forEach(h => {
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
    const m = new THREE.Mesh(hotspotGeo, mat);
    m.position.set(...h.pos);
    m.userData.texts = h.text;
    scene.add(m);
    hotspotMeshes.push(m);
  });
  return hotspotMeshes;
}
