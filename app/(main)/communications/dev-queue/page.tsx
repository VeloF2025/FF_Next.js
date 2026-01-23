'use client';

import { useEffect, useState } from 'react';
import { DevQueueDashboard } from '@/modules/dev-queue/DevQueueDashboard';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Typography, CircularProgress, Box } from '@mui/material';
import { getAuth } from '@/lib/auth-mock';

export default function DevQueuePage() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    // Check authentication
    const auth = getAuth({});
    if (auth?.userId) {
      setAuthenticated(true);
      setUser(auth.user);
    }
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="p-6">
        <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" minHeight="400px">
          <Typography variant="h5" gutterBottom>Access Denied</Typography>
          <Typography color="text.secondary">You must be logged in to view this page.</Typography>
        </Box>
      </div>
    );
  }

  return (
    <div className="p-6">
      <ErrorBoundary>
        <DevQueueDashboard />
      </ErrorBoundary>
    </div>
  );
}
