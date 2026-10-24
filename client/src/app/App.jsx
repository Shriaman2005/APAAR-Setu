import { lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../features/auth/AuthContext';
import { PreferencesProvider } from '../features/preferences/PreferencesContext';
import { ToastProvider } from '../components/Toasts';
import AppShell from './AppShell';
import ProtectedRoute from './ProtectedRoute';
import HomePage from '../pages/public/HomePage';
import LoginPage from '../pages/public/LoginPage';
import SetPasswordPage from '../pages/public/SetPasswordPage';
import HelpPage from '../pages/public/HelpPage';
import { NotFoundPage, UnauthorizedPage } from '../pages/public/StatusPages';
import AccountPage from '../pages/common/AccountPage';
import NotificationsPage from '../pages/common/NotificationsPage';
// Role areas are loaded on demand, so each user downloads only the pages they can use.
const named = (loader, name) => lazy(() => loader().then((module) => ({ default: module[name] })));
const VerifyPage = lazy(() => import('../pages/public/VerifyPage'));
const CollegeDashboard = lazy(() => import('../pages/college/CollegeDashboard'));
const UploadWizard = lazy(() => import('../pages/college/UploadWizard'));
const BatchListPage = lazy(() => import('../pages/college/BatchListPage'));
const BatchDetailPage = lazy(() => import('../pages/college/batch/BatchDetailPage'));
const CorrectionRequestsPage = lazy(() => import('../pages/college/CorrectionRequestsPage'));
const SeatLedgerPage = lazy(() => import('../pages/shared/SeatLedgerPage'));
const RegisterPage = lazy(() => import('../pages/shared/RegisterPage'));
const ConflictListPage = named(() => import('../pages/shared/ConflictPages'), 'ConflictListPage');
const ConflictDetailPage = named(() => import('../pages/shared/ConflictPages'), 'ConflictDetailPage');
const AuditExplorerPage = lazy(() => import('../pages/shared/AuditExplorerPage'));
const CertificatePrintPage = named(() => import('../pages/shared/CredentialPanel'), 'CertificatePrintPage');
const AicteDashboard = lazy(() => import('../pages/aicte/AicteDashboard'));
const RiskQueuePage = named(() => import('../pages/aicte/RiskPages'), 'RiskQueuePage');
const RiskCaseDetailPage = named(() => import('../pages/aicte/RiskPages'), 'RiskCaseDetailPage');
const AdminDashboard = lazy(() => import('../pages/admin/AdminDashboard'));
const UsersPage = lazy(() => import('../pages/admin/UsersPage'));
const OrganisationsPage = named(() => import('../pages/admin/AdminMiscPages'), 'OrganisationsPage');
const SettingsPage = named(() => import('../pages/admin/AdminMiscPages'), 'SettingsPage');
const LedgerCheckPage = named(() => import('../pages/admin/AdminMiscPages'), 'LedgerCheckPage');
const PolicyListPage = named(() => import('../pages/admin/PolicyPages'), 'PolicyListPage');
const PolicyDetailPage = named(() => import('../pages/admin/PolicyPages'), 'PolicyDetailPage');
const PolicyEditorPage = named(() => import('../pages/admin/PolicyPages'), 'PolicyEditorPage');
const PolicyComparePage = named(() => import('../pages/admin/PolicyPages'), 'PolicyComparePage');
const IssuerWorkspace = named(() => import('../pages/issuer/IssuerPages'), 'IssuerWorkspace');
const IssuerStudentPage = named(() => import('../pages/issuer/IssuerPages'), 'IssuerStudentPage');
const IssuerCredentialsPage = named(() => import('../pages/issuer/IssuerPages'), 'IssuerCredentialsPage');
const VerifierDashboard = named(() => import('../pages/verifier/VerifierPages'), 'VerifierDashboard');
const VerifierOnboardingPage = named(() => import('../pages/verifier/VerifierPages'), 'VerifierOnboardingPage');
const NewRequestPage = named(() => import('../pages/verifier/VerifierPages'), 'NewRequestPage');
const RequestDetailPage = named(() => import('../pages/verifier/VerifierPages'), 'RequestDetailPage');
const StudentRecordPage = named(() => import('../pages/student/StudentPages'), 'StudentRecordPage');
const ConsentInboxPage = named(() => import('../pages/student/StudentPages'), 'ConsentInboxPage');
const AccessLogPage = named(() => import('../pages/student/StudentPages'), 'AccessLogPage');
const StudentCredentialsPage = named(() => import('../pages/student/StudentPages'), 'StudentCredentialsPage');
const StudentCorrectionsPage = named(() => import('../pages/student/StudentPages'), 'StudentCorrectionsPage');

const COLLEGE = ['COLLEGE_OPERATOR', 'COLLEGE_HEAD'];
const OFFICERS = ['AICTE_NATIONAL_OFFICER', 'AICTE_REGIONAL_OFFICER'];

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="set-password" element={<SetPasswordPage />} />
        <Route path="verify" element={<VerifyPage />} />
        <Route path="verify/:credentialRef" element={<VerifyPage />} />
        <Route path="help" element={<HelpPage />} />
        <Route path="unauthorized" element={<UnauthorizedPage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="account" element={<AccountPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>
        <Route element={<ProtectedRoute roles={['STUDENT', 'DEGREE_AWARDING_BODY']} />}>
          <Route path="credentials/:credentialRef/print" element={<CertificatePrintPage />} />
        </Route>

        <Route path="college" element={<ProtectedRoute roles={COLLEGE} />}>
          <Route index element={<CollegeDashboard />} />
          <Route element={<ProtectedRoute roles={['COLLEGE_OPERATOR']} />}>
            <Route path="upload" element={<UploadWizard />} />
          </Route>
          <Route path="batches" element={<BatchListPage />} />
          <Route path="batches/:batchId" element={<BatchDetailPage />} />
          <Route path="seat-ledger" element={<SeatLedgerPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="conflicts" element={<ConflictListPage />} />
          <Route path="conflicts/:conflictId" element={<ConflictDetailPage />} />
          <Route path="correction-requests" element={<CorrectionRequestsPage />} />
          <Route element={<ProtectedRoute roles={['COLLEGE_HEAD']} />}>
            <Route path="audit" element={<AuditExplorerPage />} />
          </Route>
        </Route>

        <Route path="aicte" element={<ProtectedRoute roles={OFFICERS} />}>
          <Route index element={<AicteDashboard />} />
          <Route path="risk" element={<RiskQueuePage />} />
          <Route path="risk/:riskCaseId" element={<RiskCaseDetailPage />} />
          <Route path="conflicts" element={<ConflictListPage />} />
          <Route path="conflicts/:conflictId" element={<ConflictDetailPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="audit" element={<AuditExplorerPage />} />
          <Route path="institutions/:institutionId/seat-ledger" element={<SeatLedgerPage />} />
          <Route element={<ProtectedRoute roles={['AICTE_NATIONAL_OFFICER']} />}>
            <Route path="policies" element={<PolicyListPage />} />
            <Route path="policies/compare" element={<PolicyComparePage />} />
            <Route path="policies/:id" element={<PolicyDetailPage />} />
          </Route>
        </Route>

        <Route path="admin" element={<ProtectedRoute roles={['AICTE_SYSTEM_ADMIN']} />}>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="organisations" element={<OrganisationsPage />} />
          <Route path="policies" element={<PolicyListPage />} />
          <Route path="policies/new" element={<PolicyEditorPage />} />
          <Route path="policies/compare" element={<PolicyComparePage />} />
          <Route path="policies/:id" element={<PolicyDetailPage />} />
          <Route path="policies/:id/edit" element={<PolicyEditorPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="audit" element={<AuditExplorerPage />} />
          <Route path="ledger-check" element={<LedgerCheckPage />} />
        </Route>

        <Route path="issuer" element={<ProtectedRoute roles={['DEGREE_AWARDING_BODY']} />}>
          <Route index element={<IssuerWorkspace />} />
          <Route path="students/:enrolmentRef" element={<IssuerStudentPage />} />
          <Route path="credentials" element={<IssuerCredentialsPage />} />
        </Route>

        <Route path="verifier" element={<ProtectedRoute roles={['VERIFIER']} />}>
          <Route index element={<VerifierDashboard />} />
          <Route path="onboarding" element={<VerifierOnboardingPage />} />
          <Route path="requests/new" element={<NewRequestPage />} />
          <Route path="requests/:requestId" element={<RequestDetailPage />} />
        </Route>

        <Route path="student" element={<ProtectedRoute roles={['STUDENT']} />}>
          <Route index element={<StudentRecordPage />} />
          <Route path="consents" element={<ConsentInboxPage />} />
          <Route path="access-log" element={<AccessLogPage />} />
          <Route path="credentials" element={<StudentCredentialsPage />} />
          <Route path="corrections" element={<StudentCorrectionsPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export function Providers({ children }) {
  return (
    <PreferencesProvider>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </PreferencesProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Providers>
        <AppRoutes />
      </Providers>
    </BrowserRouter>
  );
}
