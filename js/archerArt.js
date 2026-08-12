import * as THREE from 'three';

// ── オープニング演出でのみ浮かび上がる射手座アートワーク ─────
// CSS(画面固定)ではブラウザのアスペクト比が変わるたびに3D側とズレるため、
// 3D空間内のSpriteとして配置する。Spriteは常にカメラの方を向く板なので、
// 「その場に浮かんでいる発光体」として自然に見える。
// 色変換とぼかしはcanvasの2Dコンテキストで焼き込む(CSSのfilterとほぼ同じ構文)。
export function createArcherArt(scene, position, { width = 60, height = 40, blurPx = 6 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,        // 通常は非表示。GSAPでopacityをアニメーションさせる
    depthWrite: false,  // 半透明の板が他の物体を隠さないように
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, height, 1);
  sprite.position.copy(position);
  sprite.visible = false; // 画像ロード完了までは非表示
  scene.add(sprite);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.filter =
      `brightness(0) saturate(100%) invert(70%) sepia(45%) saturate(600%) ` +
      `hue-rotate(160deg) brightness(0.85) contrast(105%) blur(${blurPx}px)`;
    ctx.drawImage(img, 0, 0);
    texture.needsUpdate = true;
    sprite.visible = true;
  };
  img.src = './img/sagittarius.png';

  return sprite;
}