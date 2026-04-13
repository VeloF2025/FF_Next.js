// SOW Calculation and Summary Types
export interface SOWCalculations {
  // Pole Calculations
  total_poles: number;
  poles_by_status: { [key: string]: number };
  poles_by_type: { [key: string]: number };
  total_pole_cost: number;
  average_pole_cost: number;
  
  // Drop Calculations
  total_drops: number;
  drops_by_status: { [key: string]: number };
  drops_by_service_type: { [key: string]: number };
  total_drop_cost: number;
  average_drop_cost: number;
  total_monthly_revenue: number;
  
  // Fibre Calculations
  total_fibre_length: number;
  fibre_by_type: { [key: string]: number };
  fibre_by_installation_method: { [key: string]: number };
  total_fibre_cost: number;
  average_cost_per_meter: number;
  
  // Labour and Time
  total_labour_hours: number;
  estimated_completion_days: number;
  labour_cost: number;
  
  // Financial Summary
  total_material_cost: number;
  total_installation_cost: number;
  total_project_cost: number;
  profit_margin: number;
  roi_estimate: number;
  
  // Quality Metrics
  completion_percentage: number;
  quality_score_average: number;
  compliance_rate: number;
  
  // Capacity Analysis
  total_network_capacity: number;
  utilized_capacity: number;
  available_capacity: number;
  capacity_utilization_rate: number;
  
  // Risk Analysis
  high_risk_items: number;
  medium_risk_items: number;
  low_risk_items: number;
  overall_risk_score: number;
  
  // Timeline Projections
  earliest_completion_date?: Date;
  latest_completion_date?: Date;
  critical_path_duration: number;
  resource_constraints: string[];
  
  // Performance Indicators
  on_time_completion_rate: number;
  budget_variance_percentage: number;
  scope_change_count: number;
  defect_rate: number;
  
  // Last calculation metadata
  calculated_at: Date;
  calculated_by: string;
  calculation_version: string;
}

export interface ImportSummary {
  // Import Statistics
  total_rows_processed: number;
  successful_imports: number;
  failed_imports: number;
  warning_count: number;
  
  // Data Breakdown
  poles_imported: number;
  drops_imported: number;
  fibre_routes_imported: number;
  
  // Error Summary
  validation_errors: ImportError[];
  data_quality_issues: DataQualityIssue[];
  duplicate_records: number;
  missing_required_fields: number;
  
  // File Information
  source_file: string;
  file_size: number;
  import_start_time: Date;
  import_end_time: Date;
  import_duration_seconds: number;
  
  // Processing Details
  data_mapping_used: string;
  transformation_rules_applied: string[];
  validation_rules_checked: string[];
  
  // Quality Metrics
  data_completeness_percentage: number;
  data_accuracy_score: number;
  consistency_score: number;
  
  // Post-import Actions Required
  manual_review_required: boolean;
  approval_needed: boolean;
  corrections_needed: string[];
  recommended_actions: string[];
}

export interface ValidationResults {
  // Overall Status
  overall_status: 'valid' | 'invalid' | 'warning' | 'needs_review';
  validation_date: Date;
  validated_by: string;
  
  // Validation Categories
  data_integrity: ValidationCategory;
  business_rules: ValidationCategory;
  technical_constraints: ValidationCategory;
  compliance_checks: ValidationCategory;
  
  // Detailed Results
  pole_validation: EntityValidation;
  drop_validation: EntityValidation;
  fibre_validation: EntityValidation;
  
  // Cross-entity Validations
  pole_drop_relationships: RelationshipValidation[];
  fibre_connectivity: RelationshipValidation[];
  capacity_constraints: CapacityValidation[];
  
  // Business Logic Validations
  costing_validation: CostValidation;
  timeline_validation: TimelineValidation;
  resource_validation: ResourceValidation;
  
  // Compliance and Standards
  safety_compliance: ComplianceCheck[];
  technical_standards: ComplianceCheck[];
  regulatory_requirements: ComplianceCheck[];
  
  // Recommendations
  critical_issues: ValidationIssue[];
  warnings: ValidationIssue[];
  suggestions: ValidationIssue[];
  
  // Quality Score
  overall_quality_score: number;
  confidence_level: number;
  risk_assessment: 'low' | 'medium' | 'high' | 'critical';
}

export interface ImportError {
  row_number: number;
  column: string;
  error_type: 'validation' | 'format' | 'missing' | 'duplicate' | 'constraint';
  error_message: string;
  provided_value?: unknown;
  expected_format?: string;
  severity: 'error' | 'warning' | 'info';
}

export interface DataQualityIssue {
  entity_type: 'pole' | 'drop' | 'fibre';
  entity_id: string;
  issue_type: 'incomplete' | 'inconsistent' | 'outdated' | 'suspicious';
  description: string;
  impact: 'low' | 'medium' | 'high' | 'critical';
  recommended_action: string;
}

export interface ValidationCategory {
  status: 'passed' | 'failed' | 'warning';
  checks_performed: number;
  checks_passed: number;
  checks_failed: number;
  warnings: number;
  details: ValidationCheck[];
}

export interface ValidationCheck {
  check_name: string;
  status: 'passed' | 'failed' | 'warning';
  message: string;
  affected_entities: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface EntityValidation {
  entity_type: 'pole' | 'drop' | 'fibre';
  total_entities: number;
  valid_entities: number;
  invalid_entities: number;
  warning_entities: number;
  validation_details: EntityValidationDetail[];
}

export interface EntityValidationDetail {
  entity_id: string;
  status: 'valid' | 'invalid' | 'warning';
  issues: ValidationIssue[];
}

export interface RelationshipValidation {
  relationship_type: string;
  from_entity: string;
  to_entity: string;
  status: 'valid' | 'invalid' | 'warning';
  message: string;
}

export interface CapacityValidation {
  entity_type: 'pole' | 'network_segment';
  entity_id: string;
  max_capacity: number;
  current_usage: number;
  available_capacity: number;
  over_capacity: boolean;
  utilization_percentage: number;
}

export interface CostValidation {
  total_estimated_cost: number;
  budget_limit?: number;
  within_budget: boolean;
  variance_percentage: number;
  cost_breakdown_valid: boolean;
  pricing_anomalies: string[];
}

export interface TimelineValidation {
  estimated_duration: number;
  deadline?: Date;
  feasible: boolean;
  critical_path_issues: string[];
  resource_conflicts: string[];
  timeline_risks: string[];
}

export interface ResourceValidation {
  required_resources: ResourceRequirement[];
  available_resources: ResourceAvailability[];
  resource_conflicts: ResourceConflict[];
  feasibility_score: number;
}

export interface ResourceRequirement {
  resource_type: string;
  quantity_required: number;
  duration_needed: number;
  time_frame: string;
}

export interface ResourceAvailability {
  resource_type: string;
  quantity_available: number;
  availability_window: string;
  location?: string;
}

export interface ResourceConflict {
  resource_type: string;
  conflict_description: string;
  impact: 'low' | 'medium' | 'high' | 'critical';
  suggested_resolution: string;
}

export interface ComplianceCheck {
  requirement_name: string;
  status: 'compliant' | 'non_compliant' | 'partially_compliant';
  description: string;
  evidence?: string;
  required_actions: string[];
}

export interface ValidationIssue {
  issue_id: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  affected_entities: string[];
  recommended_action: string;
  auto_fixable: boolean;
}