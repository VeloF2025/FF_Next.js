/**
 * Conduit module types — project scenario modelling.
 *
 * Schema v2 — PM-centric inputs, clean COS breakdown.
 * Cost/Home = COS Total ÷ FC Activations (not PO Count).
 */

// ─── Scope ───────────────────────────────────────────────────────────────────

/** Physical quantities to be built (scope of work). */
export interface ScopeInputs {
  poles: number;        // number of poles to erect
  stringing_m: number;  // aerial cable run (meters)
  pon: number;          // PON splitters to install
}

// ─── COS Rates ───────────────────────────────────────────────────────────────

/**
 * All-in unit costs — material + labour bundled per unit.
 * PMs enter ONE number per category, not split service/stock.
 */
export interface UnitCosts {
  per_pole: number;           // supply + erect per pole (excl. wayleave)
  per_stringing_m: number;    // cable supply + aerial install per meter
  per_pon: number;            // PON splitter supply + install per unit
  per_activation: number;     // ONT supply + installation per connected home
  wayleave_per_pole: number;  // wayleave / permission fee per pole
}

/** Monthly operational costs during the build phase (multiplied by build_duration_months). */
export interface MonthlyOpex {
  casuals: number;    // temporary labour per month
  fuel: number;       // vehicle / generator fuel per month
  overheads: number;  // site overheads per month
  sales: number;      // sales / customer acquisition per month
}

/** Lump-sum costs entered as totals (not per-month). */
export interface LumpCosts {
  ad_hoc: number;          // variable/contingency costs (project total)
  sub_contractor: number;  // sub-contractor fees (project total)
}

// ─── Project Inputs ──────────────────────────────────────────────────────────

export interface ConduitProjectInputs {
  // Revenue drivers
  rate: number;    // monthly ARPU per connected home (R)
  uptake: number;  // expected take-up rate, fraction 0–1

  // Scope of work
  scope: ScopeInputs;

  // COS — unit rates
  unit_costs: UnitCosts;

  // COS — monthly opex × build_duration_months
  monthly_opex: MonthlyOpex;

  // COS — lump sums (project totals)
  lump_costs: LumpCosts;
}

// ─── Project record ──────────────────────────────────────────────────────────

export interface ConduitProject {
  id: string;
  name: string;
  po_count: number;              // homes passed
  start_date: string | null;
  build_duration_months: number;
  inputs_json: ConduitProjectInputs;
  is_baseline_locked: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Calc result ─────────────────────────────────────────────────────────────

/**
 * Calculated (derived) fields — never stored, always re-derived from inputs.
 *
 * COS breakdown:
 *   cos_civil      = poles×(per_pole + wayleave) + stringing×per_m + pon×per_pon
 *   cos_activation = fc_activation × per_activation
 *   cos_monthly    = (casuals+fuel+overheads+sales) × build_duration_months
 *   cos_lump       = ad_hoc + sub_contractor
 *   cos_total      = sum of all above
 *
 * cost_per_home = cos_total ÷ fc_activation  (cost per CONNECTED home, not passed)
 */
export interface ConduitCalcResult {
  fc_activation: number;   // PO Count × Uptake (unrounded)
  revenue: number;         // fc_activation × rate

  cos_civil: number;       // infrastructure: poles + stringing + PON + wayleaves
  cos_activation: number;  // per-home activation cost × FC activations
  cos_monthly: number;     // monthly opex × build duration
  cos_lump: number;        // ad hoc + sub-contractor (lump sums)
  cos_total: number;       // sum of all COS

  profit: number;          // revenue − cos_total
  gross_profit_pct: number; // profit ÷ revenue
  cost_per_home: number;   // cos_total ÷ fc_activation
}
