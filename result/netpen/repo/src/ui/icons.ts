/**
 * Icons.
 *
 * Hand drawn on a twenty unit grid rather than pulled from a set, because the
 * application needs about a dozen and half of them - a pen, a louse, a feed
 * pellet, a well boat - do not exist in any general purpose icon set. Each is
 * a list of path commands so a single component can render any of them and
 * everything strokes with currentColor.
 */

export type IconName =
  | 'pen'
  | 'fish'
  | 'louse'
  | 'pellet'
  | 'scales'
  | 'thermometer'
  | 'droplet'
  | 'alert'
  | 'settings'
  | 'boat'
  | 'chevron'
  | 'check'
  | 'cross'
  | 'clock';

export interface IconShape {
  /** Stroked path commands. */
  readonly paths: readonly string[];
  /** Filled circles, for the small solid details. */
  readonly dots?: readonly (readonly [number, number, number])[];
}

export const ICONS: Record<IconName, IconShape> = {
  // A pen seen from above: the collar, with the net converging below it.
  pen: {
    paths: ['M10 3.4a6.6 3 0 1 0 0 6 6.6 3 0 1 0 0-6', 'M3.6 7.4 8 16.6h4l4.4-9.2'],
  },
  fish: {
    paths: [
      'M2.6 10c3-3.4 7.4-4.6 10.8-3.2l3.9-2.2-1.3 5.4 1.3 5.4-3.9-2.2C10 14.6 5.6 13.4 2.6 10z',
    ],
    dots: [[6.4, 9.2, 0.75]],
  },
  // A louse: the carapace and the two egg strings that make it an adult female.
  louse: {
    paths: ['M10 4.2a3.4 4 0 1 0 0 8 3.4 4 0 1 0 0-8', 'M8.7 12.2 7.9 17', 'M11.3 12.2l.8 4.8'],
  },
  pellet: {
    paths: [
      'M5.2 7.6h9.6a1.4 1.4 0 0 1 1.4 1.4v2a1.4 1.4 0 0 1-1.4 1.4H5.2a1.4 1.4 0 0 1-1.4-1.4v-2a1.4 1.4 0 0 1 1.4-1.4z',
    ],
  },
  scales: {
    paths: [
      'M10 3.4v13.2',
      'M4.6 16.6h10.8',
      'M3 8.4h14',
      'M3 8.4 5.4 13h-4.8z',
      'M17 8.4 19.4 13h-4.8z',
    ],
  },
  thermometer: {
    paths: ['M8 11.6V4.4a2 2 0 0 1 4 0v7.2a3.6 3.6 0 1 1-4 0z', 'M10 7.6v5'],
  },
  droplet: {
    paths: ['M10 3.2c2.8 3.4 4.6 5.8 4.6 8.1a4.6 4.6 0 1 1-9.2 0c0-2.3 1.8-4.7 4.6-8.1z'],
  },
  alert: {
    paths: ['M10 3.2 2.6 16.4h14.8z', 'M10 8v3.6'],
    dots: [[10, 13.9, 0.85]],
  },
  settings: {
    paths: [
      'M10 7.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 1 0 0-5.2',
      'M10 2.6v2M10 15.4v2M2.6 10h2M15.4 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4',
    ],
  },
  // A well boat, which is how fish leave the site.
  boat: {
    paths: ['M2.6 12.6h14.8l-1.8 4H4.4z', 'M5.4 12.6V7h9.2v5.6', 'M10 7V3.6'],
  },
  chevron: { paths: ['M7.6 4 13 10l-5.4 6'] },
  check: { paths: ['M4 10.4 8 14.6 16 5.4'] },
  cross: { paths: ['M5 5l10 10M15 5 5 15'] },
  clock: { paths: ['M10 3.6a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 1 0 0-12.8', 'M10 6.4V10l2.6 1.6'] },
};

export function iconNames(): IconName[] {
  return Object.keys(ICONS) as IconName[];
}
