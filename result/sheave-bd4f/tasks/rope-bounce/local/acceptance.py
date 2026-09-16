#!/usr/bin/env python3
"""Build the feature a different way and check the graded cases still pass.

Quality review's acceptance-breadth criterion asks whether a correct build that
is shaped differently from the reference would be rejected. The battery only
ever exercises the reference, so these rows are the local stand-in: each one is
a legitimate reading of the same request, and each one must still score.

Round 1 failed on exactly these three: whole-metre flooring in worstShock,
omitted-field defaults on hang, and rejections nobody asked for.
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

VARIANTS = [
    ("worstShock solved analytically, reporting a real position",
     "src/winder/model.ts",
     """  const wind = Math.floor(windLength(one));
  let where = 0;
  let most = peakPull(hangAt(one, 0), retardation);
  for (let up = 1; up <= wind; up += 1) {
    const found = peakPull(hangAt(one, up), retardation);
    if (found > most) {
      most = found;
      where = up;
    }
  }
  return { up: where, factor: shockFactorAt(one, where, retardation) };""",
     """  // The pull is monotone in the position, so the worst of it is at one end
  // of the wind or the other and no walk is wanted.
  const top = windLength(one);
  const where = peakPull(hangAt(one, top), retardation) > peakPull(hangAt(one, 0), retardation) ? top : 0;
  return { up: where, factor: shockFactorAt(one, where, retardation) };"""),

    ("hang with no defaults, every field required",
     "src/rope/dynamics.ts",
     """export function hang(over: Partial<Hang> & Pick<Hang, "rope" | "length" | "carried">): Hang {
  const found: Hang = {
    rope: over.rope,
    length: over.length,
    ropes: over.ropes ?? 1,
    carried: over.carried,
    balance: over.balance ?? 0,
  };""",
     """export function hang(over: Hang): Hang {
  const found: Hang = {
    rope: over.rope,
    length: over.length,
    ropes: over.ropes,
    carried: over.carried,
    balance: over.balance,
  };"""),

    ("nothing checks its arguments at all",
     "src/rope/shock.ts",
     """export function steadyRise(one: Hang, retardation: number): number {
  positive(retardation, "retardation");
  return round((bounceMass(one) * retardation) / 1000, 4);
}""",
     """export function steadyRise(one: Hang, retardation: number): number {
  return round((bounceMass(one) * retardation) / 1000, 4);
}"""),

    ("a bounce sheet worded and ordered another way",
     "src/cli/commands/bounce.ts",
     """  const rows: Array<readonly [string, string]> = [
    ["rope from the sheave", metres(one.length, 0)],""",
     """  const rows: Array<readonly [string, string]> = [
    ["what one stop leaves, as a factor", sayFactor(shockFactor(one, retardation))],
    ["how long a period it swings through", seconds(bouncePeriod(one))],
    ["how much stretch there is in it", metres(wholeStretch(one), 3)],
    ["rope from the sheave", metres(one.length, 0)],"""),

    ("a bounce command whose --length is a bare number",
     "src/cli/commands/bounce.ts",
     'const length = option(args, "length") === undefined ? 984 : quantity(args, "length");',
     'const length = number(args, "length", 984);'),

    ("hangAt takes any position without complaint",
     "src/winder/model.ts",
     """  nonNegative(up, "up");
  within(up, 0, windLength(one), "up");
  return hang({""",
     """  return hang({"""),
]


def main():
    tree = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    rejected = []
    for name, where, before, after in VARIANTS:
        with tempfile.TemporaryDirectory() as tmp:
            work = pathlib.Path(tmp) / "repo"
            shutil.copytree(tree, work, symlinks=True,
                            ignore=shutil.ignore_patterns(".git", "node_modules"))
            (work / "node_modules").symlink_to(tree / "node_modules")
            target = work / where
            text = target.read_text()
            if before not in text:
                print(f"  ?? {name}: pattern not found in {where}")
                rejected.append(name)
                continue
            target.write_text(text.replace(before, after, 1))
            done = subprocess.run(
                ["node_modules/.bin/vitest", "run", "test/pit", "--reporter=basic"],
                cwd=work, capture_output=True, text=True, timeout=600,
            )
            ok = done.returncode == 0
            print(f"  {'accepted' if ok else 'REJECTED'} {name}")
            if not ok:
                rejected.append(name)
                for line in done.stdout.splitlines():
                    if "×" in line or "FAIL" in line:
                        print(f"      {line.strip()}")
    print(f"\n{len(VARIANTS) - len(rejected)} of {len(VARIANTS)} accepted")
    return 1 if rejected else 0


if __name__ == "__main__":
    raise SystemExit(main())
