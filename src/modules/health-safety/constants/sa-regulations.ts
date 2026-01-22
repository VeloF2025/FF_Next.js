/**
 * South African H&S Regulations Reference
 *
 * Key regulations applicable to fibre installation and construction work.
 */

export interface RegulationReference {
  code: string;
  name: string;
  section: string;
  description: string;
  url?: string;
}

// Primary legislation
export const SA_REGULATIONS = {
  // Occupational Health and Safety Act
  OHS_ACT: {
    code: 'OHS Act 85/1993',
    name: 'Occupational Health and Safety Act',
    description: 'Primary legislation governing workplace health and safety in South Africa',
    sections: {
      s8: {
        section: 's8',
        title: 'General duties of employers',
        requirements: [
          'Provide safe working environment',
          'Provide necessary PPE',
          'Establish H&S policy',
          'Ensure employees are trained',
        ],
      },
      s14: {
        section: 's14',
        title: 'Duty to inform',
        requirements: [
          'Inform employees of hazards',
          'Provide safety instructions',
          'Display safety notices',
        ],
      },
      s24: {
        section: 's24',
        title: 'Report to inspector',
        requirements: [
          'Report incidents causing death within 24 hours',
          'Report serious injuries',
          'Preserve scene of incident',
        ],
      },
    },
  },

  // Construction Regulations
  CONSTRUCTION_REG: {
    code: 'Construction Regulations 2014',
    name: 'Construction Regulations',
    description: 'Regulations specific to construction activities under OHS Act',
    sections: {
      reg8: {
        section: 'Reg 8',
        title: 'Fall protection',
        requirements: [
          'Fall protection plan for work >2m height',
          'Full body harnesses for height work',
          'Anchor points must be load-tested',
          'Medical fitness certificates for height workers',
        ],
      },
      reg10: {
        section: 'Reg 10',
        title: 'Guardrails and safety barriers',
        requirements: [
          'Guardrails for elevated work areas',
          'Minimum 900mm height',
          'Toe boards where required',
        ],
      },
      reg13: {
        section: 'Reg 13',
        title: 'Ladders',
        requirements: [
          'Ladders secured at top and bottom',
          '4:1 angle ratio',
          'Extend 1m above landing',
          'Regular inspection required',
        ],
      },
      reg16: {
        section: 'Reg 16',
        title: 'Scaffolding',
        requirements: [
          'Erected by competent person',
          'Weekly inspections',
          'Safe working load displayed',
          'SANS 10085 compliance',
        ],
      },
      reg22: {
        section: 'Reg 22',
        title: 'Electrical installations',
        requirements: [
          'Safe working distance from power lines',
          'Lock-out/tag-out procedures',
          'Qualified persons only',
        ],
      },
      reg24: {
        section: 'Reg 24',
        title: 'Site security and access',
        requirements: [
          'Secure site perimeter',
          'Controlled access',
          'Safety signage',
        ],
      },
      reg29: {
        section: 'Reg 29',
        title: 'Fire precautions',
        requirements: [
          'Fire extinguishers on site',
          'Hot work permits',
          'Flammable material storage',
        ],
      },
      reg30: {
        section: 'Reg 30',
        title: 'Welfare facilities',
        requirements: [
          'Adequate toilet facilities',
          'Clean drinking water',
          'Shelter from weather',
        ],
      },
    },
  },

  // General Safety Regulations
  GENERAL_SAFETY_REG: {
    code: 'General Safety Regulations',
    name: 'General Safety Regulations',
    description: 'General workplace safety requirements',
    sections: {
      reg2: {
        section: 'Reg 2',
        title: 'Personal protective equipment',
        requirements: [
          'PPE provided by employer',
          'Training on PPE use',
          'PPE maintained in good condition',
        ],
      },
      reg3: {
        section: 'Reg 3',
        title: 'First aid',
        requirements: [
          'First aid kit on site',
          'Trained first aider',
          'Emergency contact numbers displayed',
        ],
      },
      reg9: {
        section: 'Reg 9',
        title: 'Emergency procedures',
        requirements: [
          'Emergency evacuation plan',
          'Regular drills',
          'Assembly points marked',
        ],
      },
    },
  },

  // SANS Standards
  SANS_10085: {
    code: 'SANS 10085',
    name: 'The safety of scaffolding',
    description: 'South African National Standard for scaffolding safety',
    sections: {
      part1: {
        section: 'Part 1',
        title: 'Scaffolding requirements',
        requirements: [
          'Design and erection standards',
          'Inspection requirements',
          'Load capacity marking',
        ],
      },
    },
  },
};

// Fibre-specific hazards (not in standard regulations)
export const FIBRE_HAZARDS = {
  glass_fibre: {
    hazard: 'Glass fibre splinters',
    description: 'Fibre optic glass is 125 microns - invisible to naked eye',
    risks: ['Eye injury', 'Skin penetration', 'Ingestion if eating in work area'],
    controls: [
      'Sealed waste containers for cleave waste',
      'No eating/drinking in splice area',
      'Safety glasses',
      'Gloves when handling bare fibre',
      'Black work mats to locate fibres',
    ],
  },
  laser_safety: {
    hazard: 'Laser radiation',
    description: 'OTDR and power meters use Class 1 or Class 3R lasers',
    risks: ['Eye damage from direct exposure', 'Cumulative exposure effects'],
    controls: [
      'Never look into fibre ends',
      'Laser safety glasses for Class 3R',
      'Warning signs on equipment',
      'Power off before opening connectors',
    ],
  },
  chemical_hazards: {
    hazard: 'Adhesives and cleaning chemicals',
    description: 'Epoxy adhesives, isopropyl alcohol, splice gel',
    risks: ['Skin irritation', 'Respiratory issues', 'Fire hazard'],
    controls: [
      'Adequate ventilation',
      'Nitrile gloves',
      'Eye protection',
      'MSDS sheets available',
      'Proper storage of flammables',
    ],
  },
  electrical_proximity: {
    hazard: 'Electrical proximity',
    description: 'Fibre cables often run near power lines',
    risks: ['Electrocution', 'Burns', 'Falls from shock'],
    controls: [
      'Maintain safe working distances',
      'Assume all lines are live',
      'Use non-conductive tools',
      'Check for power before climbing poles',
    ],
  },
};

// Department of Labour reporting requirements
export const DOL_REPORTING_REQUIREMENTS = {
  reportable_incidents: [
    'Any incident causing death',
    'Any incident causing permanent disability',
    'Any incident causing loss of limb or part of limb',
    'Any incident causing fractions of skull, spine, or pelvis',
    'Any incident causing loss of sight or hearing',
    'Any injury likely to cause death or permanent disability',
  ],
  reporting_timeline: '24 hours from incident',
  forms: {
    WCA_FORM_1: 'Report of accident/disease to Director-General',
    WCA_FORM_2: 'Report by employer',
  },
  authority: 'Department of Employment and Labour',
  contact: {
    phone: '0860 105 350',
    website: 'www.labour.gov.za',
  },
};

// Training requirements
export const TRAINING_REQUIREMENTS = {
  height_work: {
    name: 'Working at Heights',
    validity_months: 24,
    provider: 'Accredited training provider',
    prerequisite: 'Medical fitness certificate',
  },
  first_aid: {
    name: 'Level 1 First Aid',
    validity_months: 36,
    provider: 'Accredited training provider',
  },
  fire_fighting: {
    name: 'Basic Fire Fighting',
    validity_months: 24,
    provider: 'Accredited training provider',
  },
  induction: {
    name: 'Site Safety Induction',
    validity_months: 0, // Per site
    provider: 'Site manager',
  },
};
