// Mọi lời gọi backend đi qua đây. Frontend không chứa luật nghiệp vụ: kiểm tra đặt kệ, sinh khung,
// tính footprint… đều do server làm; frontend chỉ gửi dữ liệu và vẽ kết quả.

/** Lỗi từ API, mang theo mã HTTP và câu lý do ("detail" của ProblemDetails) để hiện thẳng cho người dùng. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ.');
  }

  if (!res.ok) {
    // Lỗi nghiệp vụ là ProblemDetails: { status, detail }. Lỗi [Range] của ASP.NET có thêm "errors".
    let message = `${method} /api${path} → ${res.status}`;
    try {
      const problem = await res.json();
      if (problem.detail) message = problem.detail;
      else if (problem.errors) message = Object.values(problem.errors).flat().join(' ');
      else if (problem.title) message = problem.title;
    } catch { /* body không phải JSON: giữ câu mặc định */ }
    throw new ApiError(res.status, message);
  }

  return res.status === 204 ? null : res.json();
}

export const api = {
  health: () => request('GET', '/health'),

  // ---- phòng và mặt bằng (mọi số đo bằng mét). Kệ, tường, cột đều nằm dưới /rooms/{roomId} ----
  /** Danh sách phòng: { id, name, width, depth, gridSize, rackCount, obstacleCount, slotCount }. */
  listRooms: () => request('GET', '/rooms'),
  /** Tạo phòng → { id }. Tên trùng thì 409. */
  createRoom: (room) => request('POST', '/rooms', room),
  /** Một phòng + kệ (có footprintWidth/footprintDepth, slotCount) + tường/cột. 404 nếu không có. */
  getRoom: (roomId) => request('GET', `/rooms/${roomId}`),

  // Giao diện làm việc trên BẢN NHÁP trong bộ nhớ, chỉ có hai lời gọi liên quan tới nó:
  /** Lưu nháp: gửi cả phòng (thông số, tường, cột, kệ + version đã tải). → { version, racks: [{id, code}], obstacleIds }. */
  saveLayout: (roomId, layout) => request('PUT', `/rooms/${roomId}/layout`, layout),
  // ---- kho 3D, loại hàng, nhập lô, xếp (theo phòng, trừ loại hàng và nhập lô) ----
  /** Mọi khung của phòng: { id, rackId, rackCode, code, level, bay, isTop, palletId, palletCode, typeCode, color }. */
  listSlots: (roomId) => request('GET', `/rooms/${roomId}/slots`),
  listProductTypes: () => request('GET', '/product-types'),
  createProductType: (type) => request('POST', '/product-types', type),
  /**
   * Kiểm tra lô { lines: [{ quantity, length, width, height, weight, productTypeId }] } với MỌI kho, không ghi gì →
   * { total, lines, rooms: [{ roomId, roomName, placeable, missing, notes }], plan: { placed, rooms: [{ roomId, roomName, count }], rejected } }.
   */
  checkBatch: (batch) => request('POST', '/batches/check', batch),
  /** Nhập lô: lưu lô và pallet (chưa vào khung) → { batchId, code, palletCount }. */
  receiveBatch: (batch) => request('POST', '/batches', batch),
  /** Xếp pallet chưa có khung của lô vào MỘT kho → { placements, rejected, alreadyPlaced }. Bấm lại không xếp đôi. */
  allocateBatch: (roomId, batchId) => request('POST', `/rooms/${roomId}/batches/${batchId}/allocate`),
  /** Nhập theo đề xuất: chia pallet chưa có khung của lô ra các kho → { placed, total, rooms: [{ roomId, roomName, count, placements }], rejected }. */
  distributeBatch: (batchId) => request('POST', `/batches/${batchId}/distribute`),
  /** Đặt lại: lấy mọi pallet ra khỏi khung của phòng → { cleared }. */
  resetPlacements: (roomId) => request('POST', `/rooms/${roomId}/placements/reset`),

  /** Kiểm tra thử cả bản nháp (bóng mờ): luôn 200 nếu có phòng. → { isValid, reason, racks: [{code, isValid, reason, footprintWidth, footprintDepth}] }. Không lưu gì. */
  validateLayout: (roomId, layout) => request('POST', `/rooms/${roomId}/layout/validate`, layout),
};
