/**
 * Exact linear algebra over `bigint`, with no denominators anywhere.
 *
 * The release rule compares support sizes; it never solves anything. The oracle
 * does solve, and it has to do so exactly — a coefficient that is "zero to
 * within 1e-9" is the kind of thing an oracle is meant to catch rather than
 * commit. An earlier version used exact rationals and was correct but slow: row
 * reduction with a unit pivot manufactures denominators, they compound, and the
 * disclosure sweep spent its time in `gcd` on numbers hundreds of bits wide.
 *
 * Fraction-free elimination avoids all of it. Rows are cleared by cross
 * multiplication rather than by division, and each result is divided through by
 * its own content, so entries stay near the size they started at. Scaling a row
 * changes neither its rank nor whether a vector reduces to zero against it,
 * which is all that is asked here.
 */
function gcd(a: bigint, b: bigint): bigint {
  let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

/** Divides a row through by the greatest common divisor of its entries. */
function primitive(row: bigint[]): bigint[] {
  let content = 0n;
  for (const value of row) {
    if (value !== 0n) content = gcd(content, value);
    if (content === 1n) return row;
  }
  if (content === 0n || content === 1n) return row;
  return row.map((value) => value / content);
}

export interface Echelon {
  rows: bigint[][];
  /** The column each echelon row leads on. */
  pivots: number[];
}

/** Forward elimination to row echelon form. Enough for rank and for reduction. */
export function echelon(matrix: readonly (readonly bigint[])[], width: number): Echelon {
  const rows = matrix.map((row) => [...row]);
  const pivots: number[] = [];
  let pivotRow = 0;
  for (let column = 0; column < width && pivotRow < rows.length; column += 1) {
    let candidate = -1;
    for (let row = pivotRow; row < rows.length; row += 1) {
      if (rows[row]![column] !== 0n) { candidate = row; break; }
    }
    if (candidate === -1) continue;
    [rows[pivotRow], rows[candidate]] = [rows[candidate]!, rows[pivotRow]!];
    const lead = rows[pivotRow]!;
    // These systems are overwhelmingly zero — a relation names a handful of the
    // variables in its block — so the inner loops walk the live columns only.
    const live: number[] = [];
    for (let c = column; c < width; c += 1) if (lead[c] !== 0n) live.push(c);
    for (let row = pivotRow + 1; row < rows.length; row += 1) {
      const here = rows[row]!;
      if (here[column] === 0n) continue;
      const divisor = gcd(lead[column]!, here[column]!);
      const scaleHere = lead[column]! / divisor;
      const scaleLead = here[column]! / divisor;
      if (scaleHere !== 1n) {
        for (let c = column; c < width; c += 1) if (here[c] !== 0n) here[c] = here[c]! * scaleHere;
      }
      for (const c of live) here[c] = here[c]! - scaleLead * lead[c]!;
      rows[row] = primitive(here);
    }
    pivots.push(column);
    pivotRow += 1;
  }
  return { rows: rows.slice(0, pivotRow), pivots };
}

export const rank = (matrix: readonly (readonly bigint[])[], width: number): number =>
  echelon(matrix, width).pivots.length;

/**
 * What is left of `vector` once everything the echelon rows span is taken out of
 * it. Zero means the vector was already inside that span.
 */
export function reduceAgainst(form: Echelon, vector: readonly bigint[]): bigint[] {
  let left = [...vector];
  form.rows.forEach((row, index) => {
    const column = form.pivots[index]!;
    if (left[column] === 0n) return;
    const divisor = gcd(row[column]!, left[column]!);
    const scaleLeft = row[column]! / divisor;
    const scaleRow = left[column]! / divisor;
    for (let c = 0; c < left.length; c += 1) {
      if (left[c] === 0n && row[c] === 0n) continue;
      left[c] = left[c]! * scaleLeft - scaleRow * row[c]!;
    }
    left = primitive(left);
  });
  return left;
}

export const isZeroVector = (vector: readonly bigint[]): boolean => vector.every((value) => value === 0n);
