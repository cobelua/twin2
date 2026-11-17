import { describe, expect, it } from 'vitest';
import { exploreAll } from '../../src/robot/explorer.js';
import { createCostmap } from '../../src/robot/costmap.js';
import { OCCUPIED, cellIndex, createGridMap } from '../../src/robot/gridMap.js';
import { compareOptions, describeEvent, drive, planRoute } from '../../src/robot/navigator.js';
import { createWorld, withObstacle } from '../../src/robot/world.js';

// Hành lang 12 × 5 m, tường giữa (x 2–10, y 2,4–2,6) chia hai làn: làn dưới y 0–2,4 và làn trên y 2,6–5.
// Robot đi làn dưới từ (1; 1,2) tới (11; 1,2): thẳng 10 m. Đi vòng qua làn trên dài thêm ~2,4 m (lên xuống chéo).
const corridor = createWorld({
  width: 12, depth: 5, racks: [],
  obstacles: [{ kind: 'Wall', x: 2, y: 2.4, width: 8, depth: 0.2 }],
});
const start = { x: 1.05, y: 1.25 };
const goal = { x: 11.05, y: 1.25 };
const wire = { x: 6, y: 0, width: 0.3, depth: 2.4, height: 0.03, label: 'Dây điện' };   // chắn ngang hết làn dưới
const box = { x: 6, y: 0, width: 0.5, depth: 2.4, height: 0.5, label: 'Thùng rơi' };

/** Bản đồ robot sau khi đi quét hành lang KHÔNG có vật lạ: đây là thứ robot biết khi bắt đầu chở hàng. */
const scannedMap = exploreAll(corridor, start).map;

/** Bản đồ vẽ tay: hành lang trên, cộng thêm ô vật (x, y, h). */
function mapWith(cells) {
  const map = { ...scannedMap, state: scannedMap.state.slice(), height: scannedMap.height.slice() };
  for (const [x, y, h] of cells) {
    const i = cellIndex(map, x, y);
    map.state[i] = OCCUPIED;
    map.height[i] = h;
  }
  return map;
}
const stripCells = (h) => {
  const cells = [];
  for (let y = 0.05; y < 2.4; y += 0.1) for (const x of [6.05, 6.15, 6.25]) cells.push([x, y, h]);
  return cells;
};
const at = (map, p) => cellIndex(map, p.x, p.y);

describe('planRoute / compareOptions', () => {
  it('không có vật: đi thẳng 10 m', () => {
    const cm = createCostmap(scannedMap);
    const r = planRoute(scannedMap, cm, at(scannedMap, start), at(scannedMap, goal));
    expect(r.length).toBeCloseTo(10, 1);
    expect(r.cost).toBeCloseTo(r.length);
  });

  it('vật thấp, phạt ×2: bước qua (rẻ hơn đi vòng); cost = dài + phạt', () => {
    const map = mapWith(stripCells(0.03));
    const cm = createCostmap(map);
    const { best, around, choice } = compareOptions(map, cm, at(map, start), at(map, goal), 2);
    expect(choice).toBe('cross');
    expect(best.length).toBeCloseTo(10, 1);
    // Dải 0,3 m + 2 × bán kính robot ≈ 1 m vùng phạt → phạt ≈ 2 m.
    expect(best.cost - best.length).toBeGreaterThan(1.5);
    expect(best.cost - best.length).toBeLessThan(2.5);
    expect(around.length).toBeGreaterThan(best.cost);
  });

  it('cùng vật thấp, phạt ×10: đi vòng', () => {
    const map = mapWith(stripCells(0.03));
    const cm = createCostmap(map);
    const { best, choice } = compareOptions(map, cm, at(map, start), at(map, goal), 10);
    expect(choice).toBe('around');
    expect(best.cells.every((i) => !cm.low[i] || cm.blocked[i])).toBe(true);
  });

  it('vật cao: không có đường bước qua, chỉ còn đi vòng', () => {
    const map = mapWith(stripCells(0.5));
    const cm = createCostmap(map);
    const r = planRoute(map, cm, at(map, start), at(map, goal));
    // Vòng qua làn trên: lên xuống chéo nên chỉ dài thêm ~2,4 m so với 10 m đi thẳng.
    expect(r.length).toBeGreaterThan(11);
    expect(r.cells.some((i) => cm.blocked[i])).toBe(false);
  });

  it('bậc tối đa 0,6 m: thùng 0,5 m thành vật thấp, bước qua được', () => {
    const map = mapWith(stripCells(0.5));
    const cm = createCostmap(map, { maxStep: 0.6 });
    expect(compareOptions(map, cm, at(map, start), at(map, goal), 2).choice).toBe('cross');
  });
});

describe('drive', () => {
  function run(world, options = {}) {
    const events = [];
    let last = null;
    const poses = [];
    for (const s of drive(world, start, goal, { map: scannedMap, ...options })) {
      events.push(...s.events);
      poses.push(s.pose);
      last = s;
    }
    return { last, events, poses };
  }

  it('không có vật lạ: tới đích, không quyết định gì', () => {
    const { last, events } = run(corridor);
    expect(last.reason).toBe('arrived');
    expect(events).toEqual([]);
  });

  it('dây điện chưa có trên bản đồ: thấy khi tới gần, bước qua, ghi quyết định một lần', () => {
    const { last, events, poses } = run(withObstacle(corridor, wire));
    expect(last.reason).toBe('arrived');
    const crosses = events.filter((e) => e.type === 'cross');
    expect(crosses).toHaveLength(1);
    expect(crosses[0].height).toBeCloseTo(0.03);
    expect(crosses[0].aroundLength).toBeGreaterThan(crosses[0].length + crosses[0].penalty);
    expect(poses.some((p) => p.x > 5.9 && p.x < 6.4 && p.y < 2.4)).toBe(true);   // đi ngang qua chỗ dây điện
    expect(describeEvent(crosses[0])).toMatch(/bước qua\.$/);
  });

  it('thùng rơi chưa có trên bản đồ: thấy rồi đi vòng làn trên, không chạm thùng', () => {
    const world = withObstacle(corridor, box);
    const { last, events, poses } = run(world);
    expect(last.reason).toBe('arrived');
    const detours = events.filter((e) => e.type === 'detour');
    expect(detours).toHaveLength(1);
    expect(detours[0].height).toBeCloseTo(0.5);
    expect(detours[0].newLength).toBeGreaterThan(detours[0].oldLength);
    expect(poses.some((p) => p.y > 2.6)).toBe(true);   // đã sang làn trên
    for (const p of poses) {
      const dx = Math.max(box.x - p.x, 0, p.x - (box.x + box.width));
      const dy = Math.max(box.y - p.y, 0, p.y - (box.y + box.depth));
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(0.3 - 1e-9);
    }
  });

  it('dây điện với phạt ×10: đi vòng và ghi lý do có số', () => {
    const { last, events } = run(withObstacle(corridor, wire), { lowPenalty: 10 });
    expect(last.reason).toBe('arrived');
    const avoid = events.find((e) => e.type === 'avoid');
    expect(avoid).toBeDefined();
    expect(avoid.crossCost).toBeGreaterThan(avoid.newLength);
    expect(describeEvent(avoid)).toMatch(/đi vòng\.$/);
  });

  it('chắn kín cả hai làn bằng vật cao: báo không tới được, không treo', () => {
    const world = withObstacle(withObstacle(corridor, box), { x: 6, y: 2.6, width: 0.5, depth: 2.4, height: 1, label: 'Thùng 2' });
    const { last } = run(world);
    expect(last.reason).toBe('unreachable');
  });

  it('bản đồ truyền vào không bị sửa', () => {
    const before = scannedMap.state.slice();
    run(withObstacle(corridor, box));
    expect(scannedMap.state).toEqual(before);
  });

  it('đích ngoài phòng thì báo lỗi', () => {
    expect(() => drive(corridor, start, { x: 20, y: 1 }).next()).toThrow(RangeError);
  });
});
