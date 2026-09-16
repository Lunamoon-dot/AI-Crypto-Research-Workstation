import { createBrowserRouter, Navigate } from 'react-router-dom';
import { MainLayout } from '@/layouts/MainLayout';
import { AlertsPage } from '@/pages/AlertsPage';
import { CalibrationLabPage } from '@/pages/CalibrationLabPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { OperationsPage } from '@/pages/OperationsPage';
import { PerformanceAnalyticsPage } from '@/pages/PerformanceAnalyticsPage';
import { ScenarioMonitorPage } from '@/pages/ScenarioMonitorPage';
import { ResearchRunFormPage } from '@/pages/ResearchRunFormPage';
import { ResearchHistoryPage } from '@/pages/ResearchHistoryPage';
import { ResearchRunWorkspacePage } from '@/pages/ResearchRunWorkspacePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SignalDetailPage } from '@/pages/SignalDetailPage';
import { SignalsPage } from '@/pages/SignalsPage';
import { ThesisDetailPage } from '@/pages/ThesisDetailPage';
import { ThesisLibraryPage } from '@/pages/ThesisLibraryPage';
import { WorkbenchPage } from '@/pages/WorkbenchPage';
import { WorkspaceConfigurationPage } from '@/pages/WorkspaceConfigurationPage';

export const router = createBrowserRouter([
  {
    element: <MainLayout />,
    children: [
      { index: true, element: <Navigate to="/research/new" replace /> },
      { path: 'workbench', element: <WorkbenchPage /> },
      { path: 'research/new', element: <ResearchRunFormPage /> },
      { path: 'research/history', element: <ResearchHistoryPage /> },
      { path: 'research/workspace', element: <WorkspaceConfigurationPage /> },
      { path: 'performance', element: <PerformanceAnalyticsPage /> },
      { path: 'calibration', element: <CalibrationLabPage /> },
      { path: 'research/runs/:id', element: <ResearchRunWorkspacePage /> },
      { path: 'journal/runs/:id', element: <ResearchRunWorkspacePage journal /> },
      { path: 'theses', element: <ThesisLibraryPage /> },
      { path: 'theses/:id', element: <ThesisDetailPage /> },
      { path: 'signals', element: <SignalsPage /> },
      { path: 'signals/:id', element: <SignalDetailPage /> },
      { path: 'scenarios', element: <ScenarioMonitorPage /> },
      { path: 'alerts', element: <AlertsPage /> },
      { path: 'operations', element: <OperationsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
