namespace Warehouse.Api.Rules;

using System.Globalization;
using Warehouse.Api.Models;

public static class PlacementValidator
{
    public static string? Validate(Room room, Rack rack)
    {
        ArgumentNullException.ThrowIfNull(room);
        ArgumentNullException.ThrowIfNull(rack);

        var bounds = rack.GetBounds();

        if (!bounds.IsInside(room.Bounds))
            return "Kệ nằm ngoài sàn.";

        foreach (var obstacle in room.Obstacles)
        {
            if (bounds.Overlaps(obstacle.Bounds))
            {
                var what = obstacle.Kind == ObstacleKind.Wall ? "tường" : "cột";
                return $"Kệ đè {what} tại ({Meters(obstacle.X)}; {Meters(obstacle.Y)}) m.";
            }
        }

        var others = room.Racks
            .Where(r => !string.Equals(r.Code, rack.Code, StringComparison.OrdinalIgnoreCase))
            .Select(r => (Rack: r, Bounds: r.GetBounds()))
            .ToList();

        foreach (var other in others)
        {
            if (bounds.Overlaps(other.Bounds))
                return $"Kệ đè lên {other.Rack.Code}.";
        }

        foreach (var other in others)
        {
            var (dx, dy) = bounds.GapTo(other.Bounds);
            if (Tolerance.LessThan(dx, room.MinGap) && Tolerance.LessThan(dy, room.MinGap))
                return $"Thiếu lối đi với {other.Rack.Code}.";
        }

        return null;
    }

    private static string Meters(double value) => value.ToString("0.##", CultureInfo.InvariantCulture);
}
