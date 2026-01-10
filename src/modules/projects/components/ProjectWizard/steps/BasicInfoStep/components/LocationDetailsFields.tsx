

interface LocationDetailsFieldsProps {
  register: any;
  errors: any;
  isGeocoding: boolean;
}

export function LocationDetailsFields({ register, errors, isGeocoding }: LocationDetailsFieldsProps) {
  return (
    <div className="pt-4 border-t border-[var(--ff-border-light)]">
      <p className="text-sm text-[var(--ff-text-secondary)] mb-3">
        Location details (auto-populated from GPS coordinates):
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">City/Town</label>
          <input
            {...register('location.city', { required: 'City/Town is required' })}
            type="text"
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
            placeholder="Will be auto-populated"
            readOnly={isGeocoding}
          />
          {errors.location?.city && (
            <p className="mt-1 text-sm text-red-600">{errors.location.city.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">Municipal District</label>
          <input
            {...register('location.region' as any, { required: 'Region is required' })}
            type="text"
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
            placeholder="Will be auto-populated"
            readOnly={isGeocoding}
          />
          {errors.location?.region && (
            <p className="mt-1 text-sm text-red-600">{errors.location.region.message}</p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">Province</label>
        <input
          {...register('location.province', { required: 'Province is required' })}
          type="text"
          className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
          placeholder="Will be auto-populated"
          readOnly={isGeocoding}
        />
        {errors.location?.province && (
          <p className="mt-1 text-sm text-red-600">{errors.location.province.message}</p>
        )}
      </div>
    </div>
  );
}