using Microsoft.EntityFrameworkCore;
using Warehouse.Api.Data;
using Warehouse.Api.Infrastructure;
using Warehouse.Api.Infrastructure.Security;
using Warehouse.Api.Services;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ApiExceptionHandler>();
builder.Services.AddOpenApi();

// Cấu hình bảo mật: Options & Rate Limiting (chống DoS)
builder.Services.Configure<WarehouseSecurityOptions>(
    builder.Configuration.GetSection(WarehouseSecurityOptions.SectionName));
builder.Services.AddWarehouseRateLimiting();

var connectionString = builder.Configuration.GetConnectionString("Warehouse");
if (!string.IsNullOrEmpty(connectionString))
{
    builder.Services.AddDbContext<WarehouseDbContext>(options =>
        options.UseNpgsql(connectionString));
    builder.Services.AddScoped<IWarehouseStore, EfWarehouseStore>();
}
else
{
    // Dự phòng In-Memory Store khi chưa cấu hình PostgreSQL hoặc trong môi trường test
    builder.Services.AddSingleton<IWarehouseStore, InMemoryWarehouseStore>();
}

builder.Services.AddScoped<ILayoutService, LayoutService>();
builder.Services.AddScoped<IPalletService, PalletService>();
var app = builder.Build();

app.UseExceptionHandler();

// Middleware Bảo mật: Security Headers & Rate Limiter
app.UseMiddleware<SecurityHeadersMiddleware>();
app.UseRateLimiter();

// Middleware Xác thực, Phân quyền RBAC & Ghi vết Audit Log
app.UseMiddleware<ApiKeyAuthMiddleware>();

if (app.Configuration.GetValue<bool>("Seed:SampleLayout"))
{
    using (var scope = app.Services.CreateScope())
    {
        SampleLayoutSeeder.Seed(
            scope.ServiceProvider.GetRequiredService<ILayoutService>(),
            scope.ServiceProvider.GetRequiredService<ILogger<Program>>(),
            Path.Combine(app.Environment.ContentRootPath, "SampleData", "sample-layout.json"),
            scope.ServiceProvider.GetRequiredService<IPalletService>(),
            Path.Combine(app.Environment.ContentRootPath, "SampleData", "sample-batches.json"));
    }
}
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.UseSwaggerUI(options => options.SwaggerEndpoint("/openapi/v1.json", "WarehouseTwin API"));
}

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapControllers();
app.MapFallbackToFile("index.html");
app.Run();

public partial class Program { }
