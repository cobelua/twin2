import * as THREE from 'three';
import { deliver, describeDeliveryEvent } from '../robot/delivery.js';
import { findStart } from '../robot/explorer.js';
import { mapFromLayout } from '../robot/mapFromLayout.js';
import { createWorld } from '../robot/world.js';

// Robot chở pallet trong cảnh 3D: thay cho hiệu ứng "pallet bay". Mọi quyết định (đường đi, bước qua / đi vòng,
// chỗ đứng trước khung) nằm trong src/robot/delivery.js (có test); file này chỉ phát lại từng nhịp và vẽ.
// Vị trí cuối của pallet = khối pallet trong khung, vẽ theo slotWorldPosition, như hiệu ứng bay cũ.
//
// Bản đồ của robot lấy THẲNG từ bản vẽ (mapFromLayout, cách KION dựng bản sao số từ file thiết kế), không đi quét.
// Vật lạ (bảng Robot) không có trong bản vẽ: robot chỉ biết khi cảm biến thấy.

const TICKS_PER_SECOND = 40;   // 1 nhịp = 0,1 m → ×1 là 4 m/s (nhanh hơn robot thật cho demo đỡ chờ)
const LOW_SLOWDOWN = 0.4;      // đang bước qua vật thấp thì chậm lại
const MAX_TICKS_PER_FRAME = 400;
const ROBOT_RADIUS = 0.35;
const BODY_HEIGHT = 0.3;
const LOG_LINES = 6;

const scanCache = new Map();   // "phòng:phiên bản" → { world, door, map }

export function createRobotDelivery(content, logEl) {
  let run = null;          // generator deliver()
  let jobs = [];
  let frame = null;
  let pose = null;
  let prevPose = null;
  let pending = 0;
  let robot = null;
  let carried = null;
  let log = [];

  function prepare(layout) {
    const key = `${layout.id}:${layout.version}`;
    if (!scanCache.has(key)) {
      const world = createWorld(layout);
      const door = findStart(world, ROBOT_RADIUS);
      if (!door) throw new Error('Phòng không còn chỗ trống để đặt robot.');
      scanCache.set(key, { world, door, map: mapFromLayout(world) });
    }
    return scanCache.get(key);
  }

  /**
   * Bắt đầu chở. targets: [{ target (khung + khối pallet trong cảnh), palletCode, slotCode }] theo thứ tự server.
   * settings: { obstacles (vật cản lạ), maxStep, lowPenalty }. Vật cản lạ có trong THẾ GIỚI nhưng không có trong
   * bản đồ quét: robot chỉ biết khi cảm biến thấy, rồi tự bước qua / đi vòng.
   * Ném lỗi nếu không dựng được thế giới (ví dụ thiếu footprint): warehouse3d khi đó quay về hiệu ứng bay.
   */
  function start(layout, targets, { obstacles = [], maxStep, lowPenalty } = {}) {
    stop();
    const { door, map } = prepare(layout);
    const world = createWorld(layout, obstacles);    jobs = targets.map((t) => ({ rack: t.target.rack, slot: t.target.slot, palletCode: t.palletCode, slotCode: t.slotCode, target: t.target }));
    jobs.forEach((j) => { j.target.pallet.visible = false; });   // khung trông trống cho tới khi robot đặt hàng vào
    const tuning = { robotRadius: ROBOT_RADIUS };
    if (maxStep != null) tuning.maxStep = maxStep;
    if (lowPenalty != null) tuning.lowPenalty = lowPenalty;
    run = deliver(world, map, door, jobs, tuning);
    pose = door;
    prevPose = door;
    pending = 0;
    log = [];
    robot = buildRobot();
    robot.position.set(door.x, 0, door.y);
    content.add(robot);
    render();
  }

  function step(seconds) {
    if (!run) return;
    const rate = TICKS_PER_SECOND * (frame?.onLow ? LOW_SLOWDOWN : 1);
    pending += seconds * rate;
    let n = 0;
    while (pending >= 1 && run && n < MAX_TICKS_PER_FRAME) {
      advance();
      pending -= 1;
      n++;
    }
    if (n === MAX_TICKS_PER_FRAME) pending = 0;
    if (run) draw(Math.min(1, pending));
  }

  function advance() {
    const next = run.next();
    if (next.done || next.value.phase === 'done') {
      finish();
      return;
    }
    frame = next.value;
    prevPose = pose;
    pose = frame.pose;
    for (const e of frame.events) {
      if (e.type === 'placed') place(frame.job);
      if (e.type === 'noAccess') frame.job.target.pallet.visible = true;   // không tới được: hiện thẳng, không tính là đã chở
      log.unshift(describeDeliveryEvent(e));
    }
    log = log.slice(0, LOG_LINES);
    if (frame.carrying && !carried && frame.job) carry(frame.job);
    render();
  }

  /** Vẽ robot ở vị trí nội suy giữa hai nhịp (logic vẫn đi từng ô 0,1 m), pallet trên lưng hoặc đang nâng. */
  function draw(frac) {
    if (!robot || !pose) return;
    const x = prevPose.x + (pose.x - prevPose.x) * frac;
    const z = prevPose.y + (pose.y - prevPose.y) * frac;
    robot.position.set(x, 0, z);
    if (Math.hypot(pose.x - prevPose.x, pose.y - prevPose.y) > 1e-6) robot.rotation.y = Math.atan2(-(pose.y - prevPose.y), pose.x - prevPose.x);
    if (!carried) return;
    const onBack = new THREE.Vector3(x, BODY_HEIGHT + carried.userData.height / 2, z);
    if (frame?.phase === 'lift') {
      // Nâng: nửa đầu đi thẳng lên đúng độ cao khung, nửa sau đẩy ngang vào khung. Điểm cuối = khối pallet trong khung.
      const to = frame.job.target.pallet.position;
      const t = frame.lift;
      const up = new THREE.Vector3(x, to.y, z);
      if (t <= 0.5) carried.position.lerpVectors(onBack, up, t / 0.5);
      else carried.position.lerpVectors(up, to, (t - 0.5) / 0.5);
    } else {
      carried.position.copy(onBack);
    }
  }

  function carry(job) {
    const source = job.target.pallet;
    carried = new THREE.Mesh(source.geometry.clone(), source.material.clone());
    carried.material.transparent = false;
    carried.userData.height = source.geometry.parameters.height;
    content.add(carried);
  }

  function place(job) {
    job.target.pallet.visible = true;
    job.placed = true;
    dropCarried();
  }

  function dropCarried() {
    if (!carried) return;
    content.remove(carried);
    carried.geometry.dispose();
    carried.material.dispose();
    carried = null;
  }

  /** Kết thúc (hết việc hoặc bấm Bỏ qua): mọi pallet hiện vào khung, robot rời cảnh. */
  function finish() {
    for (const j of jobs) j.target.pallet.visible = true;
    const placed = jobs.filter((j) => j.placed).length;
    if (run && jobs.length) log.unshift(placed === jobs.length ? `Xong: đã chở ${placed} pallet.` : `Dừng: robot chở ${placed}/${jobs.length}, còn lại hiện thẳng vào khung.`);
    log = log.slice(0, LOG_LINES);
    run = null;
    dropCarried();
    if (robot) content.remove(robot);
    robot = null;
    render();
  }

  /** Dừng không hiện gì thêm (cảnh sắp dựng lại). */
  function stop() {
    run = null;
    dropCarried();
    if (robot) content.remove(robot);
    robot = null;
    jobs = [];
    frame = null;
  }

  function render() {
    if (!logEl) return;
    const doing = run && frame?.job
      ? `<p><strong>${frame.phase === 'return' ? 'Về cửa kho' : frame.phase === 'lift' ? 'Nâng' : 'Chở'} ${frame.job.palletCode} → ${frame.job.slotCode}</strong>
         (${frame.jobIndex + 1}/${jobs.length})${frame.onLow ? ' · đang bước qua vật thấp' : ''}</p>`
      : run ? '<p><strong>Robot ở cửa kho</strong></p>' : '';
    logEl.hidden = !doing && log.length === 0;
    logEl.innerHTML = doing + log.map((line) => `<p>${line}</p>`).join('');
  }

  return {
    start, step, finish, stop,
    get active() { return run != null; },
    /** Thế giới thiết kế (không vật lạ) và chỗ robot xuất phát của phòng: để bảng Robot kiểm tra chỗ thả vật cản. */
    base(layout) {
      const { world, door } = prepare(layout);
      return { world, door };
    },
  };
}

/** Robot: thân trụ tròn đúng bán kính dùng khi tìm đường, có vạch chỉ hướng đi. */
function buildRobot() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(ROBOT_RADIUS, ROBOT_RADIUS, BODY_HEIGHT, 24),
    new THREE.MeshStandardMaterial({ color: 0x2563eb }),
  );
  body.position.y = BODY_HEIGHT / 2;
  group.add(body);
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(ROBOT_RADIUS, 0.04, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  nose.position.set(ROBOT_RADIUS / 2, BODY_HEIGHT + 0.02, 0);
  group.add(nose);
  return group;
}
