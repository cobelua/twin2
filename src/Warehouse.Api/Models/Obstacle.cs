namespace Warehouse.Api.Models;

public enum ObstacleKind
{
    Wall,
    Column,
}

public class Obstacle
{
    public int Id { get; private set; }
    public int RoomId { get; private set; }
    public ObstacleKind Kind { get; private set; }
    public double X { get; private set; }
    public double Y { get; private set; }
    public double Width { get; private set; }
    public double Depth { get; private set; }

    public Obstacle(int roomId, ObstacleKind kind, double x, double y, double width, double depth)
    {
        RoomId = roomId;
        Reconfigure(kind, x, y, width, depth);
    }

    public void Reconfigure(ObstacleKind kind, double x, double y, double width, double depth)
    {
        if (x < 0)
            throw new ArgumentException("Toạ độ X không được âm.", nameof(x));
        if (y < 0)
            throw new ArgumentException("Toạ độ Y không được âm.", nameof(y));
        if (width <= 0)
            throw new ArgumentException("Chiều dài vật cản phải lớn hơn 0.", nameof(width));
        if (depth <= 0)
            throw new ArgumentException("Chiều rộng vật cản phải lớn hơn 0.", nameof(depth));

        Kind = kind;
        X = x;
        Y = y;
        Width = width;
        Depth = depth;
    }

    public Rect Bounds => new(X, Y, Width, Depth);
}
