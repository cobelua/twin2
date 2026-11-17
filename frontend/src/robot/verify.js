import { createCostmap } from './costmap.js';
import { approachCandidates, DEFAULT_DELIVERY } from './delivery.js';
import { cellIndex } from './gridMap.js';
import { costField } from './search.js';

// Kiểm chứng thiết kế bằng robot ảo (cách BMW kiểm chứng nhà máy ảo trước khi xây):
// với từng ô của từng kệ, robot đi được từ cửa kho tới chỗ đứng trước ô đó không, và xa bao nhiêu.
// Một ô kệ không tới được thì mọi khung của ô đó (mọi tầng, cả nóc) đều không dùng được với robot.
//
// Chỗ đứng trước ô dùng đúng approachCandidates của phần chở hàng, đường đi dùng đúng luật bước của A*:
// thứ kiểm chứng ở đây chính là thứ robot sẽ làm khi chở hàng thật, không phải một phép đo riêng.

/**
 * @param map bản đồ từ bản vẽ (mapFromLayout)
 * @param door chỗ robot nhận hàng ({x, y})
 * @param racks kệ của phòng (cùng dạng GET /api/rooms/{id})
 * @returns {{ bays: Array, summary }}
 *  bays: [{ rackCode, bay, reachable, distance, point, slots }] — distance: mét đi từ cửa (Infinity nếu không tới)
 *  summary: { bays, reachableBays, slots, reachableSlots, farthest, average, blockedRacks }
 */
export function verifyLayout(map, door, racks, options = {}) {
  const opt = { ...DEFAULT_DELIVERY, ...options };
  const cm = createCostmap(map, opt);
  const start = cellIndex(map, door.x, door.y);
  const dist = costField(map, start, { passable: (i) => !cm.blocked[i] });

  const bays = [];
  for (const rack of racks) {
    const slots = rack.levels + (rack.hasTop ? 1 : 0);   // số khung của một ô (mọi tầng + nóc), như Rack.CreateSlots
    for (let bay = 1; bay <= rack.bays; bay++) {
      let best = null;
      for (const point of approachCandidates(rack, { bay }, opt.robotRadius, opt.approachGaps)) {
        const i = cellIndex(map, point.x, point.y);
        if (i < 0 || cm.blocked[i] || !Number.isFinite(dist[i])) continue;
        if (!best || dist[i] < best.distance) best = { point, distance: dist[i] };
      }
      bays.push({ rackCode: rack.code, bay, reachable: best != null, distance: best?.distance ?? Infinity, point: best?.point ?? null, slots });
    }
  }

  const ok = bays.filter((b) => b.reachable);
  const farthest = ok.reduce((a, b) => (!a || b.distance > a.distance ? b : a), null);
  const blockedRacks = [...new Set(bays.filter((b) => !b.reachable).map((b) => b.rackCode))];
  return {
    bays,
    summary: {
      bays: bays.length,
      reachableBays: ok.length,
      slots: bays.reduce((s, b) => s + b.slots, 0),
      reachableSlots: ok.reduce((s, b) => s + b.slots, 0),
      farthest,
      average: ok.length ? ok.reduce((s, b) => s + b.distance, 0) / ok.length : 0,
      blockedRacks,
    },
  };
}
