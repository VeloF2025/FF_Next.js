/**
 * Cost Calculator Service
 * Calculates financial impact of vehicle trips
 */

import type { TripClassification } from '../types';

/**
 * Default cost rates (R per km)
 */
export const DEFAULT_FUEL_RATE = 3.00;
export const DEFAULT_DEPRECIATION_RATE = 1.50;

/**
 * Trip data needed for cost calculation
 */
export interface TripForCost {
  distanceKm: number;
  classification: TripClassification;
}

/**
 * Cost calculation result for a single trip
 */
export interface TripCostResult {
  totalCost: number;
  fuelCost: number;
  depreciationCost: number;
}

/**
 * Aggregated cost result for multiple trips
 */
export interface TotalCostResult {
  totalKm: number;
  totalCost: number;
  authorizedKm: number;
  authorizedCost: number;
  unauthorizedKm: number;
  unauthorizedCost: number;
  fuelCost: number;
  depreciationCost: number;
}

/**
 * Round to 2 decimal places
 */
function roundCost(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calculate cost for a single trip
 *
 * @param trip - Trip to calculate cost for
 * @param fuelRatePerKm - Fuel cost per km (default 3.00)
 * @param depreciationRatePerKm - Depreciation cost per km (default 1.50)
 * @returns Cost breakdown
 */
export function calculateTripCost(
  trip: TripForCost,
  fuelRatePerKm: number = DEFAULT_FUEL_RATE,
  depreciationRatePerKm: number = DEFAULT_DEPRECIATION_RATE
): TripCostResult {
  const fuelCost = roundCost(trip.distanceKm * fuelRatePerKm);
  const depreciationCost = roundCost(trip.distanceKm * depreciationRatePerKm);
  const totalCost = roundCost(fuelCost + depreciationCost);

  return {
    totalCost,
    fuelCost,
    depreciationCost,
  };
}

/**
 * Calculate total costs for multiple trips
 *
 * @param trips - Array of trips to calculate costs for
 * @param fuelRatePerKm - Fuel cost per km (default 3.00)
 * @param depreciationRatePerKm - Depreciation cost per km (default 1.50)
 * @returns Aggregated cost breakdown
 */
export function calculateTotalCosts(
  trips: TripForCost[],
  fuelRatePerKm: number = DEFAULT_FUEL_RATE,
  depreciationRatePerKm: number = DEFAULT_DEPRECIATION_RATE
): TotalCostResult {
  let totalKm = 0;
  let authorizedKm = 0;
  let unauthorizedKm = 0;
  let fuelCost = 0;
  let depreciationCost = 0;

  for (const trip of trips) {
    const cost = calculateTripCost(trip, fuelRatePerKm, depreciationRatePerKm);

    totalKm += trip.distanceKm;
    fuelCost += cost.fuelCost;
    depreciationCost += cost.depreciationCost;

    if (trip.classification === 'AUTHORIZED') {
      authorizedKm += trip.distanceKm;
    } else {
      unauthorizedKm += trip.distanceKm;
    }
  }

  const totalCost = roundCost(fuelCost + depreciationCost);
  const ratePerKm = fuelRatePerKm + depreciationRatePerKm;

  return {
    totalKm: roundCost(totalKm),
    totalCost,
    authorizedKm: roundCost(authorizedKm),
    authorizedCost: roundCost(authorizedKm * ratePerKm),
    unauthorizedKm: roundCost(unauthorizedKm),
    unauthorizedCost: roundCost(unauthorizedKm * ratePerKm),
    fuelCost: roundCost(fuelCost),
    depreciationCost: roundCost(depreciationCost),
  };
}

/**
 * Format cost as currency string (ZAR)
 */
export function formatCurrency(amount: number): string {
  return `R${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
