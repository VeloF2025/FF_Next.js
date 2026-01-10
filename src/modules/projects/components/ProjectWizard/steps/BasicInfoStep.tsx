import {
  ProjectDetailsFields,
  GpsCoordinatesInput,
  LocationDetailsFields,
  ProjectTimingFields,
  useBasicInfoForm,
  type BasicInfoStepProps
} from './BasicInfoStep/index';

export function BasicInfoStep({ form, clients, isClientsLoading }: BasicInfoStepProps) {
  const { register, formState: { errors } } = form;
  const { 
    gpsState, 
    handleGetCurrentLocation, 
    handleGpsInputParse, 
    updateGpsInput 
  } = useBasicInfoForm(form);

  return (
    <div className="space-y-6">
      <ProjectDetailsFields 
        register={register}
        errors={errors}
        clients={clients}
        isClientsLoading={isClientsLoading}
      />

      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
          Project Location *
        </label>
        <div className="space-y-4">
          <GpsCoordinatesInput
            register={register}
            errors={errors}
            gpsState={gpsState}
            onGetCurrentLocation={handleGetCurrentLocation}
            onGpsInputParse={handleGpsInputParse}
            onGpsInputChange={updateGpsInput}
          />

          <LocationDetailsFields
            register={register}
            errors={errors}
            isGeocoding={gpsState.isGeocoding}
          />
        </div>
      </div>

      <ProjectTimingFields 
        register={register}
        errors={errors}
      />
    </div>
  );
}