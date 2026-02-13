export interface GpkgFile {
  name: string;
  size: string;
  lastModified: string;
}

export interface LayerPreview {
  count: number;
  sample_fields: string[];
}

export interface GpkgPreviewResult {
  layers: {
    poles?: LayerPreview;
    joints?: LayerPreview;
    cable_spans?: LayerPreview;
    drops?: LayerPreview;
    zone_boundaries?: LayerPreview;
    pon_boundaries?: LayerPreview;
    pops?: LayerPreview;
  };
}

export type ImportMode = 'merge' | 'replace';

export type LayerType =
  | 'poles'
  | 'joints'
  | 'cable_spans'
  | 'drops'
  | 'zone_boundaries'
  | 'pon_boundaries'
  | 'pops';

export interface LayerResult {
  created: number;
  updated: number;
}

export interface ImportResult {
  jobId: string;
  results: Partial<Record<LayerType, LayerResult>>;
}

export type ImportPhase = 'select' | 'preview' | 'importing' | 'complete';
