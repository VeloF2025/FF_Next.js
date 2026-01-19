'use client';

import { useEffect, useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { WishlistDashboard } from '@/modules/wishlist/WishlistDashboard';
import { Typography, CircularProgress, Box } from '@mui/material';
import { getAuth } from '@/lib/auth-mock';

export default function WishlistPage() {
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
      <PageContainer title="Loading...">
        <Box display="flex" justifyContent="center" p={4}>
          <CircularProgress />
        </Box>
      </PageContainer>
    );
  }

  if (!authenticated) {
    return (
      <PageContainer title="Access Denied">
        <Typography>You must be logged in to view this page.</Typography>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Feature Wishlist"
      subtitle="Community-driven feature requests and voting"
      breadcrumbs={[
        { label: 'Home', href: '/' },
        { label: 'Communications', href: '/communications' },
        { label: 'Wishlist' }
      ]}
    >
      <WishlistDashboard />
    </PageContainer>
  );
}
