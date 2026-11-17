import { api } from '../api/client.js';
import { getState, goToStep, loadSlots, setState, showMessage, subscribe } from '../state/store.js';
import { askConfirm } from './confirm.js';

// Bảng nhỏ trong màn Kho 3D: chỉ để XEM kho đang mở. Nhập lô nằm ở màn riêng (Nhập lô hàng), vì lập lô trước rồi
// hệ thống mới chọn kho. Ở đây: số khung đã có hàng, phát lại hiệu ứng bay của lần xếp gần nhất, đặt lại kho.

export function createStockPanel(root) {
  let busy = false;
  let collapsed = false;
  let shownKey = null;

  root.addEventListener('click', onClick);

  subscribe((state) => {
    if (state.step !== 'warehouse') {
      shownKey = null;
      return;
    }
    // Chỉ vẽ lại khi dữ liệu liên quan đổi.
    const key = [state.currentRoomId, state.layout?.name, state.slots, state.lastPlacements, busy, collapsed];
    if (shownKey && key.every((v, i) => v === shownKey[i])) return;
    shownKey = key;
    render(state);
  });

  function render(state = getState()) {
    const header = `<div class="dock-header"><strong>Kho ${escapeHtml(state.layout?.name ?? '')}</strong>
      <button type="button" data-action="toggle-dock">${collapsed ? 'Mở ▸' : 'Thu gọn ▾'}</button></div>`;
    if (state.currentRoomId == null) {
      root.innerHTML = `${header}<div class="dock-body" ${collapsed ? 'hidden' : ''}><p class="hint">Chưa mở kho nào.</p></div>`;
      return;
    }
    const filled = state.slots.filter((s) => s.palletId != null).length;
    root.innerHTML = `
      ${header}
      <div class="dock-body" ${collapsed ? 'hidden' : ''}>
        <p>${filled} / ${state.slots.length} khung đã có hàng.</p>
        <div class="receive-actions">
          <button type="button" class="primary" data-action="receive">Nhập lô hàng</button>
          <button type="button" data-action="replay" ${state.lastPlacements ? '' : 'disabled'}>Phát lại robot chở hàng</button>
        </div>
        <div class="receive-footer">
          <button type="button" class="danger" data-action="reset" ${busy || filled === 0 ? 'disabled' : ''}>Đặt lại kho (lấy mọi pallet ra khỏi khung)</button>
        </div>
      </div>
    `;
  }

  function onClick(e) {
    const action = e.target.closest('button[data-action]')?.dataset.action;
    if (action === 'toggle-dock') { collapsed = !collapsed; render(); }
    else if (action === 'receive') goToStep('receive');
    else if (action === 'replay') setState({ pendingPlacements: getState().lastPlacements });
    else if (action === 'reset') doReset();
  }

  async function doReset() {
    if (!await askConfirm('Lấy mọi pallet ra khỏi khung của kho này? Pallet và lô vẫn còn, chỉ chưa có khung.', { okText: 'Đặt lại', danger: true })) return;
    busy = true;
    render();
    try {
      const { cleared } = await api.resetPlacements(getState().currentRoomId);
      setState({ lastPlacements: null, pendingPlacements: null });   // không còn gì để phát lại
      await loadSlots();
      showMessage(`Đã lấy ${cleared} pallet ra khỏi khung.`);
    } catch (err) {
      showMessage(err.message, 'error');
    } finally {
      busy = false;
      render();
    }
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
