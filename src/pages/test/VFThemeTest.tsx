import VFLogo from '@/components/ui/VFLogo';
import { useTheme } from '@/contexts/ThemeContext';
import { themes } from '@/config/themes';

export default function VFThemeTest() {
  const { themeConfig, setTheme } = useTheme();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">VF Theme Test Page</h1>
        
        {/* Theme Selector */}
        <div className="mb-8 p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Theme Selection</h2>
          <div className="flex gap-4">
            {Object.keys(themes).map((themeName) => (
              <button
                key={themeName}
                onClick={() => setTheme(themeName as 'light' | 'dark' | 'vf' | 'fibreflow')}
                className={`px-4 py-2 rounded-lg border-2 transition-all ${
                  themeConfig.name === themeName
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                }`}
              >
                {themeName.toUpperCase()} Theme
              </button>
            ))}
          </div>
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
            Current Theme: <strong>{themeConfig.name}</strong>
          </p>
        </div>

        {/* VF Logo Component Test */}
        <div className="mb-8 p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Logo Component (All Sizes)</h2>
          
          <div className="space-y-4">
            <div className="flex items-center gap-8">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Small:</p>
                <div className="p-4 bg-white dark:bg-gray-800 border rounded">
                  <VFLogo size="small" />
                </div>
              </div>
              
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Medium:</p>
                <div className="p-4 bg-white dark:bg-gray-800 border rounded">
                  <VFLogo size="medium" />
                </div>
              </div>
              
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Large:</p>
                <div className="p-4 bg-white dark:bg-gray-800 border rounded">
                  <VFLogo size="large" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Preview */}
        <div className="mb-8 p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Sidebar Preview (VF Theme)</h2>
          
          {themeConfig.name === 'vf' ? (
            <div 
              className="h-96 w-64 rounded-lg shadow-inner overflow-hidden"
              style={{
                backgroundColor: themeConfig.colors.surface.sidebar || '#1e293b',
                color: themeConfig.colors.text.sidebarPrimary || '#f8fafc'
              }}
            >
              {/* Logo Section */}
              <div className="py-6 px-4 border-b border-slate-700 flex justify-center">
                <VFLogo size="large" />
              </div>
              
              {/* Mock Navigation Items */}
              <div className="p-4 space-y-2">
                <div className="px-3 py-2 rounded hover:bg-slate-700 cursor-pointer">Dashboard</div>
                <div className="px-3 py-2 rounded hover:bg-slate-700 cursor-pointer">Projects</div>
                <div className="px-3 py-2 rounded hover:bg-slate-700 cursor-pointer">SOW Data Management</div>
                <div className="px-3 py-2 rounded hover:bg-slate-700 cursor-pointer">Task Management</div>
                <div className="px-3 py-2 rounded hover:bg-slate-700 cursor-pointer">Reports</div>
              </div>
            </div>
          ) : (
            <p className="text-gray-600 dark:text-gray-400">Switch to VF theme to see the sidebar preview</p>
          )}
        </div>

        {/* Color Palette */}
        <div className="mb-8 p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">VF Theme Colors</h2>
          
          {themeConfig.name === 'vf' && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div 
                  className="h-20 rounded-lg mb-2"
                  style={{ backgroundColor: typeof themeConfig.colors.primary === 'string' ? themeConfig.colors.primary : themeConfig.colors.primary[500] }}
                />
                <p className="text-sm">Primary</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{typeof themeConfig.colors.primary === 'string' ? themeConfig.colors.primary : themeConfig.colors.primary[500]}</p>
              </div>
              
              <div>
                <div 
                  className="h-20 rounded-lg mb-2"
                  style={{ backgroundColor: themeConfig.colors.surface.sidebar || '#1e293b' }}
                />
                <p className="text-sm">Sidebar BG</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{themeConfig.colors.surface.sidebar || '#1e293b'}</p>
              </div>
              
              <div>
                <div 
                  className="h-20 rounded-lg mb-2 border"
                  style={{ 
                    backgroundColor: themeConfig.colors.text.sidebarPrimary || '#f8fafc',
                  }}
                />
                <p className="text-sm">Sidebar Text</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{themeConfig.colors.text.sidebarPrimary || '#f8fafc'}</p>
              </div>
              
              <div>
                <div 
                  className="h-20 rounded-lg mb-2 bg-gradient-to-br from-purple-600 via-pink-500 to-orange-500"
                />
                <p className="text-sm">VF Gradient</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Purple → Pink → Orange</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}