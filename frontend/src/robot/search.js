// Tìm đường trên lưới: A* 8 hướng. Dùng chung cho hai việc:
// - Đi quét (explorer.js): không biết trước đích, chỉ biết "ô nào là biên" → truyền `isGoal`, không có `goal`.
//   Khi đó A* không có heuristic và chính là Dijkstra: mở rộng theo vòng chi phí tăng dần nên ô biên đầu tiên
//   gặp được là ô biên GẦN NHẤT theo đường đi (không phải gần nhất theo đường chim bay, có thể bị kệ chắn).
// - Chở hàng (bước 7): biết đích → truyền `goal`, có heuristic nên nhanh hơn.
//
// Không cho đi chéo cắt góc: muốn đi chéo thì hai ô kề ngang và dọc cũng phải đi được, nếu không robot sẽ
// lách qua khe giữa hai vật chạm góc nhau.

const SQRT2 = Math.SQRT2;

/**
 * @param map bản đồ lưới (chỉ dùng cols, rows, cellSize)
 * @param start ô xuất phát (luôn được đứng, kể cả khi không `passable`: robot đã ở đó rồi)
 * @param opts.goal ô đích (bỏ trống = tìm theo isGoal)
 * @param opts.isGoal (i) => boolean
 * @param opts.passable (i) => boolean
 * @param opts.stepCost (i) => hệ số chi phí khi bước VÀO ô i, phải ≥ 1 (heuristic dựa vào điều này để đúng)
 * @returns {{ cells: number[], cost: number } | null} cells gồm cả ô xuất phát; cost tính bằng mét quy đổi
 */
export function findPath(map, start, { goal = -1, isGoal = (i) => i === goal, passable, stepCost = () => 1 }) {
  const { cols, rows, cellSize } = map;
  const n = cols * rows;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = createHeap();

  const goalC = goal % cols;
  const goalR = Math.floor(goal / cols);
  // Heuristic "octile": khoảng cách ngắn nhất trên lưới 8 hướng khi không có vật cản. Không bao giờ lớn hơn
  // chi phí thật (vì stepCost ≥ 1) nên A* vẫn ra đường rẻ nhất.
  const h = goal < 0 ? () => 0 : (i) => {
    const dc = Math.abs((i % cols) - goalC);
    const dr = Math.abs(Math.floor(i / cols) - goalR);
    return cellSize * (Math.max(dc, dr) + (SQRT2 - 1) * Math.min(dc, dr));
  };

  g[start] = 0;
  heap.push(start, h(start));
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;          // đã có đường rẻ hơn tới ô này (bản ghi cũ còn trong heap)
    closed[cur] = 1;
    if (isGoal(cur)) return { cells: backtrack(parent, cur), cost: g[cur] };

    const c = cur % cols;
    const r = Math.floor(cur / cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const next = nr * cols + nc;
        if (closed[next] || !passable(next)) continue;
        if (dc !== 0 && dr !== 0 && (!passable(r * cols + nc) || !passable(nr * cols + c))) continue;
        const cost = g[cur] + (dc !== 0 && dr !== 0 ? SQRT2 : 1) * cellSize * stepCost(next);
        if (cost < g[next]) {
          g[next] = cost;
          parent[next] = cur;
          heap.push(next, cost + h(next));
        }
      }
    }
  }
  return null;
}

/**
 * Chi phí đi từ `start` tới MỌI ô (Dijkstra chạy hết, không dừng ở đích nào). Infinity = không tới được.
 * Dùng khi cần hỏi nhiều đích một lúc (kiểm chứng mọi khung của kho): một lần duyệt thay cho hàng trăm lần A*.
 * Cùng luật bước như findPath (8 hướng, không cắt góc), nên số liệu khớp với đường robot đi thật.
 */
export function costField(map, start, { passable, stepCost = () => 1 }) {
  const { cols, rows, cellSize } = map;
  const g = new Float64Array(cols * rows).fill(Infinity);
  const closed = new Uint8Array(cols * rows);
  const heap = createHeap();
  g[start] = 0;
  heap.push(start, 0);
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const c = cur % cols;
    const r = Math.floor(cur / cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const next = nr * cols + nc;
        if (closed[next] || !passable(next)) continue;
        if (dc !== 0 && dr !== 0 && (!passable(r * cols + nc) || !passable(nr * cols + c))) continue;
        const cost = g[cur] + (dc !== 0 && dr !== 0 ? SQRT2 : 1) * cellSize * stepCost(next);
        if (cost < g[next]) {
          g[next] = cost;
          heap.push(next, cost);
        }
      }
    }
  }
  return g;
}

/** Chiều dài hình học của đường (mét), không tính phạt. */
export function pathLength(map, cells) {
  let length = 0;
  for (let k = 1; k < cells.length; k++) {
    const dc = (cells[k] % map.cols) - (cells[k - 1] % map.cols);
    const dr = Math.floor(cells[k] / map.cols) - Math.floor(cells[k - 1] / map.cols);
    length += Math.hypot(dc, dr) * map.cellSize;
  }
  return length;
}

function backtrack(parent, end) {
  const cells = [];
  for (let i = end; i !== -1; i = parent[i]) cells.push(i);
  return cells.reverse();
}

/** Hàng đợi ưu tiên (min-heap) cho A*. Không có "giảm khoá": đẩy bản ghi mới, bản ghi cũ bị bỏ qua nhờ `closed`. */
function createHeap() {
  const keys = [];
  const prio = [];
  const swap = (a, b) => {
    [keys[a], keys[b]] = [keys[b], keys[a]];
    [prio[a], prio[b]] = [prio[b], prio[a]];
  };
  return {
    get size() { return keys.length; },
    push(key, p) {
      keys.push(key);
      prio.push(p);
      let i = keys.length - 1;
      while (i > 0) {
        const up = (i - 1) >> 1;
        if (prio[up] <= prio[i]) break;
        swap(up, i);
        i = up;
      }
    },
    pop() {
      const top = keys[0];
      const lastKey = keys.pop();
      const lastPrio = prio.pop();
      if (keys.length > 0) {
        keys[0] = lastKey;
        prio[0] = lastPrio;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < keys.length && prio[l] < prio[m]) m = l;
          if (r < keys.length && prio[r] < prio[m]) m = r;
          if (m === i) break;
          swap(m, i);
          i = m;
        }
      }
      return top;
    },
  };
}
