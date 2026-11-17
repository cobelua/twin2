namespace Warehouse.Api.Models;

public class Batch
{
    public int Id { get; private set; }
    public string Code { get; private set; }
    public DateTime ReceivedAt { get; private set; }
    public List<Pallet> Pallets { get; } = new();

    public Batch(string code, DateTime receivedAt)
    {
        if (string.IsNullOrWhiteSpace(code))
            throw new ArgumentException("Mã lô không được rỗng.", nameof(code));

        Code = code.Trim();
        ReceivedAt = receivedAt;
    }
}
