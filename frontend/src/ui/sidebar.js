import {
  addObstacle, clearPreview, discardDraft, nextRackCode, previewRack, rackToRequest, removeObstacle, removeRack,
  saveDraft, saveRack, saveRoom, updateObstacle,
} from '../state/actions.js';
import { getState, selectedObstacle, selectedRack, setState, subscribe } from '../state/store.js';
import { formatInt, formatMeters } from './format.js';

// Bảng bên trái: nhập và sửa cấu hình. Mọi ô nhập chỉ sửa BẢN NHÁP; nút Lưu nháp ở đầu bảng mới gửi lên server.
//
// Vẽ lại form chỉ khi dữ liệu thật đổi (tải lại mặt bằng, đổi kệ đang chọn…), KHÔNG vẽ lại mỗi lần state đổi:
// nếu vẽ lại khi bóng mờ cập nhật thì ô đang gõ bị xoá mất. Phần thay đổi liên tục (kết quả kiểm tra thử)
// được cập nhật riêng vào một dòng nhỏ.

export function createSidebar(root) {
  let renderedKey = null;
  let formNonce = 0;   // tăng khi bấm "Huỷ" để vẽ lại form về giá trị cũ

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('submit', onSubmit);

  function keyOf(state) {
    return [state.step, state.layoutVersion, state.loading, state.selectedRackId, state.selectedObstacleId, formNonce].join('|');
  }

  function render(state) {
    const key = keyOf(state);
    if (key !== renderedKey) {
      // Đổi kệ đang chọn / tải lại dữ liệu: bóng mờ của form cũ không còn đúng nữa.
      if (renderedKey !== null && state.preview?.source === 'form') queueMicrotask(clearPreview);
      renderedKey = key;
      root.innerHTML = html(state);
    }
    updateLive(state);
  }

  // ---------- nội dung ----------
  function html(state) {
    if (state.step === 'warehouse') return '<p class="hint">Kho 3D: xem phòng đã lưu, mỗi khung có hàng tô màu theo type pallet. Muốn nhập hàng: bấm "Nhập lô hàng" (lập lô trước, hệ thống kiểm tra và chọn kho), rồi "Xem 3D" để xem pallet bay vào.</p>';
    if (state.step !== 'layout') return '';
    const room = state.layout;
    if (!room) return `<p class="hint">${state.loading ? 'Đang tải mặt bằng…' : 'Chưa có phòng.'}</p>`;

    return `
      ${draftBar()}
      ${roomForm(room)}
      ${selectedSection(state)}
      ${rackList(room, state)}
      ${newRackForm(state.newRack)}
      ${obstacleSection(room, state)}
    `;
  }

  function draftBar() {
    return `
      <div class="draft-bar">
        <span class="draft-status" data-role="draft-status"></span>
        <button type="button" data-action="discard-draft">Bỏ thay đổi</button>
        <button type="button" class="primary" data-action="save-draft">Lưu nháp</button>
      </div>
    `;
  }

  function roomForm(room) {
    return `
      <details class="section" open>
        <summary>Phòng</summary>
        <form data-form="room" class="grid-form">
          <label class="full">Tên phòng<input name="name" value="${escapeHtml(room.name)}" maxlength="50" required /></label>
          ${num('width', 'Dài (m)', room.width, 0.5, 0.1)}
          ${num('depth', 'Rộng (m)', room.depth, 0.5, 0.1)}
          ${num('gridSize', 'Lưới (m)', room.gridSize, 0.05, 0.05)}
          ${num('minGap', 'Lối đi tối thiểu (m)', room.minGap, 0, 0.1)}
          ${num('margin', 'Khoảng hở đỉnh (m)', room.margin, 0, 0.01)}
          <div class="form-actions"><button type="submit">Áp dụng</button></div>
        </form>
        <p class="hint">Đổi lưới không làm kệ nào di chuyển. Thu nhỏ phòng hoặc tăng lối đi thì server kiểm tra lại mọi kệ khi lưu nháp.</p>
      </details>
    `;
  }

  function selectedSection(state) {
    const rack = selectedRack();
    if (rack) return rackEditForm(rack);
    const obstacle = selectedObstacle();
    if (obstacle) {
      return `
        <section class="section-plain">
          <h2>${obstacle.kind === 'Wall' ? 'Tường' : 'Cột'} đang chọn</h2>
          <form data-form="obstacle-edit" class="grid-form">
            ${num('x', 'X (m)', obstacle.x, 0, 0.1)}
            ${num('y', 'Y (m)', obstacle.y, 0, 0.1)}
            ${num('width', 'Dài (m)', obstacle.width, 0.01, 0.1)}
            ${num('depth', 'Rộng (m)', obstacle.depth, 0.01, 0.1)}
            <p class="live full" data-live="obstacle-check"></p>
            <div class="form-actions">
              <button type="button" class="danger push-left" data-remove-obstacle="${obstacle.id}">Xoá</button>
              <button type="submit">Áp dụng</button>
            </div>
          </form>
        </section>
      `;
    }
    return '<p class="hint">Bấm vào một kệ hoặc cột trên mặt bằng để xem và sửa.</p>';
  }

  function rackEditForm(r) {
    return `
      <section class="section-plain">
        <h2>Kệ ${escapeHtml(r.code)} · ${slots(r.slotCount)}</h2>
        <form data-form="rack" class="grid-form">
          ${rackFields(r)}
          <p class="live full" data-live="rack-check"></p>
          <div class="form-actions">
            <button type="button" class="danger push-left" data-action="remove-rack">Xoá kệ</button>
            <button type="button" data-action="cancel-rack">Huỷ</button>
            <button type="submit">Áp dụng</button>
          </div>
        </form>
        <p class="hint">Chiếm chỗ ${formatMeters(r.footprintWidth)} × ${formatMeters(r.footprintDepth)} m. Khung được sinh lại khi lưu nháp; kệ đang có hàng thì chỉ dời/xoay được.</p>
      </section>
    `;
  }

  function rackList(room, state) {
    const totalSlots = room.racks.reduce((sum, r) => sum + (r.slotCount ?? 0), 0);
    return `
      <details class="section" open>
        <summary>Kệ (${room.racks.length}) · ${formatInt(totalSlots)} khung</summary>
        <ul class="rack-list">
          ${room.racks.map((r) => `
            <li><button type="button" data-rack-id="${r.id}" aria-pressed="${r.id === state.selectedRackId}">
              <span>${escapeHtml(r.code)}</span><span class="muted">${slots(r.slotCount)}</span>
            </button></li>`).join('')}
        </ul>
      </details>
    `;
  }

  function newRackForm(template) {
    return `
      <details class="section">
        <summary>Kệ mới</summary>
        <form data-form="new-rack" class="grid-form">
          <label class="full">Mã <input value="${nextRackCode()}" disabled /></label>
          ${rackFields(template, { position: false })}
          <div class="form-actions"><button type="button" data-action="place-rack">Đặt bằng chuột</button></div>
        </form>
        <p class="hint">Bấm "Đặt bằng chuột" rồi bấm lên mặt bằng; phím R để xoay, Esc để huỷ.</p>
      </details>
    `;
  }

  function obstacleSection(room, state) {
    const label = (o) => `${o.kind === 'Wall' ? 'Tường' : 'Cột'} (${formatMeters(o.x)}; ${formatMeters(o.y)})`;
    return `
      <details class="section">
        <summary>Tường, cột (${room.obstacles.length})</summary>
        <ul class="rack-list">
          ${room.obstacles.map((o) => `
            <li class="row">
              <button type="button" data-obstacle-id="${o.id}" aria-pressed="${o.id === state.selectedObstacleId}">
                <span>${label(o)}</span><span class="muted">${formatMeters(o.width)} × ${formatMeters(o.depth)}</span>
              </button>
              <button type="button" class="icon danger" title="Xoá" data-remove-obstacle="${o.id}">×</button>
            </li>`).join('')}
        </ul>
        <form data-form="obstacle" class="grid-form">
          <label class="full">Loại
            <select name="kind"><option value="Column">Cột</option><option value="Wall">Tường</option></select>
          </label>
          ${num('x', 'X (m)', 0, 0, 0.1)}
          ${num('y', 'Y (m)', 0, 0, 0.1)}
          ${num('width', 'Dài (m)', 0.4, 0.01, 0.1)}
          ${num('depth', 'Rộng (m)', 0.4, 0.01, 0.1)}
          <div class="form-actions"><button type="submit">Thêm</button></div>
        </form>
      </details>
    `;
  }

  function rackFields(r, { position = true } = {}) {
    return `
      ${position ? num('x', 'X (m)', r.x, 0, 0.1) + num('y', 'Y (m)', r.y, 0, 0.1) : ''}
      <label>Xoay
        <select name="rotation" data-type="int">
          <option value="0" ${r.rotation === 0 ? 'selected' : ''}>0°</option>
          <option value="90" ${r.rotation === 90 ? 'selected' : ''}>90°</option>
        </select>
      </label>
      ${num('levels', 'Số tầng', r.levels, 1, 1, 'int')}
      ${num('levelHeight', 'Cao tầng (m)', r.levelHeight, 0.1, 0.1)}
      ${num('bays', 'Số ô hàng', r.bays, 1, 1, 'int')}
      ${num('bayWidth', 'Rộng ô (m)', r.bayWidth, 0.1, 0.1)}
      ${num('depth', 'Sâu (m)', r.depth, 0.1, 0.1)}
      ${num('maxWeight', 'Tải khung (kg)', r.maxWeight, 1, 50)}
      <label class="check"><input type="checkbox" name="hasTop" ${r.hasTop ? 'checked' : ''} /> Có nóc</label>
    `;
  }

  // ---------- phần cập nhật liên tục ----------
  function updateDraftBar(state) {
    const status = root.querySelector('[data-role="draft-status"]');
    if (!status) return;
    if (state.saving) status.textContent = 'Đang lưu…';
    else if (!state.dirty) status.textContent = 'Đã lưu';
    else status.textContent = state.draftIssue ? `Chưa lưu · ${state.draftIssue}` : 'Có thay đổi chưa lưu';
    status.className = 'draft-status' + (state.dirty ? (state.draftIssue ? ' error' : ' dirty') : '');
    root.querySelector('[data-action="save-draft"]').disabled = !state.dirty || state.saving;
    root.querySelector('[data-action="discard-draft"]').disabled = !state.dirty || state.saving;
  }

  function updateLive(state) {
    updateDraftBar(state);
    const line = root.querySelector('[data-live="rack-check"]');
    if (!line) return;
    const p = state.preview;
    if (!p || p.source !== 'form' || p.rackId !== state.selectedRackId) {
      line.textContent = '';
      line.className = 'live full';
    } else if (p.isValid === null) {
      line.textContent = 'Đang kiểm tra…';
      line.className = 'live full';
    } else if (p.isValid) {
      line.textContent = `Đặt được · chiếm ${formatMeters(p.footprintWidth)} × ${formatMeters(p.footprintDepth)} m`;
      line.className = 'live full ok';
    } else {
      line.textContent = p.reason;
      line.className = 'live full error';
    }
  }

  // ---------- sự kiện ----------
  function onClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.rackId) setState({ selectedRackId: Number(t.dataset.rackId), selectedObstacleId: null });
    if (t.dataset.obstacleId) setState({ selectedObstacleId: Number(t.dataset.obstacleId), selectedRackId: null });
    if (t.dataset.removeObstacle) {
      const obstacle = getState().layout?.obstacles.find((o) => o.id === Number(t.dataset.removeObstacle));
      if (obstacle) removeObstacle(obstacle);
    }
    if (t.dataset.action === 'save-draft') saveDraft();
    if (t.dataset.action === 'discard-draft') discardDraft();
    if (t.dataset.action === 'remove-rack' && selectedRack()) removeRack(selectedRack());
    if (t.dataset.action === 'place-rack') {
      clearPreview();
      setState({ tool: 'add-rack' });
    }
    if (t.dataset.action === 'cancel-rack') {
      clearPreview();
      formNonce++;
      render(getState());
    }
  }

  function onInput(e) {
    const form = e.target.closest('form');
    if (form?.dataset.form === 'rack') {
      // Gõ tới đâu, bóng mờ và dòng kiểm tra cập nhật tới đó (server trả lời sau ~120 ms).
      const rack = selectedRack();
      if (!rack) return;
      const request = { ...rackToRequest(rack), ...readForm(form) };
      // Chưa đổi xoay/kích thước thì dùng luôn footprint server đã trả cho kệ này để bóng hiện ngay;
      // đổi rồi thì chờ server trả kích thước mới, không tự tính.
      const sameShape = request.rotation === rack.rotation && request.bays === rack.bays
        && request.bayWidth === rack.bayWidth && request.depth === rack.depth;
      const footprint = sameShape ? { width: rack.footprintWidth, depth: rack.footprintDepth } : null;
      previewRack(request, { rackId: rack.id, source: 'form', footprint });
    } else if (form?.dataset.form === 'new-rack') {
      setState({ newRack: { ...getState().newRack, ...readForm(form) } });
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const values = readForm(form);
    if (form.dataset.form === 'room') {
      await saveRoom(values);
    } else if (form.dataset.form === 'rack') {
      const rack = selectedRack();
      if (rack) await saveRack(rack, { ...rackToRequest(rack), ...values });
      clearPreview();
    } else if (form.dataset.form === 'obstacle-edit') {
      const obstacle = selectedObstacle();
      if (obstacle) updateObstacle(obstacle, values);
    } else if (form.dataset.form === 'obstacle') {
      await addObstacle(values);
    }
  }

  subscribe(render);
  render(getState());
}

// ---------- tiện ích ----------

/** Số khung; null = chưa biết (kệ mới hoặc vừa đổi cấu hình, server sinh khi lưu nháp). */
function slots(count) {
  return count == null ? 'chưa lưu' : `${count} khung`;
}

function num(name, label, value, min, step, type = 'number') {
  // Số thực: step="any". Nếu để step="0.1" cùng min="0.01" thì trình duyệt chỉ nhận 0,01; 0,11; 0,21…
  // (bước tính từ min) và chặn 0,4. Đúng sai thật do server kiểm tra. Số nguyên (tầng, ô hàng) giữ bước 1.
  const stepAttr = type === 'int' ? step : 'any';
  return `<label>${label}<input type="number" name="${name}" value="${value}" min="${min}" step="${stepAttr}" data-type="${type}" required /></label>`;
}

/** Đọc form thành object đúng kiểu cho API: số thực, số nguyên, true/false, chữ. */
function readForm(form) {
  const values = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') values[el.name] = el.checked;
    else if (el.dataset.type === 'int') values[el.name] = parseInt(el.value, 10);
    else if (el.dataset.type === 'number') values[el.name] = Number(el.value);
    else values[el.name] = el.value;
  }
  return values;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
