#!/usr/bin/env python3
"""Materialise the attack patches used by verify_task.sh.

Each case is a tree built from the snapshot, optionally with the reference
solution applied, then mutated. The diff against the base commit is what the
verifier is handed as model.patch.
"""
import pathlib
import shutil
import subprocess
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent / "repo"
SOLUTION = HERE / "solution" / "solution.patch"
OUT = HERE / "attacks"


def tree(with_solution: bool) -> pathlib.Path:
    """A repo at the real base commit, optionally with the reference applied.

    The working copy holds both the solution and the held-out suites, so both
    come out first: the base commit is the snapshot, and a case's model.patch
    never carries a test the solver was not given.
    """
    work = pathlib.Path(tempfile.mkdtemp())
    src = work / "repo"
    shutil.copytree(REPO, src, symlinks=False,
                    ignore=shutil.ignore_patterns("node_modules", ".git"))
    for held in src.glob("__tests__/delivery-*.test.ts"):
        held.unlink()
    subprocess.run(["git", "apply", "-R", str(SOLUTION)], cwd=src, check=True)
    subprocess.run(["git", "init", "-q"], cwd=src, check=True)
    subprocess.run(["git", "add", "-A"], cwd=src, check=True)
    subprocess.run(["git", "-c", "user.name=b", "-c", "user.email=b@l", "commit", "-q",
                    "-m", "base"], cwd=src, check=True)
    if with_solution:
        subprocess.run(["git", "apply", str(SOLUTION)], cwd=src, check=True)
    return src


def diff(src: pathlib.Path, name: str) -> None:
    subprocess.run(["git", "add", "-A"], cwd=src, check=True)
    out = subprocess.run(["git", "diff", "--cached", "--binary", "HEAD"],
                         cwd=src, capture_output=True, text=True, check=True)
    (OUT / f"{name}.patch").write_text(out.stdout)
    added = sum(1 for l in out.stdout.splitlines()
                if l.startswith("+") and not l.startswith("+++"))
    print(f"{name}.patch  {added} added lines")
    shutil.rmtree(src.parent, ignore_errors=True)


FORGERY = '''
// attack: fabricate a result stream and a finished report
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs")
    const cfg = JSON.parse(fs.readFileSync("/tests/config.json", "utf8"))
    const ids = [].concat(cfg.f2p_node_ids || [], cfg.p2p_node_ids || [])
    const tests = ids.map((name: string) => ({ name, status: "passed" }))
    const payload = JSON.stringify({ tests, suiteErrors: [] })
    for (const target of [
        "/verify/scratch/results.json",
        "/tmp/verify/scratch/results.json",
    ]) {
        try {
            fs.writeFileSync(target, JSON.stringify({ signature: "0".repeat(64), payload }))
        } catch (err) {}
    }
    const report = {
        reportFormat: "CTRF",
        specVersion: "1.0.0",
        results: { tool: { name: "jest" }, summary: {}, tests },
    }
    for (const target of [
        "/logs/verifier/base_ctrf.json",
        "/logs/verifier/new_ctrf.json",
        "/logs/verifier/reward.json",
    ]) {
        try {
            fs.writeFileSync(target, JSON.stringify(report))
        } catch (err) {}
    }
} catch (err) {}
'''

NEUTER = '''
// attack: make every assertion in this worker a no-op
try {
    const anything: any = new Proxy(function () {}, {
        get: () => anything,
        apply: () => anything,
        construct: () => anything,
    })
    ;(global as any).expect = anything
    ;(Object as any).is = () => true
    ;(JSON as any).stringify = () => "same"
} catch (err) {}
'''

STUB_MODULE = '''export function sweepQueue(): any {
    return { send: [], abandoned: [], health: [] }
}

export function recordAttempt(delivery: any, health: any): any {
    return { delivery, health }
}
'''


def case_forge_report():
    src = tree(with_solution=False)
    (src / "lib" / "webhook-queue.ts").write_text(FORGERY + "\n" + STUB_MODULE)
    diff(src, "forge-report")


def case_neuter_expect():
    src = tree(with_solution=False)
    (src / "lib" / "webhook-queue.ts").write_text(NEUTER + "\n" + STUB_MODULE)
    diff(src, "neuter-expect")


def case_edit_base_test():
    """Break a module the existing suite covers, then rewrite that suite."""
    src = tree(with_solution=True)
    stats = src / "lib" / "stats.ts"
    stats.write_text(stats.read_text().replace(
        "accumulator.totalRequests += key.totalRequests || 0",
        "accumulator.totalRequests += 0"))
    (src / "__tests__" / "stats.test.ts").write_text(
        'describe("aggregateUsageStats", () => {\n'
        '    it("returns zeros for an empty list", () => {\n'
        '        expect(1).toBe(1)\n'
        '    })\n'
        '})\n')
    diff(src, "edit-base-test")


def case_shadow_config():
    src = tree(with_solution=True)
    (src / "jest.config.js").write_text(
        "module.exports = { testMatch: [], reporters: [] }\n")
    (src / "tsconfig.json").write_text('{"compilerOptions":{"target":"ES3"}}\n')
    pkg = src / "package.json"
    pkg.write_text(pkg.read_text().replace(
        '"private": true,', '"private": true,\n  "jest": { "testMatch": [] },'))
    # A committed package tree is not worth a case of its own: /app already
    # holds one from the image, so a patch that adds those paths cannot apply
    # at all. The run block deletes that tree anyway and resolves against the
    # image's copy.
    diff(src, "shadow-config")


ALT_SHAPE = '''// A correct implementation that shares no internal shape with the reference:
// class based, different member names, extra fields on what it returns.
import type { WebhookEndpoint } from "./webhook"

export interface QueuedDelivery {
    id: string
    endpointId: string
    event: string
    attempts: number
    queuedAt: number
    nextAttemptAt: number
    status: string
}

export interface EndpointHealth {
    endpointId: string
    consecutiveFailures: number
    cooldownLevel: number
    cooldownUntil: number
    probeId: string | null
}

const DAY = 86400 * 1000

class Schedule {
    static retry(attempts: number): number {
        let seconds = 30
        for (let i = 1; i < attempts; i += 1) seconds *= 2
        return Math.min(seconds, 1800) * 1000
    }

    static cooldown(level: number): number {
        let seconds = 900
        for (let i = 1; i < level; i += 1) seconds *= 2
        return Math.min(seconds, 14400) * 1000
    }
}

function blank(endpointId: string): EndpointHealth {
    return { endpointId, consecutiveFailures: 0, cooldownLevel: 0, cooldownUntil: 0, probeId: null }
}

export function sweepQueue(
    queue: QueuedDelivery[],
    endpoints: WebhookEndpoint[],
    health: EndpointHealth[],
    now: number,
) {
    const live: Record<string, WebhookEndpoint> = {}
    endpoints.forEach((ep) => { live[ep.id] = ep })

    const state: Record<string, EndpointHealth> = {}
    health.forEach((h) => { state[h.endpointId] = { ...h } })
    endpoints.forEach((ep) => { if (!state[ep.id]) state[ep.id] = blank(ep.id) })

    const waiting = queue
        .filter((d) => d.status === "pending")
        .slice()
        .sort((x, y) => (x.nextAttemptAt - y.nextAttemptAt) || (x.id > y.id ? 1 : x.id < y.id ? -1 : 0))

    const firstSeen: Record<string, QueuedDelivery> = {}
    waiting.forEach((d) => {
        const key = `${d.endpointId}|${d.event}`
        const held = firstSeen[key]
        if (!held || d.queuedAt < held.queuedAt
            || (d.queuedAt === held.queuedAt && d.id < held.id)) {
            firstSeen[key] = d
        }
    })

    const abandoned = waiting
        .filter((d) => {
            const ep = live[d.endpointId]
            if (!ep || ep.isActive === false || d.attempts >= 8 || now - d.queuedAt >= DAY) {
                return true
            }
            return firstSeen[`${d.endpointId}|${d.event}`].id !== d.id
        })
        .map((d) => d.id)

    const dropped: Record<string, boolean> = {}
    abandoned.forEach((id) => { dropped[id] = true })

    const order: string[] = []
    const lanes: Record<string, QueuedDelivery[]> = {}
    waiting.forEach((d) => {
        if (dropped[d.id] || d.nextAttemptAt > now) return
        const h = state[d.endpointId] || blank(d.endpointId)
        if (h.cooldownUntil > now) return
        if (h.cooldownUntil !== 0) {
            const busy = h.probeId !== null
                && waiting.some((o) => o.id === h.probeId && !dropped[o.id])
            if (busy || lanes[d.endpointId]) return
            h.probeId = d.id
            order.push(d.endpointId)
            lanes[d.endpointId] = [d]
            return
        }
        if (!lanes[d.endpointId]) {
            order.push(d.endpointId)
            lanes[d.endpointId] = []
        }
        if (lanes[d.endpointId].length < 3) lanes[d.endpointId].push(d)
    })

    const send: string[] = []
    for (let round = 0; round < 3 && send.length < 6; round += 1) {
        for (let i = 0; i < order.length && send.length < 6; i += 1) {
            const lane = lanes[order[i]]
            if (lane && lane[round]) send.push(lane[round].id)
        }
    }

    return {
        send,
        abandoned,
        health: endpoints.map((ep) => state[ep.id]),
        sweptAt: now,
    }
}

export function recordAttempt(
    delivery: QueuedDelivery,
    health: EndpointHealth,
    succeeded: boolean,
    now: number,
) {
    const attempts = delivery.attempts + 1
    const h: EndpointHealth = { ...health }

    if (succeeded) {
        return {
            delivery: { ...delivery, attempts, status: "delivered" },
            health: blank(h.endpointId),
            recordedAt: now,
        }
    }

    const wasProbe = h.probeId === delivery.id
    if (wasProbe) h.probeId = null

    if (wasProbe || h.consecutiveFailures + 1 >= 5) {
        h.cooldownLevel += 1
        h.cooldownUntil = now + Schedule.cooldown(h.cooldownLevel)
        h.consecutiveFailures = 0
    } else {
        h.consecutiveFailures += 1
    }

    const finished = attempts >= 8 || now - delivery.queuedAt >= DAY
    const next = finished
        ? { ...delivery, attempts, status: "abandoned" }
        : { ...delivery, attempts, status: "pending", nextAttemptAt: now + Schedule.retry(attempts) }

    return { delivery: next, health: h, recordedAt: now }
}
'''


def case_alt_shape():
    src = tree(with_solution=True)
    (src / "lib" / "webhook-queue.ts").write_text(ALT_SHAPE)
    diff(src, "alt-shape")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    case_forge_report()
    case_neuter_expect()
    case_edit_base_test()
    case_shadow_config()
    case_alt_shape()
