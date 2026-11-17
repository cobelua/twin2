namespace Warehouse.Api.Infrastructure;

using System.Text.Json;
using Warehouse.Api.Services;
using Warehouse.Api.ViewModels;

public record SampleLayout(RoomRequest Room, LayoutObstacleRequest[] Obstacles, LayoutRackRequest[] Racks);

public record SampleBatches(SampleBatch[] Batches);

public record SampleBatch(string Name, BatchLineRequest[] Lines);

public static class SampleLayoutSeeder
{
    public static void Seed(
        ILayoutService layout, ILogger logger, string path, IPalletService? pallets = null, string? batchesPath = null)
    {
        if (layout.GetRooms().Value!.Count > 0)
            return;

        var sample = JsonSerializer.Deserialize<SampleLayout>(File.ReadAllText(path), JsonSerializerOptions.Web)
                     ?? throw new InvalidOperationException($"File phòng mẫu rỗng: {path}");

        var roomId = Check(layout.CreateRoom(sample.Room), "phòng").Id;

        var room = sample.Room;
        var draft = new LayoutRequest
        {
            Name = room.Name, Width = room.Width, Depth = room.Depth,
            GridSize = room.GridSize, MinGap = room.MinGap, Margin = room.Margin,
            Version = 0, Obstacles = [.. sample.Obstacles], Racks = [.. sample.Racks],
        };
        Check(layout.SaveLayout(roomId, draft), "bản nháp phòng");

        logger.LogInformation("Đã tạo phòng mẫu {Name} {Width} × {Depth} m: {Obstacles} vật cản, {Racks} kệ.",
            sample.Room.Name, sample.Room.Width, sample.Room.Depth, sample.Obstacles.Length, sample.Racks.Length);

        if (pallets is not null && batchesPath is not null && File.Exists(batchesPath))
            SeedBatches(pallets, logger, roomId, batchesPath);
    }

    private static void SeedBatches(IPalletService pallets, ILogger logger, int roomId, string path)
    {
        var sample = JsonSerializer.Deserialize<SampleBatches>(File.ReadAllText(path), JsonSerializerOptions.Web)
                     ?? throw new InvalidOperationException($"File lô mẫu rỗng: {path}");

        foreach (var batch in sample.Batches)
        {
            var request = new BatchRequest { Lines = [.. batch.Lines] };
            var received = Check(pallets.ReceiveBatch(request), $"lô \"{batch.Name}\"");
            var allocation = Check(pallets.Allocate(roomId, received.BatchId), $"xếp lô \"{batch.Name}\"");

            logger.LogInformation("Đã nhập lô mẫu {Code} ({Name}): xếp {Placed}/{Total} pallet, {Rejected} pallet không có khung.",
                received.Code, batch.Name, allocation.Placements.Count, received.PalletCount, allocation.Rejected.Count);
        }
    }

    private static T Check<T>(ServiceResult<T> result, string what)
    {
        if (!result.IsSuccess)
            throw new InvalidOperationException($"Không tạo được {what} trong dữ liệu mẫu: {result.Message}");
        return result.Value!;
    }
}
