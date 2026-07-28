/**
 * H&S statutory appointment letter types (goal Phase 5)
 *
 * The fixed OHS Act / Construction Regulations appointment set. Not a catalogue
 * table — these are defined in law, so they live in code with their default
 * scope wording.
 */

export type AppointmentLetterType =
  | 's16_2'
  | 's8_1'
  | 'construction_supervisor'
  | 'annexure_3'
  // widened 2026-07-26 (H&S docs-vs-module alignment audit): the real client
  // H&S files evidence these 18 more regulation-clause statutory appointments.
  // Keep this list, migration 461's CHECK constraint, and
  // appointmentTypeSync.test.ts all in agreement.
  | 's16_1'
  | 'cr8_5'
  | 'cr8_7'
  | 'cr9_1_risk_assessor'
  | 'cr10_fall_protection_planner'
  | 'cr13_excavation_supervisor'
  | 'cr23_mobile_plant_operator'
  | 'cr28a_stacking_storage'
  | 'cr29h_firefighting_inspector'
  | 'gsr3_4_first_aid'
  | 'gsr13a_ladder_inspector'
  | 'emr10_4_electrical_inspector'
  | 'gar9_2_incident_investigator'
  | 'section8_hand_tools_inspector'
  | 'chemical_control_coordinator'
  | 'annexure_2'
  | 's37_2_mandatary'
  | 'principal_contractor';

export type AppointmentStatus = 'draft' | 'signed';

export interface AppointmentLetterTypeDef {
  value: AppointmentLetterType;
  label: string;
  statute: string;
  /** Default duties/scope wording, editable per letter. */
  defaultScope: string;
}

export const APPOINTMENT_LETTER_TYPES: AppointmentLetterTypeDef[] = [
  {
    value: 's16_2',
    label: 'Section 16(2) Appointment',
    statute: 'OHS Act 85/1993 s16(2)',
    defaultScope:
      'Appointed in terms of Section 16(2) of the Occupational Health and Safety Act to assist the Chief Executive Officer in discharging the duties imposed by Section 16(1), for the undertaking and premises identified below.',
  },
  {
    value: 's8_1',
    label: 'Section 8(1) Appointment',
    statute: 'OHS Act 85/1993 s8(1)',
    defaultScope:
      'Appointed to ensure, as far as is reasonably practicable, a safe working environment without risk to the health of employees, in terms of Section 8(1) of the Occupational Health and Safety Act.',
  },
  {
    value: 'construction_supervisor',
    label: 'Construction Supervisor (Reg 8(1))',
    statute: 'Construction Regulations 2014, Reg 8(1)',
    defaultScope:
      'Appointed as the full-time competent construction supervisor in terms of Construction Regulation 8(1), responsible for supervising the construction work on site and for the health and safety of all persons under their control.',
  },
  {
    value: 'annexure_3',
    label: 'Annexure 3 — H&S Agreement (Reg 5)',
    statute: 'Construction Regulations 2014, Reg 5(1)(k) / Annexure 3',
    defaultScope:
      'Agreement in terms of Construction Regulation 5(1)(k) between the client/principal contractor and the contractor, recording the health and safety arrangements and mandatory obligations for the project.',
  },
  {
    value: 's16_1',
    label: 'Section 16(1) Appointment',
    statute: 'OHS Act 85/1993 s16(1)',
    defaultScope:
      'Designated in terms of Section 16(1) of the Occupational Health and Safety Act as the person responsible for health and safety compliance at the identified site/undertaking, on behalf of the employer\'s Chief Executive Officer.',
  },
  {
    value: 'cr8_5',
    label: 'Fall Protection Equipment Appointment (Reg 8(5))',
    statute: 'Construction Regulations 2014, Reg 8(5)',
    defaultScope:
      'Appointed in terms of Construction Regulation 8(5), responsible for the provision, inspection and maintenance of full body harnesses and fall-arrest equipment used for work at height on site.',
  },
  {
    value: 'cr8_7',
    label: 'Medical Fitness for Working at Heights (Reg 8(7))',
    statute: 'Construction Regulations 2014, Reg 8(7)',
    defaultScope:
      'Appointed in terms of Construction Regulation 8(7), responsible for ensuring all workers engaged in work at height hold valid medical fitness certificates before being permitted to work.',
  },
  {
    value: 'cr9_1_risk_assessor',
    label: 'Risk Assessor (Reg 9(1))',
    statute: 'Construction Regulations 2014, Reg 9(1)',
    defaultScope:
      'Appointed in terms of Construction Regulation 9(1) as the competent person responsible for compiling and maintaining the baseline and task-specific risk assessments for the site.',
  },
  {
    value: 'cr10_fall_protection_planner',
    label: 'Fall Protection Planner (Reg 10(1)(a))',
    statute: 'Construction Regulations 2014, Reg 10(1)(a)',
    defaultScope:
      'Appointed in terms of Construction Regulation 10(1)(a) as the competent person responsible for compiling and maintaining the fall protection plan for work at height on site.',
  },
  {
    value: 'cr13_excavation_supervisor',
    label: 'Excavation Supervisor (Reg 13)',
    statute: 'Construction Regulations 2014, Reg 13',
    defaultScope:
      'Appointed in terms of Construction Regulation 13 as the competent person responsible for supervising excavation work, including shoring, inspection and safe access/egress.',
  },
  {
    value: 'cr23_mobile_plant_operator',
    label: 'Mobile Plant Operator / Inspector (Reg 23(1)(d)(i)(k))',
    statute: 'Construction Regulations 2014, Reg 23(1)(d)(i)(k)',
    defaultScope:
      'Appointed in terms of Construction Regulation 23(1)(d)(i)(k), responsible for the safe operation and daily pre-use inspection of mobile plant and construction vehicles on site.',
  },
  {
    value: 'cr28a_stacking_storage',
    label: 'Stacking and Storage Supervisor (Reg 28(a))',
    statute: 'Construction Regulations 2014, Reg 28(a)',
    defaultScope:
      'Appointed in terms of Construction Regulation 28(a), responsible for supervising the safe stacking, storage and handling of materials on site.',
  },
  {
    value: 'cr29h_firefighting_inspector',
    label: 'Fire-fighting Equipment Inspector (Reg 29(h))',
    statute: 'Construction Regulations 2014, Reg 29(h)',
    defaultScope:
      'Appointed in terms of Construction Regulation 29(h), responsible for the inspection and maintenance of fire-fighting equipment on site.',
  },
  {
    value: 'gsr3_4_first_aid',
    label: 'First Aid Appointment (GSR 3(4))',
    statute: 'General Safety Regulations, Reg 3(4)',
    defaultScope:
      'Appointed in terms of General Safety Regulation 3(4) as the designated first aider, responsible for providing and maintaining first aid facilities and equipment on site.',
  },
  {
    value: 'gsr13a_ladder_inspector',
    label: 'Ladder Inspector (GSR 13A)',
    statute: 'General Safety Regulations, Reg 13A',
    defaultScope:
      'Appointed in terms of General Safety Regulation 13A, responsible for inspecting ladders on site for safe condition before use.',
  },
  {
    value: 'emr10_4_electrical_inspector',
    label: 'Electrical Equipment Inspector (EMR 10(4))',
    statute: 'Electrical Machinery Regulations, Reg 10(4)',
    defaultScope:
      'Appointed in terms of Electrical Machinery Regulation 10(4), responsible for the inspection and testing of electrical machinery and equipment on site for safe condition.',
  },
  {
    value: 'gar9_2_incident_investigator',
    label: 'Incident Investigator (GAR 9(2))',
    statute: 'General Administrative Regulations, Reg 9(2)',
    defaultScope:
      'Appointed in terms of General Administrative Regulation 9(2), responsible for investigating incidents, near misses and accidents on site and compiling investigation findings.',
  },
  {
    value: 'section8_hand_tools_inspector',
    label: 'Hand Tools Inspector (Section 8)',
    statute: 'General Safety Regulations, Section 8',
    defaultScope:
      'Appointed in terms of General Safety Regulations Section 8, responsible for inspecting hand tools on site for safe condition before use.',
  },
  {
    value: 'chemical_control_coordinator',
    label: 'Chemical Control Co-ordinator',
    statute: 'Hazardous Chemical Substances Regulations',
    defaultScope:
      'Appointed as the Chemical Control Co-ordinator responsible for the control, storage and safe handling of hazardous chemical substances on site, in terms of the Hazardous Chemical Substances Regulations.',
  },
  {
    value: 'annexure_2',
    label: 'Annexure 2 — Notification of Construction Work',
    statute: 'Construction Regulations 2014, Reg 4 / Annexure 2',
    defaultScope:
      'Notification of construction work in terms of Construction Regulation 4 and Annexure 2, submitted to the relevant labour authority prior to commencement of work on site.',
  },
  {
    value: 's37_2_mandatary',
    label: 'Section 37(2) Mandatary Agreement',
    statute: 'OHS Act 85/1993 s37(2)',
    defaultScope:
      'Agreement in terms of Section 37(2) of the Occupational Health and Safety Act whereby the mandatary accepts responsibility, on behalf of the employer, for compliance with the Act for the specific work performed.',
  },
  {
    value: 'principal_contractor',
    label: 'Principal Contractor Appointment',
    statute: 'Construction Regulations 2014, Reg 5(1)',
    defaultScope:
      'Appointed by the client in terms of Construction Regulation 5(1) as the principal contractor, responsible for the overall health and safety plan and coordination of all contractors on the construction site.',
  },
];

export function letterTypeDef(t: string): AppointmentLetterTypeDef | undefined {
  return APPOINTMENT_LETTER_TYPES.find((x) => x.value === t);
}

export interface AppointmentLetter {
  id: string;
  letter_type: AppointmentLetterType;
  reference_number: string;
  project_id: string | null;
  contractor_id: string | null;
  appointer_name: string | null;
  appointer_designation: string | null;
  appointee_name: string;
  appointee_designation: string | null;
  scope: string | null;
  appointment_date: string | null;
  effective_from: string | null;
  status: AppointmentStatus;
  signature_image: string | null;
  signature_name: string | null;
  signed_at: string | null;
  signed_by: string | null;
  signed_ip: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
