/**
 * H&S statutory appointment letter types (goal Phase 5)
 *
 * The fixed OHS Act / Construction Regulations appointment set. Not a catalogue
 * table — these are defined in law, so they live in code with their default
 * scope wording.
 */

export type AppointmentLetterType = 's16_2' | 's8_1' | 'construction_supervisor' | 'annexure_3';

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
