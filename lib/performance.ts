// Performance monitoring utilities for Next.js 15
export function reportWebVitals(metric: any) {
  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.log(metric)
  }
  
  // Send to analytics service
  const url = process.env.NEXT_PUBLIC_ANALYTICS_URL
  if (url) {
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      delta: metric.delta,
      id: metric.id,
      attribution: metric.attribution,
    })
    
    // Use sendBeacon for reliability
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, body)
    } else {
      fetch(url, {
        body,
        method: 'POST',
        keepalive: true,
      })
    }
  }
  
  // Vercel Analytics integration
  if (typeof window !== 'undefined' && (window as unknown as { vercel?: { webVitals: (m: unknown) => void } }).vercel) {
    (window as unknown as { vercel: { webVitals: (m: unknown) => void } }).vercel.webVitals(metric)
  }
}

// Monitor Core Web Vitals thresholds
export const webVitalsThresholds = {
  LCP: 2500, // Largest Contentful Paint
  FID: 100,  // First Input Delay
  CLS: 0.1,  // Cumulative Layout Shift
  INP: 200,  // Interaction to Next Paint
  TTFB: 800, // Time to First Byte
  FCP: 1800, // First Contentful Paint
}

// Helper to check if metric passes threshold
export function isGoodMetric(name: string, value: number): boolean {
  const threshold = webVitalsThresholds[name as keyof typeof webVitalsThresholds]
  if (!threshold) return true
  
  // CLS is measured differently (lower is better, no ms unit)
  if (name === 'CLS') {
    return value <= threshold
  }
  
  return value <= threshold
}