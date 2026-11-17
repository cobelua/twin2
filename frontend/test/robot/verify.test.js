import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findStart } from '../../src/robot/explorer.js';
import { mapFromLayout } from '../../src/robot/mapFromLayout.js';
import { verifyLayout } from '../../src/robot/verify.js';
import { createWorld } from '../../src/robot/world.js';

const sample = JSON.parse(fs.readFileSync(new URL('../../../src/Warehouse.Api/SampleData/sample-layout.json', import.meta.url), 'utf8'));
const withFootprint = (r) => {
  const length = r.bays * r.bayWidth;
  return { ...r, footprintWidth: r.rotation === 90 ? r.depth : length, footprintDepth: r.rotation === 90 ? length : r.depth };
};
const racks = sample.racks.map(withFootprint);

function check(layoutRacks, obstacles = sample.obstacles) {
  const world = createWorld({ ...sample.room, racks: layoutRacks, obstacles });
  const door = findStart(world);
  return verifyLayout(mapFromLayout(world), door, layoutRacks);
}

describe('verifyLayout', () => {
  it('phòng mẫu: mọi ô kệ đều tới được, đếm đúng số khung', () => {
    const { summary } = check(racks);
    expect(summary.reachableBays).toBe(summary.bays);
    const expectedSlots = racks.reduce((s, r) => s + r.bays * (r.levels + (r.hasTop ? 1 : 0)), 0);
    expect(summary.slots).toBe(expectedSlots);
    expect(summary.reachableSlots).toBe(expectedSlots);
    expect(summary.farthest.distance).toBeGreaterThan(summary.average);
    expect(summary.blockedRacks).toEqual([]);
  });

  it('kệ bị bịt kín hai mặt (giữa hai tường sát rạt): báo không tới được', () => {
    const k1 = racks.find((r) => r.code === 'K1');
    const walls = [
      ...sample.obstacles,
      { kind: 'Wall', x: k1.x, y: k1.y - 0.4, width: 4.8, depth: 0.4 },
      { kind: 'Wall', x: k1.x, y: k1.y + 1, width: 4.8, depth: 0.4 },
    ];
    const { bays, summary } = check(racks, walls);
    expect(bays.filter((b) => b.rackCode === 'K1').every((b) => !b.reachable)).toBe(true);
    expect(summary.blockedRacks).toEqual(['K1']);
    expect(summary.reachableSlots).toBe(summary.slots - 4 * 3);   // K1: 4 ô × (2 tầng + nóc)
  });

  it('chỉ một mặt kệ bị chắn thì robot vòng sang mặt kia, vẫn tới được', () => {
    const k1 = racks.find((r) => r.code === 'K1');
    const { summary } = check(racks, [...sample.obstacles, { kind: 'Wall', x: k1.x, y: k1.y - 0.4, width: 4.8, depth: 0.4 }]);
    expect(summary.blockedRacks).toEqual([]);
  });
});
