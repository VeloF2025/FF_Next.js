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
  layers: Record<string, LayerPreview | undefined>;
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
