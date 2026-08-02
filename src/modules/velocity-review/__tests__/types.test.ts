import { expect, it } from 'vitest';
import { CANDIDATE_SOURCES, type CandidateSource } from '../types';

it('exposes the approved stable candidate-source vocabulary', () => {
  const sources: CandidateSource[] = [...CANDIDATE_SOURCES];

  expect(sources).toEqual([
    'dr_submitted',
    'drops_installed',
    'stock_installed',
    'oes_activated',
    'pp_activated',
    'olt_mismatch_created',
  ]);
});
