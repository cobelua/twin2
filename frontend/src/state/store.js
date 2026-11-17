import { api, ApiError } from '../api/client.js';
import { askConfirm } from '../ui/confirm.js';

// Trạng thái dùng chung của giao diện. Một chỗ giữ dữ liệu, các phần (danh sách phòng, editor 2D, bảng bên,
// thanh trạng thái) đăng ký nghe thay đổi rồi tự vẽ lại. Không dùng framework: dự án nhỏ, một hàm subscribe là đủ.
//
// layout: BẢN NHÁP của phòng đang mở, cùng dạng với GET /api/rooms/{id} (mét). Mọi thao tác vẽ chỉ sửa bản nháp này
// (xem actions.js); bấm "Lưu nháp" mới gửi lên server (PUT /layout), rồi tải lại để khớp database.
// Đối tượng mới vẽ chưa có Id của server nên mang Id TẠM ÂM (-1, -2…); lúc lưu gửi id = null.

const state = {
  step: 'layout',          // 'layout' | 'warehouse' (kho 3D của kho đang mở) | 'robot' (robot giả lập quét kho đang mở) | 'receive' (nhập lô, không cần mở kho)

  rooms: [],               // danh sách phòng (tóm tắt) cho màn chọn phòng
  roomsLoaded: false,
  currentRoomId: null,     // phòng đang mở trong editor; null = đang ở màn danh sách phòng

  layout: null,            // phòng đang mở (đủ kệ, vật cản), null khi chưa mở phòng nào
  layoutVersion: 0,        // tăng mỗi lần bản nháp đổi: bảng bên dựa vào đây để biết khi nào vẽ lại form
  loading: false,
  dirty: false,            // bản nháp có thay đổi chưa lưu
  saving: false,
  lastPlacements: null,    // kết quả xếp gần nhất của phòng đang mở: nút "Phát lại" ở cảnh 3D cho robot chở lại
  pendingPlacements: null, // pallet cần robot chở vào khung khi sang cảnh 3D (do màn Nhập hàng đặt, cảnh 3D lấy rồi xoá)
  slots: [],               // khung của phòng đang mở (kèm pallet/type/màu), cho cảnh 3D
  draftIssue: null,        // lỗi đầu tiên khi kiểm tra cả bản nháp ("K3: Kệ đè cột…"), null = ổn
  selectedRackId: null,
  selectedObstacleId: null,
  showGrid: true,

  // Công cụ chuột trên editor 2D: 'select' (chọn, kéo dời kệ), 'add-rack' (đặt kệ mới), 'add-column' (đặt cột).
  tool: 'select',

  // Bóng mờ của kệ đang kéo / sắp đặt / đang sửa trong form.
  // { request, rackId, source: 'drag' | 'add' | 'form', footprintWidth, footprintDepth, isValid, reason }
  // isValid = null khi đang chờ server trả lời; footprint lấy từ server (null cho tới lần trả lời đầu).
  preview: null,

  // Cấu hình kệ mới khi dùng công cụ "Đặt kệ" (mét, kg). Mã kệ tự sinh lúc đặt.
  newRack: {
    rotation: 0, levels: 3, levelHeight: 1.2, bays: 4, bayWidth: 1.2, depth: 1.0, hasTop: true, maxWeight: 1000,
  },

  message: null,           // { text, kind: 'info' | 'error' }
};

const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setState(patch) {
  Object.assign(state, patch);
  for (const listener of listeners) listener(state);
}

/**
 * Chuyển bước. Sang bước 3D/nhập hàng khi bản nháp chưa lưu thì chặn: các bước đó đọc dữ liệu ĐÃ LƯU trên server,
 * nên kệ mới vẽ sẽ không có khung. Về bước Mặt bằng thì luôn được.
 */
export function goToStep(step, { reload = true } = {}) {
  // Kho 3D và Robot quét luôn là của một kho đang mở.
  if ((step === 'warehouse' || step === 'robot') && state.currentRoomId == null) step = 'layout';
  if (step !== 'layout' && state.dirty) {
    showMessage('Bản nháp chưa lưu: bấm Lưu nháp trước khi sang bước này.', 'error');
    return;
  }
  setState({ step, message: null });
  // Địa chỉ trang: màn Nhập lô hàng là #/receive; các bước khác theo kho đang mở.
  const hash = step === 'receive' ? '#/receive' : state.currentRoomId != null ? `#/rooms/${state.currentRoomId}` : '#/rooms';
  if (location.hash !== hash) history.pushState(null, '', hash);
  // Đang chờ phát hiệu ứng thì khung vừa được tải xong (màn Nhập hàng tải sau khi xếp): tải lại sẽ dựng lại cảnh và cắt ngang hiệu ứng.
  if (step === 'warehouse' && reload && !state.pendingPlacements) loadSlots();
}

/** Tải khung của phòng đang mở (kèm pallet đang nằm trong khung). Chưa mở phòng thì để rỗng. */
export async function loadSlots() {
  const roomId = state.currentRoomId;
  if (roomId == null) {
    setState({ slots: [] });
    return;
  }
  try {
    const slots = await api.listSlots(roomId);
    if (state.currentRoomId === roomId) setState({ slots });
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

export function showMessage(text, kind = 'info') {
  setState({ message: { text, kind } });
}

// ---------- danh sách phòng, mở/đóng phòng ----------
// Địa chỉ trang giữ phòng đang mở (#/rooms/3), để tải lại trang hay bấm Back vẫn đúng chỗ.

export async function loadRooms() {
  try {
    setState({ rooms: await api.listRooms(), roomsLoaded: true });
  } catch (err) {
    setState({ roomsLoaded: true });
    showMessage(err.message, 'error');
  }
}

/** Mở một phòng trong editor. Đổi phòng thì bỏ chọn, bỏ bóng mờ, về công cụ Chọn. */
export async function openRoom(roomId) {
  if (!await confirmDiscard()) return;
  if (location.hash !== `#/rooms/${roomId}`) history.pushState(null, '', `#/rooms/${roomId}`);
  setState({
    currentRoomId: roomId, layout: null, slots: [], lastPlacements: null, pendingPlacements: null, selectedRackId: null, selectedObstacleId: null,
    preview: null, tool: 'select', message: null, dirty: false, draftIssue: null,
  });
  await loadLayout();
}

/** Về màn danh sách phòng (tải lại danh sách vì số kệ, tên… có thể vừa đổi). */
export async function closeRoom() {
  if (!await confirmDiscard()) return;
  if (location.hash !== '#/rooms') history.pushState(null, '', '#/rooms');
  setState({
    // Đóng kho khi đang ở Kho 3D (nút "← Danh sách kho" dùng chung cho Mặt bằng và Kho 3D): về màn danh sách,
    // không để lại màn 3D trống "Chưa mở kho nào". Đang ở màn Nhập lô hàng thì giữ nguyên.
    step: state.step === 'receive' ? 'receive' : 'layout',
    currentRoomId: null, layout: null, slots: [], lastPlacements: null, pendingPlacements: null, preview: null, tool: 'select', message: null, dirty: false, draftIssue: null,
  });
  await loadRooms();
}

/** Còn thay đổi chưa lưu thì hỏi trước khi rời phòng. Bấm Huỷ: trả false và đưa địa chỉ trang về phòng đang mở. */
async function confirmDiscard() {
  if (!state.dirty) return true;
  if (await askConfirm('Bản nháp có thay đổi chưa lưu. Bỏ các thay đổi và rời phòng?', { okText: 'Bỏ và rời phòng', danger: true })) {
    clearStoredDraft(state.currentRoomId);
    return true;
  }
  if (state.currentRoomId != null && location.hash !== `#/rooms/${state.currentRoomId}`) {
    history.pushState(null, '', `#/rooms/${state.currentRoomId}`);
  }
  return false;
}

// Đóng tab / tải lại trang khi còn thay đổi chưa lưu: trình duyệt tự hỏi lại.
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

// ---------- bản nháp tự lưu trong trình duyệt ----------
// Chỉ để không mất công vẽ khi lỡ đóng tab; KHÔNG phải là lưu thật (chưa lên server, chỉ máy này thấy).
// Mọi lệnh đọc/ghi bọc try/catch vì localStorage có thể bị chặn (cửa sổ ẩn danh…); lỗi thì bỏ qua, không ảnh hưởng gì.
const draftKey = (roomId) => `warehouse-draft:${roomId}`;

export function storeDraft() {
  try {
    if (state.layout && state.dirty) localStorage.setItem(draftKey(state.currentRoomId), JSON.stringify(state.layout));
  } catch { /* bỏ qua */ }
}

export function clearStoredDraft(roomId) {
  try {
    localStorage.removeItem(draftKey(roomId));
  } catch { /* bỏ qua */ }
}

function readStoredDraft(roomId) {
  try {
    const text = localStorage.getItem(draftKey(roomId));
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Đọc địa chỉ trang rồi mở đúng màn: #/receive → Nhập lô hàng, #/rooms/3 → phòng 3, còn lại → danh sách. */
export function syncWithAddress() {
  if (location.hash === '#/receive') {
    if (state.step !== 'receive') setState({ step: 'receive', message: null });
    return Promise.resolve();
  }
  if (state.step === 'receive') setState({ step: 'layout' });
  const id = /^#\/rooms\/(\d+)$/.exec(location.hash)?.[1];
  return id ? openRoom(Number(id)) : closeRoom();
}

/** Tải lại phòng đang mở từ server. Phòng không còn (ví dụ gõ sai Id trên địa chỉ) thì quay về danh sách. */
let loadingRoomId = null;   // phòng đang được tải: tránh hai lần tải chồng nhau (mỗi lần lại hỏi khôi phục nháp)

export async function loadLayout() {
  const roomId = state.currentRoomId;
  if (roomId == null || loadingRoomId === roomId) return;
  loadingRoomId = roomId;
  setState({ loading: true });
  try {
    const layout = await api.getRoom(roomId);
    if (state.currentRoomId !== roomId) return;   // người dùng đã chuyển phòng khác trong lúc chờ

    // Có bản nháp chưa lưu từ lần trước (cùng phiên bản phòng) thì hỏi có muốn khôi phục không.
    // Khác phiên bản nghĩa là phòng đã đổi ở nơi khác, bản nháp cũ không còn đúng nên bỏ.
    let draft = null;
    const stored = readStoredDraft(roomId);
    if (stored) {
      if (stored.version === layout.version && await askConfirm('Có bản nháp chưa lưu từ lần trước. Khôi phục?', { okText: 'Khôi phục', cancelText: 'Bỏ bản nháp' })) draft = stored;
      else clearStoredDraft(roomId);
    }

    setState({
      layout: draft ?? layout,
      dirty: draft !== null,
      draftIssue: null,
      layoutVersion: state.layoutVersion + 1,
      loading: false,
      selectedRackId: layout.racks.some((r) => r.id === state.selectedRackId) ? state.selectedRackId : null,
      selectedObstacleId: layout.obstacles.some((o) => o.id === state.selectedObstacleId) ? state.selectedObstacleId : null,
    });
  } catch (err) {
    setState({ loading: false });
    if (err instanceof ApiError && err.status === 404) {
      await closeRoom();
    }
    showMessage(err.message, 'error');
  } finally {
    loadingRoomId = null;
  }
}

export function selectedRack() {
  return state.layout?.racks.find((r) => r.id === state.selectedRackId) ?? null;
}

export function selectedObstacle() {
  return state.layout?.obstacles.find((o) => o.id === state.selectedObstacleId) ?? null;
}
