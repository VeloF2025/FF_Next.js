'use client';

import React from 'react';
import { Download, Smartphone, Camera, FileText, Shield, CheckCircle } from 'lucide-react';

export default function DownloadsPage() {
  const apps = [
    {
      id: 'image-eval',
      name: 'VeloQA Image Eval',
      version: '1.2.0',
      size: '8 MB',
      description: 'Android app for field image quality evaluation and DR submission reviews',
      features: [
        'Real-time image quality assessment',
        'DR submission photo validation',
        'Offline capability for field work',
        'Instant feedback on image issues',
      ],
      requirements: 'Android 6.0 or higher',
      downloadUrl: '/veloqa-imageeval-v1.2.0.apk',
      icon: Camera,
      category: 'Field Operations',
      bgGradient: 'from-blue-500 to-purple-600',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <Download className="h-8 w-8 text-blue-600" />
          FibreFlow Downloads
        </h1>
        <p className="text-gray-600 mt-2">
          Download mobile apps and tools for field operations
        </p>
      </div>

      {/* Installation Notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-8">
        <div className="flex">
          <Shield className="h-5 w-5 text-amber-600 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold mb-1">Android Installation Instructions:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Download the APK file to your Android device</li>
              <li>Open your device Settings → Security</li>
              <li>Enable "Install from Unknown Sources" or "Install unknown apps"</li>
              <li>Open the downloaded APK file and tap "Install"</li>
              <li>Once installed, you can disable "Unknown Sources" for security</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Apps Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
        {apps.map((app) => {
          const IconComponent = app.icon;
          return (
            <div
              key={app.id}
              className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200 hover:shadow-xl transition-shadow"
            >
              {/* App Header with Gradient */}
              <div className={`bg-gradient-to-r ${app.bgGradient} p-6 text-white`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="bg-white/20 backdrop-blur-sm rounded-lg p-3">
                      <IconComponent className="h-8 w-8 text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">{app.name}</h2>
                      <p className="text-white/90 text-sm mt-1">
                        Version {app.version} • {app.size}
                      </p>
                      <span className="inline-block mt-2 px-2 py-1 bg-white/20 backdrop-blur-sm rounded text-xs font-medium">
                        {app.category}
                      </span>
                    </div>
                  </div>
                  <Smartphone className="h-6 w-6 text-white/50" />
                </div>
              </div>

              {/* App Details */}
              <div className="p-6">
                <p className="text-gray-700 mb-4">{app.description}</p>

                {/* Features */}
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Features:</h3>
                  <ul className="space-y-1">
                    {app.features.map((feature, index) => (
                      <li key={index} className="flex items-start text-sm text-gray-600">
                        <CheckCircle className="h-4 w-4 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Requirements */}
                <div className="mb-4 py-3 px-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Requirements:</span> {app.requirements}
                  </p>
                </div>

                {/* Download Button */}
                <a
                  href={app.downloadUrl}
                  download={app.downloadUrl.split('/').pop()}
                  className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Download className="h-5 w-5" />
                  Download APK
                </a>
              </div>
            </div>
          );
        })}

        {/* Placeholder for Future Apps */}
        <div className="bg-gray-50 rounded-xl border-2 border-dashed border-gray-300 p-8 flex flex-col items-center justify-center text-center">
          <FileText className="h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">More Apps Coming Soon</h3>
          <p className="text-sm text-gray-500 max-w-xs">
            Additional field operation tools and mobile apps will be available here as they are released.
          </p>
        </div>
      </div>

      {/* Support Section */}
      <div className="mt-12 bg-blue-50 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Need Help?</h3>
        <p className="text-gray-700 mb-4">
          If you encounter any issues downloading or installing the apps, please contact IT support.
        </p>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">Email:</span>
            <a href="mailto:support@velocityfibre.com" className="text-blue-600 hover:underline">
              support@velocityfibre.com
            </a>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">WhatsApp:</span>
            <span className="text-gray-700">IT Support Group</span>
          </div>
        </div>
      </div>
    </div>
  );
}