/**
 * Standardized API response formatters.
 */
exports.sendSuccess = (res, data, message = 'Success', statusCode = 200, meta = {}) => {
  return res.status(statusCode).json({
    success: true,
    statusCode,
    message,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta
    }
  });
};

exports.sendError = (res, message = 'Internal Server Error', statusCode = 500, errors = null) => {
  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    errors,
    meta: {
      timestamp: new Date().toISOString()
    }
  });
};
