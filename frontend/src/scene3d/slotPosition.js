import { rackPoint } from './rackGeometry.js';

/**
 * Tâm của một khung kệ trong cảnh 3D, bằng mét: { x, y, z } (y là chiều cao, z là toạ độ Y của mặt bằng).
 *
 * - Ngang: khung nằm giữa ô. Ô thứ `bay` (đếm từ 1) bắt đầu cách đầu kệ (bay - 1) × bayWidth, nên tâm ô cách
 *   (bay - 0.5) × bayWidth. Chiều sâu ở giữa: depth / 2. rackPoint đổi (dọc kệ, sâu) ra điểm trên sàn,
 *   đã lo việc xoay 90° và cộng rack.x, rack.y.
 * - Cao: tầng đếm từ 1 nên đáy tầng `level` ở (level - 1) × levelHeight; tâm cao hơn đáy nửa chiều cao khung.
 *   Khung nóc có level = levels + 1 nên dùng cùng công thức, nằm ngay trên tầng trên cùng.
 *
 * Chỉ dùng số liệu của kệ và khung server trả về; kết quả cuối khớp với khung kệ vẽ ở warehouse3d.js
 * vì cả hai cùng đi qua rackPoint.
 */
export function slotWorldPosition(rack, slot) {
  const { x, z } = rackPoint(rack, (slot.bay - 0.5) * rack.bayWidth, rack.depth / 2);
  const y = (slot.level - 1) * rack.levelHeight + rack.levelHeight / 2;
  return { x, y, z };
}
