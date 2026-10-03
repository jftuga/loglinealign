/** Sort complete entry blocks without disturbing their internal lines. Ties retain input order in both directions. */
import type { Entry } from './types';

export function mergeEntries(groups: readonly Entry[][], reverse = false): Entry[] {
  return groups.flat().sort((a, b) => {
    const time = a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    return (reverse ? -time : time) || a.source.order - b.source.order || a.line - b.line;
  });
}
