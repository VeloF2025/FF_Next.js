/**
 * Industry Specialist
 * Industry-specific recommendation generation
 */

import { Supplier } from '@/types/supplier/base.types';
import type {
  RecommendationItem,
  INDUSTRY_CATEGORIES
} from './recommendation-types';

/** Opaque industry benchmarks passed from external callers — shape varies by sector */
type IndustryBenchmarks = Record<string, unknown>;

export class RecommendationIndustrySpecialist {
  /**
   * Generate industry-specific recommendations
   */
  static generateIndustryRecommendations(
    supplier: Supplier,
    industryBenchmarks?: IndustryBenchmarks
  ): string[] {
    const recommendations: string[] = [];
    const categories = supplier.categories || [];

    // Technology sector recommendations
    if (this.isInIndustry(categories, 'TECHNOLOGY')) {
      recommendations.push(...this.getTechnologyRecommendations(supplier, industryBenchmarks));
    }

    // Construction sector recommendations
    if (this.isInIndustry(categories, 'CONSTRUCTION')) {
      recommendations.push(...this.getConstructionRecommendations(supplier, industryBenchmarks));
    }

    // Manufacturing sector recommendations
    if (this.isInIndustry(categories, 'MANUFACTURING')) {
      recommendations.push(...this.getManufacturingRecommendations(supplier, industryBenchmarks));
    }

    // Professional services recommendations
    if (this.isInIndustry(categories, 'PROFESSIONAL')) {
      recommendations.push(...this.getProfessionalServicesRecommendations(supplier, industryBenchmarks));
    }

    // Logistics sector recommendations
    if (this.isInIndustry(categories, 'LOGISTICS')) {
      recommendations.push(...this.getLogisticsRecommendations(supplier, industryBenchmarks));
    }

    // Healthcare sector recommendations
    if (this.isInIndustry(categories, 'HEALTHCARE')) {
      recommendations.push(...this.getHealthcareRecommendations(supplier, industryBenchmarks));
    }

    return recommendations.slice(0, 6); // Limit to top 6 industry-specific recommendations
  }

  /**
   * Get technology sector recommendations
   */
  private static getTechnologyRecommendations(supplier: Supplier, _benchmarks?: IndustryBenchmarks): string[] {
    const recommendations: string[] = [];

    recommendations.push('Consider obtaining cybersecurity certifications (ISO 27001, SOC 2)');
    recommendations.push('Implement agile project management methodologies');
    recommendations.push('Establish continuous integration/continuous deployment (CI/CD) practices');

    const certNames = supplier.certifications?.map(c => c.name) ?? [];
    if (!certNames.some(name => name.toLowerCase().includes('security'))) {
      recommendations.push('Pursue cybersecurity framework compliance (NIST, GDPR)');
    }

    if (!supplier.website) {
      recommendations.push('Develop customer self-service portals and APIs');
    }

    recommendations.push('Invest in cloud infrastructure and scalability capabilities');

    return recommendations;
  }

  /**
   * Get construction sector recommendations
   */
  private static getConstructionRecommendations(supplier: Supplier, _benchmarks?: IndustryBenchmarks): string[] {
    const recommendations: string[] = [];

    recommendations.push('Ensure safety certifications are up to date (OSHA, local safety standards)');
    recommendations.push('Implement environmental sustainability practices (LEED, green building)');
    recommendations.push('Obtain bonding and insurance certifications');

    const certNames = supplier.certifications?.map(c => c.name) ?? [];
    if (!certNames.some(name => name.toLowerCase().includes('contractor'))) {
      recommendations.push('Verify all contractor licenses and permits are current');
    }

    recommendations.push('Implement project management software for better tracking');
    recommendations.push('Develop specialized expertise in sustainable construction methods');

    return recommendations;
  }

  /**
   * Get manufacturing sector recommendations
   */
  private static getManufacturingRecommendations(supplier: Supplier, _benchmarks?: IndustryBenchmarks): string[] {
    const recommendations: string[] = [];

    recommendations.push('Consider lean manufacturing principles implementation');
    recommendations.push('Implement quality management systems (ISO 9001)');
    recommendations.push('Pursue environmental management certification (ISO 14001)');

    const certNames = supplier.certifications?.map(c => c.name) ?? [];
    if (!certNames.some(name => name.toLowerCase().includes('iso'))) {
      recommendations.push('Obtain relevant ISO certifications for credibility');
    }

    recommendations.push('Implement predictive maintenance and Industry 4.0 technologies');
    recommendations.push('Develop supply chain transparency and traceability capabilities');

    return recommendations;
  }

  /**
   * Get professional services recommendations
   */
  private static getProfessionalServicesRecommendations(supplier: Supplier, _benchmarks?: IndustryBenchmarks): string[] {
    const recommendations: string[] = [];

    recommendations.push('Develop specialized expertise in niche areas');
    recommendations.push('Establish thought leadership through content marketing');
    recommendations.push('Pursue relevant professional certifications and continuing education');

    // Check tags as a proxy for client testimonials/case studies documented
    if (!supplier.tags || supplier.tags.length < 3) {
      recommendations.push('Collect and showcase client testimonials and case studies');
    }

    recommendations.push('Implement client relationship management (CRM) systems');
    recommendations.push('Develop proprietary methodologies and frameworks');

    return recommendations;
  }

  /**
   * Get logistics sector recommendations
   */
  private static getLogisticsRecommendations(supplier: Supplier, _benchmarks?: IndustryBenchmarks): string[] {
    const recommendations: string[] = [];

    recommendations.push('Implement real-time tracking and visibility systems');
    recommendations.push('Obtain transportation and logistics certifications');
    recommendations.push('Develop multi-modal transportation capabilities');

    // Check tags for tracking capability indicator
    const hasTrackingTag = supplier.tags?.some(t => t.toLowerCase().includes('tracking')) ?? false;
    if (!hasTrackingTag) {
      recommendations.push('Invest in GPS tracking and fleet management systems');
    }

    recommendations.push('Implement sustainable logistics practices (carbon footprint reduction)');
    recommendations.push('Develop emergency response and contingency planning capabilities');

    return recommendations;
  }

  /**
   * Get healthcare sector recommendations
   */
  private static getHealthcareRecommendations(supplier: Supplier, _benchmarks?: IndustryBenchmarks): string[] {
    const recommendations: string[] = [];

    recommendations.push('Ensure HIPAA compliance and data security measures');
    recommendations.push('Obtain healthcare-specific quality certifications');
    recommendations.push('Implement strict quality assurance and validation processes');

    const certNames = supplier.certifications?.map(c => c.name) ?? [];
    if (!certNames.some(name => name.toLowerCase().includes('fda'))) {
      recommendations.push('Pursue FDA or relevant regulatory compliance certifications');
    }

    recommendations.push('Develop expertise in healthcare regulations and compliance');
    recommendations.push('Implement patient safety and risk management protocols');

    return recommendations;
  }

  /**
   * Check if supplier is in specific industry
   */
  private static isInIndustry(categories: string[], industry: keyof typeof INDUSTRY_CATEGORIES): boolean {
    const industryCategories = {
      'TECHNOLOGY': ['technology', 'software', 'IT', 'digital'],
      'CONSTRUCTION': ['construction', 'building', 'infrastructure', 'civil'],
      'MANUFACTURING': ['manufacturing', 'production', 'industrial', 'factory'],
      'PROFESSIONAL': ['consulting', 'professional', 'advisory', 'services'],
      'LOGISTICS': ['logistics', 'shipping', 'transportation', 'supply chain'],
      'HEALTHCARE': ['healthcare', 'medical', 'pharmaceutical', 'biotech']
    };

    const targetCategories = industryCategories[industry] || [];
    return categories.some(cat =>
      targetCategories.some(target => cat.toLowerCase().includes(target))
    );
  }

  /**
   * Generate industry-specific priority recommendations
   */
  static generateIndustryPriorityRecommendations(
    supplier: Supplier,
    _overallScore: number
  ): RecommendationItem[] {
    const recommendations: RecommendationItem[] = [];
    const categories = supplier.categories || [];

    // High-priority industry-specific recommendations
    if (this.isInIndustry(categories, 'TECHNOLOGY')) {
      const certNames = supplier.certifications?.map(c => c.name) ?? [];
      if (!certNames.some(name => name.toLowerCase().includes('security'))) {
        recommendations.push({
          recommendation: 'Obtain cybersecurity certifications for technology services',
          priority: 'high',
          category: 'industry',
          impact: 'Enhanced client trust and compliance',
          timeline: 'Medium term (8-16 weeks)',
          estimatedCost: 'medium',
          difficulty: 'medium'
        });
      }
    }

    if (this.isInIndustry(categories, 'CONSTRUCTION')) {
      recommendations.push({
        recommendation: 'Ensure all safety certifications and licenses are current',
        priority: 'high',
        category: 'industry',
        impact: 'Risk mitigation and legal compliance',
        timeline: 'Short term (2-4 weeks)',
        estimatedCost: 'low',
        difficulty: 'low'
      });
    }

    if (this.isInIndustry(categories, 'HEALTHCARE')) {
      const certNames = supplier.certifications?.map(c => c.name) ?? [];
      if (!certNames.some(name => name.toLowerCase().includes('hipaa'))) {
        recommendations.push({
          recommendation: 'Implement HIPAA compliance and data security measures',
          priority: 'critical',
          category: 'industry',
          impact: 'Legal compliance and patient data protection',
          timeline: 'Short term (4-8 weeks)',
          estimatedCost: 'high',
          difficulty: 'high'
        });
      }
    }

    return recommendations;
  }

  /**
   * Get industry benchmarking recommendations
   */
  static getIndustryBenchmarkRecommendations(
    supplier: Supplier,
    industryAverages: Record<string, number>
  ): string[] {
    const recommendations: string[] = [];
    const supplierScore = 75; // This would be calculated elsewhere

    Object.entries(industryAverages).forEach(([metric, average]) => {
      if (supplierScore < average - 5) {
        recommendations.push(
          `${supplier.name}: Improve ${metric} performance - currently below industry average (${average}%)`
        );
      }
    });

    return recommendations;
  }

  /**
   * Generate compliance recommendations by industry
   */
  static generateComplianceRecommendationsByIndustry(
    supplier: Supplier
  ): { mandatory: string[]; recommended: string[] } {
    const categories = supplier.categories || [];
    const mandatory: string[] = [];
    const recommended: string[] = [];

    if (this.isInIndustry(categories, 'HEALTHCARE')) {
      mandatory.push('HIPAA compliance certification');
      mandatory.push('FDA regulatory compliance (if applicable)');
      recommended.push('Joint Commission accreditation');
    }

    if (this.isInIndustry(categories, 'TECHNOLOGY')) {
      mandatory.push('Data protection compliance (GDPR, CCPA)');
      recommended.push('ISO 27001 information security certification');
      recommended.push('SOC 2 Type II compliance');
    }

    if (this.isInIndustry(categories, 'CONSTRUCTION')) {
      mandatory.push('OSHA safety compliance');
      mandatory.push('Contractor license verification');
      recommended.push('LEED certification for sustainable building');
    }

    return { mandatory, recommended };
  }
}
