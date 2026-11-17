namespace Warehouse.Api.Models;

public class Pallet
{
    public int Id { get; private set; }
    public int BatchId { get; private set; }
    public int SizeId { get; private set; }
    public PalletSize Size { get; private set; }
    public string Code { get; private set; }
    public int? ProductTypeId { get; private set; }

    private Pallet(int batchId, int sizeId, string code, int? productTypeId)
    {
        BatchId = batchId;
        SizeId = sizeId;
        Code = code;
        ProductTypeId = productTypeId;
        Size = null!;
    }

    public Pallet(int batchId, PalletSize size, string code, int? productTypeId = null)
    {
        ArgumentNullException.ThrowIfNull(size);
        if (string.IsNullOrWhiteSpace(code))
            throw new ArgumentException("Mã pallet không được rỗng.", nameof(code));

        BatchId = batchId;
        Size = size;
        SizeId = size.Id;
        Code = code.Trim();
        ProductTypeId = productTypeId;
    }
}
