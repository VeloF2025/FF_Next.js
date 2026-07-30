import type { ParsedUrlQuery } from 'querystring';
import { ErrorCode } from '@/lib/apiResponse';
import { ProjectStatsError } from './errors';
import {
  PROJECT_STATS_SECTIONS,
  type ProjectStatsQuery,
  type ProjectStatsSection,
} from './types';

function scalar(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(
  name: 'page' | 'limit',
  value: string | undefined,
  fallback: number
): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ProjectStatsError(ErrorCode.BAD_REQUEST, `${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ProjectStatsError(ErrorCode.BAD_REQUEST, `${name} must be a positive integer`);
  }
  return parsed;
}

export function parseProjectStatsQuery(query: ParsedUrlQuery): ProjectStatsQuery {
  const project = scalar(query.project)?.trim();
  if (!project) {
    throw new ProjectStatsError(ErrorCode.BAD_REQUEST, 'project is required');
  }
  if (project.length > 200) {
    throw new ProjectStatsError(
      ErrorCode.BAD_REQUEST,
      'project must be 200 characters or fewer'
    );
  }

  const requestedSection = scalar(query.section) ?? 'summary';
  if (!PROJECT_STATS_SECTIONS.includes(requestedSection as ProjectStatsSection)) {
    throw new ProjectStatsError(
      ErrorCode.BAD_REQUEST,
      `section must be one of ${PROJECT_STATS_SECTIONS.join(', ')}`
    );
  }

  const page = positiveInteger('page', scalar(query.page), 1);
  const limit = positiveInteger('limit', scalar(query.limit), 50);
  if (limit > 100) {
    throw new ProjectStatsError(ErrorCode.BAD_REQUEST, 'limit must be between 1 and 100');
  }

  return { project, section: requestedSection as ProjectStatsSection, page, limit };
}
