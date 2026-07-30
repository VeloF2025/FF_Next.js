import { ErrorCode } from '@/lib/apiResponse';

export class ProjectStatsError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ProjectStatsError';
  }
}
