import { OCCUPIED } from './gridMap.js';

// Bản đồ lưới (robot thấy gì) → mặt bằng (tường, cột, kệ bằng mét), cùng dạng với GET /api/rooms/{id}.
// Kết quả là BẢN NHÁP cho người dùng sửa rồi bấm Lưu nháp (PUT /layout có sẵn kiểm tra luật đặt kệ);
// hàm này không lưu gì, không gọi API.
//
// Các bước:
// 1. Gom ô có vật CAO (≥ minHeight) liền nhau (8 hướng) thành từng khối. Vật thấp (dây điện, pallet rỗng…) là đồ
//    vương vãi trên sàn, không thuộc thiết kế kho nên bỏ. `ignoreEdge` > 0: bỏ dải sát mép phòng (tường bao của
//    mô hình 3D chính là mép phòng, không phải vật cản trong phòng).
// 2. Mỗi khối tìm HƯỚNG bằng phân tích thành phần chính (PCA): trục dài là hướng phương sai lớn nhất của các ô.
//    Chiếu các ô lên hai trục ra chiều dài và chiều rộng THẬT của khối, kể cả khi nó nằm chéo.
//    Cảm biến chỉ thấy MẶT NGOÀI của kệ nên khối kệ là một "vòng" rỗng ruột; trục và kích thước của vòng vẫn là của kệ.
// 3. Phân loại theo kích thước thật (chiều cao không phân biệt được: tường, cột, kệ đều cao 2,5–4 m):
//    cả hai cạnh ≤ maxColumnSize → cột (bốn góc hộp bao trống → cột tròn); cạnh ngắn ≤ maxWallThickness → tường;
//    còn lại → kệ.
// 4. App chỉ nhận kệ xoay 0° / 90° và tường, cột hình chữ nhật thẳng trục: khối thẳng trục dùng hộp bao (chính xác
//    tới 1 ô); khối nằm chéo làm tròn về 0°/90° gần nhất, giữ tâm và kích thước thật, ghi chú `angle` để người dùng biết.
//
// Số tầng kệ: `levelsAt(rack)` (nếu có, ví dụ đếm mặt ngang trong mô hình 3D) cho số tầng THẬT; không có thì ĐOÁN theo
// cỡ mặc định và đánh dấu `needsReview` để giao diện bắt người dùng xác nhận.

export const DEFAULT_CONVERT = {
  minHeight: 0.3,          // thấp hơn thì coi là đồ trên sàn, bỏ
  minCells: 3,             // khối nhỏ hơn: nhiễu, bỏ (báo lại trong `ignored`)
  maxColumnSize: 0.8,      // cột: cả hai cạnh ≤ 0,8 m
  maxWallThickness: 0.3,   // tường: cạnh ngắn ≤ 0,3 m
  straightTolerance: 5,    // lệch ≤ 5° so với 0°/90° thì coi là thẳng trục
  ignoreEdge: 0,           // bỏ dải sát mép phòng rộng chừng này (m)
  joinDistance: 0,         // nối ô có vật cách nhau tới chừng này (m) vào cùng khối: tia thưa để mặt kệ đứt đoạn
  bayWidth: 1.2,           // đoán số ô của kệ theo cỡ ô này
  levelHeight: 1.2,        // đoán số tầng theo chiều cao tầng này (khi không đếm được)
  hasTop: true,
  maxWeight: 1000,
  levelsAt: null,          // (rack) => { levels, levelHeight } | null
};

/**
 * @returns {{ width, depth, racks: Array, obstacles: Array, ignored: Array }}
 *  racks có cùng trường với RackRequest (+ footprintWidth/Depth, measuredHeight, angle, levelsCounted, needsReview)
 *  obstacles: { kind: 'Wall' | 'Column', x, y, width, depth, round?, angle? }
 */
export function mapToLayout(map, options = {}) {
  const opt = { ...DEFAULT_CONVERT, ...options };
  const shapes = findBlobs(map, opt.minHeight, opt.ignoreEdge, opt.joinDistance).map((blob) => describe(map, blob, opt));
  shapes.sort((a, b) => a.y - b.y || a.x - b.x);   // tất định: trên xuống, trái sang; mã K1, K2… theo thứ tự này

  const racks = [];
  const obstacles = [];
  const ignored = [];
  for (const s of shapes) {
    const rect = { x: s.x, y: s.y, width: s.width, depth: s.depth };
    if (s.cells < opt.minCells) ignored.push({ ...rect, cells: s.cells });
    else if (s.long <= opt.maxColumnSize + 1e-9) obstacles.push({ kind: 'Column', ...rect, ...(s.round ? { round: true } : {}) });
    else if (s.short <= opt.maxWallThickness + 1e-9) obstacles.push({ kind: 'Wall', ...rect, ...(s.tilted ? { angle: s.angle } : {}) });
    else racks.push(toRack(s, racks.length + 1, opt));
  }
  return { width: map.width, depth: map.depth, racks, obstacles, ignored };
}

/**
 * Khối ô có vật cao liền nhau (8 hướng). Mỗi khối: { cells, minC, maxC, minR, maxR, height }
 * joinDistance > 0: hai ô có vật cách nhau tới chừng đó mét vẫn tính là liền (mặt kệ quét bằng tia thưa bị đứt
 * đoạn; không nối thì một mẩu mặt kệ thành "tường" hay "cột" giả). Chỉ nối, không thêm ô: hộp bao không phình ra.
 */
export function findBlobs(map, minHeight = DEFAULT_CONVERT.minHeight, ignoreEdge = 0, joinDistance = 0) {
  const { cols, rows, state, height, cellSize } = map;
  const reach = 1 + Math.ceil(joinDistance / cellSize - 1e-9);
  const nearEdge = (i) => {
    if (ignoreEdge <= 0) return false;
    const x = ((i % cols) + 0.5) * cellSize;
    const y = (Math.floor(i / cols) + 0.5) * cellSize;
    return Math.min(x, y, map.width - x, map.depth - y) < ignoreEdge;
  };
  const solid = (i) => state[i] === OCCUPIED && height[i] >= Math.fround(minHeight) && !nearEdge(i);
  const seen = new Uint8Array(state.length);
  const blobs = [];

  for (let start = 0; start < state.length; start++) {
    if (seen[start] || !solid(start)) continue;
    // Loang bằng ngăn xếp (không đệ quy: khối tường dài hàng trăm ô sẽ tràn ngăn xếp gọi hàm).
    const blob = { cells: [], minC: Infinity, maxC: -Infinity, minR: Infinity, maxR: -Infinity, height: 0 };
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop();
      const c = i % cols;
      const r = Math.floor(i / cols);
      blob.cells.push(i);
      blob.minC = Math.min(blob.minC, c);
      blob.maxC = Math.max(blob.maxC, c);
      blob.minR = Math.min(blob.minR, r);
      blob.maxR = Math.max(blob.maxR, r);
      blob.height = Math.max(blob.height, height[i]);
      for (let dr = -reach; dr <= reach; dr++) {
        for (let dc = -reach; dc <= reach; dc++) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const n = nr * cols + nc;
          if (!seen[n] && solid(n)) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    blobs.push(blob);
  }
  return blobs;
}

/**
 * Hình dạng của một khối: hướng (PCA), kích thước thật, hình chữ nhật đặt vào app (thẳng trục), cột tròn hay không.
 * angle: góc trục dài so với trục X, độ, trong (−90; 90]. tilted: lệch khỏi 0°/90° quá straightTolerance.
 */
function describe(map, blob, opt) {
  const cs = map.cellSize;
  const pts = blob.cells.map((i) => [((i % map.cols) + 0.5) * cs, (Math.floor(i / map.cols) + 0.5) * cs]);
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);   // hướng phương sai lớn nhất
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  let a0 = Infinity;
  let a1 = -Infinity;
  let b0 = Infinity;
  let b1 = -Infinity;
  for (const [x, y] of pts) {
    const a = (x - mx) * ux + (y - my) * uy;
    const b = -(x - mx) * uy + (y - my) * ux;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a);
    b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  const long = round(Math.max(a1 - a0, b1 - b0) + cs);
  const short = round(Math.min(a1 - a0, b1 - b0) + cs);
  const cx = mx + ux * (a0 + a1) / 2 - uy * (b0 + b1) / 2;
  const cy = my + uy * (a0 + a1) / 2 + ux * (b0 + b1) / 2;

  let angle = round((theta * 180) / Math.PI);
  if (angle <= -90) angle += 180;
  if (angle > 90) angle -= 180;
  const off = Math.min(Math.abs(angle), Math.abs(90 - Math.abs(angle)));
  const tilted = off > opt.straightTolerance && long - short > cs * 2;   // khối gần vuông thì hướng không có nghĩa

  // Hộp bao (chính xác tới 1 ô) cho khối thẳng trục; khối chéo: làm tròn về 0°/90°, giữ tâm và kích thước thật.
  const bbox = {
    x: round(blob.minC * cs), y: round(blob.minR * cs),
    width: round((blob.maxC - blob.minC + 1) * cs), depth: round((blob.maxR - blob.minR + 1) * cs),
  };
  let rect = bbox;
  if (tilted) {
    const alongX = Math.abs(angle) < 45;
    const width = alongX ? long : short;
    const depth = alongX ? short : long;
    rect = {
      x: round(clamp(cx - width / 2, 0, map.width - width)),
      y: round(clamp(cy - depth / 2, 0, map.depth - depth)),
      width, depth,
    };
  }

  // Cột tròn: khối gần vuông và ô ở cả bốn góc hộp bao đều trống.
  const corner = (c, r) => map.state[r * map.cols + c] === OCCUPIED;
  const round_ = long - short <= cs * 2
    && !corner(blob.minC, blob.minR) && !corner(blob.maxC, blob.minR) && !corner(blob.minC, blob.maxR) && !corner(blob.maxC, blob.maxR);

  return {
    ...rect, cells: blob.cells.length, height: blob.height,
    long: tilted ? long : Math.max(bbox.width, bbox.depth), short: tilted ? short : Math.min(bbox.width, bbox.depth),
    angle, tilted, round: round_, cx, cy,
  };
}

/**
 * Hình chữ nhật → cấu hình kệ. Dài chạy theo trục nào thì xoay theo trục đó (rộng ≥ sâu: 0°, ngược lại 90°),
 * khớp Rack.GetBounds ở backend: x, y là góc trên trái của đáy, xoay 90° đổi chỗ dài/sâu.
 * Số ô ĐOÁN theo cỡ mặc định rồi chia đều (bays × bayWidth = chiều dài đo được). Số tầng: đếm được thì dùng,
 * không thì đoán như số ô (levels × levelHeight = chiều cao đo được).
 */
function toRack(s, number, opt) {
  const rotation = s.width >= s.depth ? 0 : 90;
  const length = rotation === 0 ? s.width : s.depth;
  const depth = rotation === 0 ? s.depth : s.width;
  const bays = clamp(Math.round(length / opt.bayWidth), 1, 50);
  const measuredHeight = round(s.height);
  const rack = {
    code: `K${number}`,
    x: s.x, y: s.y, rotation,
    bays, bayWidth: round(length / bays), depth,
    hasTop: opt.hasTop, maxWeight: opt.maxWeight, productTypeId: null,
    footprintWidth: s.width, footprintDepth: s.depth,
    measuredHeight,
    angle: s.tilted ? s.angle : rotation,
    center: { x: s.cx, y: s.cy },
  };
  const counted = opt.levelsAt?.(rack) ?? null;
  if (counted && counted.levels >= 1) {
    rack.levels = clamp(counted.levels, 1, 20);
    rack.levelHeight = round(counted.levelHeight);
    rack.levelsCounted = true;
  } else {
    rack.levels = clamp(Math.round(measuredHeight / opt.levelHeight), 1, 20);
    rack.levelHeight = round(measuredHeight / rack.levels);
    rack.levelsCounted = false;
  }
  rack.needsReview = !rack.levelsCounted || s.tilted;   // số tầng là đoán, hoặc kệ chéo đã bị làm tròn
  return rack;
}

const round = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
