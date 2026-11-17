import { api } from '../api/client.js';
import { getState, goToStep, openRoom, setState, showMessage, subscribe } from '../state/store.js';
import { formatInt, formatMeters } from './format.js';

// Màn danh sách phòng: mỗi phòng một thẻ, bấm để mở trong editor. Nút "Thêm phòng" mở form nhập đủ thông số
// (tên, dài, rộng, lưới, lối đi, khoảng hở); tạo xong thì mở luôn phòng mới. Vào phòng rồi vẫn sửa được
// mọi thông số đó ở bảng bên trái như bình thường.

// Giá trị mặc định cho phòng mới: hay dùng nhất, người dùng sửa nếu cần.
const DEFAULT_ROOM = { name: '', width: 20, depth: 12, gridSize: 0.5, minGap: 1.0, margin: 0.05 };

export function createRoomList(root) {
  let formOpen = false;
  let formError = '';
  let draft = { ...DEFAULT_ROOM };   // giữ chữ đang gõ khi danh sách vẽ lại
  let renderedKey = null;

  root.addEventListener('click', (e) => {
    const card = e.target.closest('[data-room-id]');
    if (card) {
      openRoom(Number(card.dataset.roomId));
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'receive') {
      goToStep('receive');   // lập lô trước, hệ thống chọn kho sau: không cần mở kho nào
      return;
    }
    if (action === 'open-form') {
      formOpen = true;
      formError = '';
      draft = { ...DEFAULT_ROOM, name: suggestName(getState().rooms) };
      render(getState(), true);
      root.querySelector('input[name="name"]')?.select();
    }
    if (action === 'close-form') {
      formOpen = false;
      render(getState(), true);
    }
  });

  root.addEventListener('input', (e) => {
    if (e.target.name) draft[e.target.name] = e.target.value;
  });

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const room = {
      name: draft.name,
      width: Number(draft.width), depth: Number(draft.depth), gridSize: Number(draft.gridSize),
      minGap: Number(draft.minGap), margin: Number(draft.margin),
    };
    try {
      const created = await api.createRoom(room);
      formOpen = false;
      draft = { ...DEFAULT_ROOM };
      await openRoom(created.id);   // openRoom xoá thông báo cũ, nên báo "đã tạo" sau
      showMessage(`Đã tạo phòng ${room.name.trim()}.`);
    } catch (err) {
      // Ví dụ "Đã có phòng tên Kho A." (409): hiện ngay dưới form, giữ nguyên chữ đã gõ để sửa.
      formError = err.message;
      render(getState(), true);
    }
  });

  function render(state, force = false) {
    const key = [state.roomsLoaded, state.rooms.map((r) => `${r.id}:${r.name}:${r.rackCount}:${r.slotCount}`).join(',')].join('|');
    if (!force && key === renderedKey) return;
    renderedKey = key;

    if (!state.roomsLoaded) {
      root.innerHTML = '<p class="hint">Đang tải danh sách phòng…</p>';
      return;
    }
    // Chưa có phòng nào thì mở sẵn form: việc đầu tiên người dùng cần làm là tạo phòng.
    const showForm = formOpen || state.rooms.length === 0;

    root.innerHTML = `
      <div class="room-list-head">
        <h1>Phòng (${state.rooms.length})</h1>
        <span class="room-list-actions">
          ${state.rooms.length ? '<button type="button" class="primary" data-action="receive">Nhập lô hàng</button>' : ''}
          ${showForm ? '' : '<button type="button" data-action="open-form">+ Thêm phòng</button>'}
        </span>
      </div>
      ${showForm ? roomForm(state.rooms.length > 0) : ''}
      ${state.rooms.length === 0 ? '<p class="hint">Chưa có phòng nào. Nhập thông số để tạo phòng đầu tiên.</p>' : ''}
      <ul class="room-cards">
        ${state.rooms.map(card).join('')}
      </ul>
    `;
  }

  function roomForm(canCancel) {
    return `
      <form class="room-form" autocomplete="off">
        <h2>Phòng mới</h2>
        <div class="grid-form wide">
          <label class="full">Tên phòng<input name="name" value="${escapeHtml(draft.name)}" maxlength="50" required /></label>
          <label>Dài (m)<input type="number" name="width" value="${draft.width}" min="0.5" max="500" step="any" required /></label>
          <label>Rộng (m)<input type="number" name="depth" value="${draft.depth}" min="0.5" max="500" step="any" required /></label>
          <label>Lưới (m)<input type="number" name="gridSize" value="${draft.gridSize}" min="0.05" max="10" step="any" required /></label>
          <label>Lối đi tối thiểu (m)<input type="number" name="minGap" value="${draft.minGap}" min="0" max="20" step="any" required /></label>
          <label>Khoảng hở đỉnh (m)<input type="number" name="margin" value="${draft.margin}" min="0" max="2" step="any" required /></label>
        </div>
        <p class="live error">${escapeHtml(formError)}</p>
        <div class="form-actions">
          ${canCancel ? '<button type="button" data-action="close-form">Huỷ</button>' : ''}
          <button type="submit" class="primary">Tạo phòng</button>
        </div>
        <p class="hint">Lưới chỉ là bước "hít" khi kéo kệ; vào phòng rồi vẫn đổi được mọi thông số này.</p>
      </form>
    `;
  }

  subscribe((state) => render(state));
  render(getState());
}

function card(room) {
  return `
    <li>
      <button type="button" class="room-card" data-room-id="${room.id}">
        <strong>${escapeHtml(room.name)}</strong>
        <span>${formatMeters(room.width)} × ${formatMeters(room.depth)} m · lưới ${formatMeters(room.gridSize)} m</span>
        <span class="muted">${room.rackCount} kệ · ${formatInt(room.slotCount)} khung · ${room.obstacleCount} tường/cột</span>
      </button>
    </li>
  `;
}

/** Tên gợi ý chưa trùng: "Phòng 1", "Phòng 2"… Server vẫn là bên kiểm tra trùng thật. */
function suggestName(rooms) {
  const names = new Set(rooms.map((r) => r.name.toLowerCase()));
  let n = rooms.length + 1;
  while (names.has(`phòng ${n}`)) n++;
  return `Phòng ${n}`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
