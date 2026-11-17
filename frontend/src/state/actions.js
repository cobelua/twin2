import { api, ApiError } from '../api/client.js';
import { askConfirm } from '../ui/confirm.js';
import { clearStoredDraft, getState, goToStep, loadLayout, openRoom, setState, showMessage, storeDraft } from './store.js';

// Các hành động của người dùng. Mọi thao tác vẽ chỉ sửa BẢN NHÁP trong bộ nhớ (state.layout); không có lời gọi
// server nào cho tới khi bấm "Lưu nháp". Không có luật nghiệp vụ ở đây: đặt được hay không, chiếm chỗ bao nhiêu,
// bao nhiêu khung… đều do server trả lời (validateLayout cho bóng mờ, saveLayout kiểm tra lần cuối).
// Frontend chỉ lo việc của giao diện: snap theo lưới, sinh mã kệ mới, Id tạm, chờ (debounce) khi gọi validate.

const VALIDATE_DELAY_MS = 120;   // chờ chuột dừng một chút rồi mới hỏi server, không gửi mỗi lần chuột nhích

// ---------- tiện ích ----------

/** Phòng đang mở: mọi API mặt bằng đều nằm dưới /rooms/{roomId}. */
const roomId = () => getState().currentRoomId;

/** Đổi kệ trong bản nháp thành RackRequest để gửi lên (validate, lưu). */
export function rackToRequest(r) {
  return {
    code: r.code, x: r.x, y: r.y, rotation: r.rotation,
    levels: r.levels, levelHeight: r.levelHeight, bays: r.bays, bayWidth: r.bayWidth, depth: r.depth,
    hasTop: r.hasTop, maxWeight: r.maxWeight, productTypeId: r.productTypeId ?? null,
  };
}

/**
 * Hít toạ độ (m) vào bội số của bước lưới gần nhất, không âm. Chỉ là trợ giúp nhập liệu của giao diện:
 * server nhận số mét bất kỳ. toFixed(3) để 0,1 × 3 ra 0,3 chứ không phải 0,30000000000000004.
 */
export function snap(value) {
  const grid = getState().layout?.gridSize ?? 0.5;
  return Math.max(0, Number((Math.round(value / grid) * grid).toFixed(3)));
}

/** Mã kệ mới: K + (số lớn nhất đang có trong bản nháp + 1). Phải tự sinh vì hai kệ cùng mã bị server từ chối. */
export function nextRackCode() {
  const numbers = (getState().layout?.racks ?? [])
    .map((r) => /^K(\d+)$/i.exec(r.code)?.[1])
    .filter(Boolean)
    .map(Number);
  return `K${Math.max(0, ...numbers) + 1}`;
}

// ---------- bản nháp ----------

let tempId = 0;
const newTempId = () => --tempId;   // -1, -2, … không bao giờ trùng Id thật (luôn dương)

/** Bản nháp dạng request gửi server. Đối tượng mới (Id âm) gửi id = null. */
export function toLayoutRequest(layout) {
  return {
    name: layout.name, width: layout.width, depth: layout.depth,
    gridSize: layout.gridSize, minGap: layout.minGap, margin: layout.margin,
    version: layout.version,
    obstacles: layout.obstacles.map((o) => ({
      id: o.id > 0 ? o.id : null, kind: o.kind, x: o.x, y: o.y, width: o.width, depth: o.depth,
    })),
    racks: layout.racks.map((r) => ({ id: r.id > 0 ? r.id : null, ...rackToRequest(r) })),
  };
}

/** Bản nháp với một kệ được thay bằng `request` (kệ có Id rackId), hoặc thêm vào nếu rackId = null. Không sửa state. */
function draftWith(request, rackId) {
  const layout = getState().layout;
  const racks = rackId == null
    ? [...layout.racks, { ...request, id: newTempId() }]
    : layout.racks.map((r) => (r.id === rackId ? { ...r, ...request } : r));
  return { ...layout, racks };
}

let draftCheckTimer = null;

/** Sau mỗi thay đổi: hỏi server kiểm tra cả bản nháp, lấy kích thước chiếm chỗ mới cho từng kệ và lỗi đầu tiên (nếu có). */
function scheduleDraftCheck() {
  clearTimeout(draftCheckTimer);
  draftCheckTimer = setTimeout(async () => {
    const layout = getState().layout;
    if (!layout) return;
    try {
      const check = await api.validateLayout(roomId(), toLayoutRequest(layout));
      if (getState().layout !== layout) return;   // bản nháp đã đổi tiếp: kết quả này cũ, lần hỏi sau sẽ thay
      // Cập nhật kích thước chiếm chỗ tại chỗ, không bump layoutVersion để bảng bên không vẽ lại form đang gõ.
      for (const r of layout.racks) {
        const c = check.racks.find((x) => x.code.toLowerCase() === r.code.toLowerCase());
        if (c) {
          r.footprintWidth = c.footprintWidth;
          r.footprintDepth = c.footprintDepth;
        }
      }
      setState({ draftIssue: check.isValid ? null : check.reason });
    } catch {
      /* mất mạng: bỏ qua, lúc Lưu nháp sẽ báo */
    }
  }, 250);
}

/** Sửa bản nháp: nhân bản state.layout, áp `change`, đánh dấu chưa lưu. Nhân bản để chỗ so sánh theo tham chiếu thấy đổi. */
function edit(change) {
  const layout = structuredClone(getState().layout);
  change(layout);
  setState({ layout, dirty: true, layoutVersion: getState().layoutVersion + 1 });
  storeDraft();
  scheduleDraftCheck();
}

function patchRack(rack, patch) {
  edit((layout) => {
    const r = layout.racks.find((k) => k.id === rack.id);
    if (!r) return;
    const next = { ...r, ...patch };
    // Server sinh lại khung khi số tầng/ô/nóc đổi, nên số khung chưa biết cho tới khi lưu.
    if (next.levels !== r.levels || next.bays !== r.bays || next.hasTop !== r.hasTop) r.slotCount = null;
    Object.assign(r, patch);
  });
}

// ---------- bóng mờ (kiểm tra thử) ----------

let validateTimer = null;
let validateSeq = 0;   // số thứ tự lần hỏi; trả lời của lần hỏi cũ (đến muộn) bị bỏ qua

function sameShape(a, b) {
  return a.rotation === b.rotation && a.bays === b.bays && a.bayWidth === b.bayWidth && a.depth === b.depth;
}

/**
 * Hiện bóng mờ cho một kệ rồi hỏi server POST /layout/validate. Bóng xám khi đang chờ, xanh/đỏ khi có trả lời.
 * Server được hỏi theo CẢ BẢN NHÁP (kệ đang kéo được thay bằng vị trí của bóng): kéo sát một kệ vừa dời mà chưa lưu
 * vẫn tính đúng. Kích thước bóng lấy từ server (footprintWidth/Depth); frontend không tự tính, kể cả khi xoay.
 * footprint: gợi ý ban đầu lấy từ chính dữ liệu server (ví dụ kệ đang dời), để bóng hiện ngay không phải chờ.
 */
export function previewRack(request, { rackId = null, source, footprint = null } = {}) {
  const prev = getState().preview;
  const keep = prev && prev.rackId === rackId && sameShape(prev.request, request);
  const width = footprint?.width ?? (keep ? prev.footprintWidth : null);
  const depth = footprint?.depth ?? (keep ? prev.footprintDepth : null);

  setState({
    preview: { request, rackId, source, footprintWidth: width, footprintDepth: depth, isValid: null, reason: null },
  });

  clearTimeout(validateTimer);
  const seq = ++validateSeq;
  validateTimer = setTimeout(async () => {
    try {
      const check = await api.validateLayout(roomId(), toLayoutRequest(draftWith(request, rackId)));
      if (seq !== validateSeq) return;
      const mine = check.racks.find((r) => r.code.toLowerCase() === request.code.toLowerCase());
      setState({
        preview: mine
          ? {
            ...getState().preview,
            isValid: mine.isValid,
            reason: mine.reason,
            footprintWidth: mine.footprintWidth,
            footprintDepth: mine.footprintDepth,
          }
          // Bản nháp có lỗi cấu trúc (ví dụ trùng mã): không có kết quả riêng cho kệ này, hiện lý do chung.
          : { ...getState().preview, isValid: false, reason: check.reason },
      });
    } catch (err) {
      // Ví dụ 400 vì số tầng = 0 ([Range] của ViewModel): coi như đỏ, lý do là câu lỗi của server.
      if (seq !== validateSeq) return;
      setState({ preview: { ...getState().preview, isValid: false, reason: err.message } });
    }
  }, VALIDATE_DELAY_MS);
}

/** Ngừng hỏi server cho bóng mờ hiện tại nhưng vẫn để bóng hiện. */
export function stopPreviewCheck() {
  validateSeq++;
  clearTimeout(validateTimer);
}

export function clearPreview() {
  validateSeq++;
  clearTimeout(validateTimer);
  if (getState().preview) setState({ preview: null });
}

// ---------- sửa bản nháp (chưa gọi server) ----------

export const moveRack = (rack, x, y, rotation) => patchRack(rack, { x, y, rotation });

export const rotateRack = (rack) => patchRack(rack, { rotation: rack.rotation === 90 ? 0 : 90 });

export function saveRack(rack, request) {
  const { code, ...values } = request;   // mã không đổi được khi sửa
  patchRack(rack, values);
  showMessage(`Đã sửa ${rack.code} trong bản nháp (chưa lưu).`);
}

export function addRack(request) {
  const created = { ...request, id: newTempId(), slotCount: null, footprintWidth: 0, footprintDepth: 0 };
  edit((layout) => layout.racks.push(created));
  setState({ selectedRackId: created.id, selectedObstacleId: null });
  showMessage(`Đã đặt kệ ${created.code} trong bản nháp (chưa lưu).`);
  return created;
}

export function saveRoom(values) {
  edit((layout) => Object.assign(layout, values));
  showMessage('Đã sửa phòng trong bản nháp (chưa lưu).');
}

export function addObstacle(values) {
  const created = { ...values, id: newTempId() };
  edit((layout) => layout.obstacles.push(created));
  setState({ selectedObstacleId: created.id, selectedRackId: null });
  showMessage(values.kind === 'Wall' ? 'Đã thêm tường (chưa lưu).' : 'Đã thêm cột (chưa lưu).');
  return created;
}

/** Đổi vị trí/kích thước tường hoặc cột trong bản nháp. Đè kệ hay ra ngoài phòng thì server báo ở dòng cảnh báo / lúc Lưu nháp. */
export function updateObstacle(obstacle, values) {
  const { x, y, width, depth } = values;
  edit((layout) => {
    const o = layout.obstacles.find((item) => item.id === obstacle.id);
    if (o) Object.assign(o, { x, y, width, depth });
  });
  showMessage(`Đã sửa ${obstacle.kind === 'Wall' ? 'tường' : 'cột'} trong bản nháp (chưa lưu).`);
}

// Xoá chỉ sửa bản nháp nên "Bỏ thay đổi" lấy lại được; vẫn hỏi trước vì xoá nhầm kệ rất mất công vẽ lại.

export async function removeObstacle(obstacle) {
  const what = obstacle.kind === 'Wall' ? 'tường' : 'cột';
  if (!await askConfirm(`Xoá ${what} tại (${obstacle.x}; ${obstacle.y}) m?`, { okText: 'Xoá', danger: true })) return;
  edit((layout) => { layout.obstacles = layout.obstacles.filter((o) => o.id !== obstacle.id); });
  setState({ selectedObstacleId: null });
  showMessage(`Đã xoá ${what} khỏi bản nháp (chưa lưu).`);
}

export async function removeRack(rack) {
  if (!await askConfirm(`Xoá kệ ${rack.code} khỏi bản nháp? Kệ chỉ thật sự bị xoá khi bấm Lưu nháp.`, { okText: 'Xoá', danger: true })) return;
  clearPreview();
  edit((layout) => { layout.racks = layout.racks.filter((r) => r.id !== rack.id); });
  setState({ selectedRackId: null });
  showMessage(`Đã xoá kệ ${rack.code} khỏi bản nháp (chưa lưu).`);
}

// ---------- Lưu nháp / Bỏ thay đổi ----------

/** Gửi cả bản nháp lên server (một transaction). Lỗi (đặt sai chỗ, kệ có hàng, lệch phiên bản…) thì giữ nguyên bản nháp để sửa tiếp. */
export async function saveDraft() {
  const state = getState();
  if (!state.layout || !state.dirty || state.saving) return;
  setState({ saving: true });
  try {
    await api.saveLayout(roomId(), toLayoutRequest(state.layout));
    clearStoredDraft(roomId());
    setState({ dirty: false, saving: false, draftIssue: null });
    await loadLayout();   // tải lại: Id thật của kệ/vật cản mới, số khung do server sinh, version mới
    showMessage('Đã lưu nháp.');
  } catch (err) {
    setState({ saving: false });
    showMessage(err.message, 'error');
  }
}

// ---------- tạo kho từ bản quét của robot ----------

/**
 * Tạo kho MỚI (POST /rooms, cùng kích thước và thông số với kho được quét), mở nó, rồi nạp kệ/cột/tường robot nhận ra
 * vào BẢN NHÁP (Id tạm âm, chưa lưu). Người dùng kiểm tra số tầng kệ (robot chỉ đoán) rồi bấm Lưu nháp: server
 * kiểm tra luật đặt kệ như mọi bản nháp khác. Không sửa kho cũ.
 * Tên kho mới: "<tên cũ> - quét", trùng thì thêm số (server trả 409 khi trùng tên).
 */
export async function createRoomFromScan(scanned, source) {
  const base = `${source.name} - quét`.slice(0, 45);
  let id = null;
  for (let n = 1; n <= 20 && id == null; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    try {
      ({ id } = await api.createRoom({
        name, width: scanned.width, depth: scanned.depth,
        gridSize: source.gridSize, minGap: source.minGap, margin: source.margin,
      }));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409)) throw err;
    }
  }
  if (id == null) throw new Error('Không đặt được tên cho kho mới: các tên "… - quét" đều đã có.');

  await openRoom(id);
  if (getState().currentRoomId !== id || !getState().layout) return;
  edit((layout) => {
    layout.obstacles = scanned.obstacles.map((o) => ({ id: newTempId(), kind: o.kind, x: o.x, y: o.y, width: o.width, depth: o.depth }));
    layout.racks = scanned.racks.map((r) => ({
      id: newTempId(), code: r.code, x: r.x, y: r.y, rotation: r.rotation,
      levels: r.levels, levelHeight: r.levelHeight, bays: r.bays, bayWidth: r.bayWidth, depth: r.depth,
      hasTop: r.hasTop, maxWeight: r.maxWeight, productTypeId: null,
      footprintWidth: r.footprintWidth, footprintDepth: r.footprintDepth, slotCount: null,
    }));
  });
  goToStep('layout');
  // Chỉ nhắc kiểm tra những kệ thật sự cần: số tầng là đoán (robot không đếm được), hoặc kệ chéo đã bị làm tròn về 0°/90°.
  const review = scanned.racks.filter((r) => r.needsReview).map((r) => r.code);
  showMessage(`Bản nháp từ robot: ${scanned.racks.length} kệ, ${scanned.obstacles.length} tường/cột.`
    + (review.length ? ` Cần xem lại ${review.join(', ')} (số tầng đoán hoặc kệ chéo đã làm tròn)` : ' Số tầng các kệ đã đếm được')
    + ', số ô là đoán theo ô 1,2 m. Kiểm tra rồi bấm Lưu nháp.');
}

/** Bỏ mọi thay đổi chưa lưu, lấy lại phòng như đã lưu trên server. */
export async function discardDraft() {
  if (!getState().dirty) return;
  if (!await askConfirm('Bỏ mọi thay đổi chưa lưu?', { okText: 'Bỏ thay đổi', danger: true })) return;
  clearStoredDraft(roomId());
  clearPreview();
  setState({ dirty: false, draftIssue: null });
  await loadLayout();
  showMessage('Đã bỏ thay đổi, quay lại bản đã lưu.');
}
