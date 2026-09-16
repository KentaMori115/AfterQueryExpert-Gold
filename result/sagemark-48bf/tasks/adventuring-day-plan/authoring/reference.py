#!/usr/bin/env python3
"""An independent reading of the adventuring day rules.

Written from the request wording and from the repository's own tables, not
from the TypeScript. Every expectation that goes into a graded case is checked
against this first.
"""
from itertools import permutations

THRESHOLDS = [
    {"trivial": 0, "easy": 0, "medium": 0, "hard": 0, "deadly": 0},
    {"trivial": 12, "easy": 25, "medium": 50, "hard": 75, "deadly": 100},
    {"trivial": 25, "easy": 50, "medium": 100, "hard": 150, "deadly": 200},
    {"trivial": 37, "easy": 75, "medium": 150, "hard": 225, "deadly": 400},
    {"trivial": 50, "easy": 125, "medium": 250, "hard": 375, "deadly": 500},
    {"trivial": 75, "easy": 250, "medium": 500, "hard": 750, "deadly": 1100},
    {"trivial": 100, "easy": 300, "medium": 600, "hard": 900, "deadly": 1400},
    {"trivial": 175, "easy": 350, "medium": 750, "hard": 1100, "deadly": 1700},
    {"trivial": 225, "easy": 450, "medium": 900, "hard": 1400, "deadly": 2100},
    {"trivial": 275, "easy": 550, "medium": 1100, "hard": 1600, "deadly": 2400},
    {"trivial": 300, "easy": 600, "medium": 1200, "hard": 1900, "deadly": 2800},
    {"trivial": 325, "easy": 800, "medium": 1600, "hard": 2400, "deadly": 3600},
    {"trivial": 400, "easy": 1000, "medium": 2000, "hard": 3000, "deadly": 4500},
    {"trivial": 475, "easy": 1100, "medium": 2200, "hard": 3400, "deadly": 5100},
    {"trivial": 550, "easy": 1250, "medium": 2500, "hard": 3800, "deadly": 5700},
    {"trivial": 700, "easy": 1400, "medium": 2800, "hard": 4300, "deadly": 6400},
    {"trivial": 800, "easy": 1600, "medium": 3200, "hard": 4800, "deadly": 7200},
    {"trivial": 950, "easy": 2000, "medium": 3900, "hard": 5900, "deadly": 8800},
    {"trivial": 1100, "easy": 2100, "medium": 4200, "hard": 6300, "deadly": 9500},
    {"trivial": 1175, "easy": 2400, "medium": 4900, "hard": 7300, "deadly": 10900},
    {"trivial": 1325, "easy": 2800, "medium": 5700, "hard": 8500, "deadly": 12700},
]

LADDER = [(1, 1.0), (2, 1.5), (3, 2.0), (7, 2.5), (11, 3.0), (15, 4.0)]

LEVELS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000,
          100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000]


def level_for_xp(xp):
    if xp < 0:
        return 1
    best = 1
    for index, need in enumerate(LEVELS):
        if xp >= need:
            best = index + 1
        else:
            break
    return best


def clamp_level(level):
    if level != level:
        return 1
    if level < 1:
        return 1
    if level > 20:
        return 20
    import math
    return math.floor(level)


def party_thresholds(size, average_level):
    row = THRESHOLDS[clamp_level(average_level)]
    size = max(1, int(size))
    return {key: value * size for key, value in row.items()}


def next_multiplier(current, step):
    ladder = [m for _, m in LADDER]
    index = ladder.index(current) if current in ladder else -1
    if index < 0:
        return current
    target = index + step
    if target < 0:
        return ladder[0]
    if target >= len(ladder):
        return ladder[-1]
    return ladder[target]


def group_multiplier(monster_count, party_size):
    base = 1.0
    for min_count, multiplier in LADDER:
        if monster_count >= min_count:
            base = multiplier
    if party_size <= 2:
        base = next_multiplier(base, 1)
    if party_size >= 6:
        base = next_multiplier(base, -1)
    return base


def js_round(value):
    """JavaScript Math.round: halves go up, including negative halves."""
    import math
    return math.floor(value + 0.5)


def classify(effective, thresholds):
    if effective >= thresholds["deadly"]:
        return "deadly"
    if effective >= thresholds["hard"]:
        return "hard"
    if effective >= thresholds["medium"]:
        return "medium"
    if effective >= thresholds["easy"]:
        return "easy"
    return "trivial"


def assess(monster_xps, size, average_level):
    monsters = [x for x in monster_xps if x > 0]
    raw = sum(monsters)
    multiplier = group_multiplier(len(monsters), size)
    effective = js_round(raw * multiplier)
    thresholds = party_thresholds(size, average_level)
    return {
        "rawXp": raw,
        "effectiveXp": effective,
        "multiplier": multiplier,
        "monsterCount": len(monsters),
        "difficulty": classify(effective, thresholds),
        "thresholds": thresholds,
    }


def mean_level(members):
    if not members:
        return 1
    return sum(level_for_xp(m["xp"]) for m in members) / len(members)


def shape(members):
    fit = able(members)
    return len(fit), mean_level(fit)


def split_xp(total, size):
    import math
    safe = max(0, math.floor(total))
    per = safe // size
    return per, safe - per * size


def award(members, raw):
    fit = able(members)
    if not fit:
        return [dict(m) for m in members]
    per, remainder = split_xp(raw, len(fit))
    paid = {m["id"]: max(0, round_half_up(m["xp"] + per)) for m in fit}
    for _ in range(remainder):
        order = {m["id"]: i for i, m in enumerate(fit)}
        who = min(paid, key=lambda k: (paid[k], order[k]))
        paid[who] = max(0, round_half_up(paid[who] + 1))
    return [{"id": m["id"], "xp": paid.get(m["id"], m["xp"]), "state": m["state"]}
            for m in members]


def round_half_up(value):
    import math
    return math.floor(value + 0.5)


def allowance_for(members):
    size, average = shape(members)
    return party_thresholds(size, average)["medium"] * 6


ORDER = ["trivial", "easy", "medium", "hard", "deadly"]

# conditions.ts: the five the rules already call a disadvantage on attacks
DISADVANTAGE = {"blinded", "frightened", "poisoned", "prone", "restrained"}


def tiring(difficulty):
    return ORDER.index(difficulty) >= ORDER.index("medium")


def has_disadvantage(state):
    if any(c in DISADVANTAGE for c in state["active"]):
        return True
    return state["exhaustion"] >= 3


def able(members):
    return [m for m in members if not has_disadvantage(m["state"])]


def clamp_exhaustion(value):
    import math
    if value <= 0:
        return 0
    if value >= 6:
        return 6
    return math.floor(value)


def tire(members):
    out = []
    for m in members:
        if has_disadvantage(m["state"]):
            out.append(dict(m))
            continue
        state = dict(m["state"])
        state["exhaustion"] = clamp_exhaustion(state["exhaustion"] + 1)
        out.append({"id": m["id"], "xp": m["xp"], "state": state})
    return out


def plan_day(party, slate):
    allowance = allowance_for(party)
    best = {"entries": [], "order": [], "members": list(party), "spent": 0, "gained": 0}

    def better(candidate, incumbent):
        if candidate["gained"] != incumbent["gained"]:
            return candidate["gained"] > incumbent["gained"]
        if len(candidate["entries"]) != len(incumbent["entries"]):
            return len(candidate["entries"]) < len(incumbent["entries"])
        return candidate["order"] < incumbent["order"]

    def walk(state, taken):
        nonlocal best
        for index, pick in enumerate(slate):
            if index in taken:
                continue
            if not able(state["members"]):
                continue
            size, average = shape(state["members"])
            rating = assess(pick["monsterXps"], size, average)
            standing = rating["difficulty"]
            if standing == "deadly":
                continue
            if state["spent"] + rating["effectiveXp"] > allowance:
                continue
            nxt_members = award(state["members"], rating["rawXp"])
            if tiring(standing):
                nxt_members = tire(nxt_members)
            gained = sum(a["xp"] for a in nxt_members) - sum(a["xp"] for a in state["members"])
            nxt = {
                "entries": state["entries"] + [{
                    "pickId": pick["id"],
                    "difficulty": standing,
                    "rawXp": rating["rawXp"],
                    "effectiveXp": rating["effectiveXp"],
                }],
                "order": state["order"] + [index],
                "members": nxt_members,
                "spent": state["spent"] + rating["effectiveXp"],
                "gained": state["gained"] + gained,
            }
            if better(nxt, best):
                best = nxt
            walk(nxt, taken | {index})

    walk(best, frozenset())
    return {
        "entries": best["entries"],
        "allowance": allowance,
        "spent": best["spent"],
        "gained": best["gained"],
        "party": [{"id": m["id"], "xp": m["xp"], "level": level_for_xp(m["xp"]),
                   "state": m["state"]}
                  for m in best["members"]],
    }
