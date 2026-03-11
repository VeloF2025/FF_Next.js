/**
 * Location Metrics Calculator
 * Core calculations for geographic supplier metrics and distances
 */

import { Supplier } from '@/types/supplier/base.types';
import { 
  LocationDistribution, 
  ProvinceDistribution, 
  GeographicCoordinates,
  SupplierLocation,
  LocationSummary 
} from './location-types';

export class LocationMetricsCalculator {
  /**
   * Calculate distance between two geographic points using Haversine formula
   */
  static calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
    unit: 'km' | 'miles' = 'km'
  ): number {
    const R = unit === 'km' ? 6371 : 3959; // Earth's radius in km or miles
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   */
  private static toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Extract location data from suppliers
   */
  static extractLocationData(suppliers: Supplier[]): Map<string, {
    city: string;
    province: string;
    country: string;
    count: number;
    suppliers: string[];
  }> {
    const locationCounts = new Map<string, {
      city: string;
      province: string;
      country: string;
      count: number;
      suppliers: string[];
    }>();

    suppliers.forEach(supplier => {
      const address = supplier.addresses?.physical;
      if (address && address.city) {
        const key = `${address.city}|${address.state || ''}|${address.country || ''}`;
        const existing = locationCounts.get(key);
        
        if (existing) {
          existing.count++;
          existing.suppliers.push(supplier.id);
        } else {
          locationCounts.set(key, {
            city: address.city,
            province: address.state || '',
            country: address.country || '',
            count: 1,
            suppliers: [supplier.id]
          });
        }
      }
    });

    return locationCounts;
  }

  /**
   * Calculate location distribution percentages
   */
  static calculateLocationDistribution(suppliers: Supplier[]): LocationDistribution[] {
    const locationCounts = this.extractLocationData(suppliers);
    const totalSuppliers = suppliers.length;
    const distribution: LocationDistribution[] = [];

    locationCounts.forEach((data) => {
      distribution.push({
        city: data.city,
        province: data.province,
        country: data.country,
        count: data.count,
        percentage: Math.round((data.count / totalSuppliers) * 10000) / 100,
        suppliers: data.suppliers
      });
    });

    return distribution.sort((a, b) => b.count - a.count);
  }

  /**
   * Calculate province-level distribution
   */
  static calculateProvinceDistribution(suppliers: Supplier[]): ProvinceDistribution[] {
    const provinceCounts = new Map<string, {
      province: string;
      country: string;
      supplierCount: number;
      cities: Map<string, number>;
    }>();

    suppliers.forEach(supplier => {
      const address = supplier.addresses?.physical;
      if (address && address.state && address.city) {
        const key = `${address.state}|${address.country || ''}`;
        const existing = provinceCounts.get(key);
        
        if (existing) {
          existing.supplierCount++;
          const cityCount = existing.cities.get(address.city) || 0;
          existing.cities.set(address.city, cityCount + 1);
        } else {
          const cities = new Map<string, number>();
          cities.set(address.city, 1);
          provinceCounts.set(key, {
            province: address.state,
            country: address.country || '',
            supplierCount: 1,
            cities
          });
        }
      }
    });

    const totalSuppliers = suppliers.length;
    const distribution: ProvinceDistribution[] = [];

    provinceCounts.forEach(data => {
      const cities = Array.from(data.cities.entries())
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count);

      distribution.push({
        province: data.province,
        country: data.country,
        supplierCount: data.supplierCount,
        percentage: Math.round((data.supplierCount / totalSuppliers) * 10000) / 100,
        cities
      });
    });

    return distribution.sort((a, b) => b.supplierCount - a.supplierCount);
  }

  /**
   * Calculate location concentration metrics
   */
  static calculateLocationConcentration(distribution: LocationDistribution[]): {
    totalLocations: number;
    topLocations: Array<{
      location: string;
      count: number;
      percentage: number;
    }>;
    concentrationIndex: number;
    diversityScore: number;
  } {
    const totalLocations = distribution.length;
    const topLocations = distribution.slice(0, 10).map(loc => ({
      location: `${loc.city}, ${loc.province}`,
      count: loc.count,
      percentage: loc.percentage
    }));

    // Calculate Herfindahl-Hirschman Index for concentration
    const concentrationIndex = distribution.reduce((sum, loc) => {
      const marketShare = loc.percentage / 100;
      return sum + (marketShare * marketShare);
    }, 0);

    // Calculate diversity score (inverse of concentration)
    const diversityScore = Math.round((1 - concentrationIndex) * 10000) / 100;

    return {
      totalLocations,
      topLocations,
      concentrationIndex: Math.round(concentrationIndex * 10000) / 10000,
      diversityScore
    };
  }

  /**
   * Find suppliers near a specific location
   */
  static findSuppliersNearLocation(
    suppliers: Supplier[],
    targetLat: number,
    targetLon: number,
    radiusKm: number = 50
  ): SupplierLocation[] {
    const nearbySuppliers: SupplierLocation[] = [];

    suppliers.forEach(supplier => {
      const address = supplier.addresses?.physical;
      if (address && address.coordinates) {
        const distance = this.calculateDistance(
          targetLat,
          targetLon,
          address.coordinates.lat,
          address.coordinates.lng
        );

        if (distance <= radiusKm) {
          nearbySuppliers.push({
            supplierId: supplier.id,
            supplierName: supplier.companyName || '',
            address: {
              street: address.street1,
              city: address.city || '',
              province: address.state,
              state: address.state,
              country: address.country,
              postalCode: address.postalCode,
              coordinates: {
                latitude: address.coordinates.lat,
                longitude: address.coordinates.lng
              }
            },
            distance: Math.round(distance * 100) / 100
          });
        }
      }
    });

    return nearbySuppliers.sort((a, b) => (a.distance || 0) - (b.distance || 0));
  }

  /**
   * Get suppliers without location data
   */
  static getSuppliersWithoutLocation(suppliers: Supplier[]): Supplier[] {
    return suppliers.filter(supplier => {
      const address = supplier.addresses?.physical;
      return !address || !address.city;
    });
  }

  /**
   * Calculate comprehensive location summary
   */
  static calculateLocationSummary(
    suppliers: Supplier[],
    distribution: LocationDistribution[]
  ): LocationSummary {
    const totalSuppliers = suppliers.length;
    const suppliersWithoutLocation = this.getSuppliersWithoutLocation(suppliers);
    const suppliersWithLocation = totalSuppliers - suppliersWithoutLocation.length;

    // Count unique locations
    const uniqueCities = new Set(distribution.map(d => d.city)).size;
    const uniqueProvinces = new Set(distribution.map(d => d.province).filter(p => p)).size;
    const uniqueCountries = new Set(distribution.map(d => d.country).filter(c => c)).size;

    // Find top locations
    const topCity = distribution.length > 0 ? distribution[0]!.city : 'N/A';
    const provinceDistribution = this.calculateProvinceDistribution(suppliers);
    const topProvince = provinceDistribution.length > 0 ? provinceDistribution[0]!.province : 'N/A';
    
    const countryDistribution = new Map<string, number>();
    suppliers.forEach(supplier => {
      const country = supplier.addresses?.physical?.country;
      if (country) {
        countryDistribution.set(country, (countryDistribution.get(country) || 0) + 1);
      }
    });
    const topCountry = Array.from(countryDistribution.entries())
      .sort(([, a], [, b]) => b - a)[0]?.[0] || 'N/A';

    const locationCoverage = Math.round((suppliersWithLocation / totalSuppliers) * 10000) / 100;

    return {
      totalSuppliers,
      suppliersWithLocation,
      suppliersWithoutLocation: suppliersWithoutLocation.length,
      uniqueCities,
      uniqueProvinces,
      uniqueCountries,
      topCity,
      topProvince,
      topCountry,
      locationCoverage
    };
  }

  /**
   * Calculate geographic center of suppliers
   */
  static calculateGeographicCenter(suppliers: Supplier[]): GeographicCoordinates | null {
    const suppliersWithCoords = suppliers.filter(s => 
      s.addresses?.physical?.coordinates
    );

    if (suppliersWithCoords.length === 0) {
      return null;
    }

    const totalLat = suppliersWithCoords.reduce((sum, s) => 
      sum + (s.addresses!.physical!.coordinates!.lat || 0), 0);
    const totalLon = suppliersWithCoords.reduce((sum, s) => 
      sum + (s.addresses!.physical!.coordinates!.lng || 0), 0);

    return {
      latitude: totalLat / suppliersWithCoords.length,
      longitude: totalLon / suppliersWithCoords.length
    };
  }

  /**
   * Calculate average distance from center
   */
  static calculateAverageDistanceFromCenter(
    suppliers: Supplier[],
    center: GeographicCoordinates
  ): number {
    const suppliersWithCoords = suppliers.filter(s => 
      s.addresses?.physical?.coordinates
    );

    if (suppliersWithCoords.length === 0) {
      return 0;
    }

    const totalDistance = suppliersWithCoords.reduce((sum, supplier) => {
      const coords = supplier.addresses?.physical?.coordinates;
      if (!coords) return sum;
      const distance = this.calculateDistance(
        center.latitude,
        center.longitude,
        coords.lat,
        coords.lng
      );
      return sum + distance;
    }, 0);

    return Math.round((totalDistance / suppliersWithCoords.length) * 100) / 100;
  }
}