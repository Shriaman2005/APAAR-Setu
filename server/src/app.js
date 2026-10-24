// Builds the Express application. It does not open a port or connect to MongoDB itself, so tests
// can create an app against a test database (see tests/helpers/testApp.js).
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const mongoose = require('mongoose');

const { loadCurrentUser } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { createRateLimiters } = require('./middleware/rateLimiters');
const { createCsvUpload } = require('./middleware/upload');
const { requestLogger } = require('./middleware/requestLogger');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { buildApiRouter } = require('./routes');

function createApp(config) {
  const app = express();
  app.locals.config = config;
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', 'blob:'],
        'upgrade-insecure-requests': config.isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(requestLogger(config.logRequests));

  // CORS is only needed when the React app is served from a different origin than the API.
  // Never use a wildcard origin together with credentials (cookies).
  app.use('/api', cors({ origin: [config.clientOrigin], credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  app.use(session({
    name: config.sessionCookieName,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true, // idle timeout: the expiry moves forward while the user is active
    store: MongoStore.create({
      client: mongoose.connection.getClient(),
      collectionName: 'sessions',
      ttl: Math.ceil(config.sessionMaxAgeMs / 1000),
      stringify: false,
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: config.sessionMaxAgeMs,
      path: '/',
    },
  }));

  app.use(loadCurrentUser);
  app.use('/api', csrfProtection);

  const deps = {
    limiters: createRateLimiters(config.rateLimits),
    csvUpload: createCsvUpload(config.maxUploadMb),
  };
  app.use('/api', buildApiRouter(deps));
  app.use('/api', notFoundHandler);

  // Production: serve the built React app from the same origin (no CORS needed).
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (config.serveClient && fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
