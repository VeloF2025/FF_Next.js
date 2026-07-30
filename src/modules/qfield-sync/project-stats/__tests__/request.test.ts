import { describe, expect, it } from 'vitest';
import { ProjectStatsError } from '../errors';
import { parseProjectStatsQuery } from '../request';

describe('parseProjectStatsQuery', () => {
  it('defaults to a bounded summary request', () => {
    expect(parseProjectStatsQuery({ project: 'Mahikeng' })).toEqual({
      project: 'Mahikeng',
      section: 'summary',
      page: 1,
      limit: 50,
    });
  });

  it.each([
    [{}, 'project is required'],
    [{ project: 'Mahikeng', section: 'raw' }, 'section must be one of'],
    [{ project: 'Mahikeng', page: '0' }, 'page must be a positive integer'],
    [{ project: 'Mahikeng', page: '9007199254740992' }, 'page must be a positive integer'],
    [{ project: 'Mahikeng', page: '9'.repeat(400) }, 'page must be a positive integer'],
    [{ project: 'Mahikeng', limit: '101' }, 'limit must be between 1 and 100'],
    [{ project: 'x'.repeat(201) }, 'project must be 200 characters or fewer'],
  ])('rejects invalid query %#', (query, message) => {
    expect(() => parseProjectStatsQuery(query)).toThrowError(ProjectStatsError);
    expect(() => parseProjectStatsQuery(query)).toThrow(message);
  });
});
