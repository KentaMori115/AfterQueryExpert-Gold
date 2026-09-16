import { calibre } from "../src/catalog/calibre.js";
import { shell } from "../src/catalog/effect.js";
import type { Cake, Effect, GroundPiece, Mine } from "../src/catalog/effect.js";
import { Catalog } from "../src/catalog/registry.js";
import { effectId, positionId } from "../src/core/ids.js";
import { Rng } from "../src/core/rng.js";
import { metres, mm, ms } from "../src/core/units.js";
import { firingModule, modelNamed } from "../src/rig/module.js";
import { Rig, firingPosition } from "../src/rig/rig.js";

/**
 * A show of any size, built to order.
 *
 * The benchmark and the large show tests both need a show far bigger than
 * anybody would type, and they need the same one every time or the numbers
 * cannot be compared between runs. So this is seeded and deterministic, and it
 * builds a show that looks like a real one rather than one statement repeated,
 * because a thousand identical ripples exercise none of the interesting paths.
 */

export interface GeneratedShow {
  readonly script: string;
  readonly catalog: Catalog;
  readonly rig: Rig;
}

const CALIBRES = [50, 75, 100, 125, 150, 200] as const;
const STYLES = ["peony", "willow", "palm", "crossette", "kamuro"] as const;

export function benchCatalog(): Catalog {
  const effects: Effect[] = [];
  for (const size of CALIBRES) {
    for (const style of STYLES) {
      effects.push(
        shell({
          id: effectId(`shell.${size}.${style}`),
          name: `${size}mm ${style}`,
          calibre: calibre(mm(size)),
          breakStyle: style,
        }),
      );
    }
  }
  const cake: Cake = {
    kind: "cake",
    id: effectId("cake.silver"),
    name: "silver cake",
    calibre: calibre(mm(30)),
    shots: 25,
    shotInterval: ms(180),
    hangTime: ms(1200),
  };
  const mine: Mine = {
    kind: "mine",
    id: effectId("mine.100"),
    name: "gold mine",
    calibre: calibre(mm(100)),
    spreadAngle: 45,
    height: metres(36),
    hangTime: ms(1900),
  };
  const gerb: GroundPiece = {
    kind: "ground",
    id: effectId("gerb.silver"),
    name: "silver gerb",
    style: "gerb",
    duration: ms(25000),
    height: metres(4),
  };
  return Catalog.from([...effects, cake, mine, gerb]);
}

export function benchRig(positions: number, modulesEach = 4): Rig {
  const model = modelNamed("slat-50");
  if (model === undefined) {
    throw new Error("the slat-50 model is missing from the module list");
  }
  const spots = Array.from({ length: positions }, (_, index) =>
    firingPosition(
      positionId(`pad.${index + 1}`),
      (index - (positions - 1) / 2) * 30,
      index % 2 === 0 ? 0 : 20,
    ),
  );
  const modules = [];
  let number = 1;
  for (const spot of spots) {
    for (let i = 0; i < modulesEach; i += 1) {
      modules.push(firingModule(number, model, spot.id));
      number += 1;
    }
  }
  return Rig.from(spots, modules);
}

export interface GenerateOptions {
  /** Roughly how many shots the show should hold. */
  readonly shots?: number;
  readonly positions?: number;
  readonly seed?: string;
}

export function generateShow(options: GenerateOptions = {}): GeneratedShow {
  const wanted = options.shots ?? 2000;
  const positions = options.positions ?? 6;
  const rng = new Rng(options.seed ?? "bench");
  const lines: string[] = ["show bench", "seed bench", "frame 25", ""];

  let shots = 0;
  let at = 2;
  while (shots < wanted) {
    const position = `pad.${rng.nextInt(1, positions)}`;
    const size = rng.pick([...CALIBRES]);
    const style = rng.pick([...STYLES]);
    const effect = `shell.${size}.${style}`;
    const roll = rng.nextFloat();
    if (roll < 0.35) {
      const count = rng.nextInt(4, 16);
      const every = rng.nextInt(90, 400);
      lines.push(
        `at ${at.toFixed(2)} ripple ${count} of ${effect} from ${position} every ${every}ms`,
      );
      shots += count;
    } else if (roll < 0.55) {
      const count = rng.nextInt(5, 12);
      const spread = rng.nextInt(500, 2000);
      lines.push(
        `at ${at.toFixed(2)} fan ${count} of ${effect} from ${position} spread ${spread}ms`,
      );
      shots += count;
    } else if (roll < 0.7) {
      const across = rng
        .sample(
          Array.from({ length: positions }, (_, i) => `pad.${i + 1}`),
          rng.nextInt(2, Math.min(4, positions)),
        )
        .join(" ");
      const passes = rng.nextInt(1, 3);
      lines.push(
        `at ${at.toFixed(2)} chase ${effect} across ${across} every ${rng.nextInt(120, 300)}ms passes ${passes}`,
      );
      shots += across.split(" ").length * passes;
    } else if (roll < 0.85) {
      lines.push(`at ${at.toFixed(2)} fire ${effect} from ${position}`);
      shots += 1;
    } else {
      const ground = rng.pick(["cake.silver", "mine.100", "gerb.silver"]);
      lines.push(`at ${at.toFixed(2)} fire ${ground} from ${position}`);
      shots += 1;
    }
    at += rng.nextFloat() * 1.4 + 0.1;
  }

  return {
    script: `${lines.join("\n")}\n`,
    catalog: benchCatalog(),
    rig: benchRig(positions, Math.ceil(wanted / positions / 45) + 1),
  };
}
