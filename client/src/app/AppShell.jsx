import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import logo from '../assets/apaar-setu-logo.png';
import { useAuth, ROLE_LABELS } from '../features/auth/AuthContext';
import { usePreferences } from '../features/preferences/PreferencesContext';
import { NAVIGATION } from './navigation';
import { Icon, LoadingBlock, RoleChip } from '../components/ui';
import { useToast } from '../components/Toasts';
import NotificationBell from './NotificationBell';

/* global __BUILD_DATE__ */
const BUILD_DATE = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';

function UtilityStrip() {
  const { t, language, setLanguage, highContrast, toggleContrast, decreaseText, resetText, increaseText } = usePreferences();
  return (
    <div className="utility-strip">
      <div className="container-xl d-flex flex-wrap justify-content-between align-items-center gap-2 py-1">
        <a className="text-decoration-underline small fw-semibold" href="#main-content">{t('skipToContent')}</a>
        <div className="d-flex flex-wrap align-items-center gap-2">
          <span className="small text-muted d-none d-sm-inline">{t('textSize')}:</span>
          <div className="btn-group" role="group" aria-label={t('textSize')}>
            <button type="button" className="btn-utility" onClick={decreaseText} aria-label={t('decreaseText')}>A-</button>
            <button type="button" className="btn-utility" onClick={resetText} aria-label={t('resetText')}>A</button>
            <button type="button" className="btn-utility" onClick={increaseText} aria-label={t('increaseText')}>A+</button>
          </div>
          <button type="button" className="btn-utility" aria-pressed={highContrast ? 'true' : 'false'} onClick={toggleContrast}>
            <Icon name="circle-half" className="me-1" />{t('highContrast')}
          </button>
          <label className="visually-hidden" htmlFor="language-select">{t('language')}</label>
          <select id="language-select" className="form-select form-select-sm w-auto" value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="en">English</option>
            <option value="hi">हिन्दी (आंशिक)</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function Header() {
  const { user, logout } = useAuth();
  const { t } = usePreferences();
  const navigate = useNavigate();
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
      navigate('/login', { replace: true, state: { message: 'You have signed out.' } });
    } catch (error) {
      // Do not claim sign-out succeeded unless the server confirmed it.
      toast.error(`Sign-out could not be confirmed by the server: ${error.message}`);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="site-header">
      <div className="container-xl d-flex flex-wrap justify-content-between align-items-center gap-3 py-2">
        <Link to="/" className="brand d-flex align-items-center gap-3 text-decoration-none">
          <img src={logo} alt="APAAR Setu logo" />
          <span className="d-none d-md-block border-start ps-3">
            <span className="brand-title d-block">{t('siteTitle')}</span>
            <span className="brand-subtitle d-block">{t('siteSubtitle')}</span>
          </span>
        </Link>
        <div className="d-flex flex-wrap align-items-center gap-2">
          {user ? (
            <>
              <NotificationBell />
              <div className="text-end me-1">
                <Link to="/account" className="fw-semibold d-block text-decoration-none">{user.displayName}</Link>
                <span title={ROLE_LABELS[user.role]}><RoleChip role={user.role} /></span>
              </div>
              <button type="button" className="btn btn-outline-primary" onClick={handleSignOut} disabled={signingOut} aria-busy={signingOut ? 'true' : undefined}>
                {signingOut ? <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> : <Icon name="box-arrow-right" />}
                {signingOut ? 'Signing out...' : t('signOut')}
              </button>
            </>
          ) : (
            <>
              <Link className="btn btn-outline-primary" to="/verify"><Icon name="qr-code-scan" />{t('navVerify')}</Link>
              <Link className="btn btn-accent" to="/login"><Icon name="box-arrow-in-right" />{t('login')}</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function MainNav() {
  const { user } = useAuth();
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const items = user
    ? NAVIGATION[user.role] || []
    : [
      { to: '/', label: t('navHome'), end: true },
      { to: '/verify', label: t('navVerify') },
      { to: '/help', label: t('navHelp') },
    ];
  return (
    <nav className="main-nav on-dark" aria-label="Main navigation">
      <div className="container-xl">
        <div className="d-flex d-lg-none justify-content-between align-items-center py-2">
          <span className="text-white fw-semibold">Menu</span>
          <button type="button" className="btn btn-light-on-dark btn-sm" aria-expanded={open} aria-controls="main-nav-items" onClick={() => setOpen((value) => !value)}>
            <Icon name={open ? 'x-lg' : 'list'} />{open ? 'Close' : 'Open'} menu
          </button>
        </div>
        <ul id="main-nav-items" className={`nav flex-column flex-lg-row ${open ? '' : 'd-none d-lg-flex'}`}>
          {items.map((item) => (
            <li className="nav-item" key={item.to}>
              <NavLink className="nav-link" to={item.to} end={item.end}>{item.label}</NavLink>
            </li>
          ))}
          {user && (
            <li className="nav-item ms-lg-auto">
              <NavLink className="nav-link" to="/help">{t('navHelp')}</NavLink>
            </li>
          )}
        </ul>
      </div>
    </nav>
  );
}

function Footer() {
  const { t } = usePreferences();
  return (
    <footer className="site-footer on-dark mt-5">
      <div className="container-xl py-4">
        <div className="row g-4">
          <div className="col-md-4">
            <h2 className="h3 text-white">APAAR Setu</h2>
            <p className="footer-note mb-0">{t('footerPrototype')}</p>
          </div>
          <div className="col-md-4">
            <ul className="list-unstyled mb-0">
              <li><Link to="/help#about">{t('footerAbout')}</Link></li>
              <li><Link to="/help#accessibility">{t('footerAccessibility')}</Link></li>
              <li><Link to="/help#privacy">{t('footerPrivacy')}</Link></li>
              <li><Link to="/verify">{t('navVerify')}</Link></li>
            </ul>
          </div>
          <div className="col-md-4 footer-note">
            <p className="mb-1">{t('footerHelp')}</p>
            <p className="mb-1">{t('footerLastUpdated')}: {BUILD_DATE || '-'}</p>
            <a href="#top">{t('backToTop')} <Icon name="arrow-up" /></a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function AppShell() {
  const { t } = usePreferences();
  return (
    <div id="top">
      <a className="skip-link" href="#main-content">{t('skipToContent')}</a>
      <UtilityStrip />
      <Header />
      <MainNav />
      <div className="prototype-bar">
        <div className="container-xl py-1 d-flex gap-2 align-items-start">
          <Icon name="cone-striped" />
          <span>{t('prototypeNotice')}</span>
        </div>
      </div>
      <main id="main-content" className="container-xl py-4" tabIndex={-1}>
        <Suspense fallback={<LoadingBlock text="Loading page..." />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
