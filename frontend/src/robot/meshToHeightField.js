import * as THREE from 'three';
import { createHeightField } from './heightField.js';

// Mô hình 3D bất kỳ (kho mẫu dựng bằng code, hoặc file .glb thả vào) → bản đồ độ cao + hàm đếm mặt ngang.
// Đây là phần "phần cứng giả" của cảm biến độ sâu: chiếu tia từ trên xuống ở mỗi ô 5 cm, lấy mặt cao nhất.
// Robot KHÔNG đọc thẳng bản đồ này; nó chỉ nhận từng tia qua heightField.castHeightRay từ chỗ nó đứng.
//
// Quy ước mô hình: đơn vị mét, trục Y hướng lên (chuẩn glTF). Sàn đặt ở đáy khối bao (min.y); toạ độ được dời để
// góc khối bao là (0; 0) của phòng: X mô hình → X phòng, Z mô hình → Y phòng (như cảnh 3D của app).

const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * @returns {{ heightField, width, depth, origin, surfacesAt(x, y) }}
 *  surfacesAt: các mặt NGANG HƯỚNG LÊN tại (x, y), độ cao tăng dần (tấm sàn kệ, mặt thùng…), để đếm tầng kệ.
 */
export function meshToHeightField(object, { res = 0.05 } = {}) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) throw new Error('Mô hình rỗng: không có khối nào.');
  const size = box.getSize(new THREE.Vector3());
  const width = Math.round(size.x / res) * res;
  const depth = Math.round(size.z / res) * res;
  if (width < 1 || depth < 1) throw new Error(`Mô hình quá nhỏ (${size.x.toFixed(2)} × ${size.z.toFixed(2)} m): có đúng đơn vị mét không?`);

  const cols = Math.round(width / res);
  const rows = Math.round(depth / res);
  const heights = new Float32Array(cols * rows);
  const top = box.max.y + 1;
  const ray = new THREE.Raycaster();
  ray.far = size.y + 2;
  const from = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      from.set(box.min.x + (c + 0.5) * res, top, box.min.z + (r + 0.5) * res);
      ray.set(from, DOWN);
      const hit = ray.intersectObject(object, true)[0];
      heights[r * cols + c] = hit ? Math.max(0, hit.point.y - box.min.y) : 0;
    }
  }

  const normal = new THREE.Vector3();
  function surfacesAt(x, y) {
    ray.set(new THREE.Vector3(box.min.x + x, top, box.min.z + y), DOWN);
    const ys = [];
    for (const hit of ray.intersectObject(object, true)) {
      if (!hit.face) continue;
      normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      if (normal.y < 0.7) continue;   // chỉ mặt nằm ngang hướng lên
      const h = hit.point.y - box.min.y;
      if (h > 0.05 && !ys.some((v) => Math.abs(v - h) < 0.03)) ys.push(h);
    }
    return ys.sort((a, b) => a - b);
  }

  return { heightField: createHeightField(width, depth, res, heights), width, depth, origin: { x: box.min.x, z: box.min.z }, surfacesAt };
}
