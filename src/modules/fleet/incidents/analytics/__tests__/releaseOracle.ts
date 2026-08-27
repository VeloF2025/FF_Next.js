/**
 * An independent answer to "what can a reader work out from the published view?"
 *
 * Written against the released ROWS and the exact contributor sets the
 * calculator produced, with its own table of relations rebuilt from
 * `DENOMINATOR_OF` and the schema's key lists. It does not import
 * `metricRelations`' partitions, subsets or components: two findings against the
 * previous design were MISSING relations, and an oracle importing the model it
 * audits cannot notice one.
 *
 * Method, chosen to share as little as possible with the release rule — which
 * decides by tier and never solves anything:
 *
 * - exact `bigint` rationals, so nothing is zero by rounding;
 * - a variable or combination is disclosed when it is UNIQUELY DETERMINED,
 *   computed from the NULL space of the constraints;
 * - "the published rows are what gave it away" is a counterfactual, not a
 *   filter: the system is solved twice, once as published and once with every
 *   published value removed, and only a combination determined in the first and
 *   not the second counts;
 * - combinations of up to FOUR variables are searched, pruned by the threshold —
 *   growing a subset only grows its people, so a branch already at `k` is
 *   abandoned.
 *
 * Site variables are in the system even though site rows are never published:
 * they are exactly what a reader would most like to recover.
 */
import type { CalculatedSiteMonth } from '../metricCalculator';
import type { ReleasedAggregate } from '../suppression';
import type { Cube } from './oracleModel';
import { NAMES, at, buildCube, relationsOf } from './oracleModel';
import type { Echelon } from './exactIntegers';
import { echelon, rank, reduceAgainst } from './exactIntegers';

interface Block {
  columns: string[];
  withRows: bigint[][];
  withoutRows: bigint[][];
}

/**
 * The constraint system, split into connected blocks. Two variables no relation
 * ever mentions together cannot pin one another, and elimination is cubic.
 */
function buildBlocks(cube: Cube): Block[] {
  const columns = new Set<string>();
  for (const cell of cube.cells) {
    for (const name of NAMES) {
      // Nobody behind a variable means its value is zero in every world: known
      // to everyone, and not a column at all.
      if ((cube.support.get(at(cell, name))?.size ?? 0) > 0) columns.add(at(cell, name));
    }
  }

  const relations = relationsOf(cube).map((relation) => relation.filter((id) => columns.has(id)))
    .filter((relation) => relation.length > 0);

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const relation of relations) for (const id of relation) parent.set(find(id), find(relation[0]!));

  const grouped = new Map<string, string[]>();
  for (const id of columns) grouped.set(find(id), [...(grouped.get(find(id)) ?? []), id]);

  return [...grouped.values()].map((block) => {
    const ordered = [...block].sort();
    const index = new Map(ordered.map((id, position) => [id, position]));
    const blank = (): bigint[] => new Array<bigint>(ordered.length).fill(0n);
    const withoutRows: bigint[][] = [];
    for (const relation of relations) {
      if (!index.has(relation[0]!)) continue;
      const row = blank();
      // Written as `total = sum(parts)`; a relation that lost its total to the
      // zero-support filter still constrains the parts that remain.
      relation.forEach((id) => {
        const column = index.get(id);
        if (column === undefined) return;
        row[column] = row[column]! + (id === relation[0] ? 1n : -1n);
      });
      withoutRows.push(row);
    }
    // Publishing a value pins it, and a pinned variable is a variable that is no
    // longer there. Zeroing its column beats adding a pin row: the reduction
    // skips all-zero columns, so the system a published month is solved over is
    // much the smaller of the two.
    const published = ordered.map((id) => cube.published.has(id));
    const withRows = withoutRows.map(
      (row) => row.map((value, column) => (published[column] ? 0n : value)),
    );
    return { columns: ordered, withRows, withoutRows };
  });
}

/**
 * What is left of a variable once everything the constraints already determine
 * is taken out of it. A combination of variables is pinned exactly when their
 * leftovers are linearly dependent — the dependency IS the combination.
 *
 * The null space says the same thing and is the textbook route, but writing it
 * down costs a basis of `width - rank` vectors of `width` entries each, in exact
 * rationals, for every block of every seed. The leftovers are one reduction and
 * a handful of short vectors.
 */
function leftovers(
  rows: readonly bigint[][], width: number, columns: readonly number[],
): Map<number, bigint[]> {
  const form: Echelon = echelon(rows, width);
  return new Map(columns.map((column) => {
    const unit = new Array<bigint>(width).fill(0n);
    unit[column] = 1n;
    return [column, reduceAgainst(form, unit)];
  }));
}

/** Which connected piece each column falls in, over the rows it is joined by. */
function componentsOf(rows: readonly bigint[][], width: number): number[] {
  const parent = Array.from({ length: width }, (_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    return root;
  };
  for (const row of rows) {
    let first = -1;
    for (let column = 0; column < width; column += 1) {
      if (row[column] === 0n) continue;
      if (first === -1) { first = column; continue; }
      parent[find(column)] = find(first);
    }
  }
  return parent.map((_, index) => find(index));
}

/** How many independent combinations of `subset` the constraints pin down. */
const pinnedDimension = (left: Map<number, bigint[]>, subset: readonly number[], width: number): number =>
  subset.length - rank(subset.map((column) => left.get(column)!), width);

function subsetsUpTo(
  candidates: readonly number[], largest: number,
  peopleAt: (index: number) => ReadonlySet<string>, k: number,
): number[][] {
  const found: number[][] = [];
  for (let size = 1; size <= largest; size += 1) {
    const walk = (start: number, chosen: number[], people: Set<string>): void => {
      if (chosen.length === size) { found.push([...chosen]); return; }
      for (let index = start; index < candidates.length; index += 1) {
        const grown = new Set(people);
        for (const person of peopleAt(candidates[index]!)) grown.add(person);
        if (grown.size >= k) continue;
        chosen.push(candidates[index]!);
        walk(index + 1, chosen, grown);
        chosen.pop();
      }
    };
    walk(0, [], new Set());
  }
  return found;
}

/** How many variables a combination is searched across. See the header. */
export const LARGEST_COMBINATION = 4;

/** Every group of fewer than `k` people the published rows hand over. */
export function derivableLeaks(
  siteMonths: readonly CalculatedSiteMonth[], released: readonly ReleasedAggregate[], k: number,
): string[] {
  const cube = buildCube(siteMonths, released);
  const leaks: string[] = [];

  for (const block of buildBlocks(cube)) {
    const { columns, withRows, withoutRows } = block;
    const peopleAt = (index: number): Set<string> => cube.support.get(columns[index]!) ?? new Set();
    const small: number[] = [];
    for (let index = 0; index < columns.length; index += 1) {
      const size = peopleAt(index).size;
      if (size > 0 && size < k) small.push(index);
    }
    if (small.length === 0) continue;

    const width = columns.length;
    // Zeroing the published columns cuts the block apart again: what is left is
    // the WITHHELD variables and the relations still joining them, and on an
    // ordinary month that is a scatter of small pieces rather than one system.
    // A combination can only be pinned inside one piece, so both the elimination
    // and the search over subsets happen per piece.
    const piece = componentsOf(withRows, width);
    const pieces = new Map<number, { columns: number[]; small: number[] }>();
    for (let column = 0; column < width; column += 1) {
      const id = piece[column]!;
      const bucket = pieces.get(id) ?? { columns: [], small: [] };
      bucket.columns.push(column);
      if (small.includes(column)) bucket.small.push(column);
      pieces.set(id, bucket);
    }
    // The counterfactual is only ever consulted about a subset the published
    // rows newly pinned, and most months have none at all.
    let withoutLeft: Map<number, bigint[]> | null = null;
    const counterfactual = (): Map<number, bigint[]> => {
      withoutLeft ??= leftovers(withoutRows, width, small);
      return withoutLeft;
    };
    const minimal: number[][] = [];
    for (const [id, here] of pieces) {
      if (here.small.length === 0) continue;
      const localOf = new Map(here.columns.map((column, index) => [column, index]));
      const local = withRows
        .filter((row) => row.some((value, column) => value !== 0n && piece[column] === id))
        .map((row) => here.columns.map((column) => row[column]!));
      const withLeft = leftovers(local, here.columns.length, here.small.map((column) => localOf.get(column)!));
      const pinnedHere = (subset: readonly number[]): number => subset.length - rank(
        subset.map((column) => withLeft.get(localOf.get(column)!)!), here.columns.length,
      );

    for (const subset of subsetsUpTo(here.small, LARGEST_COMBINATION, peopleAt, k)) {
      if (minimal.some((found) => found.every((column) => subset.includes(column)))) continue;
      // Cheap gate first: unless publishing pinned something new here, there is
      // no combination to go looking for.
      // Publishing has to pin something here that the constraints alone did
      // not: a relation among withheld values is true whatever is published and
      // hands over no number.
      const pinned = pinnedHere(subset);
      if (pinned === 0 || pinned <= pinnedDimension(counterfactual(), subset, width)) continue;
      minimal.push([...subset]);
      const people = new Set<string>();
      for (const column of subset) for (const person of peopleAt(column)) people.add(person);
      const shape = subset.length === 1 ? 'recovered outright' : 'residual';
      leaks.push(`${shape}: ${subset.map((column) => columns[column]!).join(' + ')} over ${people.size} people`);
    }
    }
  }
  return [...new Set(leaks)].sort();
}
