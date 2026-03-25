import { Client } from '@/types/client.types';
import { clientCrudService } from './clientCrudService';

/**
 * Export and template generation for clients
 */
export const clientExportService = {
  /**
   * Export clients to Excel file
   */
  async exportToExcel(clients?: Client[]): Promise<Blob> {
    const XLSX = await import('xlsx');
    // Get all clients if not provided
    const dataToExport = clients || await clientCrudService.getAll();
    
    // Transform data for export
    const exportData = dataToExport.map(c => ({
      'Company Name': c.name,
      'Contact Person': c.contactPerson,
      'Email': c.email,
      'Phone': c.phone,
      'Alternative Email': c.alternativeEmail || '',
      'Alternative Phone': c.alternativePhone || '',
      'Address': c.address,
      'City': c.city,
      'Province': c.province,
      'Postal Code': c.postalCode,
      'Country': c.country,
      'Registration Number': c.registrationNumber || '',
      'VAT Number': c.vatNumber || '',
      'Industry': c.industry,
      'Website': c.website || '',
      'Status': c.status,
      'Category': c.category,
      'Priority': c.priority,
      'Credit Limit': c.creditLimit,
      'Payment Terms': c.paymentTerms,
      'Credit Rating': c.creditRating,
      'Current Balance': c.currentBalance,
      'Total Projects': c.totalProjects,
      'Active Projects': c.activeProjects,
      'Completed Projects': c.completedProjects,
      'Total Project Value': c.totalProjectValue,
      'Average Project Value': c.averageProjectValue,
      'Preferred Contact Method': c.preferredContactMethod,
      'Communication Language': c.communicationLanguage,
      'Timezone': c.timezone,
      'Service Types': c.serviceTypes.join(', '),
      'Tags': c.tags.join(', '),
      'Notes': c.notes || ''
    }));
    
    // Create workbook
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Clients');
    
    // Auto-size columns
    const colWidths = [
      { wch: 30 }, // Company Name
      { wch: 25 }, // Contact Person
      { wch: 30 }, // Email
      { wch: 15 }, // Phone
      { wch: 30 }, // Alternative Email
      { wch: 15 }, // Alternative Phone
      { wch: 40 }, // Address
      { wch: 15 }, // City
      { wch: 12 }, // Province
      { wch: 10 }, // Postal Code
      { wch: 15 }, // Country
      { wch: 20 }, // Registration Number
      { wch: 15 }, // VAT Number
      { wch: 20 }, // Industry
      { wch: 30 }, // Website
      { wch: 10 }, // Status
      { wch: 12 }, // Category
      { wch: 10 }, // Priority
      { wch: 12 }, // Credit Limit
      { wch: 12 }, // Payment Terms
      { wch: 12 }, // Credit Rating
      { wch: 12 }, // Current Balance
      { wch: 10 }, // Total Projects
      { wch: 10 }, // Active Projects
      { wch: 10 }, // Completed Projects
      { wch: 15 }, // Total Project Value
      { wch: 15 }, // Average Project Value
      { wch: 15 }, // Preferred Contact Method
      { wch: 15 }, // Communication Language
      { wch: 20 }, // Timezone
      { wch: 30 }, // Service Types
      { wch: 30 }, // Tags
      { wch: 40 }, // Notes
    ];
    ws['!cols'] = colWidths;
    
    // Generate Excel file
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([excelBuffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
  },

  /**
   * Download template Excel file for import
   */
  async getImportTemplate(): Promise<Blob> {
    const XLSX = await import('xlsx');
    const templateData = [
      {
        'name': 'ABC Corporation',
        'contactPerson': 'John Smith',
        'email': 'john.smith@abccorp.com',
        'phone': '0111234567',
        'alternativeEmail': 'info@abccorp.com',
        'alternativePhone': '0119876543',
        'address': '123 Business Street, Sandton',
        'city': 'Johannesburg',
        'province': 'Gauteng',
        'postalCode': '2196',
        'country': 'South Africa',
        'registrationNumber': '2023/123456/07',
        'vatNumber': 'VAT123456789',
        'industry': 'Technology',
        'website': 'www.abccorp.com',
        'status': 'active',
        'category': 'enterprise',
        'priority': 'high',
        'creditLimit': '500000',
        'paymentTerms': 'net_30',
        'creditRating': 'good',
        'preferredContactMethod': 'email',
        'communicationLanguage': 'English',
        'timezone': 'Africa/Johannesburg',
        'serviceTypes': 'ftth,enterprise,maintenance',
        'tags': 'premium,long-term',
        'notes': 'Key client with multiple locations'
      }
    ];
    
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Client Import Template');
    
    // Add instructions sheet
    const instructions = this.getInstructionsData();
    
    const wsInstructions = XLSX.utils.json_to_sheet(instructions);
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');
    
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([excelBuffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
  },

  getInstructionsData() {
    return [
      { 'Field': 'name', 'Required': 'Yes', 'Description': 'Company or organization name' },
      { 'Field': 'contactPerson', 'Required': 'Yes', 'Description': 'Primary contact person\'s full name' },
      { 'Field': 'email', 'Required': 'Yes', 'Description': 'Primary email address' },
      { 'Field': 'phone', 'Required': 'Yes', 'Description': 'Primary phone number' },
      { 'Field': 'alternativeEmail', 'Required': 'No', 'Description': 'Alternative email address' },
      { 'Field': 'alternativePhone', 'Required': 'No', 'Description': 'Alternative phone number' },
      { 'Field': 'address', 'Required': 'No', 'Description': 'Street address' },
      { 'Field': 'city', 'Required': 'No', 'Description': 'City (defaults to Johannesburg)' },
      { 'Field': 'province', 'Required': 'No', 'Description': 'Province (defaults to Gauteng)' },
      { 'Field': 'postalCode', 'Required': 'No', 'Description': 'Postal code' },
      { 'Field': 'country', 'Required': 'No', 'Description': 'Country (defaults to South Africa)' },
      { 'Field': 'registrationNumber', 'Required': 'No', 'Description': 'Company registration number' },
      { 'Field': 'vatNumber', 'Required': 'No', 'Description': 'VAT registration number' },
      { 'Field': 'industry', 'Required': 'No', 'Description': 'Industry or business sector' },
      { 'Field': 'website', 'Required': 'No', 'Description': 'Company website URL' },
      { 'Field': 'status', 'Required': 'No', 'Description': 'Status: active, inactive, suspended, prospect, former' },
      { 'Field': 'category', 'Required': 'No', 'Description': 'Category: enterprise, sme, residential, government, non_profit, education, healthcare' },
      { 'Field': 'priority', 'Required': 'No', 'Description': 'Priority: low, medium, high, critical, vip' },
      { 'Field': 'creditLimit', 'Required': 'No', 'Description': 'Credit limit in ZAR (defaults to 100000)' },
      { 'Field': 'paymentTerms', 'Required': 'No', 'Description': 'Payment terms: immediate, net_7, net_14, net_30, net_60, net_90, prepaid' },
      { 'Field': 'creditRating', 'Required': 'No', 'Description': 'Credit rating: excellent, good, fair, poor, unrated' },
      { 'Field': 'preferredContactMethod', 'Required': 'No', 'Description': 'Contact method: email, phone, sms, whatsapp, in_person, video_call' },
      { 'Field': 'communicationLanguage', 'Required': 'No', 'Description': 'Preferred language (defaults to English)' },
      { 'Field': 'timezone', 'Required': 'No', 'Description': 'Timezone (defaults to Africa/Johannesburg)' },
      { 'Field': 'serviceTypes', 'Required': 'No', 'Description': 'Comma-separated: ftth, fttb, fttc, backbone, enterprise, wireless, maintenance, consulting' },
      { 'Field': 'tags', 'Required': 'No', 'Description': 'Comma-separated tags for categorization' },
      { 'Field': 'notes', 'Required': 'No', 'Description': 'Additional notes or comments' }
    ];
  }
};