import { describe, expect, it } from 'vitest';
import { OBSTACLE_PRESETS, placeObstacle } from '../../src/robot/simObstacles.js';
import { createWorld, withObstacle } from '../../src/robot/world.js';
import { room } from './fixtures.js';

const world = createWorld(room);   // 10 × 6 m, kệ K1 (2; 1) 3 × 1 m, cột (6; 3) 0,4 m
const preset = (id) => OBSTACLE_PRESETS.find((p) => p.id === id);

describe('placeObstacle', () => {
  it('đặt theo tâm, hít lưới 0,1 m', () => {
    const { obstacle } = placeObstacle(world, preset('box'), { x: 8.03, y: 4.98 });
    expect(obstacle).toMatchObject({ x: 7.6, y: 4.6, width: 0.8, depth: 0.8, height: 0.5, label: 'Thùng rơi' });
  });

  it('xoay 90° đổi chỗ rộng / sâu', () => {
    const { obstacle } = placeObstacle(world, preset('wire'), { x: 5, y: 5 }, { rotated: true });
    expect(obstacle).toMatchObject({ width: 2, depth: 0.3 });
  });

  it('bấm sát mép thì kéo vào trong phòng', () => {
    const { obstacle } = placeObstacle(world, preset('box'), { x: 9.95, y: 5.95 });
    expect(obstacle.x + obstacle.width).toBeLessThanOrEqual(10 + 1e-9);
    expect(obstacle.y + obstacle.depth).toBeLessThanOrEqual(6 + 1e-9);
  });

  it('đè kệ, cột hay vật lạ khác thì báo lý do', () => {
    expect(placeObstacle(world, preset('box'), { x: 3, y: 1.5 }).reason).toBe('Đè lên kệ K1.');
    expect(placeObstacle(world, preset('box'), { x: 6.2, y: 3.2 }).reason).toBe('Đè lên cột.');
    const withBox = withObstacle(world, { x: 8, y: 4, width: 0.8, depth: 0.8, height: 0.5, label: 'Thùng rơi' });
    expect(placeObstacle(withBox, preset('box'), { x: 8.4, y: 4.4 }).reason).toBe('Đè lên thùng rơi.');
  });

  it('chạm cạnh kệ không tính là đè', () => {
    // Kệ K1 kết thúc ở x = 5; thùng 0,8 m tâm 5,4 → x 5,0 … 5,8, chạm đúng mép.
    expect(placeObstacle(world, preset('box'), { x: 5.4, y: 1.5 }).obstacle).toBeDefined();
  });

  it('không được chắn chỗ robot xuất phát', () => {
    const door = { x: 0.6, y: 3 };
    expect(placeObstacle(world, preset('box'), { x: 1.2, y: 3 }, { door }).reason).toMatch(/cửa kho/);
    expect(placeObstacle(world, preset('box'), { x: 3, y: 4.5 }, { door }).obstacle).toBeDefined();
  });
});
