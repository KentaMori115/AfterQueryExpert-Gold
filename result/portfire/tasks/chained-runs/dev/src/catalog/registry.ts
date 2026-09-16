import type { Effect, EffectKind } from "./effect.js";
import { calibreOf, isGround } from "./effect.js";
import type { EffectId } from "../core/ids.js";
import { countBy } from "../core/collect.js";
import { compareIds, isUnder } from "../core/ids.js";
import { raw } from "../core/units.js";

/**
 * The catalog, which is the set of effects a show is allowed to reach for.
 *
 * A catalog is per crew rather than per manufacturer. Crews buy from several
 * importers, relabel everything into their own naming, and keep a house
 * catalog that outlives any one supplier. So the registry is keyed by the
 * crew's own effect names and knows nothing about where a shell came from
 * beyond an optional maker field.
 */

export interface CatalogEntry {
  readonly effect: Effect;
  /** Where the entry was read from, for a diagnostic that points at a file. */
  readonly source?: string;
}

export class Catalog {
  private readonly entries = new Map<string, CatalogEntry>();

  static from(effects: Iterable<Effect>): Catalog {
    const catalog = new Catalog();
    for (const effect of effects) {
      catalog.add(effect);
    }
    return catalog;
  }

  /** Add an effect, replacing any entry with the same name. */
  add(effect: Effect, source?: string): this {
    const entry: { effect: Effect; source?: string } = { effect };
    if (source !== undefined) {
      entry.source = source;
    }
    this.entries.set(effect.id, entry);
    return this;
  }

  get size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): Effect | undefined {
    return this.entries.get(id)?.effect;
  }

  entry(id: string): CatalogEntry | undefined {
    return this.entries.get(id);
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  ids(): EffectId[] {
    return [...this.entries.keys()].sort(compareIds) as EffectId[];
  }

  all(): Effect[] {
    return this.ids().map((id) => {
      const effect = this.entries.get(id)?.effect;
      if (effect === undefined) {
        throw new Error(`catalog lost ${id} between listing and reading`);
      }
      return effect;
    });
  }

  /** Everything under a dotted prefix, on segment boundaries. */
  under(prefix: string): Effect[] {
    return this.all().filter((effect) => isUnder(effect.id, prefix));
  }

  ofKind(kind: EffectKind): Effect[] {
    return this.all().filter((effect) => effect.kind === kind);
  }

  /**
   * Everything at or under a calibre, which is the query a site with a
   * distance limit actually asks. Ground pieces have no calibre and are
   * always included, since no separation table applies to them.
   */
  upToCalibre(sizeMm: number): Effect[] {
    return this.all().filter((effect) => {
      const size = calibreOf(effect);
      return size === undefined || raw(size.size) <= sizeMm;
    });
  }

  byMaker(maker: string): Effect[] {
    return this.all().filter((effect) => effect.maker === maker);
  }

  merge(other: Catalog): Catalog {
    const merged = new Catalog();
    for (const [id, entry] of this.entries) {
      merged.entries.set(id, entry);
    }
    for (const [id, entry] of other.entries) {
      merged.entries.set(id, entry);
    }
    return merged;
  }

  /** Names in this catalog that the other one also defines, differently. */
  conflictsWith(other: Catalog): string[] {
    const clashes: string[] = [];
    for (const [id, entry] of this.entries) {
      const theirs = other.entries.get(id);
      if (theirs !== undefined && theirs.effect !== entry.effect) {
        clashes.push(id);
      }
    }
    return clashes.sort(compareIds);
  }

  countByKind(): Map<EffectKind, number> {
    const counts = countBy(
      [...this.entries.values()],
      (entry) => entry.effect.kind,
    );
    return new Map(counts) as Map<EffectKind, number>;
  }

  /** The largest bore in the catalog, which sets the site's worst case. */
  largestCalibre(): number {
    let largest = 0;
    for (const entry of this.entries.values()) {
      if (isGround(entry.effect)) {
        continue;
      }
      const size = raw(entry.effect.calibre.size);
      if (size > largest) {
        largest = size;
      }
    }
    return largest;
  }
}
