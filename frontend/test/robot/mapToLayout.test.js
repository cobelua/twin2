import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exploreAll } from '../../src/robot/explorer.js';
import { OCCUPIED, cellIndex, createGridMap } from '../../src/robot/gridMap.js';
import { findBlobs, mapToLayout } from '../../src/robot/mapToLayout.js';
import { createWorld, withObstacle } from '../../src/robot/world.js';

/** Vẽ tay một hình chữ nhật ô có vật (chỉ viền nếu hollow) lên lưới, độ cao h. */
function paint(map, x, y, w, d, h, hollow = false) {
  const cs = map.cellSize;
  for (let r = Math.round(y / cs); r < Math.round((y + d) / cs); r++) {
    for (let c = Math.round(x / cs); c < Math.round((x + w) / cs); c++) {
      const edge = r === Math.round(y / cs) || c === Math.round(x / cs)
        || r === Math.round((y + d) / cs) - 1 || c === Math.round((x + w) / cs) - 1;
      if (hollow && !edge) continue;
      const i = r * map.cols + c;
      map.state[i] = OCCUPIED;
      map.height[i] = h;
    }
  }
}

describe('mapToLayout trên lưới vẽ tay', () => {
  it('vòng ô rỗng ruột (cảm biến chỉ thấy mặt ngoài) thành một kệ đúng đáy', () => {
    const map = createGridMap(10, 6);
    paint(map, 2, 1, 4.8, 1, 3.6, true);
    const { racks, obstacles } = mapToLayout(map);
    expect(obstacles).toHaveLength(0);
    expect(racks).toHaveLength(1);
    expect(racks[0]).toMatchObject({ code: 'K1', x: 2, y: 1, rotation: 0, depth: 1, bays: 4, bayWidth: 1.2, levels: 3, needsReview: true });
    expect(racks[0].levelHeight).toBeCloseTo(1.2);
    expect(racks[0].bays * racks[0].bayWidth).toBeCloseTo(4.8);   // số ô đoán nhưng tổng chiều dài khớp số đo
  });

  it('kệ dài theo trục Y thành xoay 90°, footprint giữ nguyên số đo', () => {
    const map = createGridMap(10, 6);
    paint(map, 5, 0.5, 1, 3.6, 2.4, true);
    const [rack] = mapToLayout(map).racks;
    expect(rack).toMatchObject({ rotation: 90, depth: 1, bays: 3, footprintWidth: 1, footprintDepth: 3.6, levels: 2 });
  });

  it('khối nhỏ là cột, khối mảnh dài là tường', () => {
    const map = createGridMap(10, 6);
    paint(map, 6, 3, 0.4, 0.4, 3);
    paint(map, 0, 4, 4, 0.2, 3);
    const { obstacles, racks } = mapToLayout(map);
    expect(racks).toHaveLength(0);
    expect(obstacles).toEqual([
      { kind: 'Column', x: 6, y: 3, width: 0.4, depth: 0.4 },
      { kind: 'Wall', x: 0, y: 4, width: 4, depth: 0.2 },
    ]);
  });

  it('vật thấp bị bỏ, nhiễu lẻ vài ô bị bỏ và báo lại', () => {
    const map = createGridMap(10, 6);
    paint(map, 7, 5, 0.3, 1, 0.03);                 // dây điện
    const noise = cellIndex(map, 1.05, 1.05);
    map.state[noise] = OCCUPIED;
    map.height[noise] = 3;
    const result = mapToLayout(map);
    expect(result.racks).toHaveLength(0);
    expect(result.obstacles).toHaveLength(0);
    expect(result.ignored).toHaveLength(1);
  });

  it('ô chéo nhau vẫn cùng một khối (8 hướng)', () => {
    const map = createGridMap(1, 1);
    for (const [x, y] of [[0.05, 0.05], [0.15, 0.15], [0.25, 0.25]]) {
      const i = cellIndex(map, x, y);
      map.state[i] = OCCUPIED;
      map.height[i] = 3;
    }
    expect(findBlobs(map)).toHaveLength(1);
  });

  it('mã kệ đặt theo thứ tự trên xuống, trái sang', () => {
    const map = createGridMap(10, 6);
    paint(map, 6, 1, 3, 1, 2.4, true);
    paint(map, 1, 1, 3, 1, 2.4, true);
    paint(map, 1, 4, 3, 1, 2.4, true);
    expect(mapToLayout(map).racks.map((r) => [r.code, r.x, r.y])).toEqual([['K1', 1, 1], ['K2', 6, 1], ['K3', 1, 4]]);
  });
});

// Đầu-cuối: robot tự quét phòng mẫu thật của dự án, rồi so mặt bằng dựng lại với thiết kế gốc.
describe('quét phòng mẫu rồi dựng lại mặt bằng', () => {
  const sample = JSON.parse(fs.readFileSync(new URL('../../../src/Warehouse.Api/SampleData/sample-layout.json', import.meta.url), 'utf8'));
  // Trong test được tự tính footprint (ở src thì lấy từ server): dài = số ô × cỡ ô, xoay 90° đổi chỗ.
  const designRacks = sample.racks.map((r) => {
    const length = r.bays * r.bayWidth;
    return { ...r, footprintWidth: r.rotation === 90 ? r.depth : length, footprintDepth: r.rotation === 90 ? length : r.depth };
  });
  const world = withObstacle(
    createWorld({ ...sample.room, racks: designRacks, obstacles: sample.obstacles }),
    // Đồ trên sàn, nằm ở lối đi dưới kệ K7 (y 5–6): không được thành vật trong mặt bằng.
    { x: 3, y: 6.4, width: 0.3, depth: 0.8, height: 0.03, label: 'Dây điện' },
  );
  const { map } = exploreAll(world, { x: 0.6, y: sample.room.depth / 2 });
  const scanned = mapToLayout(map);

  it('đủ số kệ, cột, tường như thiết kế', () => {
    expect(scanned.racks).toHaveLength(designRacks.length);
    expect(scanned.obstacles.filter((o) => o.kind === 'Column')).toHaveLength(sample.obstacles.filter((o) => o.kind === 'Column').length);
    expect(scanned.obstacles.filter((o) => o.kind === 'Wall')).toHaveLength(sample.obstacles.filter((o) => o.kind === 'Wall').length);
  });

  it('mỗi kệ thiết kế có kệ quét được lệch ≤ 1 ô ở mỗi cạnh và cùng hướng xoay', () => {
    for (const d of designRacks) {
      const match = scanned.racks.find((s) => Math.abs(s.x - d.x) <= 0.1 + 1e-9 && Math.abs(s.y - d.y) <= 0.1 + 1e-9);
      expect(match, `không thấy kệ ${d.code}`).toBeDefined();
      expect(Math.abs(match.footprintWidth - d.footprintWidth)).toBeLessThanOrEqual(0.1 + 1e-9);
      expect(Math.abs(match.footprintDepth - d.footprintDepth)).toBeLessThanOrEqual(0.1 + 1e-9);
      expect(match.rotation).toBe(d.rotation);
      expect(match.measuredHeight).toBeCloseTo(d.levels * d.levelHeight, 2);
    }
  });

  it('mỗi cột, tường thiết kế có vật quét được cùng loại, lệch ≤ 1 ô', () => {
    const near = (a, b) => Math.abs(a - b) <= 0.1 + 1e-9;
    for (const d of sample.obstacles) {
      const match = scanned.obstacles.find((s) => s.kind === d.kind && near(s.x, d.x) && near(s.y, d.y)
        && near(s.width, d.width) && near(s.depth, d.depth));
      expect(match, `không thấy ${d.kind} ở (${d.x}; ${d.y})`).toBeDefined();
    }
  });

  it('đồ trên sàn (dây điện 3 cm) không thành vật trong mặt bằng', () => {
    const all = [...scanned.racks.map((r) => ({ x: r.x, y: r.y, width: r.footprintWidth, depth: r.footprintDepth })), ...scanned.obstacles];
    expect(all.some((o) => o.x < 3.3 && o.x + o.width > 3 && o.y < 7.2 && o.y + o.depth > 6.4)).toBe(false);
  });
});
