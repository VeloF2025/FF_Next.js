import { useRouter } from 'next/router';
import { ArrowLeft, Save } from 'lucide-react';

// Import split components
import { StaffPersonalInfo } from './staff/StaffPersonalInfo';
import { StaffJobInfo } from './staff/StaffJobInfo';
import { StaffSkills } from './staff/StaffSkills';
import { StaffEmergencyContact } from './staff/StaffEmergencyContact';
import { useStaffForm } from './staff/useStaffForm';

export function StaffForm() {
  const router = useRouter();
  const { id } = router.query as Record<string, string>;
  
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
          className="inline-flex items-center text-sm text-muted-foreground hover:text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Staff List
        </button>
      </div>

      <div className="bg-card rounded-lg shadow-sm border border-border">
        <div className="px-6 py-4 border-b border-border">
          <h1 className="text-xl font-semibold text-foreground">
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
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <button
              type="button"
              onClick={() => navigate('/app/staff')}
              className="px-4 py-2 text-sm font-medium text-muted-foreground bg-card border border-border rounded-lg hover:bg-background"
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