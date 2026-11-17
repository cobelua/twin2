import * as THREE from 'three';
import { OBSTACLE_PRESETS, placeObstacle } from '../robot/simObstacles.js';
import { withObstacle } from '../robot/world.js';

// Bảng "Robot" trong cảnh 3D: chỉnh thông số robot, thả vật cản lạ xuống sàn, chở thử.
// - Bậc tối đa: vật cao ≤ bậc này thì robot bước qua được (có phạt), cao hơn thì phải đi vòng.
// - Phạt: mỗi mét đi qua vùng vật thấp tốn thêm bao nhiêu mét quy đổi. Phạt cao thì robot thích đi vòng hơn.
// - Vật cản lạ: chọn loại → bấm xuống sàn. Chỉ có trong giả lập (không lưu), robot không biết trước.
// - Chở thử: robot chở lại vài pallet ĐANG CÓ trong kho (vị trí do server chọn từ trước), không ghi gì vào database.
// Thông số và vật cản áp dụng từ lần chở tiếp theo (chuyến đang chạy giữ nguyên, để nhật ký khớp với cái đã quyết).

const obstaclesByRoom = new Map();   // phòng → vật cản lạ đã thả (giữ khi dựng lại cảnh, mất khi tải lại trang)
const settings = { maxStep: 0.05, lowPenalty: 2 };

export function createRobotPanel({ container, scene, delivery, getLayout, onDemo }) {
  const panel = document.createElement('div');
  panel.className = 'view3d-robot-panel';
  panel.innerHTML = `
    <button type="button" class="robot-panel-toggle" data-toggle aria-expanded="false">Robot ▸</button>
    <div class="robot-panel-body" data-body hidden>
      <label>Bậc tối đa bước qua <input type="range" data-param="maxStep" min="0" max="0.6" step="0.01"> <b data-out="maxStep"></b></label>
      <label>Phạt khi bước qua <input type="range" data-param="lowPenalty" min="0" max="10" step="0.5"> <b data-out="lowPenalty"></b></label>
      <p class="hint">Vật cao ≤ bậc: bước qua được (tốn thêm phạt × mét). Cao hơn: phải đi vòng.</p>
      <div class="robot-panel-row">Thả vật cản lạ:
        ${OBSTACLE_PRESETS.map((p) => `<button type="button" data-preset="${p.id}" title="${p.width} × ${p.depth} m, cao ${p.height} m">${p.label}</button>`).join('')}
      </div>
      <label><input type="checkbox" data-rotated> Xoay 90°</label>
      <p class="robot-panel-msg" data-msg></p>
      <ul class="robot-panel-list" data-list></ul>
      <div class="robot-panel-row">
        <button type="button" data-clear>Xoá hết vật cản</button>
        <button type="button" data-demo class="primary">Chở thử 3 pallet đang có</button>
      </div>
      <p class="hint">Áp dụng từ lần chở tiếp theo.</p>
    </div>
  `;
  container.appendChild(panel);

  const body = panel.querySelector('[data-body]');
  const toggle = panel.querySelector('[data-toggle]');
  const msg = panel.querySelector('[data-msg]');
  const list = panel.querySelector('[data-list]');
  const rotatedBox = panel.querySelector('[data-rotated]');
  const group = new THREE.Group();   // khối vật cản lạ: tách khỏi `content` của cảnh để không mất khi dựng lại kệ
  scene.add(group);

  let armed = null;   // loại vật cản đang chờ bấm xuống sàn

  for (const input of panel.querySelectorAll('[data-param]')) input.value = settings[input.dataset.param];
  renderOutputs();

  panel.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-toggle]')) {
      body.hidden = !body.hidden;
      toggle.setAttribute('aria-expanded', String(!body.hidden));
      toggle.textContent = body.hidden ? 'Robot ▸' : 'Robot ▾';
    } else if (t.closest('[data-preset]')) {
      const id = t.closest('[data-preset]').dataset.preset;
      armed = armed?.id === id ? null : OBSTACLE_PRESETS.find((p) => p.id === id);
      say(armed ? `Bấm xuống sàn để thả ${armed.label.toLowerCase()}.` : '');
    } else if (t.closest('[data-remove]')) {
      const index = Number(t.closest('[data-remove]').dataset.remove);
      setObstacles(obstacles().filter((_, i) => i !== index));
    } else if (t.closest('[data-clear]')) {
      setObstacles([]);
      say('');
    } else if (t.closest('[data-demo]')) {
      armed = null;
      onDemo();
    }
    renderButtons();
  });
  panel.addEventListener('input', (e) => {
    const key = e.target.dataset.param;
    if (!key) return;
    settings[key] = Number(e.target.value);
    renderOutputs();
    rebuildMeshes();   // màu vật cản đổi theo bậc tối đa (bước qua được hay không)
  });

  // ---------- dữ liệu ----------

  function roomKey() {
    return getLayout()?.id ?? null;
  }

  function obstacles() {
    return obstaclesByRoom.get(roomKey()) ?? [];
  }

  function setObstacles(next) {
    obstaclesByRoom.set(roomKey(), next);
    rebuildMeshes();
    renderList();
  }

  /**
   * Bấm vào cảnh khi đang chọn loại vật cản: thả xuống chỗ tia chuột chạm sàn. Trả true nếu đã dùng cú bấm này
   * (để cảnh 3D không coi đó là bấm chọn khung).
   */
  function handleClick(raycaster) {
    if (!armed) return false;
    const layout = getLayout();
    const hit = new THREE.Vector3();
    if (!layout || !raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return true;
    if (hit.x < 0 || hit.z < 0 || hit.x > layout.width || hit.z > layout.depth) {
      say('Bấm vào trong sàn kho.');
      return true;
    }
    let base;
    try {
      base = delivery.base(layout);
    } catch (err) {
      say(err.message);
      return true;
    }
    const world = obstacles().reduce(withObstacle, base.world);
    const result = placeObstacle(world, armed, { x: hit.x, y: hit.z }, { rotated: rotatedBox.checked, door: base.door });
    if (result.reason) {
      say(result.reason);
      return true;
    }
    setObstacles([...obstacles(), result.obstacle]);
    say(`Đã thả ${armed.label.toLowerCase()} ở (${fmt(result.obstacle.x)}; ${fmt(result.obstacle.y)}) m. Bấm "Chở thử" để xem robot xử lý.`);
    armed = null;
    renderButtons();
    return true;
  }

  // ---------- vẽ ----------

  function rebuildMeshes() {
    group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    group.clear();
    for (const o of obstacles()) {
      const passable = o.height <= settings.maxStep + 1e-9;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(o.width, Math.max(o.height, 0.01), o.depth),
        new THREE.MeshStandardMaterial({ color: passable ? 0xf59e0b : 0xb45309 }),
      );
      mesh.position.set(o.x + o.width / 2, Math.max(o.height, 0.01) / 2, o.y + o.depth / 2);
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x1d2433 })));
      group.add(mesh);
    }
  }

  function renderList() {
    list.innerHTML = obstacles().map((o, i) => `
      <li>${o.label} ${fmt(o.width)} × ${fmt(o.depth)} m, cao ${fmt(o.height)} m
        <span class="${o.height <= settings.maxStep + 1e-9 ? 'ok' : 'warn'}">${o.height <= settings.maxStep + 1e-9 ? 'bước qua được' : 'phải đi vòng'}</span>
        <button type="button" data-remove="${i}" aria-label="Xoá">×</button></li>`).join('');
  }

  function renderOutputs() {
    panel.querySelector('[data-out="maxStep"]').textContent = `${fmt(settings.maxStep)} m`;
    panel.querySelector('[data-out="lowPenalty"]').textContent = `×${fmt(settings.lowPenalty)}`;
    renderList();
  }

  function renderButtons() {
    panel.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(armed?.id === b.dataset.preset)));
    container.classList.toggle('placing-obstacle', armed != null);
  }

  function say(text) {
    msg.textContent = text;
  }

  return {
    handleClick,
    /** Phòng đổi hoặc cảnh dựng lại: vẽ lại vật cản của phòng đang mở. */
    refresh() {
      armed = null;
      renderButtons();
      rebuildMeshes();
      renderList();
    },
    /** Thông số + vật cản cho lần chở tiếp theo. */
    settings: () => ({ obstacles: obstacles(), maxStep: settings.maxStep, lowPenalty: settings.lowPenalty }),
    say,
  };
}

const fmt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
