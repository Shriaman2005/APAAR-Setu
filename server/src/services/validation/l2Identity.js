// L2 External identity (MOCK): demo identifier format, simulated registry match, and consistency
// with identities already in the register. No real APAAR/registry service is ever called.
const { makeIssue } = require('./issueFactory');
const { checkIdentity, DEMO_ID_FORMAT, ADAPTER_NAME } = require('../../adapters/mockIdentityAdapter');
const { maskIdentifier } = require('../../utils/mask');

function sameName(a, b) {
  const clean = (text) => String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return clean(a) === clean(b);
}

function runL2(ctx) {
  const issues = [];
  for (const row of ctx.rows) {
    const values = row.fields;
    const info = ctx.rowInfo.get(row.rowNumber);
    const add = (ruleCode, field, message, evidence, evidenceKey) =>
      issues.push(makeIssue(ruleCode, { rowNumber: row.rowNumber, field, message, evidence, evidenceKey }, ctx));

    // 1. Mock external identity check.
    const externalId = values.externalIdDemo;
    if (ctx.ruleset.mockIdentityCheckEnabled && externalId) {
      if (!DEMO_ID_FORMAT.test(externalId)) {
        info.identity = { status: 'FORMAT_INVALID', adapter: ADAPTER_NAME };
        add('L2_EXTERNAL_ID_FORMAT', 'externalIdDemo',
          `Row ${row.rowNumber}: demo identifier has ${externalId.length} characters; the synthetic demo format requires exactly 12 digits. ` +
            'This is a format check only; no registry lookup was made.',
          { length: externalId.length });
      } else if (!values.studentName) {
        // The name is missing (already an L1 error), so a mock name comparison would be meaningless.
        info.valid.externalIdDemo = true;
        info.identity = { status: 'NOT_CHECKED', adapter: ADAPTER_NAME };
      } else {
        info.valid.externalIdDemo = true;
        const result = checkIdentity({ externalId, studentName: values.studentName }, { serviceMode: ctx.settings.mockIdentityServiceMode });
        info.identity = { status: result.status, adapter: result.adapter };
        if (result.status === 'NAME_MISMATCH') {
          add('L2_MOCK_NAME_MISMATCH', 'studentName',
            `Row ${row.rowNumber}: the name does not match the MOCK identity record for this identifier (simulated check; no real registry was contacted).`);
        } else if (result.status === 'NOT_FOUND') {
          add('L2_MOCK_ID_NOT_FOUND', 'externalIdDemo',
            `Row ${row.rowNumber}: identifier ${maskIdentifier(externalId)} was not found in the MOCK identity registry (simulated check).`);
        } else if (result.status === 'PENDING') {
          add('L2_IDENTITY_CHECK_PENDING', 'externalIdDemo',
            `Row ${row.rowNumber}: the mock identity service returned ${result.detail}; the identity check is PENDING and the record is not verified.`,
            { reason: result.detail });
        }
      }
    } else if (!ctx.ruleset.mockIdentityCheckEnabled) {
      info.identity = { status: 'NOT_CHECKED', adapter: null };
    }

    // 2. Consistency with identities already in the register.
    const byCode = info.valid.studentCode ? ctx.studentsByCode.get(values.studentCode) : null;
    const byExternalId = info.valid.externalIdDemo ? ctx.studentsByExternalId.get(externalId) : null;
    if (byCode && byExternalId && byCode.studentRef !== byExternalId.studentRef) {
      add('L2_REGISTER_IDENTITY_CONFLICT', 'externalIdDemo',
        `Row ${row.rowNumber}: student code ${values.studentCode} and identifier ${maskIdentifier(externalId)} belong to different students in the register.`);
    } else if (byCode && info.valid.externalIdDemo && byCode.syntheticExternalId && byCode.syntheticExternalId !== externalId) {
      add('L2_REGISTER_IDENTITY_CONFLICT', 'externalIdDemo',
        `Row ${row.rowNumber}: student code ${values.studentCode} is already linked to identifier ${maskIdentifier(byCode.syntheticExternalId)} in the register.`);
    } else if (!byCode && byExternalId) {
      add('L2_REGISTER_IDENTITY_CONFLICT', 'studentCode',
        `Row ${row.rowNumber}: identifier ${maskIdentifier(externalId)} is already linked to a different student code in the register.`);
    }
    if (byCode && values.studentName && !sameName(byCode.displayName, values.studentName)) {
      add('L2_REGISTER_NAME_DIFFERS', 'studentName',
        `Row ${row.rowNumber}: the register already records a different name for ${values.studentCode}. The register name is kept unless a correction request is approved.`);
    }
    info.registerStudent = byCode || byExternalId || null;
  }
  return issues;
}

module.exports = { runL2 };
