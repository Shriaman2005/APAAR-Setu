// Verification requests, consent, student self-service, correction requests and credentials.
const express = require('express');
const people = require('../controllers/peopleController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const schemas = require('../validators/schemas');
const { ROLES } = require('../config/constants');

const VERIFIER = requireRole(ROLES.VERIFIER);
const STUDENT = requireRole(ROLES.STUDENT);
const ISSUER = requireRole(ROLES.DEGREE_AWARDING_BODY);

module.exports = function peopleRoutes({ limiters }) {
  const router = express.Router();

  // Public minimal QR status endpoint (no login, rate-limited, no open student search).
  router.get('/verify/:credentialRef', limiters.publicVerify, people.publicVerify);

  // Mounted at /api, so every route below carries its own role check (which also handles 401).
  router.get('/verification-requests/options', VERIFIER, people.verificationOptions);
  router.get('/verification-requests', VERIFIER, people.listVerificationRequests);
  router.post('/verification-requests', VERIFIER, limiters.verificationRequests, validateBody(schemas.verificationRequest), people.createVerificationRequest);
  router.get('/verification-requests/:id', requireRole(ROLES.VERIFIER, ROLES.STUDENT), people.getVerificationRequest);
  router.get('/verification-requests/:id/result', VERIFIER, people.getVerificationResult);
  router.post('/verification-requests/:id/cancel', VERIFIER, people.cancelVerificationRequest);
  router.get('/verifier/organisation', VERIFIER, people.getVerifierOrganisation);
  router.post('/verifier/organisation', VERIFIER, validateBody(schemas.verifierOrganisation), people.submitVerifierOrganisation);

  router.get('/consents', STUDENT, people.listConsents);
  router.post('/consents/:id/approve', STUDENT, validateBody(schemas.consentApprove), people.approveConsent);
  router.post('/consents/:id/deny', STUDENT, validateBody(schemas.consentDecision), people.denyConsent);
  router.post('/consents/:id/revoke', STUDENT, validateBody(schemas.consentDecision), people.revokeConsent);

  router.get('/students/me', STUDENT, people.myRecord);
  router.patch('/students/me', requireAuth, people.editOwnRecordDirectly);
  router.get('/students/me/access-log', STUDENT, people.myAccessLog);
  router.get('/students/me/credentials', STUDENT, people.myCredentials);
  router.post('/students/me/credential-requests', STUDENT, validateBody(schemas.credentialRequest), people.requestCredential);
  router.get('/students/me/correction-requests', STUDENT, people.myCorrections);
  router.post('/students/me/correction-requests', STUDENT, validateBody(schemas.correctionRequest), people.submitCorrection);

  router.get('/correction-requests', requireRole(ROLES.COLLEGE_OPERATOR, ROLES.COLLEGE_HEAD), people.listInstitutionCorrections);
  router.post('/correction-requests/:id/decision', requireRole(ROLES.COLLEGE_HEAD), validateBody(schemas.correctionDecision), people.decideCorrection);

  router.get('/issuer/eligible-students', ISSUER, people.eligibleStudents);
  router.get('/issuer/enrolments/:enrolmentRef', ISSUER, people.issuerEnrolment);
  router.post('/credentials', ISSUER, validateBody(schemas.issueCredential), people.issueCredential);
  router.get('/credentials', ISSUER, people.listCredentials);
  router.get('/credentials/export.csv', ISSUER, people.exportCredentials);
  router.get('/credentials/:ref', requireRole(ROLES.DEGREE_AWARDING_BODY, ROLES.STUDENT), people.getCredential);
  router.get('/credentials/:ref/qr.png', requireRole(ROLES.DEGREE_AWARDING_BODY, ROLES.STUDENT), people.credentialQr);
  router.post('/credentials/:ref/revoke', ISSUER, validateBody(schemas.revokeCredential), people.revokeCredential);
  return router;
};
