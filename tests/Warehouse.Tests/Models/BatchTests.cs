using Warehouse.Api.Models;

namespace Warehouse.Tests.Models;

public class BatchTests
{
    [Fact]
    public void Constructor_ValidValues_KeepsValues()
    {
        var at = new DateTime(2026, 11, 10, 8, 0, 0);

        var batch = new Batch(" b1 ", at);

        Assert.Equal("b1", batch.Code);
        Assert.Equal(at, batch.ReceivedAt);
        Assert.Empty(batch.Pallets);
    }

    [Fact]
    public void Constructor_EmptyCode_Throws()
    {
        var ex = Assert.Throws<ArgumentException>(() => new Batch(" ", DateTime.Now));

        Assert.Equal("code", ex.ParamName);
    }
}
