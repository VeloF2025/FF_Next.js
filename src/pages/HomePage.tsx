export function HomePage(): JSX.Element {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-4">
          Welcome to FibreFlow React
        </h1>
        <p className="text-lg text-muted-foreground">
          This is the React migration of the FibreFlow application. 
          The migration is in progress.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-card p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-3 text-blue-600">Migration Status</h2>
          <p className="text-muted-foreground">
            Project structure created. Ready for component migration from Angular version.
          </p>
          <div className="mt-4">
            <div className="bg-secondary rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full w-1/4"></div>
            </div>
            <p className="text-sm text-muted-foreground mt-1">25% Complete</p>
          </div>
        </div>

        <div className="bg-card p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-3 text-green-600">Next Steps</h2>
          <ul className="text-muted-foreground space-y-2">
            <li>• Analyze Angular components</li>
            <li>• Migrate core components</li>
            <li>• Set up state management</li>
            <li>• Migrate API services</li>
          </ul>
        </div>

        <div className="bg-card p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-3 text-purple-600">Tech Stack</h2>
          <ul className="text-muted-foreground space-y-2">
            <li>• React 18 + TypeScript</li>
            <li>• Vite build tool</li>
            <li>• React Query for data</li>
            <li>• React Router for routing</li>
            <li>• Tailwind CSS for styling</li>
          </ul>
        </div>
      </div>

      <div className="mt-8 bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-yellow-800 mb-2">
          Migration TODO List
        </h3>
        <p className="text-yellow-700 mb-4">
          The following items need to be migrated from the Angular version:
        </p>
        <ul className="text-yellow-700 space-y-1">
          <li>• Authentication system</li>
          <li>• Dashboard components</li>
          <li>• Data visualization charts</li>
          <li>• Form components</li>
          <li>• API integration layer</li>
          <li>• User management</li>
          <li>• Settings and configuration</li>
        </ul>
      </div>
    </div>
  )
}