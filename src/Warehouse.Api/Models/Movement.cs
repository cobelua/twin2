namespace Warehouse.Api.Models;

public enum MovementType
{
    Receive,

    Move,

    Ship,
}

public class Movement
{
    public int Id { get; private set; }
    public int PalletId { get; private set; }
    public int? FromSlotId { get; private set; }
    public int? ToSlotId { get; private set; }
    public MovementType Type { get; private set; }
    public DateTime At { get; private set; }

    public Movement(int palletId, int? fromSlotId, int? toSlotId, MovementType type, DateTime at)
    {
        switch (type)
        {
            case MovementType.Receive when fromSlotId is not null || toSlotId is null:
                throw new ArgumentException("Nhập kho: không có khung đi và phải có khung đến.", nameof(type));
            case MovementType.Move when fromSlotId is null || toSlotId is null:
                throw new ArgumentException("Chuyển khung: phải có cả khung đi và khung đến.", nameof(type));
            case MovementType.Ship when fromSlotId is null || toSlotId is not null:
                throw new ArgumentException("Xuất kho: phải có khung đi và không có khung đến.", nameof(type));
        }

        PalletId = palletId;
        FromSlotId = fromSlotId;
        ToSlotId = toSlotId;
        Type = type;
        At = at;
    }
}
