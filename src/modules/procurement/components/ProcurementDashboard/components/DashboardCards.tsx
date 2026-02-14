/**
 * Dashboard Cards Component
 * Grid of procurement metric cards with navigation links
 */

import { Link } from 'react-router-dom';
import { DashboardCard } from '../types/dashboard.types';

interface DashboardCardsProps {
  cards: DashboardCard[];
}

export function DashboardCards({ cards }: DashboardCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {cards.map((card) => {
        const Icon = card.icon;
        
        return (
          <Link
            key={card.title}
            to={card.link}
            className="bg-card overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow duration-200"
          >
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className={`p-3 rounded-md bg-${card.color}-100`}>
                    <Icon className={`h-6 w-6 text-${card.color}-600`} />
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