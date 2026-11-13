import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AdminInvitationsPage from './pages/AdminInvitationsPage.jsx';
import AdminSetupPage from './pages/AdminSetupPage.jsx';
import AdminBootstrapPage from './pages/AdminBootstrapPage.jsx';
import OfficerMfaEnrollmentPage from './pages/OfficerMfaEnrollmentPage.jsx';
import OfficerReplacementsPage from './pages/OfficerReplacementsPage.jsx';
import OfficerSetupPage from './pages/OfficerSetupPage.jsx';
import AccountRecoveryPage from './pages/AccountRecoveryPage.jsx';
import RecoverySetupPage from './pages/RecoverySetupPage.jsx';
import MedicineRegistrationsPage from './pages/MedicineRegistrationsPage.jsx';
import EstablishmentLicensingPage from './pages/EstablishmentLicensingPage.jsx';
import ImportExportControlledPage from './pages/ImportExportControlledPage.jsx';
import BatchesRecallsPage from './pages/BatchesRecallsPage.jsx';
import RegistrySearchPage from './pages/RegistrySearchPage.jsx';
import PublicRegistryPage from './pages/PublicRegistryPage.jsx';
import PharmacovigilancePage from './pages/PharmacovigilancePage.jsx';
import ApiClientsPage from './pages/ApiClientsPage.jsx';

function LoadingScreen({ message = 'Checking your secure session…' }) {
  return (
    <main className="grid min-h-screen place-items-center bg-mist px-6">
      <div className="flex items-center gap-3 text-sm font-medium text-slate-600" role="status">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-teal border-t-transparent" />
        {message}
      </div>
    </main>
  );
}

function RootRedirect() {
  const { phase, user } = useAuth();
  if (phase === 'loading') return <LoadingScreen />;
  return <Navigate to={user ? '/dashboard' : '/login'} replace />;
}

function ProtectedDashboard({ children }) {
  const { phase, error, retry, user } = useAuth();
  if (phase === 'loading') return <LoadingScreen />;

  if (phase === 'unavailable') {
    return (
      <main className="grid min-h-screen place-items-center bg-mist px-6">
        <section className="max-w-md rounded-3xl bg-white p-8 text-center shadow-card">
          <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-700" aria-hidden="true">
            !
          </div>
          <h1 className="text-xl font-semibold text-ink">Session check unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {error?.message || 'We could not verify your session. Check that the API is running, then retry.'}
          </p>
          <button className="button-primary mt-6" onClick={retry} type="button">Retry</button>
        </section>
      </main>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  return children || <DashboardPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/public-register" element={<PublicRegistryPage />} />
      <Route path="/setup-admin" element={<AdminSetupPage />} />
      <Route path="/bootstrap-admin" element={<AdminBootstrapPage />} />
      <Route path="/setup-officer" element={<OfficerSetupPage />} />
      <Route path="/recovery-setup" element={<RecoverySetupPage />} />
      <Route path="/enroll-officer-mfa" element={<OfficerMfaEnrollmentPage />} />
      <Route path="/dashboard" element={<ProtectedDashboard />} />
      <Route
        path="/admin-invitations"
        element={(
          <ProtectedDashboard>
            <AdminInvitationsPage />
          </ProtectedDashboard>
        )}
      />
      <Route
        path="/officer-replacements"
        element={(
          <ProtectedDashboard>
            <OfficerReplacementsPage />
          </ProtectedDashboard>
        )}
      />
      <Route
        path="/account-recovery"
        element={(
          <ProtectedDashboard>
            <AccountRecoveryPage />
          </ProtectedDashboard>
        )}
      />
      <Route
        path="/medicine-registrations"
        element={(
          <ProtectedDashboard>
            <MedicineRegistrationsPage />
          </ProtectedDashboard>
        )}
      />
      <Route
        path="/establishment-licensing"
        element={(
          <ProtectedDashboard>
            <EstablishmentLicensingPage />
          </ProtectedDashboard>
        )}
      />
      <Route
        path="/import-export-controlled"
        element={(
          <ProtectedDashboard>
            <ImportExportControlledPage />
          </ProtectedDashboard>
        )}
      />
      <Route
        path="/batches-recalls"
        element={(
          <ProtectedDashboard>
            <BatchesRecallsPage />
          </ProtectedDashboard>
        )}
      />
      <Route
        path="/registry-search"
        element={(
          <ProtectedDashboard>
            <RegistrySearchPage />
          </ProtectedDashboard>
        )}
      />
      <Route
        path="/pharmacovigilance"
        element={(
          <ProtectedDashboard>
            <PharmacovigilancePage />
          </ProtectedDashboard>
        )}
      />
      <Route
        path="/api-clients"
        element={(
          <ProtectedDashboard>
            <ApiClientsPage />
          </ProtectedDashboard>
        )}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
