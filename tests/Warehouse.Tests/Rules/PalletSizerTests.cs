using Warehouse.Api.Models;
using Warehouse.Api.Rules;

namespace Warehouse.Tests.Rules;

public class PalletSizerTests
{
    private static readonly List<PalletSize> None = new();

    [Fact]
    public void Resolve_NoExistingTypes_CreatesTypeA()
    {
        var result = PalletSizer.Resolve(None, 1.2, 1.0, 1.1, 500);

        Assert.True(result.IsNew);
        Assert.Equal("A", result.Size.Code);
        Assert.Equal(1.2, result.Size.Length);
        Assert.Equal(1.0, result.Size.Width);
        Assert.Equal(1.1, result.Size.Height);
        Assert.Equal(500, result.Size.Weight);
    }

    [Fact]
    public void Resolve_NewType_StoresLongerSideAsLength()
    {
        var result = PalletSizer.Resolve(None, 1.0, 1.2, 1.1, null);

        Assert.Equal(1.2, result.Size.Length);
        Assert.Equal(1.0, result.Size.Width);
    }

    [Fact]
    public void Resolve_SameDimensions_ReusesExistingType()
    {
        var a = PalletSizer.Resolve(None, 1.2, 1.0, 1.1, 500).Size;

        var again = PalletSizer.Resolve(new[] { a }, 1.2, 1.0, 1.1, 500);

        Assert.False(again.IsNew);
        Assert.Same(a, again.Size);
    }

    [Fact]
    public void Resolve_RotatedDimensions_ReusesExistingType()
    {
        var a = PalletSizer.Resolve(None, 1.2, 0.8, 1.0, null).Size;

        var rotated = PalletSizer.Resolve(new[] { a }, 0.8, 1.2, 1.0, null);

        Assert.False(rotated.IsNew);
        Assert.Same(a, rotated.Size);
    }

    [Fact]
    public void Resolve_ExistingTypeStoredUnnormalized_StillMatchesRotated()
    {
        // type được tạo ở nơi khác với Length < Width vẫn phải khớp pallet 1,2 × 0,8
        var existing = new PalletSize("A", 0.8, 1.2, 1.0, "#fff");

        var result = PalletSizer.Resolve(new[] { existing }, 1.2, 0.8, 1.0, null);

        Assert.False(result.IsNew);
        Assert.Same(existing, result.Size);
    }

    [Fact]
    public void Resolve_DifferentHeight_CreatesNewType()
    {
        var a = PalletSizer.Resolve(None, 1.2, 1.0, 1.1, null).Size;

        var other = PalletSizer.Resolve(new[] { a }, 1.2, 1.0, 1.5, null);

        Assert.True(other.IsNew);
        Assert.Equal("B", other.Size.Code);
    }

    [Fact]
    public void Resolve_SameDimensionsDifferentWeight_CreatesNewType()
    {
        var a = PalletSizer.Resolve(None, 1.2, 1.0, 1.1, 500).Size;

        var heavier = PalletSizer.Resolve(new[] { a }, 1.2, 1.0, 1.1, 800);

        Assert.True(heavier.IsNew);
        Assert.NotSame(a, heavier.Size);
    }

    [Fact]
    public void Resolve_NullWeightIsNotTheSameAsKnownWeight()
    {
        var withWeight = PalletSizer.Resolve(None, 1.2, 1.0, 1.1, 500).Size;

        var withoutWeight = PalletSizer.Resolve(new[] { withWeight }, 1.2, 1.0, 1.1, null);

        Assert.True(withoutWeight.IsNew);
    }

    [Fact]
    public void Resolve_BothWeightsNull_ReusesType()
    {
        var a = PalletSizer.Resolve(None, 1.2, 1.0, 1.1, null).Size;

        var again = PalletSizer.Resolve(new[] { a }, 1.2, 1.0, 1.1, null);

        Assert.False(again.IsNew);
    }

    [Fact]
    public void Resolve_TinyDifference_IsTreatedAsSame()
    {
        var a = PalletSizer.Resolve(None, 1.2, 1.0, 1.1, null).Size;

        var again = PalletSizer.Resolve(new[] { a }, 1.2 + 1e-12, 1.0, 1.1, null);

        Assert.False(again.IsNew);
    }

    [Fact]
    public void Resolve_CodesFollowA_To_Z_Then_AA_AB()
    {
        var types = new List<PalletSize>();
        for (int i = 1; i <= 28; i++)
        {
            // mỗi pallet cao hơn pallet trước nên luôn là type mới
            types.Add(PalletSizer.Resolve(types, 1.2, 1.0, i * 0.1, null).Size);
        }

        Assert.Equal("A", types[0].Code);
        Assert.Equal("B", types[1].Code);
        Assert.Equal("Z", types[25].Code);
        Assert.Equal("AA", types[26].Code);
        Assert.Equal("AB", types[27].Code);
        Assert.Equal(28, types.Select(t => t.Code).Distinct().Count());
    }

    [Fact]
    public void Resolve_NewCodeSkipsCodesAlreadyInUse()
    {
        // danh sách có 1 type nhưng mã là "B": mã theo số lượng sẽ là "B", phải bỏ qua thành "C"
        var existing = new[] { new PalletSize("B", 1.2, 1.0, 1.1, "#fff") };

        var result = PalletSizer.Resolve(existing, 1.2, 1.0, 1.5, null);

        Assert.Equal("C", result.Size.Code);
    }

    [Fact]
    public void Resolve_ConsecutiveNewTypes_GetDifferentColors()
    {
        var a = PalletSizer.Resolve(None, 1.2, 1.0, 1.1, null).Size;
        var b = PalletSizer.Resolve(new[] { a }, 1.2, 1.0, 1.5, null).Size;

        Assert.NotEqual(a.Color, b.Color);
    }

    [Fact]
    public void Resolve_DoesNotAddNewTypeToTheList()
    {
        var list = new List<PalletSize>();

        PalletSizer.Resolve(list, 1.2, 1.0, 1.1, null);

        Assert.Empty(list);
    }

    [Theory]
    [InlineData(0, 1.0, 1.1, null, "length")]
    [InlineData(1.2, -1, 1.1, null, "width")]
    [InlineData(1.2, 1.0, 0, null, "height")]
    [InlineData(1.2, 1.0, 1.1, 0.0, "weight")]
    public void Resolve_InvalidDimensions_Throws(double length, double width, double height, double? weight, string badParam)
    {
        var ex = Assert.Throws<ArgumentException>(() => PalletSizer.Resolve(None, length, width, height, weight));

        Assert.Equal(badParam, ex.ParamName);
    }

    [Fact]
    public void Resolve_NullList_Throws()
    {
        var ex = Assert.Throws<ArgumentNullException>(() => PalletSizer.Resolve(null!, 1.2, 1.0, 1.1, null));

        Assert.Equal("existing", ex.ParamName);
    }
}
