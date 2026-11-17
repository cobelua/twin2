import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { isTall } from '../robot/costmap.js';
import { DIGITIZE_EXPLORE, digitize } from '../robot/digitize.js';
import { explore, findStart, floorCells } from '../robot/explorer.js';
import { FREE, OCCUPIED, cellCenter, knownRatio } from '../robot/gridMap.js';
import { heightFieldWorld } from '../robot/heightField.js';
import { meshToHeightField } from '../robot/meshToHeightField.js';
import { buildSampleWarehouse } from '../robot/sampleWarehouse.js';
import { createRoomFromScan } from '../state/actions.js';
import { showMessage } from '../state/store.js';
import { formatMeters } from './format.js';

// Chế độ "Số hoá kho cũ" (câu chuyện 2, kiểu Boston Dynamics Spot đi quét nhà máy có sẵn):
// thả một kho 3D (kho mẫu dựng bằng code, hoặc file .glb) đóng vai KHO THẬT CHƯA CÓ BẢN VẼ. Robot không biết gì,
// tự đi quét, đếm tầng kệ, rồi ra mặt bằng để tạo kho mới trong app. Không dùng bản vẽ nào của app.
// Logic ở src/robot/ (có test); file này chỉ dựng cảnh, gọi explore() theo nhịp và vẽ.

const TICKS_PER_SECOND = 20;     // 1 nhịp = 1 ô 5 cm → ×1 là 1 m/s
const CONVERT_EVERY = 20;        // nhận dạng lại mặt bằng mỗi 20 nhịp (vẽ song song lúc quét)
const MAX_TICKS_PER_FRAME = 400;
const ROBOT_RADIUS = 0.35;
const COLORS = {
  outside: '#e9ecf1', unknown: '#cfd4dd', free: '#ffffff', tall: '#3b4252', low: '#f59e0b',
  rack: '#2563eb', rackFill: 'rgba(37, 99, 235, 0.12)', tilted: '#c2410c', obstacle: '#6b7385', path: '#1f8a4c', target: '#7c3aed', robot: '#2563eb',
};

export function createRobotDigitize(root) {
  root.innerHTML = `
    <div class="robot-toolbar">
      <button type="button" data-act="sample">Dùng kho mẫu</button>
      <label class="robot-file">Thả file kho 3D (.glb) <input type="file" accept=".glb,.gltf,model/gltf-binary" data-file></label>
      <span class="robot-sep"></span>
      <button type="button" data-act="play" disabled>Bắt đầu quét</button>
      <button type="button" data-act="restart" disabled>Chạy lại</button>
      <span class="robot-speed">Tốc độ
        <button type="button" data-speed="1">×1</button>
        <button type="button" data-speed="2">×2</button>
        <button type="button" data-speed="4" aria-pressed="true">×4</button>
        <button type="button" data-speed="8">×8</button>
      </span>
      <label><input type="checkbox" data-show="model" checked> Mô hình gốc</label>
    </div>
    <div class="robot-stats" data-stats>Chọn kho mẫu hoặc thả file .glb (đơn vị mét, trục Y hướng lên).</div>
    <div class="robot-split">
      <div class="canvas-wrap robot-canvas" data-view3d></div>
      <div class="canvas-wrap robot-canvas"><canvas data-map></canvas></div>
    </div>
    <div class="robot-result" data-result></div>
  `;
  const $ = (sel) => root.querySelector(sel);
  const view3d = $('[data-view3d]');
  const mapCanvas = $('[data-map]');
  const mctx = mapCanvas.getContext('2d');
  const statsEl = $('[data-stats]');
  const resultEl = $('[data-result]');

  // ---------- cảnh 3D ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  view3d.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef1f5);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(10, 25, 8);
  scene.add(sun);
  const robot = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(ROBOT_RADIUS, ROBOT_RADIUS, 0.3, 24), new THREE.MeshStandardMaterial({ color: 0x2563eb }));
  body.position.y = 0.15;
  robot.add(body);
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.06), new THREE.MeshStandardMaterial({ color: 0x0c447c }));
  mast.position.y = 1.0;
  robot.add(mast);
  robot.visible = false;
  scene.add(robot);
  const rays = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.25 }));
  scene.add(rays);
  const rebuilt = new THREE.Group();
  scene.add(rebuilt);

  // ---------- trạng thái ----------
  let source = null;      // { name, object, model, world, truth? }
  let run = null;
  let step = null;
  let pose = null;
  let prevPose = null;
  let distance = 0;
  let floor = null;
  let layout = null;      // mặt bằng nhận ra
  let mapImage = null;
  let running = false;
  let finished = false;
  let speed = 4;
  let pending = 0;
  let active = false;
  let lastFrame = 0;
  let creating = false;

  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const sp = e.target.closest('[data-speed]')?.dataset.speed;
    if (sp) {
      speed = Number(sp);
      root.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.speed === sp)));
    } else if (act === 'sample') {
      const { object, truth } = buildSampleWarehouse();
      load('Kho mẫu', object, truth);
    } else if (act === 'play' && run && !finished) {
      running = !running;
    } else if (act === 'restart' && source) {
      reset();
      running = true;
    } else if (act === 'create' && layout && !creating) {
      creating = true;
      renderResult();
      try {
        await createRoomFromScan(layout, { name: source.name, gridSize: 0.5, minGap: 0.5, margin: 0.05 });
      } catch (err) {
        showMessage(err.message, 'error');
      } finally {
        creating = false;
        renderResult();
      }
    }
    renderControls();
  });
  root.addEventListener('change', (e) => {
    if (e.target.dataset.show === 'model' && source) source.object.visible = e.target.checked;
    if (e.target.matches('[data-file]') && e.target.files[0]) loadFile(e.target.files[0]);
  });
  new ResizeObserver(() => resize()).observe(view3d);

  async function loadFile(file) {
    try {
      const buffer = await file.arrayBuffer();
      const gltf = await new GLTFLoader().parseAsync(buffer, '');
      load(file.name.replace(/\.(glb|gltf)$/i, ''), gltf.scene, null);
    } catch (err) {
      statsEl.textContent = `Không đọc được file: ${err.message}`;
    }
  }

  /** Nhận một kho 3D: chiếu thành bản đồ độ cao (phần "phần cứng" của cảm biến), đặt camera, sẵn sàng quét. */
  function load(name, object, truth) {
    if (source) scene.remove(source.object);
    source = null;
    run = null;
    renderControls();
    statsEl.textContent = 'Đang chiếu mô hình thành bản đồ độ cao (vài giây)…';
    // Chiếu mô hình mất vài giây và chặn trang: đợi trình duyệt vẽ xong dòng chữ trên rồi mới bắt đầu.
    setTimeout(() => prepare(name, object, truth), 50);
  }

  function prepare(name, object, truth) {
    try {
      const model = meshToHeightField(object);
      scene.add(object);
      source = { name, object, model, world: heightFieldWorld(model.heightField), truth };
      object.visible = $('[data-show="model"]').checked;
      const size = Math.max(model.width, model.depth);
      controls.target.set(model.origin.x + model.width / 2, 0, model.origin.z + model.depth / 2);
      camera.position.set(controls.target.x + size * 0.6, size * 0.75, controls.target.z + size * 0.85);
      camera.far = size * 10;
      camera.updateProjectionMatrix();
      controls.update();
      reset();
    } catch (err) {
      source = null;
      statsEl.textContent = err.message;
    }
    renderControls();
  }

  function reset() {
    running = false;
    finished = false;
    step = null;
    layout = null;
    distance = 0;
    pending = 0;
    floor = null;
    mapImage = null;
    clearRebuilt();
    const start = findStart(source.world, ROBOT_RADIUS);
    if (!start) {
      run = null;
      statsEl.textContent = 'Kho không còn chỗ trống nào đủ rộng để đặt robot.';
      return;
    }
    pose = start;
    prevPose = start;
    run = explore(source.world, start, { ...DIGITIZE_EXPLORE, robotRadius: ROBOT_RADIUS });
    robot.visible = true;
    renderResult();
  }

  function tick() {
    const next = run.next();
    if (next.done) return finish();
    step = next.value;
    prevPose = pose;
    pose = step.pose;
    distance += Math.hypot(pose.x - prevPose.x, pose.y - prevPose.y);
    floor ??= floorCells(source.world, step.map);
    paintCells(step.changed);
    if (step.tick % CONVERT_EVERY === 0) layout = digitize(step.map, source.model);
    if (step.done) finish();
  }

  function finish() {
    running = false;
    finished = true;
    if (step) layout = digitize(step.map, source.model);
    prevPose = pose;
    showRebuilt();
    renderControls();
    renderResult();
  }

  function frame(time) {
    if (!active) return;
    const dt = lastFrame ? Math.min(0.1, (time - lastFrame) / 1000) : 0;
    lastFrame = time;
    if (running && run) {
      pending += dt * TICKS_PER_SECOND * speed;
      let n = 0;
      while (pending >= 1 && running && n < MAX_TICKS_PER_FRAME) {
        tick();
        pending -= 1;
        n++;
      }
      if (n === MAX_TICKS_PER_FRAME) pending = 0;
    }
    drawRobot(running ? Math.min(1, pending) : 1);
    drawMap();
    renderStats();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // ---------- vẽ ----------

  const toScene = (p, y = 0) => new THREE.Vector3(source.model.origin.x + p.x, y, source.model.origin.z + p.y);

  function drawRobot(frac) {
    if (!source || !pose) return;
    const p = { x: prevPose.x + (pose.x - prevPose.x) * frac, y: prevPose.y + (pose.y - prevPose.y) * frac };
    robot.position.copy(toScene(p));
    const scan = step?.scan;
    rays.visible = !!scan && !finished;
    if (scan) {
      const pts = [];
      for (const r of scan.readings) {
        if (r.angle % 0.1 > 0.06) continue;   // vẽ thưa cho đỡ rối
        const a = toScene(scan.origin, 1.0);
        const b = toScene({ x: scan.origin.x + Math.cos(r.angle) * r.distance, y: scan.origin.y + Math.sin(r.angle) * r.distance }, 1.0);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      rays.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    }
  }

  function paintCells(cells) {
    const map = step.map;
    if (!mapImage) {
      mapImage = document.createElement('canvas');
      mapImage.width = map.cols;
      mapImage.height = map.rows;
      const m = mapImage.getContext('2d');
      m.fillStyle = COLORS.unknown;
      m.fillRect(0, 0, map.cols, map.rows);
    }
    const m = mapImage.getContext('2d');
    for (const i of cells) {
      const s = map.state[i];
      m.fillStyle = s === FREE ? COLORS.free : s === OCCUPIED ? (isTall(step.costmap, map.height[i]) ? COLORS.tall : COLORS.low) : COLORS.unknown;
      m.fillRect(i % map.cols, Math.floor(i / map.cols), 1, 1);
    }
  }

  function drawMap() {
    const wrap = mapCanvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (mapCanvas.width !== Math.round(w * dpr) || mapCanvas.height !== Math.round(h * dpr)) {
      mapCanvas.width = Math.round(w * dpr);
      mapCanvas.height = Math.round(h * dpr);
    }
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mctx.fillStyle = COLORS.outside;
    mctx.fillRect(0, 0, w, h);
    if (!source) return;
    const W = source.model.width;
    const D = source.model.depth;
    const pad = 16;
    const s = Math.max(1, Math.min((w - 2 * pad) / W, (h - 2 * pad) / D));
    const ox = (w - W * s) / 2;
    const oy = (h - D * s) / 2;
    const X = (x) => ox + x * s;
    const Y = (y) => oy + y * s;

    if (mapImage) {
      mctx.imageSmoothingEnabled = false;
      const cs = step.map.cellSize;
      mctx.drawImage(mapImage, X(0), Y(0), step.map.cols * cs * s, step.map.rows * cs * s);
    } else {
      mctx.fillStyle = COLORS.unknown;
      mctx.fillRect(X(0), Y(0), W * s, D * s);
    }

    mctx.font = '12px system-ui, sans-serif';
    if (layout) {
      for (const r of layout.racks) {
        if (Math.abs(r.angle - r.rotation) > 5 && r.angle !== r.rotation) drawTilted(mctx, r, X, Y, s);
        mctx.fillStyle = COLORS.rackFill;
        mctx.fillRect(X(r.x), Y(r.y), r.footprintWidth * s, r.footprintDepth * s);
        mctx.strokeStyle = COLORS.rack;
        mctx.lineWidth = 2;
        mctx.strokeRect(X(r.x), Y(r.y), r.footprintWidth * s, r.footprintDepth * s);
        mctx.fillStyle = COLORS.rack;
        mctx.fillText(`${r.code} · ${r.levels} tầng`, X(r.x) + 3, Y(r.y) - 4);
      }
      mctx.strokeStyle = COLORS.obstacle;
      for (const o of layout.obstacles) mctx.strokeRect(X(o.x), Y(o.y), o.width * s, o.depth * s);
    }
    if (step?.path && step.pathIndex < step.path.length) {
      mctx.strokeStyle = COLORS.path;
      mctx.lineWidth = 2;
      mctx.setLineDash([5, 4]);
      mctx.beginPath();
      mctx.moveTo(X(pose.x), Y(pose.y));
      for (let k = step.pathIndex; k < step.path.length; k += 2) {
        const c = cellCenter(step.map, step.path[k]);
        mctx.lineTo(X(c.x), Y(c.y));
      }
      mctx.stroke();
      mctx.setLineDash([]);
    }
    if (pose && !finished) {
      mctx.fillStyle = COLORS.robot;
      mctx.beginPath();
      mctx.arc(X(robot.position.x - source.model.origin.x), Y(robot.position.z - source.model.origin.z), ROBOT_RADIUS * s, 0, Math.PI * 2);
      mctx.fill();
    }
  }

  /** Kệ chéo: vẽ thêm hình chữ nhật theo hướng THẬT (nét đứt cam) cạnh hình đã làm tròn về 0°/90°. */
  function drawTilted(ctx, r, X, Y, s) {
    const length = r.bays * r.bayWidth;
    ctx.save();
    ctx.translate(X(r.center.x), Y(r.center.y));
    ctx.rotate((r.angle * Math.PI) / 180);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = COLORS.tilted;
    ctx.lineWidth = 2;
    ctx.strokeRect((-length / 2) * s, (-r.depth / 2) * s, length * s, r.depth * s);
    ctx.restore();
    ctx.setLineDash([]);
  }

  function clearRebuilt() {
    rebuilt.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    rebuilt.clear();
  }

  /** Kho dựng lại: khối xanh trong suốt chồng lên mô hình gốc để so (tắt "Mô hình gốc" để chỉ xem bản dựng lại). */
  function showRebuilt() {
    clearRebuilt();
    if (!layout) return;
    for (const r of layout.racks) {
      const height = r.levels * r.levelHeight;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(r.footprintWidth, height, r.footprintDepth),
        new THREE.MeshStandardMaterial({ color: 0x2563eb, transparent: true, opacity: 0.3 }));
      mesh.position.copy(toScene({ x: r.x + r.footprintWidth / 2, y: r.y + r.footprintDepth / 2 }, height / 2));
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x0c447c })));
      rebuilt.add(mesh);
    }
    for (const o of layout.obstacles) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.width, 3, o.depth), new THREE.MeshStandardMaterial({ color: 0x6b7385, transparent: true, opacity: 0.35 }));
      mesh.position.copy(toScene({ x: o.x + o.width / 2, y: o.y + o.depth / 2 }, 1.5));
      rebuilt.add(mesh);
    }
    robot.visible = false;
  }

  // ---------- chữ ----------

  function renderStats() {
    if (!source) return;
    const cover = step && floor ? knownRatio(step.map, floor) : 0;
    const counts = layout ? `${layout.racks.length} kệ, ${layout.obstacles.filter((o) => o.kind === 'Column').length} cột, ${layout.obstacles.filter((o) => o.kind === 'Wall').length} tường` : 'chưa có';
    const text = `${source.name} ${formatMeters(source.model.width)} × ${formatMeters(source.model.depth)} m · đã quét ${Math.round(cover * 100)}% sàn · đi ${formatMeters(distance)} m · nhận ra: ${counts}`;
    if (statsEl.textContent !== text) statsEl.textContent = text;
  }

  function renderControls() {
    const play = $('[data-act="play"]');
    play.textContent = finished ? 'Đã quét xong' : running ? 'Tạm dừng' : step ? 'Chạy tiếp' : 'Bắt đầu quét';
    play.disabled = !run || finished;
    $('[data-act="restart"]').disabled = !source;
  }

  function renderResult() {
    if (!finished || !layout) {
      resultEl.innerHTML = source
        ? '<p class="hint">Robot không biết gì về kho này: nó chỉ thấy qua cảm biến, tự đi tới vùng chưa biết gần nhất cho tới khi hết chỗ để nhìn. Bản đồ bên phải là thứ robot tự vẽ.</p>'
        : '';
      return;
    }
    const truth = source.truth;
    const rows = layout.racks.map((r) => {
      const t = truth?.racks.reduce((best, k) => (!best || dist(k, r) < dist(best, r) ? k : best), null);
      const tilted = Math.abs(r.angle - r.rotation) > 5;
      const note = tilted
        ? `<span class="warn">Đặt chéo ${Math.round(Math.abs(r.angle))}°: app chỉ nhận 0°/90° → làm tròn về ${r.rotation}°</span>`
        : r.levelsCounted ? '<span class="ok">Số tầng đếm được</span>' : '<span class="warn">Số tầng là đoán</span>';
      return `<tr><td>${r.code}</td><td>${formatMeters(r.bays * r.bayWidth)} × ${formatMeters(r.depth)} m, ${r.levels} tầng × ${formatMeters(r.levelHeight)} m</td>`
        + (truth ? `<td>${t ? `${t.code}: ${formatMeters(t.length)} × ${formatMeters(t.depth)} m, ${t.levels} tầng` : '—'}</td>` : '')
        + `<td>${note}</td></tr>`;
    }).join('');
    const others = layout.obstacles.map((o) => `<tr><td>${o.kind === 'Column' ? 'Cột' : 'Tường'}</td><td>${formatMeters(o.width)} × ${formatMeters(o.depth)} m</td>${truth ? '<td></td>' : ''}<td>${o.round ? 'Cột tròn → hình vuông' : ''}</td></tr>`).join('');
    resultEl.innerHTML = `
      <table class="robot-table"><tr><th>Mã</th><th>Robot đo được</th>${truth ? '<th>Kho thật (đáp án)</th>' : ''}<th>Ghi chú</th></tr>${rows}${others}</table>
      <p class="hint">Vật thấp hơn 0,3 m (pallet rỗng, dây điện…) không đưa vào mặt bằng. Khối xanh trong cảnh 3D là kho dựng lại.</p>
      <button type="button" data-act="create" ${creating || layout.racks.length + layout.obstacles.length === 0 ? 'disabled' : ''}>${creating ? 'Đang tạo…' : 'Tạo kho mới từ bản quét'}</button>
    `;
  }

  function resize() {
    const w = view3d.clientWidth;
    const h = view3d.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return {
    show() {
      if (!active) {
        active = true;
        lastFrame = 0;
        resize();
        requestAnimationFrame(frame);
      }
    },
    hide() {
      active = false;
      running = false;
      renderControls();
    },
  };
}

const dist = (truthRack, rack) => Math.hypot(truthRack.cx - rack.center.x, truthRack.cy - rack.center.y);
