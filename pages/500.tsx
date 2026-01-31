export default function Custom500() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      background: '#0f1117',
      color: '#e5e7eb'
    }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '0.5rem' }}>500</h1>
      <p style={{ color: '#9ca3af' }}>Internal Server Error</p>
      <a
        href="/"
        style={{
          marginTop: '1.5rem',
          color: '#3b82f6',
          textDecoration: 'none'
        }}
      >
        Return Home
      </a>
    </div>
  );
}
