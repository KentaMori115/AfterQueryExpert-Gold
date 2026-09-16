import { readFileSync } from 'node:fs'
import { planAdventuringDay } from '../src/core/rules/day-plan'

const scenarios = JSON.parse(readFileSync(0, 'utf8'))
const out = scenarios.map((s: any) => planAdventuringDay(s))
process.stdout.write(JSON.stringify(out))
