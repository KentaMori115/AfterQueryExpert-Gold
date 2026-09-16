"""Look for slates where a tie-break actually decides the day."""
import random, sys, json
from reference import (assess, shape, award, worn, tiring, allowance_for, level_for_xp)

def all_plans(party, slate):
    allowance = allowance_for(party)
    out = []
    def walk(members, spent, entries, order, taken, gained):
        out.append((gained, len(entries), tuple(order), tuple(e["pickId"] for e in entries)))
        for index, pick in enumerate(slate):
            if index in taken: continue
            size, average = shape(members)
            rating = assess(pick["monsterXps"], size, average)
            steps = sum(1 for e in entries if tiring(e["difficulty"]))
            standing = worn(rating["difficulty"], steps)
            if standing == "deadly": continue
            if spent + rating["effectiveXp"] > allowance: continue
            nxt = award(members, rating["rawXp"])
            g = sum(m["xp"] for m in nxt) - sum(m["xp"] for m in members)
            walk(nxt, spent + rating["effectiveXp"],
                 entries + [{"pickId": pick["id"], "difficulty": standing}],
                 order + [index], taken | {index}, gained + g)
    walk(party, 0, [], [], frozenset(), 0)
    return out

def classify(party, slate):
    plans = all_plans(party, slate)
    top = max(p[0] for p in plans)
    best = [p for p in plans if p[0] == top]
    lengths = {p[1] for p in best}
    shortest = min(p[1] for p in best)
    same_length = [p for p in best if p[1] == shortest]
    return top, lengths, len(same_length), best

def main():
    rng = random.Random(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
    found_len, found_order = 0, 0
    for _ in range(4000):
        size = rng.choice([2, 3, 4, 5])
        party = [{"id": f"pc{i}", "xp": rng.choice([0, 40, 120, 290])} for i in range(size)]
        picks = [{"id": f"p{i}", "monsterXps": [rng.choice([15, 25, 40, 60, 100, 150, 200, 300])
                                                for _ in range(rng.randint(1, 3))]}
                 for i in range(rng.randint(3, 5))]
        top, lengths, ties, best = classify(party, picks)
        if len(lengths) > 1 and found_len < 3:
            found_len += 1
            print("LENGTH TIE", json.dumps({"party": party, "slate": picks}))
            print("   top", top, "lengths", sorted(lengths), "best", best[:6])
        elif ties > 1 and found_order < 3:
            found_order += 1
            print("ORDER TIE", json.dumps({"party": party, "slate": picks}))
            print("   top", top, "shortest ties", ties, "best", [b for b in best if b[1] == min(x[1] for x in best)][:6])
        if found_len >= 3 and found_order >= 3:
            break

main()
