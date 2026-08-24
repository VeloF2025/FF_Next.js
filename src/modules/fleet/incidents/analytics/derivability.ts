/**
 * What a reader can WORK OUT from the published rows — not what appears in them.
 *
 * The two rules that came before this one each guarded a single axis. The
 * cross-level rule compared a parent with its children within one metric key;
 * the partition rule compared the members of one sum at one cell. Both decided
 * per cell, against what was PUBLISHED there. A reader is not so confined: the
 * relations chain. Subtract a project's published children from the project to
 * get a withheld site's value, then feed that into the same site's partition and
 * a second withheld cell falls out — a cell neither rule ever looked at, whose
 * support can be one person.
 *
 * So the oracle here is DERIVABILITY, not publication. Every value a reader
 * could hold is a variable; every arithmetic identity between them is a
 * relation:
 *
 * - **Across levels**, for one key: a parent equals the sum of its children.
 * - **Across keys**, at one cell: a partition's total equals the sum of its
 *   members (`metricPartitions.ts`).
 * - **Nested subsets**, at one cell: superset − subset is a third quantity that
 *   has no metric key of its own but has people behind it (`METRIC_SUBSETS`).
 *
 * A variable is known outright if a published row states it, if a published row
 * carries it as a denominator, or if nobody is behind it — a key with no data in
 * a cell is zero, and assuming the reader knows that is the conservative
 * reading. Everything else is an unknown, and the relations over those unknowns
 * are a linear system. Row-reducing it is the whole method: each reduced row is
 * a combination of unknowns whose value the published rows fix, and a row that
 * reduces to a single unknown fixes that value outright.
 *
 * The question asked of the reduced system is then, for each small group of
 * withheld variables: can the reader pin down SOME combination of exactly
 * these? That is a question about the row SPACE, not about the basis the
 * elimination happened to produce — a randomised sweep found a pair of withheld
 * incident cells whose sum was pinned by a combination no basis row named. If
 * the answer is yes, the people behind that combination are the union of those
 * variables' supports, and that group must be empty — the value is then zero and
 * describes nobody — or reach `minimumContributors`.
 *
 * The search covers every withheld variable on its own, and every pair and
 * triple of withheld CELLS. Two deliberate bounds:
 *
 * - Four or more cells added together are not enumerated. No such shape has been
 *   observed across the randomised sweeps; it is a bound on the search, not a
 *   claim that none exists.
 * - Complements do not enter the combinations, only the singles. A complement's
 *   support is a BOUND, and summing bounds stops meaning anything: the three
 *   complements of one presence partition add up to twice its total, so their
 *   bounds union to fewer people than the total's own support while the quantity
 *   they pin is the total itself. Judging that a disclosure is an artefact of
 *   how it was written down, not a fact about anybody.
 *
 * Reduction rather than "keep handing over the last unknown in a relation",
 * because the two are not the same rule. The weaker one was written first and a
 * randomised search found a residual it could not see within 56 configurations:
 * three cells across two sites, pinned only by ADDING two relations together.
 * One unknown at a time never forms that sum.
 *
 * EVERY relation enters the system, including ones with no known variable at
 * all. Those are not inert: they are constraints, and a constraint combines with
 * an anchored row to pin something neither could pin alone. Dropping them before
 * elimination — which the first version of this file did — loses exactly that,
 * and a randomised search found the loss at seed 34: two published level
 * relations pin a site's scheduled and confirmed days, the site's own partition
 * is anchorless, and adding them together leaves one person's unconfirmed day.
 *
 * The anchor test belongs AFTER elimination, on the reduced row. A reduced row
 * with no anchors is a pure identity among withheld values — it hands over no
 * number, and no amount of publishing less would change that — so reporting it
 * would be a permanent false alarm. Anchors are carried through the row
 * operations for exactly this reason, and they double as the list of rows the
 * caller can withhold to break the derivation.
 *
 * Pure: no SQL, no clock, no settings lookup.
 */
import type { DerivationValue, Variable } from './derivationModel';
import { buildRelations, buildVariables, valueIdOf } from './derivationModel';
import type { EliminationRow } from './derivationSolver';
import { COMPLEMENT_PREFIX } from './metricPartitions';
import {
  TOLERANCE, candidateSubsets, copyRow, eliminate, leftoverOf, pinsSomething, pivotsOf,
} from './derivationSolver';

export type { DerivationValue } from './derivationModel';
export { valueIdOf } from './derivationModel';

export interface DerivabilityViolation {
  /**
   * The withheld variables the reader can pin down as a sum, smallest form the
   * elimination could reduce them to.
   */
  unknowns: readonly string[];
  /** How many people that sum describes. */
  residual: number;
  /** True when the row fixes ONE withheld value outright rather than a sum. */
  recoveredOutright: boolean;
  /**
   * Published values whose withholding would break the derivation, as
   * `cellId#metricKey`. Withholding any of them makes some known variable in the
   * relation unknown again, which is what the caller needs to act on.
   */
  anchors: readonly string[];
}

/**
 * The relations a reader can exploit, and what each of them still hides.
 *
 * Returns one entry per relation that leaks: an anchored relation whose
 * remaining unknowns describe between one and `minimumContributors - 1` people.
 * An empty array means the published set determines nothing about any group
 * smaller than the threshold.
 */
export function derivabilityViolations(
  values: readonly DerivationValue[], minimumContributors: number,
): DerivabilityViolation[] {
  const byId = new Map<string, DerivationValue>();
  const parents = new Map<string, string | null>();
  for (const value of values) {
    byId.set(valueIdOf(value.cellId, value.metricKey), value);
    parents.set(value.cellId, value.parentCellId);
  }
  const cellIds = [...parents.keys()].sort();

  const variables = buildVariables(byId, cellIds);
  const relations = buildRelations(cellIds, parents);
  // A variable no relation could give data to is a free zero: known, nobody
  // behind it, and nothing to withhold to take it away.
  const free: Variable = { support: new Set(), known: true, anchors: new Set() };
  const read = (id: string): Variable => variables.get(id) ?? free;

  const unknowns = [...variables.entries()]
    .filter(([, variable]) => !variable.known)
    .map(([id]) => id)
    .sort();
  const column = new Map(unknowns.map((id, index) => [id, index]));

  const rows: EliminationRow[] = [];
  for (const relation of relations) {
    const anchors = new Set<string>();
    for (const id of relation.variables) {
      for (const anchor of read(id).anchors) anchors.add(anchor);
    }
    const coefficients = new Array<number>(unknowns.length).fill(0);
    let touched = false;
    relation.variables.forEach((id, index) => {
      const at = column.get(id);
      if (at === undefined) return;
      // The relation is `total = sum(parts)`; only the sign matters here.
      coefficients[at] = (coefficients[at] ?? 0) + (index === 0 ? 1 : -1);
      touched = true;
    });
    if (touched) rows.push({ coefficients, anchors });
  }

  // ONE SYSTEM PER CONNECTED COMPONENT. Presence never shares a relation with
  // driver input, and a site's cells never share one with another project's, so
  // the matrix is block diagonal and a pinned combination always lies inside a
  // single block. Elimination is cubic, so solving the blocks separately is the
  // difference between a sweep that finishes and one that does not.
  const componentOf = new Map<number, number>();
  const merge = (a: number, b: number): void => {
    const [from, into] = [componentOf.get(a)!, componentOf.get(b)!];
    if (from === into) return;
    for (const [index, component] of componentOf) if (component === from) componentOf.set(index, into);
  };
  for (let index = 0; index < unknowns.length; index += 1) componentOf.set(index, index);
  const touchedBy = rows.map(
    (row) => row.coefficients.map((value, index) => ({ value, index }))
      .filter(({ value }) => Math.abs(value) > TOLERANCE).map(({ index }) => index),
  );
  for (const touched of touchedBy) for (const index of touched) merge(index, touched[0]!);

  const blocks = new Map<number, number[]>();
  for (const [index, component] of componentOf) {
    blocks.set(component, [...(blocks.get(component) ?? []), index]);
  }

  const violations: DerivabilityViolation[] = [];
  for (const block of [...blocks.values()].map((columns) => columns.sort((a, b) => a - b))) {
    const local = new Map(block.map((index, position) => [index, position]));
    const width = block.length;
    const blockRows: EliminationRow[] = [];
    rows.forEach((row, position) => {
      if (touchedBy[position]!.length === 0 || !local.has(touchedBy[position]![0]!)) return;
      const coefficients = new Array<number>(width).fill(0);
      for (const index of touchedBy[position]!) coefficients[local.get(index)!] = row.coefficients[index]!;
      blockRows.push({ coefficients, anchors: new Set(row.anchors) });
    });
    if (blockRows.length === 0) continue;

    const reduced = eliminate(blockRows.map(copyRow), width);
    const pivots = pivotsOf(reduced, width);
    const peopleLocal = (position: number): ReadonlySet<string> => read(unknowns[block[position]!]!).support;

    const small: number[] = [];
    for (let position = 0; position < width; position += 1) {
      const size = peopleLocal(position).size;
      if (size > 0 && size < minimumContributors) small.push(position);
    }
    if (small.length === 0) continue;
    const cells = small.filter(
      (position) => !unknowns[block[position]!]!.includes(`#${COMPLEMENT_PREFIX}`),
    );
    const leftovers = new Map(
      small.map((position) => [position, leftoverOf(reduced, pivots, position, width)]),
    );

    const found: number[][] = [];
    for (const subset of candidateSubsets(small, cells, peopleLocal, minimumContributors)) {
      if (found.some((earlier) => earlier.every((position) => subset.includes(position)))) continue;
      if (!pinsSomething(subset.map((position) => leftovers.get(position)!), width)) continue;
      found.push(subset);
      const residual = new Set<string>();
      for (const position of subset) for (const person of peopleLocal(position)) residual.add(person);
      if (residual.size === 0 || residual.size >= minimumContributors) continue;
      // The reader's knowledge has to rest on a published row. A combination
      // pinned only by identities among withheld values hands over no number,
      // and no amount of publishing less would change that.
      const anchors = new Set<string>();
      for (const row of reduced) {
        if (!subset.some((position) => Math.abs(row.coefficients[position]!) > TOLERANCE)) continue;
        for (const anchor of row.anchors) anchors.add(anchor);
      }
      if (anchors.size === 0) continue;
      violations.push({
        unknowns: subset.map((position) => unknowns[block[position]!]!), residual: residual.size,
        recoveredOutright: subset.length === 1, anchors: [...anchors].sort(),
      });
    }
  }

  return violations.sort(
    (a, b) => Number(b.recoveredOutright) - Number(a.recoveredOutright)
      || a.unknowns.join(',').localeCompare(b.unknowns.join(',')),
  );
}
