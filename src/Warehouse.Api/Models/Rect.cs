namespace Warehouse.Api.Models;

public readonly record struct Rect(double X, double Y, double Width, double Depth)
{
    public double Right => X + Width;
    public double Bottom => Y + Depth;

    public bool Overlaps(Rect other)
        => Tolerance.LessThan(X, other.Right) && Tolerance.LessThan(other.X, Right)
        && Tolerance.LessThan(Y, other.Bottom) && Tolerance.LessThan(other.Y, Bottom);

    public bool IsInside(Rect outer)
        => Tolerance.AtMost(outer.X, X) && Tolerance.AtMost(Right, outer.Right)
        && Tolerance.AtMost(outer.Y, Y) && Tolerance.AtMost(Bottom, outer.Bottom);

    public (double Dx, double Dy) GapTo(Rect other)
        => (Math.Max(0, Math.Max(other.X - Right, X - other.Right)),
            Math.Max(0, Math.Max(other.Y - Bottom, Y - other.Bottom)));
}
