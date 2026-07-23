/**
 * Incident evidence sections - injured persons, witnesses, photos, linked ticket
 */

import { FileText, Users, Eye, Building2 } from 'lucide-react';
import { Section, Field } from './DetailPrimitives';
import type { IncidentDetail } from './types';

export function IncidentEvidenceTicket({ incident }: { incident: IncidentDetail }) {
  const persons = Array.isArray(incident.injured_persons) ? incident.injured_persons : [];
  const witnesses = Array.isArray(incident.witnesses) ? incident.witnesses : [];
  const photos = Array.isArray(incident.photos) ? incident.photos : [];

  return (
    <>
      <Section title="Injured Persons" icon={Users}>
        {persons.length === 0 ? (
          <p className="text-sm text-[var(--ff-text-tertiary)]">None reported</p>
        ) : (
          <ul className="space-y-2">
            {persons.map((p, i) => (
              <li key={i} className="text-sm text-[var(--ff-text-primary)] bg-[var(--ff-bg-tertiary)] rounded p-3">
                {typeof p === 'string' ? (
                  p
                ) : (
                  <>
                    <span className="font-medium">{p.name || 'Unnamed'}</span>
                    {p.role && <span className="text-[var(--ff-text-secondary)]"> — {p.role}</span>}
                    {p.injuries && <p className="text-[var(--ff-text-secondary)] mt-1">{p.injuries}</p>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Witnesses" icon={Eye}>
        {witnesses.length === 0 ? (
          <p className="text-sm text-[var(--ff-text-tertiary)]">None recorded</p>
        ) : (
          <ul className="list-disc list-inside space-y-1">
            {witnesses.map((w, i) => (
              <li key={i} className="text-sm text-[var(--ff-text-primary)]">
                {typeof w === 'string' ? w : JSON.stringify(w)}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {photos.length > 0 && (
        <Section title="Photos" icon={FileText}>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos.map((photo, i) => {
              const url = typeof photo === 'string' ? photo : photo?.url;
              if (!url) return null;
              return (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block aspect-square rounded-lg overflow-hidden border border-[var(--ff-border-light)]"
                >
                  <img src={url} alt={`Incident photo ${i + 1}`} className="w-full h-full object-cover" />
                </a>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Linked Ticket" icon={Building2}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <Field label="Ticket UID" value={incident.ticket_uid} />
          <Field label="Status" value={incident.status} />
          <Field label="Priority" value={incident.priority} />
          <Field label="Created" value={new Date(incident.created_at).toLocaleDateString()} />
        </div>
      </Section>
    </>
  );
}
