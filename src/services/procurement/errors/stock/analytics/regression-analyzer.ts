/**
 * Regression Analyzer
 * Advanced regression analysis and forecasting models
 */

import { ForecastCalculator } from './forecast-calculator';
import type { StockError } from '../inventory';

export class RegressionAnalyzer {
  /**
   * Generate advanced forecasting models
   */
  static generateAdvancedForecasts(
    historicalErrors: StockError[],
    forecastHorizon: number = 30
  ): {
    exponentialSmoothing: { forecast: number; trend: number; seasonal: number };
    movingAverage: { simple: number; weighted: number };
    regressionForecast: { linear: number; polynomial: number };
    confidenceMetrics: { accuracy: number; reliability: number };
  } {
    const dailyAverages = ForecastCalculator.calculateDailyAverages(historicalErrors);
    
    // Exponential smoothing
    const exponentialSmoothing = this.calculateExponentialSmoothing(dailyAverages, forecastHorizon);
    
    // Moving averages
    const movingAverage = this.calculateMovingAverages(dailyAverages);
    
    // Regression forecasts
    const regressionForecast = this.calculateRegressionForecasts(dailyAverages, forecastHorizon);
    
    // Confidence metrics
    const confidenceMetrics = this.calculateConfidenceMetrics(dailyAverages);

    return {
      exponentialSmoothing,
      movingAverage,
      regressionForecast,
      confidenceMetrics
    };
  }

  /**
   * Calculate exponential smoothing forecast
   */
  static calculateExponentialSmoothing(data: number[], horizon: number): { forecast: number; trend: number; seasonal: number } {
    if (data.length === 0) return { forecast: 0, trend: 0, seasonal: 1 };

    const alpha = 0.3; // Smoothing parameter
    const beta = 0.1; // Trend parameter
    
    let level = data[0]!;
    let trend = data.length > 1 ? data[1]! - data[0]! : 0;

    // Apply exponential smoothing
    for (let i = 1; i < data.length; i++) {
      const newLevel = alpha * data[i]! + (1 - alpha) * (level + trend);
      const newTrend = beta * (newLevel - level) + (1 - beta) * trend;
      level = newLevel;
      trend = newTrend;
    }
    
    return {
      forecast: level + trend * horizon,
      trend,
      seasonal: 1 // Simplified seasonal component
    };
  }

  /**
   * Calculate moving averages
   */
  static calculateMovingAverages(data: number[]): { simple: number; weighted: number } {
    if (data.length === 0) return { simple: 0, weighted: 0 };

    const period = Math.min(5, data.length);
    const recentData = data.slice(-period);
    
    // Simple moving average
    const simple = recentData.reduce((sum, val) => sum + val, 0) / recentData.length;
    
    // Weighted moving average (more weight to recent values)
    let weightedSum = 0;
    let weightTotal = 0;
    
    recentData.forEach((value, index) => {
      const weight = index + 1; // Linear weighting
      weightedSum += value * weight;
      weightTotal += weight;
    });
    
    const weighted = weightTotal > 0 ? weightedSum / weightTotal : simple;
    
    return { simple, weighted };
  }

  /**
   * Calculate regression forecasts
   */
  static calculateRegressionForecasts(data: number[], horizon: number): { linear: number; polynomial: number } {
    if (data.length < 2) return { linear: 0, polynomial: 0 };

    // Linear regression
    const slope = ForecastCalculator.calculateTrendSlope(data);
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const linear = mean + slope * horizon;

    // Simple polynomial (quadratic) approximation
    const polynomial = linear * (1 + slope * 0.1); // Simplified quadratic component

    return {
      linear: Math.max(0, linear),
      polynomial: Math.max(0, polynomial)
    };
  }

  /**
   * Calculate confidence metrics
   */
  static calculateConfidenceMetrics(data: number[]): { accuracy: number; reliability: number } {
    if (data.length < 3) return { accuracy: 0.5, reliability: 0.5 };

    // Calculate prediction accuracy using simple methods
    const predictions = [];
    const actuals = [];
    
    for (let i = 2; i < data.length; i++) {
      const predicted = (data[i-2]! + data[i-1]!) / 2; // Simple average prediction
      predictions.push(predicted);
      actuals.push(data[i]!);
    }

    // Calculate accuracy
    let totalError = 0;
    for (let i = 0; i < predictions.length; i++) {
      const error = Math.abs(predictions[i]! - actuals[i]!);
      const relativeError = actuals[i]! > 0 ? error / actuals[i]! : 0;
      totalError += relativeError;
    }
    
    const accuracy = predictions.length > 0 ? Math.max(0, 1 - (totalError / predictions.length)) : 0.5;
    
    // Calculate reliability based on data consistency
    const variance = ForecastCalculator.calculateVolatility(data);
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const coefficientOfVariation = mean > 0 ? variance / mean : 1;
    const reliability = Math.max(0, 1 - coefficientOfVariation);

    return {
      accuracy: Math.round(accuracy * 100) / 100,
      reliability: Math.round(reliability * 100) / 100
    };
  }
}