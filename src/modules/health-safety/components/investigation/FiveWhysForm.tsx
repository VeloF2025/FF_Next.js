/**
 * Five Whys Root Cause Analysis Form
 *
 * Structured 5-whys input that builds a causal chain from symptom to root cause.
 */

import React from 'react';
import { Plus, Trash2, HelpCircle } from 'lucide-react';

export interface WhyEntry {
  step: number;
  question: string;
  answer: string;
}

interface FiveWhysFormProps {
  entries: WhyEntry[];
  onChange: (entries: WhyEntry[]) => void;
}

const inputClass =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';

const DEFAULT_QUESTIONS = [
  'Why did this incident occur?',
  'Why did that happen?',
  'Why was that the case?',
  'Why did that condition exist?',
  'Why was that not prevented?',
];

export function FiveWhysForm({ entries, onChange }: FiveWhysFormProps) {
  const addEntry = () => {
    const step = entries.length + 1;
    onChange([
      ...entries,
      {
        step,
        question: DEFAULT_QUESTIONS[step - 1] || `Why? (Level ${step})`,
        answer: '',
      },
    ]);
  };

  const removeEntry = (idx: number) => {
    onChange(
      entries
        .filter((_, i) => i !== idx)
        .map((e, i) => ({ ...e, step: i + 1 }))
    );
  };

  const updateEntry = (idx: number, field: 'question' | 'answer', value: string) => {
    onChange(entries.map((e, i) => (i === idx ? { ...e, [field]: value } : e)));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-[var(--ff-text-primary)]">
            5-Whys Analysis
          </h4>
          <div className="group relative">
            <HelpCircle className="w-3.5 h-3.5 text-[var(--ff-text-tertiary)]" />
            <div className="absolute left-0 top-6 w-64 p-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-xs text-[var(--ff-text-secondary)] hidden group-hover:block z-10 shadow-lg">
              Ask &quot;why?&quot; repeatedly to drill down from the symptom to the root cause.
              Typically 5 levels deep is sufficient.
            </div>
          </div>
        </div>
        {entries.length < 7 && (
          <button
            type="button"
            onClick={addEntry}
            className="flex items-center gap-1 text-xs text-[var(--ff-primary-500)] hover:text-[var(--ff-primary-400)]"
          >
            <Plus className="w-3.5 h-3.5" /> Add Why
          </button>
        )}
      </div>

      {entries.length === 0 && (
        <button
          type="button"
          onClick={addEntry}
          className="w-full p-4 border border-dashed border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-tertiary)] hover:border-[var(--ff-primary-500)] hover:text-[var(--ff-primary-500)] transition-colors"
        >
          Click to start 5-Whys analysis
        </button>
      )}

      <div className="space-y-3">
        {entries.map((entry, idx) => (
          <div
            key={idx}
            className="relative pl-8 pb-3 border-l-2 border-[var(--ff-border-light)] last:border-l-0"
          >
            {/* Step indicator */}
            <div className="absolute -left-3 top-0 w-6 h-6 rounded-full bg-[var(--ff-primary-500)] text-white text-xs font-bold flex items-center justify-center">
              {entry.step}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={entry.question}
                  onChange={(e) => updateEntry(idx, 'question', e.target.value)}
                  className={`${inputClass} font-medium text-amber-500`}
                  placeholder="Why?"
                />
                {entries.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeEntry(idx)}
                    className="text-red-400 hover:text-red-300 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <textarea
                value={entry.answer}
                onChange={(e) => updateEntry(idx, 'answer', e.target.value)}
                placeholder="Because..."
                rows={2}
                className={`${inputClass} resize-y`}
              />
            </div>
          </div>
        ))}
      </div>

      {entries.length > 0 && entries[entries.length - 1]?.answer && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
          <p className="text-xs font-medium text-green-400 mb-1">Root Cause Identified:</p>
          <p className="text-sm text-[var(--ff-text-primary)]">
            {entries[entries.length - 1]!.answer}
          </p>
        </div>
      )}
    </div>
  );
}
