# Sagemark

A local-first campaign manager for tabletop RPGs. Vue 3, Pinia, Tailwind. No server, no signup, your data lives in the browser.

I built this over about fifteen months for my own home games, and it has slowly grown to cover most of what comes up at the table.

## What it covers

- **Campaigns, cast, factions, places** — the usual long-form RPG ledger
- **Sessions, arcs, encounters, relationships** — what is happening this week and how the threads connect
- **Lore, items, quests, timeline** — the world you keep notes in
- **Tags, notes, backlinks** — cross-cutting threads with `[[Name]]` mentions auto-resolved
- **Dice, initiative, conditions, spell slots, coin** — the per-PC tools I kept wishing I had
- **Generators** — NPCs, taverns, streets, rumors, trinkets, reactions and morale, all seeded
- **Travel and weather** — climate plus season plus pace, with a rough day estimate
- **Prep checklist, recap, pulse, treasury, downtime, party manager** — the things I do between sessions
- **Map plot, holidays, rule snippets, GM journal** — quality-of-life bits
- **Backup and import** — JSON v2 bundles, CSV character import

## Run it

```
npm install
npm run dev
```

## Test

```
npx vitest run
npx vue-tsc --noEmit
```

Specs live next to the source files (`*.spec.ts`). Core domain logic and rules are covered the hardest, components and pages get lighter coverage.

## Layout

```
src/
  core/        types, models, services, persistence, rules
  features/    one folder per area, each with store + components + pages
  ui/          shared primitives and the app shell
  router/      route map
  styles/      tailwind plus a thin custom layer
```

## Persistence

Everything is in `localStorage` under the `sagemark:` prefix. Use the backup page to export a campaign as JSON or to inspect a bundle before importing. The data structure is versioned: v1 is the original, v2 adds notes, tags, holidays, downtime and the treasury purse.

## Why local-first

Because tables are quiet places. I do not want a login, a sync conflict, a 'free tier expired' email, or a friend's session disrupted by a server going down. If you want to share, export a file.

## Known follow ups

A few spots in the code carry `TODO` notes I have not gotten around to. Most are about hardening the JSON layer for an eventual sync mode, not about the current single-device experience.

## Contributing

This is a personal project, but if you spot a clear bug or want to send a small PR, the bar is: tests pass, `vue-tsc --noEmit` is clean, no new third-party deps without a real reason. The codebase leans on a few patterns I'm fond of (services + pinia stores wrapping them, branded ID types, eager localStorage writes inside mutations) — try to match the style of the file you're editing.

## License

MIT.
