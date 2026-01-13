/**
 * Daily Stock Reconciliation Page
 * Stage 4 of the 4-stage Site Stock Tracking System
 *
 * URL: /procurement/field-stock/reconciliation
 *
 * Purpose: End-of-day accountability dashboard showing issued vs installed equipment
 * Access: Warehouse managers, project managers
 *
 * Features:
 * - View daily reconciliation reports
 * - Export reports to Excel
 * - Monitor unaccounted equipment
 * - Track blocked contractors
 */

import React from 'react';
import { AppLayout } from '@/components/layout';
import { DailyReconciliationDashboard } from '@/modules/field-stock/components';
import { Box, Container } from '@mui/material';
import type { GetServerSideProps } from 'next';

interface ReconciliationPageProps {
  defaultDate: string;
}

export default function ReconciliationPage({ defaultDate }: ReconciliationPageProps) {
  return (
    <AppLayout>
      <Container maxWidth="xl">
        <Box sx={{ py: 3 }}>
          <DailyReconciliationDashboard defaultDate={defaultDate} />
        </Box>
      </Container>
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  // Get today's date in YYYY-MM-DD format
  const today = new Date();
  const defaultDate = today.toISOString().split('T')[0];

  return {
    props: {
      defaultDate,
    },
  };
};
