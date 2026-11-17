import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { approachCandidates, deliver, describeDeliveryEvent } from '../../src/robot/delivery.js';
import { exploreAll, findStart } from '../../src/robot/explorer.js';
import { createWorld, withObstacle } from '../../src/robot/world.js';

const sample = JSON.parse(fs.readFileSync(new URL('../../../src/Warehouse.Api/SampleData/sample-layout.json', import.meta.url), 'utf8'));
// Trong test được tự tính footprint (ở src thì lấy từ server).
const racks = sample.racks.map((r) => {
  const length = r.bays * r.bayWidth;
  return { ...r, footprintWidth: r.rotation === 90 ? r.depth : length, footprintDepth: r.rotation === 90 ? length : r.depth };
});
const layout = { ...sample.room, racks, obstacles: sample.obstacles };
const world = createWorld(layout);
const door = findStart(world);
const scanned = exploreAll(world, door).map;
const rack = (code) => racks.find((r) => r.code === code);
const job = (code, bay, level = 1) => ({ rack: rack(code), slot: { bay, level, code: `${code}-T${level}-R${bay}` }, palletCode: `b1-P00${bay}`, slotCode: `${code}-T${level}-R${bay}` });

function runAll(w, jobs, options) {
  const frames = [...deliver(w, scanned, door, jobs, options)];
  return { frames, events: frames.flatMap((f) => f.events) };
}

describe('approachCandidates', () => {
  it('kệ không xoay: hai điểm trước và sau giữa ô, cách mặt kệ bán kính + 0,15 m', () => {
    const k1 = rack('K1');   // (1; 1), ô 1,2 m, sâu 1 m
    const [front, back] = approachCandidates(k1, { bay: 2 }, 0.35, [0.15]);
    expect(front.x).toBeCloseTo(1 + 1.8);
    expect(front.y).toBeCloseTo(1 - 0.5);
    expect(back.y).toBeCloseTo(1 + 1 + 0.5);
  });

  it('kệ xoay 90°: điểm nằm hai bên theo trục X', () => {
    const k8 = rack('K8');
    expect(k8.rotation).toBe(90);
    const [left, right] = approachCandidates(k8, { bay: 1 }, 0.35, [0.15]);
    expect(left.x).toBeCloseTo(k8.x - 0.5);
    expect(right.x).toBeCloseTo(k8.x + k8.depth + 0.5);
    expect(left.y).toBeCloseTo(k8.y + 0.5 * k8.bayWidth);
  });
});

describe('deliver', () => {
  it('chở hai pallet: đi, nâng, về; đặt đúng thứ tự server, cuối cùng về cửa', () => {
    const { frames, events } = runAll(world, [job('K2', 3), job('K8', 2)]);
    const placed = events.filter((e) => e.type === 'placed').map((e) => e.slotCode);
    expect(placed).toEqual(['K2-T1-R3', 'K8-T1-R2']);
    expect(frames.filter((f) => f.phase === 'lift')).toHaveLength(20);
    const last = frames.at(-1);
    expect(last.phase).toBe('done');
    expect(Math.hypot(last.pose.x - door.x, last.pose.y - door.y)).toBeLessThan(0.1);
  });

  it('lúc nâng, robot đứng sát trước đúng ô của khung', () => {
    const { frames } = runAll(world, [job('K2', 3)]);
    const lift = frames.find((f) => f.phase === 'lift');
    const k2 = rack('K2');
    expect(lift.pose.x).toBeGreaterThan(k2.x + 2 * k2.bayWidth);
    expect(lift.pose.x).toBeLessThan(k2.x + 3 * k2.bayWidth);
    const gapToFace = Math.min(Math.abs(lift.pose.y - k2.y), Math.abs(lift.pose.y - (k2.y + k2.depth)));
    expect(gapToFace).toBeLessThan(0.9);
  });

  it('không bao giờ chạm kệ, cột, tường', () => {
    const { frames } = runAll(world, [job('K3', 4), job('K7', 1)]);
    for (const f of frames) {
      const { x, y } = f.pose;
      expect(Math.min(x, y, world.width - x, world.depth - y), 'chạm tường bao').toBeGreaterThanOrEqual(0.3 - 1e-9);
      for (const b of world.boxes) {
        const dx = Math.max(b.x - f.pose.x, 0, f.pose.x - (b.x + b.width));
        const dy = Math.max(b.y - f.pose.y, 0, f.pose.y - (b.y + b.depth));
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(0.3 - 1e-9);
      }
    }
  });

  it('thùng rơi giữa lối đi: đi vòng, vẫn đặt được, nhật ký có quyết định', () => {
    // Lối đi giữa hàng K1–K3 và hàng K4–K6 (y 2–3), chắn ở x 6–6,6.
    const blocked = withObstacle(world, { x: 6, y: 2, width: 0.6, depth: 1, height: 0.5, label: 'Thùng rơi' });
    const { events } = runAll(blocked, [job('K2', 1)]);
    expect(events.some((e) => e.type === 'placed')).toBe(true);
    const detour = events.find((e) => e.type === 'detour');
    expect(detour).toBeDefined();
    // Báo độ cao của THÙNG (0,5 m), không phải của kệ K2 3,6 m nằm sát bên.
    expect(detour.height).toBeCloseTo(0.5);
    expect(events.map(describeDeliveryEvent).every((t) => t.length > 0)).toBe(true);
  });

  it('vật lạ thấy ở chuyến trước: chuyến sau vẫn ghi lý do đi vòng, kèm "nhớ từ chuyến trước"', () => {
    const blocked = withObstacle(world, { x: 6, y: 2, width: 0.6, depth: 1, height: 0.5, label: 'Thùng rơi' });
    const { events } = runAll(blocked, [job('K2', 1), job('K2', 1)]);
    const detours = events.filter((e) => e.type === 'detour');
    expect(detours.some((e) => !e.remembered)).toBe(true);    // chuyến đầu: thấy tận mắt
    const remembered = detours.find((e) => e.remembered);     // chuyến sau: nhớ, né ngay từ đầu
    expect(remembered).toBeDefined();
    expect(remembered.height).toBeCloseTo(0.5);
    expect(describeDeliveryEvent(remembered)).toMatch(/^Nhớ từ chuyến trước/);
  });

  it('khung bị bịt kín cả hai mặt: báo không tới được rồi làm tiếp pallet sau', () => {
    const k1 = rack('K1');
    const walled = withObstacle(
      withObstacle(world, { x: k1.x, y: k1.y - 0.9, width: 4.8, depth: 0.9, height: 2 }),
      { x: k1.x, y: k1.y + 1, width: 4.8, depth: 1, height: 2 },
    );
    const map = exploreAll(walled, door).map;
    const frames = [...deliver(walled, map, door, [job('K1', 2), job('K2', 1)])];
    const events = frames.flatMap((f) => f.events);
    expect(events.find((e) => e.type === 'noAccess')?.slotCode).toBe('K1-T1-R2');
    expect(events.filter((e) => e.type === 'placed').map((e) => e.slotCode)).toEqual(['K2-T1-R1']);
  });
});
