/**
 * Overview Tab Component
 * Shows summary statistics and recent activity
 */

'use client';

import { Box, Card, CardContent, Grid, Typography, Button, Chip, LinearProgress } from '@mui/material';
import { ArrowRight, TrendingUp, TrendingDown, Clock, Activity } from 'lucide-react';
import type { QAStats, ActionType } from '../types';
import { formatDistanceToNow } from 'date-fns';

interface OverviewTabProps {
  stats: QAStats | null;
  recentActivity: Array<{
    action_type: ActionType;
    action_by: string;
    action_at: string;
    notes: string | null;
  }>;
  onViewAll: () => void;
}

export function OverviewTab({ stats, recentActivity, onViewAll }: OverviewTabProps) {
  if (!stats) return null;

  const totalValidated = stats.ai_confidence.high_confidence + stats.ai_confidence.medium_confidence + stats.ai_confidence.low_confidence;
  const passRate = totalValidated > 0
    ? ((stats.ai_confidence.high_confidence + stats.ai_confidence.medium_confidence) / totalValidated * 100).toFixed(1)
    : '0';

  return (
    <Box>
      {/* Work Type Stats */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        By Work Type
      </Typography>
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {stats.by_work_type.map((wt) => {
          const total = wt.total || 1;
          const approvedPercent = (wt.approved / total) * 100;
          const rejectedPercent = (wt.rejected / total) * 100;
          const pendingPercent = (wt.pending / total) * 100;

          return (
            <Grid item xs={12} sm={6} md={3} key={wt.work_type}>
              <Card>
                <CardContent>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                    {formatWorkType(wt.work_type)}
                  </Typography>
                  <Typography variant="h4" fontWeight="bold" sx={{ mb: 1 }}>
                    {wt.total}
                  </Typography>
                  <Box sx={{ mb: 1 }}>
                    <Box sx={{ display: 'flex', height: 8, borderRadius: 1, overflow: 'hidden' }}>
                      <Box sx={{ width: `${approvedPercent}%`, bgcolor: 'success.main' }} />
                      <Box sx={{ width: `${rejectedPercent}%`, bgcolor: 'error.main' }} />
                      <Box sx={{ width: `${pendingPercent}%`, bgcolor: 'warning.main' }} />
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span style={{ color: '#22c55e' }}>{wt.approved} approved</span>
                    <span style={{ color: '#ef4444' }}>{wt.rejected} rejected</span>
                  </Box>
                  {wt.avg_confidence && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      Avg confidence: {(parseFloat(wt.avg_confidence) * 100).toFixed(0)}%
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {/* AI Validation Stats */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        AI Validation Summary
      </Typography>
      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Confidence Distribution
                </Typography>
                <Chip
                  label={`${passRate}% Pass Rate`}
                  color={parseFloat(passRate) > 70 ? 'success' : parseFloat(passRate) > 50 ? 'warning' : 'error'}
                  size="small"
                />
              </Box>
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2">High Confidence (80%+)</Typography>
                  <Typography variant="body2" fontWeight="bold" color="success.main">
                    {stats.ai_confidence.high_confidence}
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={(stats.ai_confidence.high_confidence / (totalValidated || 1)) * 100}
                  sx={{ height: 8, borderRadius: 1, bgcolor: 'grey.200', '& .MuiLinearProgress-bar': { bgcolor: 'success.main' } }}
                />
              </Box>
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2">Medium Confidence (60-80%)</Typography>
                  <Typography variant="body2" fontWeight="bold" color="warning.main">
                    {stats.ai_confidence.medium_confidence}
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={(stats.ai_confidence.medium_confidence / (totalValidated || 1)) * 100}
                  sx={{ height: 8, borderRadius: 1, bgcolor: 'grey.200', '& .MuiLinearProgress-bar': { bgcolor: 'warning.main' } }}
                />
              </Box>
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2">Low Confidence (&lt;60%)</Typography>
                  <Typography variant="body2" fontWeight="bold" color="error.main">
                    {stats.ai_confidence.low_confidence}
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={(stats.ai_confidence.low_confidence / (totalValidated || 1)) * 100}
                  sx={{ height: 8, borderRadius: 1, bgcolor: 'grey.200', '& .MuiLinearProgress-bar': { bgcolor: 'error.main' } }}
                />
              </Box>
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2">Not Validated</Typography>
                  <Typography variant="body2" fontWeight="bold" color="text.secondary">
                    {stats.ai_confidence.not_validated}
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={(stats.ai_confidence.not_validated / (stats.summary.total || 1)) * 100}
                  sx={{ height: 8, borderRadius: 1, bgcolor: 'grey.200', '& .MuiLinearProgress-bar': { bgcolor: 'grey.500' } }}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
                Priority Queue
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <PriorityBadge label="Urgent" count={stats.by_priority.urgent} color="#dc2626" />
                <PriorityBadge label="High" count={stats.by_priority.high} color="#f97316" />
                <PriorityBadge label="Normal" count={stats.by_priority.normal} color="#3b82f6" />
                <PriorityBadge label="Low" count={stats.by_priority.low} color="#6b7280" />
              </Box>

              {stats.summary.overdue > 0 && (
                <Box sx={{ mt: 3, p: 2, bgcolor: 'error.light', borderRadius: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Clock className="w-5 h-5 text-red-600" />
                    <Typography variant="body2" fontWeight="bold" color="error.dark">
                      {stats.summary.overdue} overdue items
                    </Typography>
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Recent Activity */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">
          Recent Activity
        </Typography>
        <Button variant="text" endIcon={<ArrowRight className="w-4 h-4" />} onClick={onViewAll}>
          View All Photos
        </Button>
      </Box>
      <Card>
        <CardContent sx={{ p: 0 }}>
          {recentActivity.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Activity className="w-8 h-8 mx-auto mb-2 text-gray-400" />
              <Typography color="text.secondary">No recent activity</Typography>
            </Box>
          ) : (
            <Box>
              {recentActivity.slice(0, 5).map((activity, index) => (
                <Box
                  key={index}
                  sx={{
                    px: 3,
                    py: 2,
                    borderBottom: index < recentActivity.length - 1 ? '1px solid' : 'none',
                    borderColor: 'divider',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <ActionIcon action={activity.action_type} />
                    <Box>
                      <Typography variant="body2">
                        <strong>{activity.action_by}</strong>
                        {' '}
                        {formatAction(activity.action_type)}
                      </Typography>
                      {activity.notes && (
                        <Typography variant="caption" color="text.secondary">
                          {activity.notes}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {formatDistanceToNow(new Date(activity.action_at), { addSuffix: true })}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

function PriorityBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <Box sx={{ textAlign: 'center', minWidth: 80 }}>
      <Box
        sx={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mx: 'auto',
          mb: 0.5,
          bgcolor: `${color}20`,
          border: `2px solid ${color}`,
        }}
      >
        <Typography variant="h6" sx={{ color, fontWeight: 'bold' }}>
          {count}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

function ActionIcon({ action }: { action: ActionType }) {
  const iconClass = "w-5 h-5";
  switch (action) {
    case 'approve':
      return <Box sx={{ color: 'success.main' }}><TrendingUp className={iconClass} /></Box>;
    case 'reject':
      return <Box sx={{ color: 'error.main' }}><TrendingDown className={iconClass} /></Box>;
    case 'escalate':
      return <Box sx={{ color: 'warning.main' }}><Activity className={iconClass} /></Box>;
    default:
      return <Box sx={{ color: 'text.secondary' }}><Activity className={iconClass} /></Box>;
  }
}

function formatAction(action: ActionType): string {
  switch (action) {
    case 'approve': return 'approved a photo';
    case 'reject': return 'rejected a photo';
    case 'escalate': return 'escalated a photo';
    case 'assign': return 'assigned a photo';
    case 'revalidate': return 'triggered re-validation';
    case 'comment': return 'added a comment';
    default: return 'performed an action';
  }
}

function formatWorkType(workType: string): string {
  switch (workType) {
    case 'pole_installation': return 'Pole Installation';
    case 'cable_stringing': return 'Cable Stringing';
    case 'dome_joint': return 'Dome Joint';
    case 'activation': return 'Activation';
    default: return workType.charAt(0).toUpperCase() + workType.slice(1).replace(/_/g, ' ');
  }
}

export default OverviewTab;
