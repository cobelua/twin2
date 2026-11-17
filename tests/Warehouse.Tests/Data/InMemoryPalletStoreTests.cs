using Warehouse.Api.Data;
using Warehouse.Api.Models;

namespace Warehouse.Tests.Data;

// Phần lưu trữ type pallet, loại hàng, lô, pallet của store RAM (giống DB thật: Save/Add gán Id).
public class InMemoryPalletStoreTests
{
    [Fact]
    public void AddPalletSize_AssignsIdsAndListsInOrder()
    {
        var store = new InMemoryWarehouseStore();
        var a = new PalletSize("A", 1.2, 0.8, 1.0, "#e53935");
        var b = new PalletSize("B", 1.2, 0.8, 1.6, "#1e88e5");

        store.AddPalletSize(a);
        store.AddPalletSize(b);

        Assert.Equal(new[] { 1, 2 }, store.GetPalletSizes().Select(s => s.Id));
        Assert.Equal(new[] { "A", "B" }, store.GetPalletSizes().Select(s => s.Code));
    }

    [Fact]
    public void AddProductType_AssignsId()
    {
        var store = new InMemoryWarehouseStore();
        var type = new ProductType("OV", "Ốc vít");

        store.AddProductType(type);

        Assert.NotEqual(0, type.Id);
        Assert.Same(type, Assert.Single(store.GetProductTypes()));
    }

    [Fact]
    public void AddBatch_AssignsBatchAndPalletIdsAndBatchId()
    {
        var store = new InMemoryWarehouseStore();
        var size = new PalletSize("A", 1.2, 0.8, 1.0, "#e53935");
        store.AddPalletSize(size);
        var batch = new Batch("b1", DateTime.UtcNow);
        batch.Pallets.Add(new Pallet(0, size, "b1-P001"));
        batch.Pallets.Add(new Pallet(0, size, "b1-P002"));

        store.AddBatch(batch);

        Assert.NotEqual(0, batch.Id);
        Assert.All(batch.Pallets, p => Assert.Equal(batch.Id, p.BatchId));
        Assert.Equal(2, batch.Pallets.Select(p => p.Id).Distinct().Count());
        Assert.All(batch.Pallets, p => Assert.NotEqual(0, p.Id));
    }

    [Fact]
    public void GetPallets_ReturnsOnlyRequestedIdsInOrderWithSize()
    {
        var store = new InMemoryWarehouseStore();
        var size = new PalletSize("A", 1.2, 0.8, 1.0, "#e53935");
        store.AddPalletSize(size);
        var batch = new Batch("b1", DateTime.UtcNow);
        for (var i = 1; i <= 3; i++)
            batch.Pallets.Add(new Pallet(0, size, $"b1-P00{i}"));
        store.AddBatch(batch);

        var found = store.GetPallets([batch.Pallets[2].Id, batch.Pallets[0].Id, 999]);

        Assert.Equal(new[] { "b1-P001", "b1-P003" }, found.Select(p => p.Code));
        Assert.All(found, p => Assert.Equal("A", p.Size.Code));
    }
}
