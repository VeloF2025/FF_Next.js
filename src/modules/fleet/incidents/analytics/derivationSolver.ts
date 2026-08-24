/**
 * The linear algebra behind `derivability.ts`, and nothing about fleet metrics.
 *
 * Two things live here. Reduced row echelon form, carrying each row's anchors
 * through the combinations so the caller keeps track of which published rows a
 * derivation rests on. And the question that is actually asked of the reduced
 * system: given a handful of withheld variables, can the reader pin down SOME
 * combination of exactly those?
 *
 * That second question is answered through LEFTOVERS. Take a variable's unit
 * vector, subtract everything the reduced rows already determine, and what
 * remains is the part of it the reader cannot reach. A combination of several
 * variables is pinned exactly when their leftovers are linearly dependent — the
 * dependency IS the combination that falls entirely inside the row space.
 * Computing leftovers once per variable and then asking about three vectors at a
 * time is what makes a search over pairs and triples affordable; stacking the
 * whole reduced system against each subset in turn gives the same answer and is
 * far too slow to run inside a repair loop.
 */

export const TOLERANCE = 1e-9;

/** How many withheld cells a residual is looked for across. See the header. */
export const LARGEST_COMBINATION = 3;

export const copyRow = (row: EliminationRow): EliminationRow => ({
  coefficients: [...row.coefficients], anchors: new Set(row.anchors),
});

/**
 * Candidates, smallest first: every withheld variable on its own, then every
 * pair and triple of withheld CELLS whose people still number fewer than `k`.
 *
 * The threshold prunes the walk rather than filtering its output, and it has to:
 * a month with sixty small withheld cells has thirty-odd thousand triples, and
 * the search runs again after every row the repair loop gives up. Growing a
 * subset only ever grows its people, so a branch that has already reached `k`
 * can never come back under it and is abandoned there. Nothing is lost —
 * a subset at or above the threshold is not a disclosure, and neither is
 * anything containing it.
 *
 * Size ordering is load-bearing for a different reason: a superset of a pinned
 * subset is pinned too, and only this order lets the caller keep the small one
 * and drop the rest.
 */
export function candidateSubsets(
  all: readonly number[], cells: readonly number[],
  peopleAt: (index: number) => ReadonlySet<string>, minimumContributors: number,
): number[][] {
  const found: number[][] = all.map((index) => [index]);
  for (let size = 2; size <= LARGEST_COMBINATION; size += 1) {
    const walk = (start: number, chosen: number[], people: Set<string>): void => {
      if (chosen.length === size) { found.push([...chosen]); return; }
      for (let index = start; index < cells.length; index += 1) {
        const grown = new Set(people);
        for (const person of peopleAt(cells[index]!)) grown.add(person);
        if (grown.size >= minimumContributors) continue;
        chosen.push(cells[index]!);
        walk(index + 1, chosen, grown);
        chosen.pop();
      }
    };
    walk(0, [], new Set());
  }
  return found;
}

/** The column each reduced row pivots on: in echelon form, its first non-zero. */
export function pivotsOf(reduced: readonly EliminationRow[], width: number): number[] {
  return reduced.map((row) => {
    for (let column = 0; column < width; column += 1) {
      if (Math.abs(row.coefficients[column]!) > TOLERANCE) return column;
    }
    return width;
  });
}

/**
 * What is LEFT of a variable once everything the reduced rows already determine
 * is taken out of it — the part of it the reader cannot reach.
 */
export function leftoverOf(
  reduced: readonly EliminationRow[], pivots: readonly number[], index: number, width: number,
): number[] {
  const vector = new Array<number>(width).fill(0);
  vector[index] = 1;
  reduced.forEach((row, position) => {
    const factor = vector[pivots[position]!]!;
    if (Math.abs(factor) < TOLERANCE) return;
    for (let column = 0; column < width; column += 1) {
      vector[column]! -= factor * row.coefficients[column]!;
    }
  });
  return vector;
}

/**
 * Whether the reader can pin down SOME combination of exactly these variables:
 * true when their leftovers are linearly dependent.
 *
 * Not "is one of the reduced rows supported here" — that only sees the basis the
 * elimination happened to produce, and a randomised sweep found a pair of
 * withheld incident cells whose sum was pinned by a combination the basis did
 * not name.
 */
export function pinsSomething(leftovers: readonly (readonly number[])[], width: number): boolean {
  const rows = leftovers.map((vector) => ({ coefficients: [...vector], anchors: new Set<string>() }));
  return eliminate(rows, width).length < leftovers.length;
}

export interface EliminationRow {
  coefficients: number[];
  /** Published rows the knowns in every contributing relation rest on. */
  anchors: Set<string>;
}

/**
 * Reduced row echelon form, carrying each row's anchors through the
 * combinations. Every coefficient starts at 1 or -1 over a system this sparse,
 * so ordinary floating point stays exact enough for a comparison against zero.
 */
export function eliminate(rows: EliminationRow[], width: number): EliminationRow[] {
  let pivot = 0;
  for (let column = 0; column < width && pivot < rows.length; column += 1) {
    let candidate = -1;
    for (let row = pivot; row < rows.length; row += 1) {
      if (Math.abs(rows[row]!.coefficients[column]!) > TOLERANCE) { candidate = row; break; }
    }
    if (candidate === -1) continue;
    [rows[pivot], rows[candidate]] = [rows[candidate]!, rows[pivot]!];
    const scale = rows[pivot]!.coefficients[column]!;
    for (let c = column; c < width; c += 1) rows[pivot]!.coefficients[c]! /= scale;
    for (let row = 0; row < rows.length; row += 1) {
      if (row === pivot) continue;
      const factor = rows[row]!.coefficients[column]!;
      if (Math.abs(factor) < TOLERANCE) continue;
      for (let c = column; c < width; c += 1) {
        rows[row]!.coefficients[c]! -= factor * rows[pivot]!.coefficients[c]!;
      }
      for (const anchor of rows[pivot]!.anchors) rows[row]!.anchors.add(anchor);
    }
    pivot += 1;
  }
  return rows.slice(0, pivot);
}
