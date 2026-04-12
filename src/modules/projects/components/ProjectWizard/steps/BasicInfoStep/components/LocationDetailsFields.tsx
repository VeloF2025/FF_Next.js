import type { UseFormRegister, FieldErrors, FieldValues, Path } from 'react-hook-form';

interface LocationDetailsFieldsProps<T extends FieldValues> {
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
  isGeocoding: boolean;
}

export function LocationDetailsFields<T extends FieldValues>({ register, errors, isGeocoding }: LocationDetailsFieldsProps<T>) {
  // Narrow the errors to the location sub-object if present
  const locationErrors = (errors as Record<string, Record<string, { message?: string }>>).location;

  return (
    <div className="pt-4 border-t border-[var(--ff-border-light)]">
      <p className="text-sm text-[var(--ff-text-secondary)] mb-3">
        Location details (auto-populated from GPS coordinates):
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">City/Town</label>
          <input
            {...register('location.city' as Path<T>, { required: 'City/Town is required' })}
            type="text"
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
            placeholder="Will be auto-populated"
            readOnly={isGeocoding}
          />
          {locationErrors?.city && (
            <p className="mt-1 text-sm text-red-600">{locationErrors.city.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">Municipal District</label>
          <input
            {...register('location.region' as Path<T>, { required: 'Region is required' })}
            type="text"
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
            placeholder="Will be auto-populated"
            readOnly={isGeocoding}
          />
          {locationErrors?.region && (
            <p className="mt-1 text-sm text-red-600">{locationErrors.region.message}</p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">Province</label>
        <input
          {...register('location.province' as Path<T>, { required: 'Province is required' })}
          type="text"
          className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
          placeholder="Will be auto-populated"
          readOnly={isGeocoding}
        />
        {locationErrors?.province && (
          <p className="mt-1 text-sm text-red-600">{locationErrors.province.message}</p>
        )}
      </div>
    </div>
  );
}
