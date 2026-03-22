// 🟢 WORKING: React Query hook for Assets Register report — Current + Fixed Assets
import { useQuery } from '@tanstack/react-query';

export interface AssetItem {
  date: string;
  description: string;
  category: string;
  amount: number;
  runningTotal: number;
}

export interface AssetsRegisterData {
  currentAssets: {
    items: AssetItem[];
    categorySummary: Record<string, number>;
  };
  fixedAssets: {
    total: number;
    byCategory: Record<string, number>;
    note: string;
  };
}

interface ApiResponse {
  success: boolean;
  data: AssetsRegisterData;
  meta: { generatedAt: string; sources: string[] };
  error?: { code: string; message: string };
}

async function fetchAssetsRegister(): Promise<ApiResponse> {
  const res = await fetch('/api/analytics/reports/assets-register');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiResponse;
    throw new Error(body.error?.message ?? 'Failed to load assets register');
  }
  return res.json() as Promise<ApiResponse>;
}

export function useAssetsRegisterData() {
  return useQuery<ApiResponse, Error>({
    queryKey: ['analytics', 'assets-register'],
    queryFn: fetchAssetsRegister,
    staleTime: 5 * 60 * 1000,
  });
}
