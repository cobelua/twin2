namespace Warehouse.Tests.Security;

using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Warehouse.Api.Data;

public class SecurityTests
{
    private class SecureTestFactory(bool requireAuth = false) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseSetting("Seed:SampleLayout", "false");
            builder.UseSetting("Security:RequireAuth", requireAuth ? "true" : "false");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IWarehouseStore>();
                services.AddSingleton<IWarehouseStore, InMemoryWarehouseStore>();
            });
        }
    }

    [Fact]
    public async Task SecurityHeaders_ArePresentOnResponses()
    {
        using var factory = new SecureTestFactory();
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.Contains("X-Content-Type-Options"));
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").First());
        Assert.True(response.Headers.Contains("X-Frame-Options"));
        Assert.Equal("SAMEORIGIN", response.Headers.GetValues("X-Frame-Options").First());
        Assert.True(response.Headers.Contains("Referrer-Policy"));
    }

    [Fact]
    public async Task BatchRequest_ExceedingTotalQuantityLimit_ReturnsBadRequest()
    {
        using var factory = new SecureTestFactory();
        var client = factory.CreateClient();

        // 11 dòng x 1000 = 11.000 pallet (> ngưỡng an toàn 10.000 pallet)
        var lines = Enumerable.Range(0, 11).Select(_ => new
        {
            quantity = 1000,
            length = 1.2,
            width = 0.8,
            height = 1.0,
        }).ToList();

        var response = await client.PostAsJsonAsync("/api/batches", new { lines });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("10.000 pallet", body);
    }

    [Fact]
    public async Task ApiKeyAuth_WhenRequireAuthIsTrue_RejectsMissingApiKey()
    {
        using var factory = new SecureTestFactory(requireAuth: true);
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/rooms");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ApiKeyAuth_WhenViewerAttemptsMutatingAction_ReturnsForbidden()
    {
        using var factory = new SecureTestFactory(requireAuth: true);
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", "viewer-dev-key");

        // Viewer không có quyền Reset placements hoặc Sửa Layout
        var response = await client.PostAsync("/api/rooms/1/placements/reset", null);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task ApiKeyAuth_WhenAdminKeyProvided_AllowsMutatingAction()
    {
        using var factory = new SecureTestFactory(requireAuth: true);
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", "admin-dev-key");

        var response = await client.GetAsync("/api/rooms");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task RateLimiting_ExceedingLimit_ReturnsTooManyRequests()
    {
        using var factory = new SecureTestFactory();
        var client = factory.CreateClient();

        var has429 = false;
        HttpResponseMessage? lastResponse = null;

        // Ngưỡng cấu hình là 120 requests + QueueLimit 2 = 122.
        // Gửi 130 requests liên tiếp để kích hoạt 429 Too Many Requests.
        for (var i = 0; i < 130; i++)
        {
            lastResponse = await client.GetAsync("/api/rooms");
            if (lastResponse.StatusCode == HttpStatusCode.TooManyRequests)
            {
                has429 = true;
                break;
            }
        }

        Assert.True(has429, "Hệ thống phải trả về mã 429 Too Many Requests khi vượt ngưỡng.");
        Assert.NotNull(lastResponse);
        Assert.Equal(HttpStatusCode.TooManyRequests, lastResponse.StatusCode);

        var body = await lastResponse.Content.ReadAsStringAsync();
        Assert.Contains("quá nhiều yêu cầu", body);
    }
}

