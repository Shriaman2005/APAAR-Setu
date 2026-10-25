import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../../hooks/useApi';
import { usePreferences } from '../../features/preferences/PreferencesContext';
import { useAuth, ROLE_HOME } from '../../features/auth/AuthContext';
import { Icon } from '../../components/ui';

export default function HomePage() {
  useDocumentTitle('Home');
  const { t } = usePreferences();
  const { user } = useAuth();

  return (
    <section className="home-hero" aria-labelledby="home-heading">
      <h1 id="home-heading">{t('homeWelcome')}</h1>
      <p className="lead">{t('homeIntro')}</p>
      <div className="d-flex flex-wrap justify-content-center gap-2">
        {user ? (
          <Link className="btn btn-accent" to={ROLE_HOME[user.role]}><Icon name="speedometer2" />{t('homeDashboard')}</Link>
        ) : (
          <Link className="btn btn-accent" to="/login"><Icon name="box-arrow-in-right" />{t('login')}</Link>
        )}
        <Link className="btn btn-light-on-dark" to="/verify"><Icon name="qr-code-scan" />{t('navVerify')}</Link>
      </div>
    </section>
  );
}
