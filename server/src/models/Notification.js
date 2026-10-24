// In-app notification (demo notification UI). Text must never contain secrets or full identifiers.
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    safeMessage: { type: String, required: true, maxlength: 300 },
    relatedEntityType: String,
    relatedEntityRef: String,
    link: String, // client route to open, e.g. /college/batches/BATCH-...
    readAt: Date,
  },
  { timestamps: true }
);

notificationSchema.index({ recipientUserId: 1, readAt: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
