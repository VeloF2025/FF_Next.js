import { MancoActionItem } from '@/types/manco-action-items.types';

export function isOverdue(item: MancoActionItem): boolean {
  if (!item.completion_eta || item.status === 'completed' || item.status === 'cancelled') {
    return false;
  }
  return new Date(item.completion_eta) < new Date();
}

export function daysUntilEta(item: MancoActionItem): number | null {
  if (!item.completion_eta) return null;
  const eta = new Date(item.completion_eta);
  const today = new Date();
  const diff = eta.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 3600 * 24));
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function getStatusColor(status: string, isOverdue: boolean): string {
  if (isOverdue) return 'var(--ff-danger)';
  switch (status) {
    case 'pending':
      return 'var(--ff-warning)';
    case 'in_progress':
      return 'var(--ff-info)';
    case 'completed':
      return 'var(--ff-success)';
    case 'cancelled':
      return 'var(--ff-text-secondary)';
    default:
      return 'var(--ff-text-secondary)';
  }
}

export function truncateText(text: string | undefined, maxLength: number): string {
  if (!text) return '—';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

export function getUniqueDepartments(items: MancoActionItem[]): string[] {
  const depts = new Set<string>();
  items.forEach((item) => {
    if (item.department) depts.add(item.department);
  });
  return Array.from(depts).sort();
}

export function getUniqueResponsiblePersons(items: MancoActionItem[]): string[] {
  const persons = new Set<string>();
  items.forEach((item) => {
    if (item.responsible_person) persons.add(item.responsible_person);
  });
  return Array.from(persons).sort();
}
