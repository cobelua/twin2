// Vật cản LẠ thả vào kho để thử robot: không thuộc thiết kế, không lưu database, robot không biết trước
// (bản đồ quét ban đầu không có chúng), chỉ thấy khi cảm biến nhìn tới.
// Kiểm tra chỗ thả ở đây chỉ là luật của TRÒ GIẢ LẬP (không đè vật khác, không chắn chỗ robot xuất phát),
// không phải luật nghiệp vụ của kho, nên được nằm ở frontend.

/** Các loại vật cản dựng sẵn. Kích thước bằng mét; width theo trục X, depth theo trục Y khi chưa xoay. */
export const OBSTACLE_PRESETS = [
  { id: 'wire', label: 'Dây điện', width: 0.3, depth: 2, height: 0.03 },
  { id: 'pallet', label: 'Pallet rỗng', width: 1.2, depth: 1, height: 0.15 },
  { id: 'box', label: 'Thùng rơi', width: 0.8, depth: 0.8, height: 0.5 },
];

const SNAP = 0.1;
const DOOR_CLEARANCE = 1;   // mét quanh chỗ robot xuất phát phải để trống, không thì robot kẹt ngay ở cửa

/**
 * Đặt vật cản kiểu `preset` có TÂM ở `center` ({x, y}), hít về lưới 0,1 m và kéo vào trong phòng.
 * @param world thế giới hiện tại (kệ, tường, cột và các vật cản lạ đã thả)
 * @param options.rotated xoay 90° (đổi chỗ width/depth)
 * @param options.door chỗ robot xuất phát ({x, y}), giữ trống bán kính DOOR_CLEARANCE
 * @returns {{ obstacle } | { reason }} obstacle: { x, y, width, depth, height, label, presetId }
 */
export function placeObstacle(world, preset, center, { rotated = false, door = null } = {}) {
  const width = rotated ? preset.depth : preset.width;
  const depth = rotated ? preset.width : preset.depth;
  if (width > world.width || depth > world.depth) return { reason: `${preset.label} to hơn cả phòng.` };

  const snap = (v) => Math.round(v / SNAP) * SNAP;
  const x = round(clamp(snap(center.x - width / 2), 0, world.width - width));
  const y = round(clamp(snap(center.y - depth / 2), 0, world.depth - depth));
  const rect = { x, y, width, depth };

  const hit = world.boxes.find((b) => overlaps(rect, b));
  if (hit) {
    const what = hit.kind === 'rack' ? `kệ ${hit.label}` : hit.kind === 'sim' ? hit.label.toLowerCase() : hit.kind === 'wall' ? 'tường' : 'cột';
    return { reason: `Đè lên ${what}.` };
  }
  if (door && distanceToRect(door, rect) < DOOR_CLEARANCE) return { reason: 'Quá sát cửa kho (chỗ robot xuất phát).' };

  return { obstacle: { ...rect, height: preset.height, label: preset.label, presetId: preset.id } };
}

/** Hai hình chữ nhật đè nhau; chạm cạnh không tính (như Rect.Overlaps ở backend). */
function overlaps(a, b) {
  const eps = 1e-9;
  return a.x < b.x + b.width - eps && b.x < a.x + a.width - eps && a.y < b.y + b.depth - eps && b.y < a.y + a.depth - eps;
}

function distanceToRect(p, r) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.depth));
  return Math.hypot(dx, dy);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v) => Math.round(v * 1000) / 1000;
