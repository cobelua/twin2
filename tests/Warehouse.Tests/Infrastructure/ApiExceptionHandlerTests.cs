using System.Net.Sockets;
using Npgsql;
using Warehouse.Api.Infrastructure;

namespace Warehouse.Tests.Infrastructure;

public class ApiExceptionHandlerTests
{
    [Fact]
    public void Classify_UniqueViolationInsideWrappers_Is409()
    {
        // EF bọc lỗi Postgres trong DbUpdateException, nên phải đi dọc InnerException.
        var postgres = new PostgresException("duplicate key", "ERROR", "ERROR", PostgresErrorCodes.UniqueViolation);
        var wrapped = new InvalidOperationException("save failed", new InvalidOperationException("inner", postgres));

        var (status, detail) = ApiExceptionHandler.Classify(wrapped);

        Assert.Equal(409, status);
        Assert.Contains("trùng", detail);
    }

    [Fact]
    public void Classify_TransientDatabaseError_Is503()
    {
        var transient = new NpgsqlException("connection lost", new SocketException());

        Assert.Equal(503, ApiExceptionHandler.Classify(new InvalidOperationException("x", transient)).Status);
    }

    [Fact]
    public void Classify_OtherErrors_Are500AndNeverLeakTheMessage()
    {
        var (status, detail) = ApiExceptionHandler.Classify(new InvalidOperationException("Host=db;Password=secret"));

        Assert.Equal(500, status);
        Assert.DoesNotContain("secret", detail);
    }

    [Fact]
    public void Classify_OtherPostgresError_Is500()
    {
        var other = new PostgresException("syntax", "ERROR", "ERROR", PostgresErrorCodes.SyntaxError);

        Assert.Equal(500, ApiExceptionHandler.Classify(other).Status);
    }
}
