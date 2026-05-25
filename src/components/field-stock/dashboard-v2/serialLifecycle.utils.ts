/** Pure helpers for the serial-lifecycle panel. Kept out of the component file so
 * the component module only exports components (react-refresh/only-export-components). */

/** Bounded activation share: activated / (installed + activated), as an integer %. 0 when neither present. */
export function activatedSharePct(installed: number, activated: number): number {
  const denom = installed + activated;
  return denom > 0 ? Math.round((activated / denom) * 100) : 0;
}
