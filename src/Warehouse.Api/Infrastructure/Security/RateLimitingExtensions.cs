namespace Warehouse.Api.Infrastructure.Security;

using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;

public static class RateLimitingExtensions
{
    public static IServiceCollection AddWarehouseRateLimiting(this IServiceCollection services)
    {
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = async (context, token) =>
            {
                var clientIp = context.HttpContext.Connection.RemoteIpAddress?.ToString() ?? "localhost";
                var path = context.HttpContext.Request.Path.Value ?? "";
                var alertLine = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} [SECURITY] app=WarehouseTwin role=Anonymous client_ip={clientIp} action=\"DOS {path}\" status=429 message=\"Vượt ngưỡng Rate Limit (Nghi vấn tấn công DoS)\"{Environment.NewLine}";

                try
                {
                    var dir = Path.Combine(AppContext.BaseDirectory, "logs");
                    if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                    await File.AppendAllTextAsync(Path.Combine(dir, "security-alerts.log"), alertLine, token);
                    await File.AppendAllTextAsync(Path.Combine(dir, "app.log"), alertLine, token);
                }
                catch { }

                context.HttpContext.Response.ContentType = "application/problem+json";
                await context.HttpContext.Response.WriteAsJsonAsync(new
                {
                    status = 429,
                    title = "Too Many Requests",
                    detail = "Bạn đã gửi quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau giây lát."
                }, cancellationToken: token);
            };

            // Giới hạn tần suất chung dựa trên địa chỉ IP của Client
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(httpContext =>
            {
                var clientIp = httpContext.Connection.RemoteIpAddress?.ToString() ?? "localhost";

                return RateLimitPartition.GetSlidingWindowLimiter(
                    partitionKey: clientIp,
                    factory: _ => new SlidingWindowRateLimiterOptions
                    {
                        PermitLimit = 120, // Tối đa 120 requests / phút
                        Window = TimeSpan.FromMinutes(1),
                        SegmentsPerWindow = 6,
                        QueueLimit = 2
                    });
            });
        });

        return services;
    }
}
