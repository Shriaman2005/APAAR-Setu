const mongoose = require('mongoose');

const institutionSchema = new mongoose.Schema(
  {
    institutionCode: { type: String, required: true, unique: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    stateCode: { type: String, required: true, trim: true, maxlength: 20 },
    // Region linkage is authoritative for regional-officer scope filtering.
    regionId: { type: String, required: true, trim: true, index: true },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    isDemo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Institution', institutionSchema);
