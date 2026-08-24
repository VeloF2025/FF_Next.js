/**
 * An INDEPENDENT answer to "what can a reader work out from these rows?" —
 * different question shape, different arithmetic, different relation table.
 *
 * ## Why it is written this way
 *
 * The first version of this oracle shared four things with the code it audits:
 * the same pre-filter on unanchored relations, inspection of the elimination
 * basis only, union-of-support as the residual, and a 1e-9 float tolerance. Four
 * shared assumptions is not an audit, it is a second opinion from the same
 * person. So:
 *
 * - **Arithmetic.** Exact `bigint` rationals (`exactFractions.ts`). Nothing
 *   rounds.
 * - **Question.** Production asks which combinations its elimination basis
 *   leaves exposed. This asks, of each candidate combination, whether it is
 *   UNIQUELY DETERMINED — computed from the NULL SPACE, not the row space: a
 *   combination `c` is determined exactly when it is orthogonal to every
 *   solution the constraints still permit.
 * - **Anchoring.** Not a filter, a COUNTERFACTUAL. The whole system is solved
 *   twice: once as published, and once with every published row taken away. A
 *   combination counts as disclosed only if it is determined in the first and
 *   not in the second — which is what "the published rows gave this away"
 *   actually means, and which no filter applied before elimination can express.
 * - **Reach.** Beyond single variables, every subset of up to three withheld
 *   CELLS whose people number fewer than k is tested directly, so the answer is
 *   not confined to whatever basis an elimination happened to produce.
 * - **Relations.** Built from `metricCalculator`'s own denominator table and the
 *   schema key lists. It never imports `metricPartitions.ts`. The point of the
 *   exercise: one blocking finding was a MISSING relation, and an oracle
 *   importing the model it audits cannot notice one.
 *
 * ## What this actually guarantees
 *
 * Complete for SINGLE variables — every metric cell, every partition total,
 * every subset complement — which is the classic disclosure and the shape all
 * three reproduced attacks took.
 *
 * For COMBINATIONS it is complete over two and three withheld cells whose
 * combined support is under the threshold. Two bounds on that, both deliberate:
 *
 * - Four or more cells added together are not enumerated. No such shape has been
 *   observed; it is a bound on the search, not a claim that none exists.
 * - Combinations are drawn from real cells, not from the `@rest:` complements.
 *   Those are checked individually, where their support means something; summed
 *   together it stops meaning anything, because a complement's support is a
 *   bound and several of them can add up to a quantity whose real group is far
 *   larger than the union of their bounds.
 */
import type { CalculatedMetricGroup } from '../facts';
import type { ReleasedAggregate } from '../suppression';
import type { Fraction } from './exactFractions';
import { ONE, ZERO, fraction, nullSpace, rankOver } from './exactFractions';
import type { Cube } from './oracleRelations';
import { SUM_TOTAL, VARIABLE_NAMES, at, buildCube, relationsOf } from './oracleRelations';

interface System {
  columns: string[];
  /** Solved as published. */
  withRows: Fraction[][];
  /** Solved with every published row taken away — the counterfactual. */
  withoutRows: Fraction[][];
}

function buildSystem(cube: Cube): System {
  // A variable nobody is behind has value zero in every world, so it is known in
  // both and is not a column at all.
  const columns: string[] = [];
  for (const cell of cube.cells) {
    for (const name of VARIABLE_NAMES) {
      if ((cube.support.get(at(cell, name))?.size ?? 0) > 0) columns.push(at(cell, name));
    }
  }
  const index = new Map(columns.map((id, position) => [id, position]));
  const blank = (): Fraction[] => new Array<Fraction>(columns.length).fill(ZERO);

  const withoutRows: Fraction[][] = [];
  for (const relation of relationsOf(cube)) {
    const row = blank();
    let touched = false;
    relation.forEach((id, position) => {
      const column = index.get(id);
      if (column === undefined) return;
      row[column] = fraction(row[column]!.numerator + (position === SUM_TOTAL ? 1n : -1n));
      touched = true;
    });
    if (touched) withoutRows.push(row);
  }

  const withRows = withoutRows.map((row) => [...row]);
  for (const id of cube.stated) {
    const column = index.get(id);
    if (column === undefined) continue;
    const pin = blank();
    pin[column] = ONE;
    withRows.push(pin);
  }

  return { columns, withRows, withoutRows };
}

/**
 * How many independent combinations supported on `subset` the constraints pin
 * down. A combination is pinned exactly when it is orthogonal to every solution
 * the constraints still permit, so the space of pinned combinations is the
 * orthogonal complement of the null space restricted to those columns.
 */
const pinnedDimension = (basis: readonly Fraction[][], subset: readonly number[]): number =>
  subset.length - rankOver(basis, subset);

/**
 * Subsets in order of SIZE, smallest first. The order is load-bearing: a
 * superset of a disclosing subset discloses too, and only a size-ordered walk
 * lets the minimality test below see the small one first. Depth-first order
 * reported `{A, rest, confirmed}` as minimal when the pair `{rest, confirmed}`
 * subsumed it — and that pair covered enough people to be no leak at all.
 */
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
        // Growing a subset only grows its people, so a branch already at the
        // threshold can never come back under it — and a subset at or above the
        // threshold is not a disclosure. Without this prune a month with sixty
        // small withheld cells is thirty-odd thousand triples.
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

/**
 * Every group of fewer than `k` people the released rows hand over, as readable
 * strings. Empty means nothing below the threshold is recoverable.
 */
export function derivableLeaks(
  groups: readonly CalculatedMetricGroup[], released: readonly ReleasedAggregate[], k: number,
): string[] {
  const cube = buildCube(groups, released);
  const { columns, withRows, withoutRows } = buildSystem(cube);
  if (columns.length === 0) return [];

  const withBasis = nullSpace(withRows, columns.length);
  const withoutBasis = nullSpace(withoutRows, columns.length);

  const peopleAt = (column: number): Set<string> => cube.support.get(columns[column]!) ?? new Set();
  const small: number[] = [];
  for (let column = 0; column < columns.length; column += 1) {
    const size = peopleAt(column).size;
    if (size > 0 && size < k) small.push(column);
  }
  // Combinations are drawn from real withheld cells only; the `@rest:` phantoms
  // are checked one at a time. A phantom's people are a BOUND, and adding
  // bounds together stops meaning anything: the three rests of one presence
  // partition sum to twice its total, so their supports union to less than the
  // total's while the quantity they pin down is the total itself. Judging that
  // as a four-person disclosure is an artefact of how it was written down, not a
  // fact about anyone. A phantom recovered on its own is a different matter, and
  // that is the case a real finding took — so size one still sees them all.
  const cells = small.filter((column) => !columns[column]!.includes('#@rest:'));

  // Publishing pinned a combination supported here that it did not pin before.
  const disclosed = (subset: readonly number[]): boolean =>
    pinnedDimension(withBasis, subset) > pinnedDimension(withoutBasis, subset);

  const leaks: string[] = [];
  const minimal: number[][] = [];
  const combinations = subsetsUpTo(cells, 3, peopleAt, k).filter((subset) => subset.length > 1);
  for (const subset of [...small.map((column) => [column]), ...combinations]) {
    if (!disclosed(subset)) continue;
    // MINIMAL subsets only. Every superset of a disclosing subset discloses too,
    // and reporting those would bury the finding under its own supersets — and
    // would judge the group by variables that are not in the combination at all.
    if (minimal.some((found) => found.every((column) => subset.includes(column)))) continue;
    minimal.push([...subset]);
    const people = new Set<string>();
    for (const column of subset) for (const person of peopleAt(column)) people.add(person);
    if (people.size === 0 || people.size >= k) continue;
    const shape = subset.length === 1 ? 'recovered outright' : 'residual';
    leaks.push(`${shape}: ${subset.map((column) => columns[column]!).join(' + ')} over ${people.size} people`);
  }
  return [...new Set(leaks)].sort();
}
