import { useEffect, useState } from 'react';
import {
  applyQueryParamToggle,
  installDemoFetchInterceptor,
  isDemoModeEnabled,
} from '@/lib/demoMode';

/**
 * Demo-mode banner + activator.
 *
 * Mount once near the top of the app tree. It:
 *   - Checks the `?demo=1` / `?demo=0` URL param on every route change,
 *     sets/clears the `ff_demo_mode` cookie, and strips the param.
 *   - Installs a global fetch interceptor that sanitizes project names/codes
 *     in API responses while the cookie is set.
 *   - Renders a small fixed banner when demo mode is active so the presenter
 *     always knows the state.
 */
export function DemoModeBanner() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    installDemoFetchInterceptor();
    applyQueryParamToggle();
    setEnabled(isDemoModeEnabled());

    const sync = () => setEnabled(isDemoModeEnabled());
    window.addEventListener('popstate', sync);
    const interval = window.setInterval(sync, 2000);

    return () => {
      window.removeEventListener('popstate', sync);
      window.clearInterval(interval);
    };
  }, []);

  if (!enabled) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        padding: '4px 12px',
        background: '#fbbf24',
        color: '#1f2937',
        fontSize: 12,
        fontWeight: 600,
        borderBottomLeftRadius: 6,
        borderBottomRightRadius: 6,
        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        pointerEvents: 'none',
      }}
    >
      DEMO MODE — project names sanitized · append ?demo=0 to exit
    </div>
  );
}
