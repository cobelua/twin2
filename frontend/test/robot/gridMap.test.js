import { describe, expect, it } from 'vitest';
import { FREE, OCCUPIED, UNKNOWN, cellCenter, cellIndex, createGridMap, integrateScan, knownRatio } from '../../src/robot/gridMap.js';
import { scan } from '../../src/robot/sensor.js';
import { createWorld, withObstacle } from '../../src/robot/world.js';
import { room } from './fixtures.js';

const world = createWorld(room);
const robot = { x: 5, y: 3.2 };

function mapAfterScan(w = world, pose = robot) {
  const map = createGridMap(w.width, w.depth);
  integrateScan(map, scan(w, pose, { rays: 360 }));
  return map;
}
const stateAt = (map, x, y) => map.state[cellIndex(map, x, y)];

describe('createGridMap', () => {
  it('20 m / 0,1 m ra đúng 200 cột (không bị 201 vì sai số số thực)', () => {
    const map = createGridMap(20, 12, 0.1);
    expect(map.cols).toBe(200);
    expect(map.rows).toBe(120);
    expect(map.state.every((s) => s === UNKNOWN)).toBe(true);
  });

  it('cellIndex ngoài lưới trả -1, cellCenter là tâm ô', () => {
    const map = createGridMap(10, 6);
    expect(cellIndex(map, -0.01, 1)).toBe(-1);
    expect(cellIndex(map, 10.01, 1)).toBe(-1);
    const c = cellCenter(map, cellIndex(map, 2.34, 1.07));
    expect(c.x).toBeCloseTo(2.35);
    expect(c.y).toBeCloseTo(1.05);
  });
});

describe('integrateScan', () => {
  it('chỗ robot đứng là trống, cột là vật cao 3 m', () => {
    const map = mapAfterScan();
    expect(stateAt(map, 5, 3.2)).toBe(FREE);
    expect(stateAt(map, 6.05, 3.2)).toBe(OCCUPIED);
    expect(map.height[cellIndex(map, 6.05, 3.2)]).toBe(3);
  });

  it('vật không béo ra: quét từ nhiều phía, cột 0,4 m vẫn chỉ chiếm đúng 4 × 4 ô', () => {
    const map = createGridMap(world.width, world.depth);
    for (const pose of [{ x: 5, y: 3.2 }, { x: 7.5, y: 3.2 }, { x: 6.2, y: 4.5 }, { x: 6.2, y: 2.3 }, { x: 5, y: 4.5 }, { x: 7.5, y: 2.3 }]) {
      integrateScan(map, scan(world, pose, { rays: 720 }));
    }
    const around = [];
    for (let y = 2.85; y < 3.6; y += 0.1) for (let x = 5.85; x < 6.6; x += 0.1) around.push(stateAt(map, x, y) === OCCUPIED ? 1 : 0);
    // Vùng 8 × 8 ô quanh cột (5,8–6,6 × 2,8–3,6): chỉ 4 × 4 ô giữa (6,0–6,4 × 3,0–3,4) được là vật, và chỉ ô viền thấy được.
    for (let k = 0; k < around.length; k++) {
      const c = k % 8;
      const r = Math.floor(k / 8);
      if (c < 2 || c > 5 || r < 2 || r > 5) expect(around[k], `ô (${c}, ${r}) ngoài cột bị đánh dấu là vật`).toBe(0);
    }
  });

  it('phía sau cột bị khuất nên vẫn chưa biết', () => {
    expect(stateAt(mapAfterScan(), 7, 3.2)).toBe(UNKNOWN);
  });

  it('mép phòng không bị vẽ thành vật: ô sát tường trái vẫn là sàn', () => {
    expect(stateAt(mapAfterScan(), 0.05, 3.2)).toBe(FREE);
  });

  it('vật thấp được ghi độ cao, và phía sau nó vẫn thấy được', () => {
    const w = withObstacle(world, { x: 7, y: 5, width: 0.3, depth: 0.8, height: 0.03 });
    const map = mapAfterScan(w, { x: 5, y: 5.4 });
    const i = cellIndex(map, 7.15, 5.4);
    expect(map.state[i]).toBe(OCCUPIED);
    expect(map.height[i]).toBeCloseTo(0.03);
    expect(stateAt(map, 8, 5.4)).toBe(FREE);
  });

  it('ô đã là vật không bị lần quét sau đổi lại thành trống', () => {
    const map = mapAfterScan();
    const column = cellIndex(map, 6.05, 3.2);
    integrateScan(map, scan(world, { x: 5, y: 2.6 }, { rays: 360 }));
    expect(map.state[column]).toBe(OCCUPIED);
  });

  it('quét lại y hệt thì không ô nào đổi', () => {
    const map = mapAfterScan();
    expect(integrateScan(map, scan(world, robot, { rays: 360 }))).toEqual([]);
  });

  it('trả về các ô vừa đổi', () => {
    const map = createGridMap(10, 6);
    const changed = integrateScan(map, scan(world, robot, { rays: 36 }));
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((i) => map.state[i] !== UNKNOWN)).toBe(true);
  });
});

describe('knownRatio', () => {
  it('chưa quét là 0, quét rồi thì tăng', () => {
    const empty = createGridMap(10, 6);
    expect(knownRatio(empty)).toBe(0);
    expect(knownRatio(mapAfterScan())).toBeGreaterThan(0.3);
  });
});
