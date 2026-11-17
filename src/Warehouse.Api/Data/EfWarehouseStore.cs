namespace Warehouse.Api.Data;

using Microsoft.EntityFrameworkCore;
using Warehouse.Api.Models;

public class EfWarehouseStore(WarehouseDbContext db) : IWarehouseStore
{
    public IReadOnlyList<Room> GetRooms()
        => RoomsWithChildren().OrderBy(r => r.Id).ToList();

    public Room? GetRoom(int id)
        => RoomsWithChildren().FirstOrDefault(r => r.Id == id);

    private IQueryable<Room> RoomsWithChildren()
        => db.Rooms
             .Include(r => r.Racks.OrderBy(k => k.Id))
             .Include(r => r.Obstacles.OrderBy(o => o.Id))
             .AsSplitQuery();

    public void SaveRoom(Room room)
    {
        ArgumentNullException.ThrowIfNull(room);

        if (db.Entry(room).State == EntityState.Detached)
        {
            if (room.Id == 0)
                db.Rooms.Add(room);
            else
                db.Rooms.Update(room);
        }

        db.SaveChanges();
    }

    public IReadOnlyList<Slot> GetAllSlots()
        => db.Slots.OrderBy(s => s.Id).ToList();

    public IReadOnlyList<Slot> GetSlotsOfRacks(IReadOnlyCollection<int> rackIds)
        => db.Slots.Where(s => rackIds.Contains(s.RackId)).OrderBy(s => s.Id).ToList();

    public void AddSlots(IEnumerable<Slot> slots)
    {
        ArgumentNullException.ThrowIfNull(slots);

        db.Slots.AddRange(slots);
        db.SaveChanges();
    }

    public void RemoveSlotsOfRack(int rackId)
    {
        var slots = db.Slots.Where(s => s.RackId == rackId).ToList();
        db.Slots.RemoveRange(slots);
        db.SaveChanges();
    }

    public void UpdateSlots(IEnumerable<Slot> slots)
    {
        ArgumentNullException.ThrowIfNull(slots);

        foreach (var slot in slots)
        {
            if (db.Entry(slot).State == EntityState.Detached)
                db.Slots.Update(slot);
        }
        db.SaveChanges();
    }

    public IReadOnlyList<PalletSize> GetPalletSizes()
        => db.PalletSizes.OrderBy(s => s.Id).ToList();

    public void AddPalletSize(PalletSize size)
    {
        ArgumentNullException.ThrowIfNull(size);
        db.PalletSizes.Add(size);
        db.SaveChanges();
    }

    public IReadOnlyList<ProductType> GetProductTypes()
        => db.ProductTypes.OrderBy(t => t.Id).ToList();

    public void AddProductType(ProductType type)
    {
        ArgumentNullException.ThrowIfNull(type);
        db.ProductTypes.Add(type);
        db.SaveChanges();
    }

    public void AddBatch(Batch batch)
    {
        ArgumentNullException.ThrowIfNull(batch);
        db.Batches.Add(batch);
        db.SaveChanges();
    }

    public Batch? GetBatch(int id)
        => db.Batches.Include(b => b.Pallets).ThenInclude(p => p.Size).FirstOrDefault(b => b.Id == id);

    public int CountBatches() => db.Batches.Count();

    public IReadOnlyList<Pallet> GetPallets(IReadOnlyCollection<int> ids)
        => db.Pallets.Include(p => p.Size).Where(p => ids.Contains(p.Id)).OrderBy(p => p.Id).ToList();

    public void InTransaction(Action work)
    {
        ArgumentNullException.ThrowIfNull(work);

        using var transaction = db.Database.BeginTransaction();

        work();

        transaction.Commit();
    }
}
