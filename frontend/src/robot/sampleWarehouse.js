import * as THREE from 'three';

// Kho mẫu dựng bằng code, đóng vai "kho cũ chưa có bản vẽ" cho câu chuyện Số hoá (giống cách các nhóm robot dùng
// kho mẫu như AWS small warehouse khi chưa có toà nhà thật). Không lấy từ bản vẽ nào trong app.
// Trả kèm `truth` (đáp án) để test và để màn hình so kết quả robot dựng lại với kho thật.
//
// Có chủ ý vài thứ app không vẽ được, để thấy robot xử lý: một kệ đặt chéo 30°, một cột TRÒN, một pallet rỗng nằm
// giữa sàn (đồ vương vãi, không thuộc thiết kế). Đơn vị mét, Y hướng lên, sàn ở y = 0, góc phòng ở (0; 0).

export function buildSampleWarehouse() {
  const W = 18;
  const D = 12;
  const group = new THREE.Group();
  const mat = (color) => new THREE.MeshStandardMaterial({ color });
  const add = (geometry, color, x, y, z, parent = group) => {
    const mesh = new THREE.Mesh(geometry, mat(color));
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const boxAt = (w, h, d, color, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), color, x, y, z, parent);

  const floor = add(new THREE.PlaneGeometry(W, D), 0xf1efe8, W / 2, 0, D / 2);
  floor.rotation.x = -Math.PI / 2;

  // Tường bao (dày 0,2 m, nằm trong khối bao) và một tường ngăn.
  boxAt(W, 3, 0.2, 0xb4b2a9, W / 2, 1.5, 0.1);
  boxAt(W, 3, 0.2, 0xb4b2a9, W / 2, 1.5, D - 0.1);
  boxAt(0.2, 3, D, 0xb4b2a9, 0.1, 1.5, D / 2);
  boxAt(0.2, 3, D, 0xb4b2a9, W - 0.1, 1.5, D / 2);
  boxAt(5, 3, 0.2, 0x888780, 3, 1.5, 8.6);

  const truth = { width: W, depth: D, racks: [], columns: [], walls: [{ x: 0.5, y: 8.5, width: 5, depth: 0.2 }], clutter: [] };

  /** Kệ: tấm ngang ở đáy mỗi tầng + tấm trên cùng (nóc), chân ở mỗi ranh giới ô. */
  function rack(code, cx, cz, bays, bayWidth, rackDepth, levels, levelHeight, angleDeg = 0) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = -angleDeg * Math.PI / 180;
    group.add(g);
    const length = bays * bayWidth;
    for (let k = 0; k <= levels; k++) boxAt(length, 0.05, rackDepth, 0x85b7eb, 0, 0.1 + k * levelHeight, 0, g);
    const topY = 0.1 + levels * levelHeight + 0.025;
    for (let i = 0; i <= bays; i++) {
      for (const s of [-1, 1]) boxAt(0.06, topY, 0.06, 0x185fa5, -length / 2 + i * bayWidth, topY / 2, s * rackDepth / 2, g);
    }
    truth.racks.push({ code, cx, cy: cz, length, depth: rackDepth, bays, levels, levelHeight, angle: angleDeg });
  }

  rack('A1', 4, 2, 4, 1.2, 1, 3, 1.2);
  rack('A2', 10, 2, 4, 1.2, 1, 4, 1.0);
  rack('A3', 4, 5, 4, 1.2, 1, 2, 1.5);
  rack('A4', 15.5, 5, 3, 1.2, 1, 3, 1.2, 90);
  rack('A5', 10.5, 6.5, 3, 1.3, 1, 3, 1.1, 30);

  const column = add(new THREE.CylinderGeometry(0.25, 0.25, 3, 24), 0x888780, 8, 1.5, 9.5);
  truth.columns.push({ x: column.position.x, y: column.position.z, radius: 0.25 });

  boxAt(1.2, 0.15, 1, 0xba7517, 13.5, 0.075, 10);   // pallet rỗng để giữa sàn: cao 15 cm, không thuộc thiết kế
  truth.clutter.push({ x: 13.5, y: 10, width: 1.2, depth: 1, height: 0.15 });

  group.updateMatrixWorld(true);
  return { object: group, truth };
}
