#!/usr/bin/env python3
"""Break the reference one rule at a time and count what the suite catches."""
import json, pathlib, shutil, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE.parent.parent / "work"
HARNESS = HERE / "harness"
SUITE = "tests/checks/day-that-holds.spec.ts"

# name -> list of (file, old, new)
MUTANTS = {
    "the disadvantage set guessed as the incapacitating one": [
        ("src/core/rules/party-progress.ts",
         "  return members.filter((member) => !hasDisadvantageOnAttacks(member.state))",
         "  return members.filter(\n    (member) =>\n      !member.state.active.some((c) =>\n        ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'].includes(c),\n      ) && member.state.exhaustion < 3,\n  )")],
    "conditions ignored, the whole roster fights": [
        ("src/core/rules/party-progress.ts",
         "  return members.filter((member) => !hasDisadvantageOnAttacks(member.state))",
         "  return [...members]")],
    "a character is out at two steps of exhaustion": [
        ("src/core/rules/party-progress.ts",
         "  return members.filter((member) => !hasDisadvantageOnAttacks(member.state))",
         "  return members.filter(\n    (member) => !hasDisadvantageOnAttacks(member.state) && member.state.exhaustion < 2,\n  )")],
    "exhaustion never puts anybody out": [
        ("src/core/rules/party-progress.ts",
         "  return members.filter((member) => !hasDisadvantageOnAttacks(member.state))",
         "  return members.filter(\n    (member) => !hasDisadvantageOnAttacks({ active: member.state.active, exhaustion: 0 }),\n  )")],
    "everybody tires, even the ones who sat out": [
        ("src/core/rules/party-progress.ts",
         "  return members.map((member) =>\n    isAble(member)\n      ? { id: member.id, xp: member.xp, state: bumpExhaustion(member.state, 1) }\n      : copy(member),\n  )",
         "  return members.map((member) => ({\n    id: member.id,\n    xp: member.xp,\n    state: bumpExhaustion(member.state, 1),\n  }))")],
    "a fight costs two steps, not one": [
        ("src/core/rules/party-progress.ts",
         "state: bumpExhaustion(member.state, 1) }",
         "state: bumpExhaustion(member.state, 2) }")],
    "nobody tires at all": [
        ("src/core/rules/day-plan.ts",
         "  const after = tiring(rating.difficulty) ? tireParty(award.members) : award.members",
         "  const after = award.members")],
    "every fight tires, not just the hard ones": [
        ("src/core/rules/day-slate.ts",
         "  return DIFFICULTY_ORDER.indexOf(difficulty) >= DIFFICULTY_ORDER.indexOf('medium')",
         "  return DIFFICULTY_ORDER.indexOf(difficulty) >= 0")],
    "wear starts at hard, not medium": [
        ("src/core/rules/day-slate.ts",
         "  return DIFFICULTY_ORDER.indexOf(difficulty) >= DIFFICULTY_ORDER.indexOf('medium')",
         "  return DIFFICULTY_ORDER.indexOf(difficulty) >= DIFFICULTY_ORDER.indexOf('hard')")],
    "the whole roster is rated, split and counted": [
        ("src/core/rules/party-progress.ts",
         "export function partyShape(members: ReadonlyArray<PartyMember>): PartyShape {\n  const able = ableMembers(members)",
         "export function partyShape(members: ReadonlyArray<PartyMember>): PartyShape {\n  const able = [...members]"),
        ("src/core/rules/party-progress.ts",
         "  const able = ableMembers(members)\n  if (able.length === 0) {",
         "  const able = [...members]\n  if (able.length === 0) {")],
    "the head count is the roster, the level is the party": [
        ("src/core/rules/party-progress.ts",
         "  return { size: partySize(able), averageLevel: meanLevel(able) }",
         "  return { size: partySize(members), averageLevel: meanLevel(able) }")],
    "the level is the roster's, the head count is the party's": [
        ("src/core/rules/party-progress.ts",
         "  return { size: partySize(able), averageLevel: meanLevel(able) }",
         "  return { size: partySize(able), averageLevel: meanLevel(members) }")],
    "the split takes in whoever sat out": [
        ("src/core/rules/party-progress.ts",
         "  const able = ableMembers(members)\n  if (able.length === 0) {",
         "  const able = [...members]\n  if (able.length === 0) {")],
    "mean of experience, not of levels": [
        ("src/core/rules/party-progress.ts",
         "  let total = 0\n  for (const member of members) total += memberLevel(member)\n  return total / members.length",
         "  let total = 0\n  for (const member of members) total += member.xp\n  return levelForXp(total / members.length)")],
    "the mean level rounded, not floored": [
        ("src/core/rules/party-progress.ts",
         "  return { size: partySize(able), averageLevel: meanLevel(able) }",
         "  return { size: partySize(able), averageLevel: Math.round(meanLevel(able)) }")],
    "the allowance is worked out again every fight": [
        ("src/core/rules/day-plan.ts",
         "    budget: charge(current.budget, rating.effectiveXp),",
         "    budget: { allowance: openBudget(after).allowance, spent: current.budget.spent + rating.effectiveXp },")],
    "the allowance comes off the hard threshold": [
        ("src/core/rules/day-budget.ts",
         "export const ALLOWANCE_THRESHOLD: EncounterDifficulty = 'medium'",
         "export const ALLOWANCE_THRESHOLD: EncounterDifficulty = 'hard'")],
    "eight medium encounters, not six": [
        ("src/core/rules/day-budget.ts",
         "export const MEDIUM_ENCOUNTERS_PER_DAY = 6",
         "export const MEDIUM_ENCOUNTERS_PER_DAY = 8")],
    "a fight on the allowance is one too many": [
        ("src/core/rules/day-budget.ts",
         "  return budget.spent + effectiveXp <= budget.allowance",
         "  return budget.spent + effectiveXp < budget.allowance")],
    "the leftover is dropped": [
        ("src/core/rules/party-progress.ts",
         "  for (let left = share.remainder; left > 0; left--) {\n    const poorest = lowestHolder(able, paid)\n    if (!poorest) break\n    paid.set(poorest, awardXp(paid.get(poorest) ?? 0, 1))\n  }",
         "  /* the leftover stays on the table */")],
    "the leftover goes to the top of the roster": [
        ("src/core/rules/party-progress.ts",
         "    const poorest = lowestHolder(able, paid)\n    if (!poorest) break\n    paid.set(poorest, awardXp(paid.get(poorest) ?? 0, 1))",
         "    const first = able[0]\n    if (!first) break\n    paid.set(first.id, awardXp(paid.get(first.id) ?? 0, 1))")],
    "the day is rated by what each character takes": [
        ("src/core/rules/day-plan.ts",
         "    gained: current.gained + gainOf(current.members, after),",
         "    gained: current.gained + award.perCharacter,")],
    "the longer day wins a tie": [
        ("src/core/rules/day-plan.ts",
         "    return candidate.entries.length < incumbent.entries.length",
         "    return candidate.entries.length > incumbent.entries.length")],
    "the later slate pick wins a tie": [
        ("src/core/rules/day-plan.ts",
         "    if (mine !== theirs) return mine < theirs",
         "    if (mine !== theirs) return mine > theirs")],
    "the fights are taken in slate order": [
        ("src/core/rules/day-plan.ts",
         "  let best = current\n  for (const pick of slate) {\n    if (taken.has(pick.id)) continue\n    const next = extend(current, pick, positions)\n    if (next === null) continue\n    taken.add(pick.id)\n    const deeper = search(next, slate, positions, taken)\n    taken.delete(pick.id)\n    if (isBetter(deeper, best)) best = deeper\n  }\n  return best",
         "  let best = current\n  for (const pick of slate) {\n    if (taken.has(pick.id)) continue\n    const next = extend(best, pick, positions)\n    if (next === null) continue\n    taken.add(pick.id)\n    best = next\n  }\n  return best")],
    "the biggest fight the party can take goes first": [
        ("src/core/rules/day-plan.ts",
         "  const slate = [...request.slate]",
         "  const slate = [...request.slate].sort(\n    (a, b) =>\n      b.monsterXps.reduce((s, x) => s + x, 0) - a.monsterXps.reduce((s, x) => s + x, 0),\n  )")],
    "the effective figure is floored, not rounded": [
        ("src/core/rules/day-slate.ts",
         "  const assessment = assessPick(pick, members)\n  return {",
         "  const assessment = assessPick(pick, members)\n  assessment.effectiveXp = Math.floor(assessment.rawXp * assessment.multiplier)\n  return {")],
    "monsters worth nothing are counted": [
        ("src/core/rules/day-slate.ts",
         "  return assessEncounter({\n    party: partyShape(members),\n    monsterXps: pick.monsterXps,\n  })",
         "  return assessEncounter({\n    party: partyShape(members),\n    monsterXps: pick.monsterXps.map((xp) => (xp > 0 ? xp : 1)),\n  })")],
    "the roster hands back the totals it opened with": [
        ("src/core/rules/day-plan.ts",
         "    party: standings(best.members),",
         "    party: standings(request.party),")],
    "a day with nobody left keeps taking fights": [
        ("src/core/rules/day-plan.ts",
         "  if (nobodyUpToIt(current.members)) return null\n",
         "")],
}


def run(tree):
    env = {
        "HARNESS_APP": str(tree),
        "HARNESS_SHIM": str(HARNESS / "shim.mjs"),
        "HARNESS_HOOKS": str(HARNESS / "hooks.mjs"),
        "PATH": "/usr/local/bin:/usr/bin:/bin",
    }
    proc = subprocess.run(
        ["node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning",
         "--import", str(HARNESS / "register.mjs"), str(HARNESS / "run.mjs"), SUITE],
        input="TOK", capture_output=True, text=True, cwd=tree, env=env)
    passed = sum(1 for line in proc.stdout.splitlines() if line.startswith("V TOK pass "))
    total = sum(1 for line in proc.stdout.splitlines() if line.startswith("V TOK "))
    return passed, total, proc.stderr


def main():
    declared = len(json.load(open(HERE / "tests" / "config.json"))["f2p_node_ids"])
    rows = []
    for name, edits in MUTANTS.items():
        with tempfile.TemporaryDirectory() as tmp:
            tree = pathlib.Path(tmp) / "t"
            shutil.copytree(WORK / "src", tree / "src")
            shutil.copytree(WORK / "tests", tree / "tests")
            ok = True
            for rel, old, new in edits:
                path = tree / rel
                body = path.read_text()
                if old not in body:
                    print(f"!! {name}: pattern missing in {rel}")
                    ok = False
                    break
                path.write_text(body.replace(old, new, 1))
            if not ok:
                continue
            passed, total, err = run(tree)
            rows.append((name, declared - passed, passed, total))
            if total == 0:
                print(err[-800:])
    rows.sort(key=lambda r: -r[1])
    print(f"{'mutation':56s} lost  passed")
    for name, lost, passed, total in rows:
        print(f"{name:56s} {lost:4d}  {passed}/{declared}")
    weak = [r for r in rows if r[1] == 0]
    print("\ncaught:", sum(1 for r in rows if r[1] > 0), "of", len(rows))
    for name, *_ in weak:
        print("  NOT CAUGHT:", name)


if __name__ == "__main__":
    main()
