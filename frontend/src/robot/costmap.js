import { OCCUPIED } from './gridMap.js';

// Bản đồ chi phí: từ bản đồ lưới (robot thấy gì) suy ra "tâm robot được đứng ở ô nào".
//
// Vì sao phải phình vật cản: robot là hình tròn bán kính 0,35 m, nhưng tìm đường thì coi robot là MỘT ĐIỂM (tâm).
// Mẹo chuẩn: phình mỗi ô có vật ra một hình tròn bán kính robot. Tâm robot không chạm vùng phình ⇔ thân robot
// không chạm vật. Nhờ vậy thuật toán tìm đường chỉ cần hỏi "ô này được không", không phải kiểm tra va chạm hình tròn.
//
// Hai loại vùng phình, theo độ cao vật so với `maxStep` (bậc cao nhất robot bước qua được):
// - blocked: quanh vật CAO hơn maxStep: không được đi vào.
// - low: quanh vật thấp (≤ maxStep): đi được nhưng tốn thêm (bước 7 cộng phạt ở đây), để A* tự cân nhắc
//   "bước qua" với "đi vòng".
// Costmap không quyết định gì, chỉ đánh dấu; quyết định nằm ở chi phí trong bước tìm đường.

export const DEFAULT_ROBOT = { robotRadius: 0.35, maxStep: 0.05 };

export function createCostmap(map, options = {}) {
  const { robotRadius, maxStep } = { ...DEFAULT_ROBOT, ...options };
  if (!(robotRadius >= 0) || !(maxStep >= 0)) throw new RangeError('Bán kính robot và bậc tối đa phải ≥ 0.');
  const cm = {
    robotRadius, maxStep,
    offsets: diskOffsets(robotRadius / map.cellSize),
    blocked: new Uint8Array(map.state.length),
    low: new Uint8Array(map.state.length),
  };
  rebuildCostmap(cm, map);
  return cm;
}

/** Vật cao hơn bậc tối đa? height lưu Float32 nên so ở cùng độ chính xác: vật 0,05 m với bậc 0,05 m là "thấp". */
export function isTall(cm, height) {
  return height > Math.fround(cm.maxStep);
}

/** Cập nhật theo các ô vừa đổi (kết quả của integrateScan). Ô chỉ có thể thêm vật, không bớt, nên chỉ cần đóng dấu thêm. */
export function updateCostmap(cm, map, changedCells) {
  for (const i of changedCells) if (map.state[i] === OCCUPIED) stamp(cm, map, i);
}

/** Tính lại từ đầu: dùng khi đổi bậc tối đa (vật cũ có thể đổi từ "thấp" sang "cao" hay ngược lại). */
export function rebuildCostmap(cm, map) {
  cm.blocked.fill(0);
  cm.low.fill(0);
  blockRoomEdge(cm, map);
  for (let i = 0; i < map.state.length; i++) if (map.state[i] === OCCUPIED) stamp(cm, map, i);
}

/**
 * Mép phòng là tường bao: tâm robot không được cách mép < bán kính. Bản đồ không vẽ tường bao thành ô vật
 * (tia chạm mép không đánh dấu ô nào, xem gridMap.js), nên phải chặn riêng ở đây; thiếu dòng này robot đứng
 * được ở y = 0,05 m, thân cắm vào tường, và một kệ bị bịt hai mặt vẫn bị coi là tới được qua khe sát tường.
 */
function blockRoomEdge(cm, map) {
  const cs = map.cellSize;
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      const x = (c + 0.5) * cs;
      const y = (r + 0.5) * cs;
      if (Math.min(x, y, map.width - x, map.depth - y) < cm.robotRadius - 1e-9) cm.blocked[r * map.cols + c] = 1;
    }
  }
}

export function setMaxStep(cm, map, maxStep) {
  cm.maxStep = maxStep;
  rebuildCostmap(cm, map);
}

/** Ô đi được, có tốn thêm vì vật thấp không? */
export const isLow = (cm, i) => cm.low[i] === 1 && cm.blocked[i] === 0;

function stamp(cm, map, i) {
  const target = isTall(cm, map.height[i]) ? cm.blocked : cm.low;
  const c = i % map.cols;
  const r = Math.floor(i / map.cols);
  for (const [dc, dr] of cm.offsets) {
    const cc = c + dc;
    const rr = r + dr;
    if (cc >= 0 && rr >= 0 && cc < map.cols && rr < map.rows) target[rr * map.cols + cc] = 1;
  }
}

/** Các ô (dc, dr) có tâm cách tâm ô gốc ≤ radiusCells, tính bằng số ô. */
function diskOffsets(radiusCells) {
  const reach = Math.ceil(radiusCells);
  const offsets = [];
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      if (dc * dc + dr * dr <= radiusCells * radiusCells + 1e-9) offsets.push([dc, dr]);
    }
  }
  return offsets;
}
