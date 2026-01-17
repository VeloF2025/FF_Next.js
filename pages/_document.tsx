import { Html, Head, Main, NextScript } from 'next/document'

// Inline script to prevent FOUC (Flash of Unstyled Content) on theme switch
// This runs before React hydration to set the theme class and background immediately
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

export default function Document() {
  // Build version for cache busting - changes on every deployment
  const buildVersion = process.env.NEXT_PUBLIC_BUILD_VERSION || Date.now().toString();

  return (
    <Html lang="en" className="dark">
      <Head>
        {/* Build version for cache busting */}
        <meta name="build-version" content={buildVersion} />

        {/* Support dark mode for native form controls (select dropdowns, date pickers) */}
        <meta name="color-scheme" content="light dark" />

        {/* Meta tags for SEO */}
        <meta name="description" content="FibreFlow - Fiber Network Project Management" />
        {/* Note: viewport meta is set in _app.tsx via next/head */}
        <link rel="icon" href="/icon.png" />
        <link rel="apple-touch-icon" href="/icon.png" />

        {/* Preconnect to external domains for performance */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />

        {/* Any additional head tags can be added here */}
      </Head>
      <body className="min-h-screen bg-background font-sans antialiased" style={{ backgroundColor: '#1a1d23' }}>
        {/* Blocking script to apply theme before React hydration */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}