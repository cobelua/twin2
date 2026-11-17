import { createCostmap, updateCostmap } from './costmap.js';
import { FREE, UNKNOWN, cellCenter, cellIndex, createGridMap, integrateScan } from './gridMap.js';
import { findPath } from './search.js';
import { scan } from './sensor.js';

// Tự đi quét theo biên (frontier-based exploration, Yamauchi 1997).
//
// "Biên" = ô đã biết là TRỐNG nằm sát ô CHƯA BIẾT. Đứng ở biên thì cảm biến sẽ thấy thêm vùng mới.
// Vòng lặp: quét → ghi vào bản đồ → nếu cần thì chọn biên gần nhất (theo đường đi được) → đi một bước → lặp.
// Hết biên đi tới được ⇒ đã quét xong. Ô còn "chưa biết" lúc đó là chỗ robot không nhìn vào được
// (trong kệ, sau cột) hoặc không tới được.
//
// Viết dạng generator: mỗi lần next() là một "nhịp" (quét + đi một ô). Giao diện gọi next() theo tốc độ muốn
// (×1, ×2, ×4) và vẽ trạng thái trả về; test thì chạy một mạch tới cuối. Hai bên dùng chung đúng một logic.
//
// Robot ở đây biết CHÍNH XÁC vị trí của mình (không mô phỏng trượt bánh, không SLAM): giới hạn đã chấp nhận.

export const DEFAULT_EXPLORE = {
  cellSize: 0.1,
  robotRadius: 0.35,
  maxStep: 0.05,
  minUnknown: 2,          // ô biên phải sát ít nhất 2 ô chưa biết: bỏ qua các "lỗ" lẻ 1 ô do tia đi thưa
  blacklistRadius: 0.6,   // tới nơi mà biên vẫn còn (không nhìn vào được) thì bỏ qua vùng quanh nó, bán kính này
  maxTicks: 20000,        // chặn vòng lặp vô tận nếu có lỗi
  sensor: {},             // tuỳ chọn cho sensor.scan (rays, range…)
};

/** Ô biên: trống, tâm robot đứng được, sát ít nhất `minUnknown` ô chưa biết (8 ô quanh). */
export function isFrontier(map, cm, i, minUnknown = DEFAULT_EXPLORE.minUnknown) {
  if (map.state[i] !== FREE || cm.blocked[i]) return false;
  const c = i % map.cols;
  const r = Math.floor(i / map.cols);
  let unknown = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= map.cols || rr >= map.rows) continue;
      if (map.state[rr * map.cols + cc] === UNKNOWN) unknown++;
    }
  }
  return unknown >= minUnknown;
}

/**
 * Biên gần nhất theo ĐƯỜNG ĐI (không phải đường chim bay: biên sau lưng kệ có thể gần mà phải đi vòng xa).
 * Chỉ đi qua ô đã biết là trống: chưa biết thì không dám đi vào lúc đang quét.
 * @returns {{ target: number, path: number[] } | null} null = hết biên đi tới được
 */
export function chooseFrontier(map, cm, skip, from, minUnknown = DEFAULT_EXPLORE.minUnknown) {
  const found = findPath(map, from, {
    isGoal: (i) => i !== from && !skip[i] && isFrontier(map, cm, i, minUnknown),
    passable: (i) => map.state[i] === FREE && !cm.blocked[i],
  });
  return found ? { target: found.cells.at(-1), path: found.cells } : null;
}

/**
 * Chạy quét. Mỗi nhịp yield:
 * { tick, pose, map, costmap, scan, path, pathIndex, target, changed, done, reason }
 *  - scan: lần quét ở nhịp này (các tia), để giao diện vẽ "robot thấy gì"
 *  - path/pathIndex: đường đang đi và ô kế tiếp; target: ô biên đang nhắm (-1 nếu không có)
 *  - changed: các ô bản đồ vừa đổi ở nhịp này (để vẽ lại ít)
 *  - done = true ở nhịp cuối, reason = 'explored' (hết biên) hoặc 'timeout'
 */
export function* explore(world, start, options = {}) {
  const opt = { ...DEFAULT_EXPLORE, ...options };
  const map = createGridMap(world.width, world.depth, opt.cellSize);
  const costmap = createCostmap(map, opt);
  const skip = new Uint8Array(map.state.length);   // vùng biên đã bỏ qua
  let pose = { x: start.x, y: start.y };
  let path = null;
  let pathIndex = 0;
  let target = -1;

  for (let tick = 0; tick < opt.maxTicks; tick++) {
    const sensed = scan(world, pose, opt.sensor);
    const changed = integrateScan(map, sensed);
    updateCostmap(costmap, map, changed);
    const here = cellIndex(map, pose.x, pose.y);

    // Khi nào chọn lại biên: chưa có đường; đi hết đường; biên đã nhìn thấy rõ (không còn là biên);
    // hoặc đường phía trước vừa bị phát hiện là đụng vật.
    const arrived = path && pathIndex >= path.length;
    const targetGone = target >= 0 && !isFrontier(map, costmap, target, opt.minUnknown);
    const blockedAhead = path && path.slice(pathIndex).some((i) => costmap.blocked[i]);
    if (!path || arrived || targetGone || blockedAhead) {
      // Tới nơi mà biên vẫn còn: đứng đó không nhìn thêm được gì nữa → bỏ qua vùng này, kẻo quay lại mãi.
      if (arrived && !targetGone) skipAround(map, skip, target, opt.blacklistRadius);
      const choice = chooseFrontier(map, costmap, skip, here, opt.minUnknown);
      if (!choice) {
        yield { tick, pose, map, costmap, scan: sensed, path: null, pathIndex: 0, target: -1, changed, done: true, reason: 'explored' };
        return;
      }
      ({ target, path } = choice);
      pathIndex = 1;   // ô 0 là chỗ đang đứng
    }

    pose = cellCenter(map, path[pathIndex]);
    pathIndex++;
    yield { tick, pose, map, costmap, scan: sensed, path, pathIndex, target, changed, done: false, reason: null };
  }
  yield { tick: opt.maxTicks, pose, map, costmap, scan: null, path: null, pathIndex: 0, target: -1, changed: [], done: true, reason: 'timeout' };
}

/**
 * Chỗ đặt robot lúc bắt đầu: ưu tiên sát tường trái, giữa phòng (thường là cửa kho), rồi dò dần ra. Chỗ hợp lệ là
 * cách mọi vật và mép phòng ≥ bán kính + 0,1 m. Đây là "người đặt robot vào phòng" nên được nhìn thế giới thật;
 * từ lúc chạy, robot chỉ biết qua cảm biến.
 * @returns {{x, y} | null} null nếu phòng kín hết chỗ
 */
export function findStart(world, robotRadius = DEFAULT_EXPLORE.robotRadius) {
  const need = robotRadius + 0.1;
  const clear = world.isClear ? (x, y) => world.isClear(x, y, need) : (x, y) => x >= need && y >= need && x <= world.width - need && y <= world.depth - need
    && world.boxes.every((b) => {
      const dx = Math.max(b.x - x, 0, x - (b.x + b.width));
      const dy = Math.max(b.y - y, 0, y - (b.y + b.depth));
      return Math.hypot(dx, dy) >= need;
    });
  const mid = world.depth / 2;
  for (let k = 0; k * 0.1 <= mid; k++) {
    for (const y of [mid - k * 0.1, mid + k * 0.1]) if (clear(need + 0.05, y)) return { x: need + 0.05, y };
  }
  for (let y = need; y <= world.depth - need; y += 0.2) {
    for (let x = need; x <= world.width - need; x += 0.2) if (clear(x, y)) return { x, y };
  }
  return null;
}

/** Chạy một mạch tới hết, trả nhịp cuối và số mét đã đi. Dùng cho test và báo cáo. */
export function exploreAll(world, start, options = {}) {
  let last = null;
  let distance = 0;
  let prev = start;
  for (const step of explore(world, start, options)) {
    distance += Math.hypot(step.pose.x - prev.x, step.pose.y - prev.y);
    prev = step.pose;
    last = step;
  }
  return { ...last, distance };
}

/**
 * Các ô sàn THẬT (không nằm trong vật nào) của thế giới, để tính "đã quét bao nhiêu % sàn".
 * Chỉ dùng để BÁO CÁO cho người xem; robot không được dùng nó để quyết định (nó là sự thật robot không biết).
 */
export function floorCells(world, map) {
  const cells = [];
  for (let i = 0; i < map.state.length; i++) {
    const { x, y } = cellCenter(map, i);
    if (x > world.width || y > world.depth) continue;
    const floor = world.isFloor
      ? world.isFloor(x, y)   // thế giới bản đồ độ cao (kho 3D)
      : !world.boxes.some((b) => x > b.x && x < b.x + b.width && y > b.y && y < b.y + b.depth);
    if (floor) cells.push(i);
  }
  return cells;
}

function skipAround(map, skip, center, radius) {
  const reach = Math.ceil(radius / map.cellSize);
  const c = center % map.cols;
  const r = Math.floor(center / map.cols);
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc >= 0 && rr >= 0 && cc < map.cols && rr < map.rows && dc * dc + dr * dr <= reach * reach) skip[rr * map.cols + cc] = 1;
    }
  }
}
