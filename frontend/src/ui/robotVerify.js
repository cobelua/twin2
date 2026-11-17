import { createCostmap } from '../robot/costmap.js';
import { findStart } from '../robot/explorer.js';
import { OCCUPIED, cellCenter, cellIndex } from '../robot/gridMap.js';
import { mapFromLayout } from '../robot/mapFromLayout.js';
import { planRoute } from '../robot/navigator.js';
import { verifyLayout } from '../robot/verify.js';
import { createWorld } from '../robot/world.js';
import { rackPoint } from '../scene3d/rackGeometry.js';
import { formatMeters } from './format.js';

// Chế độ "Kiểm chứng thiết kế" (câu chuyện 1, cách BMW/KION): robot ảo dùng BẢN VẼ ĐÃ LƯU làm bản đồ, tính đường từ
// cửa kho tới trước từng ô kệ. Ô xanh: tới được; ô đỏ: không (kệ bị chắn hai mặt, lối đi hẹp hơn thân robot).
// Vẽ thêm đường tới ô xa nhất. Mọi tính toán nằm ở src/robot/verify.js (có test); file này chỉ gọi và vẽ.

const COLORS = {
  outside: '#e9ecf1', floor: '#ffffff', solid: '#3b4252', rackFill: '#dbe7ff', rackEdge: '#2563eb',
  ok: 'rgba(31, 138, 76, 0.55)', bad: 'rgba(192, 57, 43, 0.75)', route: '#7c3aed', door: '#1f8a4c', text: '#1d2433',
};
const ROBOT_RADIUS = 0.35;

export function createRobotVerify(root) {
  root.innerHTML = `
    <div class="robot-toolbar">
      <button type="button" data-act="run">Kiểm chứng lại</button>
      <span class="hint">Robot ảo dùng bản vẽ đã lưu làm bản đồ (không đi quét), tính đường từ cửa kho tới trước từng ô kệ.</span>
    </div>
    <div class="robot-stats" data-stats></div>
    <div class="canvas-wrap robot-canvas"><canvas data-main></canvas></div>
    <div class="robot-result" data-result></div>
  `;
  const canvas = root.querySelector('[data-main]');
  const ctx = canvas.getContext('2d');
  const wrap = canvas.parentElement;
  const statsEl = root.querySelector('[data-stats]');
  const resultEl = root.querySelector('[data-result]');

  let layout = null;
  let key = null;
  let result = null;   // { map, door, check, route }
  let error = null;

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="run"]')) run();
  });
  new ResizeObserver(() => draw()).observe(wrap);

  function run() {
    error = null;
    result = null;
    try {
      const world = createWorld(layout);
      const door = findStart(world, ROBOT_RADIUS);
      if (!door) throw new Error('Phòng không còn chỗ trống nào đủ rộng để đặt robot ở cửa.');
      const map = mapFromLayout(world);
      const check = verifyLayout(map, door, layout.racks, { robotRadius: ROBOT_RADIUS });
      const far = check.summary.farthest;
      const route = far
        ? planRoute(map, createCostmap(map, { robotRadius: ROBOT_RADIUS }), cellIndex(map, door.x, door.y), cellIndex(map, far.point.x, far.point.y))
        : null;
      result = { map, door, check, route };
    } catch (err) {
      error = err.message;
    }
    render();
    draw();
  }

  function render() {
    if (error || !result) {
      statsEl.textContent = '';
      resultEl.innerHTML = `<p class="warn">${error ?? ''}</p>`;
      return;
    }
    const s = result.check.summary;
    const far = s.farthest;
    statsEl.textContent = `Robot tới được ${s.reachableBays}/${s.bays} ô kệ (${s.reachableSlots}/${s.slots} khung)`
      + (far ? ` · xa nhất ${far.rackCode} ô ${far.bay}: ${formatMeters(far.distance)} m · trung bình ${formatMeters(s.average)} m` : '');
    if (s.bays === 0) {
      resultEl.innerHTML = '<p class="hint">Kho chưa có kệ nào để kiểm chứng.</p>';
    } else if (s.blockedRacks.length === 0) {
      resultEl.innerHTML = '<p class="ok">Bố trí ổn: robot tới được trước mọi khung. Đường tím là đường tới ô xa nhất.</p>';
    } else {
      const lines = s.blockedRacks.map((code) => {
        const bad = result.check.bays.filter((b) => b.rackCode === code && !b.reachable);
        return `<li><strong>${code}</strong>: ${bad.length} ô (${bad.reduce((n, b) => n + b.slots, 0)} khung) robot không tới được</li>`;
      }).join('');
      resultEl.innerHTML = `<p class="warn">Có kệ robot không tới được (ô đỏ). Thường do kệ bị chắn cả hai mặt, hoặc lối đi hẹp hơn thân robot
        (${formatMeters(ROBOT_RADIUS * 2)} m). Sửa ở Mặt bằng → Lưu nháp → mở lại tab này.</p><ul>${lines}</ul>`;
    }
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(wrap.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(wrap.clientHeight * dpr));
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.outside;
    ctx.fillRect(0, 0, w, h);
    if (!layout || !result) return;

    const pad = 28;
    const s = Math.max(1, Math.min((w - 2 * pad) / layout.width, (h - 2 * pad) / layout.depth));
    const ox = (w - layout.width * s) / 2;
    const oy = (h - layout.depth * s) / 2;
    const X = (x) => ox + x * s;
    const Y = (y) => oy + y * s;

    // Bản đồ của robot (= bản vẽ): sàn trắng, vật xám đậm.
    const { map } = result;
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(X(0), Y(0), layout.width * s, layout.depth * s);
    ctx.fillStyle = COLORS.solid;
    for (let i = 0; i < map.state.length; i++) {
      if (map.state[i] !== OCCUPIED) continue;
      const c = cellCenter(map, i);
      ctx.fillRect(X(c.x - map.cellSize / 2), Y(c.y - map.cellSize / 2), map.cellSize * s + 0.5, map.cellSize * s + 0.5);
    }

    // Từng ô kệ: xanh tới được, đỏ không.
    ctx.font = '12px system-ui, sans-serif';
    for (const rack of layout.racks) {
      for (const b of result.check.bays.filter((x) => x.rackCode === rack.code)) {
        const a = rackPoint(rack, (b.bay - 1) * rack.bayWidth, 0);
        const z = rackPoint(rack, b.bay * rack.bayWidth, rack.depth);
        ctx.fillStyle = b.reachable ? COLORS.ok : COLORS.bad;
        ctx.fillRect(X(Math.min(a.x, z.x)) + 1, Y(Math.min(a.z, z.z)) + 1, Math.abs(z.x - a.x) * s - 2, Math.abs(z.z - a.z) * s - 2);
      }
      ctx.strokeStyle = COLORS.rackEdge;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(X(rack.x), Y(rack.y), rack.footprintWidth * s, rack.footprintDepth * s);
      ctx.fillStyle = COLORS.text;
      ctx.fillText(rack.code, X(rack.x) + 3, Y(rack.y) - 4);
    }

    // Đường tới ô xa nhất.
    if (result.route) {
      ctx.strokeStyle = COLORS.route;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      result.route.cells.forEach((cell, k) => {
        const c = cellCenter(map, cell);
        if (k === 0) ctx.moveTo(X(c.x), Y(c.y));
        else ctx.lineTo(X(c.x), Y(c.y));
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Cửa kho: chỗ robot nhận hàng.
    ctx.fillStyle = COLORS.door;
    ctx.beginPath();
    ctx.arc(X(result.door.x), Y(result.door.y), ROBOT_RADIUS * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText('Cửa kho', X(result.door.x) + ROBOT_RADIUS * s + 4, Y(result.door.y) + 4);
  }

  return {
    show(nextLayout) {
      const nextKey = nextLayout ? `${nextLayout.id}:${nextLayout.version}` : null;
      if (nextKey !== key) {
        key = nextKey;
        layout = nextLayout;
        if (layout) run();
      } else {
        draw();
      }
    },
    hide() {},
  };
}
