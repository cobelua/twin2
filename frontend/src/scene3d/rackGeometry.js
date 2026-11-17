// Hình học của kệ trong cảnh 3D. Đơn vị mét; 1 đơn vị three.js = 1 m (không còn hệ số ô).
// Trục: x = toạ độ X của mặt bằng, z = toạ độ Y của mặt bằng, y = chiều cao (từ sàn lên).

/**
 * Điểm trên sàn ứng với (u, v) trong toạ độ của kệ: u chạy dọc chiều dài kệ (theo các ô), v chạy theo chiều sâu,
 * gốc ở góc trên trái của footprint (cùng góc với rack.x, rack.y).
 * Rotation 0: u theo X, v theo Y. Rotation 90: dài chạy theo Y nên đổi chỗ, u theo Y, v theo X
 * (khớp Rack.GetBounds ở backend: xoay 90° đổi chỗ hai cạnh).
 */
export function rackPoint(rack, u, v) {
  return rack.rotation === 90
    ? { x: rack.x + v, z: rack.y + u }
    : { x: rack.x + u, z: rack.y + v };
}

/** Kích thước một ô của kệ theo trục x và z của cảnh (đã tính xoay): ô rộng bayWidth dọc kệ, sâu depth. */
export function bayFootprint(rack) {
  return rack.rotation === 90
    ? { sizeX: rack.depth, sizeZ: rack.bayWidth }
    : { sizeX: rack.bayWidth, sizeZ: rack.depth };
}
