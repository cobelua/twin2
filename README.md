# WarehouseTwin — Kho 3D và tự xếp pallet

Web app mô phỏng kho hàng: vẽ mặt bằng và đặt kệ bằng chuột, nhập một lô pallet, hệ thống **tự xếp từng pallet vào đúng khung kệ** và hiển thị kết quả trên kho 3D (pallet bay từ cửa kho vào khung).

Luật nghiệp vụ nằm ở backend ASP.NET Core (C#); frontend Vite + Three.js chỉ hiển thị và gọi API.

> Robot quét bản đồ, SignalR realtime nhiều tab, đăng nhập/phân quyền tạm bỏ khỏi phiên bản này.

## Tính năng

- **Nhiều phòng**, mỗi phòng có tên riêng, kích thước thật (mét), bước lưới, lối đi tối thiểu giữa hai kệ.
- **Editor 2D** vẽ theo mét: đặt, dời, xoay (phím R), xoá kệ; thêm, sửa, xoá tường và cột; zoom, kéo màn hình; lưới chỉ để hít toạ độ khi vẽ (đổi lưới không làm gì dịch chuyển). Bóng mờ xanh/đỏ báo đặt được hay không, kèm lý do (đè tường/cột/kệ khác, thiếu lối đi).
- **Bản nháp:** mọi thao tác vẽ chỉ sửa bản nháp trong bộ nhớ; bấm **Lưu nháp** mới ghi lên server (một transaction, kiểm tra phiên bản). Bản nháp tự lưu trong trình duyệt để khôi phục khi lỡ đóng tab.
- **Mỗi kệ tự mang cấu hình** (số tầng, số ô, cao tầng, rộng ô, sâu, có nóc, tải trọng, loại hàng chuyên dụng); khung sinh tự động `K1-T1-R1`, nóc `K1-N-R1`.
- **Nhập lô:** nhiều dòng "số lượng + dài × rộng × cao (+ khối lượng, loại hàng)". Type pallet A, B, … do hệ thống **tự khớp hoặc tạo từ số đo**, không cấu hình sẵn.
- **Xem trước rồi xác nhận:** báo từng dòng xếp được bao nhiêu, kệ nào không hợp, kệ nào đã đầy; sau đó nhập lô và xếp.
- **Tự xếp:** pallet kén chỗ xếp trước; quá cao thì lên khung nóc; pallet không khung nào vừa được báo kèm lý do; bấm xếp lại không xếp đôi.
- **Kho 3D:** sàn, tường, cột, kệ theo mét; khung tô màu theo type; hiệu ứng pallet bay vào khung theo đúng thứ tự đã xếp (tốc độ ×1/×2/×4, bỏ qua); bấm khung xem mã và pallet.
- **Lưu thật** vào PostgreSQL; dữ liệu mẫu (phòng mẫu + 3 lô) tạo sẵn khi database còn trống.

## Công nghệ

- **Backend:** ASP.NET Core Web API (.NET 10), EF Core + PostgreSQL (Npgsql)
- **Test:** xUnit, `WebApplicationFactory` cho test API
- **Frontend:** Vite + JavaScript thuần, Three.js (OrbitControls), Canvas 2D

## Cách chạy

Yêu cầu: .NET SDK 10, Node.js 20 trở lên, một database PostgreSQL.

**1. Chuỗi kết nối** (không commit lên git):

```bash
dotnet user-secrets set "ConnectionStrings:Warehouse" "Host=localhost;Port=5432;Database=warehouse;Username=...;Password=..." --project src/Warehouse.Api
```

**2. Tạo bảng:**

```bash
dotnet ef database update --project src/Warehouse.Api
```

**3. Build frontend vào `wwwroot` rồi chạy (demo chỉ cần `dotnet run`):**

```bash
cd frontend && npm install && npm run build && cd ..
dotnet run --project src/Warehouse.Api
```

Mở http://localhost:5251. Database còn trống thì lần chạy đầu tạo sẵn phòng "Kho mẫu" (20 × 12 m, 8 kệ, 4 cột, 1 tường) và 3 lô hàng đã xếp (`Seed:SampleLayout` trong `appsettings.Development.json`; đặt `false` để tự vẽ từ đầu). Swagger (chỉ môi trường Development): http://localhost:5251/swagger.

**Chạy frontend khi phát triển** (Vite proxy `/api` sang backend):

```bash
cd frontend && npm run dev
```

**Chạy test:**

```bash
dotnet test
```

## Cấu trúc thư mục

```
src/Warehouse.Api/
├── Models/                  Dữ liệu + luật của chính nó (không EF, không ASP.NET)
│   ├── Room, Rack, Slot, Obstacle, Rect     Mặt bằng, kệ, khung, tường/cột (toạ độ mét)
│   └── PalletSize, Pallet, Batch, ProductType, Movement, Tolerance
├── Rules/                   Luật cần nhiều đối tượng, hàm thuần
│   ├── PlacementValidator   Đặt kệ: trong sàn, không đè tường/cột/kệ, đủ lối đi
│   ├── PalletSizer          Tìm hoặc tạo type pallet theo số đo
│   ├── SlotFinder           Khung nào nhận được pallet này
│   └── Allocator            Xếp cả lô (tất định, không gọi Place)
├── Services/                Điều phối: đọc store → gọi Rules → áp kết quả → lưu
│   ├── LayoutService        Phòng, kiểm tra thử và lưu bản nháp (SaveLayout)
│   └── PalletService        Xem trước, nhập lô, xếp, đọc khung, đặt lại, loại hàng
├── Data/                    IWarehouseStore, EfWarehouseStore (PostgreSQL), WarehouseDbContext, Migrations
├── Controllers/             LayoutController, PalletsController (mỏng, chỉ gọi service)
├── ViewModels/              Dữ liệu vào/ra API (có [Range]/[Required], thông báo tiếng Việt)
├── Infrastructure/          SampleLayoutSeeder, ApiExceptionHandler
├── SampleData/              sample-layout.json, sample-batches.json
└── wwwroot/                 Frontend đã build (không commit)

tests/Warehouse.Tests/       Models, Rules, Services, Data, Api (HTTP), Infrastructure, ArchitectureTests

frontend/src/
├── api/        Gọi backend (mọi lời gọi đi qua client.js)
├── state/      Trạng thái và bản nháp (store.js, actions.js)
├── editor2d/   Canvas 2D: vẽ mặt bằng, kéo thả
├── scene3d/    Three.js: warehouse3d.js, rackGeometry.js, slotPosition.js
└── ui/         Bảng bên, danh sách phòng, màn Nhập hàng, hộp hỏi lại
```

### Phụ thuộc giữa các tầng

```
Controllers → Services → Rules → Models
                 ↓
         IWarehouseStore ← EfWarehouseStore (Data)
```

- `Models` và `Rules` là C# thuần; `ArchitectureTests` đọc mã nguồn và đỏ nếu ai dùng EF, ASP.NET hay tầng trên.
- Controller mỏng: nhận ViewModel, gọi service, đổi kết quả sang mã HTTP.
- **Frontend không chứa luật**: không tự chọn khung, không tự khớp type, không tự kiểm tra đặt kệ — mọi quyết định đi qua API.

## Mô hình dữ liệu

Đơn vị: mọi kích thước và **mọi toạ độ là mét**, khối lượng **kg**. Lưới (`Room.GridSize`) chỉ để hít toạ độ trên giao diện, server không lưu gì theo ô.

| Đối tượng | Trường chính |
|---|---|
| `Room` | `Name`, `Width`, `Depth`, `GridSize`, `MinGap`, `Margin`, `Version`, `Racks`, `Obstacles` |
| `Obstacle` | `Kind` (Wall/Column), `X`, `Y`, `Width`, `Depth` |
| `Rack` | `Code`, `X`, `Y`, `Rotation` (0/90), `Levels`, `LevelHeight`, `Bays`, `BayWidth`, `Depth`, `HasTop`, `MaxWeight`, `ProductTypeId?` |
| `Slot` | `Code`, `Level`, `Bay`, `IsTop`, `AssignedSize?`, `PalletId?` (kích thước đọc từ `Rack`) |
| `PalletSize` (type) | `Code` (A, B, …), `Length`, `Width`, `Height`, `Weight?`, `Color` — số đo chính xác |
| `Pallet` | `Code` (`b1-P001`), `BatchId`, `SizeId`, `ProductTypeId?` |
| `Batch` | `Code` (`b1`), `ReceivedAt`, `Pallets` |

## Luật xếp pallet

1. **Type:** `PalletSizer` khớp một dòng nhập theo (cạnh dài, cạnh ngắn, cao, khối lượng) có sai số, không phân biệt dài/rộng (xoay 90° vẫn là một pallet). Chưa có type thì tạo mới. Thêm cỡ mới không phải sửa code.
2. **`Slot.CanHold`** trả `null` hoặc câu lý do. Thứ tự kiểm tra: loại hàng → đáy (thử xoay 90°) → chiều cao (bỏ qua với khung nóc) → tải trọng. Kệ chung nhận mọi pallet; kệ chuyên chỉ nhận đúng loại.
3. **`Allocator.Allocate`** trả `Placements` và `Rejected` và **không sửa khung** (`PalletService` mới gọi `Place()` rồi lưu):
   - Pallet không khung nào vừa bị từ chối ngay kèm lý do.
   - Gom theo **type** và xếp **từng type một**: type **đã có hàng trong kho** xếp trước (để lấp chỗ trống trong kệ của chính nó), rồi tới type có **ít khung nhận được nhất** (hoà thì thể tích lớn trước, rồi thứ tự nhập), vì type kén chỗ mà xếp sau thì dễ mất chỗ.
   - Mỗi pallet chọn khung trống vừa theo thứ tự ưu tiên: (0) kệ **chỉ chứa type này**; (1) kệ **chưa có hàng** (mỗi type một kệ riêng, dù kệ trước còn chỗ trống); (2) kệ có type này nhưng **đã lẫn type khác** (sau kệ trống, để hai type không tranh nhau một kệ); (3) một **tầng còn trống nguyên** trong kệ đã có hàng khác; (4) khung trống bất kỳ còn lại (phần dư nhét vào chỗ trống khi hết kệ riêng). Bằng hạng thì theo kệ → tầng → ô.
   - **Khung nóc luôn xếp sau cùng**, của mọi kệ: chỉ dùng khi không còn khung thường nào vừa. Không dùng ngẫu nhiên nên cùng lô cho cùng kết quả.
   - Giới hạn đã biết: không đảm bảo xếp hết khi các type không lồng nhau.
4. **Ba bước, bấm lại không xếp đôi:** Xem trước (không ghi) → Nhập lô (lưu pallet, chưa có khung) → Xếp (chỉ xếp pallet chưa nằm trong khung nào).

## API

| Method | Đường dẫn | Việc |
|---|---|---|
| `GET` | `/api/rooms` | Danh sách phòng |
| `POST` | `/api/rooms` | Tạo phòng (trống) |
| `GET` | `/api/rooms/{id}` | Một phòng: kệ, tường, cột, `version` |
| `POST` | `/api/rooms/{id}/layout/validate` | Kiểm tra thử cả bản nháp (bóng mờ), không lưu |
| `PUT` | `/api/rooms/{id}/layout` | Lưu cả bản nháp (một transaction; lệch `version` thì 409) |
| `GET` | `/api/rooms/{id}/slots` | Mọi khung của phòng kèm pallet, type, màu |
| `POST` | `/api/rooms/{id}/batches/preview` | Xem trước lô, không ghi |
| `POST` | `/api/batches` | Nhập lô (lưu lô và pallet) |
| `POST` | `/api/rooms/{id}/batches/{batchId}/allocate` | Xếp pallet chưa có khung của lô |
| `POST` | `/api/rooms/{id}/placements/reset` | Lấy mọi pallet ra khỏi khung |
| `GET/POST` | `/api/product-types` | Loại hàng |

Lỗi trả dạng ProblemDetails, câu lý do ở `detail`: 400 (đầu vào sai/vi phạm luật), 404, 409 (trùng, lệch phiên bản, kệ đang có hàng), 503 (mất kết nối database).

## Giới hạn đã biết

- Hai request ghi cùng lúc (ví dụ hai lần xếp, hoặc xếp và lưu bản nháp) vẫn có thể lọt qua nhau; kiểm tra `version` nằm ở service chưa phải `UPDATE … WHERE Version`.
- Store RAM (dùng trong test) không rollback được; chỉ PostgreSQL rollback thật.
- Bản nháp tự lưu chỉ ở trình duyệt đang dùng, không đồng bộ giữa các máy.

## Kịch bản demo (~5 phút)

1. Mở phòng "Kho mẫu" (2D): đặt một kệ mới, thử kéo đè cột để thấy bóng đỏ kèm lý do, Lưu nháp.
2. Kho 3D: xem 3 lô đã xếp sẵn, bấm vào khung xem mã và pallet.
3. Đặt lại kho, vào Nhập hàng: "Lô ví dụ 6A + 2B" → Xem trước → Xác nhận và xếp → xem pallet bay vào, pallet cao lên nóc.
4. Nhập một dòng số đo mới (ví dụ 1,0 × 0,6 × 0,5): hệ thống tự tạo type mới mà không sửa code.

## Hướng phát triển

- Robot quét bản đồ, khôi phục mặt bằng; realtime nhiều tab (SignalR); đăng nhập/phân quyền; mã vạch.
- Khoá dòng phòng (`FOR UPDATE`) hoặc `Serializable` để hai request ghi cùng lúc không lọt qua nhau.
- Ghép cặp hai phía trong `Allocator` để đảm bảo xếp hết khi có thể.
