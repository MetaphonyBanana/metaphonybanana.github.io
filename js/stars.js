import * as THREE from 'three';

// ── 星空(球殻状に分布し、シェーダーで瞬く) ───────
export function createStars(scene, count = 3000) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const radius = 150;

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius + Math.random() * 350;

    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x9ecbff) }
    },
    vertexShader: `
            attribute float phase;
            uniform float uTime;
            varying float vTwinkle;
            void main() {
                vTwinkle = 0.5 + 0.5 * sin(uTime * 1.5 + phase * 6.2831);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = (1.2 + vTwinkle * 1.3) * (300.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
    fragmentShader: `
            uniform vec3 uColor;
            varying float vTwinkle;
            void main() {
                vec2 c = gl_PointCoord - vec2(0.5);
                float d = length(c);
                if (d > 0.5) discard;
                float alpha = smoothstep(0.5, 0.0, d) * (0.35 + vTwinkle * 0.65);
                gl_FragColor = vec4(uColor, alpha);
            }
        `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const stars = new THREE.Points(geometry, material);
  scene.add(stars);

  return {
    mesh: stars,
    update(time) {
      material.uniforms.uTime.value = time;
      stars.rotation.y = time * 0.005;
    }
  };
}
