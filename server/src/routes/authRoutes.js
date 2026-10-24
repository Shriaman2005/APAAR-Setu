const express = require('express');
const auth = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const schemas = require('../validators/schemas');

module.exports = function authRoutes({ limiters }) {
  const router = express.Router();
  router.get('/csrf-token', auth.csrfToken);
  router.post('/login', limiters.login, validateBody(schemas.login), auth.login);
  router.post('/logout', auth.logout);
  router.get('/me', requireAuth, auth.me);
  router.post('/change-password', requireAuth, validateBody(schemas.changePassword), auth.changePassword);
  router.post('/set-password', limiters.setPassword, validateBody(schemas.setPassword), auth.setPassword);
  return router;
};
