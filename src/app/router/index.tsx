import { Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { StaffDebug } from '@/components/dev/StaffDebug';
import { ProjectsDebug } from '@/components/dev/ProjectsDebug';
import { ClientsDebug } from '@/components/dev/ClientsDebug';
// import { StaffDataFix } from '@/pages/StaffDataFix';
import { LoginPage } from '@/components/auth/LoginPage';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Dashboard, VFThemeTest } from './lazyImports';
import { ProtectedRoute, Loading, NotFound } from './components';
import { projectRoutes } from './routes/projectRoutes';
import { moduleRoutes } from './routes/moduleRoutes';
import { procurementRoutes } from './routes/procurementRoutes';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/app/dashboard" replace />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/test/vf-theme',
    element: (
      <Suspense fallback={<Loading />}>
        <VFThemeTest />
      </Suspense>
    ),
  },
  {
    path: '/app',
    element: <ProtectedRoute />,
    children: [
      {
        element: (
          <ErrorBoundary>
            <AppLayout />
          </ErrorBoundary>
        ),
        children: [
          {
            path: 'dashboard',
            element: (
              <Suspense fallback={<Loading />}>
                <Dashboard />
              </Suspense>
            ),
          },
          // Project routes
          ...projectRoutes,
          // Module routes
          ...moduleRoutes,
          // Procurement routes (nested)
          procurementRoutes,
          // Debug routes
          {
            path: 'staff-debug',
            element: <StaffDebug />,
          },
          {
            path: 'projects-debug',
            element: <ProjectsDebug />,
          },
          {
            path: 'clients-debug',
            element: <ClientsDebug />,
          },
          {
            path: 'staff-fix',
            element: <div>Staff Data Fix - Removed</div>,
          },
          // Default redirect
          {
            path: '',
            element: <Navigate to="/app/dashboard" replace />,
          },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <NotFound />,
  },
]);
export function AppRouter() {
  return <RouterProvider router={router} />;
}