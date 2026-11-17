import { describe, expect, it } from 'vitest';
import { exploreAll, findStart, floorCells } from '../../src/robot/explorer.js';
import { knownRatio } from '../../src/robot/gridMap.js';
import { castHeightRay, createHeightField, heightFieldWorld, sampleHeight } from '../../src/robot/heightField.js';
import { meshToHeightField } from '../../src/robot/meshToHeightField.js';
import { buildSampleWarehouse } from '../../src/robot/sampleWarehouse.js';
import { scan } from '../../src/robot/sensor.js';

/** Bản đồ độ cao 4 × 2 m, ô 5 cm, có một khối cao 2 m ở x 2–2,5 và một vật thấp 3 cm ở x 1–1,2. */
function strip() {
  const res = 0.05;
  const cols = 80;
  const rows = 40;
  const h = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * res;
      if (x > 2 && x < 2.5) h[r * cols + c] = 2;
      if (x > 1 && x < 1.2) h[r * cols + c] = 0.03;
    }
  }
  return createHeightField(4, 2, res, h);
}

describe('castHeightRay', () => {
  it('chạm khối cao: khoảng cách đúng tới mép, độ cao 2 m, vật thấp trên đường được ghi lại', () => {
    const r = castHeightRay(strip(), { x: 0.5, y: 1 }, 0, 6);
    expect(r.hit).toBe(true);
    expect(r.boundary).toBe(false);
    expect(r.distance).toBeCloseTo(1.5, 1);
    expect(r.height).toBe(2);
    expect(r.lows).toHaveLength(1);
    expect(r.lows[0].height).toBeCloseTo(0.03);
  });

  it('không có gì thì dừng ở mép phòng', () => {
    const r = castHeightRay(strip(), { x: 0.5, y: 1 }, Math.PI, 6);
    expect(r).toMatchObject({ hit: true, boundary: true });
    expect(r.distance).toBeCloseTo(0.5);
  });

  it('chân kệ mảnh vẫn ra chiều cao cả khối quanh nó', () => {
    const hf = createHeightField(2, 2, 0.05, new Float32Array(1600));
    hf.heights[20 * 40 + 20] = 0.4;   // một ô "chân" thấp hơn
    for (let r = 18; r <= 22; r++) hf.heights[r * 40 + 22] = 3;
    const ray = castHeightRay(hf, { x: 0.3, y: 1.025 }, 0, 5);
    expect(ray.height).toBe(3);
  });
});

describe('heightFieldWorld', () => {
  it('isClear: chỗ có vật hoặc sát mép thì không đặt robot được', () => {
    const w = heightFieldWorld(strip());
    expect(w.isClear(0.6, 1, 0.35)).toBe(true);
    expect(w.isClear(2.2, 1, 0.35)).toBe(false);
    expect(w.isClear(0.2, 1, 0.35)).toBe(false);
  });
});

describe('kho mẫu 3D → bản đồ độ cao → robot quét', () => {
  const { object, truth } = buildSampleWarehouse();
  const model = meshToHeightField(object);
  const world = heightFieldWorld(model.heightField);

  it('kích thước phòng lấy từ khối bao mô hình', () => {
    expect(model.width).toBeCloseTo(truth.width);
    expect(model.depth).toBeCloseTo(truth.depth);
  });

  it('độ cao: kệ A2 (4 tầng × 1 m) cao ~4,1 m, sàn 0, pallet rỗng 0,15 m', () => {
    expect(sampleHeight(model.heightField, 10, 2)).toBeCloseTo(4.125, 2);
    expect(sampleHeight(model.heightField, 7, 4)).toBeCloseTo(0, 6);
    expect(sampleHeight(model.heightField, 13.5, 10)).toBeCloseTo(0.15, 2);
  });

  it('đếm mặt ngang giữa kệ = số tầng + 1 (đáy mỗi tầng + nóc)', () => {
    for (const r of truth.racks.filter((k) => k.angle === 0)) {
      expect(model.surfacesAt(r.cx, r.cy)).toHaveLength(r.levels + 1);
    }
  });

  it('cảm biến dùng được bản đồ độ cao (qua world.castRay)', () => {
    const s = scan(world, { x: 7, y: 3.5 }, { rays: 36 });
    expect(s.readings.some((r) => r.hit && !r.boundary && r.height > 2)).toBe(true);
  });

  it('robot tự đi quét hết kho mẫu', () => {
    const start = findStart(world);
    expect(start).not.toBeNull();
    const result = exploreAll(world, start, { sensor: { rays: 72 } });
    expect(result.reason).toBe('explored');
    expect(knownRatio(result.map, floorCells(world, result.map))).toBeGreaterThan(0.95);
  }, 30000);
});
