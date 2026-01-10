'use client';

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout';

interface CsvRow {
  date: string;
  dropNumber: string;
  time: string;
}

interface DbDrop {
  id: string;
  dropNumber: string;
  date: string;
  time: string;
  project: string;
  completed: boolean;
  incomplete: boolean;
}

interface ValidationResult {
  inCsvAndDb: CsvRow[];
  inCsvNotInDb: CsvRow[];
  inDbNotInCsv: DbDrop[];
  csvTotal: number;
  dbTotal: number;
}

export function DrValidationClient() {
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string>('');

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/wa-monitor-daily-drops');
      const data = await response.json();

      if (data.success && data.data.drops) {
        const projectList = data.data.drops.map((d: any) => d.project);
        setProjects([...new Set(projectList)].sort());

        // Auto-select "Lawley" if available
        if (projectList.includes('Lawley')) {
          setSelectedProject('Lawley');
        }
      }
    } catch (err) {
      console.error('Error fetching projects:', err);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Validate file type
      const fileType = selectedFile.name.split('.').pop()?.toLowerCase();
      if (fileType !== 'csv' && fileType !== 'xlsx') {
        setError('Please upload a CSV or Excel file');
        return;
      }
      setFile(selectedFile);
      setError('');

      // Auto-detect date from file and update date picker
      await extractAndSetDateFromFile(selectedFile);
    }
  };

  const extractAndSetDateFromFile = async (file: File) => {
    try {
      // Send file to server for date extraction
      const formData = new FormData();
      formData.append('file', file);
      formData.append('project', selectedProject || 'Lawley'); // Use selected or default
      formData.append('date', '2000-01-01'); // Dummy date for extraction

      const response = await fetch('/api/wa-monitor-dr-validation', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (data.success && data.data.inCsvNotInDb && data.data.inCsvNotInDb.length > 0) {
        // Extract dates from CSV data
        const dates = data.data.inCsvNotInDb.map((row: CsvRow) => row.date);
        const uniqueDates = [...new Set(dates)];

        if (uniqueDates.length === 1) {
          // Single date found - auto-set it
          setSelectedDate(uniqueDates[0]);
          console.log('📅 Auto-detected date from file:', uniqueDates[0]);
        } else if (uniqueDates.length > 1) {
          // Multiple dates found - use the most common one
          const dateCounts = dates.reduce((acc: any, date: string) => {
            acc[date] = (acc[date] || 0) + 1;
            return acc;
          }, {});
          const mostCommonDate = Object.keys(dateCounts).reduce((a, b) =>
            dateCounts[a] > dateCounts[b] ? a : b
          );
          setSelectedDate(mostCommonDate);
          setError(
            `⚠️ File contains multiple dates. Auto-selected most common: ${mostCommonDate}`
          );
        }
      }
    } catch (err) {
      console.error('Failed to extract date from file:', err);
      // Don't show error to user - just keep default date
    }
  };

  const handleValidate = async () => {
    if (!file) {
      setError('Please select a file');
      return;
    }

    if (!selectedProject) {
      setError('Please select a project');
      return;
    }

    setLoading(true);
    setError('');
    setResults(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('project', selectedProject);
      formData.append('date', selectedDate);

      const response = await fetch('/api/wa-monitor-dr-validation', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Validation failed');
      }

      // Check for date mismatch after validation
      if (data.data.csvTotal > 0 && data.data.inCsvAndDb.length === 0) {
        // No matches but CSV has data - likely date mismatch
        const csvDates = [
          ...data.data.inCsvNotInDb.map((r: CsvRow) => r.date),
          ...data.data.inCsvAndDb.map((r: CsvRow) => r.date),
        ];
        const uniqueCsvDates = [...new Set(csvDates)];

        if (uniqueCsvDates.length > 0 && !uniqueCsvDates.includes(selectedDate)) {
          setError(
            `⚠️ DATE MISMATCH! Your file contains data for ${uniqueCsvDates.join(', ')} but you selected ${selectedDate}. This is why there are 0 matches. The date picker has been updated to match your file.`
          );
          setSelectedDate(uniqueCsvDates[0]); // Auto-correct
        }
      }

      setResults(data.data);
    } catch (err: any) {
      setError(err.message || 'Failed to validate CSV');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMissing = async () => {
    if (!results || results.inCsvNotInDb.length === 0) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/wa-monitor-dr-validation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drops: results.inCsvNotInDb,
          project: selectedProject,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to add drops');
      }

      alert(`✅ ${data.data.inserted} drop(s) added successfully!`);

      // Re-validate to refresh results
      handleValidate();
    } catch (err: any) {
      setError(err.message || 'Failed to add drops');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, dropNumber: string) => {
    if (!confirm(`Are you sure you want to delete ${dropNumber}?`)) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `/api/wa-monitor-dr-validation?id=${id}`,
        {
          method: 'DELETE',
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to delete drop');
      }

      alert(`✅ ${dropNumber} deleted successfully!`);

      // Re-validate to refresh results
      handleValidate();
    } catch (err: any) {
      setError(err.message || 'Failed to delete drop');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">
              DR Validation Tool
            </h1>
            <p className="text-gray-600 mt-2">
              Upload a CSV/Excel file to validate drop numbers against the WA
              Monitor database
            </p>
          </div>

          {/* Upload Form */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              {/* Project Selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Project
                </label>
                <select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select Project</option>
                  {projects.map((project) => (
                    <option key={project} value={project}>
                      {project}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date Picker */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
                {file && (
                  <p className="text-xs text-green-600 mt-1">
                    ✓ Auto-detected from file
                  </p>
                )}
              </div>

              {/* File Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  CSV/Excel File
                </label>
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={handleFileChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* File Info */}
            {file && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm">
                <strong>Selected file:</strong> {file.name} (
                {(file.size / 1024).toFixed(2)} KB)
              </div>
            )}

            {/* Validate Button */}
            <button
              onClick={handleValidate}
              disabled={loading || !file || !selectedProject}
              className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
            >
              {loading ? 'Validating...' : 'Validate DR Numbers'}
            </button>
          </div>

          {/* Results */}
          {results && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="text-green-700 text-sm font-medium">
                    ✅ Matches (In Both)
                  </div>
                  <div className="text-3xl font-bold text-green-900 mt-2">
                    {results.inCsvAndDb.length}
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="text-yellow-700 text-sm font-medium">
                    ⚠️ Missing from DB
                  </div>
                  <div className="text-3xl font-bold text-yellow-900 mt-2">
                    {results.inCsvNotInDb.length}
                  </div>
                </div>

                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="text-red-700 text-sm font-medium">
                    ❌ Extra in DB
                  </div>
                  <div className="text-3xl font-bold text-red-900 mt-2">
                    {results.inDbNotInCsv.length}
                  </div>
                </div>
              </div>

              {/* Matches Section */}
              {results.inCsvAndDb.length > 0 && (
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-xl font-bold text-green-700 mb-4">
                    ✅ Matches ({results.inCsvAndDb.length})
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Date
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            DR Number
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Time
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {results.inCsvAndDb.map((row, idx) => (
                          <tr key={idx}>
                            <td className="px-4 py-2 text-sm">{row.date}</td>
                            <td className="px-4 py-2 text-sm font-mono">
                              {row.dropNumber}
                            </td>
                            <td className="px-4 py-2 text-sm">{row.time}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Missing from DB Section */}
              {results.inCsvNotInDb.length > 0 && (
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-yellow-700">
                      ⚠️ Missing from Database ({results.inCsvNotInDb.length})
                    </h2>
                    <button
                      onClick={handleAddMissing}
                      disabled={loading}
                      className="bg-yellow-600 text-white px-4 py-2 rounded-md hover:bg-yellow-700 disabled:bg-gray-400 font-medium"
                    >
                      {loading ? 'Adding...' : 'Add All Missing'}
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Date
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            DR Number
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Time
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {results.inCsvNotInDb.map((row, idx) => (
                          <tr key={idx} className="bg-yellow-50">
                            <td className="px-4 py-2 text-sm">{row.date}</td>
                            <td className="px-4 py-2 text-sm font-mono">
                              {row.dropNumber}
                            </td>
                            <td className="px-4 py-2 text-sm">{row.time}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Extra in DB Section */}
              {results.inDbNotInCsv.length > 0 && (
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-xl font-bold text-red-700 mb-4">
                    ❌ Extra in Database (Not in CSV) (
                    {results.inDbNotInCsv.length})
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Date
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            DR Number
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Time
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {results.inDbNotInCsv.map((row) => (
                          <tr key={row.id} className="bg-red-50">
                            <td className="px-4 py-2 text-sm">{row.date}</td>
                            <td className="px-4 py-2 text-sm font-mono">
                              {row.dropNumber}
                            </td>
                            <td className="px-4 py-2 text-sm">{row.time}</td>
                            <td className="px-4 py-2">
                              <button
                                onClick={() =>
                                  handleDelete(row.id, row.dropNumber)
                                }
                                disabled={loading}
                                className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700 disabled:bg-gray-400"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Summary Info */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
                <strong>Summary:</strong> CSV has {results.csvTotal} records,
                Database has {results.dbTotal} records for{' '}
                <strong>{selectedProject}</strong> on{' '}
                <strong>{selectedDate}</strong>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
