import { useState, useEffect, useCallback } from 'react';
import { log } from '@/lib/logger';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/shared/components/ui/Badge';
import { Button } from '@/shared/components/ui/Button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/Select';
import type { TrainingDrop } from '@/modules/vlm-training/services/trainingDataService';

const PAGE_SIZE = 50;

interface ListResponse {
  success: boolean;
  data: TrainingDrop[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  regions: string[];
}

function stepBadgeColor(count: number): string {
  if (count >= 9) return 'bg-green-500/20 text-green-400 border-green-500/30';
  if (count >= 8) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  return 'bg-red-500/20 text-red-400 border-red-500/30';
}

export default function VlmTrainingSamplePage() {
  const router = useRouter();
  const [drops, setDrops] = useState<TrainingDrop[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [regions, setRegions] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [region, setRegion] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDrops = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        activeOnly: 'true',
      });
      if (region !== 'all') params.set('region', region);

      const res = await fetch(`/api/vlm-training/list?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json: ListResponse = await res.json();

      setDrops(json.data);
      setTotal(json.pagination.total);
      setTotalPages(json.pagination.totalPages);
      if (json.regions.length) setRegions(json.regions);
    } catch (err) {
      log.error('Failed to load training drops', { err }, 'vlm-training');
      setError('Failed to load training drops');
    } finally {
      setLoading(false);
    }
  }, [page, region]);

  useEffect(() => { fetchDrops(); }, [fetchDrops]);

  const handleRegionChange = (val: string) => {
    setRegion(val);
    setPage(1);
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-foreground">VLM Training Sample</h1>
              <p className="text-muted-foreground mt-1">
                Fibertime national installation dataset — {total.toLocaleString()} drops
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                
                onClick={() => window.open('/api/vlm-training/report', '_blank')}
              >
                Export PDF Report
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-4 mb-6">
            <Select value={region} onValueChange={handleRegionChange}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All regions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All regions</SelectItem>
                {regions.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              {total.toLocaleString()} drops
            </span>
          </div>

          {/* Table */}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 mb-6 text-destructive">
              {error}
            </div>
          )}

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Drop #</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Region</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Photos</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Installer</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Source</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-muted animate-pulse rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : drops.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                      No drops found. Run the ingestion script to populate this dataset.
                    </td>
                  </tr>
                ) : (
                  drops.map((drop) => (
                    <tr
                      key={drop.drop_number as string}
                      className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => router.push(`/admin/vlm-training/${drop.drop_number}`)}
                    >
                      <td className="px-4 py-3 font-mono text-foreground font-medium">
                        {drop.drop_number as string}
                      </td>
                      <td className="px-4 py-3 text-foreground">{drop.region as string}</td>
                      <td className="px-4 py-3">
                        <Badge
                          className={stepBadgeColor(drop.core_steps_present as number)}
                          variant="outline"
                        >
                          {drop.core_steps_present as number}/9 core
                          {(drop.dome_steps_present as number) > 0
                            ? ` +${drop.dome_steps_present as number} dome`
                            : ''}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {(drop.installer_name as string | null) ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {drop.installation_date
                          ? new Date(drop.installation_date as string).toLocaleDateString('en-ZA')
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="text-xs">
                          {drop.source as string}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" >View →</Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  
                  disabled={page === totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
