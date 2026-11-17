using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Warehouse.Tests.Api;

// Test khói: API khởi động được và trả lời /api/health.
public class HealthApiTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Health_ReturnsOk()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
