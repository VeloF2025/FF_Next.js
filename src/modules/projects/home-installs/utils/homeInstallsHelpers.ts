import { HomeInstall } from '../types/home-install.types';

/**
 * Filter installs based on search term, status, and date filters
 */
export function filterHomeInstalls(
  installs: HomeInstall[],
  searchTerm: string,
  statusFilter: string,
  dateFilter: string
): HomeInstall[] {
  let filtered = [...installs];

  // Apply search filter
  if (searchTerm) {
    const search = searchTerm.toLowerCase();
    filtered = filtered.filter(install =>
      install.customerName.toLowerCase().includes(search) ||
      install.address.toLowerCase().includes(search) ||
      (install.orderNumber && install.orderNumber.toLowerCase().includes(search)) ||
      install.customerId?.toLowerCase().includes(search) ||
      install.alternatePhone?.includes(search)
    );
  }

  // Apply status filter
  if (statusFilter !== 'all') {
    filtered = filtered.filter(install => install.status === statusFilter);
  }

  // Apply date filter
  if (dateFilter !== 'all') {
    const today = new Date().toISOString().split('T')[0]!;
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]!;
    
    switch (dateFilter) {
      case 'today':
        filtered = filtered.filter(install => install.scheduledDate === today);
        break;
      case 'tomorrow':
        filtered = filtered.filter(install => install.scheduledDate === tomorrow);
        break;
      case 'this_week': {
        const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]!;
        filtered = filtered.filter(install => 
          install.scheduledDate >= today && install.scheduledDate <= weekFromNow
        );
        break;
      }
      case 'overdue':
        filtered = filtered.filter(install => 
          install.scheduledDate < today && install.status !== 'completed' && install.status !== 'cancelled'
        );
        break;
    }
  }

  return filtered;
}

/**
 * Export installs to CSV format
 */
export function exportInstallsToCSV(installs: HomeInstall[]): void {
  const headers = [
    'Order Number',
    'Customer Name',
    'Email',
    'Phone',
    'Address',
    'Scheduled Date',
    'Scheduled Time',
    'Status',
    'Package Type',
    'Speed (Mbps)',
    'Technician',
    'ONT Serial',
    'Router Serial'
  ];

  const rows = installs.map(install => [
    install.orderNumber,
    install.customerName,
    install.customerId,
    install.alternatePhone || '',
    install.address,
    install.scheduledDate,
    '',
    install.status,
    install.packageType,
    install.speed,
    install.assignedTechnician || '',
    install.ontSerial || '',
    install.routerSerial || ''
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `home-installations-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

