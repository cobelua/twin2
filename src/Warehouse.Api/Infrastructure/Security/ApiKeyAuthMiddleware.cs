namespace Warehouse.Api.Infrastructure.Security;

using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

public class ApiKeyAuthMiddleware(
    RequestDelegate next,
    IOptions<WarehouseSecurityOptions> options,
    ILogger<ApiKeyAuthMiddleware> logger)
{
    private readonly WarehouseSecurityOptions _security = options.Value;

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";
        var method = context.Request.Method;

        // Bỏ qua xác thực cho các route công khai (Health check, OpenAPI, Swagger, Static files)
        if (!path.StartsWith("/api", StringComparison.OrdinalIgnoreCase) ||
            path.Equals("/api/health", StringComparison.OrdinalIgnoreCase))
        {
            await next(context);
            return;
        }

        // Lấy API Key từ Header 'X-Api-Key' hoặc 'Authorization: Bearer <key>'
        var apiKey = ExtractApiKey(context);
        string? role = null;

        if (!string.IsNullOrEmpty(apiKey) && _security.ApiKeys.TryGetValue(apiKey, out var mappedRole))
        {
            role = mappedRole;
        }
        else if (string.IsNullOrEmpty(apiKey) && !_security.RequireAuth)
        {
            // Trong chế độ phát triển/demo (RequireAuth = false), gán vai trò Admin mặc định
            role = "Admin";
        }

        if (role == null)
        {
            logger.LogWarning("[SECURITY] Truy cập không hợp lệ từ IP {Ip} vào {Method} {Path}: Thiếu hoặc sai API Key.",
                context.Connection.RemoteIpAddress, method, path);

            await AppendLogFileAsync("SECURITY", "Anonymous", context.Connection.RemoteIpAddress?.ToString(), method, path, 401, "Thiếu hoặc sai API Key");

            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(new
            {
                status = 401,
                title = "Unauthorized",
                detail = "Yêu cầu cung cấp API Key hợp lệ qua header 'X-Api-Key' hoặc 'Authorization: Bearer <key>'."
            });
            return;
        }

        // Kiểm tra phân quyền dựa trên vai trò (Role-Based Access Control)
        if (!IsAuthorized(method, path, role))
        {
            logger.LogWarning("[SECURITY] Từ chối truy cập (403): Vai trò '{Role}' không có quyền thực hiện {Method} {Path} từ IP {Ip}.",
                role, method, path, context.Connection.RemoteIpAddress);

            await AppendLogFileAsync("SECURITY", role, context.Connection.RemoteIpAddress?.ToString(), method, path, 403, "Quyền hạn không đủ");

            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(new
            {
                status = 403,
                title = "Forbidden",
                detail = $"Vai trò '{role}' không đủ quyền hạn để thực hiện thao tác {method} {path}."
            });
            return;
        }

        // Thiết lập User Claims Principal để downstream có thể sử dụng nếu cần
        var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.Role, role),
            new Claim("ApiKey", apiKey ?? "dev-default")
        ], "ApiKey");
        context.User = new ClaimsPrincipal(identity);

        // Ghi nhận mọi hoạt động API vào file app.log (kể cả xem kho GET lẫn sửa kho POST/PUT)
        var actionDesc = HttpMethods.IsGet(method) ? "Xem thong tin kho" : "Thao tac thay doi du lieu kho";
        logger.LogInformation("[AUDIT] UserRole={Role} IP={Ip} Action={Method} Path={Path}",
            role, context.Connection.RemoteIpAddress, method, path);

        await AppendLogFileAsync("AUDIT", role, context.Connection.RemoteIpAddress?.ToString(), method, path, 200, actionDesc);

        await next(context);
    }

    private async Task AppendLogFileAsync(string tag, string role, string? ip, string method, string path, int status, string message)
    {
        try
        {
            var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} [{tag}] app=WarehouseTwin role={role} client_ip={ip ?? "127.0.0.1"} action=\"{method} {path}\" status={status} message=\"{message}\"{Environment.NewLine}";

            // 1. File app.log: Ghi TẤT CẢ các hoạt động để xem nội bộ trên máy
            await WriteToFileAsync(_security.AppLogPath, line);

            // 2. File security-alerts.log: CHỈ GHI KHI CÓ CẢNH BÁO BẢO MẬT (401, 403, lỗi bảo mật) để Wazuh đọc
            if (string.Equals(tag, "SECURITY", StringComparison.OrdinalIgnoreCase) || status >= 400)
            {
                await WriteToFileAsync(_security.AlertLogPath, line);
            }
        }
        catch
        {
            // Không để lỗi ghi file làm ảnh hưởng tới luồng xử lý chính
        }
    }

    private static async Task WriteToFileAsync(string filePath, string content)
    {
        try
        {
            var resolvedPath = filePath;
            if (!Path.IsPathRooted(resolvedPath))
            {
                resolvedPath = Path.Combine(AppContext.BaseDirectory, resolvedPath);
            }
            var dir = Path.GetDirectoryName(resolvedPath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }
            await File.AppendAllTextAsync(resolvedPath, content);
        }
        catch { }
    }

    private static string? ExtractApiKey(HttpContext context)
    {
        if (context.Request.Headers.TryGetValue("X-Api-Key", out var headerVal) && !string.IsNullOrWhiteSpace(headerVal))
            return headerVal.ToString().Trim();

        if (context.Request.Headers.TryGetValue("Authorization", out var authVal))
        {
            var authStr = authVal.ToString().Trim();
            if (authStr.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
                return authStr["Bearer ".Length..].Trim();
        }

        return null;
    }

    private static bool IsAuthorized(string method, string path, string role)
    {
        // Admin có toàn quyền
        if (string.Equals(role, "Admin", StringComparison.OrdinalIgnoreCase))
            return true;

        // Các thao tác chỉ Admin mới được phép: tạo phòng, sửa layout kho, reset kho
        var isAdminOnly = (path.StartsWith("/api/rooms", StringComparison.OrdinalIgnoreCase) &&
                           (method.Equals("PUT", StringComparison.OrdinalIgnoreCase) ||
                            path.EndsWith("/placements/reset", StringComparison.OrdinalIgnoreCase) ||
                            (method.Equals("POST", StringComparison.OrdinalIgnoreCase) && path.Equals("/api/rooms", StringComparison.OrdinalIgnoreCase))));

        if (isAdminOnly)
            return false;

        // Operator: được phép nhập lô, tính toán xếp pallet, kiểm tra lô, xem phòng và khung
        if (string.Equals(role, "Operator", StringComparison.OrdinalIgnoreCase))
            return true;

        // Viewer: chỉ được xem (GET) và kiểm tra bản nháp (validate layout)
        if (string.Equals(role, "Viewer", StringComparison.OrdinalIgnoreCase))
        {
            if (HttpMethods.IsGet(method))
                return true;

            // Validate layout là thao tác kiểm tra thử không ghi đĩa
            if (path.EndsWith("/layout/validate", StringComparison.OrdinalIgnoreCase))
                return true;

            return false;
        }

        return false;
    }
}
