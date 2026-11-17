namespace Warehouse.Api.Models;
public class Rack
{
    public int Id { get; private set; }
    public int RoomId { get; private set; }
    public string Code { get; private set; }
    public double X { get; private set; }
    public double Y { get; private set; }
    public int Rotation { get; private set; }
    public int Levels { get; private set; }
    public double LevelHeight { get; private set; }
    public int Bays { get; private set; }
    public double BayWidth { get; private set; }
    public double Depth { get; private set; }
    public bool HasTop { get; private set; }
    public double MaxWeight { get; private set; }

    public int? ProductTypeId { get; private set; }

    public Rack(int roomId, string code, double x, double y, int rotation,
                int levels, double levelHeight, int bays, double bayWidth, double depth,
                bool hasTop, double maxWeight, int? productTypeId = null)
    {
        if (string.IsNullOrWhiteSpace(code))
            throw new ArgumentException("Mã kệ không được rỗng.", nameof(code));

        RoomId = roomId;
        Code = code.Trim();
        Reconfigure(x, y, rotation, levels, levelHeight, bays, bayWidth, depth, hasTop, maxWeight, productTypeId);
    }

    public void Reconfigure(double x, double y, int rotation, int levels, double levelHeight,
                            int bays, double bayWidth, double depth, bool hasTop, double maxWeight, int? productTypeId)
    {
        if (x < 0)
            throw new ArgumentException("Toạ độ X không được âm.", nameof(x));
        if (y < 0)
            throw new ArgumentException("Toạ độ Y không được âm.", nameof(y));
        if (rotation is not (0 or 90))
            throw new ArgumentException("Hướng xoay chỉ được là 0 hoặc 90.", nameof(rotation));
        if (levels < 1)
            throw new ArgumentException("Kệ phải có ít nhất 1 tầng.", nameof(levels));
        if (levelHeight <= 0)
            throw new ArgumentException("Chiều cao tầng phải lớn hơn 0.", nameof(levelHeight));
        if (bays < 1)
            throw new ArgumentException("Kệ phải có ít nhất 1 ô.", nameof(bays));
        if (bayWidth <= 0)
            throw new ArgumentException("Chiều rộng ô phải lớn hơn 0.", nameof(bayWidth));
        if (depth <= 0)
            throw new ArgumentException("Chiều sâu kệ phải lớn hơn 0.", nameof(depth));
        if (maxWeight <= 0)
            throw new ArgumentException("Tải trọng khung phải lớn hơn 0.", nameof(maxWeight));

        X = x;
        Y = y;
        Rotation = rotation;
        Levels = levels;
        LevelHeight = levelHeight;
        Bays = bays;
        BayWidth = bayWidth;
        Depth = depth;
        HasTop = hasTop;
        MaxWeight = maxWeight;
        ProductTypeId = productTypeId;
    }

    public List<Slot> CreateSlots()
    {
        var slots = new List<Slot>();

        for (int level = 1; level <= Levels; level++)
        {
            for (int bay = 1; bay <= Bays; bay++)
            {
                slots.Add(new Slot(Id, $"{Code}-T{level}-R{bay}", level, bay, isTop: false));
            }
        }

        if (HasTop)
        {
            for (int bay = 1; bay <= Bays; bay++)
            {
                slots.Add(new Slot(Id, $"{Code}-N-R{bay}", Levels + 1, bay, isTop: true));
            }
        }

        return slots;
    }

    public Rect GetBounds()
    {
        var length = Bays * BayWidth;
        return Rotation == 90
            ? new Rect(X, Y, Depth, length)
            : new Rect(X, Y, length, Depth);
    }
}
