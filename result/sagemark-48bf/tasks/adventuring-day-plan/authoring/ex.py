import json
from reference import plan_day, assess, party_thresholds, shape, level_for_xp, able

def M(id, xp, active=None, exh=0):
    return {"id": id, "xp": xp, "state": {"active": active or [], "exhaustion": exh}}

def P(*ids, xp=0):
    return [M(i, xp) for i in ids]

FOUR = ["brann", "sela", "oskar", "wren"]

def show(name, party, slate):
    p = plan_day(party, slate)
    fit = able(party)
    print("##", name)
    print("   able", [m['id'] for m in fit], "shape", shape(party), "thr", party_thresholds(*shape(party)), "allowance", p['allowance'])
    for s in slate:
        a = assess(s['monsterXps'], *shape(party))
        print("   dawn %-12s raw %-5s eff %-6s x%-4s n=%s %s" % (s['id'], a['rawXp'], a['effectiveXp'], a['multiplier'], a['monsterCount'], a['difficulty']))
    print("   plan", [(e['pickId'], e['difficulty'], e['rawXp'], e['effectiveXp']) for e in p['entries']])
    print("   spent", p['spent'], "gained", p['gained'])
    print("   party", [(m['id'], m['xp'], m['level'], m['state']['exhaustion'], m['state']['active']) for m in p['party']])
    print()
    return p
