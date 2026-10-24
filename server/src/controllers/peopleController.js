// Verifiers, consent, students, correction requests and credentials.
const verification = require('../services/verificationService');
const students = require('../services/studentService');
const credentials = require('../services/credentialService');
const { submitVerifierOrganisation, getOwnOrganisation } = require('../services/userAdminService');
const { toCsv, sendCsv } = require('../utils/csvExport');
const { forbidden } = require('../utils/AppError');

const config = (req) => req.app.locals.config;

module.exports = {
  // Verifier
  verificationOptions: async (_req, res) => res.json(verification.getOptions()),
  listVerificationRequests: async (req, res) => res.json(await verification.listForVerifier(req.user, req.query)),
  createVerificationRequest: async (req, res) => res.status(201).json(await verification.createRequest(req.user, req.validBody)),
  getVerificationRequest: async (req, res) => res.json(await verification.getRequest(req.user, req.params.id)),
  getVerificationResult: async (req, res) => res.json(await verification.getResult(req.user, req.params.id)),
  cancelVerificationRequest: async (req, res) => res.json(await verification.cancelRequest(req.user, req.params.id)),
  getVerifierOrganisation: async (req, res) => res.json({ organisation: await getOwnOrganisation(req.user) }),
  submitVerifierOrganisation: async (req, res) => res.status(201).json({ organisation: await submitVerifierOrganisation(req.user, req.validBody) }),

  // Student consent
  listConsents: async (req, res) => res.json(await verification.listConsents(req.user, req.query)),
  approveConsent: async (req, res) => res.json(await verification.approve(req.user, req.params.id, req.validBody)),
  denyConsent: async (req, res) => res.json(await verification.deny(req.user, req.params.id, req.validBody)),
  revokeConsent: async (req, res) => res.json(await verification.revoke(req.user, req.params.id, req.validBody)),

  // Student record
  myRecord: async (req, res) => res.json(await students.getMyRecord(req.user)),
  myAccessLog: async (req, res) => res.json(await verification.listAccessLog(req.user, req.query)),
  myCredentials: async (req, res) => res.json({ items: await credentials.listStudentCredentials(req.user, config(req)) }),
  requestCredential: async (req, res) => res.status(201).json(await credentials.requestCredential(req.user, req.validBody.enrolmentRef)),
  myCorrections: async (req, res) => res.json({ items: await students.listMyCorrections(req.user) }),
  submitCorrection: async (req, res) => res.status(201).json(await students.submitCorrection(req.user, req.validBody)),
  // spec 04: "Official record: Edit directly - direct mutation must return 403".
  editOwnRecordDirectly: async () => {
    throw forbidden('Students cannot edit the official record directly. Submit a correction request instead.', 'DIRECT_EDIT_FORBIDDEN');
  },

  // Institution correction review
  listInstitutionCorrections: async (req, res) => res.json(await students.listInstitutionCorrections(req.user, req.query)),
  decideCorrection: async (req, res) => res.json(await students.decideCorrection(req.user, req.params.id, req.validBody)),

  // Issuer and credentials
  eligibleStudents: async (req, res) => res.json(await credentials.searchEligible(req.user, req.query)),
  issuerEnrolment: async (req, res) => res.json(await credentials.getEnrolmentForIssuer(req.user, req.params.enrolmentRef)),
  issueCredential: async (req, res) => {
    const result = await credentials.issueCredential(req.user, req.validBody, config(req));
    res.status(result.idempotentReplay ? 200 : 201).json(result);
  },
  listCredentials: async (req, res) => res.json(await credentials.listIssuerCredentials(req.user, req.query)),
  exportCredentials: async (req, res) => {
    const rows = await credentials.exportIssuerCredentials(req.user);
    sendCsv(res, 'issued-credentials-DEMO.csv', toCsv(['credentialRef', 'credentialType', 'status', 'studentInitials', 'courseCode', 'academicYear', 'issuedAt', 'revokedAt'], rows));
  },
  getCredential: async (req, res) => res.json(await credentials.getCredential(req.user, req.params.ref, config(req))),
  credentialQr: async (req, res) => {
    const png = await credentials.credentialQrPng(req.user, req.params.ref, config(req));
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  },
  revokeCredential: async (req, res) => res.json(await credentials.revokeCredential(req.user, req.params.ref, req.validBody.reason)),

  // Public QR status (no login)
  publicVerify: async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await credentials.publicStatus(req.params.credentialRef, config(req)));
  },
};
