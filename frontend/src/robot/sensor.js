import { WALL_HEIGHT } from './world.js';

// Cảm biến giả của robot: bắn tia từ vị trí robot ra xung quanh, mỗi tia báo "đi được bao xa thì chạm vật,
// vật đó cao bao nhiêu". Đây là THỨ DUY NHẤT robot biết về thế giới; gridMap.js dựng bản đồ từ các tia này.
//
// Mô hình là cảm biến "2.5D" (giống camera chiều sâu nhìn chếch xuống sàn), không phải LiDAR 2D một mặt phẳng:
// - Vật thấp hơn `seeThroughBelow` (dây điện, tấm pallet rỗng) KHÔNG chặn tia: robot thấy nó và thấy cả phía sau.
//   Nếu cho vật 3 cm chặn tia thì sau nó sẽ là vùng "chưa biết" giả, rất vô lý.
// - Vật cao hơn thì chặn tia (kệ, cột, thùng hàng): sau nó là vùng khuất.
// - Mép phòng là tường bao: tia chạm mép thì dừng, đánh dấu `boundary` để bản đồ không vẽ ô ngoài phòng.
//
// Mọi vật là hộp thẳng trục nên giao tia–hộp dùng phép thử "slab": chỉ vài phép chia, không cần thư viện vật lý.

export const DEFAULT_SENSOR = { rays: 120, range: 6, seeThroughBelow: 0.3 };
const EPS = 1e-9;
const GRAZE = 1e-9;   // mét: đoạn tia trong vật ngắn hơn thế này là "sượt qua"

/**
 * Quét một vòng 360° từ `pose` ({ x, y }).
 * @returns {{ origin: {x, y}, range: number, readings: Array<Reading> }}
 * Reading = { angle, distance, hit, boundary, height, lows: [{ from, to, height }] }
 *  - hit = true: trong tầm có vật chặn ở `distance` (boundary = true nếu đó là mép phòng), `height` là độ cao vật.
 *    hitDepth: đoạn tia đi TRONG vật đó (từ chỗ vào tới chỗ ra). Bản đồ dùng để lấy một điểm chắc chắn nằm trong vật
 *    (hộp là hình lồi nên mọi điểm giữa chỗ vào và chỗ ra đều ở trong hộp), kể cả khi tia chỉ sượt qua góc.
 *  - hit = false: tia đi hết tầm mà không chạm gì; `distance` = range, `height` = null.
 *  - lows: các đoạn tia đi XUYÊN QUA vật thấp (tính bằng khoảng cách từ robot), chỉ phần nằm trong `distance`.
 */
export function scan(world, pose, options = {}) {
  const { rays, range, seeThroughBelow } = { ...DEFAULT_SENSOR, ...options };
  if (!(rays >= 1) || !(range > 0)) throw new RangeError('Số tia phải ≥ 1 và tầm quét phải > 0.');
  if (!isInsideRoom(world, pose)) throw new RangeError(`Robot (${pose.x}; ${pose.y}) nằm ngoài phòng.`);

  const readings = [];
  for (let i = 0; i < rays; i++) {
    // Góc chia đều, tính từ chỉ số (i / rays) chứ không cộng dồn từng bước để khỏi trôi sai số.
    const angle = (i / rays) * 2 * Math.PI;
    // Thế giới tự biết bắn tia (bản đồ độ cao của kho 3D, heightField.js) thì dùng cách của nó; không thì phép thử hộp.
    readings.push(world.castRay
      ? world.castRay(pose, angle, range, seeThroughBelow)
      : castRay(world, pose, angle, range, seeThroughBelow));
  }
  return { origin: { x: pose.x, y: pose.y }, range, readings };
}

/** Một tia. Tách riêng để test được từng hướng. */
export function castRay(world, origin, angle, range, seeThroughBelow = DEFAULT_SENSOR.seeThroughBelow) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  // Mặc định tia dừng ở mép phòng.
  let stop = distanceToRoomEdge(world, origin, dx, dy);
  let height = WALL_HEIGHT;
  let boundary = true;
  let hitDepth = 0;
  const lowSpans = [];

  for (const box of world.boxes) {
    const span = raySlab(origin, dx, dy, box);
    // Tia chỉ chạm đúng một góc hoặc lướt dọc một cạnh (đoạn trong vật dài ~0) thì coi là đi sượt qua, không chặn.
    // Robot đứng ở tâm ô và góc tia chia đều nên chuyện "trúng đúng góc" (vd. từ (7,5; 2,3) góc 135° qua góc cột
    // (6,4; 3,4)) xảy ra thật; nếu tính là chạm thì điểm chạm nằm trên ranh giới hai ô và ô ngoài vật bị đánh dấu.
    if (!span || span[1] - span[0] < GRAZE) continue;
    if (box.height < seeThroughBelow) {
      lowSpans.push({ from: span[0], to: span[1], height: box.height });
    } else if (span[0] < stop) {
      stop = span[0];
      height = box.height;
      boundary = false;
      hitDepth = span[1] - span[0];
    }
  }

  const hit = stop <= range + EPS;
  const distance = hit ? stop : range;
  const lows = lowSpans
    .filter((s) => s.from < distance)
    .map((s) => ({ from: s.from, to: Math.min(s.to, distance), height: s.height }))
    .sort((a, b) => a.from - b.from);

  const hitObject = hit && !boundary;
  return {
    angle, distance, hit, boundary: hit && boundary, height: hit ? height : null,
    hitDepth: hitObject ? hitDepth : 0,
    lows,
  };
}

function isInsideRoom(world, { x, y }) {
  return x >= -EPS && y >= -EPS && x <= world.width + EPS && y <= world.depth + EPS;
}

/** Khoảng cách từ điểm trong phòng tới mép phòng theo hướng (dx, dy). */
function distanceToRoomEdge(world, { x, y }, dx, dy) {
  const tx = dx > EPS ? (world.width - x) / dx : dx < -EPS ? -x / dx : Infinity;
  const ty = dy > EPS ? (world.depth - y) / dy : dy < -EPS ? -y / dy : Infinity;
  return Math.min(tx, ty);
}

/**
 * Phép thử slab: tia đi vào hộp ở t0 và ra ở t1 (tính từ gốc tia). Không cắt thì null.
 * Ý tưởng: hộp là giao của hai "dải" (dải X và dải Y); tia nằm trong dải X trong khoảng [ax, bx],
 * trong dải Y trong khoảng [ay, by]; nằm trong hộp khi ở trong cả hai, tức [max(ax, ay), min(bx, by)].
 * Robot đứng trong hộp (t0 < 0) thì coi như chạm ngay ở 0.
 */
export function raySlab(origin, dx, dy, box) {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [o, d, lo, hi] of [[origin.x, dx, box.x, box.x + box.width], [origin.y, dy, box.y, box.y + box.depth]]) {
    if (Math.abs(d) < EPS) {
      // Tia song song với dải: nằm ngoài dải thì không bao giờ vào hộp. Nằm ĐÚNG trên mép (vd. robot ở y = 6 bắn
      // ngang dọc mép dưới kệ y = 6) cũng là sượt qua, không chặn: nếu tính là chạm thì ô ngoài kệ bị đánh dấu.
      if (o <= lo + EPS || o >= hi - EPS) return null;
      continue;
    }
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  if (t1 < Math.max(t0, 0)) return null;   // hộp nằm sau lưng robot hoặc tia trượt qua
  return [Math.max(t0, 0), t1];
}
