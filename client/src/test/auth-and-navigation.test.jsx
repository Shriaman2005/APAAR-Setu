import { describe, expect, test } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import LoginPage, { validateLogin } from '../pages/public/LoginPage';
import ProtectedRoute from '../app/ProtectedRoute';
import AppShell from '../app/AppShell';
import { mockFetch, renderWithProviders, signedIn, signedOut, USERS } from './utils';

describe('login form', () => {
  test('validateLogin reports missing and malformed values', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({ email: 'Enter your email address.', password: 'Enter your password.' });
    expect(validateLogin({ email: 'not-an-email', password: 'x' }).email).toMatch(/valid email/);
    expect(validateLogin({ email: 'a@b.test', password: 'x' })).toEqual({});
  });

  test('empty submit shows field errors without calling the server', async () => {
    const { calls } = mockFetch(signedOut());
    renderWithProviders(<LoginPage />, { route: '/login' });
    await userEvent.click(await screen.findByRole('button', { name: /sign in/i }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/auth/login')).toBe(false);
  });

  test('show password toggles only the input type', async () => {
    mockFetch(signedOut());
    renderWithProviders(<LoginPage />, { route: '/login' });
    const password = await screen.findByLabelText(/^Password/);
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByLabelText('Show password'));
    expect(password).toHaveAttribute('type', 'text');
  });

  test('generic error on wrong credentials, password field cleared', async () => {
    mockFetch({ ...signedOut(), 'POST /auth/login': { __status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'The email or password is incorrect, or the account cannot sign in.' } } } });
    renderWithProviders(<LoginPage />, { route: '/login' });
    await userEvent.type(await screen.findByLabelText(/^Email address/), 'operator.demo@example.test');
    await userEvent.type(screen.getByLabelText(/^Password/), 'wrong-password-1');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/email or password is incorrect/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toHaveValue('');
  });

  test('successful login sends credentials with the CSRF header and goes to the role home', async () => {
    const { calls } = mockFetch({ ...signedOut(), 'POST /auth/login': { user: USERS.operator, csrfToken: 'new-token' }, 'GET /notifications*': { items: [], unreadCount: 0 } });
    renderWithProviders(null, {
      route: '/login',
      routes: [<Route key="l" path="/login" element={<LoginPage />} />, <Route key="c" path="/college" element={<p>College home</p>} />],
    });
    await userEvent.type(await screen.findByLabelText(/^Email address/), 'operator.demo@example.test');
    await userEvent.type(screen.getByLabelText(/^Password/), 'Correct-Password-1');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('College home')).toBeInTheDocument();
    const login = calls.find((c) => c.path === '/auth/login');
    expect(login.body).toEqual({ email: 'operator.demo@example.test', password: 'Correct-Password-1' });
    expect(login.headers['X-CSRF-Token']).toBe('test-csrf-token');
  });
});

describe('quick demo access', () => {
  const DEMO_ACCOUNTS = {
    enabled: true,
    accounts: [
      { email: 'operator.demo@example.test', role: 'COLLEGE_OPERATOR', scope: 'ABC Institute of Technology (Demo)' },
      { email: 'operator.xyz.demo@example.test', role: 'COLLEGE_OPERATOR', scope: 'XYZ Engineering College (Demo)' },
      { email: 'student.demo@example.test', role: 'STUDENT', scope: 'Aarav Sharma (Demo Student)' },
    ],
  };
  const loginRoutes = [<Route key="l" path="/login" element={<LoginPage />} />, <Route key="c" path="/college" element={<p>College home</p>} />];

  test('one button per role; one click signs in with the CSRF header and opens the role home', async () => {
    const { calls } = mockFetch({
      ...signedOut(),
      'GET /auth/demo-accounts': DEMO_ACCOUNTS,
      'POST /auth/demo-login': { user: USERS.operator, csrfToken: 'new-token' },
      'GET /notifications*': { items: [], unreadCount: 0 },
    });
    renderWithProviders(null, { route: '/login', routes: loginRoutes });
    const panel = await screen.findByRole('region', { name: 'Quick demo access' });
    expect(within(panel).getAllByRole('button', { name: /College Operator/ })).toHaveLength(2);
    expect(screen.getByText(/More demo accounts/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'College Operator (Maker) ABC Institute of Technology (Demo)' }));
    expect(await screen.findByText('College home')).toBeInTheDocument();
    const demo = calls.find((c) => c.path === '/auth/demo-login');
    expect(demo.body).toEqual({ email: 'operator.demo@example.test' });
    expect(demo.headers['X-CSRF-Token']).toBe('test-csrf-token');
  });

  test('hidden when the server has demo access switched off; the password form still works', async () => {
    mockFetch({ ...signedOut(), 'GET /auth/demo-accounts': { enabled: false, accounts: [] } });
    renderWithProviders(<LoginPage />, { route: '/login' });
    expect(await screen.findByLabelText(/^Email address/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Quick demo access')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
});

describe('route guards (UX only - the API enforces permissions)', () => {
  const tree = [
    <Route key="p" element={<ProtectedRoute roles={['AICTE_SYSTEM_ADMIN']} />}><Route path="/admin" element={<p>Admin area</p>} /></Route>,
    <Route key="l" path="/login" element={<p>Login page</p>} />,
    <Route key="u" path="/unauthorized" element={<p>Not permitted</p>} />,
  ];

  test('signed-out users are sent to login', async () => {
    mockFetch(signedOut());
    renderWithProviders(null, { route: '/admin', routes: tree });
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  test('wrong role is sent to the unauthorised page', async () => {
    mockFetch(signedIn(USERS.operator));
    renderWithProviders(null, { route: '/admin', routes: tree });
    expect(await screen.findByText('Not permitted')).toBeInTheDocument();
  });

  test('right role sees the page', async () => {
    mockFetch(signedIn(USERS.admin));
    renderWithProviders(null, { route: '/admin', routes: tree });
    expect(await screen.findByText('Admin area')).toBeInTheDocument();
  });
});

describe('application shell', () => {
  const shell = (child) => [<Route key="s" element={<AppShell />}><Route path="*" element={child} /></Route>];

  test('operator sees operator menu items only', async () => {
    mockFetch(signedIn(USERS.operator));
    renderWithProviders(null, { route: '/college', routes: shell(<p>content</p>) });
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(await within(nav).findByText('Upload batch')).toBeInTheDocument();
    expect(within(nav).queryByText('Users')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Risk queue')).not.toBeInTheDocument();
  });

  test('student menu has consent inbox and no college actions', async () => {
    mockFetch(signedIn(USERS.student));
    renderWithProviders(null, { route: '/student', routes: shell(<p>content</p>) });
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(await within(nav).findByText('Consent inbox')).toBeInTheDocument();
    expect(within(nav).queryByText('Upload batch')).not.toBeInTheDocument();
  });

  test('skip link, prototype notice and the short footer are present', async () => {
    mockFetch(signedOut());
    renderWithProviders(null, { route: '/', routes: shell(<p>content</p>) });
    expect(await screen.findByText('Skip to main content')).toHaveAttribute('href', '#main-content');
    expect(screen.getByText(/not an official AICTE, Ministry of Education or APAAR system/i)).toBeInTheDocument();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('APAAR Setu (Prototype)')).toBeInTheDocument();
    expect(within(footer).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['#top']);
  });

  test('signed-out header has the display controls and no Login or Verify buttons', async () => {
    mockFetch(signedOut());
    renderWithProviders(null, { route: '/', routes: shell(<p>content</p>) });
    const header = await screen.findByRole('banner');
    expect(within(header).getByRole('button', { name: /high contrast/i })).toBeInTheDocument();
    expect(within(header).getByLabelText('Language')).toBeInTheDocument();
    expect(within(header).queryByRole('link', { name: /login|verify credential/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /text size/i })).not.toBeInTheDocument();
  });

  test('high contrast and Hindi controls work', async () => {
    mockFetch(signedOut());
    renderWithProviders(null, { route: '/', routes: shell(<p>content</p>) });
    await userEvent.click(await screen.findByRole('button', { name: /high contrast/i }));
    expect(document.documentElement).toHaveAttribute('data-contrast', 'high');
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'hi');
    expect(await screen.findByText('मुख पृष्ठ')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'hi');
  });
});
