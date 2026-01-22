/**
 * Root Layout for App Router
 */

import type { Metadata } from 'next';
import '../styles/globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'FibreFlow',
  description: 'Fiber network project management system',
};

/**
 * Inline script to apply dark mode BEFORE hydration
 * This prevents Flash of Unstyled Content (FOUC)
 * Must run synchronously before any content paints
 */
const themeInitScript = `
(function() {
  var DARK_BG = '#1a1d23';
  var LIGHT_BG = '#ffffff';
  try {
    var stored = localStorage.getItem('fibreflow-theme-preference');
    var theme = 'dark'; // Default theme
    if (stored) {
      var pref = JSON.parse(stored);
      if (pref.theme === 'light' || pref.theme === 'dark') {
        theme = pref.theme;
      }
    }
    var isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    document.body.style.backgroundColor = isDark ? DARK_BG : LIGHT_BG;
  } catch (e) {
    // Default to dark on error
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
    document.body.style.backgroundColor = DARK_BG;
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <head>
        {/* Support dark mode for native form controls (select dropdowns, date pickers) */}
        <meta name="color-scheme" content="light dark" />
      </head>
      <body
        className="min-h-screen bg-background font-sans antialiased"
        style={{ backgroundColor: '#1a1d23' }}
      >
        {/* Blocking script to apply theme before React hydration */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Providers>
          <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
