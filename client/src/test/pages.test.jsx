import { describe, expect, test } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BatchDetailPage from '../pages/college/batch/BatchDetailPage';
import { ConsentInboxPage } from '../pages/student/StudentPages';
import { mockFetch, renderWithProviders, signedIn, USERS } from './utils';

const BATCH_ID = 'BATCH-ABC-DEMO-20261024-TEST';

function batchDetail({ status, canMarkReady, canCertify, markReadyBlockers = [], certifyBlockers = [], permissions = {} }) {
  return {
    batch: {
      batchId: BATCH_ID, academicYear: '2026-27', status, sourceFileName: 'clean_batch.csv', fileSizeBytes: 400, createdAt: '2026-10-24T10:00:00Z',
      createdByName: 'Demo Operator', counts: { totalRows: 4, validRows: 3, openErrors: canMarkReady ? 0 : 1, warnings: 0, pendingChecks: 0, riskFlags: 0, excludedRows: 0, staleRows: 0, dispositionsAwaitingHead: 0 },
      validationRunCount: 1, validatedPolicyVersion: 'DEMO-v1', statusHistory: [],
    },
    readiness: { activePolicyVersion: 'DEMO-v1', canMarkReady, markReadyBlockers, canCertify, certifyBlockers, counts: {} },
    permissions,
  };
}

const EMPTY_PAGE = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 };

describe('batch detail actions follow server readiness', () => {
  test('operator: "Mark ready" is disabled and the exact blockers are listed', async () => {
    mockFetch({
      ...signedIn(USERS.operator),
      [`GET /batches/${BATCH_ID}`]: batchDetail({
        status: 'NEEDS_CORRECTION', canMarkReady: false, canCertify: false,
        markReadyBlockers: [{ code: 'OPEN_ERRORS', message: '1 blocking error(s) must be corrected or the rows excluded.' }],
        permissions: { canRevalidate: true, canEditRows: true, canJustify: true, canDiscard: true },
      }),
      [`GET /batches/${BATCH_ID}/issues*`]: EMPTY_PAGE,
    });
    renderWithProviders(<BatchDetailPage />, { route: `/college/batches/${BATCH_ID}`, path: '/college/batches/:batchId' });
    const markReady = await screen.findByRole('button', { name: /mark ready for review/i });
    expect(markReady).toBeDisabled();
    expect(screen.getAllByText('1 blocking error(s) must be corrected or the rows excluded.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /revalidate changed rows/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /certify/i })).not.toBeInTheDocument();
  });

  test('head: certify needs the declaration and the typed batch ID, then posts once', async () => {
    const { calls } = mockFetch({
      ...signedIn(USERS.head),
      [`GET /batches/${BATCH_ID}`]: batchDetail({ status: 'READY_FOR_REVIEW', canMarkReady: false, canCertify: true, permissions: { canReturn: true, canCertify: true, canAcceptDispositions: true } }),
      [`GET /batches/${BATCH_ID}/review`]: { ledgerImpact: [], declaration: { version: 'DECL-DEMO-v1', text: 'I confirm the records (prototype declaration).' }, confirmationNote: 'OTP is not implemented.' },
      [`GET /batches/${BATCH_ID}/issues*`]: EMPTY_PAGE,
      [`POST /batches/${BATCH_ID}/certify`]: { idempotentReplay: false, status: 'COMMITTED', commitSummary: { committedRows: 4 } },
    });
    renderWithProviders(<BatchDetailPage />, { route: `/college/batches/${BATCH_ID}`, path: '/college/batches/:batchId' });
    await userEvent.click(await screen.findByRole('button', { name: /certify and submit/i }));
    const dialog = await screen.findByRole('dialog', { name: /certify and submit batch/i });
    const confirm = within(dialog).getByRole('button', { name: /certify and submit/i });
    expect(confirm).toBeDisabled();
    await userEvent.click(within(dialog).getByLabelText(/I confirm the declaration/));
    await userEvent.type(within(dialog).getByLabelText(/Type the batch ID/), BATCH_ID);
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(calls.filter((c) => c.path === `/batches/${BATCH_ID}/certify`)).toHaveLength(1));
    expect(calls.find((c) => c.path === `/batches/${BATCH_ID}/certify`).body).toEqual({ declarationAccepted: true, confirmBatchId: BATCH_ID });
  });
});

describe('student consent inbox', () => {
  test('student can untick a field; only approved fields are sent', async () => {
    const consent = {
      consentId: 'CNS-1', requestId: 'VRQ-1', status: 'PENDING', requester: { name: 'Demo Employer' }, purpose: 'EMPLOYMENT_VERIFICATION',
      purposeLabel: 'Employment background check (demo purpose)', requestedFields: ['displayName', 'enrolmentStatus'], approvedFields: [],
      expiresAt: '2026-11-01T00:00:00Z', createdAt: '2026-10-24T00:00:00Z', modeNote: 'Prototype consent record.',
    };
    const { calls } = mockFetch({
      ...signedIn(USERS.student),
      'GET /consents*': { ...EMPTY_PAGE, items: [consent], total: 1, fieldLabels: { displayName: 'Student name', enrolmentStatus: 'Enrolment status' } },
      'POST /consents/CNS-1/approve': { ...consent, status: 'APPROVED', approvedFields: ['enrolmentStatus'] },
    });
    renderWithProviders(<ConsentInboxPage />, { route: '/student/consents', path: '/student/consents' });
    await userEvent.click(await screen.findByRole('button', { name: /^approve$/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('Student name'));
    await userEvent.click(within(dialog).getByRole('button', { name: /approve selected fields/i }));
    await waitFor(() => expect(calls.some((c) => c.path === '/consents/CNS-1/approve')).toBe(true));
    expect(calls.find((c) => c.path === '/consents/CNS-1/approve').body).toEqual({ approvedFields: ['enrolmentStatus'] });
  });
});
