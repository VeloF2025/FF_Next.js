/**
 * Photo Detail Modal
 * Full photo view with AI validation results and manual review actions
 */

'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Grid,
  Typography,
  Button,
  IconButton,
  Chip,
  TextField,
  Divider,
  Card,
  CardContent,
  LinearProgress,
  Alert,
} from '@mui/material';
import {
  X,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RotateCw,
  Send,
  MapPin,
  Calendar,
  User,
  Clock,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { qfieldQaApiService } from '../services/qfieldQaApiService';
import type { PhotoValidation, WorkflowStatus } from '../types';
import { format } from 'date-fns';

interface PhotoDetailModalProps {
  photo: PhotoValidation;
  open: boolean;
  onClose: () => void;
  onApprove: (notes?: string) => Promise<void>;
  onReject: (notes?: string) => Promise<void>;
  onEscalate: (reason: string) => Promise<void>;
  onRevalidate: () => Promise<void>;
}

export function PhotoDetailModal({
  photo,
  open,
  onClose,
  onApprove,
  onReject,
  onEscalate,
  onRevalidate,
}: PhotoDetailModalProps) {
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoUrl = qfieldQaApiService.getPhotoUrl(photo.photo_key);
  const filename = photo.photo_key.split('/').pop() || photo.photo_key;
  const confidence = photo.vlm_confidence !== null ? (photo.vlm_confidence * 100).toFixed(0) : null;

  const handleAction = async (action: 'approve' | 'reject' | 'escalate' | 'revalidate') => {
    setLoading(true);
    setError(null);
    try {
      switch (action) {
        case 'approve':
          await onApprove(notes || undefined);
          break;
        case 'reject':
          await onReject(notes || undefined);
          break;
        case 'escalate':
          if (!notes) {
            setError('Please provide a reason for escalation');
            setLoading(false);
            return;
          }
          await onEscalate(notes);
          break;
        case 'revalidate':
          await onRevalidate();
          break;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{ sx: { minHeight: '80vh' } }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6">Photo Detail</Typography>
          <StatusChip status={photo.workflow_status} />
          {photo.priority !== 'normal' && (
            <Chip
              label={photo.priority.toUpperCase()}
              size="small"
              color={photo.priority === 'urgent' ? 'error' : photo.priority === 'high' ? 'warning' : 'default'}
            />
          )}
        </Box>
        <IconButton onClick={onClose}>
          <X className="w-5 h-5" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Grid container spacing={3}>
          {/* Photo */}
          <Grid item xs={12} md={6}>
            <Box
              sx={{
                width: '100%',
                height: 400,
                bgcolor: 'grey.900',
                borderRadius: 1,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={photoUrl}
                alt={filename}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {filename}
            </Typography>
          </Grid>

          {/* Details */}
          <Grid item xs={12} md={6}>
            {/* AI Validation Card */}
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="subtitle1" fontWeight="bold">
                    AI Validation
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<RotateCw className="w-4 h-4" />}
                    onClick={() => handleAction('revalidate')}
                    disabled={loading}
                  >
                    Re-validate
                  </Button>
                </Box>

                {confidence !== null ? (
                  <>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                      <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h3" fontWeight="bold" sx={{ color: getConfidenceColor(photo.vlm_confidence || 0) }}>
                          {confidence}%
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Confidence
                        </Typography>
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <LinearProgress
                          variant="determinate"
                          value={photo.vlm_confidence ? photo.vlm_confidence * 100 : 0}
                          sx={{
                            height: 10,
                            borderRadius: 5,
                            bgcolor: 'grey.200',
                            '& .MuiLinearProgress-bar': {
                              bgcolor: getConfidenceColor(photo.vlm_confidence || 0),
                            },
                          }}
                        />
                      </Box>
                      {photo.needs_retake && (
                        <Chip
                          label="Needs Retake"
                          size="small"
                          color="error"
                          icon={<AlertTriangle className="w-3 h-3" />}
                        />
                      )}
                    </Box>

                    {photo.vlm_feedback && (
                      <Box sx={{ bgcolor: 'grey.100', p: 2, borderRadius: 1 }}>
                        <Typography variant="body2" fontWeight="medium" sx={{ mb: 1 }}>
                          Feedback
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {photo.vlm_feedback}
                        </Typography>
                      </Box>
                    )}

                    {photo.vlm_raw_response?.issues && photo.vlm_raw_response.issues.length > 0 && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="body2" fontWeight="medium" sx={{ mb: 1 }}>
                          Issues Found
                        </Typography>
                        <Box component="ul" sx={{ m: 0, pl: 2 }}>
                          {photo.vlm_raw_response.issues.map((issue, i) => (
                            <Typography component="li" variant="body2" color="error.main" key={i}>
                              {issue}
                            </Typography>
                          ))}
                        </Box>
                      </Box>
                    )}
                  </>
                ) : (
                  <Alert severity="info">
                    This photo has not been validated by AI yet.
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Feature Context Card */}
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
                  Feature Details
                </Typography>

                <Grid container spacing={1}>
                  <InfoRow label="Feature ID" value={photo.feature_id} />
                  <InfoRow label="Work Type" value={formatWorkType(photo.work_type)} />
                  <InfoRow label="Project" value={photo.qfield_project_name} />

                  {/* Pole context */}
                  {photo.feature_type === 'pole' && photo.pole_type && (
                    <>
                      <InfoRow label="Pole Type" value={photo.pole_type} />
                      <InfoRow label="Height" value={photo.pole_height ? `${photo.pole_height}m` : null} />
                      <InfoRow label="Material" value={photo.pole_material} />
                      <InfoRow label="Status" value={photo.pole_status} />
                      {photo.pole_latitude && photo.pole_longitude && (
                        <Grid item xs={12}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <MapPin className="w-4 h-4 text-gray-400" />
                            <Typography variant="body2">
                              {photo.pole_latitude.toFixed(6)}, {photo.pole_longitude.toFixed(6)}
                            </Typography>
                            <IconButton
                              size="small"
                              onClick={() => window.open(`https://www.google.com/maps?q=${photo.pole_latitude},${photo.pole_longitude}`, '_blank')}
                            >
                              <ExternalLink className="w-3 h-3" />
                            </IconButton>
                          </Box>
                        </Grid>
                      )}
                    </>
                  )}

                  {/* Drop context */}
                  {photo.feature_type === 'drop' && photo.drop_number && (
                    <>
                      <InfoRow label="Drop Number" value={photo.drop_number} />
                      <InfoRow label="Pole Number" value={photo.drop_pole_number} />
                      <InfoRow label="Customer" value={photo.drop_customer_name} />
                      <InfoRow label="Address" value={photo.drop_address} />
                      <InfoRow label="Status" value={photo.drop_status} />
                      <InfoRow label="QC Status" value={photo.drop_qc_status} />
                    </>
                  )}
                </Grid>
              </CardContent>
            </Card>

            {/* Assignment Info */}
            {(photo.assigned_to || photo.manual_reviewed_by) && (
              <Card sx={{ mb: 2 }}>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
                    Review Info
                  </Typography>
                  <Grid container spacing={1}>
                    {photo.assigned_to && (
                      <>
                        <InfoRow
                          label="Assigned To"
                          value={photo.assigned_to}
                          icon={<User className="w-4 h-4 text-gray-400" />}
                        />
                        {photo.due_date && (
                          <InfoRow
                            label="Due Date"
                            value={format(new Date(photo.due_date), 'dd MMM yyyy')}
                            icon={<Calendar className="w-4 h-4 text-gray-400" />}
                          />
                        )}
                      </>
                    )}
                    {photo.manual_reviewed_by && (
                      <>
                        <InfoRow
                          label="Reviewed By"
                          value={photo.manual_reviewed_by}
                          icon={<User className="w-4 h-4 text-gray-400" />}
                        />
                        {photo.manual_reviewed_at && (
                          <InfoRow
                            label="Reviewed At"
                            value={format(new Date(photo.manual_reviewed_at), 'dd MMM yyyy HH:mm')}
                            icon={<Clock className="w-4 h-4 text-gray-400" />}
                          />
                        )}
                      </>
                    )}
                    {photo.manual_notes && (
                      <Grid item xs={12}>
                        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                          <FileText className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                          <Typography variant="body2" color="text.secondary">
                            {photo.manual_notes}
                          </Typography>
                        </Box>
                      </Grid>
                    )}
                  </Grid>
                </CardContent>
              </Card>
            )}

            {/* Notes Input */}
            <TextField
              fullWidth
              multiline
              rows={3}
              placeholder="Add notes for approval/rejection..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              sx={{ mb: 2 }}
            />

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button variant="outlined" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="outlined"
          color="warning"
          startIcon={<AlertTriangle className="w-4 h-4" />}
          onClick={() => handleAction('escalate')}
          disabled={loading}
        >
          Escalate
        </Button>
        <Button
          variant="contained"
          color="error"
          startIcon={<XCircle className="w-4 h-4" />}
          onClick={() => handleAction('reject')}
          disabled={loading}
        >
          Reject
        </Button>
        <Button
          variant="contained"
          color="success"
          startIcon={<CheckCircle className="w-4 h-4" />}
          onClick={() => handleAction('approve')}
          disabled={loading}
        >
          Approve
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function StatusChip({ status }: { status: WorkflowStatus }) {
  const config: Record<WorkflowStatus, { label: string; color: 'default' | 'success' | 'error' | 'warning' | 'info' }> = {
    pending: { label: 'Pending', color: 'warning' },
    in_review: { label: 'In Review', color: 'info' },
    approved: { label: 'Approved', color: 'success' },
    rejected: { label: 'Rejected', color: 'error' },
    escalated: { label: 'Escalated', color: 'warning' },
  };

  const { label, color } = config[status] || { label: status, color: 'default' };

  return <Chip label={label} size="small" color={color} />;
}

function InfoRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number | null | undefined;
  icon?: React.ReactNode;
}) {
  if (!value) return null;

  return (
    <>
      <Grid item xs={4}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {icon}
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
        </Box>
      </Grid>
      <Grid item xs={8}>
        <Typography variant="body2">{value}</Typography>
      </Grid>
    </>
  );
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return '#22c55e';
  if (confidence >= 0.6) return '#f97316';
  return '#ef4444';
}

function formatWorkType(workType: string | null): string {
  if (!workType) return 'Unknown';
  switch (workType) {
    case 'pole_installation': return 'Pole Installation';
    case 'cable_stringing': return 'Cable Stringing';
    case 'dome_joint': return 'Dome Joint';
    case 'activation': return 'Activation';
    default: return workType;
  }
}

export default PhotoDetailModal;
