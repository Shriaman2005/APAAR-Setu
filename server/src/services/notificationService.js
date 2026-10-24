// In-app notifications. Messages must stay free of secrets and full identifiers.
const { Notification, User } = require('../models');
const { ROLES, USER_STATUS } = require('../config/constants');
const { readPagination, pageResult } = require('../utils/pagination');
const { notFound } = require('../utils/AppError');
const logger = require('../utils/logger');

async function notifyUsers(userIds, notification, options = {}) {
  const unique = [...new Set(userIds.map(String))];
  if (unique.length === 0) return 0;
  const docs = unique.map((recipientUserId) => ({
    recipientUserId,
    type: notification.type,
    safeMessage: notification.message.slice(0, 300),
    relatedEntityType: notification.entityType,
    relatedEntityRef: notification.entityRef,
    link: notification.link,
  }));
  await Notification.insertMany(docs, options.session ? { session: options.session } : {});
  return docs.length;
}

async function activeUserIds(filter, session) {
  const query = User.find({ ...filter, status: USER_STATUS.ACTIVE }, { _id: 1 }).lean();
  if (session) query.session(session);
  const users = await query;
  return users.map((user) => user._id);
}

async function notifyInstitutionRoles(institutionId, roles, notification, options = {}) {
  const ids = await activeUserIds({ institutionId, role: { $in: roles } }, options.session);
  return notifyUsers(ids, notification, options);
}

async function notifyRegionalOfficers(regionIds, notification, options = {}) {
  const ids = await activeUserIds(
    { role: ROLES.AICTE_REGIONAL_OFFICER, regionIds: { $in: regionIds } },
    options.session
  );
  return notifyUsers(ids, notification, options);
}

async function notifyNationalOfficers(notification, options = {}) {
  const ids = await activeUserIds({ role: ROLES.AICTE_NATIONAL_OFFICER }, options.session);
  return notifyUsers(ids, notification, options);
}

async function notifyStudent(studentRef, notification, options = {}) {
  const ids = await activeUserIds({ role: ROLES.STUDENT, studentRef }, options.session);
  return notifyUsers(ids, notification, options);
}

async function notifyOrganisationUsers(organisationId, role, notification, options = {}) {
  const ids = await activeUserIds({ role, organisationId }, options.session);
  return notifyUsers(ids, notification, options);
}

// Notifications are helpful but not critical: a failure is logged instead of failing the action.
async function safely(promise, context) {
  try {
    return await promise;
  } catch (error) {
    logger.warn('Notification could not be created', { context, reason: error.message });
    return 0;
  }
}

async function listForUser(user, query) {
  const pagination = readPagination(query);
  const filter = { recipientUserId: user.id };
  if (query.unread === 'true') filter.readAt = null;
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipientUserId: user.id, readAt: null }),
  ]);
  return { ...pageResult(items, total, pagination), unreadCount };
}

async function markRead(user, notificationId) {
  const result = await Notification.updateOne(
    { _id: notificationId, recipientUserId: user.id },
    { $set: { readAt: new Date() } }
  );
  if (result.matchedCount === 0) throw notFound('Notification not found.');
}

async function markAllRead(user) {
  const result = await Notification.updateMany({ recipientUserId: user.id, readAt: null }, { $set: { readAt: new Date() } });
  return result.modifiedCount;
}

module.exports = {
  notifyUsers,
  notifyInstitutionRoles,
  notifyRegionalOfficers,
  notifyNationalOfficers,
  notifyStudent,
  notifyOrganisationUsers,
  safely,
  listForUser,
  markRead,
  markAllRead,
};
