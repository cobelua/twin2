import { describe, expect, it } from 'vitest';
import { createCostmap } from '../../src/robot/costmap.js';
import { createGridMap, FREE, OCCUPIED, cellIndex, knownRatio } from '../../src/robot/gridMap.js';
import { chooseFrontier, explore, exploreAll, floorCells, isFrontier } from '../../src/robot/explorer.js';
import { createWorld } from '../../src/robot/world.js';
import { room } from './fixtures.js';

const world = createWorld(room);
const start = { x: 0.6, y: 5.4 };

describe('isFrontier', () => {
  it('ô trống sát vùng chưa biết là biên, ô giữa vùng trống thì không', () => {
    const map = createGridMap(2, 2);
    for (let i = 0; i < map.state.length; i++) if (i % map.cols < 10) map.state[i] = FREE;   // nửa trái đã biết
    const cm = createCostmap(map);
    expect(isFrontier(map, cm, cellIndex(map, 0.95, 1.05))).toBe(true);
    expect(isFrontier(map, cm, cellIndex(map, 0.45, 1.05))).toBe(false);
  });

  it('ô sát vật cao (tâm robot không đứng được) không phải biên', () => {
    const map = createGridMap(2, 2);
    for (let i = 0; i < map.state.length; i++) if (i % map.cols < 10) map.state[i] = FREE;
    const wall = cellIndex(map, 0.85, 1.05);
    map.state[wall] = OCCUPIED;
    map.height[wall] = 3;
    const cm = createCostmap(map);
    expect(isFrontier(map, cm, cellIndex(map, 0.95, 1.05))).toBe(false);
  });
});

describe('chooseFrontier', () => {
  it('không còn biên thì trả null', () => {
    const map = createGridMap(1, 1);
    map.state.fill(FREE);
    const cm = createCostmap(map, { robotRadius: 0 });
    expect(chooseFrontier(map, cm, new Uint8Array(map.state.length), 0)).toBeNull();
  });
});

describe('explore', () => {
  const result = exploreAll(world, start);

  it('dừng vì hết biên, không phải vì hết giờ', () => {
    expect(result.done).toBe(true);
    expect(result.reason).toBe('explored');
  });

  it('thấy gần hết sàn thật', () => {
    expect(knownRatio(result.map, floorCells(world, result.map))).toBeGreaterThan(0.95);
  });

  it('robot không bao giờ chạm vật (tâm luôn cách vật ≥ bán kính − nửa ô)', () => {
    const minGap = 0.35 - 0.05 - 1e-9;
    for (const step of explore(world, start)) {
      const { x, y } = step.pose;
      expect(Math.min(x, y, world.width - x, world.depth - y), 'chạm tường bao').toBeGreaterThanOrEqual(minGap);
      for (const b of world.boxes) {
        const dx = Math.max(b.x - step.pose.x, 0, step.pose.x - (b.x + b.width));
        const dy = Math.max(b.y - step.pose.y, 0, step.pose.y - (b.y + b.depth));
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(minGap);
      }
    }
  });

  it('tất định: chạy hai lần ra cùng số nhịp và cùng quãng đường', () => {
    const again = exploreAll(world, start);
    expect(again.tick).toBe(result.tick);
    expect(again.distance).toBeCloseTo(result.distance);
  });

  it('kệ được ghi là vật cao trên bản đồ robot tự dựng', () => {
    const i = cellIndex(result.map, 3.5, 1.05);   // mép trên kệ K1
    expect(result.map.state[i]).toBe(OCCUPIED);
    expect(result.map.height[i]).toBeCloseTo(3.6);
  });

  it('robot bị nhốt trong ô nhỏ thì dừng ngay, không treo', () => {
    const boxed = createWorld({
      width: 10, depth: 6, racks: [],
      obstacles: [
        { kind: 'Wall', x: 0, y: 1.5, width: 2, depth: 0.2 },
        { kind: 'Wall', x: 2, y: 0, width: 0.2, depth: 1.7 },
      ],
    });
    const r = exploreAll(boxed, { x: 0.8, y: 0.7 });
    expect(r.reason).toBe('explored');
    expect(r.tick).toBeLessThan(200);
  });
});
