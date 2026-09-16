import { planAdventuringDay } from '../src/core/rules/day-plan'
import { emptyConditionState } from '../src/core/rules/conditions'

const at = (xp: number, active: string[] = [], exhaustion = 0) => ({
  xp,
  state: { active: active as never, exhaustion: exhaustion as never },
})
const party = [
  { id: 'brann', ...at(290) },
  { id: 'sela', ...at(290) },
  { id: 'oskar', ...at(290) },
  { id: 'wren', ...at(290) },
]
const slate = [
  { id: 'gate-watch', monsterXps: [200, 200] },
  { id: 'rat-nest', monsterXps: [50] },
  { id: 'sewer-run', monsterXps: [50] },
]
console.log(JSON.stringify(planAdventuringDay({ party, slate }), null, 1))
void emptyConditionState
