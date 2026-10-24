import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useDocumentTitle } from '../../hooks/useApi';
import { Alert } from '../../components/ui';

export default function HelpPage() {
  useDocumentTitle('Help and limitations');
  const location = useLocation();
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [location.hash]);

  return (
    <>
      <h1>Help and limitations</h1>
      <Alert kind="warning" className="mb-3">APAAR Setu is a student prototype using synthetic data. It is not an official AICTE, Ministry of Education or APAAR system and has no government approval or affiliation.</Alert>

      <section className="card-gov" id="about">
        <h2>About this prototype</h2>
        <p>It demonstrates an AICTE-side verified student register: colleges upload admission CSV files, records are validated, a college head certifies them, and AICTE officers monitor conflicts and risk signals. Students decide which verifiers may see which fields.</p>
      </section>

      <section className="card-gov" id="roles">
        <h2>The eight roles</h2>
        <ul className="mb-0">
          <li><strong>College Operator (maker)</strong>: uploads files, fixes validation issues, marks a batch ready. Cannot certify.</li>
          <li><strong>College Head (checker)</strong>: reviews, accepts warning dispositions, returns or certifies own-college batches.</li>
          <li><strong>AICTE National Officer</strong>: national dashboards, risk queue, conflict monitor, audit verification. No system-admin powers.</li>
          <li><strong>AICTE Regional Officer</strong>: the same for assigned regions only.</li>
          <li><strong>AICTE System Administrator</strong>: accounts, organisations, documented demo settings and seat-policy versions (a second administrator must approve publication). Cannot certify batches.</li>
          <li><strong>Degree-Awarding Body</strong>: issues and revokes demo credentials for affiliated institutions only.</li>
          <li><strong>Verifier</strong>: requests specific fields for a stated purpose; sees data only after the student consents.</li>
          <li><strong>Student</strong>: views own record, approves/denies/revokes consent, sees access history, requests corrections.</li>
        </ul>
      </section>

      <section className="card-gov" id="upload">
        <h2>Preparing the admission CSV</h2>
        <p>Download the template from the upload page. Columns: studentCode, studentName, courseCode, academicYear, bucketCode, externalIdDemo, contactToken, yearOfStudy, admittedOn. Dates use YYYY-MM-DD. Files are limited to the configured size and row count.</p>
        <p className="mb-0"><strong>Row numbers match your spreadsheet:</strong> row 1 is the header, so the first student is row 2. Your institution is taken from your account, never from the file.</p>
      </section>

      <section className="card-gov" id="validation">
        <h2>The seven validation layers</h2>
        <ol>
          <li><strong>L1 Schema</strong> - required fields, formats, configured course and bucket codes (ERROR).</li>
          <li><strong>L2 Identity (MOCK)</strong> - 12-digit demo identifier format (ERROR), simulated registry match (WARNING if mismatched), PENDING if the mock service is unavailable. Never a real identity check.</li>
          <li><strong>L3 Duplicates</strong> - the same student twice in a batch or already active at your institution (ERROR, both rows named).</li>
          <li><strong>L4 Seat ledger</strong> - each bucket checked against its configured capacity (ERROR if exceeded).</li>
          <li><strong>L5 Cross-college</strong> - student appears active elsewhere (WARNING plus a conflict case after commit; not a finding of wrongdoing).</li>
          <li><strong>L6 Consistency</strong> - academic year, course duration, admission dates (ERROR or WARNING).</li>
          <li><strong>L7 Risk signals</strong> - shared contact tokens, late additions, unusual bucket ratios (RISK FLAG only; never blocks, never a verdict).</li>
        </ol>
        <p className="mb-0">Errors must be corrected or the row excluded. Warnings need an operator justification that the college head accepts. After editing, run “Revalidate changed rows” so the results are current.</p>
      </section>

      <section className="card-gov" id="certify">
        <h2>Certification (maker-checker)</h2>
        <p className="mb-0">The operator marks a batch ready for review; only the college head can certify. Certification re-checks everything and commits all rows, seats, history and audit entries in one database transaction - or nothing at all. If the seat policy changed after validation, the batch is sent back for revalidation.</p>
      </section>

      <section className="card-gov" id="consent">
        <h2>Consent and verification</h2>
        <p className="mb-0">A verifier chooses a documented purpose and allowed fields. The student approves (possibly fewer fields), denies or later revokes. Consent expires automatically. Every disclosure is listed in the student&apos;s access history. The consent record is a prototype record with a plain hash, not a digitally signed artefact.</p>
      </section>

      <section className="card-gov" id="privacy">
        <h2>Privacy and data use</h2>
        <ul className="mb-0">
          <li>All names, codes and identifiers are fabricated. Do not enter real APAAR, Aadhaar or contact details.</li>
          <li>Officer views and exports mask student identifiers by default. Public QR checks show no personal data.</li>
          <li>Passwords are stored only as hashes; sessions use an HttpOnly cookie.</li>
          <li>A consent screen is not a legal compliance certification.</li>
        </ul>
      </section>

      <section className="card-gov" id="limitations">
        <h2>What this prototype does not do</h2>
        <ul className="mb-0">
          <li>No connection to real APAAR, ABC, DigiLocker or AICTE systems - those are clearly labelled MOCK adapters.</li>
          <li>QR codes contain a link with an opaque reference; they are not signed verifiable credentials and cannot be verified offline.</li>
          <li>The audit hash chain detects uncoordinated changes; it does not make the database tamper-proof.</li>
          <li>Seat capacities and windows are synthetic configuration, not official quotas or deadlines.</li>
          <li>No OTP/e-sign, no email delivery, no production identity provider, and no measured performance claims.</li>
        </ul>
      </section>

      <section className="card-gov" id="accessibility">
        <h2>Accessibility</h2>
        <p className="mb-0">Use the utility strip to change text size (up to 150%), switch high contrast, or choose Hindi for the site navigation and home page (detailed workflow pages remain in English). All controls are keyboard accessible with a visible focus outline; statuses always use text and icons, not colour alone. A formal WCAG / GIGW audit has not been carried out.</p>
      </section>
    </>
  );
}
