namespace Warehouse.Api.Models;

public class Room
{
    public int Id { get; private set; }
    public string Name { get; private set; }
    public double Width { get; private set; }
    public double Depth { get; private set; }
    public double GridSize { get; private set; }
    public double MinGap { get; private set; }
    public double Margin { get; private set; }
    public int Version { get; private set; }

    public List<Rack> Racks { get; } = new();
    public List<Obstacle> Obstacles { get; } = new();

    public Room(string name, double width, double depth, double gridSize, double minGap, double margin)
    {
        Name = "";
        Configure(name, width, depth, gridSize, minGap, margin);
    }

    public void Configure(string name, double width, double depth, double gridSize, double minGap, double margin)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Tên phòng không được rỗng.", nameof(name));
        if (width <= 0)
            throw new ArgumentException("Chiều dài phòng phải lớn hơn 0.", nameof(width));
        if (depth <= 0)
            throw new ArgumentException("Chiều rộng phòng phải lớn hơn 0.", nameof(depth));
        if (gridSize <= 0)
            throw new ArgumentException("Bước lưới phải lớn hơn 0.", nameof(gridSize));
        if (minGap < 0)
            throw new ArgumentException("Lối đi tối thiểu không được âm.", nameof(minGap));
        if (margin < 0)
            throw new ArgumentException("Khoảng hở không được âm.", nameof(margin));

        Name = name.Trim();
        Width = width;
        Depth = depth;
        GridSize = gridSize;
        MinGap = minGap;
        Margin = margin;
    }

    public void BumpVersion() => Version++;

    public Rect Bounds => new(0, 0, Width, Depth);

    public void AddObstacle(Obstacle obstacle)
    {
        ArgumentNullException.ThrowIfNull(obstacle);
        if (!obstacle.Bounds.IsInside(Bounds))
            throw new ArgumentException("Vật cản nằm ngoài phòng.", nameof(obstacle));
        Obstacles.Add(obstacle);
    }

    public bool RemoveObstacle(int obstacleId) => Obstacles.RemoveAll(o => o.Id == obstacleId) > 0;
}
