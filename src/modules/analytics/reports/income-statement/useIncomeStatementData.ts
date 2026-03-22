// 🟢 WORKING: React Query hook for Income Statement report
import { useQuery } from '@tanstack/react-query';

export interface IncomeStatementRow {
  label: string;
  fy26: number;
  fy27: number;
  fy28: number;
  monthly: Record<string, number>;
  isHeader?: boolean;
  isBold?: boolean;
  isTotal?: boolean;
  isIndented?: boolean;
}

export interface IncomeStatementData {
  rows: IncomeStatementRow[];
  months: string[];
}

interface ApiResponse {
  success: boolean;
  data: IncomeStatementData;
  meta: { generatedAt: string; sources: string[] };
  error?: { code: string; message: string };
}

async function fetchIncomeStatement(): Promise<ApiResponse> {
  const res = await fetch('/api/analytics/reports/income-statement');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiResponse;
    throw new Error(body.error?.message ?? 'Failed to load income statement');
  }
  return res.json() as Promise<ApiResponse>;
}

export function useIncomeStatementData() {
  return useQuery<ApiResponse, Error>({
    queryKey: ['analytics', 'income-statement'],
    queryFn: fetchIncomeStatement,
    staleTime: 5 * 60 * 1000,
  });
}
