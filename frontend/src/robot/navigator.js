import { createCostmap, isLow, updateCostmap } from './costmap.js';
import { OCCUPIED, cellCenter, cellIndex, createGridMap, integrateScan } from './gridMap.js';
import { findPath, pathLength } from './search.js';
import { scan } from './sensor.js';

// Đi tới một điểm trên bản đồ robot TỰ DỰNG, gặp vật cản thì tự quyết "bước qua" hay "đi vòng".
//
// Quyết định nằm hết trong chi phí của A* (search.js), không có câu "if thấp thì bước qua" nào:
// - Ô gần vật CAO hơn bậc tối đa: cấm (costmap.blocked).
// - Ô gần vật THẤP (≤ bậc tối đa): đi được, mỗi mét tốn (1 + lowPenalty) mét quy đổi (đi chậm, xóc, có rủi ro).
// - Ô trống hoặc CHƯA BIẾT: 1 mét = 1. Chưa biết coi như trống (lạc quan): không thì robot không dám đi đâu cả;
//   nếu hoá ra có vật, cảm biến thấy khi tới gần và robot tính lại.
// A* tìm đường có tổng chi phí nhỏ nhất, nên tự so: bước qua (ngắn + phạt) với đi vòng (dài, không phạt).
// Ví dụ phạt ×2, dải vật thấp rộng 1 m (đã cộng bán kính robot): bước qua tốn thêm 2 m; đi vòng dài thêm 5 m → bước qua.
// Tăng phạt lên ×10 thì bước qua tốn thêm 10 m > 5 m → đi vòng.
//
// compareOptions tính lại cả hai phương án chỉ để GIẢI THÍCH bằng số (ghi nhật ký), không ảnh hưởng quyết định.

export const DEFAULT_DRIVE = {
  cellSize: 0.1,
  robotRadius: 0.35,
  maxStep: 0.05,
  lowPenalty: 2,            // mỗi mét đi qua vùng vật thấp tốn thêm 2 m quy đổi
  announceDistance: 2.5,    // tới gần vật thấp trên đường cỡ này thì ghi quyết định "bước qua"
  maxTicks: 20000,
  sensor: {},
};

/**
 * Đường rẻ nhất từ ô `from` tới ô `goal`.
 * @param mode 'normal' (vật thấp có phạt) | 'avoidLow' (cấm cả vùng vật thấp: dùng để tính phương án đi vòng)
 * @returns {{ cells, cost, length, lowFlags } | null}  cost (mét quy đổi) = length + phần phạt
 */
export function planRoute(map, cm, from, goal, { lowPenalty = DEFAULT_DRIVE.lowPenalty, mode = 'normal' } = {}) {
  const found = findPath(map, from, {
    goal,
    passable: mode === 'avoidLow' ? (i) => !cm.blocked[i] && !isLow(cm, i) : (i) => !cm.blocked[i],
    stepCost: (i) => (isLow(cm, i) ? 1 + lowPenalty : 1),
  });
  if (!found) return null;
  return { cells: found.cells, cost: found.cost, length: pathLength(map, found.cells), lowFlags: found.cells.map((i) => isLow(cm, i)) };
}

/** Hai phương án tới đích và cái nào rẻ hơn. choice: 'cross' (đường rẻ nhất đi qua vật thấp) | 'around' | 'none'. */
export function compareOptions(map, cm, from, goal, lowPenalty = DEFAULT_DRIVE.lowPenalty) {
  const best = planRoute(map, cm, from, goal, { lowPenalty });
  const around = planRoute(map, cm, from, goal, { lowPenalty, mode: 'avoidLow' });
  const choice = !best ? 'none' : best.lowFlags.some(Boolean) ? 'cross' : 'around';
  return { best, around, choice };
}

/**
 * Đi từ `start` tới `goalPoint` ({x, y}). Mỗi nhịp: quét → cập nhật bản đồ → kiểm tra đường phía trước → đi một ô.
 * options.map: bản đồ robot đã có (ví dụ sau khi đi quét); không truyền thì bắt đầu từ bản đồ trống. Bản đồ được
 * SAO CHÉP, bản gốc không đổi (để chạy lại nhiều chuyến từ cùng một bản đồ quét).
 *
 * Mỗi nhịp yield: { tick, pose, map, costmap, scan, route, routeIndex, onLow, events, done, reason }
 *  - events: các quyết định vừa đưa ra ở nhịp này (xem describeEvent)
 *  - onLow: robot đang đứng trong vùng vật thấp (giao diện cho đi chậm lại)
 *  - done = true ở nhịp cuối; reason = 'arrived' | 'unreachable' | 'timeout'
 */
export function* drive(world, start, goalPoint, options = {}) {
  const opt = { ...DEFAULT_DRIVE, ...options };
  const map = options.map ? cloneMap(options.map) : createGridMap(world.width, world.depth, opt.cellSize);
  const cm = createCostmap(map, opt);
  const goal = cellIndex(map, goalPoint.x, goalPoint.y);
  if (goal < 0) throw new RangeError(`Đích (${goalPoint.x}; ${goalPoint.y}) nằm ngoài phòng.`);
  // options.designMap: bản đồ quét ban đầu (chỉ có thiết kế: kệ, cột, tường). Có thì:
  // - "Đường cũ" là đường theo thiết kế: vật lạ robot NHỚ từ chuyến trước làm đường này sai và được ghi lại
  //   ("nhớ thùng rơi từ chuyến trước: đi vòng ngay từ đầu"), thay vì lặng lẽ né sẵn không giải thích.
  // - Độ cao vật cản so với thiết kế: vật lạ là ô có vật mà thiết kế không có.
  // Không có thì so với bản đồ lúc bắt đầu chặng (vật MỚI thấy). Cả hai cách đều để thùng 0,5 m nằm sát kệ 3,6 m
  // không bị báo nhầm là "vật cao 3,6 m".
  const design = options.designMap ?? null;
  const reference = design ? design.state : map.state.slice();
  const heightAt = (cell) => obstacleHeight(map, cm, cell, reference);
  const rememberedCm = design ? createCostmap(cloneMap(map), opt) : null;   // vật đã biết TRƯỚC khi nhìn ở chặng này

  const announced = new Uint8Array(map.state.length);   // vùng đã ghi quyết định, để không ghi lặp mỗi nhịp
  let pose = { x: start.x, y: start.y };
  // Lập đường TRƯỚC khi nhìn (theo thiết kế nếu có, không thì theo bản đồ đã có): vật lạ thấy sau đó (hoặc nhớ từ
  // trước) làm đường này sai, robot tính lại và ghi quyết định. Lập đường sau lần quét đầu thì vật lạ ở gần cửa đã
  // được né sẵn, nhật ký không có gì để giải thích.
  const startCell = cellIndex(map, pose.x, pose.y);
  let route = design
    ? planRoute(design, createCostmap(design, opt), startCell, goal, opt)
    : planRoute(map, cm, startCell, goal, opt);
  if (route) route.lowFlags = route.cells.map(() => false);   // đường thiết kế không biết vật thấp nào
  let index = 1;

  for (let tick = 0; tick < opt.maxTicks; tick++) {
    const sensed = scan(world, pose, opt.sensor);
    updateCostmap(cm, map, integrateScan(map, sensed));
    const here = cellIndex(map, pose.x, pose.y);
    const events = [];
    const frame = (extra) => ({ tick, pose, map, costmap: cm, scan: sensed, route, routeIndex: index, onLow: isLow(cm, here), events, ...extra });

    if (here === goal) {
      yield frame({ done: true, reason: 'arrived' });
      return;
    }

    // 1. Đường phía trước còn đúng không? Vật cao mới chắn → bắt buộc tính lại. Vật thấp mới (lúc lập đường chưa có)
    //    → tính lại vì chi phí đổi: có thể giờ đi vòng rẻ hơn.
    const trigger = route ? findTrigger(cm, route, index) : null;
    if (!route || trigger) {
      const oldLength = route ? pathLength(map, [here, ...route.cells.slice(index)]) : null;
      const next = planRoute(map, cm, here, goal, opt);
      if (!next) {
        if (trigger) events.push({ type: 'stuck', tick, height: heightAt(trigger.cell) });
        route = null;
        yield frame({ done: true, reason: 'unreachable' });
        return;
      }
      route = next;
      index = 1;
      if (trigger && !announced[trigger.cell]) {
        const height = heightAt(trigger.cell);
        const remembered = rememberedCm != null && (trigger.kind === 'tall' ? rememberedCm.blocked[trigger.cell] === 1 : isLow(rememberedCm, trigger.cell));
        if (trigger.kind === 'tall') {
          events.push({ type: 'detour', tick, height, maxStep: opt.maxStep, oldLength, newLength: route.length, remembered });
          markAround(map, announced, trigger.cell, 1.5);
        } else if (!route.lowFlags.some(Boolean)) {
          // Vật thấp mới nằm trên đường nhưng đường rẻ nhất giờ tránh nó: phạt cao hơn quãng phải đi vòng.
          // Phương án "bước qua" để so: đường NGẮN NHẤT không tính phạt (đi thẳng qua vật thấp), rồi cộng phạt vào.
          const straight = planRoute(map, cm, here, goal, { lowPenalty: 0 });
          const crossLength = straight?.length ?? null;
          const crossCost = straight ? routeCost(map, cm, straight.cells, opt.lowPenalty) : null;
          events.push({ type: 'avoid', tick, height, maxStep: opt.maxStep, lowPenalty: opt.lowPenalty, newLength: route.length, crossLength, crossCost, remembered });
          markAround(map, announced, trigger.cell, 1.5);
        }
      }
    }

    // 2. Sắp bước qua vật thấp: ghi quyết định một lần cho mỗi đoạn vật thấp, kèm số so với đi vòng.
    const lowAhead = firstLowAhead(map, route, index, pose, opt.announceDistance);
    if (lowAhead >= 0 && !announced[route.cells[lowAhead]]) {
      const rest = [here, ...route.cells.slice(index)];
      const cost = routeCost(map, cm, rest, opt.lowPenalty);
      const length = pathLength(map, rest);
      const around = planRoute(map, cm, here, goal, { ...opt, mode: 'avoidLow' });
      events.push({
        type: 'cross', tick, height: heightAt(route.cells[lowAhead]), maxStep: opt.maxStep, lowPenalty: opt.lowPenalty,
        length, penalty: cost - length, aroundLength: around?.length ?? null,
      });
      for (let k = lowAhead; k < route.cells.length && route.lowFlags[k]; k++) markAround(map, announced, route.cells[k], 0.5);
    }

    // 3. Đi một ô.
    pose = cellCenter(map, route.cells[index]);
    index++;
    const reached = index >= route.cells.length;
    yield { ...frame({ done: reached, reason: reached ? 'arrived' : null }), pose, routeIndex: index, onLow: isLow(cm, cellIndex(map, pose.x, pose.y)) };
    if (reached) return;
  }
  yield { tick: opt.maxTicks, pose, map, costmap: cm, scan: null, route: null, routeIndex: 0, onLow: false, events: [], done: true, reason: 'timeout' };
}

/** Câu tiếng Việt cho một quyết định, để hiện trong nhật ký. */
export function describeEvent(e) {
  const m = (v) => `${v.toFixed(1).replace('.', ',')} m`;
  const h = (v) => `${v.toFixed(2).replace('.', ',')} m`;
  const seen = e.remembered ? 'Nhớ từ chuyến trước: vật' : 'Thấy vật';
  // Hai đường dài gần bằng nhau (vòng sát bên vật): không in "thêm -0,0 m".
  const extra = (oldLength, newLength) => (Math.abs(newLength - oldLength) < 0.05 ? 'dài như cũ' : `thêm ${m(newLength - oldLength)}`);
  switch (e.type) {
    case 'detour':
      return `${seen} cao ${h(e.height)} > bậc tối đa ${h(e.maxStep)}: không bước qua được, đi vòng${e.remembered ? ' ngay từ đầu' : ''}. `
        + `Đường mới ${m(e.newLength)}${e.oldLength != null ? ` (đường ${e.remembered ? 'thiết kế' : 'cũ'} ${m(e.oldLength)}, ${extra(e.oldLength, e.newLength)})` : ''}.`;
    case 'cross':
      return `Vật thấp ${h(e.height)} ≤ bậc tối đa ${h(e.maxStep)}. Bước qua: ${m(e.length)} + phạt ${m(e.penalty)} = ${m(e.length + e.penalty)}; `
        + `đi vòng: ${e.aroundLength != null ? m(e.aroundLength) : 'không có đường'} → bước qua.`;
    case 'avoid':
      return `${e.remembered ? 'Nhớ từ chuyến trước: vật' : 'Vật'} thấp ${h(e.height)} ≤ bậc tối đa ${h(e.maxStep)}, bước qua được. Bước qua: `
        + `${e.crossLength != null ? `${m(e.crossLength)} + phạt ${m(e.crossCost - e.crossLength)} = ${m(e.crossCost)}` : 'không có đường'}; `
        + `đi vòng: ${m(e.newLength)} → đi vòng.`;
    case 'stuck':
      return `Vật cao ${h(e.height)} chắn hết đường: không tới được đích.`;
    default:
      return '';
  }
}

// ---------- tiện ích ----------

/** Ô đầu tiên trên đường phía trước bị vật cao chặn, hoặc vừa thành vùng vật thấp mà lúc lập đường chưa có. */
function findTrigger(cm, route, from) {
  for (let k = from; k < route.cells.length; k++) {
    const i = route.cells[k];
    if (cm.blocked[i]) return { kind: 'tall', cell: i };
    if (isLow(cm, i) && !route.lowFlags[k]) return { kind: 'low', cell: i };
  }
  return null;
}

/** Chỉ số ô vật thấp đầu tiên trên đường, trong phạm vi `distance` mét từ robot; -1 nếu không có. */
function firstLowAhead(map, route, from, pose, distance) {
  for (let k = from; k < route.cells.length; k++) {
    if (!route.lowFlags[k]) continue;
    const c = cellCenter(map, route.cells[k]);
    return Math.hypot(c.x - pose.x, c.y - pose.y) <= distance ? k : -1;
  }
  return -1;
}

function routeCost(map, cm, cells, lowPenalty) {
  let cost = 0;
  for (let k = 1; k < cells.length; k++) {
    const step = pathLength(map, [cells[k - 1], cells[k]]);
    cost += step * (isLow(cm, cells[k]) ? 1 + lowPenalty : 1);
  }
  return cost;
}

/**
 * Độ cao vật gây ra ô cấm/ô phạt này: vật cao nhất trong bán kính robot + 1 ô quanh nó. Ưu tiên các ô mới thành vật
 * so với `knownAtStart` (vật vừa thấy); không có ô mới nào thì xét mọi ô.
 */
function obstacleHeight(map, cm, cell, knownAtStart) {
  const reach = Math.ceil(cm.robotRadius / map.cellSize) + 1;
  const c = cell % map.cols;
  const r = Math.floor(cell / map.cols);
  let newest = 0;
  let any = 0;
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= map.cols || rr >= map.rows) continue;
      const i = rr * map.cols + cc;
      if (map.state[i] !== OCCUPIED) continue;
      any = Math.max(any, map.height[i]);
      if (knownAtStart[i] !== OCCUPIED) newest = Math.max(newest, map.height[i]);
    }
  }
  return newest > 0 ? newest : any;
}

function markAround(map, marks, cell, radius) {
  const reach = Math.ceil(radius / map.cellSize);
  const c = cell % map.cols;
  const r = Math.floor(cell / map.cols);
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc >= 0 && rr >= 0 && cc < map.cols && rr < map.rows && dc * dc + dr * dr <= reach * reach) marks[rr * map.cols + cc] = 1;
    }
  }
}

function cloneMap(map) {
  return { ...map, state: map.state.slice(), height: map.height.slice() };
}
