import { describe, expect, it } from 'vitest';
import { castRay, raySlab, scan } from '../../src/robot/sensor.js';
import { createWorld, withObstacle } from '../../src/robot/world.js';
import { room } from './fixtures.js';

const world = createWorld(room);
const RIGHT = 0;
const LEFT = Math.PI;

describe('castRay', () => {
  it('chạm cột phía trước: khoảng cách và độ cao đúng', () => {
    const r = castRay(world, { x: 5, y: 3.2 }, RIGHT, 6);
    expect(r.hit).toBe(true);
    expect(r.boundary).toBe(false);
    expect(r.distance).toBeCloseTo(1);
    expect(r.height).toBe(3);
  });

  it('không có vật thì dừng ở mép phòng và đánh dấu boundary', () => {
    const r = castRay(world, { x: 1, y: 5.5 }, LEFT, 6);
    expect(r).toMatchObject({ hit: true, boundary: true });
    expect(r.distance).toBeCloseTo(1);
  });

  it('mép phòng xa hơn tầm quét thì không chạm gì', () => {
    const r = castRay(world, { x: 0.5, y: 5.5 }, RIGHT, 6);
    expect(r).toMatchObject({ hit: false, boundary: false, height: null, distance: 6 });
  });

  it('vật thấp không chặn tia: thấy cả vật và phía sau', () => {
    const w = withObstacle(world, { x: 7, y: 5, width: 0.3, depth: 1, height: 0.03 });
    const r = castRay(w, { x: 5, y: 5.5 }, RIGHT, 6);
    expect(r.lows).toHaveLength(1);
    expect(r.lows[0].from).toBeCloseTo(2);
    expect(r.lows[0].to).toBeCloseTo(2.3);
    expect(r.lows[0].height).toBe(0.03);
    expect(r.boundary).toBe(true);          // tia vẫn đi tới tường phải
    expect(r.distance).toBeCloseTo(5);
  });

  it('vật cao chặn tia, vật thấp phía sau nó không được thấy', () => {
    const w = withObstacle(
      withObstacle(world, { x: 6, y: 5, width: 0.5, depth: 1, height: 0.5 }),
      { x: 8, y: 5, width: 0.3, depth: 1, height: 0.03 },
    );
    const r = castRay(w, { x: 5, y: 5.5 }, RIGHT, 6);
    expect(r.distance).toBeCloseTo(1);
    expect(r.height).toBe(0.5);
    expect(r.lows).toHaveLength(0);
  });

  it('tia chéo chạm góc kệ', () => {
    // Từ (1; 0) bắn chéo 45° xuống: gặp góc trên trái kệ K1 (2; 1) ở khoảng cách √2.
    const r = castRay(world, { x: 1, y: 0 }, Math.PI / 4, 6);
    expect(r.distance).toBeCloseTo(Math.SQRT2);
    expect(r.height).toBeCloseTo(3.6);
  });
});

describe('raySlab', () => {
  it('hộp sau lưng thì không cắt', () => {
    expect(raySlab({ x: 5, y: 3.2 }, -1, 0, { x: 6, y: 3, width: 0.4, depth: 0.4 })).toBeNull();
  });

  it('tia lướt dọc đúng mép hộp là sượt qua, không cắt', () => {
    expect(raySlab({ x: 0, y: 3.4 }, 1, 0, { x: 6, y: 3, width: 0.4, depth: 0.4 })).toBeNull();
  });

  it('tia đi qua đúng một góc hộp là sượt qua, không chặn', () => {
    // Từ (7,5; 2,3) góc 135° đi qua đúng góc dưới phải của cột (6,4; 3,4), rồi tới mép phòng.
    const r = castRay(world, { x: 7.5, y: 2.3 }, (3 * Math.PI) / 4, 10);
    expect(r.boundary).toBe(true);
  });

  it('tia song song nằm ngoài dải thì không cắt', () => {
    expect(raySlab({ x: 0, y: 0 }, 1, 0, { x: 6, y: 3, width: 0.4, depth: 0.4 })).toBeNull();
  });
});

describe('scan', () => {
  it('trả đúng số tia, góc chia đều', () => {
    const s = scan(world, { x: 5, y: 3.2 }, { rays: 8 });
    expect(s.readings).toHaveLength(8);
    expect(s.readings[2].angle).toBeCloseTo(Math.PI / 2);
  });

  it('robot ngoài phòng thì báo lỗi', () => {
    expect(() => scan(world, { x: -1, y: 2 })).toThrow(RangeError);
  });
});
