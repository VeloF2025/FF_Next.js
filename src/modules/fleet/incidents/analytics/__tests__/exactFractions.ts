/**
 * Exact rational arithmetic over `bigint`, for the disclosure oracle.
 *
 * The production closure compares coefficients against 1e-9. That is almost
 * certainly fine for a system whose entries all start at 1 or -1 — but "almost
 * certainly fine" is the sort of thing an oracle is supposed to check rather
 * than share. Nothing here rounds, so a coefficient is zero when it is zero.
 */
export interface Fraction {
  /** Sign lives here; `denominator` is always positive and the pair is reduced. */
  numerator: bigint;
  denominator: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
}

export function fraction(numerator: bigint, denominator = 1n): Fraction {
  if (denominator === 0n) throw new Error('exact fractions: division by zero');
  const sign = denominator < 0n ? -1n : 1n;
  const [n, d] = [numerator * sign, denominator * sign];
  const divisor = gcd(n, d);
  return { numerator: n / divisor, denominator: d / divisor };
}

export const ZERO = fraction(0n);
export const ONE = fraction(1n);

export const isZero = (value: Fraction): boolean => value.numerator === 0n;

export const add = (a: Fraction, b: Fraction): Fraction =>
  fraction(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);

export const multiply = (a: Fraction, b: Fraction): Fraction =>
  fraction(a.numerator * b.numerator, a.denominator * b.denominator);

export const negate = (value: Fraction): Fraction => fraction(-value.numerator, value.denominator);

export const divide = (a: Fraction, b: Fraction): Fraction => {
  if (isZero(b)) throw new Error('exact fractions: division by zero');
  return fraction(a.numerator * b.denominator, a.denominator * b.numerator);
};

/**
 * Reduced row echelon form, exactly. Returns the reduced rows and the column
 * each of them pivots on, which is all the callers need to read off a rank or a
 * null space.
 */
export function rowReduce(
  matrix: readonly (readonly Fraction[])[], width: number,
): { rows: Fraction[][]; pivots: number[] } {
  const rows = matrix.map((row) => [...row]);
  const pivots: number[] = [];
  let pivotRow = 0;
  for (let column = 0; column < width && pivotRow < rows.length; column += 1) {
    const candidate = rows.findIndex((row, index) => index >= pivotRow && !isZero(row[column]!));
    if (candidate === -1) continue;
    [rows[pivotRow], rows[candidate]] = [rows[candidate]!, rows[pivotRow]!];
    const scale = rows[pivotRow]![column]!;
    for (let c = column; c < width; c += 1) rows[pivotRow]![c] = divide(rows[pivotRow]![c]!, scale);
    for (let row = 0; row < rows.length; row += 1) {
      if (row === pivotRow || isZero(rows[row]![column]!)) continue;
      const factor = rows[row]![column]!;
      for (let c = column; c < width; c += 1) {
        rows[row]![c] = add(rows[row]![c]!, negate(multiply(factor, rows[pivotRow]![c]!)));
      }
    }
    pivots.push(column);
    pivotRow += 1;
  }
  return { rows: rows.slice(0, pivotRow), pivots };
}

/** Every solution of `matrix * x = 0`, as a basis. */
export function nullSpace(matrix: readonly (readonly Fraction[])[], width: number): Fraction[][] {
  const { rows, pivots } = rowReduce(matrix, width);
  const pivotOf = new Map(pivots.map((column, index) => [column, index]));
  const basis: Fraction[][] = [];
  for (let free = 0; free < width; free += 1) {
    if (pivotOf.has(free)) continue;
    const vector = new Array<Fraction>(width).fill(ZERO);
    vector[free] = ONE;
    for (const [column, index] of pivotOf) vector[column] = negate(rows[index]![free]!);
    basis.push(vector);
  }
  return basis;
}

/** The rank of a set of vectors restricted to `columns`. */
export function rankOver(vectors: readonly (readonly Fraction[])[], columns: readonly number[]): number {
  if (vectors.length === 0) return 0;
  const restricted = vectors.map((vector) => columns.map((column) => vector[column]!));
  return rowReduce(restricted, columns.length).pivots.length;
}
