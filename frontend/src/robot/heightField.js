// Thế giới dạng BẢN ĐỒ ĐỘ CAO: mỗi ô (mặc định 5 cm) biết vật cao nhất đứng ở đó. Dùng cho "Số hoá kho cũ":
// kho 3D thả vào (mô hình bất kỳ) được chiếu từ trên xuống thành bản đồ độ cao (meshToHeightField.js), rồi cảm biến
// robot đọc bản đồ này THEO TIA từ chỗ robot đứng. Robot vẫn không biết trước cả kho: tia bị vật cao chặn thì phía
// sau là vùng khuất, y như cảm biến thật.
//
// Có cùng "giao diện" với thế giới hộp (world.js) mà sensor.js / explorer.js cần: width, depth, boxes (rỗng),
// castRay (sensor gọi thay cho phép thử hộp), isClear (chỗ đặt robot), isFloor (tính % đã quét).
// Hàm thuần, không dính Three.js.

export const FLOOR_LEVEL = 0.02;   // thấp hơn coi là sàn (nhiễu của mô hình, vạch sơn…)

export function createHeightField(width, depth, res, heights) {
  const cols = Math.round(width / res);
  const rows = Math.round(depth / res);
  if (heights.length !== cols * rows) throw new RangeError(`Cần ${cols * rows} ô độ cao, nhận ${heights.length}.`);
  return { width, depth, res, cols, rows, heights };
}

/** Độ cao tại (x, y); ngoài vùng thì 0. */
export function sampleHeight(hf, x, y) {
  const c = Math.floor(x / hf.res);
  const r = Math.floor(y / hf.res);
  if (c < 0 || r < 0 || c >= hf.cols || r >= hf.rows) return 0;
  return hf.heights[r * hf.cols + c];
}

/** Vật cao nhất trong bán kính `radius` quanh (x, y): độ cao của "khối" ở đó (chân kệ mảnh vẫn ra chiều cao kệ). */
export function heightAround(hf, x, y, radius) {
  const reach = Math.ceil(radius / hf.res);
  const c0 = Math.floor(x / hf.res);
  const r0 = Math.floor(y / hf.res);
  let h = 0;
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const c = c0 + dc;
      const r = r0 + dr;
      if (c >= 0 && r >= 0 && c < hf.cols && r < hf.rows) h = Math.max(h, hf.heights[r * hf.cols + c]);
    }
  }
  return h;
}

/** Thế giới cho sensor/explorer từ một bản đồ độ cao. */
export function heightFieldWorld(hf) {
  return {
    width: hf.width,
    depth: hf.depth,
    boxes: [],
    heightField: hf,
    castRay: (origin, angle, range, seeThroughBelow) => castHeightRay(hf, origin, angle, range, seeThroughBelow),
    /** Robot bán kính r đứng ở (x, y) được không: cả vòng tròn là sàn và nằm trong phòng. */
    isClear(x, y, r) {
      if (x < r || y < r || x > hf.width - r || y > hf.depth - r) return false;
      const reach = Math.ceil(r / hf.res);
      for (let dr = -reach; dr <= reach; dr++) {
        for (let dc = -reach; dc <= reach; dc++) {
          if ((dc * hf.res) ** 2 + (dr * hf.res) ** 2 > r * r + 1e-9) continue;
          if (sampleHeight(hf, x + dc * hf.res, y + dr * hf.res) > FLOOR_LEVEL) return false;
        }
      }
      return true;
    },
    isFloor: (x, y) => sampleHeight(hf, x, y) <= FLOOR_LEVEL,
  };
}

/**
 * Một tia trên bản đồ độ cao, trả đúng dạng Reading của sensor.castRay:
 * { angle, distance, hit, boundary, height, hitDepth, lows }.
 * Đi từng nửa ô; gặp ô cao ≥ seeThroughBelow thì dừng (tìm chính xác mép bằng chia đôi), độ cao báo về là vật cao nhất
 * quanh chỗ chạm trong 10 cm (để tia chạm chân kệ mảnh vẫn ra chiều cao cả kệ, không bị coi là vật thấp).
 * Đoạn đi qua ô thấp (sàn < h < seeThroughBelow) ghi vào lows, tia đi tiếp.
 */
export function castHeightRay(hf, origin, angle, range, seeThroughBelow = 0.3) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const step = hf.res / 2;
  const edge = distanceToEdge(hf, origin, dx, dy);
  const limit = Math.min(range, edge);
  const lows = [];
  let low = null;

  for (let k = 1; k * step <= limit + 1e-9; k++) {
    const t = Math.min(k * step, limit);
    const h = sampleHeight(hf, origin.x + dx * t, origin.y + dy * t);
    if (h >= seeThroughBelow) {
      // Chia đôi giữa bước trước và bước này để ra mép vật chính xác cỡ 1 mm.
      let a = t - step;
      let b = t;
      for (let i = 0; i < 6; i++) {
        const m = (a + b) / 2;
        if (sampleHeight(hf, origin.x + dx * m, origin.y + dy * m) >= seeThroughBelow) b = m;
        else a = m;
      }
      if (low) lows.push({ ...low, to: b });
      const px = origin.x + dx * (b + 0.01);
      const py = origin.y + dy * (b + 0.01);
      return { angle, distance: b, hit: true, boundary: false, height: heightAround(hf, px, py, 0.1), hitDepth: hf.res, lows };
    }
    if (h > FLOOR_LEVEL) {
      if (!low) low = { from: t - step, to: t, height: h };
      else {
        low.to = t;
        low.height = Math.max(low.height, h);
      }
    } else if (low) {
      lows.push(low);
      low = null;
    }
  }
  if (low) lows.push(low);
  const hitEdge = edge <= range + 1e-9;
  return { angle, distance: hitEdge ? edge : range, hit: hitEdge, boundary: hitEdge, height: hitEdge ? 3 : null, hitDepth: 0, lows };
}

function distanceToEdge(hf, { x, y }, dx, dy) {
  const eps = 1e-9;
  const tx = dx > eps ? (hf.width - x) / dx : dx < -eps ? -x / dx : Infinity;
  const ty = dy > eps ? (hf.depth - y) / dy : dy < -eps ? -y / dy : Infinity;
  return Math.min(tx, ty);
}
