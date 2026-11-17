namespace Warehouse.Api.Infrastructure.Security;

public class WarehouseSecurityOptions
{
    public const string SectionName = "Security";

    /// <summary>
    /// Bật/tắt bắt buộc xác thực. Mặc định là false (phù hợp demo/local), đặt true trong môi trường Production.
    /// </summary>
    public bool RequireAuth { get; set; } = false;

    /// <summary>
    /// Danh sách API Key hợp lệ và vai trò tương ứng (Admin, Operator, Viewer).
    /// </summary>
    public Dictionary<string, string> ApiKeys { get; set; } = new(StringComparer.OrdinalIgnoreCase)
    {
        ["admin-dev-key"] = "Admin",
        ["operator-dev-key"] = "Operator",
        ["viewer-dev-key"] = "Viewer",
    };

    /// <summary>
    /// File 1: Lưu toàn bộ nhật ký ứng dụng (Audit, Info, Đọc/Ghi kho) để xem nội bộ.
    /// </summary>
    public string AppLogPath { get; set; } = @"C:\Users\thuyt\Downloads\digitalwin2-main\digitalwin2-main\src\Warehouse.Api\logs\app.log";

    /// <summary>
    /// File 2: CHỈ LƯU các sự kiện CẢNH BÁO BẢO MẬT (401, 403, 429, DoS) để đẩy về Wazuh SIEM.
    /// </summary>
    public string AlertLogPath { get; set; } = @"C:\Users\thuyt\Downloads\digitalwin2-main\digitalwin2-main\src\Warehouse.Api\logs\security-alerts.log";

    /// <summary>
    /// Đường dẫn tương thích ngược.
    /// </summary>
    public string AuditLogPath
    {
        get => AppLogPath;
        set => AppLogPath = value;
    }
}
