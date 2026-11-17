import { describe, expect, it } from 'vitest';
import { createCostmap, isLow, setMaxStep, updateCostmap } from '../../src/robot/costmap.js';
import { OCCUPIED, cellIndex, createGridMap } from '../../src/robot/gridMap.js';

function mapWith(cells) {
  const map = createGridMap(4, 4);
  const changed = [];
  for (const { x, y, h } of cells) {
    const i = cellIndex(map, x, y);
    map.state[i] = OCCUPIED;
    map.height[i] = h;
    changed.push(i);
  }
  return { map, changed };
}

describe('costmap', () => {
  it('vật cao phình ra bằng bán kính robot', () => {
    const { map } = mapWith([{ x: 2.05, y: 2.05, h: 3 }]);
    const cm = createCostmap(map, { robotRadius: 0.35 });
    expect(cm.blocked[cellIndex(map, 2.35, 2.05)]).toBe(1);   // cách 3 ô: trong bán kính 3,5 ô
    expect(cm.blocked[cellIndex(map, 2.45, 2.05)]).toBe(0);   // cách 4 ô: ngoài
    expect(cm.blocked[cellIndex(map, 2.35, 2.35)]).toBe(0);   // chéo 3 ô ≈ 4,2 ô: ngoài
  });

  it('vật thấp chỉ đánh dấu low, không chặn', () => {
    const { map } = mapWith([{ x: 2.05, y: 2.05, h: 0.03 }]);
    const cm = createCostmap(map);
    const i = cellIndex(map, 2.05, 2.05);
    expect(cm.blocked[i]).toBe(0);
    expect(isLow(cm, i)).toBe(true);
  });

  it('vật cao đúng bằng bậc tối đa vẫn bước qua được (dù lưu Float32)', () => {
    const { map } = mapWith([{ x: 2.05, y: 2.05, h: 0.05 }]);
    const cm = createCostmap(map, { maxStep: 0.05 });
    expect(cm.blocked[cellIndex(map, 2.05, 2.05)]).toBe(0);
  });

  it('đổi bậc tối đa thì vật thấp thành vật cao', () => {
    const { map } = mapWith([{ x: 2.05, y: 2.05, h: 0.03 }]);
    const cm = createCostmap(map, { maxStep: 0.05 });
    setMaxStep(cm, map, 0.02);
    expect(cm.blocked[cellIndex(map, 2.05, 2.05)]).toBe(1);
  });

  it('mép phòng là tường bao: dải sát mép rộng bằng bán kính robot bị cấm', () => {
    const map = createGridMap(4, 4);
    const cm = createCostmap(map, { robotRadius: 0.35 });
    expect(cm.blocked[cellIndex(map, 0.05, 2)]).toBe(1);
    expect(cm.blocked[cellIndex(map, 0.25, 2)]).toBe(1);
    expect(cm.blocked[cellIndex(map, 0.35, 2)]).toBe(0);   // tâm ô 0,35 m: vừa đúng bán kính
    expect(cm.blocked[cellIndex(map, 3.95, 3.95)]).toBe(1);
  });

  it('updateCostmap chỉ đóng dấu các ô vừa đổi', () => {
    const map = createGridMap(4, 4);
    const cm = createCostmap(map);
    const i = cellIndex(map, 1.05, 1.05);
    map.state[i] = OCCUPIED;
    map.height[i] = 2;
    updateCostmap(cm, map, [i]);
    expect(cm.blocked[i]).toBe(1);
  });
});
