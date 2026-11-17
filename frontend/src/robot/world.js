// Thế giới giả lập của robot: "sự thật" mà cảm biến nhìn vào. Robot KHÔNG được đọc trực tiếp dữ liệu này;
// nó chỉ biết thế giới qua sensor.js. Mọi thứ là hộp chữ nhật thẳng trục (kệ chỉ xoay 0° hoặc 90°), đơn vị mét.
//
// Dựng từ phòng ĐÃ LƯU (cùng dạng GET /api/rooms/{id}), cộng thêm vật cản giả lập chỉ sống ở frontend
// (thùng rơi, dây điện…): không lưu database, backend không biết gì về chúng.
// Hàm thuần: không đụng DOM, Three.js hay store, nên test được và dùng chung cho 2D lẫn 3D.

export const WALL_HEIGHT = 3;     // trùng chiều cao tường vẽ ở scene3d/warehouse3d.js
export const COLUMN_HEIGHT = 3;

/**
 * @param {object} layout phòng đã lưu: { width, depth, racks: [...], obstacles: [...] }
 * @param {Array} extraObstacles vật cản giả lập: { x, y, width, depth, height, label? }
 * @returns {{ width: number, depth: number, boxes: Array<{x, y, width, depth, height, kind, label}> }}
 */
export function createWorld(layout, extraObstacles = []) {
  if (!(layout?.width > 0) || !(layout?.depth > 0)) throw new RangeError('Phòng phải có width và depth > 0.');

  const boxes = [];
  for (const o of layout.obstacles ?? []) {
    const isWall = o.kind === 'Wall';
    boxes.push(makeBox({
      x: o.x, y: o.y, width: o.width, depth: o.depth,
      height: isWall ? WALL_HEIGHT : COLUMN_HEIGHT,
      kind: isWall ? 'wall' : 'column',
      label: isWall ? 'Tường' : 'Cột',
    }));
  }
  for (const r of layout.racks ?? []) {
    // Kích thước chiếm chỗ lấy từ server (footprintWidth/Depth đã tính xoay), không tự đổi chỗ dài/sâu ở đây:
    // luật "frontend không tự tính footprint" (CLAUDE.md mục 3).
    boxes.push(makeBox({
      x: r.x, y: r.y, width: r.footprintWidth, depth: r.footprintDepth,
      height: r.levels * r.levelHeight,
      kind: 'rack',
      label: r.code,
    }));
  }
  const world = { width: layout.width, depth: layout.depth, boxes };
  return extraObstacles.reduce(withObstacle, world);
}

/** Trả thế giới MỚI có thêm một vật cản giả lập; thế giới cũ giữ nguyên (để "Chạy lại" quay về trạng thái đầu). */
export function withObstacle(world, obstacle) {
  const box = makeBox({ ...obstacle, kind: 'sim', label: obstacle.label ?? 'Vật cản' });
  return { ...world, boxes: [...world.boxes, box] };
}

function makeBox({ x, y, width, depth, height, kind, label }) {
  for (const [name, value] of Object.entries({ width, depth, height })) {
    if (!(value > 0)) throw new RangeError(`${label ?? kind}: ${name} phải > 0 (đang là ${value}).`);
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError(`${label ?? kind}: toạ độ không hợp lệ.`);
  return { x, y, width, depth, height, kind, label };
}
