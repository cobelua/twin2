import { api } from './api/client.js';
import { createEditor2d } from './editor2d/editor2d.js';
import { createWarehouse3d } from './scene3d/warehouse3d.js';
import { createReceive } from './ui/receive.js';
import { createRobotView } from './ui/robotView.js';
import { createStockPanel } from './ui/stockPanel.js';
import { closeRoom, getState, goToStep, setState, subscribe, syncWithAddress } from './state/store.js';
import { createRoomList } from './ui/roomList.js';
import { createSidebar } from './ui/sidebar.js';
import { formatMeters } from './ui/format.js';

// Điểm vào: nối các phần lại với nhau. Mỗi phần tự nghe store và tự vẽ lại.
// Tính năng "Kho hàng": danh sách kho (chưa mở kho nào), rồi trong một kho có Mặt bằng (editor 2D) và Kho 3D.
// Tính năng "Nhập lô hàng": màn riêng, không cần mở kho.

const views = {
  layout: document.getElementById('view-layout'),
  warehouse: document.getElementById('view-warehouse'),
  robot: document.getElementById('view-robot'),
  receive: document.getElementById('view-receive'),
};
const workspace = document.getElementById('workspace');
const roomListEl = document.getElementById('room-list');
const roomEditorEl = document.getElementById('room-editor');
const roomTitle = document.getElementById('room-title');
const roomBar = document.getElementById('room-bar');
const stepButtons = document.querySelectorAll('#steps [data-step]');
const featureButtons = document.querySelectorAll('#features [data-feature]');
const statusMessage = document.getElementById('status-message');
const statusCursor = document.getElementById('status-cursor');

createRoomList(roomListEl);
createSidebar(document.getElementById('sidebar'));
createReceive(document.getElementById('receive-root'));
createStockPanel(document.getElementById('stock-root'));
createEditor2d(document.getElementById('editor2d'), document.getElementById('toolbar-2d'), {
  onCursor(info) {
    if (!info) {
      statusCursor.textContent = '';
      return;
    }
    const where = `x ${formatMeters(info.x)} m · y ${formatMeters(info.y)} m`;
    statusCursor.textContent = info.rack ? `${where} · ${info.rack.code}` : where;
  },
});

document.getElementById('back-to-rooms').addEventListener('click', () => closeRoom());

// Cảnh 3D chỉ tạo khi mở bước 2 lần đầu: tạo lúc khung đang ẩn thì kích thước bằng 0.
let scene3d = null;
let robotScan = null;   // màn Robot quét: cũng tạo lần đầu mở, cùng lý do
let drawn = { layout: undefined, slots: undefined };   // dữ liệu đã đưa cho cảnh 3D, để không dựng lại khi chưa đổi gì

// Hai tính năng ở thanh trên: "Kho hàng" (danh sách kho → mở kho → Mặt bằng / Kho 3D) và "Nhập lô hàng" (lập lô
// trước, hệ thống chọn kho). Vào lại "Kho hàng" thì về đúng kho đang mở (Mặt bằng), chưa mở kho nào thì là danh sách.
document.getElementById('features').addEventListener('click', (e) => {
  const feature = e.target.closest('[data-feature]')?.dataset.feature;
  if (feature === 'receive') goToStep('receive');
  else if (feature === 'rooms' && getState().step === 'receive') goToStep('layout');
});

// Trong một kho: chuyển Mặt bằng / Kho 3D.
document.getElementById('steps').addEventListener('click', (e) => {
  const step = e.target.closest('[data-step]')?.dataset.step;
  if (step) goToStep(step);
});

// Nút Back/Forward của trình duyệt: đọc lại địa chỉ (#/rooms, #/rooms/3 hoặc #/receive) rồi mở đúng màn.
window.addEventListener('popstate', () => syncWithAddress());

subscribe(render);
render(getState());

function render(state) {
  for (const [step, el] of Object.entries(views)) el.hidden = step !== state.step;
  stepButtons.forEach((b) => b.setAttribute('aria-current', b.dataset.step === state.step ? 'step' : 'false'));
  const feature = state.step === 'receive' ? 'receive' : 'rooms';
  featureButtons.forEach((b) => b.setAttribute('aria-current', b.dataset.feature === feature ? 'step' : 'false'));

  const inRoom = state.currentRoomId != null;
  roomBar.hidden = !inRoom || feature !== 'rooms';
  roomListEl.hidden = inRoom;
  roomEditorEl.hidden = !inRoom;
  // Màn danh sách phòng và màn Nhập lô hàng không cần bảng bên: ẩn đi cho rộng chỗ.
  workspace.classList.toggle('no-sidebar', state.step === 'receive' || state.step === 'robot' || (state.step === 'layout' && !inRoom));
  roomTitle.textContent = state.layout?.name ?? '';

  if (state.step === 'warehouse') {
    scene3d ??= createWarehouse3d(document.getElementById('viewport3d'), { getReplay: () => getState().lastPlacements });
    if (drawn.layout !== state.layout || drawn.slots !== state.slots) {
      drawn = { layout: state.layout, slots: state.slots };
      scene3d.update(state.layout, state.slots);
    }
    // Màn Nhập hàng đã xếp xong và chuyển sang đây: cho pallet bay vào đúng thứ tự server đã xếp (một lần).
    if (state.pendingPlacements) {
      const placements = state.pendingPlacements;
      setState({ pendingPlacements: null });
      scene3d.play(placements);
    }
  }

  // Robot quét chạy trên phòng ĐÃ LƯU (goToStep chặn khi bản nháp chưa lưu); rời màn thì dừng vòng vẽ.
  if (state.step === 'robot' && state.layout) {
    robotScan ??= createRobotView(document.getElementById('robot-root'));
    robotScan.show(state.layout);
  } else {
    robotScan?.hide();
  }

  statusMessage.textContent = state.message?.text ?? '';
  statusMessage.className = state.message?.kind === 'error' ? 'error' : '';
}

const apiStatus = document.getElementById('api-status');
api.health()
  .then(() => {
    apiStatus.textContent = 'API: kết nối được';
    apiStatus.className = 'api-status ok';
    return syncWithAddress();
  })
  .catch((err) => {
    apiStatus.textContent = `API lỗi: ${err.message}`;
    apiStatus.className = 'api-status error';
  });
