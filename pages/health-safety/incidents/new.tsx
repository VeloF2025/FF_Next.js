/**
 * Report New H&S Incident
 *
 * Form to report a new health & safety incident with:
 * - Incident classification (type, severity)
 * - Location and date/time
 * - Injured persons
 * - Witnesses
 * - Immediate actions taken
 * - Photo evidence
 */

import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import {
  Shield,
  AlertTriangle,
  ChevronLeft,
  Calendar,
  MapPin,
  Clock,
  User,
  UserPlus,
  Eye,
  Camera,
  FileText,
  AlertOctagon,
  Save,
  Loader2,
  X,
  Plus,
  Trash2,
  Building2,
  Info,
} from 'lucide-react';
import { AppLayout } from '@/components/layout';
import { notificationService } from '@/services/core/NotificationService';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface InjuredPerson {
  name: string;
  role: string;
  injuries: string;
  treatment: string;
}

interface Witness {
  name: string;
  contact: string;
}

const INCIDENT_TYPES = [
  { value: 'injury', label: 'Injury', icon: User, description: 'Personal injury to worker or third party' },
  { value: 'near_miss', label: 'Near Miss', icon: AlertTriangle, description: 'Close call without injury or damage' },
  { value: 'property_damage', label: 'Property Damage', icon: Building2, description: 'Damage to property or equipment' },
  { value: 'environmental', label: 'Environmental', icon: Shield, description: 'Environmental spill or contamination' },
  { value: 'vehicle', label: 'Vehicle Incident', icon: AlertOctagon, description: 'Vehicle accident or incident' },
  { value: 'other', label: 'Other', icon: FileText, description: 'Other H&S related incident' },
];

const SEVERITY_LEVELS = [
  { value: 'minor', label: 'Minor', color: 'bg-gray-500', description: 'No or minor injury, minimal impact' },
  { value: 'moderate', label: 'Moderate', color: 'bg-yellow-500', description: 'Injury requiring medical treatment' },
  { value: 'major', label: 'Major', color: 'bg-orange-500', description: 'Serious injury, hospitalization required', dol: true },
  { value: 'critical', label: 'Critical/Fatal', color: 'bg-red-500', description: 'Fatality or permanent disability', dol: true },
];

export default function NewIncidentPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    incident_type: '',
    severity: 'moderate',
    incident_date: new Date().toISOString().split('T')[0],
    incident_time: '',
    location: '',
    description: '',
    immediate_actions: '',
    project_id: '',
    contractor_id: '',
    dol_reportable: false,
    corrective_action_required: false,
  });

  const [injuredPersons, setInjuredPersons] = useState<InjuredPerson[]>([]);
  const [witnesses, setWitnesses] = useState<Witness[]>([]);

  // Load projects and contractors for dropdowns
  const { data: projectsData } = useSWR('/api/projects?limit=100', fetcher);
  const { data: contractorsData } = useSWR('/api/contractors?limit=100', fetcher);

  const projects = projectsData?.data || [];
  const contractors = contractorsData?.data || [];

  // Check if severity requires DoL reporting
  const selectedSeverity = SEVERITY_LEVELS.find((s) => s.value === formData.severity);
  const isDolRequired = selectedSeverity?.dol || false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.incident_type) {
      notificationService.error('Please select an incident type');
      return;
    }

    if (!formData.description) {
      notificationService.error('Please provide a description of the incident');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/health-safety/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          dol_reportable: isDolRequired || formData.dol_reportable,
          injured_persons: injuredPersons,
          witnesses: witnesses,
        }),
      });

      const result = await response.json();

      if (result.success) {
        notificationService.success('Incident reported successfully');
        router.push('/health-safety/incidents');
      } else {
        notificationService.error(result.error || 'Failed to report incident');
      }
    } catch (error) {
      notificationService.error('Failed to report incident');
    } finally {
      setIsSubmitting(false);
    }
  };

  const addInjuredPerson = () => {
    setInjuredPersons([...injuredPersons, { name: '', role: 'employee', injuries: '', treatment: '' }]);
  };

  const removeInjuredPerson = (index: number) => {
    setInjuredPersons(injuredPersons.filter((_, i) => i !== index));
  };

  const updateInjuredPerson = (index: number, field: keyof InjuredPerson, value: string) => {
    const updated = [...injuredPersons];
    updated[index] = { ...updated[index], [field]: value };
    setInjuredPersons(updated);
  };

  const addWitness = () => {
    setWitnesses([...witnesses, { name: '', contact: '' }]);
  };

  const removeWitness = (index: number) => {
    setWitnesses(witnesses.filter((_, i) => i !== index));
  };

  const updateWitness = (index: number, field: keyof Witness, value: string) => {
    const updated = [...witnesses];
    updated[index] = { ...updated[index], [field]: value };
    setWitnesses(updated);
  };

  return (
    <>
      <Head>
        <title>Report Incident | H&S | FibreFlow</title>
      </Head>

      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/health-safety/incidents"
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <AlertTriangle className="w-7 h-7 text-red-500" />
              Report H&S Incident
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Document health & safety incidents for investigation and compliance
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Incident Type Selection */}
          <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Incident Type
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {INCIDENT_TYPES.map((type) => {
                const Icon = type.icon;
                const isSelected = formData.incident_type === type.value;
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, incident_type: type.value })}
                    className={`p-4 rounded-lg border-2 text-left transition-all ${
                      isSelected
                        ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <Icon
                      className={`w-6 h-6 mb-2 ${isSelected ? 'text-orange-500' : 'text-gray-400'}`}
                    />
                    <p className={`font-medium ${isSelected ? 'text-orange-600 dark:text-orange-400' : 'text-gray-900 dark:text-white'}`}>
                      {type.label}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{type.description}</p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Severity Selection */}
          <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Severity Level
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {SEVERITY_LEVELS.map((level) => {
                const isSelected = formData.severity === level.value;
                return (
                  <button
                    key={level.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, severity: level.value })}
                    className={`p-4 rounded-lg border-2 text-left transition-all ${
                      isSelected
                        ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-3 h-3 rounded-full ${level.color}`} />
                      <span className={`font-medium ${isSelected ? 'text-orange-600 dark:text-orange-400' : 'text-gray-900 dark:text-white'}`}>
                        {level.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{level.description}</p>
                    {level.dol && (
                      <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <AlertOctagon className="w-3 h-3" />
                        DoL Reportable
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
            {isDolRequired && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertOctagon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-800 dark:text-red-200">
                      Department of Labour Reporting Required
                    </p>
                    <p className="text-sm text-red-600 dark:text-red-300 mt-1">
                      This severity level requires mandatory reporting to the Department of Labour within 24 hours
                      as per OHS Act Section 24.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Incident Details */}
          <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Incident Details
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Incident Title
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Brief description of the incident"
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <Calendar className="w-4 h-4 inline mr-1" />
                    Date
                  </label>
                  <input
                    type="date"
                    value={formData.incident_date}
                    onChange={(e) => setFormData({ ...formData, incident_date: e.target.value })}
                    className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <Clock className="w-4 h-4 inline mr-1" />
                    Time (if known)
                  </label>
                  <input
                    type="time"
                    value={formData.incident_time}
                    onChange={(e) => setFormData({ ...formData, incident_time: e.target.value })}
                    className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <MapPin className="w-4 h-4 inline mr-1" />
                    Location
                  </label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="Where did it happen?"
                    className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <Building2 className="w-4 h-4 inline mr-1" />
                    Project (optional)
                  </label>
                  <select
                    value={formData.project_id}
                    onChange={(e) => setFormData({ ...formData, project_id: e.target.value })}
                    className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">Select project...</option>
                    {projects.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.project_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <User className="w-4 h-4 inline mr-1" />
                    Contractor (optional)
                  </label>
                  <select
                    value={formData.contractor_id}
                    onChange={(e) => setFormData({ ...formData, contractor_id: e.target.value })}
                    className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">Select contractor...</option>
                    {contractors.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.company_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description of Incident *
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe what happened in detail..."
                  rows={4}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Immediate Actions Taken
                </label>
                <textarea
                  value={formData.immediate_actions}
                  onChange={(e) => setFormData({ ...formData, immediate_actions: e.target.value })}
                  placeholder="What actions were taken immediately after the incident?"
                  rows={3}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>
          </section>

          {/* Injured Persons */}
          {formData.incident_type === 'injury' && (
            <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-red-500" />
                  Injured Persons
                </h2>
                <button
                  type="button"
                  onClick={addInjuredPerson}
                  className="flex items-center gap-1 px-3 py-1 text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30"
                >
                  <Plus className="w-4 h-4" />
                  Add Person
                </button>
              </div>

              {injuredPersons.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                  Click &quot;Add Person&quot; to record injured persons
                </p>
              ) : (
                <div className="space-y-4">
                  {injuredPersons.map((person, index) => (
                    <div
                      key={index}
                      className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Person {index + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeInjuredPerson(index)}
                          className="p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input
                          type="text"
                          placeholder="Name"
                          value={person.name}
                          onChange={(e) => updateInjuredPerson(index, 'name', e.target.value)}
                          className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
                        />
                        <select
                          value={person.role}
                          onChange={(e) => updateInjuredPerson(index, 'role', e.target.value)}
                          className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
                        >
                          <option value="employee">Employee</option>
                          <option value="contractor">Contractor</option>
                          <option value="visitor">Visitor</option>
                          <option value="public">Member of Public</option>
                        </select>
                        <input
                          type="text"
                          placeholder="Nature of injuries"
                          value={person.injuries}
                          onChange={(e) => updateInjuredPerson(index, 'injuries', e.target.value)}
                          className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
                        />
                        <input
                          type="text"
                          placeholder="Treatment given"
                          value={person.treatment}
                          onChange={(e) => updateInjuredPerson(index, 'treatment', e.target.value)}
                          className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Witnesses */}
          <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Eye className="w-5 h-5 text-blue-500" />
                Witnesses
              </h2>
              <button
                type="button"
                onClick={addWitness}
                className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30"
              >
                <Plus className="w-4 h-4" />
                Add Witness
              </button>
            </div>

            {witnesses.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                Click &quot;Add Witness&quot; to record witness information
              </p>
            ) : (
              <div className="space-y-3">
                {witnesses.map((witness, index) => (
                  <div key={index} className="flex gap-3 items-center">
                    <input
                      type="text"
                      placeholder="Witness name"
                      value={witness.name}
                      onChange={(e) => updateWitness(index, 'name', e.target.value)}
                      className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Contact number"
                      value={witness.contact}
                      onChange={(e) => updateWitness(index, 'contact', e.target.value)}
                      className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => removeWitness(index)}
                      className="p-2 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Additional Options */}
          <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Additional Options
            </h2>
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.corrective_action_required}
                  onChange={(e) =>
                    setFormData({ ...formData, corrective_action_required: e.target.checked })
                  }
                  className="w-4 h-4 mt-1 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                />
                <div>
                  <span className="text-gray-900 dark:text-white font-medium">
                    Corrective Action Required
                  </span>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Flag this incident for follow-up corrective actions
                  </p>
                </div>
              </label>

              {!isDolRequired && (
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.dol_reportable}
                    onChange={(e) =>
                      setFormData({ ...formData, dol_reportable: e.target.checked })
                    }
                    className="w-4 h-4 mt-1 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                  />
                  <div>
                    <span className="text-gray-900 dark:text-white font-medium">
                      DoL Reportable (Manual Override)
                    </span>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Mark as reportable to Department of Labour even if severity doesn&apos;t require it
                    </p>
                  </div>
                </label>
              )}
            </div>
          </section>

          {/* Submit Buttons */}
          <div className="flex items-center justify-between pt-4">
            <Link
              href="/health-safety/incidents"
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-6 py-2 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white rounded-lg transition-colors"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Report Incident
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

NewIncidentPage.getLayout = (page: React.ReactElement) => <AppLayout>{page}</AppLayout>;
