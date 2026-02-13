import { useState, useEffect, useCallback, useRef } from 'react';
import type { MCDashboard, MCMessage, MCTask } from '../types';

interface UseMissionControlOptions {
  activeTab?: string;
}

interface UseMissionControlReturn {
  data: MCDashboard | null;
  messages: MCMessage[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createTask: (task: { title: string; description?: string; assigned_to?: string; priority?: string }) => Promise<MCTask | null>;
  updateTask: (id: number, updates: Partial<MCTask>) => Promise<MCTask | null>;
  deleteTask: (id: number) => Promise<boolean>;
}

export function useMissionControl({ activeTab = 'dashboard' }: UseMissionControlOptions = {}): UseMissionControlReturn {
  const [data, setData] = useState<MCDashboard | null>(null);
  const [messages, setMessages] = useState<MCMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dashboardInterval = useRef<NodeJS.Timeout | null>(null);
  const messagesInterval = useRef<NodeJS.Timeout | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/mission-control/dashboard');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch dashboard');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch('/api/mission-control/messages?limit=50');
      if (!res.ok) return;
      const json = await res.json();
      setMessages(Array.isArray(json) ? json : json.messages || []);
    } catch {
      // silent fail for polling
    }
  }, []);

  // Dashboard polling (10s)
  useEffect(() => {
    fetchDashboard();
    dashboardInterval.current = setInterval(fetchDashboard, 10000);
    return () => {
      if (dashboardInterval.current) clearInterval(dashboardInterval.current);
    };
  }, [fetchDashboard]);

  // Messages polling (3s) only on live-feed tab
  useEffect(() => {
    if (activeTab === 'live-feed') {
      fetchMessages();
      messagesInterval.current = setInterval(fetchMessages, 3000);
    }
    return () => {
      if (messagesInterval.current) clearInterval(messagesInterval.current);
    };
  }, [activeTab, fetchMessages]);

  const createTask = useCallback(async (task: { title: string; description?: string; assigned_to?: string; priority?: string }) => {
    try {
      const res = await fetch('/api/mission-control/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });
      if (!res.ok) return null;
      const created = await res.json();
      await fetchDashboard();
      return created;
    } catch {
      return null;
    }
  }, [fetchDashboard]);

  const updateTask = useCallback(async (id: number, updates: Partial<MCTask>) => {
    try {
      const res = await fetch(`/api/mission-control/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) return null;
      const updated = await res.json();
      await fetchDashboard();
      return updated;
    } catch {
      return null;
    }
  }, [fetchDashboard]);

  const deleteTask = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/mission-control/tasks/${id}`, { method: 'DELETE' });
      if (!res.ok) return false;
      await fetchDashboard();
      return true;
    } catch {
      return false;
    }
  }, [fetchDashboard]);

  return { data, messages, isLoading, error, refetch: fetchDashboard, createTask, updateTask, deleteTask };
}
