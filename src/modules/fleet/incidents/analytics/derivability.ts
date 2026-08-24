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
 * Every reduced row is then a disclosure question. The people behind it are the
 * union of its unknowns' supports, and that group must be empty — the value is
 * then zero and describes nobody — or reach `minimumContributors`.
 *
 * Reduction rather than "keep handing over the last unknown in a relation",
 * because the two are not the same rule. The weaker one was written first and a
 * randomised search found a residual it could not see within 56 configurations:
 * three cells across two sites, pinned only by ADDING two relations together.
 * One unknown at a time never forms that sum.
 *
 * Only relations anchored on a published row are admitted. A relation known
 * solely through withheld variables states an identity among unknowns and hands
 * over no number; one known solely through absent keys hands over a zero that
 * was never withheld. Neither could be repaired by publishing less, so reporting
 * either would be a permanent false alarm.
 *
 * Pure: no SQL, no clock, no settings lookup.
 */
import type { DerivationValue, Variable } from './derivationModel';
import { buildRelations, buildVariables, valueIdOf } from './derivationModel';

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

const TOLERANCE = 1e-9;

interface EliminationRow {
  coefficients: number[];
  /** Published rows the knowns in every contributing relation rest on. */
  anchors: Set<string>;
}

/**
 * Reduced row echelon form, carrying each row's anchors through the
 * combinations. Every coefficient starts at 1 or -1 over a system this sparse,
 * so ordinary floating point stays exact enough for a comparison against zero.
 */
function eliminate(rows: EliminationRow[], width: number): EliminationRow[] {
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
      if (!read(id).known) continue;
      for (const anchor of read(id).anchors) anchors.add(anchor);
    }
    if (anchors.size === 0) continue;
    const coefficients = new Array<number>(unknowns.length).fill(0);
    let touched = false;
    relation.variables.forEach((id, index) => {
      const at = column.get(id);
      if (at === undefined) return;
      // The relation is `total = sum(members)`; only the sign matters here.
      coefficients[at] = (coefficients[at] ?? 0) + (index === 0 ? 1 : -1);
      touched = true;
    });
    if (touched) rows.push({ coefficients, anchors });
  }

  const violations: DerivabilityViolation[] = [];
  for (const row of eliminate(rows, unknowns.length)) {
    const involved = unknowns.filter((_, index) => Math.abs(row.coefficients[index]!) > TOLERANCE);
    if (involved.length === 0) continue;
    const residual = new Set<string>();
    for (const id of involved) for (const person of read(id).support) residual.add(person);
    if (residual.size === 0 || residual.size >= minimumContributors) continue;
    violations.push({
      unknowns: involved, residual: residual.size,
      recoveredOutright: involved.length === 1, anchors: [...row.anchors].sort(),
    });
  }

  return violations.sort(
    (a, b) => Number(b.recoveredOutright) - Number(a.recoveredOutright)
      || a.unknowns.join(',').localeCompare(b.unknowns.join(',')),
  );
}
