import { useState } from 'react';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { precheckCsv } from '../pages/college/UploadWizard';
import { extractReference } from '../pages/public/VerifyPage';
import { passwordProblems } from '../pages/public/SetPasswordPage';
import { StatusBadge, Button } from '../components/ui';
import Modal from '../components/Modal';
import { toQuery } from '../services/apiClient';

const COLUMNS = [
  { name: 'studentCode', required: true }, { name: 'studentName', required: true }, { name: 'courseCode', required: true },
  { name: 'academicYear', required: true }, { name: 'bucketCode', required: true }, { name: 'externalIdDemo', required: true },
  { name: 'contactToken', required: false }, { name: 'yearOfStudy', required: true }, { name: 'admittedOn', required: true },
];
const LIMITS = { maxUploadMb: 5, maxRows: 3, columns: COLUMNS };
const HEADER = COLUMNS.map((c) => c.name).join(',');

describe('upload pre-check (client convenience only)', () => {
  test('passes a well-formed file and counts rows', () => {
    const result = precheckCsv(`${HEADER}\nSTU-1,A,CSE,2026-27,REGULAR,111111111111,,1,2026-08-01\n`, { fileName: 'x.csv', sizeBytes: 100, ...LIMITS });
    expect(result.problems).toEqual([]);
    expect(result.rowCount).toBe(1);
  });

  test('reports wrong extension, missing and unexpected columns, too many rows', () => {
    const result = precheckCsv('studentCode,institutionId\na,b\nc,d\ne,f\ng,h\n', { fileName: 'x.txt', sizeBytes: 100, ...LIMITS });
    expect(result.problems.join(' ')).toMatch(/\.csv/);
    expect(result.problems.join(' ')).toMatch(/Missing required column\(s\): studentName/);
    expect(result.problems.join(' ')).toMatch(/Unexpected column\(s\): institutionId/);
    expect(result.problems.join(' ')).toMatch(/limit is 3/);
  });

  test('reports empty and header-only files', () => {
    expect(precheckCsv('', { fileName: 'x.csv', sizeBytes: 0, ...LIMITS }).problems).toContain('The file is empty.');
    expect(precheckCsv(`${HEADER}\n`, { fileName: 'x.csv', sizeBytes: 10, ...LIMITS }).problems.join(' ')).toMatch(/no student rows/);
  });
});

describe('small helpers', () => {
  test('QR payload: reference is extracted from a verification URL', () => {
    const ref = 'CRD-0123456789abcdef0123456789abcdef-0123456789ab';
    expect(extractReference(`http://localhost:5173/verify/${ref}`)).toBe(ref);
    expect(extractReference(`  ${ref}  `)).toBe(ref);
    expect(extractReference('something else')).toBe('something else');
  });

  test('password problems mirror the server policy', () => {
    expect(passwordProblems('short')).toEqual(['at least 12 characters', 'a digit']);
    expect(passwordProblems('Long-enough-password-1')).toEqual([]);
  });

  test('toQuery skips empty values', () => {
    expect(toQuery({ a: 1, b: '', c: undefined, d: 'x y' })).toBe('?a=1&d=x+y');
    expect(toQuery({})).toBe('');
  });
});

describe('components', () => {
  test('status badges always carry text, not colour alone', () => {
    render(<><StatusBadge status="ERROR" /><StatusBadge status="RISK_FLAG" /><StatusBadge status="UNKNOWN_STATE" /></>);
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Risk signal')).toBeInTheDocument();
    expect(screen.getByText('UNKNOWN_STATE')).toBeInTheDocument();
  });

  test('loading button is busy and disabled; disabled reason is announced', () => {
    render(<><Button loading loadingText="Uploading...">Upload</Button><Button disabled disabledReason="Choose a file first.">Submit</Button></>);
    const busy = screen.getByRole('button', { name: /uploading/i });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Choose a file first.')).toBeInTheDocument();
  });

  // Regression: focus used to jump back to the first field after every keystroke because the
  // modal re-ran its "on open" effect whenever the parent re-rendered.
  test('modal keeps focus in the field being typed into', async () => {
    function Harness() {
      const [values, setValues] = useState({ first: '', second: '' });
      return (
        <Modal title="Edit" onClose={() => {}}>
          <label htmlFor="first">First</label>
          <input id="first" value={values.first} onChange={(e) => setValues((v) => ({ ...v, first: e.target.value }))} />
          <label htmlFor="second">Second</label>
          <input id="second" value={values.second} onChange={(e) => setValues((v) => ({ ...v, second: e.target.value }))} />
        </Modal>
      );
    }
    render(<Harness />);
    expect(screen.getByLabelText('First')).toHaveFocus();
    await userEvent.click(screen.getByLabelText('Second'));
    await userEvent.keyboard('REGULAR');
    expect(screen.getByLabelText('Second')).toHaveValue('REGULAR');
    expect(screen.getByLabelText('First')).toHaveValue('');
    expect(screen.getByLabelText('Second')).toHaveFocus();
  });

  test('modal closes on Escape', async () => {
    let closed = false;
    render(<Modal title="Dialog" onClose={() => { closed = true; }}><p>Body</p></Modal>);
    expect(screen.getByRole('dialog', { name: 'Dialog' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(closed).toBe(true);
  });
});
