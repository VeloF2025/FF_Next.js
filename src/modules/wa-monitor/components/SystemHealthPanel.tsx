/**
 * System Health Panel Component
 * Displays real-time health status of all WA Monitor components
 */

'use client';

import React, { useState, useEffect } from 'react';
import { log } from '@/lib/logger';
import {
  Card,
  CardContent,
  CardHeader,
  Typography,
  Box,
  Button,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  RefreshCw,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Clock,
  Server,
  Database,
  Globe,
  Activity,
} from 'lucide-react';

interface HealthCheck {
  status: 'up' | 'down' | 'degraded' | 'stale';
  details: Record<string, unknown>;
  latency_ms?: number;
  error?: string;
}

interface HealthData {
  overall_status: 'healthy' | 'degraded' | 'down';
  timestamp: string;
  checks: {
    vps: {
      whatsapp_bridge: HealthCheck;
      drop_monitor_prod: HealthCheck;
      drop_monitor_dev: HealthCheck;
      log_activity: HealthCheck;
    };
    database: {
      connection: HealthCheck;
      table_exists: HealthCheck;
      recent_data: HealthCheck;
    };
    api: {
      get_drops: HealthCheck;
      get_daily_drops: HealthCheck;
    };
  };
}

interface SystemHealthPanelProps {
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
  compact?: boolean;
}

export function SystemHealthPanel({
  autoRefresh = true,
  refreshInterval = 30000,
  compact: _compact = false,
}: SystemHealthPanelProps) {
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  const fetchHealthData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/wa-monitor-health');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Health check failed');

      setHealthData(data.data);
      setLastCheck(new Date());
    } catch (err) {
      log.error('Health check error', { error: err instanceof Error ? err.message : String(err) }, 'SystemHealthPanel');
      setError(err instanceof Error ? err.message : 'Failed to fetch health data');
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchHealthData();
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(fetchHealthData, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval]);

  const getOverallStatusIndicator = (status: HealthData['overall_status']): { emoji: string; text: string; color: 'success' | 'warning' | 'error' } => {
    switch (status) {
      case 'healthy':
        return { emoji: '🟢', text: 'ALL SYSTEMS OPERATIONAL', color: 'success' };
      case 'degraded':
        return { emoji: '🟡', text: 'SYSTEM DEGRADED', color: 'warning' };
      case 'down':
        return { emoji: '🔴', text: 'SYSTEM DOWN', color: 'error' };
    }
  };

  if (loading && !healthData) {
    return (
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="center" alignItems="center" minHeight={200}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    );
  }

  if (error && !healthData) {
    return (
      <Card>
        <CardContent>
          <Alert severity="error" icon={<AlertCircle />}>
            <Typography variant="body2">Failed to load health status: {error}</Typography>
            <Button size="small" onClick={fetchHealthData} sx={{ mt: 1 }}>
              Retry
            </Button>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!healthData) return null;

  const overallIndicator = getOverallStatusIndicator(healthData.overall_status);

  return (
    <Card sx={{ mb: 3, border: '2px solid', borderColor: `${overallIndicator.color}.main` }}>
      <CardHeader
        title={
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center" gap={1}>
              <Activity size={24} />
              <Typography variant="h6">WA Monitor System Health</Typography>
            </Box>
            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshCw size={16} />}
              onClick={fetchHealthData}
              disabled={loading}
            >
              Refresh
            </Button>
          </Box>
        }
        subheader={
          <Typography variant="caption" color="textSecondary">
            Last checked: {lastCheck ? lastCheck.toLocaleTimeString() : 'Never'} •{' '}
            Auto-refresh: {autoRefresh ? `${refreshInterval / 1000}s` : 'Off'}
          </Typography>
        }
      />

      <CardContent>
        {/* Overall Status */}
        <Alert severity={overallIndicator.color} icon={<span style={{ fontSize: '24px' }}>{overallIndicator.emoji}</span>} sx={{ mb: 3, fontWeight: 'bold' }}>
          <Typography variant="h6">{overallIndicator.text}</Typography>
        </Alert>

        {/* VPS Services */}
        <Accordion defaultExpanded={healthData.overall_status !== 'healthy'}>
          <AccordionSummary expandIcon={<ChevronDown />}>
            <Box display="flex" alignItems="center" gap={1}>
              <Server size={20} />
              <Typography variant="subtitle1" fontWeight="medium">
                VPS Services
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box display="flex" flexDirection="column" gap={1.5}>
              <ServiceCheckItem
                name="WhatsApp Bridge"
                check={healthData.checks.vps.whatsapp_bridge}
              />
              <ServiceCheckItem
                name="Drop Monitor Prod"
                check={healthData.checks.vps.drop_monitor_prod}
              />
              <ServiceCheckItem
                name="Drop Monitor Dev"
                check={healthData.checks.vps.drop_monitor_dev}
              />
              <ServiceCheckItem
                name="Log Activity"
                check={healthData.checks.vps.log_activity}
              />
            </Box>
          </AccordionDetails>
        </Accordion>

        {/* Database */}
        <Accordion defaultExpanded={healthData.overall_status !== 'healthy'}>
          <AccordionSummary expandIcon={<ChevronDown />}>
            <Box display="flex" alignItems="center" gap={1}>
              <Database size={20} />
              <Typography variant="subtitle1" fontWeight="medium">
                Database
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box display="flex" flexDirection="column" gap={1.5}>
              <ServiceCheckItem
                name="Neon PostgreSQL Connection"
                check={healthData.checks.database.connection}
              />
              <ServiceCheckItem
                name="Table Access"
                check={healthData.checks.database.table_exists}
              />
              <ServiceCheckItem
                name="Recent Activity"
                check={healthData.checks.database.recent_data}
              />
            </Box>
          </AccordionDetails>
        </Accordion>

        {/* API Endpoints */}
        <Accordion defaultExpanded={healthData.overall_status !== 'healthy'}>
          <AccordionSummary expandIcon={<ChevronDown />}>
            <Box display="flex" alignItems="center" gap={1}>
              <Globe size={20} />
              <Typography variant="subtitle1" fontWeight="medium">
                API Endpoints
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box display="flex" flexDirection="column" gap={1.5}>
              <ServiceCheckItem name="GET /wa-monitor-drops" check={healthData.checks.api.get_drops} />
              <ServiceCheckItem
                name="GET /wa-monitor-daily-drops"
                check={healthData.checks.api.get_daily_drops}
              />
            </Box>
          </AccordionDetails>
        </Accordion>
      </CardContent>
    </Card>
  );
}

// Individual service check item
function ServiceCheckItem({ name, check }: { name: string; check: HealthCheck }) {
  const indicator = getStatusIndicator(check.status);

  return (
    <Box>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={0.5}>
        <Box display="flex" alignItems="center" gap={1}>
          <Box color={`${indicator.color}.main`}>{indicator.icon}</Box>
          <Typography variant="body2" fontWeight="medium">
            {name}
          </Typography>
        </Box>
        <Box display="flex" alignItems="center" gap={1}>
          {check.latency_ms && (
            <Typography variant="caption" color="textSecondary">
              {check.latency_ms}ms
            </Typography>
          )}
          <Chip label={indicator.label} size="small" color={indicator.color} />
        </Box>
      </Box>

      {/* Details */}
      {check.details && Object.keys(check.details).length > 0 && (
        <Box sx={{ pl: 4, mt: 0.5 }}>
          {Object.entries(check.details).map(([key, value]) => (
            <Typography key={key} variant="caption" color="textSecondary" display="block">
              {key.replace(/_/g, ' ')}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </Typography>
          ))}
        </Box>
      )}

      {/* Error */}
      {check.error && (
        <Alert severity="error" sx={{ mt: 1, py: 0.5 }}>
          <Typography variant="caption">{check.error}</Typography>
        </Alert>
      )}
    </Box>
  );
}

type ChipColor = 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';

function getStatusIndicator(status: HealthCheck['status']): { icon: React.ReactNode; color: ChipColor; label: string } {
  switch (status) {
    case 'up':
      return { icon: <CheckCircle2 size={16} />, color: 'success', label: 'UP' };
    case 'degraded':
      return { icon: <AlertCircle size={16} />, color: 'warning', label: 'DEGRADED' };
    case 'stale':
      return { icon: <Clock size={16} />, color: 'warning', label: 'STALE' };
    case 'down':
      return { icon: <XCircle size={16} />, color: 'error', label: 'DOWN' };
    default:
      return { icon: <AlertCircle size={16} />, color: 'default', label: 'UNKNOWN' };
  }
}
