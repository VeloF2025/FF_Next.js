/**
 * Monte Carlo Simulator
 * Statistical modeling and uncertainty analysis for stock error predictions
 */

import { StockError } from '../inventory';
import { ForecastCalculator } from './forecast-calculator';

export class MonteCarloSimulator {
  /**
   * Run Monte Carlo simulation for uncertainty modeling
   */
  static runSimulation(
    historicalErrors: StockError[],
    simulations: number = 1000,
    forecastDays: number = 30
  ): {
    scenarios: Array<{ probability: number; errorCount: number; scenario: string }>;
    statistics: { mean: number; median: number; stdDev: number; percentiles: Record<string, number> };
    riskAssessment: { low: number; medium: number; high: number; extreme: number };
  } {
    const dailyAverages = ForecastCalculator.calculateDailyAverages(historicalErrors);
    const mean = dailyAverages.reduce((sum, val) => sum + val, 0) / dailyAverages.length;
    const stdDev = ForecastCalculator.calculateVolatility(dailyAverages);
    
    const results: number[] = [];
    
    // Run Monte Carlo simulations
    for (let i = 0; i < simulations; i++) {
      let forecastValue = mean;
      
      // Add random variation based on historical volatility
      const randomFactor = this.generateNormalRandom() * stdDev;
      forecastValue += randomFactor;
      
      // Project over forecast period
      forecastValue *= forecastDays;
      
      results.push(Math.max(0, forecastValue));
    }
    
    return this.analyzeSimulationResults(results);
  }

  /**
   * Analyze simulation results and generate statistics
   */
  private static analyzeSimulationResults(results: number[]): {
    scenarios: Array<{ probability: number; errorCount: number; scenario: string }>;
    statistics: { mean: number; median: number; stdDev: number; percentiles: Record<string, number> };
    riskAssessment: { low: number; medium: number; high: number; extreme: number };
  } {
    // Sort results for percentile calculations
    results.sort((a, b) => a - b);
    
    // Calculate statistics
    const simulationMean = results.reduce((sum, val) => sum + val, 0) / results.length;
    const simulationMedian = results[Math.floor(results.length / 2)] ?? 0;
    const simulationStdDev = Math.sqrt(
      results.reduce((sum, val) => sum + Math.pow(val - simulationMean, 2), 0) / results.length
    );
    
    const percentiles = {
      p10: results[Math.floor(results.length * 0.1)],
      p25: results[Math.floor(results.length * 0.25)],
      p75: results[Math.floor(results.length * 0.75)],
      p90: results[Math.floor(results.length * 0.9)],
      p95: results[Math.floor(results.length * 0.95)]
    };
    
    // Generate scenarios
    const scenarios = [
      { probability: 0.1, errorCount: percentiles.p10 ?? 0, scenario: 'Best case' },
      { probability: 0.25, errorCount: percentiles.p25 ?? 0, scenario: 'Optimistic' },
      { probability: 0.5, errorCount: simulationMedian ?? 0, scenario: 'Most likely' },
      { probability: 0.75, errorCount: percentiles.p75 ?? 0, scenario: 'Pessimistic' },
      { probability: 0.9, errorCount: percentiles.p90 ?? 0, scenario: 'Worst case' }
    ];
    
    // Risk assessment
    const riskThresholds = {
      low: results.filter(r => r <= simulationMean * 0.8).length / results.length,
      medium: results.filter(r => r > simulationMean * 0.8 && r <= simulationMean * 1.2).length / results.length,
      high: results.filter(r => r > simulationMean * 1.2 && r <= simulationMean * 1.5).length / results.length,
      extreme: results.filter(r => r > simulationMean * 1.5).length / results.length
    };

    return {
      scenarios,
      statistics: {
        mean: Math.round(simulationMean),
        median: Math.round(simulationMedian),
        stdDev: Math.round(simulationStdDev),
        percentiles: Object.fromEntries(
          Object.entries(percentiles).map(([key, val]) => [key, Math.round(val ?? 0)])
        )
      },
      riskAssessment: {
        low: Math.round(riskThresholds.low * 100) / 100,
        medium: Math.round(riskThresholds.medium * 100) / 100,
        high: Math.round(riskThresholds.high * 100) / 100,
        extreme: Math.round(riskThresholds.extreme * 100) / 100
      }
    };
  }

  /**
   * Generate normal random number using Box-Muller transform
   */
  private static generateNormalRandom(): number {
    let u1 = Math.random();
    const u2 = Math.random();
    
    // Ensure u1 is not zero to avoid log(0)
    while (u1 === 0) {
      u1 = Math.random();
    }
    
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}