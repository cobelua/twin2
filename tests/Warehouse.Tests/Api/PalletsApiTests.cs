using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Warehouse.Api.Data;

namespace Warehouse.Tests.Api;

// Test qua HTTP thật (WebApplicationFactory): kiểm tra route, ràng buộc [Range]/[Required], mã trạng thái và
// ProblemDetails. Thay store PostgreSQL bằng store RAM để không đụng database và mỗi lần chạy đều sạch;
// tắt dữ liệu mẫu để mỗi test tự tạo phòng của mình.
public class PalletsApiTests(PalletsApiTests.RamFactory factory) : IClassFixture<PalletsApiTests.RamFactory>
{
    public class RamFactory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseSetting("Seed:SampleLayout", "false");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IWarehouseStore>();
                services.AddSingleton<IWarehouseStore, InMemoryWarehouseStore>();
            });
        }
    }

    private static int _roomCounter;

    private static readonly object Rack = new
    {
        id = (int?)null, code = "K1", x = 0, y = 0, rotation = 0, levels = 3, levelHeight = 1.2,
        bays = 3, bayWidth = 1.0, depth = 1.0, hasTop = true, maxWeight = 1000,
    };

    // Phòng riêng cho mỗi test (tên không trùng) với một kệ K1 (12 khung). Trả Id phòng.
    private async Task<int> NewRoomWithRack(HttpClient client)
    {
        var name = $"Phòng test {Interlocked.Increment(ref _roomCounter)}";
        var created = await client.PostAsJsonAsync("/api/rooms",
            new { name, width = 10, depth = 5, gridSize = 0.5, minGap = 1.0, margin = 0.05 });
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var roomId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        var saved = await client.PutAsJsonAsync($"/api/rooms/{roomId}/layout", new
        {
            name, width = 10, depth = 5, gridSize = 0.5, minGap = 1.0, margin = 0.05, version = 0,
            obstacles = Array.Empty<object>(), racks = new[] { Rack },
        });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        return roomId;
    }

    private static object Lot(params (int Qty, double L, double W, double H)[] lines) => new
    {
        lines = lines.Select(l => new { quantity = l.Qty, length = l.L, width = l.W, height = l.H }).ToArray(),
    };

    // ---- luồng chính ----

    [Fact]
    public async Task FullFlow_Check_Receive_Allocate_Slots_Reset()
    {
        var client = factory.CreateClient();
        var roomId = await NewRoomWithRack(client);
        var lot = Lot((6, 0.8, 0.8, 1.0), (2, 0.8, 0.8, 2.0));

        // Kiểm tra mọi kho (store dùng chung giữa các test nên lọc đúng phòng của test này): phòng này nhận cả 8.
        var check = await (await client.PostAsJsonAsync("/api/batches/check", lot)).Content.ReadFromJsonAsync<JsonElement>();
        var mine = check.GetProperty("rooms").EnumerateArray().Single(r => r.GetProperty("roomId").GetInt32() == roomId);
        Assert.Equal(8, mine.GetProperty("placeable").GetInt32());
        Assert.Equal(0, mine.GetProperty("missing").GetInt32());
        Assert.Equal(8, check.GetProperty("total").GetInt32());

        // Nhập lô, rồi xếp.
        var received = await (await client.PostAsJsonAsync("/api/batches", lot)).Content.ReadFromJsonAsync<JsonElement>();
        var batchId = received.GetProperty("batchId").GetInt32();
        Assert.Equal(8, received.GetProperty("palletCount").GetInt32());

        var allocate = await client.PostAsync($"/api/rooms/{roomId}/batches/{batchId}/allocate", null);
        Assert.Equal(HttpStatusCode.OK, allocate.StatusCode);
        var allocation = await allocate.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(8, allocation.GetProperty("placements").GetArrayLength());
        Assert.Equal(0, allocation.GetProperty("rejected").GetArrayLength());

        // Bấm xếp lại: không xếp đôi.
        var again = await (await client.PostAsync($"/api/rooms/{roomId}/batches/{batchId}/allocate", null))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, again.GetProperty("placements").GetArrayLength());
        Assert.Equal(8, again.GetProperty("alreadyPlaced").GetInt32());

        // Khung: 12 khung, 8 có hàng.
        var slots = await client.GetFromJsonAsync<JsonElement>($"/api/rooms/{roomId}/slots");
        Assert.Equal(12, slots.GetArrayLength());
        Assert.Equal(8, slots.EnumerateArray().Count(s => s.GetProperty("palletId").ValueKind != JsonValueKind.Null));

        // Đặt lại.
        var reset = await (await client.PostAsync($"/api/rooms/{roomId}/placements/reset", null)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(8, reset.GetProperty("cleared").GetInt32());
    }

    [Fact]
    public async Task SaveLayout_WithPallets_CannotRemoveRack_Returns409WithReason()
    {
        var client = factory.CreateClient();
        var roomId = await NewRoomWithRack(client);
        var received = await (await client.PostAsJsonAsync("/api/batches", Lot((1, 0.8, 0.8, 1.0)))).Content.ReadFromJsonAsync<JsonElement>();
        await client.PostAsync($"/api/rooms/{roomId}/batches/{received.GetProperty("batchId").GetInt32()}/allocate", null);
        var room = await client.GetFromJsonAsync<JsonElement>($"/api/rooms/{roomId}");

        var response = await client.PutAsJsonAsync($"/api/rooms/{roomId}/layout", new
        {
            name = room.GetProperty("name").GetString(), width = 10, depth = 5, gridSize = 0.5, minGap = 1.0, margin = 0.05,
            version = room.GetProperty("version").GetInt32(), obstacles = Array.Empty<object>(), racks = Array.Empty<object>(),
        });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("đang có hàng", problem.GetProperty("detail").GetString());
    }

    // ---- lỗi ----

    [Fact]
    public async Task SaveLayout_StaleVersion_Returns409()
    {
        var client = factory.CreateClient();
        var roomId = await NewRoomWithRack(client);   // phòng đã lên version 1

        var response = await client.PutAsJsonAsync($"/api/rooms/{roomId}/layout", new
        {
            name = "x", width = 10, depth = 5, gridSize = 0.5, minGap = 1.0, margin = 0.05, version = 0,
            obstacles = Array.Empty<object>(), racks = Array.Empty<object>(),
        });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Check_QuantityZero_Returns400WithVietnameseMessage()
    {
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/batches/check", Lot((0, 0.8, 0.8, 1.0)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Số lượng phải từ 1 đến 1000", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ReceiveBatch_EmptyLines_Returns400()
    {
        var response = await factory.CreateClient().PostAsJsonAsync("/api/batches", new { lines = Array.Empty<object>() });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UnknownRoomOrBatch_Returns404()
    {
        var client = factory.CreateClient();
        var roomId = await NewRoomWithRack(client);

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/rooms/9999/slots")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/api/rooms/9999/placements/reset", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"/api/rooms/{roomId}/batches/9999/allocate", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/api/batches/9999/distribute", null)).StatusCode);
    }

    [Fact]
    public async Task Distribute_PlacesTheBatchSomewhere_AndSecondCallPlacesNothing()
    {
        var client = factory.CreateClient();
        await NewRoomWithRack(client);   // chắc chắn có ít nhất một kho còn chỗ
        var received = await (await client.PostAsJsonAsync("/api/batches", Lot((1, 0.8, 0.8, 1.0)))).Content.ReadFromJsonAsync<JsonElement>();
        var batchId = received.GetProperty("batchId").GetInt32();

        var first = await (await client.PostAsync($"/api/batches/{batchId}/distribute", null)).Content.ReadFromJsonAsync<JsonElement>();
        var second = await (await client.PostAsync($"/api/batches/{batchId}/distribute", null)).Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(1, first.GetProperty("placed").GetInt32());
        Assert.Equal(1, first.GetProperty("rooms")[0].GetProperty("placements").GetArrayLength());
        Assert.Equal(0, second.GetProperty("placed").GetInt32());
    }

    [Fact]
    public async Task ProductTypes_CreateTwice_SecondIs409()
    {
        var client = factory.CreateClient();
        var code = "T" + Guid.NewGuid().ToString("N")[..6];

        var first = await client.PostAsJsonAsync("/api/product-types", new { code, name = "Ốc vít" });
        var second = await client.PostAsJsonAsync("/api/product-types", new { code, name = "Khác" });

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        var list = await client.GetFromJsonAsync<JsonElement>("/api/product-types");
        Assert.Contains(list.EnumerateArray(), t => t.GetProperty("code").GetString() == code);
    }

    [Fact]
    public async Task Allocate_PalletTooBig_ComesBackAsRejectedNotAnError()
    {
        var client = factory.CreateClient();
        var roomId = await NewRoomWithRack(client);
        var received = await (await client.PostAsJsonAsync("/api/batches", Lot((1, 1.5, 1.5, 1.0)))).Content.ReadFromJsonAsync<JsonElement>();

        var response = await client.PostAsync($"/api/rooms/{roomId}/batches/{received.GetProperty("batchId").GetInt32()}/allocate", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var allocation = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, allocation.GetProperty("placements").GetArrayLength());
        Assert.Equal(1, allocation.GetProperty("rejected").GetArrayLength());
    }
}
