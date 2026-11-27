/**
 * OpenAPI 3 document generated from the live Express routers:
 *   paths & methods  ← router stacks (src/routes/index.js MOUNTS)
 *   request bodies   ← the Joi schema of each route's validate() middleware (same rules the API enforces)
 *   permissions      ← requirePerm(...) on the route
 * Served by Swagger UI at /api/docs (JSON at /api/docs.json). Nothing here is hand-maintained, so it cannot drift.
 */
const j2s = require('joi-to-swagger');
const pkg = require('../../package.json');

const PUBLIC = new Set(['POST /api/v1/auth/login', 'GET /api/v1/health']);

const envelope = (data = {}) => ({
  type: 'object',
  properties: { success: { type: 'boolean' }, statusCode: { type: 'integer' }, message: { type: 'string' }, data, meta: { type: 'object' } }
});
const errorBody = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: false }, statusCode: { type: 'integer' }, message: { type: 'string' },
    errors: { type: 'array', nullable: true, items: { type: 'object', properties: { field: { type: 'string', example: 'gstin' }, message: { type: 'string' } } } }
  }
};
const RESPONSES = {
  400: { description: 'Invalid input — one message per field in `errors`', content: { 'application/json': { schema: errorBody } } },
  401: { description: 'Not signed in, or session expired' },
  403: { description: 'Role not allowed, not the owner, or company suspended' },
  404: { description: 'Record not found in your company' },
  409: { description: 'Not allowed in the record\'s current state, or duplicate' }
};

const toSchema = (joi) => {
  try { return j2s(joi).swagger; } catch { return { type: 'object' }; }
};

const buildSpec = (mounts) => {
  const paths = {};
  const add = (path, method, op) => { (paths[path] ||= {})[method] = op; };

  for (const [base, router, tag] of mounts) {
    const routerPerms = router.stack.filter((l) => !l.route && l.handle?.perms).flatMap((l) => l.handle.perms);
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const handlers = layer.route.stack.map((l) => l.handle);
      const rawPath = `/api/v1${base}${layer.route.path === '/' ? '' : layer.route.path}`;
      const path = rawPath.replace(/:(\w+)/g, '{$1}');
      const params = [...rawPath.matchAll(/:(\w+)/g)].map(([, name]) => ({ name, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }));
      const v = handlers.find((h) => h.schema);
      const perms = [...routerPerms, ...handlers.flatMap((h) => h.perms || [])];

      for (const method of Object.keys(layer.route.methods)) {
        const key = `${method.toUpperCase()} ${rawPath}`;
        const op = {
          tags: [tag],
          summary: `${method.toUpperCase()} ${base}${layer.route.path}`,
          description: perms.length ? `Requires permission: ${[...new Set(perms)].join(' or ')}` : undefined,
          parameters: [...params],
          responses: { [method === 'post' ? '200/201' : '200']: undefined, 200: { description: 'OK', content: { 'application/json': { schema: envelope() } } }, ...RESPONSES }
        };
        delete op.responses['200/201'];
        if (method === 'post') op.responses[201] = { description: 'Created', content: { 'application/json': { schema: envelope() } } };
        if (!PUBLIC.has(key)) op.security = [{ bearerAuth: [] }];
        if (v?.source === 'query') {
          const s = toSchema(v.schema);
          for (const [name, schema] of Object.entries(s.properties || {})) op.parameters.push({ name, in: 'query', required: (s.required || []).includes(name), schema });
        } else if (v?.source === 'multipart') {
          const s = toSchema(v.schema);
          if (s.properties?.file) s.properties.file = { type: 'string', format: 'binary' };
          op.requestBody = { required: true, content: { 'multipart/form-data': { schema: s } } };
        } else if (v) {
          op.requestBody = { required: true, content: { 'application/json': { schema: toSchema(v.schema) } } };
        }
        if (!op.parameters.length) delete op.parameters;
        add(path, method, op);
      }
    }
  }

  add('/api/v1/health', 'get', {
    tags: ['System'], summary: 'Health check (API + database)',
    responses: { 200: { description: 'API and database are up' }, 503: { description: 'Database is down' } }
  });

  return {
    openapi: '3.0.3',
    info: {
      title: 'ISP-Flow API',
      version: pkg.version || '1.0.0',
      description: 'REST API for ISP-Flow: client orders → feasibility → quote & budget → implementation → billing → payment waterfall.\n\n'
        + 'Sign in with **POST /api/v1/auth/login**, copy `data.token`, then click **Authorize** and paste it.\n\n'
        + 'Every request body is validated with Joi; invalid input returns **400** with one message per field in `errors`. '
        + 'All responses use the envelope `{ success, statusCode, message, data }`.'
    },
    servers: [{ url: '/' }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    paths
  };
};

module.exports = { buildSpec };
