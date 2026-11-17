import { describe, expect, it } from 'vitest';
import { DIGITIZE_EXPLORE, digitize } from '../../src/robot/digitize.js';
import { exploreAll, findStart } from '../../src/robot/explorer.js';
import { heightFieldWorld } from '../../src/robot/heightField.js';
import { meshToHeightField } from '../../src/robot/meshToHeightField.js';
import { buildSampleWarehouse } from '../../src/robot/sampleWarehouse.js';

// Đầu-cuối câu chuyện 2: kho mẫu 3D (không lấy từ bản vẽ nào) → robot tự quét → mặt bằng. So với đáp án của kho mẫu.
const { object, truth } = buildSampleWarehouse();
const model = meshToHeightField(object);
const world = heightFieldWorld(model.heightField);
const { map } = exploreAll(world, findStart(world), DIGITIZE_EXPLORE);
const layout = digitize(map, model);

const near = (a, b, tol) => Math.abs(a - b) <= tol + 1e-9;
const rackAt = (t) => layout.racks.find((r) => near(r.center.x, t.cx, 0.3) && near(r.center.y, t.cy, 0.3));

describe('số hoá kho mẫu', () => {
  it('đủ 5 kệ, không nhận tường bao làm vật cản', () => {
    expect(layout.racks).toHaveLength(truth.racks.length);
    expect(layout.obstacles.every((o) => o.x > 0.3 && o.y > 0.3)).toBe(true);
  });

  it('kệ thẳng trục: đúng vị trí (lệch ≤ 1 ô), đúng hướng, số tầng ĐẾM được khớp', () => {
    for (const t of truth.racks.filter((k) => k.angle % 90 === 0)) {
      const r = rackAt(t);
      expect(r, `không thấy kệ ${t.code}`).toBeDefined();
      expect(r.rotation).toBe(t.angle === 90 ? 90 : 0);
      expect(near(r.bays * r.bayWidth, t.length, 0.15)).toBe(true);
      expect(r.levelsCounted).toBe(true);
      expect(r.levels).toBe(t.levels);
      expect(r.levelHeight).toBeCloseTo(t.levelHeight, 1);
      expect(r.needsReview).toBe(false);
    }
  });

  it('kệ chéo 30°: nhận ra góc, làm tròn về 0°, giữ kích thước thật, đánh dấu cần xem lại', () => {
    const t = truth.racks.find((k) => k.angle === 30);
    const r = rackAt(t);
    expect(r).toBeDefined();
    expect(Math.abs(r.angle)).toBeGreaterThan(25);
    expect(Math.abs(r.angle)).toBeLessThan(35);
    expect(r.rotation).toBe(0);
    expect(near(r.bays * r.bayWidth, t.length, 0.3)).toBe(true);
    expect(r.levels).toBe(t.levels);
    expect(r.needsReview).toBe(true);
  });

  it('cột tròn được nhận là cột tròn, tường ngăn là tường, pallet rỗng 15 cm bị bỏ', () => {
    const col = layout.obstacles.find((o) => o.kind === 'Column');
    expect(col).toMatchObject({ round: true });
    expect(near(col.x + col.width / 2, truth.columns[0].x, 0.15)).toBe(true);
    const wall = layout.obstacles.find((o) => o.kind === 'Wall');
    expect(near(wall.width, truth.walls[0].width, 0.15)).toBe(true);
    const c = truth.clutter[0];
    const all = [...layout.obstacles, ...layout.racks.map((r) => ({ x: r.x, y: r.y, width: r.footprintWidth, depth: r.footprintDepth }))];
    expect(all.some((o) => o.x < c.x + 0.6 && o.x + o.width > c.x - 0.6 && o.y < c.y + 0.5 && o.y + o.depth > c.y - 0.5)).toBe(false);
  });
});
