namespace Warehouse.Api.ViewModels;

using System.ComponentModel.DataAnnotations;

public class BatchLineRequest
{
    [Range(1, 1000, ErrorMessage = "Số lượng phải từ 1 đến 1000 pallet.")] public int Quantity { get; set; }
    [Range(0.01, 10, ErrorMessage = "Chiều dài phải từ 0,01 đến 10 m.")] public double Length { get; set; }
    [Range(0.01, 10, ErrorMessage = "Chiều rộng phải từ 0,01 đến 10 m.")] public double Width { get; set; }
    [Range(0.01, 10, ErrorMessage = "Chiều cao phải từ 0,01 đến 10 m.")] public double Height { get; set; }
    [Range(0.1, 100000, ErrorMessage = "Khối lượng phải từ 0,1 đến 100000 kg (hoặc để trống).")] public double? Weight { get; set; }
    public int? ProductTypeId { get; set; }
}

public class BatchRequest : IValidatableObject
{
    [Required, MinLength(1, ErrorMessage = "Lô phải có ít nhất một dòng."), MaxLength(50, ErrorMessage = "Một lô tối đa 50 dòng.")]
    public List<BatchLineRequest> Lines { get; set; } = [];

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (Lines.Sum(l => (long)l.Quantity) > 10000)
        {
            yield return new ValidationResult(
                "Tổng số lượng pallet trong một lô không được vượt quá 10.000 pallet.",
                [nameof(Lines)]);
        }
    }
}

public class ProductTypeRequest
{
    [Required(ErrorMessage = "Mã loại hàng không được rỗng."), StringLength(20, ErrorMessage = "Mã loại hàng tối đa 20 ký tự.")] public string Code { get; set; } = "";
    [Required(ErrorMessage = "Tên loại hàng không được rỗng."), StringLength(50, ErrorMessage = "Tên loại hàng tối đa 50 ký tự.")] public string Name { get; set; } = "";
}

public record ProductTypeViewModel(int Id, string Code, string Name);

public record BatchLineCheckViewModel(
    int Quantity, string TypeCode, bool IsNewType, string Color, double Length, double Width, double Height,
    double? Weight, int? ProductTypeId);

public record RoomCheckViewModel(int RoomId, string RoomName, int Placeable, int Missing, IReadOnlyList<string> Notes);

public record BatchCheckViewModel(
    int Total, IReadOnlyList<BatchLineCheckViewModel> Lines, IReadOnlyList<RoomCheckViewModel> Rooms, DistributionViewModel Plan);

public record BatchReceivedViewModel(int BatchId, string Code, int PalletCount);

public record PlacementViewModel(
    string PalletCode, string TypeCode, string Color, string RackCode, string SlotCode, int Level, int Bay, bool IsTop);

public record RejectionViewModel(string PalletCode, string Reason);

public record AllocationViewModel(
    int BatchId, IReadOnlyList<PlacementViewModel> Placements, IReadOnlyList<RejectionViewModel> Rejected, int AlreadyPlaced);

public record RoomShareViewModel(int RoomId, string RoomName, int Count, IReadOnlyList<PlacementViewModel> Placements);

public record DistributionViewModel(
    int? BatchId, int Total, int Placed, IReadOnlyList<RoomShareViewModel> Rooms, IReadOnlyList<RejectionViewModel> Rejected);

public record SlotViewModel(
    int Id, int RackId, string RackCode, string Code, int Level, int Bay, bool IsTop,
    int? PalletId, string? PalletCode, string? TypeCode, string? Color,
    double? PalletAlongBay = null, double? PalletAcrossDepth = null, double? PalletHeight = null);

public record ResetViewModel(int Cleared);
