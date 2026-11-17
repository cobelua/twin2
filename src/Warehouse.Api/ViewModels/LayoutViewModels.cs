namespace Warehouse.Api.ViewModels;

using System.ComponentModel.DataAnnotations;
using Warehouse.Api.Models;

public class RoomRequest
{
    [Required, StringLength(50)] public string Name { get; set; } = "";
    [Range(0.5, 500)] public double Width { get; set; }
    [Range(0.5, 500)] public double Depth { get; set; }
    [Range(0.05, 10)] public double GridSize { get; set; } = 0.5;
    [Range(0, 20)] public double MinGap { get; set; }
    [Range(0, 2)] public double Margin { get; set; }
}

public class RackRequest
{
    [Required, StringLength(20)] public string Code { get; set; } = "";
    [Range(0, 500)] public double X { get; set; }
    [Range(0, 500)] public double Y { get; set; }
    [AllowedValues(0, 90)] public int Rotation { get; set; }
    [Range(1, 20)] public int Levels { get; set; }
    [Range(0.1, 10)] public double LevelHeight { get; set; }
    [Range(1, 50)] public int Bays { get; set; }
    [Range(0.1, 10)] public double BayWidth { get; set; }
    [Range(0.1, 10)] public double Depth { get; set; }
    public bool HasTop { get; set; }
    [Range(1, 100000)] public double MaxWeight { get; set; }
    public int? ProductTypeId { get; set; }
}

public class ObstacleRequest
{
    [Required, AllowedValues("Wall", "Column")] public string Kind { get; set; } = "";
    [Range(0, 500)] public double X { get; set; }
    [Range(0, 500)] public double Y { get; set; }
    [Range(0.01, 500)] public double Width { get; set; }
    [Range(0.01, 500)] public double Depth { get; set; }
}

public class LayoutRackRequest : RackRequest
{
    public int? Id { get; set; }
}

public class LayoutObstacleRequest : ObstacleRequest
{
    public int? Id { get; set; }
}

public class LayoutRequest : RoomRequest
{
    public int Version { get; set; }
    [Required, MaxLength(500, ErrorMessage = "Tối đa 500 vật cản trên một mặt bằng.")]
    public List<LayoutObstacleRequest> Obstacles { get; set; } = [];
    [Required, MaxLength(500, ErrorMessage = "Tối đa 500 kệ hàng trên một mặt bằng.")]
    public List<LayoutRackRequest> Racks { get; set; } = [];
}

public record RackCheckViewModel(string Code, bool IsValid, string? Reason, double FootprintWidth, double FootprintDepth);

public record LayoutCheckViewModel(bool IsValid, string? Reason, IReadOnlyList<RackCheckViewModel> Racks);

public record LayoutRackId(int Id, string Code);

public record LayoutSavedViewModel(int Version, IReadOnlyList<LayoutRackId> Racks, IReadOnlyList<int> ObstacleIds);

public record RoomCreatedViewModel(int Id);

public record RackViewModel(
    int Id, string Code, double X, double Y, int Rotation,
    int Levels, double LevelHeight, int Bays, double BayWidth, double Depth,
    bool HasTop, double MaxWeight, int? ProductTypeId,
    double FootprintWidth, double FootprintDepth, int SlotCount)
{
    public static RackViewModel From(Rack rack, int slotCount)
    {
        var b = rack.GetBounds();
        return new RackViewModel(
            rack.Id, rack.Code, rack.X, rack.Y, rack.Rotation,
            rack.Levels, rack.LevelHeight, rack.Bays, rack.BayWidth, rack.Depth,
            rack.HasTop, rack.MaxWeight, rack.ProductTypeId,
            b.Width, b.Depth, slotCount);
    }
}

public record ObstacleViewModel(int Id, string Kind, double X, double Y, double Width, double Depth)
{
    public static ObstacleViewModel From(Obstacle o)
        => new(o.Id, o.Kind.ToString(), o.X, o.Y, o.Width, o.Depth);
}

public record RoomSummaryViewModel(
    int Id, string Name, double Width, double Depth, double GridSize, int RackCount, int ObstacleCount, int SlotCount);

public record RoomViewModel(
    int Id, string Name, double Width, double Depth, double GridSize, double MinGap, double Margin, int Version,
    IReadOnlyList<RackViewModel> Racks, IReadOnlyList<ObstacleViewModel> Obstacles);
