namespace Warehouse.Api.Infrastructure.Security;

public class SecurityHeadersMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        // Chống MIME-sniffing
        context.Response.Headers.Append("X-Content-Type-Options", "nosniff");

        // Chống Clickjacking
        context.Response.Headers.Append("X-Frame-Options", "SAMEORIGIN");

        // Giảm rò rỉ URL khi chuyển hướng trang ngoài
        context.Response.Headers.Append("Referrer-Policy", "strict-origin-when-cross-origin");

        // Tắt bộ lọc XSS cũ không an toàn của trình duyệt (theo chuẩn OWASP)
        context.Response.Headers.Append("X-XSS-Protection", "0");

        // Content-Security-Policy cơ bản cho Single Page App & 3D Three.js
        context.Response.Headers.Append(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self';");

        await next(context);
    }
}
