import { FREE, OCCUPIED, createGridMap } from './gridMap.js';

// Bản đồ robot lấy THẲNG từ bản vẽ (cách của KION/BMW: bản sao số dựng từ file thiết kế, không cần đi quét).
// Mọi ô là đã biết: ô chạm vào kệ / tường / cột (chạm diện tích, không tính chạm cạnh) là vật với đúng chiều cao
// của nó, còn lại là sàn trống. Robot vẫn có cảm biến để phát hiện vật LẠ khi chạy (thứ bản vẽ không có).
//
// Khác với bản đồ quét (gridMap + sensor): ở đây không có ô "chưa biết", và kệ đặc ruột (không chỉ mặt ngoài).

/** @param world thế giới dựng từ bản vẽ (createWorld) — chỉ nên truyền thế giới KHÔNG có vật lạ */
export function mapFromLayout(world, cellSize = 0.1) {
  const map = createGridMap(world.width, world.depth, cellSize);
  map.state.fill(FREE);
  const eps = 1e-9;
  for (const b of world.boxes) {
    // Ô c phủ [c × cs, (c + 1) × cs]; chạm vật khi khoảng đó đè lên [b.x, b.x + width] (chạm mép không tính).
    const c0 = Math.max(0, Math.floor((b.x + eps) / cellSize));
    const c1 = Math.min(map.cols - 1, Math.ceil((b.x + b.width - eps) / cellSize) - 1);
    const r0 = Math.max(0, Math.floor((b.y + eps) / cellSize));
    const r1 = Math.min(map.rows - 1, Math.ceil((b.y + b.depth - eps) / cellSize) - 1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * map.cols + c;
        map.state[i] = OCCUPIED;
        map.height[i] = Math.max(map.height[i], b.height);
      }
    }
  }
  return map;
}
