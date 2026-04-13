/**
 * QA Review Card Component
 * Individual card for reviewing a drop with 14 QA checkboxes
 * Allows QA reviewers to check/uncheck steps, add comments, and mark status
 *
 * @deprecated This component is deprecated as of Phase 6 Week 6.4 (January 2026).
 * The unified DR photo review system (UnifiedReviewCard) is now the default for all projects.
 * This component is kept for backward compatibility during the 2-week transition period.
 * Will be removed after port 8003 shutdown (2 weeks from full rollout).
 *
 * @see src/modules/activate/components/UnifiedReviewCard.tsx
 */

'use client';

import { useState, useEffect, memo } from 'react';
import { notificationService } from '@/services/core/NotificationService';
import { log } from '@/lib/logger';
import {
  Card,
  CardContent,
  CardHeader,
  CardActions,
  Checkbox,
  FormControlLabel,
  TextField,
  Button,
  Chip,
  Box,
  Typography,
  Divider,
  Alert,
  IconButton,
  Tooltip,
} from '@mui/material';
import { CheckCircle, Send, Save, AlertTriangle, Edit2, X, Edit, Lock } from 'lucide-react';
import type { QaReviewDrop, QaSteps } from '../types/wa-monitor.types';
import { QA_STEP_LABELS, ORDERED_STEP_KEYS } from '../types/wa-monitor.types';
import { DropStatusBadge } from './DropStatusBadge';
import { formatDateTime } from '../utils/waMonitorHelpers';
import { lockDrop, unlockDrop } from '../services/waMonitorApiService';

interface QaReviewCardProps {
  drop: QaReviewDrop;
  onUpdate: (dropId: string, updates: Partial<QaReviewDrop>) => Promise<void>;
  onSendFeedback: (dropId: string, dropNumber: string, message: string, project?: string) => Promise<void>;
}

export const QaReviewCard = memo(function QaReviewCard({ drop, onUpdate, onSendFeedback }: QaReviewCardProps) {
  const [steps, setSteps] = useState<QaSteps>({
    step_01_house_photo: drop.step_01_house_photo,
    step_02_cable_from_pole: drop.step_02_cable_from_pole,
    step_03_cable_entry_outside: drop.step_03_cable_entry_outside,
    step_04_cable_entry_inside: drop.step_04_cable_entry_inside,
    step_05_wall_for_installation: drop.step_05_wall_for_installation,
    step_06_ont_back_after_install: drop.step_06_ont_back_after_install,
    step_07_power_meter_reading: drop.step_07_power_meter_reading,
    step_08_ont_barcode: drop.step_08_ont_barcode,
    step_09_ups_serial: drop.step_09_ups_serial,
    step_10_final_installation: drop.step_10_final_installation,
    step_11_green_lights: drop.step_11_green_lights,
    step_12_customer_signature: drop.step_12_customer_signature,
  });

  const [comment, setComment] = useState(drop.comment || '');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [isEditingDropNumber, setIsEditingDropNumber] = useState(false);
  const [editedDropNumber, setEditedDropNumber] = useState(drop.dropNumber);

  // Incorrect photos tracking
  const [_incorrectSteps, setIncorrectSteps] = useState<string[]>(drop.incorrectSteps || []);
  const [incorrectComments, setIncorrectComments] = useState<Record<string, string>>(drop.incorrectComments || {});

  // Locking system state
  const [isEditing, setIsEditing] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [currentUser] = useState('Louis Duplessis'); // TODO: Get from Clerk auth

  // Legacy serial data (from old scanning system - kept for backward compatibility)
  // New system uses OneMap data fetched from database (onemapOntBarcode, etc.)

  // Sync local state with props when drop data changes (e.g., after refresh)
  // Only sync if NOT editing (prevents overwriting active changes)
  useEffect(() => {
    if (isEditing) {
      // Don't overwrite user's active changes during auto-refresh
      return;
    }

    setSteps({
      step_01_house_photo: drop.step_01_house_photo,
      step_02_cable_from_pole: drop.step_02_cable_from_pole,
      step_03_cable_entry_outside: drop.step_03_cable_entry_outside,
      step_04_cable_entry_inside: drop.step_04_cable_entry_inside,
      step_05_wall_for_installation: drop.step_05_wall_for_installation,
      step_06_ont_back_after_install: drop.step_06_ont_back_after_install,
      step_07_power_meter_reading: drop.step_07_power_meter_reading,
      step_08_ont_barcode: drop.step_08_ont_barcode,
      step_09_ups_serial: drop.step_09_ups_serial,
      step_10_final_installation: drop.step_10_final_installation,
      step_11_green_lights: drop.step_11_green_lights,
      step_12_customer_signature: drop.step_12_customer_signature,
    });
    setComment(drop.comment || '');
    setEditedDropNumber(drop.dropNumber);
    setIncorrectSteps(drop.incorrectSteps || []);
    setIncorrectComments(drop.incorrectComments || {});
  }, [drop, isEditing]);

  // Check if drop is locked by someone else
  useEffect(() => {
    if (drop.lockedBy && drop.lockedBy !== currentUser) {
      setIsLocked(true);
      setLockError(`Currently being edited by ${drop.lockedBy}`);
    } else if (drop.lockedBy === currentUser) {
      // We have the lock
      setIsLocked(true);
      setIsEditing(true);
    } else {
      setIsLocked(false);
      setLockError(null);
    }
  }, [drop.lockedBy, currentUser]);

  // Cleanup: unlock on unmount if editing
  useEffect(() => {
    return () => {
      if (isEditing) {
        unlockDrop(drop.id, currentUser).catch((err) => {
          log.error('Failed to unlock drop on unmount', err, 'QaReviewCard');
        });
      }
    };
  }, [isEditing, drop.id, currentUser]);

  // Calculate progress
  const completedSteps = Object.values(steps).filter(Boolean).length;
  const totalSteps = Object.keys(steps).length;
  const progressPercent = Math.round((completedSteps / totalSteps) * 100);

  // Get missing steps for feedback (in correct display order)
  // A step is missing only if unticked AND has no comment
  // If it has a comment, it's in the incorrect section instead
  const getMissingSteps = (): string[] => {
    const missing: string[] = [];
    ORDERED_STEP_KEYS.forEach((key, index) => {
      const hasComment = incorrectComments[key] && incorrectComments[key].trim().length > 0;
      if (!steps[key] && !hasComment) {
        missing.push(`${index + 1}. ${QA_STEP_LABELS[key]}`);
      }
    });
    return missing;
  };

  // Get incorrect steps for feedback (in correct display order)
  // A step is incorrect if it has a comment (checkbox state doesn't matter)
  const getIncorrectSteps = (): Array<{ step: string; comment: string }> => {
    const incorrect: Array<{ step: string; comment: string }> = [];
    ORDERED_STEP_KEYS.forEach((key, index) => {
      if (incorrectComments[key] && incorrectComments[key].trim().length > 0) {
        incorrect.push({
          step: `${index + 1}. ${QA_STEP_LABELS[key]}`,
          comment: incorrectComments[key],
        });
      }
    });
    return incorrect;
  };

  // Handle checkbox change
  const handleStepChange = (stepKey: keyof QaSteps) => {
    setSteps((prev) => ({
      ...prev,
      [stepKey]: !prev[stepKey],
    }));
  };

  // Handle incorrect comment change
  const handleIncorrectCommentChange = (stepKey: keyof QaSteps, comment: string) => {
    setIncorrectComments((prev) => ({
      ...prev,
      [stepKey]: comment,
    }));
  };

  // Handle Edit button - acquire lock
  const handleEdit = async () => {
    try {
      setSaving(true);
      const result = await lockDrop(drop.id, currentUser);

      if (!result.locked) {
        // Someone else has the lock
        setLockError(result.error || 'Drop is locked by another user');
        setIsLocked(true);
        return;
      }

      // Lock acquired - enable editing
      setIsEditing(true);
      setIsLocked(true);
      setLockError(null);
    } catch (error) {
      log.error('Error acquiring lock', error, 'QaReviewCard');
      setLockError('Failed to acquire lock');
    } finally {
      setSaving(false);
    }
  };

  // Handle Cancel button - revert changes and unlock
  const handleCancel = async () => {
    try {
      setSaving(true);

      // Revert all changes
      setSteps({
        step_01_house_photo: drop.step_01_house_photo,
        step_02_cable_from_pole: drop.step_02_cable_from_pole,
        step_03_cable_entry_outside: drop.step_03_cable_entry_outside,
        step_04_cable_entry_inside: drop.step_04_cable_entry_inside,
        step_05_wall_for_installation: drop.step_05_wall_for_installation,
        step_06_ont_back_after_install: drop.step_06_ont_back_after_install,
        step_07_power_meter_reading: drop.step_07_power_meter_reading,
        step_08_ont_barcode: drop.step_08_ont_barcode,
        step_09_ups_serial: drop.step_09_ups_serial,
        step_10_final_installation: drop.step_10_final_installation,
        step_11_green_lights: drop.step_11_green_lights,
        step_12_customer_signature: drop.step_12_customer_signature,
      });
      setComment(drop.comment || '');
      setIncorrectSteps(drop.incorrectSteps || []);
      setIncorrectComments(drop.incorrectComments || {});

      // Unlock the drop
      await unlockDrop(drop.id, currentUser);

      // Exit edit mode
      setIsEditing(false);
      setIsLocked(false);
      setLockError(null);
    } catch (error) {
      log.error('Error canceling', error, 'QaReviewCard');
    } finally {
      setSaving(false);
    }
  };

  // Handle save (update DB and unlock)
  const handleSave = async () => {
    try {
      setSaving(true);

      // Build incorrectSteps array from comments (any step with a comment = incorrect)
      // Checkbox state doesn't matter - text presence determines incorrectness
      const incorrectStepsArray = ORDERED_STEP_KEYS.filter(
        key => incorrectComments[key] && incorrectComments[key].trim().length > 0
      );

      // Save changes to database
      await onUpdate(drop.id, {
        ...steps,
        comment,
        incomplete: completedSteps < totalSteps,
        completed: completedSteps === totalSteps,
        incorrectSteps: incorrectStepsArray,
        incorrectComments,
      });

      // Unlock the drop
      await unlockDrop(drop.id, currentUser);

      // Exit edit mode
      setIsEditing(false);
      setIsLocked(false);
      setLockError(null);
    } catch (error) {
      log.error('Error saving', error, 'QaReviewCard');
    } finally {
      setSaving(false);
    }
  };

  // Handle mark as incomplete and send feedback
  const handleSendFeedback = async () => {
    if (!feedbackMessage.trim()) {
      return;
    }

    try {
      setSending(true);
      // Send feedback with project info (defaults to Velo Test for testing)
      // Use editedDropNumber in case it was changed
      await onSendFeedback(drop.id, editedDropNumber, feedbackMessage, drop.project || undefined);
      setFeedbackMessage('');
    } catch (error) {
      log.error('Error sending feedback', error, 'QaReviewCard');
      notificationService.error(`Failed to send feedback: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSending(false);
    }
  };

  // Get correct/approved steps (completed and no comment)
  const getApprovedSteps = (): string[] => {
    const approved: string[] = [];
    ORDERED_STEP_KEYS.forEach((key, index) => {
      // Step is approved if checked AND no comment
      // If there's a comment, it's incorrect (regardless of checkbox)
      const hasComment = incorrectComments[key] && incorrectComments[key].trim().length > 0;
      if (steps[key] && !hasComment) {
        approved.push(`${index + 1}. ${QA_STEP_LABELS[key]}`);
      }
    });
    return approved;
  };

  // Generate auto-feedback based on missing, incorrect, and approved steps
  const handleGenerateAutoFeedback = () => {
    const missing = getMissingSteps();
    const incorrect = getIncorrectSteps();
    const approved = getApprovedSteps();

    // If all steps complete and correct - show simple approval message
    if (missing.length === 0 && incorrect.length === 0 && approved.length === totalSteps) {
      setFeedbackMessage(`${editedDropNumber}\nAll items complete! ✅`);
      return;
    }

    // Build feedback message - ONLY show what's wrong (missing/incorrect)
    let message = `${editedDropNumber}\nNEEDS CORRECTION\n\n`;

    // Show missing items
    if (missing.length > 0) {
      message += `Missing items:\n`;
      missing.forEach((item) => {
        message += `• ${item}\n`;
      });
      message += `\n`;
    }

    // Show incorrect items with comments
    if (incorrect.length > 0) {
      message += `Incorrect items:\n`;
      incorrect.forEach(({ step, comment }) => {
        message += `• ${step} - ${comment}\n`;
      });
    }

    setFeedbackMessage(message.trim());
  };

  // Handle drop number edit
  const handleSaveDropNumber = async () => {
    if (!editedDropNumber.trim()) {
      notificationService.warning('Drop number cannot be empty');
      return;
    }

    try {
      setSaving(true);
      await onUpdate(drop.id, { dropNumber: editedDropNumber.trim() });
      setIsEditingDropNumber(false);
      notificationService.success('Drop number saved');
    } catch (error) {
      log.error('Error saving drop number', error, 'QaReviewCard');
      notificationService.error('Failed to save drop number');
      // Revert to original value
      setEditedDropNumber(drop.dropNumber);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEditDropNumber = () => {
    setEditedDropNumber(drop.dropNumber);
    setIsEditingDropNumber(false);
  };

  return (
    <Card sx={{ mb: 2, border: '1px solid #e0e0e0' }}>
      <CardHeader
        title={
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center" gap={1}>
              {isEditingDropNumber ? (
                <>
                  <TextField
                    value={editedDropNumber}
                    onChange={(e) => setEditedDropNumber(e.target.value)}
                    size="small"
                    variant="outlined"
                    sx={{ width: '200px' }}
                    autoFocus
                  />
                  <Tooltip title="Save">
                    <IconButton
                      size="small"
                      color="success"
                      onClick={handleSaveDropNumber}
                      disabled={saving}
                    >
                      <Save size={16} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Cancel">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={handleCancelEditDropNumber}
                      disabled={saving}
                    >
                      <X size={16} />
                    </IconButton>
                  </Tooltip>
                </>
              ) : (
                <>
                  <Typography variant="h6" fontWeight="bold">
                    {editedDropNumber}
                  </Typography>
                  <Tooltip title="Edit drop number">
                    <IconButton
                      size="small"
                      onClick={() => setIsEditingDropNumber(true)}
                      sx={{ ml: 0.5 }}
                    >
                      <Edit2 size={16} />
                    </IconButton>
                  </Tooltip>
                </>
              )}
            </Box>
            <Box display="flex" alignItems="center" gap={1}>
              {drop.resubmitted && (
                <Chip
                  label="🔄 Resubmitted"
                  color="info"
                  size="small"
                  sx={{ fontWeight: 'bold' }}
                />
              )}
              <Chip
                label={`${completedSteps}/${totalSteps} Complete`}
                color={progressPercent === 100 ? 'success' : 'warning'}
                size="small"
              />
              <DropStatusBadge status={drop.status} size="sm" />
            </Box>
          </Box>
        }
        subheader={
          <Box mt={1}>
            <Typography variant="caption" color="textSecondary">
              Project: {drop.project || 'Unknown'} • Agent: {drop.userName} • Created: {formatDateTime(drop.createdAt)}
            </Typography>
          </Box>
        }
      />

      <CardContent>
        {/* Lock Status Alerts */}
        {lockError && !isEditing && (
          <Alert severity="warning" icon={<Lock size={20} />} sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight="medium">
              🔒 {lockError}
            </Typography>
          </Alert>
        )}

        {isEditing && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              ✏️ Editing mode active - Auto-refresh disabled for this drop
            </Typography>
          </Alert>
        )}

        {/* Progress Bar */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
            <Typography variant="body2" fontWeight="medium">
              QA Progress: {progressPercent}%
            </Typography>
          </Box>
          <Box
            sx={{
              width: '100%',
              height: 8,
              bgcolor: '#e0e0e0',
              borderRadius: 1,
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                width: `${progressPercent}%`,
                height: '100%',
                bgcolor: progressPercent === 100 ? '#4caf50' : '#ff9800',
                transition: 'width 0.3s ease',
              }}
            />
          </Box>
        </Box>

        {/* QA Checklist - 12 Steps (WA Monitor) */}
        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
          Installation QA Checklist (12 Photos)
        </Typography>
        <Box sx={{ pl: 1 }}>
          {ORDERED_STEP_KEYS.map((stepKey, index) => {
            // Determine if this step displays OneMap serial data (Step 8 = ONT, Step 9 = UPS)
            const isOntStep = stepKey === 'step_08_ont_barcode';
            const isUpsStep = stepKey === 'step_09_ups_serial';

            return (
              <Box key={stepKey} sx={{ mb: 2 }}>
                <Box display="flex" alignItems="center" gap={1}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={steps[stepKey]}
                        onChange={() => handleStepChange(stepKey)}
                        size="small"
                        disabled={!isEditing}
                      />
                    }
                    label={
                      <Typography variant="body2" color={steps[stepKey] ? 'success.main' : 'text.secondary'}>
                        {index + 1}. {QA_STEP_LABELS[stepKey]}
                      </Typography>
                    }
                  />

                  {/* OneMap Serial Data Display for Steps 8 & 9 */}
                  {isOntStep && drop.onemapOntBarcode && (
                    <Chip
                      icon={<CheckCircle size={14} />}
                      label={drop.onemapOntBarcode}
                      color="success"
                      size="small"
                      variant="outlined"
                      sx={{ ml: 1 }}
                    />
                  )}
                  {isOntStep && !drop.onemapOntBarcode && (
                    <Chip
                      icon={<AlertTriangle size={14} />}
                      label="No ONT data from 1Map"
                      color="warning"
                      size="small"
                      variant="outlined"
                      sx={{ ml: 1 }}
                    />
                  )}
                  {isUpsStep && drop.onemapUpsSerial && (
                    <Chip
                      icon={<CheckCircle size={14} />}
                      label={drop.onemapUpsSerial}
                      color="success"
                      size="small"
                      variant="outlined"
                      sx={{ ml: 1 }}
                    />
                  )}
                  {isUpsStep && !drop.onemapUpsSerial && (
                    <Chip
                      icon={<AlertTriangle size={14} />}
                      label="No UPS serial from 1Map"
                      color="warning"
                      size="small"
                      variant="outlined"
                      sx={{ ml: 1 }}
                    />
                  )}
                </Box>

                {/* OneMap installation details for Step 8 (ONT) */}
                {isOntStep && (drop.onemapOntBarcode || drop.onemapInstallerName) && (
                  <Box sx={{ ml: 4, mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      1Map Data: {drop.onemapInstallerName && `Installer: ${drop.onemapInstallerName}`}
                      {drop.onemapInstallationDate && ` | Date: ${drop.onemapInstallationDate}`}
                    </Typography>
                  </Box>
                )}

                <TextField
                  fullWidth
                  size="small"
                  placeholder="If incorrect, explain why (e.g., Photo unclear, wrong angle, not uploaded)"
                  value={incorrectComments[stepKey] || ''}
                  onChange={(e) => handleIncorrectCommentChange(stepKey, e.target.value)}
                  disabled={!isEditing}
                  sx={{ ml: 4, mt: 0.5 }}
                  variant="outlined"
                  helperText={incorrectComments[stepKey] && incorrectComments[stepKey].trim().length > 0 ? "⚠️ Marked as incorrect" : ""}
                />
              </Box>
            );
          })}
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Comments Section */}
        <TextField
          fullWidth
          multiline
          rows={2}
          label="QA Comments"
          placeholder="Add notes about this review..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          size="small"
          sx={{ mb: 2 }}
        />

        {/* Feedback Section */}
        {(completedSteps < totalSteps || getIncorrectSteps().length > 0) && (
          <Alert severity="warning" icon={<AlertTriangle size={20} />} sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight="medium">
              {getMissingSteps().length > 0 && `${getMissingSteps().length} items missing`}
              {getMissingSteps().length > 0 && getIncorrectSteps().length > 0 && ' • '}
              {getIncorrectSteps().length > 0 && `${getIncorrectSteps().length} items incorrect`}
            </Typography>
          </Alert>
        )}

        <TextField
          fullWidth
          multiline
          rows={4}
          label="Feedback Message to Agent"
          placeholder="Type your feedback message here..."
          value={feedbackMessage}
          onChange={(e) => setFeedbackMessage(e.target.value)}
          size="small"
        />
      </CardContent>

      <CardActions sx={{ justifyContent: 'space-between', px: 2, pb: 2 }}>
        <Box display="flex" gap={1}>
          <Button
            variant="outlined"
            size="small"
            onClick={handleGenerateAutoFeedback}
            disabled={saving || sending}
          >
            Auto-Generate
          </Button>
          <Button
            variant="contained"
            color="primary"
            size="small"
            startIcon={<Send size={16} />}
            onClick={handleSendFeedback}
            disabled={!feedbackMessage.trim() || sending}
          >
            {sending ? 'Sending...' : 'Send Feedback'}
          </Button>
        </Box>

        {/* Edit/Save/Cancel buttons */}
        <Box display="flex" gap={1}>
          {!isEditing ? (
            // Read-only mode - show Edit button
            <Button
              variant="outlined"
              color="primary"
              size="small"
              startIcon={<Edit size={16} />}
              onClick={handleEdit}
              disabled={isLocked && drop.lockedBy !== currentUser}
            >
              Edit
            </Button>
          ) : (
            // Edit mode - show Save and Cancel
            <>
              <Button
                variant="outlined"
                color="error"
                size="small"
                startIcon={<X size={16} />}
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                color="success"
                size="small"
                startIcon={<Save size={16} />}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </>
          )}
        </Box>
      </CardActions>
    </Card>
  );
});
