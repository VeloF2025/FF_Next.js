import React from 'react';

function App() {
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-blue-600 mb-4">FibreFlow React</h1>
        <p className="text-gray-600 dark:text-gray-400">Application is loading...</p>
        <div className="mt-8">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      </div>
    </div>
  );
}

export default App;