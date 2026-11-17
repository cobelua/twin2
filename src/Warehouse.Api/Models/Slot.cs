namespace Warehouse.Api.Models;

public class Slot
{
    public int Id { get; private set; }
    public int RackId { get; private set; }
    public string Code { get; private set; }
    public int Level { get; private set; }
    public int Bay { get; private set; }
    public bool IsTop { get; private set; }
    public string? AssignedSize { get; private set; }
    public int? PalletId { get; private set; }

    public Slot(int rackId, string code, int level, int bay, bool isTop)
    {
        if (string.IsNullOrWhiteSpace(code))
            throw new ArgumentException("Mã khung không được rỗng.", nameof(code));
        if (level < 1)
            throw new ArgumentException("Tầng đếm từ 1.", nameof(level));
        if (bay < 1)
            throw new ArgumentException("Ô đếm từ 1.", nameof(bay));

        RackId = rackId;
        Code = code.Trim();
        Level = level;
        Bay = bay;
        IsTop = isTop;
    }

    public bool IsEmpty => PalletId is null;

    public string? CanHold(Rack rack, Pallet pallet, double margin)
    {
        ArgumentNullException.ThrowIfNull(rack);
        ArgumentNullException.ThrowIfNull(pallet);
        if (margin < 0)
            throw new ArgumentException("Khoảng hở không được âm.", nameof(margin));

        if (rack.ProductTypeId is not null && rack.ProductTypeId != pallet.ProductTypeId)
            return "Kệ chỉ dành cho loại hàng khác.";

        var size = pallet.Size;

        bool fitsFloor =
            (Tolerance.AtMost(size.Length, rack.BayWidth) && Tolerance.AtMost(size.Width, rack.Depth))
            || (Tolerance.AtMost(size.Width, rack.BayWidth) && Tolerance.AtMost(size.Length, rack.Depth));
        if (!fitsFloor)
            return "Pallet rộng hơn khung.";

        if (!IsTop && !Tolerance.AtMost(size.Height, rack.LevelHeight - margin))
            return "Pallet cao hơn khung.";

        if (size.Weight is double weight && !Tolerance.AtMost(weight, rack.MaxWeight))
            return "Pallet nặng hơn tải trọng khung.";

        return null;
    }

    public static (double AlongBay, double AcrossDepth) PalletFootprint(Rack rack, PalletSize size)
    {
        ArgumentNullException.ThrowIfNull(rack);
        ArgumentNullException.ThrowIfNull(size);
        return Tolerance.AtMost(size.Length, rack.BayWidth) && Tolerance.AtMost(size.Width, rack.Depth)
            ? (size.Length, size.Width)
            : (size.Width, size.Length);
    }

    public void Place(Pallet pallet)
    {
        ArgumentNullException.ThrowIfNull(pallet);
        if (!IsEmpty)
            throw new InvalidOperationException($"Khung {Code} đã có pallet.");

        PalletId = pallet.Id;
        AssignedSize = pallet.Size.Code;
    }

    public void Remove()
    {
        PalletId = null;
        AssignedSize = null;
    }
}
