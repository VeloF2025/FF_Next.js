import { FilterStatus } from '../types/installation.types';

interface InstallationFilterTabsProps {
  selectedTab: number;
  onTabChange: (tabIndex: number, status: FilterStatus) => void;
}

const tabs = ['All Installations', 'Scheduled', 'In Progress', 'Completed', 'Issues'];

export function InstallationFilterTabs({ 
  selectedTab, 
  onTabChange 
}: InstallationFilterTabsProps) {
  const handleTabClick = (index: number) => {
    let status: FilterStatus = 'all';
    if (index === 1) status = 'scheduled';
    else if (index === 2) status = 'in_progress';
    else if (index === 3) status = 'completed';
    else if (index === 4) status = 'issue';
    
    onTabChange(index, status);
  };

  return (
    <div className="ff-card mb-6">
      <div className="border-b">
        <nav className="flex space-x-8 px-6" aria-label="Tabs">
          {tabs.map((tab, index) => (
            <button
              key={tab}
              onClick={() => handleTabClick(index)}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                selectedTab === index
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-muted-foreground hover:text-muted-foreground hover:border-border'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}