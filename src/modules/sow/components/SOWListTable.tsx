import { Eye, Edit, Trash2, Download } from 'lucide-react';
import { SOWListItem } from '../types/sow.types';
import { SOWStatusBadge } from './SOWStatusBadge';

interface SOWListTableProps {
  documents: SOWListItem[];
  onView: (doc: SOWListItem) => void;
  onEdit: (doc: SOWListItem) => void;
  onDelete: (doc: SOWListItem) => void;
  onDownload: (doc: SOWListItem) => void;
}

export function SOWListTable({ 
  documents, 
  onView, 
  onEdit, 
  onDelete, 
  onDownload 
}: SOWListTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
              Document Name
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
              Project
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
              Type
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
              Uploaded By
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
              Upload Date
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wide">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {documents.map((doc) => (
            <tr key={doc.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-gray-900">{doc.name}</div>
                {doc.version > 1 && (
                  <div className="text-sm text-gray-500">Version {doc.version}</div>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-900">{doc.projectName}</div>
                <div className="text-sm text-gray-500">{doc.projectCode}</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                  {doc.type}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <SOWStatusBadge status={doc.status} />
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {doc.uploadedByName}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {new Date(doc.uploadDate).toISOString().split('T')[0]}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => onView(doc)}
                    className="text-indigo-600 hover:text-indigo-900"
                    title="View"
                  >
                    <Eye className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => onDownload(doc)}
                    className="text-green-600 hover:text-green-900"
                    title="Download"
                  >
                    <Download className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => onEdit(doc)}
                    className="text-blue-600 hover:text-blue-900"
                    title="Edit"
                  >
                    <Edit className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => onDelete(doc)}
                    className="text-red-600 hover:text-red-900"
                    title="Delete"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}