namespace Warehouse.Api.Rules;

using Warehouse.Api.Models;

public sealed record Placement(Pallet Pallet, SlotCandidate Target)
{
    public bool IsTop => Target.Slot.IsTop;
}

public sealed record Rejection(Pallet Pallet, string Reason);

public sealed record AllocationResult(
    IReadOnlyList<Placement> Placements,
    IReadOnlyList<Rejection> Rejected)
{
    public IReadOnlyList<Placement> ToTop => Placements.Where(p => p.IsTop).ToList();
}

public static class Allocator
{
    public const string NoSlotsReason = "Kho chưa có khung nào.";
    public const string FullReason = "Hết khung trống phù hợp.";

    public const int MaxPermutedTypes = 6;

    private const long MaxWork = 20_000_000;

    private sealed record Group(
        string Code, IReadOnlyList<(Pallet Pallet, int Index)> Members, SlotSearchResult Search, double Volume, int FirstIndex);

    private sealed record Simulation(List<Placement> Placements, List<Rejection> Full, Score Score);

    private readonly record struct Mixing(int MixedLevels, int LevelPairs, int MixedTops, int TopPairs, int MixedRacks)
        : IComparable<Mixing>
    {
        public int CompareTo(Mixing other)
            => (MixedLevels, LevelPairs, MixedTops, TopPairs, MixedRacks)
                .CompareTo((other.MixedLevels, other.LevelPairs, other.MixedTops, other.TopPairs, other.MixedRacks));

        public static Mixing Of(IEnumerable<KeyValuePair<(Rack Rack, int Level), List<Slot>>> groups,
                                IReadOnlyDictionary<Slot, string> typeOfSlot)
        {
            var rows = groups
                .Select(kv => (kv.Key.Rack, IsTop: kv.Value[0].IsTop,
                               Types: kv.Value.Where(typeOfSlot.ContainsKey).Select(s => typeOfSlot[s]).ToHashSet()))
                .ToList();
            var levels = rows.Where(r => !r.IsTop).ToList();
            var tops = rows.Where(r => r.IsTop).ToList();
            return new Mixing(
                levels.Count(l => l.Types.Count > 1),
                levels.Sum(l => l.Types.Count),
                tops.Count(t => t.Types.Count > 1),
                tops.Sum(t => t.Types.Count),
                levels.GroupBy(l => l.Rack).Count(g => g.SelectMany(l => l.Types).Distinct().Count() > 1));
        }
    }

    private readonly record struct Score(int Unplaced, int OnTop, Mixing Mix) : IComparable<Score>
    {
        public int CompareTo(Score other)
        {
            var byCount = (Unplaced, OnTop).CompareTo((other.Unplaced, other.OnTop));
            return byCount != 0 ? byCount : Mix.CompareTo(other.Mix);
        }
    }

    public static AllocationResult Allocate(
        IReadOnlyList<Pallet> pallets, IReadOnlyList<SlotCandidate> candidates, double margin,
        IReadOnlyDictionary<Slot, string>? reserved = null)
    {
        ArgumentNullException.ThrowIfNull(pallets);
        ArgumentNullException.ThrowIfNull(candidates);

        var existingTypes = candidates
            .Select(c => reserved is not null && reserved.TryGetValue(c.Slot, out var t) ? t : c.Slot.AssignedSize)
            .OfType<string>()
            .ToHashSet();

        var groups = pallets
            .Select((pallet, index) => (Pallet: pallet, Index: index))
            .GroupBy(x => (x.Pallet.Size.Code, x.Pallet.ProductTypeId))
            .Select(g =>
            {
                var members = g.ToList();
                var search = SlotFinder.Find(candidates, members[0].Pallet, margin);
                return new Group(g.Key.Code, members, search, Volume(members[0].Pallet), members[0].Index);
            })
            .ToList();

        var rejected = groups
            .Where(g => !g.Search.HasAnyFittingSlot)
            .SelectMany(g => g.Members.Select(m => (m.Index, Rejection: new Rejection(m.Pallet,
                g.Search.RejectionReasons.Count == 0 ? NoSlotsReason : string.Join(" ", g.Search.RejectionReasons)))))
            .OrderBy(x => x.Index)
            .Select(x => x.Rejection)
            .ToList();

        var fitting = groups.Where(g => g.Search.HasAnyFittingSlot).ToList();

        Simulation? best = null;
        foreach (var order in OrdersToTry(fitting, existingTypes, pallets.Count, candidates.Count))
        {
            var run = Simulate(order, candidates, reserved);
            if (best is null || run.Score.CompareTo(best.Score) < 0)
                best = run;
        }

        if (best is null)
            return new AllocationResult([], rejected);

        var fits = new Dictionary<Pallet, HashSet<Slot>>();
        foreach (var group in fitting)
        {
            var slots = group.Search.FreeSlots.Select(c => c.Slot).ToHashSet();
            foreach (var (pallet, _) in group.Members)
                fits[pallet] = slots;
        }
        var (improved, full) = Improve(best.Placements, best.Full, candidates, reserved, fits);

        return new AllocationResult(improved, rejected.Concat(full).ToList());
    }

    private const int MaxImproveRounds = 10;

    private static (List<Placement> Plan, List<Rejection> Full) Improve(
        List<Placement> placements, List<Rejection> fullRejections, IReadOnlyList<SlotCandidate> candidates,
        IReadOnlyDictionary<Slot, string>? reserved, IReadOnlyDictionary<Pallet, HashSet<Slot>> fits)
    {
        var plan = placements.ToList();
        var full = fullRejections.ToList();
        if (plan.Count == 0
            || (long)plan.Count * (plan.Count + candidates.Count + full.Count) * candidates.Count > MaxWork)
            return (plan, full);

        var typeOfSlot = new Dictionary<Slot, string>();
        var rows = new Dictionary<(Rack, int), List<Slot>>();
        var slotOf = new Dictionary<Slot, SlotCandidate>();
        foreach (var c in candidates)
        {
            slotOf[c.Slot] = c;
            if (!rows.TryGetValue((c.Rack, c.Slot.Level), out var row))
                rows[(c.Rack, c.Slot.Level)] = row = new List<Slot>();
            row.Add(c.Slot);
            var held = reserved is not null && reserved.TryGetValue(c.Slot, out var r) ? r : c.Slot.AssignedSize;
            if (held is not null)
                typeOfSlot[c.Slot] = held;
        }
        foreach (var p in plan)
            typeOfSlot[p.Target.Slot] = p.Pallet.Size.Code;

        var score = Mixing.Of(rows, typeOfSlot);
        for (int round = 0; round < MaxImproveRounds; round++)
        {
            var changed = false;

            for (int i = 0; i < plan.Count; i++)
            {
                for (int j = i + 1; j < plan.Count; j++)
                {
                    var (a, b) = (plan[i], plan[j]);
                    var (typeA, typeB) = (a.Pallet.Size.Code, b.Pallet.Size.Code);
                    if (typeA == typeB
                        || !fits[a.Pallet].Contains(b.Target.Slot)
                        || !fits[b.Pallet].Contains(a.Target.Slot))
                        continue;

                    typeOfSlot[a.Target.Slot] = typeB;
                    typeOfSlot[b.Target.Slot] = typeA;
                    var trial = Mixing.Of(rows, typeOfSlot);
                    if (trial.CompareTo(score) < 0)
                    {
                        score = trial;
                        plan[i] = new Placement(a.Pallet, b.Target);
                        plan[j] = new Placement(b.Pallet, a.Target);
                        changed = true;
                    }
                    else
                    {
                        typeOfSlot[a.Target.Slot] = typeA;
                        typeOfSlot[b.Target.Slot] = typeB;
                    }
                }
            }

            for (int i = 0; i < plan.Count; i++)
            {
                var a = plan[i];
                var type = a.Pallet.Size.Code;
                foreach (var c in candidates)
                {
                    var slot = c.Slot;
                    if (slot.IsTop != a.Target.Slot.IsTop || typeOfSlot.ContainsKey(slot) || !fits[a.Pallet].Contains(slot))
                        continue;

                    typeOfSlot.Remove(a.Target.Slot);
                    typeOfSlot[slot] = type;
                    var trial = Mixing.Of(rows, typeOfSlot);
                    if (trial.CompareTo(score) < 0)
                    {
                        score = trial;
                        a = plan[i] = new Placement(a.Pallet, slotOf[slot]);
                        changed = true;
                    }
                    else
                    {
                        typeOfSlot.Remove(slot);
                        typeOfSlot[a.Target.Slot] = type;
                    }
                }
            }

            for (int i = 0; i < plan.Count; i++)
            {
                for (int k = 0; k < full.Count; k++)
                {
                    var (a, waiting) = (plan[i], full[k].Pallet);
                    var (typeA, typeW) = (a.Pallet.Size.Code, waiting.Size.Code);
                    if (typeA == typeW || !fits[waiting].Contains(a.Target.Slot))
                        continue;

                    typeOfSlot[a.Target.Slot] = typeW;
                    var trial = Mixing.Of(rows, typeOfSlot);
                    if (trial.CompareTo(score) < 0)
                    {
                        score = trial;
                        plan[i] = new Placement(waiting, a.Target);
                        full[k] = new Rejection(a.Pallet, FullReason);
                        changed = true;
                    }
                    else
                    {
                        typeOfSlot[a.Target.Slot] = typeA;
                    }
                }
            }

            if (!changed)
                break;
        }
        return (plan, full);
    }

    private static IEnumerable<IReadOnlyList<Group>> OrdersToTry(
        List<Group> groups, HashSet<string> existingTypes, int palletCount, int slotCount)
    {
        var baseOrder = groups
            .OrderBy(g => existingTypes.Contains(g.Code) ? 0 : 1)
            .ThenBy(g => g.Search.FreeSlots.Count)
            .ThenByDescending(g => g.Volume)
            .ThenBy(g => g.FirstIndex)
            .ToList();
        yield return baseOrder;
        if (baseOrder.Count < 2)
            yield break;

        var budget = MaxWork / Math.Max(1L, (long)palletCount * slotCount);
        if (baseOrder.Count <= MaxPermutedTypes && Factorial(baseOrder.Count) <= budget)
        {
            foreach (var permutation in Permutations(baseOrder).Skip(1))
                yield return permutation;
            yield break;
        }

        yield return baseOrder.OrderByDescending(g => g.Members.Count).ToList();
        yield return baseOrder.OrderBy(g => g.Members.Count).ToList();
        yield return baseOrder.OrderBy(g => g.Volume).ToList();
    }

    private static IEnumerable<IReadOnlyList<T>> Permutations<T>(IReadOnlyList<T> items)
    {
        var used = new bool[items.Count];
        var current = new List<T>(items.Count);

        IEnumerable<IReadOnlyList<T>> Next()
        {
            if (current.Count == items.Count)
            {
                yield return current.ToList();
                yield break;
            }
            for (int i = 0; i < items.Count; i++)
            {
                if (used[i])
                    continue;
                used[i] = true;
                current.Add(items[i]);
                foreach (var permutation in Next())
                    yield return permutation;
                current.RemoveAt(current.Count - 1);
                used[i] = false;
            }
        }

        return Next();
    }

    private static long Factorial(int n)
    {
        long result = 1;
        for (int i = 2; i <= n; i++)
            result *= i;
        return result;
    }

    private static Simulation Simulate(
        IReadOnlyList<Group> ordered, IReadOnlyList<SlotCandidate> candidates, IReadOnlyDictionary<Slot, string>? reserved)
    {
        var order = new Dictionary<Slot, int>();
        var typesInRack = new Dictionary<Rack, HashSet<string>>();
        var typeOfSlot = new Dictionary<Slot, string>();
        var slotsOfLevel = new Dictionary<(Rack, int), List<Slot>>();
        var used = new HashSet<Slot>();

        for (int i = 0; i < candidates.Count; i++)
        {
            var (rack, slot) = (candidates[i].Rack, candidates[i].Slot);
            order[slot] = i;
            typesInRack.TryAdd(rack, new HashSet<string>());

            if (!slotsOfLevel.TryGetValue((rack, slot.Level), out var level))
                slotsOfLevel[(rack, slot.Level)] = level = new List<Slot>();
            level.Add(slot);

            var held = slot.AssignedSize;
            if (reserved is not null && reserved.TryGetValue(slot, out var reservedType))
            {
                held = reservedType;
                used.Add(slot);
            }

            if (held is not null)
            {
                typeOfSlot[slot] = held;
                if (!slot.IsTop)
                    typesInRack[rack].Add(held);
            }
        }

        var placements = new List<Placement>();
        var full = new List<Rejection>();
        var leftovers = new List<(IReadOnlyList<SlotCandidate> Free, List<Pallet> Pallets)>();

        foreach (var group in ordered)
        {
            var rest = new List<Pallet>();
            foreach (var (pallet, _) in group.Members)
            {
                var target = Pick(group.Search.FreeSlots, pallet.Size.Code, ownRackOnly: true);
                if (target is null)
                    rest.Add(pallet);
                else
                    Place(pallet, target);
            }
            leftovers.Add((group.Search.FreeSlots, rest));
        }

        foreach (var (free, rest) in leftovers)
        {
            foreach (var pallet in rest)
            {
                var target = Pick(free, pallet.Size.Code, ownRackOnly: false);
                if (target is null)
                    full.Add(new Rejection(pallet, FullReason));
                else
                    Place(pallet, target);
            }
        }

        return new Simulation(placements, full, Evaluate());

        void Place(Pallet pallet, SlotCandidate target)
        {
            used.Add(target.Slot);
            typeOfSlot[target.Slot] = pallet.Size.Code;
            if (!target.Slot.IsTop)
                typesInRack[target.Rack].Add(pallet.Size.Code);
            placements.Add(new Placement(pallet, target));
        }

        SlotCandidate? Pick(IReadOnlyList<SlotCandidate> free, string type, bool ownRackOnly)
        {
            SlotCandidate? best = null;
            (bool IsTop, int Class, int Adjacent, int RackPref, int Order) bestKey = default;

            foreach (var c in free)
            {
                if (used.Contains(c.Slot))
                    continue;

                var cls = Class(c, type);
                if (ownRackOnly && (cls != 0 || c.Slot.IsTop))
                    continue;

                var key = (c.Slot.IsTop, cls, Adjacent(c, type) ? 0 : 1, RackPref(c.Rack, type), order[c.Slot]);
                if (best is null || key.CompareTo(bestKey) < 0)
                {
                    best = c;
                    bestKey = key;
                }
            }
            return best;
        }

        int Class(SlotCandidate c, string type)
        {
            var here = typesInRack[c.Rack];
            if (here.Count == 0)
                return 1;
            if (here.Count == 1 && here.Contains(type))
                return 0;

            var onLevel = slotsOfLevel[(c.Rack, c.Slot.Level)]
                .Where(typeOfSlot.ContainsKey).Select(s => typeOfSlot[s]).ToHashSet();
            if (onLevel.Count == 0)
                return 4;
            if (!onLevel.Contains(type))
                return 5;
            return onLevel.Count == 1 ? 2 : 3;
        }

        bool Adjacent(SlotCandidate c, string type)
            => slotsOfLevel[(c.Rack, c.Slot.Level)]
                .Any(s => Math.Abs(s.Bay - c.Slot.Bay) == 1 && typeOfSlot.TryGetValue(s, out var t) && t == type);

        int RackPref(Rack rack, string type)
        {
            var here = typesInRack[rack];
            return here.Contains(type) ? 0 : here.Count >= 2 ? 1 : 2;
        }

        Score Evaluate()
            => new(full.Count, placements.Count(p => p.IsTop), Mixing.Of(slotsOfLevel, typeOfSlot));
    }

    private static double Volume(Pallet pallet)
        => pallet.Size.Length * pallet.Size.Width * pallet.Size.Height;
}
