const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const routes = require('./routes');
const errorHandler = require('./middlewares/error.middleware');
const logger = require('./utils/logger');

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({ origin: env.clientUrl, credentials: true }));
// Excel imports send up to 2000 sites / ISPs in one request; everything else stays at 1 MB
app.use(['/api/v1/orders/import', '/api/v1/admin/vendors/import'], express.json({ limit: '10mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

if (env.nodeEnv !== 'test') {
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev', { stream: { write: (message) => logger.info(message.trim()) } }));
}

app.use('/api/v1', routes);

// API documentation (Swagger UI), generated from the routes and their Joi schemas
const swaggerUi = require('swagger-ui-express');
const { buildSpec } = require('./docs/openapi');
const openapi = buildSpec(routes.MOUNTS);
app.get('/api/docs.json', (req, res) => res.json(openapi));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'ISP-Flow API', swaggerOptions: { persistAuthorization: true, docExpansion: 'none' } }));

app.use((req, res) => {
  res.status(404).json({ success: false, statusCode: 404, message: `Endpoint ${req.originalUrl} not found` });
});

app.use(errorHandler);

module.exports = app;
