const ApiError = require('../utils/apiError');

/** validate(schema) — validates & replaces req.body (or req.query with source='query') */
const validate = (schema, source = 'body') => Object.assign((req, res, next) => {
  const { value, error } = schema.validate(req[source] || {}, { abortEarly: false, stripUnknown: true, convert: true });
  if (error) {
    const errors = error.details.map((d) => ({ field: d.path.join('.'), message: d.message.replace(/"/g, '') }));
    return next(ApiError.badRequest(errors.map((e) => e.message).join('; '), errors));
  }
  if (source === 'query') req.validQuery = value;
  else req[source] = value;
  return next();
}, { schema, source }); // schema/source are read by the OpenAPI generator (src/docs/openapi.js)

module.exports = validate;
