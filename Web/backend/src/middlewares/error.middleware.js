const logger = require('../utils/logger');
const { sendError } = require('../utils/response');

const PG_ERRORS = {
  '23505': [409, 'A record with the same value already exists'],
  '23503': [400, 'Linked record does not exist or is still in use'],
  '23514': [400, 'Value not allowed'],
  '22P02': [400, 'Invalid identifier or number format'],
  '23502': [400, 'A required value is missing']
};

const pgCode = (err) => (err.parent || err.original || err).code;

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let { statusCode, message, errors } = err;

  if (err.name === 'MulterError') {
    statusCode = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message;
  } else if (err.name === 'SequelizeValidationError') {
    // model-level validation (Sequelize) → 400 with one message per field
    statusCode = 400;
    errors = err.errors.map((e) => ({ field: e.path, message: e.message }));
    message = errors.map((e) => e.message).join('; ');
  } else if (pgCode(err) && PG_ERRORS[pgCode(err)]) {
    // PostgreSQL errors arrive directly (pg) or wrapped by Sequelize (err.parent / err.original)
    const code = pgCode(err);
    const detail = (err.parent || err.original || err).detail;
    [statusCode, message] = PG_ERRORS[code];
    if (code === '23505' && detail) message = `${message}: ${detail.replace(/^Key \((.*?)\)=\((.*?)\).*/, '$1 = $2')}`;
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Malformed JSON body';
  }

  if (!statusCode) {
    statusCode = 500;
    message = 'Internal Server Error';
  }

  if (statusCode >= 500) {
    logger.error(`${statusCode} ${req.method} ${req.originalUrl} - ${err.message}`, { stack: err.stack });
  }

  return sendError(res, message, statusCode, errors);
};

module.exports = errorHandler;
