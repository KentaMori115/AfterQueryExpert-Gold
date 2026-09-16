import { readFileSync } from 'node:fs'
const { planRangedResponse } = await import(process.env.APP + '/lib/range-plan.ts')
const jobs = JSON.parse(readFileSync(0, 'utf8'))
const out = []
for (const job of jobs) out.push(planRangedResponse(job.manifest, job.header, job.boundary))
process.stdout.write(JSON.stringify(out))
