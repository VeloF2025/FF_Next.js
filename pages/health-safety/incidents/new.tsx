/**
 * Report New H&S Incident Page
 * /health-safety/incidents/new
 *
 * Complete incident reporting form with all hs_ticket_details fields.
 */

import type { NextPage } from 'next';
import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { AlertTriangle, ChevronLeft } from 'lucide-react';
import { log } from '@/lib/logger';
import type { HSIncidentType, HSSeverity, PersonInvolved } from '@/modules/health-safety/types/ticket.types';
import { SEVERITY_CONFIG } from '@/modules/health-safety/types/ticket.types';
import {
  IncidentBasicFields,
  IncidentLocationFields,
  IncidentDetailsFields,
  IncidentPersonsSection,
  IncidentPhotoUpload,
  type IncidentPhoto,
} from '@/modules/health-safety/components/incident-form';

interface FormState {
  incident_type: HSIncidentType;
  severity: HSSeverity;
  incident_date: string;
  incident_time: string;
  title: string;
  description: string;
  immediate_actions: string;
  reported_by: string;
  location: string;
  project_id: string;
  contractor_id: string;
  dol_reportable: boolean;
}

function NewIncidentContent() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ id: number; project_name: string }[]>([]);
  const [contractors, setContractors] = useState<{ id: number; company_name: string }[]>([]);
  const [persons, setPersons] = useState<PersonInvolved[]>([]);
  const [witnesses, setWitnesses] = useState<string[]>([]);
  const [photos, setPhotos] = useState<IncidentPhoto[]>([]);

  const [form, setForm] = useState<FormState>({
    incident_type: 'injury',
    severity: 'moderate',
    incident_date: new Date().toISOString().split('T')[0] ?? '',
    incident_time: '',
    title: '',
    description: '',
    immediate_actions: '',
    reported_by: '',
    location: '',
    project_id: router.query.project_id as string || '',
    contractor_id: '',
    dol_reportable: false,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [projRes, contRes] = await Promise.all([
          fetch('/api/projects', { credentials: 'include' }),
          fetch('/api/contractors', { credentials: 'include' }),
        ]);
        const projData = await projRes.json();
        const contData = await contRes.json();
        if (projData.success) setProjects(projData.data || []);
        if (contData.success) setContractors(contData.data || []);
      } catch (err) {
        log.error('Failed to load form data', { error: err as Error });
      }
    };
    load();
  }, []);

  const handleChange = useCallback((field: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const autoDol = SEVERITY_CONFIG[form.severity]?.dol_reportable ?? false;

    const payload = {
      title: form.title,
      incident_type: form.incident_type,
      severity: form.severity,
      incident_date: form.incident_date,
      incident_time: form.incident_time || undefined,
      location: form.location || undefined,
      description: form.description,
      immediate_actions: form.immediate_actions || undefined,
      dol_reportable: form.dol_reportable || autoDol,
      project_id: form.project_id || undefined,
      contractor_id: form.contractor_id || undefined,
      injured_persons: persons.filter((p) => p.name.trim()),
      witnesses: witnesses.filter((w) => w.trim()),
      photos,
    };

    try {
      const res = await fetch('/api/health-safety/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create incident');
      }

      router.push('/projects/health-safety/incidents');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create incident';
      log.error('Failed to create incident:', { error: err as Error });
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/projects/health-safety/incidents"
          className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Report Incident</h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Report a new health &amp; safety incident
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <IncidentBasicFields
          incidentType={form.incident_type}
          severity={form.severity}
          incidentDate={form.incident_date}
          incidentTime={form.incident_time}
          onChange={handleChange}
        />

        <IncidentLocationFields
          location={form.location}
          projectId={form.project_id}
          contractorId={form.contractor_id}
          projects={projects}
          contractors={contractors}
          onChange={handleChange}
        />

        <IncidentDetailsFields
          title={form.title}
          description={form.description}
          immediateActions={form.immediate_actions}
          reportedBy={form.reported_by}
          isDolReportable={form.dol_reportable}
          severity={form.severity}
          onChange={handleChange}
        />

        <IncidentPersonsSection
          persons={persons}
          witnesses={witnesses}
          onPersonsChange={setPersons}
          onWitnessesChange={setWitnesses}
        />

        <IncidentPhotoUpload
          photos={photos}
          onPhotosChange={setPhotos}
        />

        {/* Actions */}
        <div className="flex items-center gap-4 pt-4 border-t border-[var(--ff-border-light)]">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-6 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            <AlertTriangle className="w-4 h-4" />
            {isSubmitting ? 'Submitting...' : 'Report Incident'}
          </button>
          <Link
            href="/projects/health-safety"
            className="px-6 py-2.5 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

const NewIncidentPage: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>Report Incident | H&S | FibreFlow</title>
      </Head>
      <ModulePage config={projectsConfig}>
        <NewIncidentContent />
      </ModulePage>
    </AppLayout>
  );
};

export const getServerSideProps = async () => {
  return { props: {} };
};

export default NewIncidentPage;
