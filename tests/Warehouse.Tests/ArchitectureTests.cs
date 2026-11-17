namespace Warehouse.Tests;

// Luật phụ thuộc giữa các tầng (CLAUDE.md mục 2) kiểm tra bằng cách đọc mã nguồn: tìm các namespace bị cấm trong từng
// thư mục. Đọc mã nguồn (không đọc assembly) vì như vậy bắt được cả chỗ dùng bên trong thân hàm, không chỉ trong chữ ký.
//   Controllers → Services → Rules → Models;  Data hiện thực IWarehouseStore cho Services.
public class ArchitectureTests
{
    private const string Ef = "Microsoft.EntityFrameworkCore";
    private const string AspNet = "Microsoft.AspNetCore";
    private const string Annotations = "System.ComponentModel.DataAnnotations";

    private static string ApiDirectory()
    {
        // Đi ngược từ thư mục chạy test tới gốc repo (nơi có src/Warehouse.Api).
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "src", "Warehouse.Api");
            if (Directory.Exists(candidate))
                return candidate;
        }
        throw new DirectoryNotFoundException("Không tìm thấy src/Warehouse.Api từ " + AppContext.BaseDirectory);
    }

    // Mọi chỗ trong thư mục `folder` nhắc tới một trong các namespace cấm (using hoặc viết đầy đủ tên).
    private static List<string> Violations(string folder, params string[] forbidden)
    {
        var found = new List<string>();
        var root = Path.Combine(ApiDirectory(), folder);
        foreach (var file in Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories))
        {
            var text = File.ReadAllText(file);
            foreach (var ns in forbidden.Where(text.Contains))
                found.Add($"{folder}/{Path.GetRelativePath(root, file)} dùng {ns}");
        }
        return found;
    }

    [Fact]
    public void Models_AreIndependentOfFrameworksAndOtherLayers()
    {
        // Models chỉ là dữ liệu + luật của chính nó: không EF, không ASP.NET, không attribute kiểm tra đầu vào,
        // không biết tầng nào khác.
        var violations = Violations("Models", Ef, AspNet, Annotations,
            "Warehouse.Api.Rules", "Warehouse.Api.Services", "Warehouse.Api.Data",
            "Warehouse.Api.Controllers", "Warehouse.Api.ViewModels");

        Assert.Empty(violations);
    }

    [Fact]
    public void Rules_AreIndependentOfFrameworksStoresAndHigherLayers()
    {
        // Rules là hàm thuần trên Models: không đọc store, không biết service/controller.
        var violations = Violations("Rules", Ef, AspNet, Annotations,
            "Warehouse.Api.Services", "Warehouse.Api.Data", "Warehouse.Api.Controllers", "Warehouse.Api.ViewModels");

        Assert.Empty(violations);
    }

    [Fact]
    public void Services_DoNotUseEfAspNetOrControllers()
    {
        // Services chỉ biết IWarehouseStore (interface), không biết dữ liệu nằm ở đâu và không biết HTTP.
        var violations = Violations("Services", Ef, AspNet, "Warehouse.Api.Controllers");

        Assert.Empty(violations);
    }

    [Fact]
    public void Controllers_OnlyCallServices()
    {
        // Controller mỏng: nhận ViewModel, gọi service. Không đọc store, không dùng EF, không tự gọi luật.
        var violations = Violations("Controllers", Ef, "Warehouse.Api.Data", "Warehouse.Api.Rules", "Warehouse.Api.Models");

        Assert.Empty(violations);
    }

    [Fact]
    public void Data_ContainsNoBusinessRules()
    {
        // Data chỉ đọc/ghi: không gọi luật nghiệp vụ, không biết service hay controller.
        var violations = Violations("Data", "Warehouse.Api.Rules", "Warehouse.Api.Services", "Warehouse.Api.Controllers");

        Assert.Empty(violations);
    }
}
