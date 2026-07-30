interface ConnectorSetupCardProps {
  heading: string;
  description: string;
  endpoint: string;
  consentDescription: string;
}

export function ConnectorSetupCard({
  heading,
  description,
  endpoint,
  consentDescription,
}: ConnectorSetupCardProps) {
  return (
    <section className="rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] p-6 shadow-sm">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ff-text-primary)]">
            {heading}
          </h1>
        </div>
        <p className="text-sm leading-6 text-[var(--ff-text-secondary)]">
          {description}
        </p>
        <div>
          <p className="mb-2 text-sm font-medium text-[var(--ff-text-primary)]">
            Connector URL
          </p>
          <code className="block select-all overflow-x-auto rounded-lg border border-[var(--ff-border-primary)] bg-[var(--ff-background-primary)] px-3 py-2 text-sm text-[var(--ff-text-primary)]">
            {endpoint}
          </code>
        </div>
        <p className="text-sm leading-6 text-[var(--ff-text-secondary)]">
          {consentDescription}
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-[var(--ff-text-secondary)]">
          <li>Open Claude Settings and choose Connectors.</li>
          <li>Choose Add custom connector and paste the URL above.</li>
          <li>Complete the FibreFlow sign-in and consent window Claude opens.</li>
        </ol>
      </div>
    </section>
  );
}
