/**
 * Incident Persons Section - Injured persons and witnesses
 */

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { PersonInvolved } from '@/modules/health-safety/types/ticket.types';

interface IncidentPersonsSectionProps {
  persons: PersonInvolved[];
  witnesses: string[];
  onPersonsChange: (persons: PersonInvolved[]) => void;
  onWitnessesChange: (witnesses: string[]) => void;
}

const inputClass =
  'w-full px-3 py-1.5 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const labelClass = 'block text-xs font-medium text-[var(--ff-text-secondary)] mb-1';

const EMPTY_PERSON: PersonInvolved = { name: '', role: 'employee', injuries: '', treatment: '' };

export function IncidentPersonsSection({
  persons,
  witnesses,
  onPersonsChange,
  onWitnessesChange,
}: IncidentPersonsSectionProps) {
  const addPerson = () => onPersonsChange([...persons, { ...EMPTY_PERSON }]);

  const removePerson = (idx: number) => {
    onPersonsChange(persons.filter((_, i) => i !== idx));
  };

  const updatePerson = (idx: number, field: keyof PersonInvolved, value: string) => {
    const updated = persons.map((p, i) => (i === idx ? { ...p, [field]: value } : p));
    onPersonsChange(updated);
  };

  const addWitness = () => onWitnessesChange([...witnesses, '']);

  const removeWitness = (idx: number) => {
    onWitnessesChange(witnesses.filter((_, i) => i !== idx));
  };

  const updateWitness = (idx: number, value: string) => {
    onWitnessesChange(witnesses.map((w, i) => (i === idx ? value : w)));
  };

  return (
    <div className="space-y-6">
      {/* Persons Involved */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider">
            Persons Involved
          </h3>
          <button
            type="button"
            aria-label="Add person involved"
            onClick={addPerson}
            className="flex items-center gap-1 text-xs text-[var(--ff-primary-500)] hover:text-[var(--ff-primary-400)] min-h-[44px] px-2"
          >
            <Plus aria-hidden="true" className="w-3.5 h-3.5" /> Add Person
          </button>
        </div>

        {persons.length === 0 && (
          <p className="text-sm text-[var(--ff-text-tertiary)] italic">
            No persons added. Click &quot;Add Person&quot; if anyone was injured or involved.
          </p>
        )}

        <div className="space-y-3">
          {persons.map((person, idx) => (
            <fieldset
              key={idx}
              className="p-3 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] space-y-2"
            >
              <legend className="sr-only">Person {idx + 1} details</legend>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--ff-text-secondary)]">
                  Person {idx + 1}
                </span>
                <button
                  type="button"
                  aria-label={`Remove person ${idx + 1}`}
                  onClick={() => removePerson(idx)}
                  className="p-2 text-red-400 hover:text-red-300 rounded-lg"
                >
                  <Trash2 aria-hidden="true" className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor={`person-name-${idx}`} className={labelClass}>Name *</label>
                  <input
                    id={`person-name-${idx}`}
                    type="text"
                    value={person.name}
                    required
                    aria-required="true"
                    onChange={(e) => updatePerson(idx, 'name', e.target.value)}
                    placeholder="Full name"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor={`person-role-${idx}`} className={labelClass}>Role</label>
                  <select
                    id={`person-role-${idx}`}
                    value={person.role}
                    onChange={(e) => updatePerson(idx, 'role', e.target.value)}
                    className={inputClass}
                  >
                    <option value="employee">Employee</option>
                    <option value="contractor">Contractor</option>
                    <option value="visitor">Visitor</option>
                    <option value="public">Public</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor={`person-injuries-${idx}`} className={labelClass}>Injuries</label>
                  <input
                    id={`person-injuries-${idx}`}
                    type="text"
                    value={person.injuries || ''}
                    onChange={(e) => updatePerson(idx, 'injuries', e.target.value)}
                    placeholder="Describe injuries"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor={`person-treatment-${idx}`} className={labelClass}>Treatment</label>
                  <input
                    id={`person-treatment-${idx}`}
                    type="text"
                    value={person.treatment || ''}
                    onChange={(e) => updatePerson(idx, 'treatment', e.target.value)}
                    placeholder="Treatment provided"
                    className={inputClass}
                  />
                </div>
              </div>
            </fieldset>
          ))}
        </div>
      </div>

      {/* Witnesses */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider">
            Witnesses
          </h3>
          <button
            type="button"
            aria-label="Add witness"
            onClick={addWitness}
            className="flex items-center gap-1 text-xs text-[var(--ff-primary-500)] hover:text-[var(--ff-primary-400)] min-h-[44px] px-2"
          >
            <Plus aria-hidden="true" className="w-3.5 h-3.5" /> Add Witness
          </button>
        </div>

        {witnesses.length === 0 && (
          <p className="text-sm text-[var(--ff-text-tertiary)] italic">
            No witnesses listed.
          </p>
        )}

        <div className="space-y-2">
          {witnesses.map((witness, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={witness}
                onChange={(e) => updateWitness(idx, e.target.value)}
                placeholder={`Witness ${idx + 1} name`}
                aria-label={`Witness ${idx + 1} name`}
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                aria-label={`Remove witness ${idx + 1}`}
                onClick={() => removeWitness(idx)}
                className="p-2 text-red-400 hover:text-red-300 rounded-lg"
              >
                <Trash2 aria-hidden="true" className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
