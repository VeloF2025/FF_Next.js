import { useState } from 'react';
import { 
  X, Camera, MapPin, Clock, User, FileText, 
  CheckCircle, AlertTriangle, Phone 
} from 'lucide-react';
import { cn } from '@/utils/cn';
import type { FieldTask } from '../types/field-app.types';

interface TaskDialogProps {
  task: FieldTask | null;
  isOpen: boolean;
  onClose: () => void;
  onStatusUpdate: (taskId: string, status: FieldTask['status']) => void;
}

export function TaskDialog({ task, isOpen, onClose, onStatusUpdate }: TaskDialogProps) {
  const [notes, setNotes] = useState('');

  if (!isOpen || !task) return null;

  const handleStatusUpdate = (status: FieldTask['status']) => {
    onStatusUpdate(task.id, status);
    onClose();
  };

  const getStatusButtons = () => {
    const buttons = [];
    
    if (task.status === 'pending') {
      buttons.push(
        <button
          key="start"
          onClick={() => handleStatusUpdate('in_progress')}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <Clock className="w-4 h-4 mr-2" />
          Start Task
        </button>
      );
    }
    
    if (task.status === 'in_progress') {
      buttons.push(
        <button
          key="complete"
          onClick={() => handleStatusUpdate('completed')}
          className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
        >
          <CheckCircle className="w-4 h-4 mr-2" />
          Mark Complete
        </button>
      );
      buttons.push(
        <button
          key="fail"
          onClick={() => handleStatusUpdate('failed')}
          className="flex items-center px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
        >
          <AlertTriangle className="w-4 h-4 mr-2" />
          Mark Failed
        </button>
      );
    }
    
    return buttons;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] p-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Task Details</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--ff-bg-hover)] rounded-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Task Header */}
          <div>
            <h3 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
              {task.title}
            </h3>
            <div className="flex items-center space-x-4 text-sm text-[var(--ff-text-secondary)]">
              <span className={cn(
                "px-2 py-1 rounded-full text-xs font-medium",
                task.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                task.status === 'in_progress' ? 'bg-blue-500/20 text-blue-400' :
                task.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'
              )}>
                {task.status.replace('_', ' ')}
              </span>
              <span className="capitalize">{task.priority} priority</span>
              <span>{task.estimatedDuration}</span>
            </div>
          </div>

          {/* Customer Info */}
          <div className="border border-[var(--ff-border-light)] rounded-lg p-4">
            <h4 className="font-medium text-[var(--ff-text-primary)] mb-3 flex items-center">
              <User className="w-4 h-4 mr-2" />
              Customer Information
            </h4>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium">Name:</span> {task.customer}
              </div>
              <div className="flex items-start">
                <span className="font-medium mr-2">Address:</span>
                <span className="flex-1">{task.address}</span>
              </div>
              <div className="flex items-center space-x-2">
                <MapPin className="w-4 h-4" />
                <span>
                  {task.coordinates.lat.toFixed(4)}, {task.coordinates.lng.toFixed(4)}
                </span>
                <button className="text-blue-600 hover:underline">
                  View on Map
                </button>
              </div>
            </div>
          </div>

          {/* Task Details */}
          <div className="border border-[var(--ff-border-light)] rounded-lg p-4">
            <h4 className="font-medium text-[var(--ff-text-primary)] mb-3 flex items-center">
              <FileText className="w-4 h-4 mr-2" />
              Task Details
            </h4>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium">Type:</span>
                <span className="capitalize ml-2">{task.type}</span>
              </div>
              <div>
                <span className="font-medium">Scheduled:</span> {task.scheduledTime}
              </div>
              <div>
                <span className="font-medium">Attachments:</span> {task.attachments} files
              </div>
              {task.notes && (
                <div>
                  <span className="font-medium">Notes:</span>
                  <p className="mt-1 text-[var(--ff-text-secondary)]">{task.notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Action Notes */}
          <div className="border border-[var(--ff-border-light)] rounded-lg p-4">
            <h4 className="font-medium text-[var(--ff-text-primary)] mb-3">Add Notes</h4>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Add task notes or observations..."
            />
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-4">
            <button className="flex items-center justify-center px-4 py-3 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-hover)]">
              <Camera className="w-5 h-5 mr-2" />
              Take Photo
            </button>
            <button className="flex items-center justify-center px-4 py-3 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-hover)]">
              <Phone className="w-5 h-5 mr-2" />
              Call Customer
            </button>
          </div>

          {/* Status Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-[var(--ff-border-light)]">
            <div className="flex space-x-2">
              {getStatusButtons()}
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}