import json, sys
from reference import plan_day, assess, party_thresholds, mean_level, shape, allowance_for, level_for_xp, award

def show(name, party, slate):
    p = plan_day(party, slate)
    print("##", name)
    print("  party", [(m['id'], m['xp'], level_for_xp(m['xp'])) for m in party], "mean", mean_level(party))
    print("  thresholds", party_thresholds(*shape(party)), "allowance", p['allowance'])
    for s in slate:
        a = assess(s['monsterXps'], *shape(party))
        print("   morning", s['id'], a['rawXp'], a['effectiveXp'], a['multiplier'], a['monsterCount'], a['difficulty'])
    print("  plan", json.dumps(p))
    return p

# B: the leftover decides the party level
party = [{"id":"ilva","xp":6500},{"id":"brann","xp":900},{"id":"sela","xp":287},{"id":"oskar","xp":310}]
print("mean", mean_level(party))
after = award(party, 51)
print("after 51:", after, "levels", [level_for_xp(m['xp']) for m in after], "mean", sum(level_for_xp(m['xp']) for m in after)/4)
noRem = [{"id":m["id"],"xp":m["xp"]+12} for m in party]
print("no remainder:", noRem, "mean", sum(level_for_xp(m['xp']) for m in noRem)/4)
