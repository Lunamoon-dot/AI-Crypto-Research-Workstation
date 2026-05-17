import { createBrowserRouter, Navigate } from 'react-router-dom';
import { MainLayout } from '@/layouts/MainLayout';
import { AlertsPage } from '@/pages/AlertsPage';
import { DailyBriefsPage } from '@/pages/DailyBriefsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { OperationsPage } from '@/pages/OperationsPage';
import { PerformanceAnalyticsPage } from '@/pages/PerformanceAnalyticsPage';
import { RunComparisonPage } from '@/pages/RunComparisonPage';
import { ScenarioMonitorPage } from '@/pages/ScenarioMonitorPage';
import { ResearchRunFormPage } from '@/pages/ResearchRunFormPage';
import { ResearchHistoryPage } from '@/pages/ResearchHistoryPage';
import { ResearchRunWorkspacePage } from '@/pages/ResearchRunWorkspacePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SignalDetailPage } from '@/pages/SignalDetailPage';
import { SignalsPage } from '@/pages/SignalsPage';
import { ThesisDetailPage } from '@/pages/ThesisDetailPage';
import { ThesisLibraryPage } from '@/pages/ThesisLibraryPage';
import { ThesisMonitorPage } from '@/pages/ThesisMonitorPage';
import { WatchlistsPage } from '@/pages/WatchlistsPage';
import { WorkbenchPage } from '@/pages/WorkbenchPage';

export const router = createBrowserRouter([
  {
    element: <MainLayout />,
    children: [
      { index: true, element: <Navigate to="/workbench" replace /> },
      { path: 'workbench', element: <WorkbenchPage /> },
      { path: 'research/new', element: <ResearchRunFormPage /> },
      { path: 'research/history', element: <ResearchHistoryPage /> },
      { path: 'performance', element: <PerformanceAnalyticsPage /> },
      { path: 'compare', element: <RunComparisonPage /> },
      { path: 'research/runs/:id', element: <ResearchRunWorkspacePage /> },
      { path: 'journal/runs/:id', element: <ResearchRunWorkspacePage journal /> },
      { path: 'theses', element: <ThesisLibraryPage /> },
      { path: 'theses/:id/monitor', element: <ThesisMonitorPage /> },
      { path: 'theses/:id', element: <ThesisDetailPage /> },
      { path: 'signals', element: <SignalsPage /> },
      { path: 'signals/:id', element: <SignalDetailPage /> },
      { path: 'scenarios', element: <ScenarioMonitorPage /> },
      { path: 'alerts', element: <AlertsPage /> },
      { path: 'watchlists', element: <WatchlistsPage /> },
      { path: 'briefs/daily', element: <DailyBriefsPage /> },
      { path: 'operations', element: <OperationsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
