namespace Warehouse.Api.Models;
public class PalletSize
{
    public int Id { get; private set; }
    public string Code { get; private set; }
    public double Length { get; private set; }
    public double Width { get; private set; }
    public double Height { get; private set; }
    public double? Weight { get; private set; }
    public string Color { get; private set; }

    public PalletSize(string code, double length, double width, double height, string color, double? weight = null)
    {
        if (string.IsNullOrWhiteSpace(code))
            throw new ArgumentException("Mã cỡ không được rỗng.", nameof(code));
        if (length <= 0)
            throw new ArgumentException("Chiều dài phải lớn hơn 0.", nameof(length));
        if (width <= 0)
            throw new ArgumentException("Chiều rộng phải lớn hơn 0.", nameof(width));
        if (height <= 0)
            throw new ArgumentException("Chiều cao phải lớn hơn 0.", nameof(height));
        if (string.IsNullOrWhiteSpace(color))
            throw new ArgumentException("Màu không được rỗng.", nameof(color));
        if (weight is <= 0)
            throw new ArgumentException("Khối lượng phải lớn hơn 0 (hoặc để trống).", nameof(weight));

        Code = code.Trim();
        Length = length;
        Width = width;
        Height = height;
        Color = color.Trim();
        Weight = weight;
    }
}
