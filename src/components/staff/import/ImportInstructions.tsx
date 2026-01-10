/**
 * Import Instructions Component for Staff Import
 */

export function ImportInstructions() {
  return (
    <div className="mt-6 p-4 bg-blue-500/20 rounded-lg">
      <h4 className="font-medium text-blue-400 mb-2">Import Instructions</h4>
      <ul className="text-sm text-blue-300 space-y-1">
        <li>• Download the template to see the required format</li>
        <li>• Required fields: Name, Email, and Phone</li>
        <li>• Department options: management, engineering, installation, maintenance, sales, operations</li>
        <li>• Level options: intern, junior, intermediate, senior, lead, manager</li>
        <li>• Status options: active, inactive, on_leave, suspended, terminated</li>
        <li>• Skills should be comma-separated (e.g., fiber_splicing, otdr_testing)</li>
        <li>• Dates should be in DD/MM/YYYY format</li>
      </ul>
    </div>
  );
}