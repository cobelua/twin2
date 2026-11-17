// Phòng nhỏ dùng chung cho test robot, cùng dạng GET /api/rooms/{id}.
// 10 × 6 m; kệ K1 ở (2; 1) dài 3 m sâu 1 m cao 3,6 m; cột 0,4 m ở (6; 3).
export const room = {
  width: 10,
  depth: 6,
  racks: [
    {
      code: 'K1', x: 2, y: 1, rotation: 0, levels: 3, levelHeight: 1.2, bays: 2, bayWidth: 1.5, depth: 1,
      hasTop: true, footprintWidth: 3, footprintDepth: 1,
    },
  ],
  obstacles: [{ kind: 'Column', x: 6, y: 3, width: 0.4, depth: 0.4 }],
};
