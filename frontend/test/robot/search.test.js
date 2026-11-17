import { describe, expect, it } from 'vitest';
import { cellIndex, createGridMap } from '../../src/robot/gridMap.js';
import { findPath, pathLength } from '../../src/robot/search.js';

const map = createGridMap(2, 2);   // 20 × 20 ô
const at = (x, y) => cellIndex(map, x, y);
const all = () => true;

describe('findPath', () => {
  it('đường thẳng ngang dài đúng khoảng cách', () => {
    const r = findPath(map, at(0.05, 0.05), { goal: at(1.05, 0.05), passable: all });
    expect(pathLength(map, r.cells)).toBeCloseTo(1);
    expect(r.cost).toBeCloseTo(1);
  });

  it('đi chéo được khi không vướng gì', () => {
    const r = findPath(map, at(0.05, 0.05), { goal: at(1.05, 1.05), passable: all });
    expect(r.cost).toBeCloseTo(Math.SQRT2);
  });

  it('không lách qua khe giữa hai ô chạm góc', () => {
    const wallA = at(0.15, 0.05);
    const wallB = at(0.05, 0.15);
    const r = findPath(map, at(0.05, 0.05), {
      goal: at(0.15, 0.15),
      passable: (i) => i !== wallA && i !== wallB,
    });
    expect(r).toBeNull();   // góc (0;0) bị bịt kín
  });

  it('vòng qua tường', () => {
    // Tường dọc ở cột x = 1 m, chừa khe ở hàng cuối.
    const wall = (i) => i % map.cols === 10 && Math.floor(i / map.cols) < 19;
    const r = findPath(map, at(0.55, 0.05), { goal: at(1.55, 0.05), passable: (i) => !wall(i) });
    expect(r).not.toBeNull();
    expect(pathLength(map, r.cells)).toBeGreaterThan(3);
  });

  it('ô đắt thì đi vòng nếu vòng rẻ hơn', () => {
    const expensive = at(0.55, 0.55);
    const r = findPath(map, at(0.35, 0.55), {
      goal: at(0.75, 0.55),
      passable: all,
      stepCost: (i) => (i === expensive ? 50 : 1),
    });
    expect(r.cells).not.toContain(expensive);
  });

  it('isGoal không có goal: ra ô đích gần nhất theo đường đi', () => {
    const near = at(0.35, 0.05);
    const far = at(1.95, 1.95);
    const r = findPath(map, at(0.05, 0.05), { isGoal: (i) => i === near || i === far, passable: all });
    expect(r.cells.at(-1)).toBe(near);
  });
});
