namespace Warehouse.Api.Services;

using Warehouse.Api.Data;
using Warehouse.Api.Models;
using Warehouse.Api.Rules;
using Warehouse.Api.ViewModels;

public interface IPalletService
{
    ServiceResult<IReadOnlyList<ProductTypeViewModel>> GetProductTypes();
    ServiceResult<ProductTypeViewModel> CreateProductType(ProductTypeRequest request);
    ServiceResult<BatchCheckViewModel> CheckBatch(BatchRequest request);
    ServiceResult<BatchReceivedViewModel> ReceiveBatch(BatchRequest request);
    ServiceResult<AllocationViewModel> Allocate(int roomId, int batchId);
    ServiceResult<DistributionViewModel> Distribute(int batchId);
    ServiceResult<IReadOnlyList<SlotViewModel>> GetSlots(int roomId);
    ServiceResult<ResetViewModel> ResetPlacements(int roomId);
}

public class PalletService(IWarehouseStore store) : IPalletService
{
    public const int MaxPalletsPerBatch = 2000;

    private sealed record ResolvedLine(BatchLineRequest Line, PalletSize Size, bool IsNew);

    public ServiceResult<IReadOnlyList<ProductTypeViewModel>> GetProductTypes()
        => ServiceResult<IReadOnlyList<ProductTypeViewModel>>.Ok(
            store.GetProductTypes().Select(t => new ProductTypeViewModel(t.Id, t.Code, t.Name)).ToList());

    public ServiceResult<ProductTypeViewModel> CreateProductType(ProductTypeRequest request)
    {
        ProductType type;
        try
        {
            type = new ProductType(request.Code, request.Name);
        }
        catch (ArgumentException ex)
        {
            return ServiceResult<ProductTypeViewModel>.Fail(ServiceError.Invalid, ex.Message);
        }

        if (store.GetProductTypes().Any(t => string.Equals(t.Code, type.Code, StringComparison.OrdinalIgnoreCase)))
            return ServiceResult<ProductTypeViewModel>.Fail(ServiceError.Conflict, $"Đã có loại hàng mã {type.Code}.");

        store.AddProductType(type);
        return ServiceResult<ProductTypeViewModel>.Ok(new ProductTypeViewModel(type.Id, type.Code, type.Name));
    }

    public ServiceResult<BatchCheckViewModel> CheckBatch(BatchRequest request)
    {
        if (CheckRequest(request) is { } requestError)
            return ServiceResult<BatchCheckViewModel>.Fail(ServiceError.Invalid, requestError);

        var (resolved, error) = ResolveLines(request, save: null);
        if (resolved is null)
            return ServiceResult<BatchCheckViewModel>.Fail(ServiceError.Invalid, error!);

        var palletsOfLine = resolved
            .Select(r => Enumerable.Range(0, r.Line.Quantity)
                .Select(_ => new Pallet(0, r.Size, "xem-truoc", r.Line.ProductTypeId)).ToList())
            .ToList();
        var lineOf = new Dictionary<Pallet, int>();
        for (var i = 0; i < palletsOfLine.Count; i++)
            foreach (var pallet in palletsOfLine[i])
                lineOf[pallet] = i;
        var all = palletsOfLine.SelectMany(p => p).ToList();

        var rooms = AllRooms();
        var roomChecks = rooms.Select(room =>
        {
            var allocation = Allocator.Allocate(all, room.Candidates, room.Margin);
            var placeable = allocation.Placements.GroupBy(p => lineOf[p.Pallet]).ToDictionary(g => g.Key, g => g.Count());
            var notes = new List<string>();
            for (var i = 0; i < resolved.Count; i++)
            {
                var search = SlotFinder.Find(room.Candidates, palletsOfLine[i][0], room.Margin);
                var note = Shortage(room.Candidates.Count, search, resolved[i].Size.Code, resolved[i].Line.Quantity, placeable.GetValueOrDefault(i));
                if (note is not null)
                    notes.Add(note);
            }
            return new RoomCheckViewModel(room.RoomId, room.Name, allocation.Placements.Count,
                all.Count - allocation.Placements.Count, notes.Distinct().ToList());
        }).ToList();

        var plan = Distributor.Distribute(all, rooms, preferredRoomId: null);

        var lines = resolved.Select(r => new BatchLineCheckViewModel(
            r.Line.Quantity, r.Size.Code, r.IsNew, r.Size.Color, r.Size.Length, r.Size.Width, r.Size.Height, r.Size.Weight,
            r.Line.ProductTypeId)).ToList();

        return ServiceResult<BatchCheckViewModel>.Ok(new BatchCheckViewModel(
            all.Count, lines, roomChecks, ToViewModel(null, all.Count, plan, withPlacements: false)));
    }

    private static string? Shortage(int slotCount, SlotSearchResult search, string typeCode, int needed, int placeable)
    {
        if (!search.HasAnyFittingSlot)
        {
            return slotCount == 0
                ? "Kho chưa có khung nào."
                : $"Không có kệ thích hợp cho type {typeCode}: {string.Join(" ", search.RejectionReasons)}";
        }
        if (placeable == 0)
            return $"Các kệ thích hợp cho type {typeCode} đã đầy.";
        if (placeable < needed)
            return $"Type {typeCode}: xếp được {placeable} / {needed}, thiếu {needed - placeable} ô.";
        return null;
    }

    public ServiceResult<BatchReceivedViewModel> ReceiveBatch(BatchRequest request)
    {
        if (CheckRequest(request) is { } requestError)
            return ServiceResult<BatchReceivedViewModel>.Fail(ServiceError.Invalid, requestError);

        var (dryRun, error) = ResolveLines(request, save: null);
        if (dryRun is null)
            return ServiceResult<BatchReceivedViewModel>.Fail(ServiceError.Invalid, error!);

        Batch? batch = null;
        store.InTransaction(() =>
        {
            var (resolved, _) = ResolveLines(request, save: store.AddPalletSize);

            batch = new Batch($"b{store.CountBatches() + 1}", DateTime.UtcNow);
            var number = 0;
            foreach (var (line, size, _) in resolved!)
            {
                for (var i = 0; i < line.Quantity; i++)
                    batch.Pallets.Add(new Pallet(0, size, $"{batch.Code}-P{++number:000}", line.ProductTypeId));
            }

            store.AddBatch(batch);
        });

        return ServiceResult<BatchReceivedViewModel>.Ok(
            new BatchReceivedViewModel(batch!.Id, batch.Code, batch.Pallets.Count));
    }

    public ServiceResult<AllocationViewModel> Allocate(int roomId, int batchId)
    {
        var room = store.GetRoom(roomId);
        if (room is null)
            return NoRoom<AllocationViewModel>(roomId);

        ServiceResult<AllocationViewModel> outcome = default!;
        store.InTransaction(() =>
        {
            var batch = store.GetBatch(batchId);
            if (batch is null)
            {
                outcome = ServiceResult<AllocationViewModel>.Fail(ServiceError.NotFound, $"Không có lô Id {batchId}.");
                return;
            }

            var placedIds = store.GetAllSlots().Where(s => s.PalletId is not null).Select(s => s.PalletId!.Value).ToHashSet();
            var unplaced = batch.Pallets.Where(p => !placedIds.Contains(p.Id)).OrderBy(p => p.Id).ToList();

            var allocation = Allocator.Allocate(unplaced, PlacementOrder(room), room.Margin);

            foreach (var placement in allocation.Placements)
                placement.Target.Slot.Place(placement.Pallet);
            store.UpdateSlots(allocation.Placements.Select(p => p.Target.Slot).ToList());

            outcome = ServiceResult<AllocationViewModel>.Ok(new AllocationViewModel(
                batch.Id,
                allocation.Placements.Select(ToViewModel).ToList(),
                allocation.Rejected.Select(r => new RejectionViewModel(r.Pallet.Code, r.Reason)).ToList(),
                batch.Pallets.Count - unplaced.Count));
        });

        return outcome;
    }

    public ServiceResult<DistributionViewModel> Distribute(int batchId)
    {
        ServiceResult<DistributionViewModel> outcome = default!;
        store.InTransaction(() =>
        {
            var batch = store.GetBatch(batchId);
            if (batch is null)
            {
                outcome = ServiceResult<DistributionViewModel>.Fail(ServiceError.NotFound, $"Không có lô Id {batchId}.");
                return;
            }

            var placedIds = store.GetAllSlots().Where(s => s.PalletId is not null).Select(s => s.PalletId!.Value).ToHashSet();
            var unplaced = batch.Pallets.Where(p => !placedIds.Contains(p.Id)).OrderBy(p => p.Id).ToList();

            var result = Distributor.Distribute(unplaced, AllRooms(), preferredRoomId: null);
            var all = result.Shares.SelectMany(s => s.Placements).ToList();
            foreach (var placement in all)
                placement.Target.Slot.Place(placement.Pallet);
            store.UpdateSlots(all.Select(p => p.Target.Slot).ToList());

            outcome = ServiceResult<DistributionViewModel>.Ok(ToViewModel(batch.Id, unplaced.Count, result, withPlacements: true));
        });

        return outcome;
    }

    private List<RoomSlots> AllRooms()
        => store.GetRooms().Select(r => new RoomSlots(r.Id, r.Name, PlacementOrder(r), r.Margin)).ToList();

    private static DistributionViewModel ToViewModel(int? batchId, int total, DistributionResult result, bool withPlacements)
        => new(
            batchId,
            total,
            result.Shares.Sum(s => s.Placements.Count),
            result.Shares.Select(s => new RoomShareViewModel(
                s.RoomId, s.Name, s.Placements.Count,
                withPlacements ? s.Placements.Select(ToViewModel).ToList() : new List<PlacementViewModel>())).ToList(),
            result.Rejected.Select(r => new RejectionViewModel(r.Pallet.Code, r.Reason)).ToList());

    private static PlacementViewModel ToViewModel(Placement p)
        => new(p.Pallet.Code, p.Pallet.Size.Code, p.Pallet.Size.Color,
               p.Target.Rack.Code, p.Target.Slot.Code, p.Target.Slot.Level, p.Target.Slot.Bay, p.Target.Slot.IsTop);

    public ServiceResult<IReadOnlyList<SlotViewModel>> GetSlots(int roomId)
    {
        var room = store.GetRoom(roomId);
        if (room is null)
            return NoRoom<IReadOnlyList<SlotViewModel>>(roomId);

        var candidates = CandidatesOf(room);
        var palletIds = candidates.Select(c => c.Slot.PalletId).OfType<int>().ToList();
        var pallets = store.GetPallets(palletIds).ToDictionary(p => p.Id);

        var slots = candidates.Select(c =>
        {
            var pallet = c.Slot.PalletId is int id ? pallets.GetValueOrDefault(id) : null;
            (double AlongBay, double AcrossDepth)? footprint = pallet is null ? null : Slot.PalletFootprint(c.Rack, pallet.Size);
            return new SlotViewModel(
                c.Slot.Id, c.Rack.Id, c.Rack.Code, c.Slot.Code, c.Slot.Level, c.Slot.Bay, c.Slot.IsTop,
                c.Slot.PalletId, pallet?.Code, pallet?.Size.Code, pallet?.Size.Color,
                footprint?.AlongBay, footprint?.AcrossDepth, pallet?.Size.Height);
        }).ToList();

        return ServiceResult<IReadOnlyList<SlotViewModel>>.Ok(slots);
    }

    public ServiceResult<ResetViewModel> ResetPlacements(int roomId)
    {
        var room = store.GetRoom(roomId);
        if (room is null)
            return NoRoom<ResetViewModel>(roomId);

        var cleared = 0;
        store.InTransaction(() =>
        {
            var full = store.GetSlotsOfRacks(room.Racks.Select(r => r.Id).ToList()).Where(s => !s.IsEmpty).ToList();
            foreach (var slot in full)
                slot.Remove();
            store.UpdateSlots(full);
            cleared = full.Count;
        });

        return ServiceResult<ResetViewModel>.Ok(new ResetViewModel(cleared));
    }

    private static string? CheckRequest(BatchRequest request)
    {
        if (request.Lines.Count == 0)
            return "Lô phải có ít nhất một dòng.";
        if (request.Lines.Sum(l => (long)l.Quantity) > MaxPalletsPerBatch)
            return $"Một lô tối đa {MaxPalletsPerBatch} pallet.";
        return null;
    }

    private (List<ResolvedLine>? Lines, string? Error) ResolveLines(BatchRequest request, Action<PalletSize>? save)
    {
        var productTypeIds = store.GetProductTypes().Select(t => t.Id).ToHashSet();
        var sizes = store.GetPalletSizes().ToList();
        var resolved = new List<ResolvedLine>();

        foreach (var line in request.Lines)
        {
            if (line.ProductTypeId is { } typeId && !productTypeIds.Contains(typeId))
                return (null, $"Không có loại hàng Id {typeId}.");

            SizeResolution resolution;
            try
            {
                resolution = PalletSizer.Resolve(sizes, line.Length, line.Width, line.Height, line.Weight);
            }
            catch (ArgumentException ex)
            {
                return (null, ex.Message);
            }

            if (resolution.IsNew)
            {
                save?.Invoke(resolution.Size);
                sizes.Add(resolution.Size);
            }
            resolved.Add(new ResolvedLine(line, resolution.Size, resolution.IsNew));
        }

        return (resolved, null);
    }

    private List<SlotCandidate> PlacementOrder(Room room)
        => CandidatesOf(room).OrderBy(c => c.Slot.IsTop).ToList();

    private List<SlotCandidate> CandidatesOf(Room room)
    {
        var slotsOfRack = store.GetSlotsOfRacks(room.Racks.Select(r => r.Id).ToList()).ToLookup(s => s.RackId);
        return room.Racks
            .SelectMany(rack => slotsOfRack[rack.Id]
                .OrderBy(s => s.Level).ThenBy(s => s.Bay)
                .Select(slot => new SlotCandidate(rack, slot)))
            .ToList();
    }

    private static ServiceResult<T> NoRoom<T>(int roomId)
        => ServiceResult<T>.Fail(ServiceError.NotFound, $"Không có phòng Id {roomId}.");
}
