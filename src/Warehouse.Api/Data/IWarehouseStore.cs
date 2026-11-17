namespace Warehouse.Api.Data;

using Warehouse.Api.Models;

public interface IWarehouseStore
{
    IReadOnlyList<Room> GetRooms();

    Room? GetRoom(int id);

    void SaveRoom(Room room);

    IReadOnlyList<Slot> GetAllSlots();

    IReadOnlyList<Slot> GetSlotsOfRacks(IReadOnlyCollection<int> rackIds);

    void AddSlots(IEnumerable<Slot> slots);

    void RemoveSlotsOfRack(int rackId);

    void UpdateSlots(IEnumerable<Slot> slots);

    IReadOnlyList<PalletSize> GetPalletSizes();

    void AddPalletSize(PalletSize size);

    IReadOnlyList<ProductType> GetProductTypes();

    void AddProductType(ProductType type);

    void AddBatch(Batch batch);

    Batch? GetBatch(int id);

    int CountBatches();

    IReadOnlyList<Pallet> GetPallets(IReadOnlyCollection<int> ids);

    void InTransaction(Action work);
}
