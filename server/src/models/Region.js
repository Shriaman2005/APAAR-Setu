// Synthetic AICTE region. Added (not in spec 06's list) so region scopes can be allow-listed
// when an administrator assigns a regional officer.
const mongoose = require('mongoose');

const regionSchema = new mongoose.Schema(
  {
    regionId: { type: String, required: true, unique: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    stateCodes: { type: [String], default: [] },
    isDemo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Region', regionSchema);
