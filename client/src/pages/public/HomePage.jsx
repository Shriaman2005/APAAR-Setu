import { Link } from 'react-router-dom';
import { api } from '../../services/apiClient';
import { useApi, useDocumentTitle } from '../../hooks/useApi';
import { usePreferences } from '../../features/preferences/PreferencesContext';
import { useAuth, ROLE_HOME } from '../../features/auth/AuthContext';
import { Icon, LoadingBlock, formatDate } from '../../components/ui';

export default function HomePage() {
  useDocumentTitle('Home');
  const { t } = usePreferences();
  const { user } = useAuth();
  const overview = useApi(() => api('/public/overview'), []);

  return (
    <>
      <section className="home-hero mb-4">
        <div className="row align-items-center g-3">
          <div className="col-lg-8">
            <h1>APAAR Setu</h1>
            <p className="lead mb-2">A prototype of an AICTE-side verified student register: colleges upload admission records, the system validates them in seven layers, college heads certify, and officers review conflicts and risk signals.</p>
            <p className="mb-0">Students control who may verify their record. All data here is synthetic.</p>
          </div>
          <div className="col-lg-4 d-flex flex-wrap gap-2 justify-content-lg-end">
            {user ? (
              <Link className="btn btn-accent" to={ROLE_HOME[user.role]}><Icon name="speedometer2" />Go to my dashboard</Link>
            ) : (
              <Link className="btn btn-accent" to="/login"><Icon name="box-arrow-in-right" />{t('login')}</Link>
            )}
            <Link className="btn btn-light-on-dark" to="/verify"><Icon name="qr-code-scan" />{t('navVerify')}</Link>
          </div>
        </div>
      </section>

      <div className="row g-3">
        <div className="col-lg-6">
          <section className="card-gov home-block" aria-labelledby="news-heading">
            <h2 id="news-heading"><Icon name="megaphone" className="me-2" />{t('homeNews')}</h2>
            <ul>
              <li>Prototype release for SIH 2026 (PS 26263) demonstration. Every record, institution and identifier is fabricated.</li>
              <li>Seat capacities come from the synthetic configuration <strong>SYNTHETIC_DEMO_CONFIG</strong>; they are not official AICTE quotas.</li>
              <li>Identity checks use a MOCK APAAR-like service. No real registry, DigiLocker or AICTE system is contacted.</li>
              <li>QR codes link to a status page; they are not digitally signed credentials.</li>
            </ul>
          </section>
        </div>
        <div className="col-lg-6">
          <section className="card-gov home-block" aria-labelledby="dates-heading">
            <h2 id="dates-heading"><Icon name="calendar-event" className="me-2" />{t('homeDueDates')}</h2>
            {overview.loading && <LoadingBlock />}
            {overview.error && <p className="text-danger">Dates are unavailable right now ({overview.error.message}).</p>}
            {overview.data && overview.data.activePolicies.length === 0 && <p className="text-muted">No seat policy is published yet.</p>}
            {overview.data?.activePolicies.map((policy) => (
              <div key={policy.academicYear} className="mb-2">
                <strong>Academic year {policy.academicYear}</strong> <span className="small text-muted">(policy {policy.version}, {policy.sourceType})</span>
                <ul>
                  <li>Admission window opens: {formatDate(policy.admissionWindow.opensOn)}</li>
                  <li>Admission window closes: {formatDate(policy.admissionWindow.closesOn)} - later admissions raise a review signal</li>
                </ul>
              </div>
            ))}
          </section>
        </div>
        <div className="col-lg-4">
          <section className="card-gov home-block" aria-labelledby="help-heading">
            <h2 id="help-heading"><Icon name="question-circle" className="me-2" />{t('homeHelpTopics')}</h2>
            <ul>
              <li><Link to="/help#upload">How to prepare and upload the admission CSV</Link></li>
              <li><Link to="/help#validation">What the seven validation layers check</Link></li>
              <li><Link to="/help#certify">Maker-checker certification explained</Link></li>
              <li><Link to="/help#consent">How student consent and verification work</Link></li>
              <li><Link to="/help#limitations">What this prototype does not do</Link></li>
            </ul>
          </section>
        </div>
        <div className="col-lg-4">
          <section className="card-gov home-block" aria-labelledby="desk-heading">
            <h2 id="desk-heading"><Icon name="headset" className="me-2" />{t('homeHelpDesk')}</h2>
            <p>This student prototype has no live helpline or grievance cell.</p>
            <p className="mb-0">For questions about the demo, contact the project team, or read the <Link to="/help">Help and limitations</Link> page. Account problems are handled by the prototype&apos;s system administrator.</p>
          </section>
        </div>
        <div className="col-lg-4">
          <section className="card-gov home-block" aria-labelledby="resources-heading">
            <h2 id="resources-heading"><Icon name="collection" className="me-2" />{t('homeResources')}</h2>
            <ul>
              <li><Link to="/verify">Check a credential QR status</Link></li>
              <li><Link to="/help#roles">The eight user roles</Link></li>
              <li><Link to="/help#privacy">How personal data is minimised</Link></li>
              <li><Link to="/help#accessibility">Accessibility features</Link></li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
