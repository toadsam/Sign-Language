import * as THREE from 'three';
const unit = new THREE.CapsuleGeometry(1, 1, 3, 8);
const template = new Float32Array(unit.getAttribute('position').array);
unit.dispose();
const up = new THREE.Vector3(0, 1, 0), delta = new THREE.Vector3();
export function createCapsule(material: THREE.Material) {
  const geometry = new THREE.CapsuleGeometry(1, 1, 3, 8);
  (geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
  const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false;
  return mesh;
}
/** Capsule tips coincide with the input joints; no per-frame geometry allocation. */
export function setCapsuleBetween(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
  delta.subVectors(b, a); const length = delta.length();
  if (length < 1e-6) { mesh.visible = false; return; }
  mesh.visible = true;
  const r = Math.min(radius, length / 2), halfBody = Math.max(0, length / 2 - r);
  const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute, output = position.array;
  for (let i = 0; i < template.length; i += 3) {
    output[i] = template[i] * r;
    output[i + 1] = Math.sign(template[i + 1]) * (halfBody + (Math.abs(template[i + 1]) - .5) * r);
    output[i + 2] = template[i + 2] * r;
  }
  position.needsUpdate = true;
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(up, delta.divideScalar(length));
}
