namespace Warehouse.Api.Rules;

using Warehouse.Api.Models;

public sealed record SlotCandidate(Rack Rack, Slot Slot);
public sealed record SlotSearchResult(
    IReadOnlyList<SlotCandidate> FreeSlots,
    int FittingCount,
    IReadOnlyList<string> RejectionReasons)
{
    public bool HasAnyFittingSlot
    {
        get { return FittingCount > 0; }
    }
}
public static class SlotFinder
{
    public static SlotSearchResult Find(IEnumerable<SlotCandidate> candidates, Pallet pallet, double margin)
    {
        ArgumentNullException.ThrowIfNull(candidates);
        ArgumentNullException.ThrowIfNull(pallet);

        var free = new List<SlotCandidate>();
        var reasons = new List<string>();
        int fitting = 0;

        foreach (var candidate in candidates)
        {
            string? reason = candidate.Slot.CanHold(candidate.Rack, pallet, margin);

            if (reason is null)
            {
                fitting++;
                if (candidate.Slot.IsEmpty)
                    free.Add(candidate);
            }
            else if (!reasons.Contains(reason))
            {
                reasons.Add(reason);
            }
        }

        return new SlotSearchResult(free, fitting, reasons);
    }
}
