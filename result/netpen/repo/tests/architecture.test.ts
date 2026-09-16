import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Fitness functions.
 *
 * The rules a reviewer cannot be expected to check by eye on every change, and
 * which are precisely the ones somebody breaks without noticing. They read the
 * source directly rather than the module graph, because what they guard
 * against is an import added without thinking, and a cleverer check is one
 * that gets skipped.
 *
 * There is a second reason for the clock rule in particular. Everything in the
 * domain takes the instant it acts on, which is what lets a test pin the date
 * and get the same answer forever. One Date.now buried in a growth projection
 * would make the whole suite quietly time dependent.
 */

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), '..');

function sourceFiles(directory: string, extensions = /\.(ts|vue)$/): string[] {
  const found: string[] = [];

  function walk(current: string): void {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (extensions.test(entry)) found.push(path);
    }
  }

  walk(join(ROOT, directory));
  return found;
}

const read = (path: string): string => readFileSync(path, 'utf8');

function importsIn(source: string): string[] {
  return [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]!);
}

describe('the domain stands on its own', () => {
  const files = sourceFiles('src/domain');

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it('imports nothing from the app, data or ui layers', () => {
    for (const file of files) {
      for (const specifier of importsIn(read(file))) {
        expect(
          specifier.startsWith('@/app') ||
            specifier.startsWith('@/data') ||
            specifier.startsWith('@/ui'),
          `${relative(ROOT, file)} imports ${specifier}`,
        ).toBe(false);
      }
    }
  });

  it('pulls in no third party runtime dependency at all', () => {
    for (const file of files) {
      for (const specifier of importsIn(read(file))) {
        const bare = !specifier.startsWith('.') && !specifier.startsWith('@/');
        expect(bare, `${relative(ROOT, file)} imports ${specifier}`).toBe(false);
      }
    }
  });

  it('never reads the clock', () => {
    for (const file of files) {
      const source = read(file);
      expect(source.includes('Date.now()'), `${relative(ROOT, file)} reads the clock`).toBe(false);
      expect(/new Date\(\s*\)/.test(source), `${relative(ROOT, file)} reads the clock`).toBe(false);
    }
  });

  it('has no Vue in it', () => {
    for (const file of files) {
      expect(file.endsWith('.vue')).toBe(false);
      expect(read(file).includes("from 'vue'")).toBe(false);
    }
  });
});

describe('every domain module carries an explanation', () => {
  it('opens with a block comment rather than straight into code', () => {
    for (const file of sourceFiles('src/domain')) {
      const head = read(file).trimStart();
      expect(head.startsWith('/**'), `${relative(ROOT, file)} has no header comment`).toBe(true);
    }
  });
});

describe('the screens keep off the layers below them', () => {
  const views = sourceFiles('src/views');

  it('has screens to check', () => {
    expect(views.length).toBeGreaterThan(20);
  });

  /**
   * A screen reading a fixture directly is a screen that works in the
   * demonstration build and breaks against a real site. Everything comes
   * through the projections and the API port, which is the seam the whole
   * thing is swapped at.
   */
  it('never reaches into the fixture data', () => {
    for (const file of views) {
      const offending = importsIn(read(file)).filter((name) => /^@\/data\/fixtures/.test(name));
      // Types are allowed through: a screen naming the shape of a reading is
      // not the same as a screen manufacturing one.
      const values = offending.filter(
        (name) => !new RegExp(`import type[^;]*from '${name}'`).test(read(file)),
      );
      expect(values, `${relative(ROOT, file)} imports fixture data`).toEqual([]);
    }
  });

  it('never builds its own local API', () => {
    for (const file of views) {
      expect(
        importsIn(read(file)).some((name) => name.includes('localApi')),
        `${relative(ROOT, file)} builds an api of its own`,
      ).toBe(false);
    }
  });

  /**
   * The shared pieces under ui may name a domain type, since a tone map has to
   * be exhaustive over the states it colours and the compiler is what keeps it
   * that way. What they may not do is pull in domain behaviour: a chart that
   * calls a lice threshold cannot be reused for oxygen, and it puts a
   * regulatory rule somewhere nobody will look for it.
   */
  it('names domain types but does not run domain rules', () => {
    const allowed = /^@\/domain\/(lice\/thresholds|time\/duration|units\/)/;

    for (const file of sourceFiles('src/ui')) {
      const source = read(file);
      const reaching = importsIn(source)
        .filter((name) => name.startsWith('@/domain/') && !allowed.test(name))
        .filter((name) => !new RegExp(`import type[^;]*from '${name}'`).test(source));
      expect(reaching, `${relative(ROOT, file)} runs a domain rule`).toEqual([]);
    }
  });

  it('leaves the clock to the app layer, so a pinned screen stays pinned', () => {
    for (const file of [...views, ...sourceFiles('src/ui')]) {
      const source = read(file);
      expect(/Date\.now\(\)/.test(source), `${relative(ROOT, file)} reads the clock`).toBe(false);
    }
  });
});

describe('the tests mirror the source', () => {
  it('has a test file for every domain module', () => {
    const modules = sourceFiles('src/domain')
      .map((file) => relative(join(ROOT, 'src/domain'), file).replace(/\.ts$/, ''))
      .filter((name) => name !== 'ids');
    const tests = new Set(
      sourceFiles('tests/domain', /\.test\.ts$/).map((file) =>
        relative(join(ROOT, 'tests/domain'), file).replace(/\.test\.ts$/, ''),
      ),
    );

    const untested = modules.filter((name) => !tests.has(name));
    expect(untested, `untested domain modules: ${untested.join(', ')}`).toEqual([]);
  });

  it('has a test file for every screen', () => {
    const screens = sourceFiles('src/views', /View\.vue$/).map((file) =>
      relative(join(ROOT, 'src/views'), file).replace(/\.vue$/, ''),
    );
    const tests = new Set(
      sourceFiles('tests/views', /\.test\.ts$/).map((file) =>
        relative(join(ROOT, 'tests/views'), file).replace(/\.test\.ts$/, ''),
      ),
    );

    const untested = screens.filter((name) => !tests.has(name));
    expect(untested, `untested screens: ${untested.join(', ')}`).toEqual([]);
  });

  it('keeps every test under the tests directory', () => {
    for (const file of sourceFiles('src')) {
      expect(/\.(test|spec)\./.test(file), `${relative(ROOT, file)} is a test inside src`).toBe(
        false,
      );
    }
  });
});
