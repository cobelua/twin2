import { describe, expect, it } from 'vitest';
import { FREE, OCCUPIED, UNKNOWN, cellIndex } from '../../src/robot/gridMap.js';
import { mapFromLayout } from '../../src/robot/mapFromLayout.js';
import { createWorld } from '../../src/robot/world.js';
import { room } from './fixtures.js';

const map = mapFromLayout(createWorld(room));
const at = (x, y) => cellIndex(map, x, y);

describe('mapFromLayout', () => {
  it('không có ô chưa biết', () => {
    expect(map.state.includes(UNKNOWN)).toBe(false);
  });

  it('cột 0,4 m chiếm đúng 4 × 4 ô, cao 3 m', () => {
    let count = 0;
    for (let i = 0; i < map.state.length; i++) if (map.state[i] === OCCUPIED && map.height[i] === 3) count++;
    expect(count).toBe(16);
    expect(map.state[at(6.05, 3.05)]).toBe(OCCUPIED);
    expect(map.state[at(5.95, 3.05)]).toBe(FREE);   // sát mép trái cột: chạm cạnh không tính
    expect(map.state[at(6.45, 3.05)]).toBe(FREE);
  });

  it('kệ đặc ruột, cao = số tầng × chiều cao tầng', () => {
    const i = at(3.5, 1.5);
    expect(map.state[i]).toBe(OCCUPIED);
    expect(map.height[i]).toBeCloseTo(3.6);
  });

  it('vật không thẳng lưới 0,1 m: ô có một phần vật là ô vật', () => {
    const w = createWorld({ width: 4, depth: 4, racks: [], obstacles: [{ kind: 'Column', x: 1.05, y: 1.05, width: 0.4, depth: 0.4 }] });
    const m = mapFromLayout(w);
    const c = (x, y) => m.state[cellIndex(m, x, y)];
    expect(c(1.05, 1.05)).toBe(OCCUPIED);   // ô 1,0–1,1 có nửa cột
    expect(c(1.45, 1.45)).toBe(OCCUPIED);   // ô 1,4–1,5 có nửa cột
    expect(c(1.55, 1.25)).toBe(FREE);
  });
});
