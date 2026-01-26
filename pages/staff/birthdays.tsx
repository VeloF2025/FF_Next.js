/**
 * Staff Birthdays Page
 * Shows upcoming staff birthdays
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { staffConfig } from '@/modules/navigation';
import { Card, CardContent } from '@/shared/components/ui/Card';
import { Badge } from '@/shared/components/ui/Badge';
import { Cake, RefreshCw, Calendar, Gift, PartyPopper } from 'lucide-react';

interface BirthdayAlert {
  id: string;
  name: string;
  email: string | null;
  dateOfBirth: string;
  department: string | null;
  position: string | null;
  daysUntil: number;
  age: number;
}

function BirthdaysSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <div className="h-24 bg-[var(--ff-bg-tertiary)] rounded animate-pulse"></div>
        </div>
      ))}
    </div>
  );
}

export default function StaffBirthdaysPage() {
  const router = useRouter();
  const [birthdays, setBirthdays] = useState<BirthdayAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [daysRange, setDaysRange] = useState(30);

  useEffect(() => {
    fetchBirthdays();
  }, [daysRange]);

  const fetchBirthdays = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/staff/alerts?type=birthdays&days=${daysRange}`);
      if (response.ok) {
        const data = await response.json();
        setBirthdays(data.birthdays || []);
      }
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' });
  };

  const getDaysText = (days: number) => {
    if (days === 0) return 'Today! 🎂';
    if (days === 1) return 'Tomorrow';
    if (days <= 7) return `This week (${days} days)`;
    return `In ${days} days`;
  };

  const todayBirthdays = birthdays.filter((b) => b.daysUntil === 0);
  const thisWeekBirthdays = birthdays.filter((b) => b.daysUntil > 0 && b.daysUntil <= 7);
  const upcomingBirthdays = birthdays.filter((b) => b.daysUntil > 7);

  // Header actions
  const headerActions = (
    <div className="flex gap-3">
      <select
        value={daysRange}
        onChange={(e) => setDaysRange(Number(e.target.value))}
        className="px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm"
      >
        <option value={7}>Next 7 days</option>
        <option value={30}>Next 30 days</option>
        <option value={60}>Next 60 days</option>
        <option value={90}>Next 90 days</option>
      </select>
      <button
        onClick={fetchBirthdays}
        className="px-4 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors flex items-center gap-2"
      >
        <RefreshCw className="w-4 h-4" />
        Refresh
      </button>
    </div>
  );

  if (loading) {
    return (
      <AppLayout>
        <ModulePage config={staffConfig} headerActions={headerActions} isLoading>
          <BirthdaysSkeleton />
        </ModulePage>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <ModulePage config={staffConfig} headerActions={headerActions}>
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--ff-text-secondary)]">Today</p>
                    <p className="text-2xl font-bold text-pink-400">{todayBirthdays.length}</p>
                  </div>
                  <PartyPopper className="h-8 w-8 text-pink-400" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--ff-text-secondary)]">This Week</p>
                    <p className="text-2xl font-bold text-orange-400">{thisWeekBirthdays.length}</p>
                  </div>
                  <Gift className="h-8 w-8 text-orange-400" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--ff-text-secondary)]">Upcoming</p>
                    <p className="text-2xl font-bold text-blue-400">{upcomingBirthdays.length}</p>
                  </div>
                  <Calendar className="h-8 w-8 text-blue-400" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Today's Birthdays */}
          {todayBirthdays.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
                <PartyPopper className="h-5 w-5 text-pink-400" />
                Today&apos;s Birthdays
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {todayBirthdays.map((birthday) => (
                  <div
                    key={birthday.id}
                    onClick={() => router.push(`/staff/${birthday.id}`)}
                    className="bg-gradient-to-br from-pink-500/20 to-purple-500/20 border border-pink-500/30 rounded-lg cursor-pointer hover:border-pink-400 transition-all"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-full bg-pink-500/30">
                          <Cake className="h-6 w-6 text-pink-300" />
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-[var(--ff-text-primary)]">
                            {birthday.name} 🎂
                          </p>
                          <p className="text-sm text-[var(--ff-text-secondary)]">
                            Turning {birthday.age} today!
                          </p>
                          {birthday.department && (
                            <p className="text-xs text-[var(--ff-text-tertiary)]">{birthday.department}</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* This Week */}
          {thisWeekBirthdays.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
                <Gift className="h-5 w-5 text-orange-400" />
                This Week
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {thisWeekBirthdays.map((birthday) => (
                  <div
                    key={birthday.id}
                    onClick={() => router.push(`/staff/${birthday.id}`)}
                    className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg cursor-pointer hover:border-orange-400/50 transition-all"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-full bg-orange-500/20">
                          <Cake className="h-6 w-6 text-orange-400" />
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-[var(--ff-text-primary)]">{birthday.name}</p>
                          <p className="text-sm text-[var(--ff-text-secondary)]">
                            {formatDate(birthday.dateOfBirth)} • Turning {birthday.age}
                          </p>
                          {birthday.department && (
                            <p className="text-xs text-[var(--ff-text-tertiary)]">{birthday.department}</p>
                          )}
                        </div>
                        <Badge className="bg-orange-500/20 text-orange-400">{getDaysText(birthday.daysUntil)}</Badge>
                      </div>
                    </CardContent>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upcoming */}
          {upcomingBirthdays.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-blue-400" />
                Upcoming
              </h3>
              <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
                <CardContent className="p-0">
                  <div className="divide-y divide-[var(--ff-border-light)]">
                    {upcomingBirthdays.map((birthday) => (
                      <div
                        key={birthday.id}
                        onClick={() => router.push(`/staff/${birthday.id}`)}
                        className="flex items-center justify-between p-4 hover:bg-[var(--ff-bg-tertiary)] cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className="p-2 rounded-full bg-blue-500/20">
                            <Cake className="h-5 w-5 text-blue-400" />
                          </div>
                          <div>
                            <p className="font-medium text-[var(--ff-text-primary)]">{birthday.name}</p>
                            <p className="text-sm text-[var(--ff-text-secondary)]">
                              {formatDate(birthday.dateOfBirth)} • Turning {birthday.age}
                              {birthday.department && ` • ${birthday.department}`}
                            </p>
                          </div>
                        </div>
                        <Badge className="bg-blue-500/20 text-blue-400">{getDaysText(birthday.daysUntil)}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Empty State */}
          {birthdays.length === 0 && (
            <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
              <CardContent className="py-12 text-center">
                <Cake className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
                <p className="text-[var(--ff-text-secondary)]">No upcoming birthdays in the next {daysRange} days</p>
              </CardContent>
            </Card>
          )}
        </div>
      </ModulePage>
    </AppLayout>
  );
}

export const getServerSideProps = async () => {
  return { props: {} };
};
