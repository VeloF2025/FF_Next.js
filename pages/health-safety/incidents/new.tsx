/**
 * Report New H&S Incident Page
 * /health-safety/incidents/new - Form to report a new H&S incident
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import {
  AlertTriangle,
  ChevronLeft,
  MapPin,
} from 'lucide-react';
import { log } from '@/lib/logger';

function NewIncidentContent() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    severity: 'moderate',
    incident_date: new Date().toISOString().split('T')[0],
    incident_time: '',
    location: '',
    reported_by: '',
    is_near_miss: false,
    is_dol_reportable: false,
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/health-safety/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create incident');
      }

      router.push('/health-safety/incidents');
    } catch (err) {
      log.error('Failed to create incident:', err as Error);
      alert(err instanceof Error ? err.message : 'Failed to create incident');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/health-safety/incidents"
          className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Report Incident</h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Report a new health & safety incident
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Incident Title */}
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1"
          >
            Incident Title *
          </label>
          <input
            type="text"
            id="title"
            name="title"
            required
            value={formData.title}
            onChange={handleChange}
            placeholder="Brief description of the incident"
            className="w-full px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]"
          />
        </div>

        {/* Severity & Date */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="severity"
              className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1"
            >
              Severity *
            </label>
            <select
              id="severity"
              name="severity"
              required
              value={formData.severity}
              onChange={handleChange}
              className="w-full px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]"
            >
              <option value="critical">Critical</option>
              <option value="major">Major</option>
              <option value="moderate">Moderate</option>
              <option value="minor">Minor</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="incident_date"
              className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1"
            >
              Date *
            </label>
            <input
              type="date"
              id="incident_date"
              name="incident_date"
              required
              value={formData.incident_date}
              onChange={handleChange}
              className="w-full px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]"
            />
          </div>
          <div>
            <label
              htmlFor="incident_time"
              className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1"
            >
              Time
            </label>
            <input
              type="time"
              id="incident_time"
              name="incident_time"
              value={formData.incident_time}
              onChange={handleChange}
              className="w-full px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]"
            />
          </div>
        </div>

        {/* Location */}
        <div>
          <label
            htmlFor="location"
            className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1"
          >
            Location
          </label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
            <input
              type="text"
              id="location"
              name="location"
              value={formData.location}
              onChange={handleChange}
              placeholder="Where did the incident occur?"
              className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]"
            />
          </div>
        </div>

        {/* Reported By */}
        <div>
          <label
            htmlFor="reported_by"
            className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1"
          >
            Reported By
          </label>
          <input
            type="text"
            id="reported_by"
            name="reported_by"
            value={formData.reported_by}
            onChange={handleChange}
            placeholder="Name of person reporting"
            className="w-full px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]"
          />
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1"
          >
            Description *
          </label>
          <textarea
            id="description"
            name="description"
            required
            rows={5}
            value={formData.description}
            onChange={handleChange}
            placeholder="Detailed description of what happened, injuries, damage, etc."
            className="w-full px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)] resize-y"
          />
        </div>

        {/* Checkboxes */}
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              name="is_near_miss"
              checked={formData.is_near_miss}
              onChange={handleChange}
              className="w-4 h-4 rounded border-[var(--ff-border-light)] text-[var(--ff-primary-500)] focus:ring-[var(--ff-primary-500)]"
            />
            <span className="text-sm text-[var(--ff-text-primary)]">Near Miss</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              name="is_dol_reportable"
              checked={formData.is_dol_reportable}
              onChange={handleChange}
              className="w-4 h-4 rounded border-[var(--ff-border-light)] text-[var(--ff-primary-500)] focus:ring-[var(--ff-primary-500)]"
            />
            <span className="text-sm text-[var(--ff-text-primary)]">DoL Reportable</span>
          </label>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4 pt-4 border-t border-[var(--ff-border-light)]">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-6 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            <AlertTriangle className="w-4 h-4" />
            {isSubmitting ? 'Submitting...' : 'Report Incident'}
          </button>
          <Link
            href="/health-safety/incidents"
            className="px-6 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
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
