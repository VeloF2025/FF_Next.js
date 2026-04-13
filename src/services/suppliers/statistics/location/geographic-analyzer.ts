/**
 * Geographic Analysis Engine
 * Advanced geographic analysis and pattern recognition for supplier locations
 */

import { Supplier } from '@/types/supplier/base.types';
import { 
  LocationDistribution, 
  ProvinceDistribution, 
  LocationConcentration,
  LocationSummary,
  SupplierLocation,
  LocationSearchOptions,
  RegionAnalysis
} from './location-types';
import { LocationMetricsCalculator } from './location-metrics';
import { log } from '@/lib/logger';

export class GeographicAnalyzer {
  /**
   * Get comprehensive location distribution analysis
   */
  static async getLocationDistribution(): Promise<LocationDistribution[]> {
    try {
      const supplierCrudService = await import('../../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();
      
      return LocationMetricsCalculator.calculateLocationDistribution(suppliers);
    } catch (error) {
      log.error('Error getting location distribution:', { data: error }, 'geographic-analyzer');
      return [];
    }
  }

  /**
   * Get province-level distribution analysis
   */
  static async getProvinceDistribution(): Promise<ProvinceDistribution[]> {
    try {
      const supplierCrudService = await import('../../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();
      
      return LocationMetricsCalculator.calculateProvinceDistribution(suppliers);
    } catch (error) {
      log.error('Error getting province distribution:', { data: error }, 'geographic-analyzer');
      return [];
    }
  }

  /**
   * Find suppliers within radius of a location
   */
  static async getSuppliersNearLocation(
    latitude: number,
    longitude: number,
    options: LocationSearchOptions = {}
  ): Promise<SupplierLocation[]> {
    try {
      const supplierCrudService = await import('../../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();
      
      const {
        radius = 50,
        unit = 'km',
        sortBy = 'distance',
        limit
      } = options;

      const radiusInKm = unit === 'miles' ? radius * 1.60934 : radius;
      let nearbySuppliers = LocationMetricsCalculator.findSuppliersNearLocation(
        suppliers,
        latitude,
        longitude,
        radiusInKm
      );

      // Apply sorting
      switch (sortBy) {
        case 'name':
          nearbySuppliers.sort((a, b) => a.supplierName.localeCompare(b.supplierName));
          break;
        case 'supplierCount':
          // This would require additional grouping logic
          break;
        case 'distance':
        default:
          // Already sorted by distance in findSuppliersNearLocation
          break;
      }

      // Apply limit
      if (limit && limit > 0) {
        nearbySuppliers = nearbySuppliers.slice(0, limit);
      }

      return nearbySuppliers;
    } catch (error) {
      log.error('Error finding suppliers near location:', { data: error }, 'geographic-analyzer');
      return [];
    }
  }

  /**
   * Analyze location concentration and diversity
   */
  static async getLocationConcentration(): Promise<LocationConcentration> {
    try {
      const distribution = await this.getLocationDistribution();
      const metrics = LocationMetricsCalculator.calculateLocationConcentration(distribution);
      
      return {
        totalLocations: metrics.totalLocations,
        topLocations: metrics.topLocations,
        concentrationIndex: metrics.concentrationIndex,
        diversityScore: metrics.diversityScore
      };
    } catch (error) {
      log.error('Error analyzing location concentration:', { data: error }, 'geographic-analyzer');
      return {
        totalLocations: 0,
        topLocations: [],
        concentrationIndex: 0,
        diversityScore: 0
      };
    }
  }

  /**
   * Get suppliers without location data
   */
  static async getSuppliersWithoutLocation(): Promise<Supplier[]> {
    try {
      const supplierCrudService = await import('../../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();
      
      return LocationMetricsCalculator.getSuppliersWithoutLocation(suppliers);
    } catch (error) {
      log.error('Error getting suppliers without location:', { data: error }, 'geographic-analyzer');
      return [];
    }
  }

  /**
   * Generate comprehensive location summary
   */
  static async getLocationSummary(): Promise<LocationSummary> {
    try {
      const supplierCrudService = await import('../../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();
      const distribution = LocationMetricsCalculator.calculateLocationDistribution(suppliers);
      
      return LocationMetricsCalculator.calculateLocationSummary(suppliers, distribution);
    } catch (error) {
      log.error('Error generating location summary:', { data: error }, 'geographic-analyzer');
      return {
        totalSuppliers: 0,
        suppliersWithLocation: 0,
        suppliersWithoutLocation: 0,
        uniqueCities: 0,
        uniqueProvinces: 0,
        uniqueCountries: 0,
        topCity: 'N/A',
        topProvince: 'N/A',
        topCountry: 'N/A',
        locationCoverage: 0
      };
    }
  }

  /**
   * Analyze regional performance and characteristics
   */
  static async analyzeRegionalPerformance(): Promise<RegionAnalysis[]> {
    try {
      const supplierCrudService = await import('../../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();
      
      const regionMap = new Map<string, {
        suppliers: Supplier[];
        ratings: number[];
        categories: Map<string, number>;
      }>();

      // Group suppliers by region
      suppliers.forEach(supplier => {
        const address = supplier.addresses?.physical;
        if (address && address.state) {
          const region = `${address.state}, ${address.country || ''}`;
          
          if (!regionMap.has(region)) {
            regionMap.set(region, {
              suppliers: [],
              ratings: [],
              categories: new Map()
            });
          }

          const regionData = regionMap.get(region)!;
          regionData.suppliers.push(supplier);

          // Collect ratings
          const rating = this.getSupplierRating(supplier);
          if (rating > 0) {
            regionData.ratings.push(rating);
          }

          // Collect categories
          if (supplier.category) {
            const currentCount = regionData.categories.get(supplier.category) || 0;
            regionData.categories.set(supplier.category, currentCount + 1);
          }
        }
      });

      const totalSuppliers = suppliers.length;
      const analyses: RegionAnalysis[] = [];

      regionMap.forEach((data, region) => {
        const averageRating = data.ratings.length > 0
          ? data.ratings.reduce((sum, rating) => sum + rating, 0) / data.ratings.length
          : 0;

        const topCategories = Array.from(data.categories.entries())
          .map(([category, count]) => ({ category, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        const marketShare = (data.suppliers.length / totalSuppliers) * 100;

        analyses.push({
          region,
          supplierCount: data.suppliers.length,
          averageRating: Math.round(averageRating * 100) / 100,
          topCategories,
          marketShare: Math.round(marketShare * 100) / 100
        });
      });

      return analyses.sort((a, b) => b.supplierCount - a.supplierCount);
    } catch (error) {
      log.error('Error analyzing regional performance:', { data: error }, 'geographic-analyzer');
      return [];
    }
  }

  /**
   * Identify location expansion opportunities
   */
  static async identifyExpansionOpportunities(): Promise<{
    underservedRegions: string[];
    growingMarkets: string[];
    recommendations: string[];
  }> {
    try {
      const [distribution, regionalAnalysis] = await Promise.all([
        this.getLocationDistribution(),
        this.analyzeRegionalPerformance()
      ]);

      // Identify underserved regions (low supplier count but major market)
      const majorCities = [
        'Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa',
        'Edmonton', 'Mississauga', 'Winnipeg', 'Quebec City', 'Hamilton'
      ];

      const underservedRegions = majorCities.filter(city => {
        const cityData = distribution.find(d => d.city.toLowerCase() === city.toLowerCase());
        return !cityData || cityData.count < 5; // Threshold for underserved
      });

      // Identify growing markets (regions with good performance metrics)
      const growingMarkets = regionalAnalysis
        .filter(region => region.averageRating > 4.0 && region.supplierCount < 20)
        .map(region => region.region)
        .slice(0, 5);

      // Generate recommendations
      const recommendations: string[] = [];
      
      if (underservedRegions.length > 0) {
        recommendations.push(
          `Consider expanding to ${underservedRegions.slice(0, 3).join(', ')} for better market coverage`
        );
      }

      if (growingMarkets.length > 0) {
        recommendations.push(
          `Invest in supplier development in ${growingMarkets[0]} - high performance, low saturation`
        );
      }

      const concentrationAnalysis = await this.getLocationConcentration();
      if (concentrationAnalysis.concentrationIndex > 0.2) {
        recommendations.push(
          'High location concentration detected - diversify supplier base geographically'
        );
      }

      return {
        underservedRegions,
        growingMarkets,
        recommendations
      };
    } catch (error) {
      log.error('Error identifying expansion opportunities:', { data: error }, 'geographic-analyzer');
      return {
        underservedRegions: [],
        growingMarkets: [],
        recommendations: []
      };
    }
  }

  /**
   * Calculate location-based risk factors
   */
  static async calculateLocationRisk(): Promise<{
    riskLevel: 'low' | 'medium' | 'high';
    riskFactors: string[];
    mitigation: string[];
    concentrationScore: number;
  }> {
    try {
      const [concentration, summary] = await Promise.all([
        this.getLocationConcentration(),
        this.getLocationSummary()
      ]);

      const riskFactors: string[] = [];
      const mitigation: string[] = [];
      let riskLevel: 'low' | 'medium' | 'high' = 'low';

      // Analyze concentration risk
      if (concentration.concentrationIndex > 0.3) {
        riskFactors.push('High geographic concentration increases supply chain risk');
        mitigation.push('Diversify supplier base across multiple regions');
        riskLevel = 'high';
      } else if (concentration.concentrationIndex > 0.15) {
        riskFactors.push('Moderate geographic concentration may pose supply risks');
        mitigation.push('Consider expanding to additional geographic markets');
        riskLevel = 'medium';
      }

      // Analyze location coverage
      if (summary.locationCoverage < 80) {
        riskFactors.push(`${100 - summary.locationCoverage}% of suppliers lack location data`);
        mitigation.push('Improve supplier data collection for better risk assessment');
        if (riskLevel === 'low') riskLevel = 'medium';
      }

      // Analyze single-location dependency
      const topLocationShare = concentration.topLocations[0]?.percentage || 0;
      if (topLocationShare > 40) {
        riskFactors.push(`Over ${topLocationShare}% of suppliers in single location`);
        mitigation.push('Reduce dependency on single geographic location');
        riskLevel = 'high';
      }

      return {
        riskLevel,
        riskFactors,
        mitigation,
        concentrationScore: Math.round(concentration.concentrationIndex * 100)
      };
    } catch (error) {
      log.error('Error calculating location risk:', { data: error }, 'geographic-analyzer');
      return {
        riskLevel: 'low',
        riskFactors: [],
        mitigation: [],
        concentrationScore: 0
      };
    }
  }

  /**
   * Get supplier rating (helper method)
   */
  private static getSupplierRating(supplier: Supplier): number {
    if (typeof supplier.rating === 'number') {
      return supplier.rating;
    }
    if (supplier.rating && typeof supplier.rating === 'object') {
      return (supplier.rating as { average?: number }).average || 0;
    }
    return 0;
  }
}