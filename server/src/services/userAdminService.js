// User and organisation administration (AICTE_SYSTEM_ADMIN only; checked by route middleware too).
const mongoose = require('mongoose');
const { User, Institution, Region, Organisation, Student } = require('../models');
const { ROLES, ALL_ROLES, USER_STATUS, ORG_TYPES, ORG_STATUS } = require('../config/constants');
const { notFound, conflict, unprocessable } = require('../utils/AppError');
const { readPagination, pageResult, escapeRegex, readSearch } = require('../utils/pagination');
const { newOneTimeToken, randomCode } = require('../utils/ids');
const { sha256Hex } = require('../utils/hash');
const { normaliseEmail } = require('./authService');
const { recordAudit } = require('./auditService');
const notifications = require('./notificationService');

const ACTIVATION_HOURS = 72;
const RESET_HOURS = 24;

// Which scope fields each role needs (spec 03 section 3).
const SCOPE_RULES = {
  COLLEGE_OPERATOR: { institution: 'required' },
  COLLEGE_HEAD: { institution: 'required' },
  AICTE_REGIONAL_OFFICER: { regions: 'required' },
  AICTE_NATIONAL_OFFICER: {},
  AICTE_SYSTEM_ADMIN: {},
  DEGREE_AWARDING_BODY: { organisation: 'required', organisationType: ORG_TYPES.ISSUER },
  VERIFIER: { organisation: 'optional', organisationType: ORG_TYPES.VERIFIER },
  STUDENT: { student: 'required' },
};

function presentUser(user, lookups = {}) {
  return {
    id: String(user._id),
    email: user.emailNormalized,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    institutionCode: user.institutionId ? lookups.institutions?.get(String(user.institutionId)) || null : null,
    institutionId: user.institutionId ? String(user.institutionId) : null,
    regionIds: user.regionIds || [],
    organisationCode: user.organisationId ? lookups.organisations?.get(String(user.organisationId)) || null : null,
    organisationId: user.organisationId ? String(user.organisationId) : null,
    hasStudentLink: Boolean(user.studentRef),
    disabledReason: user.disabledReason || null,
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt,
    isDemo: user.isDemo,
  };
}

async function lookupMaps(users) {
  const [institutions, organisations] = await Promise.all([
    Institution.find({ _id: { $in: users.map((u) => u.institutionId).filter(Boolean) } }, { institutionCode: 1 }).lean(),
    Organisation.find({ _id: { $in: users.map((u) => u.organisationId).filter(Boolean) } }, { orgCode: 1 }).lean(),
  ]);
  return {
    institutions: new Map(institutions.map((item) => [String(item._id), item.institutionCode])),
    organisations: new Map(organisations.map((item) => [String(item._id), item.orgCode])),
  };
}

async function listUsers(query) {
  const filter = {};
  if (ALL_ROLES.includes(query.role)) filter.role = query.role;
  if (Object.values(USER_STATUS).includes(query.status)) filter.status = query.status;
  const search = readSearch(query);
  if (search) filter.$or = [{ emailNormalized: { $regex: escapeRegex(search.toLowerCase()) } }, { displayName: { $regex: escapeRegex(search), $options: 'i' } }];
  const pagination = readPagination(query);
  const [items, total] = await Promise.all([
    User.find(filter).sort({ role: 1, emailNormalized: 1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    User.countDocuments(filter),
  ]);
  const lookups = await lookupMaps(items);
  return pageResult(items.map((user) => presentUser(user, lookups)), total, pagination);
}

async function getUser(id) {
  if (!mongoose.isValidObjectId(id)) throw notFound('User not found.');
  const user = await User.findById(id).lean();
  if (!user) throw notFound('User not found.');
  return presentUser(user, await lookupMaps([user]));
}

/**
 * Validates role-specific scope fields and returns the values to store.
 * Fields that do not belong to the role are rejected rather than silently ignored.
 */
async function resolveScope(role, input) {
  const rules = SCOPE_RULES[role];
  const scope = { institutionId: undefined, regionIds: [], organisationId: undefined, studentRef: undefined };
  const fieldErrors = {};

  if (rules.institution) {
    if (!input.institutionId || !mongoose.isValidObjectId(input.institutionId)) fieldErrors.institutionId = ['Choose an institution.'];
    else {
      const institution = await Institution.findById(input.institutionId).lean();
      if (!institution || institution.status !== 'ACTIVE') fieldErrors.institutionId = ['Institution not found or inactive.'];
      else scope.institutionId = institution._id;
    }
  } else if (input.institutionId) fieldErrors.institutionId = ['This role is not scoped to an institution.'];

  if (rules.regions) {
    const regionIds = [...new Set(input.regionIds || [])];
    if (regionIds.length === 0) fieldErrors.regionIds = ['Choose at least one region.'];
    else {
      const found = await Region.countDocuments({ regionId: { $in: regionIds } });
      if (found !== regionIds.length) fieldErrors.regionIds = ['One or more regions do not exist.'];
      else scope.regionIds = regionIds;
    }
  } else if (input.regionIds && input.regionIds.length > 0) fieldErrors.regionIds = ['This role is not scoped to regions.'];

  if (rules.organisation) {
    if (!input.organisationId) {
      if (rules.organisation === 'required') fieldErrors.organisationId = ['Choose an organisation.'];
    } else if (!mongoose.isValidObjectId(input.organisationId)) fieldErrors.organisationId = ['Organisation not found.'];
    else {
      const organisation = await Organisation.findById(input.organisationId).lean();
      if (!organisation || organisation.type !== rules.organisationType) fieldErrors.organisationId = [`Choose a ${rules.organisationType.toLowerCase()} organisation.`];
      else scope.organisationId = organisation._id;
    }
  } else if (input.organisationId) fieldErrors.organisationId = ['This role is not linked to an organisation.'];

  if (rules.student) {
    const code = String(input.studentCode || '').trim().toUpperCase();
    const student = code ? await Student.findOne({ studentCode: code }, { studentRef: 1 }).lean() : null;
    if (!student) fieldErrors.studentCode = ['No student with this code exists in the register.'];
    else {
      const linked = await User.exists({ studentRef: student.studentRef });
      if (linked) fieldErrors.studentCode = ['This student already has a login account.'];
      else scope.studentRef = student.studentRef;
    }
  } else if (input.studentCode) fieldErrors.studentCode = ['Only student accounts link to a student record.'];

  if (Object.keys(fieldErrors).length > 0) throw unprocessable('SCOPE_INVALID', 'Some scope fields are invalid for this role.', { fieldErrors });
  return scope;
}

function issueToken(purpose, hours, adminId) {
  const token = newOneTimeToken();
  return {
    token,
    stored: { tokenHash: sha256Hex(token), purpose, expiresAt: new Date(Date.now() + hours * 3600 * 1000), createdBy: adminId },
  };
}

async function createUser(admin, body, config) {
  if (!ALL_ROLES.includes(body.role)) throw unprocessable('ROLE_NOT_ALLOWED', 'Choose a role from the allowed list.');
  const emailNormalized = normaliseEmail(body.email);
  if (await User.exists({ emailNormalized })) throw conflict('EMAIL_IN_USE', 'An account with this email already exists.');
  const scope = await resolveScope(body.role, body);
  const { token, stored } = issueToken('ACTIVATION', ACTIVATION_HOURS, admin.id);
  const user = await User.create({
    emailNormalized,
    displayName: body.displayName,
    role: body.role,
    status: USER_STATUS.PENDING_ACTIVATION,
    ...scope,
    oneTimeToken: stored,
    createdBy: admin.id,
  });
  await recordAudit({
    actor: admin, action: 'USER_CREATED', entityType: 'User', entityRef: String(user._id),
    institutionId: scope.institutionId, regionIds: scope.regionIds,
    payload: { role: body.role, status: USER_STATUS.PENDING_ACTIVATION },
  });
  return {
    user: await getUser(user._id),
    // Shown ONCE to the administrator. There is no email service in this prototype.
    activationLink: `${config.clientOrigin}/set-password?token=${encodeURIComponent(token)}`,
    activationExpiresAt: stored.expiresAt,
    deliveryNote: 'Prototype: no email is sent. Share this one-time link with the user through a trusted channel. It is not shown again.',
  };
}

async function updateUser(admin, id, body) {
  if (body.role !== undefined) throw unprocessable('ROLE_CHANGE_NOT_ALLOWED', 'Roles cannot be changed. Disable this account and create a new one with the correct role.');
  if (!mongoose.isValidObjectId(id)) throw notFound('User not found.');
  const user = await User.findById(id).lean();
  if (!user) throw notFound('User not found.');
  const update = {};
  if (body.displayName !== undefined) update.displayName = body.displayName;
  const scopeKeys = ['institutionId', 'regionIds', 'organisationId'];
  if (scopeKeys.some((key) => body[key] !== undefined)) {
    if (String(user._id) === String(admin.id)) throw unprocessable('SELF_SCOPE_CHANGE', 'You cannot change your own scope.');
    const merged = {
      institutionId: body.institutionId !== undefined ? body.institutionId : user.institutionId && String(user.institutionId),
      regionIds: body.regionIds !== undefined ? body.regionIds : user.regionIds,
      organisationId: body.organisationId !== undefined ? body.organisationId : user.organisationId && String(user.organisationId),
    };
    const scope = await resolveScope(user.role, { ...merged, studentCode: undefined });
    update.institutionId = scope.institutionId;
    update.regionIds = scope.regionIds;
    update.organisationId = scope.organisationId;
  }
  if (Object.keys(update).length === 0) throw unprocessable('NO_CHANGES', 'Nothing to update.');
  await User.updateOne({ _id: user._id }, { $set: update });
  await recordAudit({ actor: admin, action: 'USER_UPDATED', entityType: 'User', entityRef: String(user._id), payload: { fields: Object.keys(update) } });
  return getUser(user._id);
}

async function setUserEnabled(admin, id, enabled, reason) {
  if (!mongoose.isValidObjectId(id)) throw notFound('User not found.');
  if (String(id) === String(admin.id)) throw unprocessable('CANNOT_CHANGE_SELF', 'You cannot disable or re-enable your own account.');
  const user = await User.findById(id).select('+passwordHash').lean();
  if (!user) throw notFound('User not found.');
  if (enabled && user.status !== USER_STATUS.DISABLED) throw conflict('NOT_DISABLED', 'This account is not disabled.');
  if (!enabled && user.status === USER_STATUS.DISABLED) throw conflict('ALREADY_DISABLED', 'This account is already disabled.');
  const status = enabled ? (user.passwordHash ? USER_STATUS.ACTIVE : USER_STATUS.PENDING_ACTIVATION) : USER_STATUS.DISABLED;
  await User.updateOne(
    { _id: user._id },
    enabled
      ? { $set: { status }, $unset: { disabledReason: 1 } }
      // Bumping sessionVersion ends every existing session of the disabled user immediately.
      : { $set: { status, disabledReason: reason }, $inc: { sessionVersion: 1 } }
  );
  await recordAudit({ actor: admin, action: enabled ? 'USER_ENABLED' : 'USER_DISABLED', entityType: 'User', entityRef: String(user._id), reason });
  return getUser(user._id);
}

async function initiatePasswordReset(admin, id, config) {
  if (!mongoose.isValidObjectId(id)) throw notFound('User not found.');
  if (String(id) === String(admin.id)) throw unprocessable('USE_CHANGE_PASSWORD', 'Use "Change password" for your own account.');
  const user = await User.findById(id).lean();
  if (!user) throw notFound('User not found.');
  if (user.status === USER_STATUS.DISABLED) throw conflict('USER_DISABLED', 'Re-enable the account before resetting its password.');
  const { token, stored } = issueToken(user.status === USER_STATUS.PENDING_ACTIVATION ? 'ACTIVATION' : 'PASSWORD_RESET', RESET_HOURS, admin.id);
  // The old password stops working and all sessions end; the existing password is never revealed.
  await User.updateOne({ _id: user._id }, { $set: { oneTimeToken: stored }, $unset: { passwordHash: 1 }, $inc: { sessionVersion: 1 } });
  await recordAudit({ actor: admin, action: 'USER_PASSWORD_RESET_INITIATED', entityType: 'User', entityRef: String(user._id) });
  return {
    resetLink: `${config.clientOrigin}/set-password?token=${encodeURIComponent(token)}`,
    expiresAt: stored.expiresAt,
    deliveryNote: 'Prototype: no email is sent. Share this one-time link through a trusted channel. It is not shown again.',
  };
}

async function referenceData() {
  const [regions, institutions, organisations] = await Promise.all([
    Region.find({}, { regionId: 1, name: 1 }).sort({ regionId: 1 }).lean(),
    Institution.find({}, { institutionCode: 1, name: 1, regionId: 1, status: 1 }).sort({ institutionCode: 1 }).lean(),
    Organisation.find({}, { orgCode: 1, name: 1, type: 1, status: 1 }).sort({ orgCode: 1 }).lean(),
  ]);
  return {
    roles: ALL_ROLES.map((role) => ({ role, scope: SCOPE_RULES[role] })),
    regions: regions.map((r) => ({ regionId: r.regionId, name: r.name })),
    institutions: institutions.map((i) => ({ id: String(i._id), code: i.institutionCode, name: i.name, regionId: i.regionId, status: i.status })),
    organisations: organisations.map((o) => ({ id: String(o._id), code: o.orgCode, name: o.name, type: o.type, status: o.status })),
  };
}

// --- Organisations ----------------------------------------------------------------------------
async function listOrganisations(query) {
  const filter = {};
  if (Object.values(ORG_TYPES).includes(query.type)) filter.type = query.type;
  if (Object.values(ORG_STATUS).includes(query.status)) filter.status = query.status;
  const items = await Organisation.find(filter).sort({ status: 1, orgCode: 1 }).limit(200).lean();
  return items.map((org) => ({
    id: String(org._id), code: org.orgCode, name: org.name, type: org.type, status: org.status,
    verifierCategory: org.verifierCategory || null, description: org.description || null,
    affiliatedInstitutions: (org.affiliatedInstitutionIds || []).length, decision: org.decision?.at ? { at: org.decision.at, reason: org.decision.reason } : null,
    createdAt: org.createdAt, isDemo: org.isDemo,
  }));
}

async function decideOrganisation(admin, id, approve, reason) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Organisation not found.');
  const updated = await Organisation.findOneAndUpdate(
    { _id: id, status: ORG_STATUS.PENDING },
    { $set: { status: approve ? ORG_STATUS.APPROVED : ORG_STATUS.REJECTED, decision: { by: admin.id, at: new Date(), reason } } },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) throw conflict('ORG_NOT_PENDING', 'Only a pending organisation can be approved or rejected.');
  await recordAudit({ actor: admin, action: approve ? 'ORG_APPROVED' : 'ORG_REJECTED', entityType: 'Organisation', entityRef: updated.orgCode, reason });
  await notifications.safely(notifications.notifyOrganisationUsers(updated._id, ROLES.VERIFIER, {
    type: 'ORG_DECISION', message: `Your organisation registration was ${approve ? 'approved' : 'rejected'} (prototype workflow, no real KYC).`,
    entityType: 'Organisation', entityRef: updated.orgCode, link: '/verifier/onboarding',
  }), 'org-decision');
  return { id: String(updated._id), code: updated.orgCode, status: updated.status };
}

// Verifier self-onboarding (prototype: no real KYC; an administrator approves).
async function submitVerifierOrganisation(user, body) {
  const current = await User.findById(user.id).lean();
  if (current.organisationId) throw conflict('ORG_ALREADY_LINKED', 'Your account is already linked to an organisation.');
  const organisation = await Organisation.create({
    orgCode: `VER-${randomCode(6)}`,
    name: body.name,
    type: ORG_TYPES.VERIFIER,
    status: ORG_STATUS.PENDING,
    verifierCategory: body.verifierCategory,
    description: body.description || '',
    submittedBy: user.id,
    isDemo: true,
  });
  await User.updateOne({ _id: user.id }, { $set: { organisationId: organisation._id } });
  await recordAudit({ actor: user, action: 'ORG_SUBMITTED', entityType: 'Organisation', entityRef: organisation.orgCode });
  const admins = await User.find({ role: ROLES.AICTE_SYSTEM_ADMIN, status: USER_STATUS.ACTIVE }, { _id: 1 }).lean();
  await notifications.safely(notifications.notifyUsers(admins.map((a) => a._id), {
    type: 'ORG_PENDING', message: `Verifier organisation "${organisation.name}" is awaiting approval.`, entityType: 'Organisation', entityRef: organisation.orgCode, link: '/admin/organisations',
  }), 'org-submit');
  return { id: String(organisation._id), code: organisation.orgCode, name: organisation.name, status: organisation.status };
}

async function getOwnOrganisation(user) {
  const current = await User.findById(user.id, { organisationId: 1 }).lean();
  if (!current.organisationId) return null;
  const org = await Organisation.findById(current.organisationId).lean();
  return org ? { id: String(org._id), code: org.orgCode, name: org.name, type: org.type, status: org.status, verifierCategory: org.verifierCategory, decision: org.decision?.at ? { at: org.decision.at, reason: org.decision.reason } : null } : null;
}

module.exports = {
  SCOPE_RULES, listUsers, getUser, createUser, updateUser, setUserEnabled, initiatePasswordReset, referenceData,
  listOrganisations, decideOrganisation, submitVerifierOrganisation, getOwnOrganisation,
};
