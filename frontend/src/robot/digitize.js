import { mapToLayout } from './mapToLayout.js';

// Ghép các bước "Số hoá kho cũ": bản đồ robot quét được + mô hình 3D (để đếm tầng) → mặt bằng cho app.
// Robot đi quét (explorer.js) chỉ dùng cảm biến; riêng việc đếm tầng kệ thì "nhìn dọc" vào mô hình ở tâm kệ
// (giống robot đứng trước kệ ngẩng cảm biến lên), vì LiDAR ngang không thấy được các tấm ngang.

export const EDGE_BAND = 0.35;   // tường bao của mô hình nằm trong dải này: là mép phòng, không phải vật cản
// Mặt kệ quét bằng tia thưa bị đứt đoạn tới cỡ này: vẫn là một khối. Hai vật thật cách nhau < 0,4 m thì robot
// (rộng 0,7 m) cũng không lọt qua, coi là một khối không làm sai việc tìm đường.
export const JOIN = 0.4;
// Ô bản đồ khi số hoá: 5 cm (thay vì 10 cm) để mỗi cạnh kệ lệch tối đa 5 cm. Chân kệ nhô ra ngoài tấm ngang vài cm,
// ô 10 cm nào có một phần chân đều là ô vật, nên với ô 10 cm kệ 4,8 m đo ra 5,0 m.
export const DIGITIZE_EXPLORE = { cellSize: 0.05, sensor: { rays: 120 } };

/**
 * @param map bản đồ robot đã quét (explore)
 * @param model kết quả meshToHeightField (cần surfacesAt)
 */
export function digitize(map, model) {
  return mapToLayout(map, { ignoreEdge: EDGE_BAND, joinDistance: JOIN, levelsAt: levelsFromModel(model) });
}

/**
 * Đếm tầng một kệ: lấy mẫu mặt ngang ở vài điểm dọc trục kệ (tránh chân kệ), chọn số mặt xuất hiện nhiều nhất.
 * n mặt ngang (đáy mỗi tầng + tấm trên cùng) → n − 1 tầng; chiều cao tầng = khoảng cách đều giữa hai mặt đầu, cuối.
 */
export function levelsFromModel(model) {
  return (rack) => {
    const { x: cx, y: cy } = rack.center;
    const along = rack.rotation === 0 ? [1, 0] : [0, 1];
    const half = (rack.bays * rack.bayWidth) / 2;
    const samples = [-0.25, 0, 0.25].map((k) => model.surfacesAt(cx + along[0] * k * half, cy + along[1] * k * half));
    const counts = new Map();
    for (const s of samples) if (s.length >= 2) counts.set(s.length, (counts.get(s.length) ?? 0) + 1);
    if (counts.size === 0) return null;
    const n = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    const surfaces = samples.find((s) => s.length === n);
    return { levels: n - 1, levelHeight: (surfaces[n - 1] - surfaces[0]) / (n - 1) };
  };
}
