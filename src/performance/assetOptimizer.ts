/**
 * Asset Optimizer - Dynamic Loading System
 * Provides lazy loading for large dependencies and modules
 */

// 🔥 DYNAMIC SERVICE IMPORTS - Reduce initial bundle size

/**
 * Dynamic import for Excel processing
 * Only loads when actually needed for file operations
 */
export const loadExcelProcessor = () => {
  return import('xlsx').then(XLSX => ({
    XLSX: XLSX.default || XLSX,
  }));
};

/**
 * Dynamic import for CSV processing
 * Only loads when CSV parsing is needed
 */
export const loadCSVProcessor = () => {
  return import('papaparse').then(Papa => ({
    Papa: Papa.default || Papa,
  }));
};

/**
 * Dynamic import for chart library
 * Only loads when charts are displayed
 */
export const loadChartLibrary = () => {
  return import('recharts');
};

/**
 * Dynamic import for MUI components
 * Only loads when Material UI components are used
 */
export const loadMaterialUI = () => {
  return Promise.all([
    import('@mui/material'),
    import('@mui/icons-material'),
    import('@emotion/react'),
    import('@emotion/styled'),
  ]).then(([material, icons, emotionReact, emotionStyled]) => ({
    Material: material,
    Icons: icons,
    EmotionReact: emotionReact,
    EmotionStyled: emotionStyled,
  }));
};

/**
 * Dynamic import for animation library
 * Only loads when animations are needed
 */
export const loadAnimationLibrary = () => {
  return import('framer-motion');
};

/**
 * Dynamic import for Firebase services
 * Split by service type to minimize loading
 */
export const loadFirebaseAuth = () => {
  return Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
  ]).then(([app, auth]) => ({
    app: app.default || app,
    auth: auth.default || auth,
  }));
};

export const loadFirebaseFirestore = () => {
  return Promise.all([
    import('firebase/app'),
    import('firebase/firestore'),
  ]).then(([app, firestore]) => ({
    app: app.default || app,
    firestore: firestore.default || firestore,
  }));
};

export const loadFirebaseStorage = () => {
  return Promise.all([
    import('firebase/app'),
    import('firebase/storage'),
  ]).then(([app, storage]) => ({
    app: app.default || app,
    storage: storage.default || storage,
  }));
};

/**
 * Dynamic import for database services
 * Only loads when database operations are needed
 */
export const loadDatabaseServices = () => {
  return Promise.all([
    import('drizzle-orm'),
    import('@neondatabase/serverless'),
  ]).then(([drizzle, neon]) => ({
    drizzle: drizzle.default || drizzle,
    neon: neon.default || neon,
  }));
};

// 🔥 MODULE LAZY LOADING

/**
 * Dynamic import for procurement services
 * Large service module - load only when needed
 */
export const loadProcurementServices = () => {
  return import('@/services/procurement');
};

/**
 * Dynamic import for contractor services
 * Large service module - load only when needed
 */
export const loadContractorServices = () => {
  return import('@/services/contractor');
};

/**
 * Dynamic import for analytics services
 * Heavy computation module - load when analytics are accessed
 */
export const loadAnalyticsServices = () => {
  return import('@/services/analytics');
};

/**
 * Dynamic import for supplier statistics
 * Complex calculation module - load when needed
 */
export const loadSupplierStatistics = () => {
  return import('@/services/suppliers/statistics');
};

// 🔥 PRELOAD STRATEGIES

/**
 * Preload critical chunks during idle time
 * Improves perceived performance for likely user actions
 */
export const preloadCriticalChunks = () => {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      // Preload most likely to be used modules
      const preloadPromises = [
        import('@/services/neonService'), // Core service
        import('@/services/auth'), // Authentication
        import('@/contexts/AuthContext'), // Critical context
      ];

      Promise.all(preloadPromises).catch(() => {
        // Silently handle preload failures
      });
    });
  }
};

/**
 * Preload modules based on current route
 * Anticipates user navigation patterns
 */
export const preloadRouteModules = (currentRoute: string) => {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      const preloadMap: Record<string, () => Promise<unknown>[]> = {
        '/app/procurement': () => [
          import('@/modules/procurement'),
          loadProcurementServices(),
        ],
        '/app/contractors': () => [
          import('@/modules/contractors'),
          loadContractorServices(),
        ],
        '/app/analytics': () => [
          import('@/modules/analytics'),
          loadAnalyticsServices(),
          loadChartLibrary(),
        ],
        '/app/projects': () => [
          import('@/modules/projects'),
          import('@/services/projects'),
        ],
        '/app/staff': () => [
          import('@/services/staffService'),
        ],
        '/app/clients': () => [
          import('@/modules/clients'),
          import('@/services/client'),
        ],
      };

      const preloadFn = preloadMap[currentRoute];
      if (preloadFn) {
        Promise.all(preloadFn()).catch(() => {
          // Silently handle preload failures
        });
      }
    });
  }
};

// 🔥 PERFORMANCE MONITORING

/**
 * Monitor chunk loading performance
 * Tracks loading times for optimization
 */
export const monitorChunkLoading = () => {
  const chunkLoadTimes = new Map<string, number>();

  const originalImport = window.__webpack_require__ || ((id: string) => import(id));
  
  if (window.__webpack_require__) {
    window.__webpack_require__ = (id: string) => {
      const startTime = performance.now();
      
      return originalImport(id).then((module: unknown) => {
        const loadTime = performance.now() - startTime;
        chunkLoadTimes.set(id, loadTime);
        
        // Report slow chunks (>1000ms)
        if (loadTime > 1000) {
          import('@/lib/logger').then(({ log }) => {
            log.warn('Slow chunk loading detected', { chunkId: id, loadTime: loadTime.toFixed(2) + 'ms' }, 'assetOptimizer');
          }).catch(() => {
            // Fallback: silent fail to maintain zero-tolerance policy
          });
        }
        
        return module;
      });
    };
  }

  return {
    getChunkLoadTimes: () => chunkLoadTimes,
    getAverageLoadTime: () => {
      const times = Array.from(chunkLoadTimes.values());
      return times.reduce((a, b) => a + b, 0) / times.length;
    },
  };
};

// 🔥 BUNDLE ANALYZER INTEGRATION

/**
 * Runtime bundle analysis
 * Helps identify optimization opportunities
 */
export const analyzeBundleComposition = () => {
  const modules = new Map<string, number>();
  
  // Collect module information if available
  if (window.__webpack_require__ && window.__webpack_require__.cache) {
    Object.keys(window.__webpack_require__.cache).forEach((key) => {
      const module = window.__webpack_require__.cache[key];
      if (module && module.exports) {
        const size = JSON.stringify(module.exports).length;
        modules.set(key, size);
      }
    });
  }

  return {
    modules,
    totalSize: Array.from(modules.values()).reduce((a, b) => a + b, 0),
    largestModules: Array.from(modules.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10),
  };
};

// Initialize performance monitoring
if (typeof window !== 'undefined') {
  preloadCriticalChunks();
  monitorChunkLoading();
}