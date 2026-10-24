// Mounts every API router under /api.
const express = require('express');
const miscRoutes = require('./miscRoutes');
const authRoutes = require('./authRoutes');
const batchRoutes = require('./batchRoutes');
const adminRoutes = require('./adminRoutes');
const registerRoutes = require('./registerRoutes');
const peopleRoutes = require('./peopleRoutes');

function buildApiRouter(deps) {
  const api = express.Router();
  api.use(miscRoutes());
  api.use('/auth', authRoutes(deps));
  api.use('/batches', batchRoutes(deps));
  api.use('/admin', adminRoutes());
  api.use(registerRoutes());
  api.use(peopleRoutes(deps));
  return api;
}

module.exports = { buildApiRouter };
