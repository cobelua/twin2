using Warehouse.Api.Data;
using Warehouse.Api.Models;

namespace Warehouse.Tests.Fakes;

/// <summary>
/// Store "gián điệp": làm y hệt InMemoryWarehouseStore nhưng ghi lại mỗi lần ghi có nằm trong InTransaction không.
/// Cần vì store RAM không rollback được, nên chỉ nhìn dữ liệu thì không biết service có quên bọc transaction hay không.
/// </summary>
public class SpyWarehouseStore : IWarehouseStore
{
    private readonly InMemoryWarehouseStore _inner = new();
    private bool _inTransaction;

    /// <summary>Mỗi lần ghi một dòng, ví dụ "SaveRoom (trong transaction)".</summary>
    public List<string> Writes { get; } = new();

    public IReadOnlyList<Room> GetRooms() => _inner.GetRooms();
    public Room? GetRoom(int id) => _inner.GetRoom(id);
    public IReadOnlyList<Slot> GetAllSlots() => _inner.GetAllSlots();
    public IReadOnlyList<Slot> GetSlotsOfRacks(IReadOnlyCollection<int> rackIds) => _inner.GetSlotsOfRacks(rackIds);

    public IReadOnlyList<PalletSize> GetPalletSizes() => _inner.GetPalletSizes();
    public IReadOnlyList<ProductType> GetProductTypes() => _inner.GetProductTypes();
    public Batch? GetBatch(int id) => _inner.GetBatch(id);
    public int CountBatches() => _inner.CountBatches();
    public IReadOnlyList<Pallet> GetPallets(IReadOnlyCollection<int> ids) => _inner.GetPallets(ids);

    public void AddPalletSize(PalletSize size) { Record(nameof(AddPalletSize)); _inner.AddPalletSize(size); }
    public void AddProductType(ProductType type) { Record(nameof(AddProductType)); _inner.AddProductType(type); }
    public void AddBatch(Batch batch) { Record(nameof(AddBatch)); _inner.AddBatch(batch); }
    public void UpdateSlots(IEnumerable<Slot> slots) { Record(nameof(UpdateSlots)); _inner.UpdateSlots(slots); }

    public void SaveRoom(Room room) { Record(nameof(SaveRoom)); _inner.SaveRoom(room); }
    public void AddSlots(IEnumerable<Slot> slots) { Record(nameof(AddSlots)); _inner.AddSlots(slots); }
    public void RemoveSlotsOfRack(int rackId) { Record(nameof(RemoveSlotsOfRack)); _inner.RemoveSlotsOfRack(rackId); }

    public void InTransaction(Action work)
    {
        _inTransaction = true;
        try { work(); }
        finally { _inTransaction = false; }
    }

    private void Record(string write)
        => Writes.Add(_inTransaction ? $"{write} (trong transaction)" : $"{write} (ngoài transaction)");
}
