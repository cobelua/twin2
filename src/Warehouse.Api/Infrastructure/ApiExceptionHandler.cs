namespace Warehouse.Api.Infrastructure;

using Microsoft.AspNetCore.Diagnostics;
using Npgsql;

public class ApiExceptionHandler(ILogger<ApiExceptionHandler> logger, IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var (status, detail) = Classify(exception);
        logger.LogError(exception, "Lỗi không xử lý được ({Status}) tại {Path}", status, httpContext.Request.Path);

        httpContext.Response.StatusCode = status;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails = { Status = status, Detail = detail },
        });
    }

    public static (int Status, string Detail) Classify(Exception exception)
    {
        for (var e = exception; e is not null; e = e.InnerException)
        {
            if (e is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
                return (StatusCodes.Status409Conflict,
                    "Dữ liệu bị trùng (ví dụ mã kệ, mã lô): có người vừa lưu cùng lúc. Hãy tải lại rồi thử lại.");

            if (e is NpgsqlException { IsTransient: true })
                return (StatusCodes.Status503ServiceUnavailable, "Không kết nối được cơ sở dữ liệu, thử lại sau.");
        }

        return (StatusCodes.Status500InternalServerError, "Có lỗi không mong đợi trên máy chủ.");
    }
}
