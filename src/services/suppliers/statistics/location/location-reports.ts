/**
 * Location Reports Generator
 * Generate formatted reports and visualizations for location analysis
 */

import { 
  LocationDistribution, 
  ProvinceDistribution, 
  LocationConcentration, 
  LocationSummary,
  RegionAnalysis 
} from './location-types';

export class LocationReportsGenerator {
  /**
   * Generate location distribution summary report
   */
  static generateDistributionReport(distribution: LocationDistribution[]): string {
    if (distribution.length === 0) {
      return 'No location distribution data available.';
    }

    let report = `Location Distribution Report\n`;
    report += `${'='.repeat(30)}\n\n`;

    report += `Total Locations: ${distribution.length}\n\n`;

    report += `Top 10 Locations:\n`;
    report += `${'-'.repeat(50)}\n`;
    report += `${'Location'.padEnd(25)} ${'Count'.padEnd(8)} ${'%'.padEnd(8)}\n`;
    report += `${'-'.repeat(50)}\n`;

    distribution.slice(0, 10).forEach(location => {
      const locationName = `${location.city}, ${location.province}`.substring(0, 24);
      report += `${locationName.padEnd(25)} ${location.count.toString().padEnd(8)} ${location.percentage.toFixed(1).padEnd(8)}\n`;
    });

    report += `\nLong Tail Analysis:\n`;
    const singleSupplierLocations = distribution.filter(loc => loc.count === 1).length;
    const topFiveShare = distribution.slice(0, 5).reduce((sum, loc) => sum + loc.percentage, 0);
    
    report += `- Locations with only 1 supplier: ${singleSupplierLocations}\n`;
    report += `- Top 5 locations market share: ${topFiveShare.toFixed(1)}%\n`;
    report += `- Geographic diversity index: ${(100 - topFiveShare).toFixed(1)}%\n`;

    return report;
  }

  /**
   * Generate province distribution report
   */
  static generateProvinceReport(provinces: ProvinceDistribution[]): string {
    if (provinces.length === 0) {
      return 'No province distribution data available.';
    }

    let report = `Province Distribution Report\n`;
    report += `${'='.repeat(32)}\n\n`;

    provinces.forEach(province => {
      report += `${province.province}, ${province.country}\n`;
      report += `- Suppliers: ${province.supplierCount} (${province.percentage.toFixed(1)}%)\n`;
      report += `- Cities: ${province.cities.length}\n`;
      
      if (province.cities.length > 0) {
        report += `- Top Cities: `;
        report += province.cities.slice(0, 3)
          .map(city => `${city.city} (${city.count})`)
          .join(', ');
        report += `\n`;
      }
      report += `\n`;
    });

    return report;
  }

  /**
   * Generate location concentration analysis report
   */
  static generateConcentrationReport(concentration: LocationConcentration): string {
    let report = `Location Concentration Analysis\n`;
    report += `${'='.repeat(35)}\n\n`;

    report += `Geographic Diversity Metrics:\n`;
    report += `- Total Locations: ${concentration.totalLocations}\n`;
    report += `- Concentration Index: ${(concentration.concentrationIndex * 100).toFixed(2)}%\n`;
    report += `- Diversity Score: ${concentration.diversityScore.toFixed(2)}%\n\n`;

    // Interpret concentration level
    let concentrationLevel = 'Low';
    if (concentration.concentrationIndex > 0.25) {
      concentrationLevel = 'High';
    } else if (concentration.concentrationIndex > 0.15) {
      concentrationLevel = 'Moderate';
    }

    report += `Concentration Level: ${concentrationLevel}\n\n`;

    report += `Top Locations by Supplier Count:\n`;
    report += `${'-'.repeat(40)}\n`;
    concentration.topLocations.forEach((location, index) => {
      report += `${(index + 1).toString().padStart(2)}. ${location.location}\n`;
      report += `    Suppliers: ${location.count} (${location.percentage.toFixed(1)}%)\n`;
    });

    report += `\nRisk Assessment:\n`;
    if (concentrationLevel === 'High') {
      report += `⚠️  HIGH RISK: Heavy concentration in few locations\n`;
      report += `   Recommendation: Diversify supplier base geographically\n`;
    } else if (concentrationLevel === 'Moderate') {
      report += `⚠️  MODERATE RISK: Some concentration present\n`;
      report += `   Recommendation: Monitor and gradually diversify\n`;
    } else {
      report += `✅ LOW RISK: Good geographic diversification\n`;
      report += `   Recommendation: Maintain current distribution\n`;
    }

    return report;
  }

  /**
   * Generate comprehensive location summary
   */
  static generateLocationSummary(summary: LocationSummary): string {
    let report = `Location Analysis Summary\n`;
    report += `${'='.repeat(28)}\n\n`;

    report += `Overall Statistics:\n`;
    report += `- Total Suppliers: ${summary.totalSuppliers}\n`;
    report += `- With Location Data: ${summary.suppliersWithLocation} (${summary.locationCoverage.toFixed(1)}%)\n`;
    report += `- Missing Location: ${summary.suppliersWithoutLocation}\n\n`;

    report += `Geographic Coverage:\n`;
    report += `- Unique Cities: ${summary.uniqueCities}\n`;
    report += `- Unique Provinces: ${summary.uniqueProvinces}\n`;
    report += `- Unique Countries: ${summary.uniqueCountries}\n\n`;

    report += `Top Locations:\n`;
    report += `- Primary City: ${summary.topCity}\n`;
    report += `- Primary Province: ${summary.topProvince}\n`;
    report += `- Primary Country: ${summary.topCountry}\n\n`;

    // Data quality assessment
    report += `Data Quality Assessment:\n`;
    if (summary.locationCoverage >= 95) {
      report += `✅ EXCELLENT: ${summary.locationCoverage.toFixed(1)}% location coverage\n`;
    } else if (summary.locationCoverage >= 80) {
      report += `✅ GOOD: ${summary.locationCoverage.toFixed(1)}% location coverage\n`;
    } else if (summary.locationCoverage >= 60) {
      report += `⚠️  FAIR: ${summary.locationCoverage.toFixed(1)}% location coverage\n`;
      report += `   Recommendation: Improve location data collection\n`;
    } else {
      report += `❌ POOR: ${summary.locationCoverage.toFixed(1)}% location coverage\n`;
      report += `   Action Required: Urgent location data cleanup needed\n`;
    }

    return report;
  }

  /**
   * Generate regional analysis report
   */
  static generateRegionalAnalysisReport(regions: RegionAnalysis[]): string {
    if (regions.length === 0) {
      return 'No regional analysis data available.';
    }

    let report = `Regional Performance Analysis\n`;
    report += `${'='.repeat(32)}\n\n`;

    regions.forEach((region, index) => {
      report += `${index + 1}. ${region.region}\n`;
      report += `   Suppliers: ${region.supplierCount} (${region.marketShare.toFixed(1)}% market share)\n`;
      report += `   Avg Rating: ${region.averageRating.toFixed(2)}/5.0\n`;
      
      if (region.topCategories.length > 0) {
        report += `   Top Categories: `;
        report += region.topCategories.slice(0, 3)
          .map(cat => `${cat.category} (${cat.count})`)
          .join(', ');
        report += `\n`;
      }
      report += `\n`;
    });

    // Market insights
    report += `Market Insights:\n`;
    report += `${'-'.repeat(16)}\n`;
    
    const topRegion = regions[0];
    if (topRegion) {
      report += `- Dominant Market: ${topRegion.region} (${topRegion.marketShare.toFixed(1)}% share)\n`;
    }

    const highPerformance = regions.filter(r => r.averageRating >= 4.0);
    if (highPerformance.length > 0) {
      report += `- High Performance Regions: ${highPerformance.length}\n`;
      report += `  Top Rated: ${highPerformance[0].region} (${highPerformance[0].averageRating.toFixed(2)})\n`;
    }

    const emerging = regions.filter(r => r.supplierCount >= 3 && r.supplierCount <= 10 && r.averageRating >= 3.5);
    if (emerging.length > 0) {
      report += `- Emerging Markets: ${emerging.length} regions with growth potential\n`;
    }

    return report;
  }

  /**
   * Generate location dashboard data for visualization
   */
  static generateDashboardData(
    distribution: LocationDistribution[],
    concentration: LocationConcentration,
    summary: LocationSummary
  ): {
    mapData: Array<{
      location: string;
      coordinates?: [number, number];
      count: number;
      percentage: number;
    }>;
    charts: {
      topLocations: Array<{ name: string; value: number }>;
      provincialDistribution: Array<{ name: string; value: number }>;
      concentrationMetrics: {
        diversityScore: number;
        concentrationIndex: number;
        locationCoverage: number;
      };
    };
    kpis: {
      totalLocations: number;
      coveragePercent: number;
      topLocationShare: number;
      riskLevel: string;
    };
  } {
    const mapData = distribution.map(loc => ({
      location: `${loc.city}, ${loc.province}`,
      count: loc.count,
      percentage: loc.percentage
      // Note: Would need geocoding service to add actual coordinates
    }));

    const topLocations = distribution.slice(0, 10).map(loc => ({
      name: `${loc.city}, ${loc.province}`,
      value: loc.count
    }));

    // Create provincial distribution for chart
    const provincialMap = new Map<string, number>();
    distribution.forEach(loc => {
      if (loc.province) {
        provincialMap.set(loc.province, (provincialMap.get(loc.province) || 0) + loc.count);
      }
    });

    const provincialDistribution = Array.from(provincialMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const concentrationMetrics = {
      diversityScore: concentration.diversityScore,
      concentrationIndex: concentration.concentrationIndex * 100,
      locationCoverage: summary.locationCoverage
    };

    // Determine risk level
    let riskLevel = 'Low';
    if (concentration.concentrationIndex > 0.25) {
      riskLevel = 'High';
    } else if (concentration.concentrationIndex > 0.15) {
      riskLevel = 'Medium';
    }

    const kpis = {
      totalLocations: summary.uniqueCities,
      coveragePercent: summary.locationCoverage,
      topLocationShare: concentration.topLocations[0]?.percentage || 0,
      riskLevel
    };

    return {
      mapData,
      charts: {
        topLocations,
        provincialDistribution,
        concentrationMetrics
      },
      kpis
    };
  }

  /**
   * Export location data to CSV format
   */
  static exportLocationDataToCSV(distribution: LocationDistribution[]): string {
    const headers = ['City', 'Province', 'Country', 'Supplier Count', 'Percentage', 'Supplier IDs'];
    
    const rows = distribution.map(location => [
      location.city,
      location.province,
      location.country,
      location.count.toString(),
      location.percentage.toFixed(2),
      location.suppliers.join(';')
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  /**
   * Generate executive summary for stakeholders
   */
  static generateExecutiveSummary(
    summary: LocationSummary,
    concentration: LocationConcentration,
    regions: RegionAnalysis[]
  ): string {
    let report = `LOCATION ANALYSIS - EXECUTIVE SUMMARY\n`;
    report += `${'='.repeat(42)}\n`;
    report += `Generated: ${new Date().toISOString().split('T')[0]} ${new Date().toTimeString().slice(0, 5)}\n\n`;

    // Key findings
    report += `KEY FINDINGS:\n`;
    report += `${'-'.repeat(13)}\n`;
    report += `• Supplier Network: ${summary.totalSuppliers} suppliers across ${summary.uniqueCities} cities\n`;
    report += `• Geographic Coverage: ${summary.locationCoverage.toFixed(1)}% of suppliers have location data\n`;
    report += `• Market Concentration: ${(concentration.concentrationIndex * 100).toFixed(1)}% concentration index\n`;
    report += `• Primary Markets: ${summary.topCity}, ${summary.topProvince}\n\n`;

    // Risk assessment
    report += `RISK ASSESSMENT:\n`;
    report += `${'-'.repeat(16)}\n`;
    const topLocationShare = concentration.topLocations[0]?.percentage || 0;
    if (topLocationShare > 30) {
      report += `⚠️  HIGH CONCENTRATION RISK: ${topLocationShare.toFixed(1)}% of suppliers in ${concentration.topLocations[0]?.location}\n`;
      report += `   Impact: Supply chain disruption risk in case of regional issues\n`;
      report += `   Recommendation: Immediate geographic diversification required\n`;
    } else if (concentration.concentrationIndex > 0.15) {
      report += `⚠️  MODERATE CONCENTRATION: Some geographic clustering observed\n`;
      report += `   Recommendation: Monitor and gradually diversify supplier base\n`;
    } else {
      report += `✅ LOW RISK: Well-distributed supplier network\n`;
      report += `   Status: Maintain current geographic distribution strategy\n`;
    }

    // Opportunities
    report += `\nSTRATEGIC OPPORTUNITIES:\n`;
    report += `${'-'.repeat(24)}\n`;
    if (regions.length > 0) {
      const highPerforming = regions.filter(r => r.averageRating >= 4.0 && r.supplierCount < 15);
      if (highPerforming.length > 0) {
        report += `• Expansion Targets: ${highPerforming.slice(0, 2).map(r => r.region).join(', ')}\n`;
        report += `  Rationale: High performance ratings with growth capacity\n`;
      }

      const emerging = regions.filter(r => r.supplierCount >= 5 && r.supplierCount <= 10);
      if (emerging.length > 0) {
        report += `• Emerging Markets: ${emerging.length} regions showing potential\n`;
      }
    }

    if (summary.locationCoverage < 90) {
      report += `• Data Quality: Improve location data for ${summary.suppliersWithoutLocation} suppliers\n`;
      report += `  Impact: Better risk assessment and strategic planning capability\n`;
    }

    return report;
  }
}