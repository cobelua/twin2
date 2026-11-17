/**
 * Hộp hỏi lại nằm trong trang (thẻ <dialog>), thay cho window.confirm().
 * Lý do: trình duyệt nhúng (khung xem trước trong ứng dụng) không hiện hộp confirm() mà trả false ngay,
 * nên mọi thao tác "hỏi rồi mới làm" im lặng không làm gì. <dialog> chạy được ở mọi trình duyệt.
 *
 * Trả Promise<boolean>: true khi bấm nút đồng ý; false khi bấm Huỷ hoặc nhấn Esc.
 * Kết quả được trả ngay trong lúc xử lý nút bấm, không đợi sự kiện "close" của <dialog>
 * (sự kiện đó đến muộn hoặc không đến khi khung trình duyệt đang bị ẩn).
 */
export function askConfirm(message, { okText = 'Đồng ý', cancelText = 'Huỷ', danger = false } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = `
      <div>
        <p data-role="message"></p>
        <div class="form-actions">
          <button type="button" data-role="cancel"></button>
          <button type="button" data-role="ok" class="${danger ? 'danger' : 'primary'}"></button>
        </div>
      </div>
    `;
    // textContent (không phải innerHTML): nội dung có mã kệ do người dùng gõ, không được hiểu là HTML.
    dialog.querySelector('[data-role="message"]').textContent = message;
    dialog.querySelector('[data-role="cancel"]').textContent = cancelText;
    dialog.querySelector('[data-role="ok"]').textContent = okText;

    let done = false;
    const finish = (answer) => {
      if (done) return;   // bấm nút rồi mới tới sự kiện close: chỉ tính lần đầu
      done = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(answer);
    };

    dialog.querySelector('[data-role="ok"]').addEventListener('click', () => finish(true));
    dialog.querySelector('[data-role="cancel"]').addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });   // Esc
    dialog.addEventListener('close', () => finish(false));

    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector('[data-role="cancel"]').focus();   // Enter vô ý không xoá nhầm
  });
}
