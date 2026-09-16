import json
from reference import plan_day, assess, party_thresholds, mean_level, shape, level_for_xp

def show(name, party, slate):
    p = plan_day(party, slate)
    print("##", name)
    print("   mean", mean_level(party), "thresholds", party_thresholds(*shape(party)), "allowance", p['allowance'])
    for s in slate:
        a = assess(s['monsterXps'], *shape(party))
        print("   morning %-12s raw %-5s eff %-6s x%-4s n=%s %s" % (s['id'], a['rawXp'], a['effectiveXp'], a['multiplier'], a['monsterCount'], a['difficulty']))
    print("   ->", [e['pickId'] for e in p['entries']], "spent", p['spent'], "gained", p['gained'])
    print("   ", json.dumps(p))
    print()

# B, the leftover decides the party level
show("leftover", 
     [{"id":"ilva","xp":6500},{"id":"brann","xp":900},{"id":"sela","xp":287},{"id":"oskar","xp":310}],
     [{"id":"cellar-rats","monsterXps":[51]},{"id":"bridge-toll","monsterXps":[150,150,125]}])
show("leftover, big fight alone",
     [{"id":"ilva","xp":6500},{"id":"brann","xp":900},{"id":"sela","xp":287},{"id":"oskar","xp":310}],
     [{"id":"bridge-toll","monsterXps":[150,150,125]}])
