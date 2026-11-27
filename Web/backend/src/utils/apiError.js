class ApiError extends Error {
  constructor(statusCode, message, errors = null) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg, errors) { return new ApiError(400, msg, errors); }
  static unauthorized(msg = 'Please sign in') { return new ApiError(401, msg); }
  static forbidden(msg = 'You do not have permission for this action') { return new ApiError(403, msg); }
  static notFound(what = 'Record') { return new ApiError(404, `${what} not found`); }
  static conflict(msg, errors) { return new ApiError(409, msg, errors); }
}

module.exports = ApiError;
