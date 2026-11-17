using Microsoft.Extensions.Logging.Abstractions;
using Warehouse.Api.Data;
using Warehouse.Api.Infrastructure;
using Warehouse.Api.Services;

namespace Warehouse.Tests.Infrastructure;

// Đọc đúng file sample-layout.json thật (được chép theo khi build): ai sửa file làm kệ đè nhau
// hay thiếu lối đi thì test đỏ ngay, không phải đợi tới lúc chạy demo.
public class SampleLayoutSeederTests
{
    private static readonly string SamplePath =
        Path.Combine(AppContext.BaseDirectory, "SampleData", "sample-layout.json");

    [Fact]
    public void Seed_EmptyStore_CreatesSampleRoomRacksAndSlots()
    {
        var store = new InMemoryWarehouseStore();
        var layout = new LayoutService(store);

        SampleLayoutSeeder.Seed(layout, NullLogger.Instance, SamplePath);

        var room = store.GetRooms().Single();
        Assert.Equal("Kho mẫu", room.Name);
        Assert.Equal(20, room.Width);
        Assert.Equal(12, room.Depth);
        Assert.Equal(5, room.Obstacles.Count);
        Assert.Equal(8, room.Racks.Count);
        Assert.Equal(108, store.GetAllSlots().Count);
        Assert.Equal(90, room.Racks.Single(r => r.Code == "K8").Rotation);
    }

    [Fact]
    public void Seed_RoomAlreadyExists_DoesNothing()
    {
        var store = new InMemoryWarehouseStore();
        var layout = new LayoutService(store);
        SampleLayoutSeeder.Seed(layout, NullLogger.Instance, SamplePath);

        SampleLayoutSeeder.Seed(layout, NullLogger.Instance, SamplePath);

        Assert.Equal(8, store.GetRooms().Single().Racks.Count);
        Assert.Equal(108, store.GetAllSlots().Count);
    }

    private static readonly string BatchesPath =
        Path.Combine(AppContext.BaseDirectory, "SampleData", "sample-batches.json");

    [Fact]
    public void Seed_WithBatchesFile_ReceivesAndAllocatesThreeLots()
    {
        var store = new InMemoryWarehouseStore();
        var layout = new LayoutService(store);
        var pallets = new PalletService(store);

        SampleLayoutSeeder.Seed(layout, NullLogger.Instance, SamplePath, pallets, BatchesPath);

        Assert.Equal(3, store.CountBatches());
        var placed = store.GetAllSlots().Count(s => s.PalletId is not null);
        Assert.InRange(placed, 30, 108);   // đa số pallet có khung, nhưng không vượt tổng số khung
        // Lô 3 có 2 pallet 1,5 × 1,5 m không kệ nào chứa được: chúng ở lại trong lô, chưa có khung.
        var batch3 = store.GetBatch(3)!;
        Assert.Equal(12, batch3.Pallets.Count);
        var placedIds = store.GetAllSlots().Where(s => s.PalletId is not null).Select(s => s.PalletId!.Value).ToHashSet();
        Assert.Equal(2, batch3.Pallets.Count(p => !placedIds.Contains(p.Id)));
    }

    [Fact]
    public void Seed_RoomAlreadyExists_DoesNotAddLots()
    {
        var store = new InMemoryWarehouseStore();
        var layout = new LayoutService(store);
        var pallets = new PalletService(store);
        SampleLayoutSeeder.Seed(layout, NullLogger.Instance, SamplePath);   // phòng có sẵn, chưa có lô

        SampleLayoutSeeder.Seed(layout, NullLogger.Instance, SamplePath, pallets, BatchesPath);

        Assert.Equal(0, store.CountBatches());
    }
}
