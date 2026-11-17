import { describe, expect, it } from 'vitest';
import { COLUMN_HEIGHT, WALL_HEIGHT, createWorld, withObstacle } from '../../src/robot/world.js';
import { room } from './fixtures.js';

describe('createWorld', () => {
  it('kệ thành hộp theo footprint của server, cao = số tầng × chiều cao tầng', () => {
    const rack = createWorld(room).boxes.find((b) => b.kind === 'rack');
    expect(rack).toMatchObject({ x: 2, y: 1, width: 3, depth: 1, label: 'K1' });
    expect(rack.height).toBeCloseTo(3.6);
  });

  it('kệ xoay 90° dùng đúng footprint server trả, không tự đổi chỗ', () => {
    const rotated = { ...room, racks: [{ ...room.racks[0], rotation: 90, footprintWidth: 1, footprintDepth: 3 }] };
    const rack = createWorld(rotated).boxes.find((b) => b.kind === 'rack');
    expect(rack).toMatchObject({ width: 1, depth: 3 });
  });

  it('cột và tường có chiều cao cố định', () => {
    const withWall = { ...room, obstacles: [...room.obstacles, { kind: 'Wall', x: 0, y: 5, width: 4, depth: 0.2 }] };
    const boxes = createWorld(withWall).boxes;
    expect(boxes.find((b) => b.kind === 'column').height).toBe(COLUMN_HEIGHT);
    expect(boxes.find((b) => b.kind === 'wall').height).toBe(WALL_HEIGHT);
  });

  it('phòng không có kích thước thì báo lỗi', () => {
    expect(() => createWorld({ width: 0, depth: 5 })).toThrow(RangeError);
  });
});

describe('withObstacle', () => {
  it('thêm vật cản giả lập mà không sửa thế giới cũ', () => {
    const world = createWorld(room);
    const next = withObstacle(world, { x: 7, y: 5, width: 0.3, depth: 1, height: 0.03, label: 'Dây điện' });
    expect(world.boxes).toHaveLength(2);
    expect(next.boxes).toHaveLength(3);
    expect(next.boxes[2]).toMatchObject({ kind: 'sim', label: 'Dây điện', height: 0.03 });
  });

  it('chiều cao ≤ 0 bị từ chối', () => {
    const world = createWorld(room);
    expect(() => withObstacle(world, { x: 1, y: 1, width: 1, depth: 1, height: 0 })).toThrow(/height/);
  });
});
