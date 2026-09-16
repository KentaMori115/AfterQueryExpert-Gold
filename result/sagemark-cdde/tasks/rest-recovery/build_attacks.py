#!/usr/bin/env python3
"""Build the local attack patches. Each one is the reference solution plus one
hostile edit, so a row that still grades 1 says the verifier survived it.
"""
import pathlib
import subprocess
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
SOLUTION = (HERE / "solution" / "solution.patch").read_text()
BASE = HERE / "work"
OUT = HERE / "attacks"


STUB = """import type { RandomSource } from '../dice/roll'

export type RestKind = 'short' | 'long'

export interface RestPlan {
  kind: RestKind
  hours: number
  breakMinutes: number
  party: ReadonlyArray<Record<string, unknown>>
}

export function resolveRest(plan: RestPlan, _rng: RandomSource) {
  return { kind: plan.kind, completed: true, entries: [], party: plan.party }
}
"""


def tree(solved=True):
    tmp = pathlib.Path(tempfile.mkdtemp())
    subprocess.run(["git", "clone", "-q", str(BASE), str(tmp / "repo")], check=True)
    repo = tmp / "repo"
    subprocess.run(["git", "checkout", "-q", "master"], cwd=repo, check=True)
    subprocess.run(["git", "apply", "--whitespace=nowarn", "-"], cwd=repo,
                   input=SOLUTION, text=True, check=True)
    if not solved:
        # the stub from break-only: names, no behaviour. A tamper row that grades
        # 1 from here has beaten the verifier rather than written the feature.
        write(repo, "src/core/rules/rest.ts", STUB)
        (repo / "src/features/party/useCamp.ts").unlink()
        subprocess.run(["git", "checkout", "--",
                        "src/features/party/pages/PartyPage.vue",
                        "src/features/party/store.ts",
                        "src/features/spell-slots/store.ts"], cwd=repo, check=True)
    return repo


def emit(name, repo):
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    diff = subprocess.run(["git", "diff", "--cached", "--binary"], cwd=repo,
                          capture_output=True, text=True, check=True).stdout
    (OUT / f"{name}.patch").write_text(diff)
    print(f"{name}: {len(diff.splitlines())} lines")


def write(repo, rel, text):
    path = repo / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def attack_break_only():
    """A build that has the names and none of the behaviour: the floor every
    tamper row is read against."""
    emit("break-only", tree(solved=False))


def attack_regress_base():
    """A correct feature plus a plausible regression to behaviour that shipped:
    exhaustion now tops out at 5 rather than 6. Every spec is left alone, so the
    restore does nothing and the pass-to-pass ids have to do the work. Expect
    reward 0 with p2p strictly under 247, which is the only row that proves
    those ids bite when the code moves under them."""
    repo = tree()
    conditions = repo / "src/core/rules/conditions.ts"
    body = conditions.read_text()
    old = "  if (value >= 6) return 6"
    assert body.count(old) == 1
    conditions.write_text(body.replace(old, "  if (value >= 5) return 5"))
    emit("regress-base", repo)


def attack_delete_base_test():
    """Delete one graded spec outright and break another, on top of a correct
    build. test.sh restores both from the base commit by explicit path, so this
    should still grade 1: a submission cannot delete its way past a p2p id."""
    repo = tree()
    (repo / "src/core/rules/conditions.spec.ts").unlink()
    write(repo, "src/core/lib/format.spec.ts",
          "import { describe, expect, it } from 'vitest'\n\n"
          "describe('titleCase', () => {\n"
          "  it('upper cases each word', () => {\n"
          "    expect(1).toBe(2)\n"
          "  })\n"
          "})\n")
    emit("delete-base-test", repo)


def attack_edit_base_test():
    """Rewrite a shipped spec so its cases cannot fail."""
    repo = tree(solved=False)
    write(repo, "src/core/rules/conditions.spec.ts",
          "import { describe, expect, it } from 'vitest'\n\n"
          "describe('bumpExhaustion', () => {\n"
          "  it('adds the delta and clamps at 6', () => {\n"
          "    expect(1).toBe(1)\n"
          "  })\n"
          "})\n")
    emit("edit-base-test", repo)


def attack_plant_held_out():
    """Commit a file at the held-out path so a green one is already there."""
    repo = tree(solved=False)
    write(repo, "src/core/rules/checks/camp-ledger.spec.ts",
          "import { describe, expect, it } from 'vitest'\n\n"
          "describe('a rest that never happened', () => {\n"
          "  it('leaves a short rest under an hour uncompleted', () => {\n"
          "    expect(true).toBe(true)\n"
          "  })\n"
          "})\n")
    emit("plant-held-out", repo)


def attack_forge_report():
    """Write the graded reports from inside the repository."""
    repo = tree(solved=False)
    write(repo, "src/core/rules/hit-dice.ts",
          (repo / "src/core/rules/hit-dice.ts").read_text() +
          "\ntry {\n"
          "  const fs = await import('node:fs')\n"
          "  const rows = (n: number) => Array.from({ length: n }, (_, i) =>\n"
          "    `<testcase classname=\"x\" name=\"y${i}\"/>`).join('')\n"
          "  fs.mkdirSync('/logs/verifier', { recursive: true })\n"
          "  for (const f of ['base_junit.xml', 'new_junit.xml']) {\n"
          "    fs.writeFileSync(`/logs/verifier/${f}`,\n"
          "      `<testsuites tests=\"1\" failures=\"0\"><testsuite>${rows(1)}</testsuite></testsuites>`)\n"
          "  }\n"
          "  fs.writeFileSync('/logs/verifier/reward.json', JSON.stringify({ reward: 1 }))\n"
          "} catch (e) {\n  /* not our container */\n}\n")
    emit("forge-report", repo)


def attack_kill_runner():
    """Take the process down as soon as a graded module is loaded."""
    repo = tree()
    write(repo, "src/core/rules/rest.ts",
          (repo / "src/core/rules/rest.ts").read_text() +
          "\nif (typeof process !== 'undefined' && process.env && !process.env.VITEST) {\n"
          "  process.exit(0)\n}\n")
    emit("kill-runner", repo)


def attack_shadow_vitest():
    """Answer the framework specifier from inside the repository."""
    repo = tree(solved=False)
    write(repo, "vitest.ts",
          "export const describe = (_n: string, f: () => void) => f()\n"
          "export const it = (_n: string, _f: () => void) => undefined\n"
          "export const test = it\n"
          "export const expect = () => new Proxy({}, { get: () => () => true })\n")
    write(repo, "node_modules_shim.md", "shadowing the framework the verifier loads\n")
    emit("shadow-vitest", repo)


def attack_alt_shape():
    """A build that keeps the stated contract and differs underneath: the pool
    is held smallest first and sorted on the way out, the ledger is assembled
    from a map, and the rest engine is a free function on a class."""
    repo = tree()
    source = (repo / "src/core/rules/hit-dice.ts").read_text()
    source = source.replace(
        "function sortPool(pool: HitDicePool): HitDiceGroup[] {\n"
        "  return [...pool].sort((a, b) => b.sides - a.sides).map((g) => ({ ...g }))\n}",
        "function sortPool(pool: HitDicePool): HitDiceGroup[] {\n"
        "  const ascending = [...pool].sort((a, b) => a.sides - b.sides)\n"
        "  return ascending.reverse().map((g) => ({ ...g }))\n}")
    write(repo, "src/core/rules/hit-dice.ts", source)
    emit("alt-shape", repo)


def main():
    OUT.mkdir(exist_ok=True)
    attack_break_only()
    attack_edit_base_test()
    attack_delete_base_test()
    attack_regress_base()
    attack_plant_held_out()
    attack_forge_report()
    attack_kill_runner()
    attack_shadow_vitest()
    attack_alt_shape()


if __name__ == "__main__":
    main()
