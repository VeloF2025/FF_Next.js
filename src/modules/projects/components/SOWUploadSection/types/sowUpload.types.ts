export interface SOWFile {
  type: 'poles' | 'drops' | 'fibre';
  file: File;
  status: 'pending' | 'processing' | 'success' | 'error';
  message?: string;
  data?: any[];
  summary?: {
    total: number;
    valid: number;
    invalid: number;
    warnings?: string[];
  };
}

export interface SOWUploadSectionProps {
  projectId: string;
  projectName: string;
  onComplete?: () => void;
  onDataUpdate?: (data: { poles?: any[]; drops?: any[]; fibre?: any[] }) => void;
  showActions?: boolean;
}

export interface FileTypeConfig {
  type: 'poles' | 'drops' | 'fibre';
  title: string;
  description: string;
  icon: any;
  color: string;
  bgColor: string;
  borderColor: string;
  requiredColumns: string[];
  sampleData: any[];
}

export const FILE_TYPE_CONFIGS: FileTypeConfig[] = [
  {
    type: 'poles',
    title: 'Poles Data',
    description: 'Excel file with pole numbers, coordinates, and capacity',
    icon: null, // Will be set in component
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    requiredColumns: ['label_1 or pole_number', 'lat', 'lon'],
    // Sample uses PlanNet/Fibertime format - standard names also accepted
    sampleData: [
      { label_1: 'TEM.P.A001', type_1: 'Pole', lat: -33.9249, lon: 18.4241, pon_no: 1, zone_no: 1 },
      { label_1: 'TEM.P.A002', type_1: 'Pole', lat: -33.9251, lon: 18.4243, pon_no: 1, zone_no: 1 }
    ]
  },
  {
    type: 'drops',
    title: 'Drops Data',
    description: 'Excel file with drop numbers, addresses, and pole assignments',
    icon: null,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    requiredColumns: ['label (drop) or drop_number'],
    // Sample uses PlanNet/Fibertime format - standard names also accepted
    sampleData: [
      { 'label (drop)': 'DR2612776', type: 'Cable', subtyp: 'Drop', dim2: '30m', cblcpty: '1F', 'strtfeat (Pole)': 'TEM.P.A001', endfeat: 'ONT.001', lat: -33.9249, lon: 18.4241, pon_no: 1, zone_no: 1 },
      { 'label (drop)': 'DR2612777', type: 'Cable', subtyp: 'Drop', dim2: '25m', cblcpty: '1F', 'strtfeat (Pole)': 'TEM.P.A001', endfeat: 'ONT.002', lat: -33.9251, lon: 18.4243, pon_no: 1, zone_no: 1 }
    ]
  },
  {
    type: 'fibre',
    title: 'Fibre Scope',
    description: 'Excel file with cable segments, distances, and types',
    icon: null,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    requiredColumns: ['segment_id or label', 'cable size', 'length'],
    sampleData: [
      { label: 'S001', 'cable size': '48F', layer: 'Backbone', length: 150, pon_no: 1, zone_no: 1 },
      { label: 'S002', 'cable size': '24F', layer: 'Distribution', length: 200, pon_no: 1, zone_no: 2 }
    ]
  }
];