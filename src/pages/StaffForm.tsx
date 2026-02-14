import { useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';

// Import split components
import { StaffPersonalInfo } from './staff/StaffPersonalInfo';
import { StaffJobInfo } from './staff/StaffJobInfo';
import { StaffSkills } from './staff/StaffSkills';
import { StaffEmergencyContact } from './staff/StaffEmergencyContact';
import { useStaffForm } from './staff/useStaffForm';

export function StaffForm() {
  const { id } = useParams<{ id: string }>();
  
  const {
    formData,
    isEditing,
    isLoading,
    handleSubmit,
    handleInputChange,
    toggleSkill,
    createMutation,
    updateMutation,
    navigate
  } = useStaffForm(id);

  if (isLoading && isEditing) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => navigate('/app/staff')}
          className="inline-flex items-center text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Staff List
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {isEditing ? 'Edit Staff Member' : 'Add New Staff Member'}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Personal Information */}
          <StaffPersonalInfo 
            formData={formData} 
            onInputChange={handleInputChange} 
          />

          {/* Job Information */}
          <StaffJobInfo 
            formData={formData} 
            onInputChange={handleInputChange} 
          />

          {/* Skills */}
          <StaffSkills 
            formData={formData} 
            onSkillToggle={toggleSkill} 
          />

          {/* Emergency Contact */}
          <StaffEmergencyContact 
            formData={formData} 
            onInputChange={handleInputChange} 
          />

          {/* Form Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => navigate('/app/staff')}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:bg-gray-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4 mr-2" />
              {isEditing ? 'Update' : 'Create'} Staff Member
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}