import { rackPoint } from '../scene3d/rackGeometry.js';
import { createCostmap } from './costmap.js';
import { cellIndex } from './gridMap.js';
import { DEFAULT_DRIVE, describeEvent, drive, planRoute } from './navigator.js';

// Robot chở pallet: với mỗi pallet SERVER đã xếp (placements, đúng thứ tự server trả), robot nhận hàng ở cửa kho →
// đi tới trước khung → nâng pallet vào khung → quay về cửa. Frontend KHÔNG chọn khung: chỉ chở tới khung server chọn.
// Vị trí cuối của pallet do màn 3D lấy theo slotWorldPosition (như hiệu ứng bay cũ); ở đây chỉ lo đường đi trên sàn.
//
// Robot đi bằng navigator.drive trên bản đồ nó đã quét; vật lạ gặp trên đường thì tự bước qua / đi vòng.
// Bản đồ học được ở chuyến trước dùng tiếp cho chuyến sau (lần sau đã biết thùng rơi ở đâu, lập đường né sẵn).

export const DEFAULT_DELIVERY = {
  ...DEFAULT_DRIVE,
  liftTicks: 10,                    // số nhịp nâng pallet vào khung
  approachGaps: [0.15, 0.35, 0.6],  // đứng cách mặt kệ (bán kính robot + gap); thử gần trước, kẹt thì lùi xa hơn
};

/**
 * Các điểm đứng trên sàn trước ô của khung: giữa ô (theo chiều dài kệ), ở cả hai mặt kệ, cách mặt kệ
 * bán kính robot + gap. Dùng rackPoint như phần vẽ 3D, nên tự đúng với kệ xoay 90°.
 * @returns {Array<{x, y, gap}>} theo thứ tự gap tăng dần, mỗi gap hai mặt
 */
export function approachCandidates(rack, slot, robotRadius = DEFAULT_DELIVERY.robotRadius, gaps = DEFAULT_DELIVERY.approachGaps) {
  const along = (slot.bay - 0.5) * rack.bayWidth;
  const points = [];
  for (const gap of gaps) {
    const d = robotRadius + gap;
    for (const across of [-d, rack.depth + d]) {
      const p = rackPoint(rack, along, across);
      points.push({ x: p.x, y: p.z, gap });
    }
  }
  return points;
}

/**
 * Chọn chỗ đứng tới được và rẻ nhất trong các điểm gần kệ nhất; kẹt hết thì thử lùi xa hơn.
 * @returns {{ point, route } | null}
 */
export function chooseApproach(map, cm, fromCell, rack, slot, opt = DEFAULT_DELIVERY) {
  const candidates = approachCandidates(rack, slot, opt.robotRadius, opt.approachGaps);
  for (const gap of opt.approachGaps) {
    let best = null;
    for (const point of candidates.filter((c) => c.gap === gap)) {
      const goal = cellIndex(map, point.x, point.y);
      if (goal < 0 || cm.blocked[goal]) continue;
      const route = planRoute(map, cm, fromCell, goal, opt);
      if (route && (!best || route.cost < best.route.cost)) best = { point, route };
    }
    if (best) return best;
  }
  return null;
}

/**
 * Chạy lần lượt các chuyến. jobs: [{ rack, slot, palletCode, slotCode }] theo thứ tự server.
 * Mỗi nhịp yield khung hình của navigator (pose, route, events, onLow…) cộng thêm:
 *  { phase: 'go' | 'lift' | 'return' | 'skip' | 'done', jobIndex, job, carrying, lift (0..1 khi phase = 'lift') }
 * Sự kiện thêm: { type: 'placed', palletCode, slotCode } khi nâng xong, { type: 'noAccess', ... } khi không tới được khung.
 */
export function* deliver(world, map, door, jobs, options = {}) {
  // Bản đồ quét ban đầu (chỉ thiết kế) giữ làm mốc cho mọi chặng: vật lạ nhớ từ chuyến trước vẫn được giải thích.
  const opt = { ...DEFAULT_DELIVERY, designMap: map, ...options };
  let known = map;
  let pose = { x: door.x, y: door.y };

  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
    const job = jobs[jobIndex];
    const base = { jobIndex, job, map: known, pose, route: null, routeIndex: 0, onLow: false, scan: null, done: false, reason: null };

    const choice = chooseApproach(known, createCostmap(known, opt), cellIndex(known, pose.x, pose.y), job.rack, job.slot, opt);
    if (!choice) {
      yield { ...base, phase: 'skip', carrying: false, events: [{ type: 'noAccess', palletCode: job.palletCode, slotCode: job.slotCode }] };
      continue;
    }

    // Đi tới trước khung, mang pallet.
    const go = yield* trip(world, pose, choice.point, known, opt, { phase: 'go', jobIndex, job, carrying: true });
    known = go.map;
    pose = go.pose;
    if (go.reason !== 'arrived') {
      yield { ...base, map: known, pose, phase: 'skip', carrying: false, events: [{ type: 'noAccess', palletCode: job.palletCode, slotCode: job.slotCode }] };
      continue;
    }

    // Nâng pallet vào khung.
    for (let t = 1; t <= opt.liftTicks; t++) {
      const last = t === opt.liftTicks;
      yield {
        ...base, map: known, pose, phase: 'lift', carrying: !last, lift: t / opt.liftTicks,
        events: last ? [{ type: 'placed', palletCode: job.palletCode, slotCode: job.slotCode }] : [],
      };
    }

    // Quay về cửa nhận pallet tiếp theo.
    const back = yield* trip(world, pose, door, known, opt, { phase: 'return', jobIndex, job, carrying: false });
    known = back.map;
    pose = back.pose;
  }
  yield { phase: 'done', jobIndex: jobs.length, job: null, map: known, pose, route: null, routeIndex: 0, onLow: false, scan: null, carrying: false, events: [], done: true, reason: 'done' };
}

/** Câu tiếng Việt cho mọi sự kiện của chuyến chở (cộng các quyết định bước qua / đi vòng của navigator). */
export function describeDeliveryEvent(e) {
  if (e.type === 'placed') return `Đã đặt ${e.palletCode} vào ${e.slotCode}.`;
  if (e.type === 'noAccess') return `Không tới được trước khung ${e.slotCode}: ${e.palletCode} hiện thẳng vào khung.`;
  return describeEvent(e);
}

/** Một chặng drive; chuyển tiếp từng nhịp (done = false: chưa hết cả lượt), trả nhịp cuối. */
function* trip(world, from, to, map, opt, extra) {
  let last = null;
  for (const frame of drive(world, from, to, { ...opt, map, designMap: opt.designMap })) {
    last = frame;
    yield { ...frame, ...extra, done: false };
  }
  return last;
}
