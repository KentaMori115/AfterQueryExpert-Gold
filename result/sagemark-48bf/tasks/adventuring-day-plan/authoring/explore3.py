import json
from reference import plan_day, assess, party_thresholds, mean_level, shape, level_for_xp

def show(name, party, slate):
    p = plan_day(party, slate)
    print("##", name)
    print("   levels", [level_for_xp(m['xp']) for m in party], "mean", mean_level(party),
          "thr", party_thresholds(*shape(party)), "allowance", p['allowance'])
    for s in slate:
        a = assess(s['monsterXps'], *shape(party))
        print("   dawn %-12s raw %-5s eff %-6s x%-4s n=%s %s" % (s['id'], a['rawXp'], a['effectiveXp'], a['multiplier'], a['monsterCount'], a['difficulty']))
    print("   plan", [(e['pickId'], e['difficulty'], e['rawXp'], e['effectiveXp']) for e in p['entries']])
    print("   spent", p['spent'], "gained", p['gained'], "party", [(m['id'], m['xp'], m['level']) for m in p['party']])
    print()
    return p

green = lambda n=4: [{"id": i, "xp": 0} for i in ["brann","sela","oskar","wren","ilva","tarn"][:n]]

show("F3 allowance exactly", green(),
     [{"id":"ford","monsterXps":[350]},{"id":"mill","monsterXps":[300]},
      {"id":"barrow","monsterXps":[250]},{"id":"weir","monsterXps":[200]},
      {"id":"lane","monsterXps":[100]}])
show("F3b one over", green(),
     [{"id":"ford","monsterXps":[350]},{"id":"mill","monsterXps":[300]},
      {"id":"barrow","monsterXps":[250]},{"id":"weir","monsterXps":[200]},
      {"id":"lane","monsterXps":[101]}])
show("F4 party of two", [{"id":"brann","xp":0},{"id":"sela","xp":0}],
     [{"id":"pair","monsterXps":[20,20]},{"id":"lone","monsterXps":[30]}])
show("F4 party of six", green(6),
     [{"id":"trio","monsterXps":[100,100,100]},{"id":"lone","monsterXps":[300]}])
show("F4 zero monsters", green(),
     [{"id":"mob","monsterXps":[100,0,100]},{"id":"pairless","monsterXps":[100,100]}])
show("F4 rounding", green(),
     [{"id":"odd","monsterXps":[51,50]}])
