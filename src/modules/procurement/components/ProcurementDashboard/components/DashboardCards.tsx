/**
 * Dashboard Cards Component
 * Grid of procurement metric cards with navigation links
 */

import Link from 'next/link';
import { DashboardCard } from '../types/dashboard.types';

interface DashboardCardsProps {
  cards: DashboardCard[];
}

// Static colorMap — Tailwind cannot scan dynamic class names like `bg-${color}-100`
const colorMap: Record<string, { bg: string; text: string }> = {
  blue:   { bg: 'bg-blue-100',   text: 'text-blue-600' },
  purple: { bg: 'bg-purple-100', text: 'text-purple-600' },
  orange: { bg: 'bg-orange-100', text: 'text-orange-600' },
  red:    { bg: 'bg-red-100',    text: 'text-red-600' },
  green:  { bg: 'bg-green-100',  text: 'text-green-600' },
  indigo: { bg: 'bg-indigo-100', text: 'text-indigo-600' },
};

export function DashboardCards({ cards }: DashboardCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {cards.map((card) => {
        const Icon = card.icon;
        
        return (
          <Link
            key={card.title}
            href={card.link}
            className="bg-card overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow duration-200"
          >
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className={`p-3 rounded-md ${(colorMap[card.color] ?? colorMap.blue).bg}`}>
                    <Icon className={`h-6 w-6 ${(colorMap[card.color] ?? colorMap.blue).text}`} />
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-muted-foreground truncate">
                      {card.title}
                    </dt>
                    <dd className="text-lg font-semibold text-foreground">
                      {card.count}
                    </dd>
                  </dl>
                </div>
              </div>
              <div className="mt-3">
                <p className="text-sm text-muted-foreground">{card.description}</p>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}