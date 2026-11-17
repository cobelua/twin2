# Kế hoạch sản phẩm 2: Robot giả lập quét bản đồ kho (MapTwin)

> Bản nháp kế hoạch, viết ngày 2026-11-13. Mọi thứ đều **giả lập**: không có robot thật, không có cảm biến thật.
> Sản phẩm 2 dùng lại phần lớn nền tảng của sản phẩm 1 (WarehouseTwin).

## 1. Sản phẩm làm gì

Một robot ảo chạy trong một nhà kho ảo mà **nó chưa biết hình dạng**. Robot có cảm biến quét laser (lidar) giả lập.
Nó tự đi khám phá, vẽ dần bản đồ, rồi hệ thống **chuyển bản đồ thành mặt bằng kho** (tường, cột, kệ) theo đúng
định dạng của sản phẩm 1. Từ đó có thể lưu thành phòng và xếp pallet như cũ.

Luồng demo:

1. Chọn một "kho thật" ẩn (bản đồ gốc, robot không được đọc), ví dụ phòng mẫu 20 × 12 m của sản phẩm 1.
2. Bấm **Bắt đầu quét**: robot đi khám phá. Bản đồ ô lưới hiện dần (trống / có vật / chưa biết), tia laser và
   đường đi hiện trên màn 2D, robot di chuyển trong cảnh 3D.
3. Quét xong: hệ thống tách bản đồ thành hình chữ nhật (tường, cột, kệ), so với bản đồ gốc và chấm điểm độ chính xác.
4. Bấm **Tạo phòng từ bản đồ**: được một phòng mới của sản phẩm 1 (bản nháp), sửa tay rồi Lưu nháp như bình thường.

**Ngoài phạm vi:** robot thật, ROS, cảm biến thật, SLAM đầy đủ (robot giả lập biết chính xác vị trí của mình,
xem mục 7), quét chiều cao 3D (số tầng kệ vẫn nhập tay), nhiều robot cùng lúc.

## 2. Có dùng lại được code của sản phẩm 1 không?

**Được, khá nhiều.** Kiến trúc của sản phẩm 1 hợp sẵn: luật nằm ở backend dạng hàm thuần (dễ test, dễ giả lập),
mọi thứ đo bằng mét, frontend chỉ hiển thị.

| Phần của sản phẩm 1 | Dùng lại thế nào | Mức |
|---|---|---|
| `Models/Rect`, `Tolerance` | Hình học: va chạm robot, tia laser cắt hình chữ nhật, so sánh số thực | Nguyên văn |
| `Models/Room`, `Obstacle`, `Rack` | Bản đồ gốc ẩn = một `Room` có tường, cột, kệ; kết quả quét cũng thành `Room` | Nguyên văn |
| `Rules/PlacementValidator` | Kiểm tra mặt bằng tách ra từ bản đồ có hợp lệ không (đè, lối đi) | Nguyên văn |
| `LayoutService.SaveLayout`, `PUT …/layout` | "Tạo phòng từ bản đồ" = gửi một bản nháp vào đúng API này | Nguyên văn |
| `IWarehouseStore`, EF, PostgreSQL, migration | Lưu phòng; thêm bảng phiên quét nếu cần | Mở rộng |
| `ServiceResult`, `ApiControllerBase`, `ApiExceptionHandler` | Cách trả lỗi, ProblemDetails tiếng Việt | Nguyên văn |
| `ArchitectureTests` | Giữ luật tầng cho code mới (`Simulation/` không dùng EF/ASP.NET) | Mở rộng |
| `SampleData/sample-layout.json` | Làm bản đồ gốc mẫu cho robot quét | Nguyên văn |
| `frontend/api/client.js`, `state/store.js` | Gọi API, trạng thái, subscribe | Nguyên văn |
| `editor2d/editor2d.js` | Canvas theo mét, zoom, kéo màn hình: thêm lớp vẽ bản đồ ô lưới, tia laser, robot | Mở rộng |
| `scene3d/warehouse3d.js`, `rackGeometry.js` | Cảnh 3D, sàn, tường, kệ: thêm mô hình robot và hiệu ứng di chuyển (giống pallet bay) | Mở rộng |
| `Allocator`, `Distributor`, `SlotFinder`, màn Nhập lô | Không cần cho việc quét; dùng lại sau khi đã tạo phòng | Giữ nguyên |

Ước lượng: khoảng **60% nền tảng dùng lại**. Phần viết mới là robot, cảm biến, bản đồ ô lưới, khám phá,
tìm đường và tách hình chữ nhật.

**Cách tổ chức repo (đề xuất):** cùng solution, thêm thư mục `Simulation/` trong backend (hàm thuần như `Rules/`)
và một màn mới "Quét bản đồ" trong frontend. Không tách repo, để dùng chung Models và API mặt bằng. Nếu sau này
cần tách, `Models` + `Rules` + `Simulation` gom thành một thư viện riêng.

## 3. Phần viết mới

### 3.1 Thế giới giả lập (backend, `Simulation/`)

| Thành phần | Nội dung |
|---|---|
| `World` | Bản đồ gốc ẩn: một `Room` (tường bao, tường, cột, kệ dưới dạng `Rect`). Hàm `IsFree(point)`, `Raycast(origin, angle, maxRange)` |
| `Robot` | Vị trí `(x, y, θ)` bằng mét/radian, bán kính, tốc độ. Lệnh di chuyển: đi thẳng / xoay, không xuyên vật cản |
| `Lidar` | N tia (ví dụ 180 tia, tầm 8 m) từ robot; mỗi tia trả khoảng cách, có nhiễu Gauss **với seed cố định** |
| `OccupancyGrid` | Lưới ô (ví dụ 0,1 m), mỗi ô giữ log-odds: chưa biết / trống / có vật. Cập nhật theo tia (thuật toán Bresenham) |
| `FrontierExplorer` | Tìm "biên" (ô trống cạnh ô chưa biết), chọn biên gần nhất theo đường đi làm đích tiếp theo |
| `PathPlanner` | A* trên lưới, nới vật cản thêm bán kính robot (để không cắt sát góc) |
| `MapExtractor` | Lưới đã quét → các hình chữ nhật: gom ô có vật thành vùng liền (connected components), lấy hình bao, phân loại tường / cột / kệ theo kích thước |
| `MapScorer` | So bản đồ quét với bản đồ gốc: tỉ lệ ô đúng, IoU từng vật, vật bị sót / vật thừa |

Tất cả là **hàm thuần, tất định** (cùng seed thì cùng kết quả), giống `Allocator`: test được bằng xUnit,
không cần database.

### 3.2 API

| Phương thức | Đường dẫn | Ý nghĩa |
|---|---|---|
| `POST` | `/api/scans` | Tạo phiên quét: chọn bản đồ gốc, vị trí xuất phát, seed, thông số lidar → `{ id }` |
| `POST` | `/api/scans/{id}/run` | Chạy cả phiên (hoặc N bước) trên server, trả các khung hình (vị trí robot, tia, ô vừa đổi) |
| `GET` | `/api/scans/{id}` | Bản đồ ô lưới hiện tại + đường đi + trạng thái |
| `GET` | `/api/scans/{id}/extract` | Các hình chữ nhật tách được + điểm so với bản đồ gốc |
| `POST` | `/api/scans/{id}/to-room` | Tạo phòng mới (dùng `LayoutService`) từ kết quả tách |

Server chạy giả lập rồi trả **danh sách khung hình**, frontend chỉ phát lại (đúng nguyên tắc của sản phẩm 1:
frontend không tự tính luật). Chưa cần realtime/SignalR; nếu cần xem trực tiếp thì làm sau.

### 3.3 Frontend

- Màn **Quét bản đồ** (tính năng thứ ba trên thanh trên cùng).
- 2D (dựa trên `editor2d`): ô lưới xám / trắng / đen, tia laser, robot, đường đi, biên đang nhắm tới.
- 3D (dựa trên `warehouse3d`): robot di chuyển, vật cản hiện dần khi được quét.
- Nút tốc độ ×1/×2/×4, Bỏ qua, Phát lại (giống hiệu ứng pallet bay).
- Bảng kết quả: điểm chính xác, danh sách vật tách được, nút **Tạo phòng từ bản đồ**.

## 4. Kế hoạch theo ngày (giả sử 4 ngày như sản phẩm 1)

Nhãn việc giữ như CLAUDE.md: `[TỰ VIẾT]` người dùng viết, `[REVIEW KỸ]` Claude viết và người dùng review kỹ,
`[AI]` Claude làm.

### Ngày 1: Thế giới và cảm biến
- [ ] [AI] Thư mục `Simulation/`, đưa vào `ArchitectureTests` (không EF, không ASP.NET)
- [ ] [TỰ VIẾT] `Raycast`: tia cắt hình chữ nhật (dùng lại `Rect`, `Tolerance`)
- [ ] [REVIEW KỸ] `World`, `Robot` (di chuyển, chặn va chạm), `Lidar` (nhiễu có seed)
- [ ] [REVIEW KỸ] `OccupancyGrid` + cập nhật theo tia (Bresenham, log-odds)
- [ ] Test: tia bắn vào tường cách 3 m trả 3 m; robot không đi xuyên cột; cùng seed cùng kết quả
- **Xong khi:** robot đứng yên quét một vòng, lưới đúng với bản đồ gốc trong tầm nhìn.

### Ngày 2: Tự khám phá
- [ ] [TỰ VIẾT] `PathPlanner` A* trên lưới (có nới vật cản theo bán kính robot)
- [ ] [REVIEW KỸ] `FrontierExplorer`: chọn biên, đi tới, quét, lặp tới khi hết biên hoặc hết số bước
- [ ] [AI] Phiên quét + API `POST /scans`, `run`, `GET`
- [ ] Test: phòng mẫu 20 × 12 m được quét ≥ 95% diện tích đi được; robot không kẹt
- **Xong khi:** gọi API là robot tự quét hết phòng mẫu.

### Ngày 3: Hiển thị
- [ ] [AI] Màn Quét bản đồ: lớp 2D ô lưới, tia, robot, đường đi
- [ ] [AI] 3D: mô hình robot, vật cản hiện dần, nút tốc độ / phát lại
- **Xong khi:** xem được robot quét từ đầu tới cuối trên 2D và 3D.

### Ngày 4: Bản đồ thành mặt bằng
- [ ] [REVIEW KỸ] `MapExtractor`: vùng liền → hình chữ nhật → tường / cột / kệ
- [ ] [REVIEW KỸ] `MapScorer` + bảng kết quả
- [ ] [AI] `to-room`: tạo phòng bằng `LayoutService.SaveLayout`; kệ tách được dùng cấu hình mặc định (số tầng nhập tay)
- [ ] [TỰ VIẾT] Báo cáo thuật toán (occupancy grid, frontier, A*), tập demo
- **Xong khi:** quét phòng mẫu → tạo phòng mới → mở bằng sản phẩm 1, xếp được lô 6A + 2B.

### Nếu trễ thì cắt (theo thứ tự)
1. Cảnh 3D của robot → chỉ xem 2D
2. Chấm điểm so với bản đồ gốc → chỉ hiện bản đồ
3. Phân loại tường / cột / kệ → mọi vật là "vật cản"
4. Không bao giờ cắt: `Raycast`, `OccupancyGrid`, A*, test của chúng.

## 5. Quy tắc giữ từ sản phẩm 1

- Mọi toạ độ và kích thước là **mét**; ô lưới chỉ là cách lưu bản đồ quét, không đổi đơn vị của mặt bằng.
- So sánh số thực bằng `Tolerance`.
- Giả lập **tất định**: có seed, không dùng `Random` không seed. Cùng đầu vào → cùng đường đi, cùng bản đồ.
- Luật ở backend, frontend chỉ phát lại khung hình.
- `ArchitectureTests` luôn xanh.

## 6. Rủi ro

| Rủi ro | Cách giảm |
|---|---|
| Robot kẹt ở góc hẹp, lặp vô hạn giữa hai biên | Giới hạn số bước; đánh dấu biên không tới được; test với phòng nhiều cột |
| Lối đi giữa kệ (1 m) hẹp so với robot | Bán kính robot nhỏ (0,25 m) và nới vật cản đúng bán kính |
| Nhiễu lidar làm tường "rỗ", tách ra nhiều mảnh | Log-odds + ngưỡng; gộp mảnh gần nhau trước khi lấy hình bao |
| Kệ xoay 90°, cột sát tường dính thành một vùng | Tách vùng theo kích thước; chấp nhận sửa tay ở bước bản nháp |
| Trả quá nhiều khung hình (nặng) | Chỉ gửi ô vừa đổi mỗi khung; lấy mẫu mỗi k bước |

## 7. Câu hỏi cần chốt

1. **Robot có biết chính xác vị trí của mình không?** Đề xuất: có (giả lập), để tập trung vào vẽ bản đồ. Nếu muốn
   khó hơn thì thêm nhiễu vị trí và làm SLAM đơn giản ở bản sau.
2. **Kệ quét được bao nhiêu thông tin?** Lidar 2D chỉ thấy hình chiếu sàn, không thấy số tầng. Đề xuất: tách được
   vị trí + kích thước, số tầng nhập tay.
3. **Chung repo hay repo mới?** Đề xuất: chung solution để dùng lại Models và API mặt bằng.
4. **Xem trực tiếp hay phát lại?** Đề xuất: server chạy xong rồi phát lại; realtime làm sau nếu còn thời gian.
