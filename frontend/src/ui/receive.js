import { api } from '../api/client.js';
import { closeRoom, getState, goToStep, loadSlots, openRoom, setState, showMessage, subscribe } from '../state/store.js';
import { askConfirm } from './confirm.js';

// Màn Nhập lô hàng (#/receive): LẬP LÔ TRƯỚC, CHỌN KHO SAU. Không cần mở kho nào trước.
// 1) Nhập các dòng (số lượng + số đo) → "Kiểm tra các kho": server trả từng kho nhận được bao nhiêu, thiếu bao nhiêu,
//    và đề xuất chia kho (ưu tiên kho đã có type trùng).
// 2) "Nhập theo đề xuất" (POST /batches rồi /batches/{id}/distribute) hoặc "Nhập vào kho này" trên một dòng kho
//    (POST /batches rồi /rooms/{id}/batches/{id}/allocate; kho thiếu chỗ thì hỏi lại trước).
// 3) Kết quả: mỗi kho nhận bao nhiêu, nút "Xem 3D" mở kho đó và cho pallet bay vào.
// Frontend không chọn kho, không chọn khung, không tự đếm chỗ: mọi con số do server trả.

const SAMPLE = [   // lô ví dụ 6A + 2B của kế hoạch: 6 pallet thấp, 2 pallet cao chỉ lên được nóc
  { quantity: 6, length: 1.2, width: 0.8, height: 1.0 },
  { quantity: 2, length: 1.2, width: 0.8, height: 1.6 },
];

// Lô b36 (2026-11-12, "Phòng 3"): lô dùng làm bài test thuật toán (AllocatorTests.Allocate_Room3Batch36…).
// Mở màn Nhập lô hàng lần đầu thì điền sẵn lô này; sửa tay hay bấm "Lô ví dụ" thì thay bình thường.
const LOT_B36 = [
  { quantity: 15, length: 1.2, width: 0.8, height: 1.0 },
  { quantity: 2, length: 1.2, width: 0.8, height: 1.6 },
  { quantity: 5, length: 1.0, width: 0.8, height: 0.9 },
  { quantity: 8, length: 0.8, width: 0.6, height: 0.7 },
];

const blankLine = () => ({ quantity: 1, length: '', width: '', height: '', weight: '', productTypeId: '' });

export function createReceive(root) {
  let lines = LOT_B36.map((l) => ({ ...blankLine(), ...l }));   // lần đầu: điền sẵn lô b36
  let types = [];
  let check = null;       // kết quả kiểm tra của đúng các dòng đang nhập; null khi chưa kiểm tra hoặc đã sửa dòng
  // Sau khi nhập: { batch: {batchId, code, palletCount}, mode: 'auto' | {roomId}, result | null }.
  // result cùng dạng với distributeBatch: { total, placed, rooms: [{ roomId, roomName, count, placements }], rejected }.
  let outcome = null;
  let busy = false;
  let shown = false;      // đang ở màn này (để tải loại hàng một lần mỗi lần vào)

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('submit', onSubmit);

  subscribe((state) => {
    if (state.step !== 'receive') {
      shown = false;
      return;
    }
    if (!shown) {
      shown = true;
      render();
      loadTypes();
    }
  });

  // ---------- vẽ ----------
  function render() {
    root.innerHTML = `
      <div class="receive-page-head">
        <h1>Nhập lô hàng</h1>
        <button type="button" data-action="back">← Danh sách kho</button>
      </div>
      <p class="hint">Lập lô trước: mỗi dòng là một nhóm pallet cùng số đo (dài, rộng, cao bằng mét; kg có thể để trống). Type A, B… do hệ thống tự khớp hoặc tạo. Bấm "Kiểm tra các kho" để xem kho nào nhận được.</p>
      <table class="lines">
        <thead><tr><th title="Số pallet">SL</th><th title="Chiều dài (m)">Dài</th><th title="Chiều rộng (m)">Rộng</th><th title="Chiều cao (m)">Cao</th><th title="Khối lượng một pallet (kg), để trống nếu không kiểm tra tải">kg</th><th>Loại hàng</th><th></th></tr></thead>
        <tbody>${lines.map(lineRow).join('')}</tbody>
      </table>
      <div class="receive-actions">
        <button type="button" data-action="add-line">+ Thêm dòng</button>
        <button type="button" data-action="sample">Lô ví dụ 6A + 2B</button>
        <button type="button" data-action="lot-b36">Lô b36 (bài test)</button>
        <button type="button" data-action="random">Sinh ngẫu nhiên 30 pallet</button>
        <button type="button" class="primary" data-action="check" ${busy ? 'disabled' : ''}>Kiểm tra các kho</button>
      </div>
      <div data-role="check">${checkHtml()}</div>
      <div data-role="outcome">${outcomeHtml()}</div>
      <div class="receive-footer">
        <form data-form="product-type" class="inline-form">
          <strong>Loại hàng mới</strong>
          <input name="code" placeholder="Mã (OV)" maxlength="20" required />
          <input name="name" placeholder="Tên (Ốc vít)" maxlength="50" required />
          <button type="submit">Thêm</button>
        </form>
      </div>
    `;
  }

  function lineRow(line, i) {
    const options = ['<option value="">Chưa phân loại</option>',
      ...types.map((t) => `<option value="${t.id}" ${String(t.id) === String(line.productTypeId) ? 'selected' : ''}>${escapeHtml(t.code)} · ${escapeHtml(t.name)}</option>`)];
    const cell = (name, value, step = 'any', min = '0') =>
      `<td><input type="number" name="${name}" value="${value}" min="${min}" step="${step}" data-line="${i}" /></td>`;
    return `<tr>
      ${cell('quantity', line.quantity, '1', '1')}
      ${cell('length', line.length)}${cell('width', line.width)}${cell('height', line.height)}${cell('weight', line.weight)}
      <td><select name="productTypeId" data-line="${i}">${options.join('')}</select></td>
      <td><button type="button" class="icon danger" title="Xoá dòng" data-action="remove-line" data-line="${i}" ${lines.length === 1 ? 'disabled' : ''}>×</button></td>
    </tr>`;
  }

  function checkHtml() {
    if (!check) return '';
    const typeRows = check.lines.map((l) => `
      <tr><td><i class="chip" style="background:${l.color}"></i> Type ${escapeHtml(l.typeCode)}${l.isNewType ? ' <span class="muted">(mới)</span>' : ''}</td>
      <td>${l.quantity}</td><td class="muted">${l.length} × ${l.width} × ${l.height} m</td></tr>`).join('');

    const roomRows = check.rooms.map((r) => `
      <tr class="${r.missing ? 'status-Partial' : 'status-Ok'}">
        <td>${escapeHtml(r.roomName)}</td>
        <td>${r.placeable} / ${check.total}</td>
        <td>${r.missing ? `Thiếu ${r.missing} ô${r.notes.length ? `<br><span class="muted">${r.notes.map(escapeHtml).join('<br>')}</span>` : ''}` : 'Đủ điều kiện'}</td>
        <td><button type="button" data-action="into-room" data-room-id="${r.roomId}" ${busy || r.placeable === 0 ? 'disabled' : ''}>Nhập vào kho này</button></td>
      </tr>`).join('');

    const plan = check.plan;
    const short = plan.total - plan.placed;
    const planRows = plan.rooms.map((r) => `<tr><td>${escapeHtml(r.roomName)}</td><td>${r.count} pallet</td></tr>`).join('');

    return `
      <h3>Lô gồm ${check.total} pallet</h3>
      <table class="result"><thead><tr><th>Type</th><th>SL</th><th>Số đo</th></tr></thead><tbody>${typeRows}</tbody></table>

      <h3>Từng kho (nếu nhận riêng cả lô)</h3>
      ${check.rooms.length
        ? `<table class="result"><thead><tr><th>Kho</th><th>Nhận được</th><th>Kết quả</th><th></th></tr></thead><tbody>${roomRows}</tbody></table>`
        : '<p class="warn">Chưa có kho nào. Tạo kho ở màn danh sách trước.</p>'}

      <h3>Đề xuất của hệ thống</h3>
      <p class="hint">Ưu tiên kho đã có hàng cùng type; kho chứa được hết thì không chia; không kho nào đủ thì chia ra nhiều kho.</p>
      ${plan.rooms.length
        ? `<table class="result"><thead><tr><th>Kho</th><th>Số pallet</th></tr></thead><tbody>${planRows}</tbody></table>`
        : ''}
      <p class="${short ? 'warn' : 'ok'}">${short
        ? `Theo đề xuất vẫn thiếu ${short} ô: ${short} pallet sẽ ở lại trong lô, chưa có khung.`
        : 'Theo đề xuất: đủ chỗ cho cả lô.'}</p>
      <button type="button" class="primary" data-action="auto" ${busy || plan.placed === 0 ? 'disabled' : ''}>Nhập theo đề xuất</button>
    `;
  }

  function outcomeHtml() {
    if (!outcome) return '';
    const { batch, result } = outcome;
    if (!result) {
      return `
        <h3>Lô ${escapeHtml(batch.code)} đã nhập (${batch.palletCount} pallet) nhưng chưa xếp</h3>
        <p class="warn">Việc xếp bị lỗi. Bấm xếp lại: pallet nào đã vào khung sẽ không bị xếp đôi.</p>
        <button type="button" class="primary" data-action="retry" ${busy ? 'disabled' : ''}>Xếp lại lô ${escapeHtml(batch.code)}</button>
      `;
    }
    const roomRows = result.rooms.map((r) => `
      <tr><td>${escapeHtml(r.roomName)}</td><td>${r.count} pallet</td>
      <td><button type="button" class="primary" data-action="view-room" data-room-id="${r.roomId}">Xem 3D</button></td></tr>`).join('');
    const rejected = result.rejected.map((r) => `<tr class="status-NoRack"><td>${escapeHtml(r.palletCode)}</td><td>${escapeHtml(r.reason)}</td></tr>`).join('');
    return `
      <h3>Lô ${escapeHtml(batch.code)}: đã xếp ${result.placed} / ${batch.palletCount} pallet</h3>
      ${result.rooms.length ? `<table class="result"><thead><tr><th>Kho</th><th>Nhận</th><th></th></tr></thead><tbody>${roomRows}</tbody></table>` : ''}
      ${rejected ? `<p class="warn">Chưa có khung (vẫn thuộc lô, thêm kệ rồi xếp lại sau):</p><table class="result"><tbody>${rejected}</tbody></table>` : ''}
    `;
  }

  // ---------- dữ liệu ----------
  async function loadTypes() {
    try {
      types = await api.listProductTypes();
      if (getState().step === 'receive') render();
    } catch (err) {
      showMessage(err.message, 'error');
    }
  }

  function batchRequest() {
    const num = (v) => (v === '' || v == null ? null : Number(v));
    return {
      lines: lines.map((l) => ({
        quantity: Number(l.quantity), length: Number(l.length), width: Number(l.width), height: Number(l.height),
        weight: num(l.weight), productTypeId: l.productTypeId === '' ? null : Number(l.productTypeId),
      })),
    };
  }

  async function run(work) {
    busy = true;
    render();
    try {
      await work();
    } catch (err) {
      showMessage(err.message, 'error');
    } finally {
      busy = false;
      if (getState().step === 'receive') render();
    }
  }

  // ---------- sự kiện ----------
  function onInput(e) {
    const el = e.target;
    if (el.dataset.line === undefined) return;
    lines[Number(el.dataset.line)][el.name] = el.value;
    check = null;   // sửa dòng thì kết quả kiểm tra cũ không còn đúng
    root.querySelector('[data-role="check"]').innerHTML = '';
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (e.target.dataset.form !== 'product-type') return;
    const data = new FormData(e.target);
    await run(async () => {
      await api.createProductType({ code: data.get('code'), name: data.get('name') });
      types = await api.listProductTypes();
      showMessage('Đã thêm loại hàng.');
    });
  }

  function onClick(e) {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const editLines = (change) => { change(); check = null; render(); };

    if (action === 'add-line') editLines(() => lines.push(blankLine()));
    else if (action === 'remove-line') editLines(() => lines.splice(Number(button.dataset.line), 1));
    else if (action === 'sample') editLines(() => { lines = SAMPLE.map((l) => ({ ...blankLine(), ...l })); });
    else if (action === 'random') editLines(() => { lines = randomLines(30); });
    else if (action === 'lot-b36') editLines(() => { lines = LOT_B36.map((l) => ({ ...blankLine(), ...l })); });
    else if (action === 'check') doCheck();
    else if (action === 'auto') doAuto();
    else if (action === 'into-room') doIntoRoom(Number(button.dataset.roomId));
    else if (action === 'retry') doRetry();
    else if (action === 'view-room') viewRoom(Number(button.dataset.roomId));
    else if (action === 'back') backToRooms();
  }

  function doCheck() {
    return run(async () => {
      check = await api.checkBatch(batchRequest());
      outcome = null;
    });
  }

  // Nhập theo đề xuất: lập lô rồi để server chia ra các kho.
  function doAuto() {
    return run(async () => {
      const batch = await api.receiveBatch(batchRequest());
      outcome = { batch, mode: 'auto', result: null };
      check = null;
      outcome.result = await api.distributeBatch(batch.batchId);   // lỗi ở đây: lô vẫn đã nhập, có nút xếp lại
      showMessage(`Đã nhập lô ${batch.code}: ${outcome.result.placed} / ${batch.palletCount} pallet vào ${outcome.result.rooms.length} kho.`);
    });
  }

  // Nhập vào một kho người dùng chọn. Kho thiếu chỗ thì hỏi lại (phần thiếu ở lại trong lô).
  async function doIntoRoom(roomId) {
    const room = check.rooms.find((r) => r.roomId === roomId);
    if (room.missing) {
      const ok = await askConfirm(
        `Kho ${room.roomName} thiếu ${room.missing} ô: ${room.missing} pallet sẽ ở lại trong lô, chưa có khung. Vẫn nhập vào kho này?`,
        { okText: 'Vẫn nhập' });
      if (!ok) return;
    }
    await run(async () => {
      const batch = await api.receiveBatch(batchRequest());
      outcome = { batch, mode: { roomId, roomName: room.roomName }, result: null };
      check = null;
      outcome.result = await allocateInto(roomId, room.roomName, batch);
      showMessage(`Đã nhập lô ${batch.code} vào kho ${room.roomName}.`);
    });
  }

  function doRetry() {
    return run(async () => {
      const { batch, mode } = outcome;
      outcome.result = mode === 'auto'
        ? await api.distributeBatch(batch.batchId)
        : await allocateInto(mode.roomId, mode.roomName, batch);
    });
  }

  // Xếp vào một kho, đổi kết quả về cùng dạng với distributeBatch để vẽ chung.
  async function allocateInto(roomId, roomName, batch) {
    const allocation = await api.allocateBatch(roomId, batch.batchId);
    const count = allocation.placements.length;
    return {
      total: batch.palletCount,
      placed: count,
      rooms: count ? [{ roomId, roomName, count, placements: allocation.placements }] : [],
      rejected: allocation.rejected,
    };
  }

  async function backToRooms() {
    await closeRoom();
    if (getState().currentRoomId == null) goToStep('layout');
  }

  // Mở kho trên màn 3D và cho pallet của lô này bay vào đúng thứ tự server đã xếp.
  async function viewRoom(roomId) {
    const placements = outcome?.result?.rooms.find((r) => r.roomId === roomId)?.placements ?? [];
    await openRoom(roomId);
    if (getState().currentRoomId !== roomId) return;   // người dùng huỷ (bản nháp chưa lưu của kho đang mở)
    await loadSlots();
    setState({ lastPlacements: placements.length ? placements : null, pendingPlacements: placements.length ? placements : null });
    goToStep('warehouse', { reload: false });
  }
}

/** Sinh ngẫu nhiên các dòng tổng cộng `total` pallet từ vài số đo thường gặp. Chỉ là dữ liệu nhập mẫu, không phải luật. */
function randomLines(total) {
  const sizes = [
    { length: 1.2, width: 0.8, height: 1.0 }, { length: 1.2, width: 0.8, height: 1.6 },
    { length: 1.0, width: 0.8, height: 0.9 }, { length: 0.8, width: 0.6, height: 0.7 },
  ];
  const lines = [];
  let left = total;
  sizes.forEach((size, i) => {
    const quantity = i === sizes.length - 1 ? left : Math.min(left, 1 + Math.floor(Math.random() * (left / 2)));
    left -= quantity;
    if (quantity > 0) lines.push({ ...blankLine(), ...size, quantity });
  });
  return lines;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
