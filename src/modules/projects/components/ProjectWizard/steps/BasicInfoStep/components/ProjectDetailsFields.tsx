

interface ProjectDetailsFieldsProps {
  register: any;
  errors: any;
  clients: Array<{ id: string; name: string }>;
  isClientsLoading: boolean;
}

export function ProjectDetailsFields({ register, errors, clients, isClientsLoading }: ProjectDetailsFieldsProps) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
          Project Name *
        </label>
        <input
          {...register('name', { required: 'Project name is required' })}
          type="text"
          className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter project name"
        />
        {errors.name && (
          <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
          Description
        </label>
        <textarea
          {...register('description')}
          rows={3}
          className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Brief description of the project"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
          Client *
        </label>
        {isClientsLoading ? (
          <div className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
            Loading clients...
          </div>
        ) : (
          <select
            {...register('clientId', { required: 'Client is required' })}
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a client</option>
            {clients?.map(client => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        )}
        {errors.clientId && (
          <p className="mt-1 text-sm text-red-600">{errors.clientId.message}</p>
        )}
      </div>
    </div>
  );
}