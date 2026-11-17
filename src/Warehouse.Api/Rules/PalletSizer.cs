namespace Warehouse.Api.Rules;

using Warehouse.Api.Models;

public sealed record SizeResolution(PalletSize Size, bool IsNew);

public static class PalletSizer
{
    private static readonly string[] Palette =
    {
        "#1D9E75", "#7F77DD", "#D85A30", "#D4537E", "#378ADD",
        "#639922", "#BA7517", "#E24B4A", "#534AB7", "#0F6E56",
    };

    public static SizeResolution Resolve(
        IReadOnlyList<PalletSize> existing, double length, double width, double height, double? weight)
    {
        ArgumentNullException.ThrowIfNull(existing);

        if (length <= 0)
            throw new ArgumentException("Chiều dài phải lớn hơn 0.", nameof(length));
        if (width <= 0)
            throw new ArgumentException("Chiều rộng phải lớn hơn 0.", nameof(width));
        if (height <= 0)
            throw new ArgumentException("Chiều cao phải lớn hơn 0.", nameof(height));
        if (weight is <= 0)
            throw new ArgumentException("Khối lượng phải lớn hơn 0 (hoặc để trống).", nameof(weight));

        double longSide = Math.Max(length, width);
        double shortSide = Math.Min(length, width);

        foreach (var size in existing)
        {
            if (Matches(size, longSide, shortSide, height, weight))
                return new SizeResolution(size, IsNew: false);
        }

        var created = new PalletSize(
            NextCode(existing), longSide, shortSide, height, Palette[existing.Count % Palette.Length], weight);

        return new SizeResolution(created, IsNew: true);
    }

    private static bool Matches(PalletSize size, double longSide, double shortSide, double height, double? weight)
    {
        return Tolerance.AreEqual(Math.Max(size.Length, size.Width), longSide)
            && Tolerance.AreEqual(Math.Min(size.Length, size.Width), shortSide)
            && Tolerance.AreEqual(size.Height, height)
            && SameWeight(size.Weight, weight);
    }

    private static bool SameWeight(double? a, double? b)
    {
        if (a is null || b is null)
            return a is null && b is null;

        return Tolerance.AreEqual(a.Value, b.Value);
    }

    private static string NextCode(IReadOnlyList<PalletSize> existing)
    {
        var used = existing.Select(s => s.Code).ToHashSet(StringComparer.OrdinalIgnoreCase);

        for (int index = existing.Count; ; index++)
        {
            string code = CodeAt(index);
            if (!used.Contains(code))
                return code;
        }
    }

    private static string CodeAt(int index)
    {
        var letters = new Stack<char>();
        int n = index + 1;

        while (n > 0)
        {
            n--;
            letters.Push((char)('A' + n % 26));
            n /= 26;
        }

        return new string(letters.ToArray());
    }
}
