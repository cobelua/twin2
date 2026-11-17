// Bản đồ lưới của robot: thứ robot TỰ DỰNG từ các lần quét (sensor.js), không đọc từ mặt bằng đã lưu.
// Mỗi ô (mặc định 0,1 m) có trạng thái UNKNOWN / FREE / OCCUPIED và độ cao cao nhất đã thấy (bản đồ "2.5D").
// Độ cao là thứ để bước sau quyết định "bước qua hay đi vòng"; bản đồ chỉ ghi lại, không quyết định gì.
//
// Ô lưới ở đây là của riêng robot, KHÁC grid snap của editor (Room.GridSize): server không lưu gì theo ô này.
// Dùng mảng phẳng (Uint8Array, Float32Array) chứ không dùng mảng object: 20 × 12 m là 24.000 ô, cập nhật mỗi khung hình.
//
// Luật cập nhật (giữ đơn giản, thế giới giả lập không có nhiễu):
// - Đoạn tia đi qua: ô UNKNOWN → FREE.
// - Ô chỗ tia chạm vật, và các ô tia đi xuyên qua vật thấp: → OCCUPIED, độ cao lấy lớn nhất.
// - OCCUPIED không bao giờ quay lại FREE: một ô vừa có sàn vừa có mép vật (vật không thẳng lưới) vẫn phải là "có vật",
//   nếu không thì robot sẽ quệt mép kệ. Cái giá: bản đồ hơi "béo" hơn thực tế tối đa một ô.
// - Tia chạm MÉP PHÒNG thì không đánh dấu ô nào là vật: ô cuối vẫn là sàn thật, mép phòng đã là biên của lưới.

export const UNKNOWN = 0;
export const FREE = 1;
export const OCCUPIED = 2;

const HIT_NUDGE = 1e-4;   // mét: lùi vào trong vật khi đánh dấu ô chỗ tia chạm

/** Lưới rỗng (mọi ô UNKNOWN) phủ phòng width × depth. Ô cuối có thể thò ra ngoài phòng nếu không chia hết. */
export function createGridMap(width, depth, cellSize = 0.1) {
  if (!(width > 0) || !(depth > 0) || !(cellSize > 0)) throw new RangeError('Kích thước phòng và ô phải > 0.');
  // Trừ sai số nhỏ trước khi làm tròn lên (CLAUDE.md mục 3): 20 / 0,1 = 200.00000000000003 không được thành 201 ô.
  const cols = Math.ceil(width / cellSize - 1e-9);
  const rows = Math.ceil(depth / cellSize - 1e-9);
  return {
    width, depth, cellSize, cols, rows,
    state: new Uint8Array(cols * rows),
    height: new Float32Array(cols * rows),
  };
}

/** Chỉ số ô chứa điểm (x, y); ngoài lưới thì -1. */
export function cellIndex(map, x, y) {
  const c = Math.floor(x / map.cellSize);
  const r = Math.floor(y / map.cellSize);
  if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) return -1;
  return r * map.cols + c;
}

/** Tâm ô thứ i, bằng mét. */
export function cellCenter(map, i) {
  return {
    x: ((i % map.cols) + 0.5) * map.cellSize,
    y: (Math.floor(i / map.cols) + 0.5) * map.cellSize,
  };
}

/**
 * Ghi một lần quét vào bản đồ (SỬA `map` tại chỗ: bản đồ lớn dần qua hàng trăm lần quét, sao chép mỗi lần thì phí).
 * @returns {number[]} chỉ số các ô vừa đổi, để phần vẽ chỉ tô lại những ô này.
 */
export function integrateScan(map, { origin, readings }) {
  const changed = new Set();
  // Bước dò dọc tia = 1/4 ô: đủ nhỏ để không nhảy cóc qua ô nào khi tia đi chéo.
  const step = map.cellSize / 4;

  for (const r of readings) {
    const dx = Math.cos(r.angle);
    const dy = Math.sin(r.angle);
    const at = (t) => cellIndex(map, origin.x + dx * t, origin.y + dy * t);

    // 1. Đoạn trống: từ robot tới ngay trước chỗ chạm. Tính t = k × step (không cộng dồn) để khỏi trôi sai số.
    const freeUntil = r.hit ? r.distance - 1e-6 : r.distance;
    for (let k = 0; k * step < freeUntil; k++) markFree(map, at(k * step), changed);
    markFree(map, at(freeUntil), changed);

    // 2. Vật thấp tia đi xuyên qua: lấy mẫu ở GIỮA từng đoạn con, không ở mép, để điểm luôn nằm trong vật
    // (đoạn tia trong hộp là dây cung của hình lồi: mọi điểm bên trong dây cung đều ở trong hộp).
    for (const low of r.lows) {
      const length = low.to - low.from;
      const parts = Math.max(1, Math.ceil(length / step));
      for (let k = 0; k < parts; k++) markOccupied(map, at(low.from + ((k + 0.5) / parts) * length), low.height, changed);
    }

    // 3. Chỗ chạm: lấy điểm hơi lùi vào trong vật để ô được đánh dấu là ô của vật, không phải ô sàn ngay trước nó.
    // Lùi tối đa 0,1 mm và không quá nửa đoạn tia nằm trong vật (hitDepth): lùi cố định (ví dụ 1/4 ô) thì tia sượt qua
    // GÓC vật sẽ xuyên ra phía bên kia và đánh dấu nhầm ô ngoài vật, làm mọi vật béo thêm một ô (cột 0,4 m thành 0,6 m).
    if (r.hit && !r.boundary) markOccupied(map, at(r.distance + Math.min(HIT_NUDGE, r.hitDepth / 2)), r.height, changed);
  }
  return [...changed];
}

/** Tỉ lệ ô đã biết (FREE hoặc OCCUPIED) trong số `cells` cho trước; không truyền thì tính trên cả lưới. */
export function knownRatio(map, cells) {
  const list = cells ?? map.state.keys();
  let known = 0;
  let total = 0;
  for (const i of list) {
    total++;
    if (map.state[i] !== UNKNOWN) known++;
  }
  return total === 0 ? 0 : known / total;
}

function markFree(map, i, changed) {
  if (i < 0 || map.state[i] !== UNKNOWN) return;
  map.state[i] = FREE;
  changed.add(i);
}

function markOccupied(map, i, height, changed) {
  if (i < 0) return;
  // height lưu bằng Float32 (3,6 thành 3,5999999): so với giá trị cũng đã làm tròn về float32, nếu không thì ô kệ
  // bị coi là "vừa đổi" ở mọi lần quét và phần vẽ tô lại mãi.
  if (map.state[i] === OCCUPIED && map.height[i] >= Math.fround(height)) return;
  map.state[i] = OCCUPIED;
  map.height[i] = Math.max(map.height[i], height);
  changed.add(i);
}
