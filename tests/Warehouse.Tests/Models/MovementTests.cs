using Warehouse.Api.Models;

namespace Warehouse.Tests.Models;

public class MovementTests
{
    private static readonly DateTime At = new(2026, 11, 10, 8, 5, 0);

    [Fact]
    public void Receive_WithOnlyToSlot_IsValid()
    {
        var m = new Movement(1, null, 5, MovementType.Receive, At);

        Assert.Null(m.FromSlotId);
        Assert.Equal(5, m.ToSlotId);
    }

    [Fact]
    public void Move_WithBothSlots_IsValid()
    {
        var m = new Movement(1, 5, 6, MovementType.Move, At);

        Assert.Equal(5, m.FromSlotId);
        Assert.Equal(6, m.ToSlotId);
    }

    [Fact]
    public void Ship_WithOnlyFromSlot_IsValid()
    {
        var m = new Movement(1, 6, null, MovementType.Ship, At);

        Assert.Equal(6, m.FromSlotId);
        Assert.Null(m.ToSlotId);
    }

    [Theory]
    [InlineData(MovementType.Receive, 5, 6)]
    [InlineData(MovementType.Receive, null, null)]
    [InlineData(MovementType.Move, null, 6)]
    [InlineData(MovementType.Move, 5, null)]
    [InlineData(MovementType.Ship, null, null)]
    [InlineData(MovementType.Ship, 5, 6)]
    public void InvalidSlotCombination_Throws(MovementType type, int? from, int? to)
    {
        var ex = Assert.Throws<ArgumentException>(() => new Movement(1, from, to, type, At));

        Assert.Equal("type", ex.ParamName);
    }
}
