// Verifier reporter. Lives outside /app, runs in the jest parent process, and
// is the only thing that writes a result stream.
//
// The parent reads a per-run token from stdin before any worker starts, so the
// submitted code, which only ever runs inside a worker, cannot learn it: the
// descriptor is at EOF by the time a worker inherits it. Results are signed
// with that token, and the root-side publisher refuses anything it cannot
// verify. Forging the stream therefore needs the token, and overwriting the
// signed file after the fact only breaks the signature.
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const OUT = process.env.VERIFY_RESULTS || "/verify/scratch/results.json"

function readToken() {
    try {
        return fs.readFileSync(0, "utf8").trim()
    } catch (err) {
        return ""
    }
}

function idOf(filePath, assertion) {
    const rel = path.relative("/app", filePath) || filePath
    const parts = (assertion.ancestorTitles || []).concat([assertion.title || ""])
    return `${rel} > ${parts.filter((p) => p !== "").join(" > ")}`
}

function statusOf(assertion) {
    const raw = String(assertion.status || "")
    if (raw === "passed") return "passed"
    if (raw === "pending" || raw === "skipped" || raw === "todo" || raw === "disabled") {
        return "skipped"
    }
    return "failed"
}

class VerifierReporter {
    constructor() {
        this.token = readToken()
        this.tests = []
        this.suiteErrors = []
    }

    onTestResult(_test, result) {
        for (const assertion of result.testResults || []) {
            const entry = { name: idOf(result.testFilePath, assertion), status: statusOf(assertion) }
            if (entry.status !== "passed") {
                entry.message = (assertion.failureMessages || []).join("\n").slice(0, 4000)
            }
            this.tests.push(entry)
        }
        if (result.testExecError || (result.failureMessage && !(result.testResults || []).length)) {
            const rel = path.relative("/app", result.testFilePath) || result.testFilePath
            this.suiteErrors.push({
                file: rel,
                message: String(result.failureMessage || result.testExecError.message || "").slice(0, 4000),
            })
        }
    }

    onRunComplete() {
        const body = { tests: this.tests, suiteErrors: this.suiteErrors }
        const payload = JSON.stringify(body)
        const signature = this.token
            ? crypto.createHmac("sha256", this.token).update(payload).digest("hex")
            : ""
        fs.mkdirSync(path.dirname(OUT), { recursive: true })
        fs.writeFileSync(OUT, JSON.stringify({ signature, payload }))
    }
}

module.exports = VerifierReporter
