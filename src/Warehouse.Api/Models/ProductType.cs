namespace Warehouse.Api.Models;

public class ProductType
{
    public int Id { get; private set; }
    public string Code { get; private set; }
    public string Name { get; private set; }

    public ProductType(string code, string name)
    {
        if (string.IsNullOrWhiteSpace(code))
            throw new ArgumentException("Mã loại hàng không được rỗng.", nameof(code));
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Tên loại hàng không được rỗng.", nameof(name));

        Code = code.Trim();
        Name = name.Trim();
    }
}
