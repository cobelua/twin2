import { createRobotDigitize } from './robotDigitize.js';
import { createRobotVerify } from './robotVerify.js';

// Tab "Robot" của kho đang mở, hai chế độ ứng với hai câu chuyện:
// - Kiểm chứng thiết kế (BMW/KION): robot ảo dùng bản vẽ làm bản đồ, kiểm tra mọi khung có tới được không.
// - Số hoá kho cũ (Boston Dynamics Spot): thả một kho 3D đóng vai kho thật, robot tự quét rồi dựng kho mới.
// Phần chở hàng (cũng là câu chuyện 1) nằm ở Kho 3D, bảng "Robot".

export function createRobotView(root) {
  root.innerHTML = `
    <div class="robot-modes" role="tablist">
      <button type="button" data-mode="verify" aria-pressed="true">Kiểm chứng thiết kế</button>
      <button type="button" data-mode="digitize" aria-pressed="false">Số hoá kho cũ</button>
    </div>
    <div class="robot-pane" data-pane="verify"></div>
    <div class="robot-pane" data-pane="digitize" hidden></div>
  `;
  const panes = {
    verify: root.querySelector('[data-pane="verify"]'),
    digitize: root.querySelector('[data-pane="digitize"]'),
  };
  const views = { verify: createRobotVerify(panes.verify), digitize: null };   // Số hoá tạo khi mở lần đầu (có cảnh 3D)
  let mode = 'verify';
  let layout = null;
  let visible = false;

  root.querySelector('.robot-modes').addEventListener('click', (e) => {
    const next = e.target.closest('[data-mode]')?.dataset.mode;
    if (!next || next === mode) return;
    views[mode]?.hide();
    mode = next;
    for (const [name, pane] of Object.entries(panes)) pane.hidden = name !== mode;
    root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    if (visible) current().show(layout);
  });

  function current() {
    if (mode === 'digitize') views.digitize ??= createRobotDigitize(panes.digitize);
    return views[mode];
  }

  return {
    show(nextLayout) {
      layout = nextLayout;
      visible = true;
      current().show(layout);
    },
    hide() {
      visible = false;
      views.verify.hide();
      views.digitize?.hide();
    },
  };
}
