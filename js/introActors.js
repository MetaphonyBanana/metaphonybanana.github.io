import * as THREE from 'three';

// ── 矢 ─────────────────────────────────────────
export function createArrow(scene) {
  const arrowGroup = new THREE.Group();
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffe27a });

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8), arrowMat);
  shaft.rotation.x = Math.PI / 2;
  arrowGroup.add(shaft);

  const head = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 8), arrowMat);
  head.position.z = 0.7;
  head.rotation.x = Math.PI / 2;
  arrowGroup.add(head);

  arrowGroup.visible = false;
  scene.add(arrowGroup);
  return arrowGroup;
}
