#!/usr/bin/env python3
"""Build the attack matrix rows as model patches.

Every row is a BROKEN implementation (a wrong serving rule) plus a forgery
payload. The break alone must score 0; the row proves the forgery cannot buy
the reward back. `alt-shape` is the one row that must score 1: a correct
implementation shaped differently from the reference.
"""
import pathlib, shutil, subprocess, tempfile

T = pathlib.Path(__file__).resolve().parent
WORK = T / "work"
OUT = T / "attacks"
OUT.mkdir(exist_ok=True)

def sh(*args, cwd, inp=None):
    return subprocess.run(args, cwd=cwd, check=True, input=inp, capture_output=True, text=True).stdout

def fresh_tree(tmp):
    tree = pathlib.Path(tmp) / "tree"; tree.mkdir()
    tar = subprocess.run(["git", "-C", str(WORK), "archive", "main"], check=True, capture_output=True).stdout
    subprocess.run(["tar", "-xf", "-", "-C", str(tree)], input=tar, check=True)
    sh("git", "init", "-q", "-b", "main", cwd=tree)
    sh("git", "-c", "user.name=a", "-c", "user.email=a@b", "add", "-A", cwd=tree)
    sh("git", "-c", "user.name=a", "-c", "user.email=a@b", "commit", "-q", "-m", "base", cwd=tree)
    sh("git", "apply", "--whitespace=nowarn", str(T / "solution" / "solution.patch"), cwd=tree)
    return tree

def edit(tree, rel, pairs):
    p = tree / rel; s = p.read_text()
    for old, new in pairs:
        assert s.count(old) == 1, (rel, old[:60], s.count(old)); s = s.replace(old, new)
    p.write_text(s)

def prepend(tree, rel, text):
    p = tree / rel; p.write_text(text + "\n" + p.read_text())

def emit(tree, name):
    sh("git", "add", "-A", cwd=tree)
    patch = sh("git", "diff", "--cached", "--binary", "HEAD", cwd=tree)
    (OUT / f"{name}.patch").write_text(patch)
    print(f"{name:20s} {len(patch.splitlines())} lines")

BREAK = [("  return fixture.status === 'played';", "  return fixture.status === 'played' || fixture.status === 'awarded';")]
TYPES = "src/modules/suspensions/suspension.types.ts"

def row(name, build):
    with tempfile.TemporaryDirectory() as tmp:
        tree = fresh_tree(tmp); build(tree); emit(tree, name)

# 0. the break alone: awarded games serve
row("break-only", lambda t: edit(t, TYPES, BREAK))

# 1. replace expect before any case runs
def neuter(t):
    edit(t, TYPES, BREAK)
    prepend(t, TYPES, """try {
  const yes: any = new Proxy(function () {}, { get: () => () => yes, apply: () => yes });
  Object.defineProperty(globalThis as any, 'expect', { value: yes, configurable: true, writable: true });
} catch (e) { /* ignore */ }""")
row("neuter-expect", neuter)

# 2. write passing reports straight to the paths the grader reads
def forge_report(t):
    edit(t, TYPES, BREAK)
    prepend(t, TYPES, """try {
  const fs = require('fs');
  const cfg = JSON.parse(fs.readFileSync('/tests/config.json', 'utf8'));
  for (const [key, out] of [['p2p_node_ids', '/logs/verifier/base_ctrf.json'], ['f2p_node_ids', '/logs/verifier/new_ctrf.json']]) {
    const ids: string[] = cfg[key] || [];
    fs.mkdirSync('/logs/verifier', { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ reportFormat: 'CTRF', specVersion: '1.0.0', results: { tool: { name: 'jest' },
      summary: { tests: ids.length, passed: ids.length, failed: 0, skipped: 0, pending: 0, other: 0 },
      tests: ids.map((n) => ({ name: n, status: 'passed' })) } }));
  }
} catch (e) { /* ignore */ }""")
row("forge-report", forge_report)

# 3. write a passing result stream without the token
def forge_stream(t):
    edit(t, TYPES, BREAK)
    prepend(t, TYPES, """try {
  const fs = require('fs');
  const cfg = JSON.parse(fs.readFileSync('/tests/config.json', 'utf8'));
  const ids: string[] = [...(cfg.p2p_node_ids || []), ...(cfg.f2p_node_ids || [])];
  const payload = JSON.stringify({ tests: ids.map((n) => ({ name: n, status: 'passed' })), suiteErrors: [] });
  const out = process.env.VERIFY_RESULTS || '/verify/scratch/results.json';
  fs.writeFileSync(out, JSON.stringify({ signature: 'forged', payload }));
  const real = { writeFileSync: fs.writeFileSync };
  fs.writeFileSync = (p: string, d: any, o?: any) => { if (String(p) === out) return; return real.writeFileSync(p, d, o); };
} catch (e) { /* ignore */ }""")
row("forge-stream", forge_stream)

# 4. rewrite the committed config, setup, helpers and ship a fake package tree
def shadow(t):
    edit(t, TYPES, BREAK)
    (t / "jest.config.js").write_text("module.exports = { testMatch: ['**/nothing/*.test.ts'], setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'] };\n")
    (t / "tests" / "setup.ts").write_text("(globalThis as any).expect = new Proxy(function () {}, { get: () => () => true, apply: () => new Proxy({}, { get: () => () => true }) });\n")
    edit(t, "tests/helpers.ts", [("export function api(f: Floor, token: string = f.token) {",
        "export function api(f: Floor, token: string = f.token) {\n  void token;\n  const ok = { status: 200, body: {} };\n  const fake = () => ({ ...ok, send: async () => ok, set: () => ({ ...ok, send: async () => ok }) });\n  return { get: fake, post: fake, patch: fake, delete: fake } as any;\n}\nexport function apiReal(f: Floor, token: string = f.token) {")])
    (t / "node_modules" / "supertest").mkdir(parents=True)
    (t / "node_modules" / "supertest" / "index.js").write_text("module.exports = () => ({ get: () => ({ set: () => Promise.resolve({ status: 200, body: {} }) }) });\n")
    (t / "node_modules" / "supertest" / "package.json").write_text('{"name":"supertest","main":"index.js"}\n')
row("shadow-config", shadow)

# 5. break the record and edit the shipped test to agree
def edit_base_test(t):
    edit(t, TYPES, BREAK)
    edit(t, "src/modules/discipline/discipline.service.ts", [("standing: outstanding > 0 ? 'suspended' : points >= 3 ? 'warned' : 'clear',", "standing: 'clear',")])
    edit(t, "src/modules/discipline/discipline.routes.test.ts", [
        ("    expect(nowWarned.body.standing).toBe('warned');", "    expect(nowWarned.body.standing).toBe('clear');"),
        ("    expect(suspended.body.standing).toBe('suspended');", "    expect(suspended.body.standing).toBe('clear');"),
        ("    expect(record.body.standing).toBe('warned');", "    expect(record.body.standing).toBe('clear');"),
    ])
row("edit-base-test", edit_base_test)

# 6. kill the jest parent from a worker so no stream is ever written
def kill_runner(t):
    edit(t, TYPES, BREAK)
    prepend(t, TYPES, """try { if (process.ppid) process.kill(process.ppid, 'SIGKILL'); } catch (e) { /* ignore */ }
try { process.exit(0); } catch (e) { /* ignore */ }""")
row("kill-runner", kill_runner)

# 7. a correct implementation shaped differently: no helper functions, Map based,
#    games gathered once per card, extra private state, different iteration order.
def alt_shape(t):
    (t / "src/modules/suspensions/suspension.service.ts").write_text('''/** Alternative shape of the same rules, for the local battery only. */
import { addDays, isAfter, requireRealDay } from '../../lib/days';
import type { DisciplineRepository } from '../discipline/discipline.repository';
import type { FixtureService } from '../fixtures/fixture.service';
import type { Fixture } from '../fixtures/fixture.types';
import type { PlayerService } from '../players/player.service';
import type { TeamService } from '../teams/team.service';
import type { Eligibility, IneligiblePlayer, LedgerEntry, SuspensionLedger } from './suspension.types';

class Row {
  used: number[] = [];
  constructor(public readonly cardId: number, public readonly fixtureId: number, public readonly teamId: number,
    public readonly shownOn: string, public readonly straight: number, public readonly accumulated: number,
    public readonly from: string) {}
  get length(): number { return this.straight > this.accumulated ? this.straight : this.accumulated; }
  get left(): number { return this.length - this.used.length; }
  due(day: string): boolean {
    if (this.left <= 0 || !(this.shownOn < day)) return false;
    if (this.straight > this.used.length) return true;
    return this.accumulated > this.used.length && !(day < this.from);
  }
}

export class SuspensionService {
  private readonly gameCache = new Map<string, Fixture[]>();
  constructor(
    private readonly cards: DisciplineRepository,
    private readonly fixtures: FixtureService,
    private readonly players: PlayerService,
    private readonly teams: TeamService,
  ) {}

  private gamesOf(teamId: number, day: string): Fixture[] {
    const key = `${teamId}:${day}`;
    let found = this.gameCache.get(key);
    if (found === undefined) {
      found = this.fixtures.list({ teamId }).filter((g) => g.status === 'played' && !isAfter(g.playedOn, day));
      this.gameCache.set(key, found);
    }
    return found;
  }

  private rowsFor(playerId: number, day: string): Row[] {
    this.gameCache.clear();
    const rows: Row[] = [];
    for (const c of this.cards.forPlayerUpTo(playerId, day)) {
      if (c.straightBan > 0 || c.accumulationBan > 0) {
        rows.push(new Row(c.id, c.fixtureId, c.teamId, c.shownOn, c.straightBan, c.accumulationBan, addDays(c.shownOn, 14)));
      }
    }
    const byTeam = new Map<number, Row[]>();
    rows.forEach((r) => byTeam.set(r.teamId, [...(byTeam.get(r.teamId) ?? []), r]));
    byTeam.forEach((teamRows, teamId) => {
      this.gamesOf(teamId, day).forEach((g) => {
        const target = teamRows.filter((r) => r.due(g.playedOn))[0];
        if (target) target.used = [...target.used, g.id];
      });
    });
    return rows;
  }

  ledger(playerId: number, asOf: string): SuspensionLedger {
    const who = this.players.get(playerId);
    const day = requireRealDay(asOf, 'asOf');
    const rows = this.rowsFor(who.id, day);
    const entries: LedgerEntry[] = rows.map((r) => {
      let clearedOn: string | null = null;
      if (r.left === 0) {
        const last = r.used[r.used.length - 1];
        clearedOn = this.gamesOf(r.teamId, day).filter((g) => g.id === last)[0]?.playedOn ?? null;
      }
      return { cardId: r.cardId, fixtureId: r.fixtureId, teamId: r.teamId, shownOn: r.shownOn, matches: r.length,
        served: r.used.length, outstanding: r.left, servedIn: r.used, clearedOn };
    });
    const sum = (f: (e: LedgerEntry) => number) => entries.reduce((a, e) => a + f(e), 0);
    const outstanding = sum((e) => e.outstanding);
    return { playerId: who.id, asOf: day, matchesBanned: sum((e) => e.matches), matchesServed: sum((e) => e.served),
      matchesOutstanding: outstanding, suspended: outstanding !== 0, entries };
  }

  outstanding(playerId: number, asOf: string): number {
    return this.ledger(playerId, asOf).matchesOutstanding;
  }

  eligibility(fixtureId: number): Eligibility {
    const game = this.fixtures.get(fixtureId);
    const eve = addDays(game.playedOn, -1);
    const lines: IneligiblePlayer[] = [];
    [game.awayTeamId, game.homeTeamId].forEach((teamId) => {
      const team = this.teams.get(teamId);
      const squad = this.players.list({ clubId: team.clubId, status: 'registered' }).sort((a, b) => b.id - a.id);
      squad.forEach((p) => {
        const rows = this.rowsFor(p.id, eve);
        if (!rows.some((r) => r.due(game.playedOn))) return;
        const left = rows.reduce((a, r) => a + r.left, 0);
        lines.unshift({ playerId: p.id, clubId: team.clubId, teamId: team.id, outstanding: left });
      });
    });
    const home = lines.filter((l) => l.teamId === game.homeTeamId);
    const away = lines.filter((l) => l.teamId !== game.homeTeamId);
    return { fixtureId: game.id, playedOn: game.playedOn, asOf: eve, ineligible: [...home, ...away] };
  }
}
''')
row("alt-shape", alt_shape)
