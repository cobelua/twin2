import {
  addObstacle, addRack, clearPreview, moveRack, nextRackCode, previewRack, rackToRequest, removeObstacle, removeRack,
  rotateRack, snap, stopPreviewCheck,
} from '../state/actions.js';
import { getState, selectedObstacle, selectedRack, setState, showMessage, subscribe } from '../state/store.js';
import { formatMeters } from '../ui/format.js';

// Editor 2D: vẽ mặt bằng nhìn từ trên xuống bằng <canvas> và các công cụ chuột.
// Toạ độ thế giới = mét, gốc (0; 0) ở góc trên trái phòng, X sang phải, Y đi xuống (đúng như server).
// Toạ độ màn hình = px CSS. Đổi qua lại bằng view { scale (px trên 1 m), offsetX, offsetY }:
//   sx = offsetX + x × scale        x = (sx − offsetX) / scale
//
// Editor chỉ VẼ và GỬI: kích thước kệ (kể cả khi xoay) lấy từ server, đặt được hay không do server trả lời
// qua POST /racks/validate (bóng mờ xanh/đỏ). Snap theo lưới là việc của giao diện, server nhận số mét bất kỳ.
//
// Công cụ (state.tool):
//   select     bấm để chọn kệ/vật cản; kéo kệ để dời (bóng mờ theo chuột, thả để lưu); kéo chỗ trống để dời màn hình
//   add-rack   bóng mờ kệ mới theo chuột, bấm để đặt (cấu hình lấy từ state.newRack, mã tự sinh)
//   add-column bấm để đặt cột 0,4 × 0,4 m
// Phím: R xoay (đang kéo / đang đặt → xoay bóng; đang chọn kệ → xoay kệ thật), Esc huỷ.

const MIN_SCALE = 4;        // px / m: nhìn cả kho rất lớn
const MAX_SCALE = 400;      // px / m: soi chi tiết từng ô kệ
const FIT_PADDING = 32;     // px chừa quanh phòng khi "vừa khung"
const MIN_GRID_PX = 6;      // ô lưới nhỏ hơn thế này trên màn hình thì không vẽ (dày đặc, rối mắt)
const CLICK_TOLERANCE = 4;  // px: chuột xê dịch ít hơn thế giữa nhấn và thả thì coi là bấm, không phải kéo
const COLUMN_SIZE = 0.4;    // m: cột đặt bằng chuột (muốn cỡ khác thì nhập ở bảng bên)

export function createEditor2d(container, toolbar, { onCursor } = {}) {
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;   // nhận phím R / Esc khi đang làm việc trên canvas
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const view = { scale: 40, offsetX: 0, offsetY: 0 };
  let size = { width: 0, height: 0 };
  let fittedRoomKey = null;   // phòng nào đã "vừa khung"; đổi kích thước phòng thì vừa khung lại
  let gesture = null;         // thao tác chuột đang diễn ra (xem pointerdown)
  let hoverColumn = null;     // vị trí bóng cột khi dùng công cụ add-column
  let lastAddPos = null;      // vị trí (đã snap) lần cuối hỏi validate cho kệ mới: không hỏi lại khi chưa đổi ô

  const zoomLabel = buildToolbar();

  // ---------- đổi toạ độ ----------
  const toScreenX = (x) => view.offsetX + x * view.scale;
  const toScreenY = (y) => view.offsetY + y * view.scale;
  const toWorld = (sx, sy) => ({ x: (sx - view.offsetX) / view.scale, y: (sy - view.offsetY) / view.scale });

  function fit() {
    const room = getState().layout;
    if (!room || size.width === 0) return;
    const sx = (size.width - 2 * FIT_PADDING) / room.width;
    const sy = (size.height - 2 * FIT_PADDING) / room.depth;
    view.scale = clamp(Math.min(sx, sy), MIN_SCALE, MAX_SCALE);
    view.offsetX = (size.width - room.width * view.scale) / 2;
    view.offsetY = (size.height - room.depth * view.scale) / 2;
    draw();
  }

  function zoomAt(factor, sx, sy) {
    const before = toWorld(sx, sy);
    view.scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
    // Giữ nguyên điểm dưới con trỏ: zoom "vào chỗ đang nhìn" thay vì vào góc màn hình.
    view.offsetX = sx - before.x * view.scale;
    view.offsetY = sy - before.y * view.scale;
    draw();
  }

  // ---------- vẽ ----------
  function draw() {
    const colors = readColors();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // vẽ bằng px CSS, nét vẫn sắc trên màn hình mật độ cao
    ctx.fillStyle = colors.outside;
    ctx.fillRect(0, 0, size.width, size.height);
    zoomLabel.textContent = `${Math.round(view.scale)} px/m`;

    const state = getState();
    const room = state.layout;
    if (!room) return;

    const left = toScreenX(0);
    const top = toScreenY(0);
    const w = room.width * view.scale;
    const h = room.depth * view.scale;

    ctx.fillStyle = colors.floor;
    ctx.fillRect(left, top, w, h);
    if (state.showGrid) drawGrid(room, colors, left, top, w, h);

    for (const o of room.obstacles) drawObstacle(o, colors, o.id === state.selectedObstacleId);

    const movingId = state.preview?.source === 'drag' ? state.preview.rackId : null;
    for (const r of room.racks) drawRack(r, colors, r.id === state.selectedRackId, r.id === movingId);

    // Mép phòng vẽ sau kệ, đậm: đó chính là tường bao.
    ctx.strokeStyle = colors.roomEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, w, h);

    if (state.tool === 'add-column' && hoverColumn) drawColumnGhost(hoverColumn, colors);
    if (state.preview) drawPreview(state.preview, colors);
  }

  function drawGrid(room, colors, left, top, w, h) {
    const step = room.gridSize;
    if (step * view.scale < MIN_GRID_PX) return;

    ctx.lineWidth = 1;
    // Mỗi 1 m vẽ đậm hơn nếu bước lưới chia hết 1 m (ví dụ 0,5 m → cứ 2 ô một vạch đậm), để dễ đọc kích thước.
    const perMeter = Math.round(1 / step);
    const hasMajor = perMeter > 1 && Math.abs(perMeter * step - 1) < 1e-9;

    const cols = Math.floor(room.width / step + 1e-9);
    for (let i = 1; i <= cols; i++) {
      const x = Math.round(left + i * step * view.scale) + 0.5;
      if (x > left + w) break;
      ctx.strokeStyle = hasMajor && i % perMeter === 0 ? colors.gridMajor : colors.grid;
      line(x, top, x, top + h);
    }
    const rows = Math.floor(room.depth / step + 1e-9);
    for (let j = 1; j <= rows; j++) {
      const y = Math.round(top + j * step * view.scale) + 0.5;
      if (y > top + h) break;
      ctx.strokeStyle = hasMajor && j % perMeter === 0 ? colors.gridMajor : colors.grid;
      line(left, y, left + w, y);
    }
  }

  function drawObstacle(o, colors, selected) {
    const x = toScreenX(o.x);
    const y = toScreenY(o.y);
    const w = o.width * view.scale;
    const h = o.depth * view.scale;
    ctx.fillStyle = o.kind === 'Wall' ? colors.wall : colors.column;
    ctx.fillRect(x, y, w, h);
    if (selected) {
      ctx.strokeStyle = colors.rackSelected;
      ctx.lineWidth = 3;
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    }
  }

  function drawRack(r, colors, selected, moving) {
    const x = toScreenX(r.x);
    const y = toScreenY(r.y);
    const w = r.footprintWidth * view.scale;
    const h = r.footprintDepth * view.scale;

    ctx.globalAlpha = moving ? 0.35 : 1;   // kệ đang bị kéo: mờ đi ở chỗ cũ, bóng mờ hiện ở chỗ mới
    ctx.fillStyle = colors.rack;
    ctx.fillRect(x, y, w, h);

    // Vạch chia ô hàng: chạy dọc theo chiều dài kệ (X khi không xoay, Y khi xoay 90°). Chỉ để nhìn.
    ctx.strokeStyle = colors.rackBay;
    ctx.lineWidth = 1;
    for (let i = 1; i < r.bays; i++) {
      const d = i * r.bayWidth * view.scale;
      if (r.rotation === 90) line(x, y + d, x + w, y + d);
      else line(x + d, y, x + d, y + h);
    }

    ctx.strokeStyle = selected ? colors.rackSelected : colors.rackEdge;
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.strokeRect(x, y, w, h);
    drawLabel(r.code, x, y, w, h, colors.label);
    ctx.globalAlpha = 1;
  }

  function drawPreview(p, colors) {
    const x = toScreenX(p.request.x);
    const y = toScreenY(p.request.y);
    // Chưa có kích thước từ server (vừa xoay, đang chờ trả lời): chỉ đánh dấu góc, không đoán kích thước.
    if (p.footprintWidth == null) {
      ctx.fillStyle = colors.ghostPendingEdge;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const w = p.footprintWidth * view.scale;
    const h = p.footprintDepth * view.scale;
    const [fill, edge] = p.isValid === null
      ? [colors.ghostPending, colors.ghostPendingEdge]
      : p.isValid ? [colors.ghostOk, colors.ghostOkEdge] : [colors.ghostBad, colors.ghostBadEdge];

    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    drawLabel(p.request.code, x, y, w, h, edge);

    // Lý do không đặt được: hiện ngay trên bóng mờ, người dùng không phải nhìn xuống thanh trạng thái.
    if (p.isValid === false && p.reason) drawTag(p.reason, x, y - 6, edge);
  }

  function drawColumnGhost(c, colors) {
    ctx.fillStyle = colors.ghostPending;
    ctx.strokeStyle = colors.ghostPendingEdge;
    ctx.lineWidth = 1.5;
    const s = COLUMN_SIZE * view.scale;
    ctx.fillRect(toScreenX(c.x), toScreenY(c.y), s, s);
    ctx.strokeRect(toScreenX(c.x), toScreenY(c.y), s, s);
  }

  function drawLabel(text, x, y, w, h, color) {
    // Nhãn ở giữa; quá nhỏ trên màn hình thì bỏ cho đỡ rối.
    const fontPx = Math.min(14, Math.min(w, h) * 0.6);
    if (fontPx < 8) return;
    ctx.fillStyle = color;
    ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2);
  }

  function drawTag(text, x, bottom, color) {
    ctx.font = '600 12px system-ui, sans-serif';
    const padding = 4;
    const width = ctx.measureText(text).width + padding * 2;
    const tagX = clamp(x, 4, Math.max(4, size.width - width - 4));
    const tagY = Math.max(4, bottom - 20);
    ctx.fillStyle = color;
    ctx.fillRect(tagX, tagY, width, 20);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tagX + padding, tagY + 10);
  }

  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // ---------- tìm vật dưới chuột ----------
  const inside = (p, x, y, w, h) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;

  /** Kệ dưới điểm (mét). Duyệt ngược để lấy kệ vẽ sau cùng (nằm trên). */
  function rackAt(p) {
    const racks = getState().layout?.racks ?? [];
    for (let i = racks.length - 1; i >= 0; i--) {
      const r = racks[i];
      if (inside(p, r.x, r.y, r.footprintWidth, r.footprintDepth)) return r;
    }
    return null;
  }

  function obstacleAt(p) {
    const obstacles = getState().layout?.obstacles ?? [];
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      if (inside(p, o.x, o.y, o.width, o.depth)) return o;
    }
    return null;
  }

  // ---------- chuột ----------
  // gesture:
  //   { kind: 'pending', startX, startY, rack | obstacle | null }  vừa nhấn, chưa biết là bấm hay kéo
  //   { kind: 'pan', startX, startY, offsetX, offsetY }            kéo chỗ trống / nút giữa: dời màn hình
  //   { kind: 'move', rack, grabX, grabY, rotation, lastX, lastY } kéo kệ: bóng mờ theo chuột

  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus();
    const state = getState();
    if (!state.layout) return;
    const p = toWorld(e.offsetX, e.offsetY);

    if (e.button === 1) {
      startPan(e);
      return;
    }
    if (e.button !== 0) return;

    if (state.tool === 'add-rack') {
      placeNewRack();
      return;
    }
    if (state.tool === 'add-column') {
      placeColumn(p);
      return;
    }

    canvas.setPointerCapture(e.pointerId);
    const rack = rackAt(p);
    gesture = {
      kind: 'pending', startX: e.offsetX, startY: e.offsetY, downAt: p,
      rack, obstacle: rack ? null : obstacleAt(p),
      offsetX: view.offsetX, offsetY: view.offsetY,
    };
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = toWorld(e.offsetX, e.offsetY);
    reportCursor(p);
    const state = getState();

    if (!gesture) {
      if (state.tool === 'add-rack') updateNewRackPreview(p);
      else if (state.tool === 'add-column') {
        hoverColumn = { x: snap(p.x), y: snap(p.y) };
        draw();
      } else {
        canvas.style.cursor = rackAt(p) ? 'move' : '';
      }
      return;
    }

    if (gesture.kind === 'pending') {
      if (Math.hypot(e.offsetX - gesture.startX, e.offsetY - gesture.startY) < CLICK_TOLERANCE) return;
      if (gesture.rack) {
        const r = gesture.rack;
        setState({ selectedRackId: r.id, selectedObstacleId: null });
        // Giữ khoảng cách từ chỗ NHẤN chuột tới góc kệ, để kệ không "nhảy" góc vào con trỏ.
        // Phải dùng điểm lúc nhấn (downAt), không phải điểm hiện tại: lúc này chuột đã đi được một đoạn.
        const { downAt } = gesture;
        gesture = { kind: 'move', rack: r, grabX: downAt.x - r.x, grabY: downAt.y - r.y, rotation: r.rotation, lastX: null, lastY: null };
      } else {
        gesture = { ...gesture, kind: 'pan' };
      }
    }

    if (gesture.kind === 'pan') {
      canvas.style.cursor = 'grabbing';
      view.offsetX = gesture.offsetX + (e.offsetX - gesture.startX);
      view.offsetY = gesture.offsetY + (e.offsetY - gesture.startY);
      draw();
    } else if (gesture.kind === 'move') {
      updateMovePreview(snap(p.x - gesture.grabX), snap(p.y - gesture.grabY));
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    canvas.style.cursor = '';

    if (g.kind === 'pending') {
      // Bấm (không kéo): chọn kệ, hoặc vật cản, hoặc bỏ chọn.
      setState({ selectedRackId: g.rack?.id ?? null, selectedObstacleId: g.obstacle?.id ?? null });
    } else if (g.kind === 'move') {
      // Lấy vị trí ngay lúc thả: kéo nhanh thì lần di chuột cuối có thể còn ở giữa đường.
      const p = toWorld(e.offsetX, e.offsetY);
      dropMovedRack(g, snap(p.x - g.grabX), snap(p.y - g.grabY));
    }
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointerleave', () => {
    onCursor?.(null);
    if (hoverColumn) {
      hoverColumn = null;
      draw();
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY);
  }, { passive: false });

  function startPan(e) {
    canvas.setPointerCapture(e.pointerId);
    gesture = { kind: 'pan', startX: e.offsetX, startY: e.offsetY, offsetX: view.offsetX, offsetY: view.offsetY };
  }

  // ---------- dời kệ ----------
  function updateMovePreview(x, y) {
    const g = gesture;
    if (x === g.lastX && y === g.lastY) return;   // chưa sang ô lưới khác: không hỏi lại server
    g.lastX = x;
    g.lastY = y;
    const r = g.rack;
    // Kích thước gợi ý = kích thước server đã trả cho chính kệ này (khi chưa xoay), để bóng hiện ngay.
    const footprint = g.rotation === r.rotation ? { width: r.footprintWidth, depth: r.footprintDepth } : null;
    previewRack({ ...rackToRequest(r), x, y, rotation: g.rotation }, { rackId: r.id, source: 'drag', footprint });
  }

  async function dropMovedRack(g, x, y) {
    const preview = getState().preview;
    const r = g.rack;
    if (x === r.x && y === r.y && g.rotation === r.rotation) {
      clearPreview();
      return;
    }
    // Bóng mờ đúng ở chỗ thả và đã biết chắc là đỏ thì không gửi.
    // Còn lại (đang chờ, hoặc thả ở chỗ chưa kịp kiểm tra) cứ gửi: server luôn kiểm tra lại lần nữa.
    const checkedHere = preview && preview.request.x === x && preview.request.y === y && preview.request.rotation === g.rotation;
    if (checkedHere && preview.isValid === false) {
      showMessage(`Không dời được ${r.code}: ${preview.reason}`, 'error');
      clearPreview();
      return;
    }
    stopPreviewCheck();   // đang lưu thật rồi, không cần hỏi validate nữa
    await moveRack(r, x, y, g.rotation);
    clearPreview();
  }

  // ---------- đặt kệ mới ----------
  function newRackRequest(x, y) {
    return { ...getState().newRack, code: nextRackCode(), x, y, productTypeId: null };
  }

  function updateNewRackPreview(p) {
    const x = snap(p.x);
    const y = snap(p.y);
    if (lastAddPos && lastAddPos.x === x && lastAddPos.y === y) return;
    lastAddPos = { x, y };
    previewRack(newRackRequest(x, y), { source: 'add' });
  }

  async function placeNewRack() {
    const preview = getState().preview;
    if (!preview || preview.source !== 'add') return;
    if (preview.isValid === false) {
      showMessage(`Không đặt được: ${preview.reason}`, 'error');
      return;
    }
    const created = await addRack(preview.request);
    if (created) {
      lastAddPos = null;
      clearPreview();
      setState({ tool: 'select' });
    }
  }

  // ---------- đặt cột ----------
  async function placeColumn(p) {
    const created = await addObstacle({ kind: 'Column', x: snap(p.x), y: snap(p.y), width: COLUMN_SIZE, depth: COLUMN_SIZE });
    if (created) {
      hoverColumn = null;
      setState({ tool: 'select' });
    }
  }

  // ---------- phím ----------
  window.addEventListener('keydown', (e) => {
    // Đang gõ trong ô nhập (bảng bên) thì phím R là chữ R, không phải lệnh xoay.
    if (e.target.closest?.('input, select, textarea') || getState().step !== 'layout') return;

    // Delete (hoặc Backspace trên máy Mac): xoá kệ / vật cản đang chọn, có hỏi lại.
    if ((e.key === 'Delete' || e.key === 'Backspace') && getState().tool === 'select' && !gesture) {
      if (selectedRack()) removeRack(selectedRack());
      else if (selectedObstacle()) removeObstacle(selectedObstacle());
      return;
    }

    if (e.key === 'Escape') {
      gesture = null;
      lastAddPos = null;
      hoverColumn = null;
      clearPreview();
      setState({ tool: 'select' });
      return;
    }
    if (e.key !== 'r' && e.key !== 'R') return;
    e.preventDefault();

    const state = getState();
    if (gesture?.kind === 'move') {
      // Xoay bóng đang kéo; lưu khi thả chuột.
      gesture.rotation = gesture.rotation === 90 ? 0 : 90;
      const x = gesture.lastX ?? gesture.rack.x;
      const y = gesture.lastY ?? gesture.rack.y;
      gesture.lastX = null;
      updateMovePreview(x, y);
    } else if (state.tool === 'add-rack') {
      setState({ newRack: { ...state.newRack, rotation: state.newRack.rotation === 90 ? 0 : 90 } });
      if (lastAddPos) {
        const { x, y } = lastAddPos;
        lastAddPos = null;
        updateNewRackPreview({ x, y });
      }
    } else if (state.tool === 'select' && selectedRack()) {
      rotateRack(selectedRack());   // xoay kệ thật tại chỗ; server từ chối thì hiện lý do
    }
  });

  function reportCursor(p) {
    const room = getState().layout;
    if (!room || !onCursor) return;
    const isInside = p.x >= 0 && p.y >= 0 && p.x <= room.width && p.y <= room.depth;
    onCursor(isInside ? { x: p.x, y: p.y, rack: rackAt(p) } : null);
  }

  // ---------- thanh công cụ ----------
  function buildToolbar() {
    toolbar.innerHTML = `
      <div class="tool-group" role="group" aria-label="Công cụ">
        <button type="button" data-tool="select" title="Bấm để chọn, kéo kệ để dời, kéo chỗ trống để dời màn hình">Chọn / dời</button>
        <button type="button" data-tool="add-rack" title="Bấm lên mặt bằng để đặt kệ mới (cấu hình ở bảng bên)">Đặt kệ</button>
        <button type="button" data-tool="add-column" title="Bấm lên mặt bằng để đặt cột 0,4 × 0,4 m">Đặt cột</button>
      </div>
      <span class="toolbar-sep"></span>
      <button type="button" data-action="fit" title="Đưa cả phòng vào khung nhìn">Vừa khung</button>
      <button type="button" data-action="zoom-out" title="Thu nhỏ">−</button>
      <span class="zoom" data-role="zoom"></span>
      <button type="button" data-action="zoom-in" title="Phóng to">+</button>
      <label><input type="checkbox" data-action="grid" /> Lưới <span data-role="grid-size"></span></label>
      <span class="toolbar-hint" data-role="hint"></span>
    `;
    toolbar.addEventListener('click', (e) => {
      const tool = e.target.closest('[data-tool]')?.dataset.tool;
      if (tool) {
        lastAddPos = null;
        hoverColumn = null;
        clearPreview();
        setState({ tool });
      }
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'fit') fit();
      if (action === 'zoom-in') zoomAt(1.25, size.width / 2, size.height / 2);
      if (action === 'zoom-out') zoomAt(0.8, size.width / 2, size.height / 2);
    });
    toolbar.querySelector('[data-action="grid"]').addEventListener('change', (e) => {
      setState({ showGrid: e.target.checked });
    });
    return toolbar.querySelector('[data-role="zoom"]');
  }

  const HINTS = {
    select: 'Kéo kệ để dời · R xoay · Delete xoá kệ/cột đang chọn',
    'add-rack': 'Bấm để đặt · R xoay · Esc huỷ',
    'add-column': 'Bấm để đặt cột · Esc huỷ',
  };

  function syncToolbar(state) {
    toolbar.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === state.tool)));
    toolbar.querySelector('[data-action="grid"]').checked = state.showGrid;
    toolbar.querySelector('[data-role="grid-size"]').textContent =
      state.layout ? `${formatMeters(state.layout.gridSize)} m` : '';
    toolbar.querySelector('[data-role="hint"]').textContent = HINTS[state.tool] ?? '';
    canvas.classList.toggle('placing', state.tool !== 'select');
  }

  // ---------- kích thước, dữ liệu ----------
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    size = { width: container.clientWidth, height: container.clientHeight };
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    // Mở phòng khác lúc editor đang ẩn (kích thước 0) thì chưa "vừa khung" được; làm bù khi editor hiện lại.
    fitIfNewRoom(getState());
    draw();
  }

  function fitIfNewRoom(state) {
    const room = state.layout;
    const key = room ? `${room.id}:${room.width}x${room.depth}` : null;
    if (key && key !== fittedRoomKey && size.width > 0) {
      fittedRoomKey = key;
      fit();
    }
  }

  new ResizeObserver(resize).observe(container);
  subscribe((state) => {
    syncToolbar(state);
    fitIfNewRoom(state);
    draw();
  });
  syncToolbar(getState());

  return { draw, fit };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function readColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    outside: v('--c2d-outside'),
    floor: v('--c2d-floor'),
    grid: v('--c2d-grid'),
    gridMajor: v('--c2d-grid-major'),
    roomEdge: v('--c2d-room-edge'),
    wall: v('--c2d-wall'),
    column: v('--c2d-column'),
    rack: v('--c2d-rack'),
    rackEdge: v('--c2d-rack-edge'),
    rackBay: v('--c2d-rack-bay'),
    rackSelected: v('--c2d-rack-selected'),
    label: v('--c2d-label'),
    ghostOk: v('--c2d-ghost-ok'),
    ghostOkEdge: v('--c2d-ghost-ok-edge'),
    ghostBad: v('--c2d-ghost-bad'),
    ghostBadEdge: v('--c2d-ghost-bad-edge'),
    ghostPending: v('--c2d-ghost-pending'),
    ghostPendingEdge: v('--c2d-ghost-pending-edge'),
  };
}
