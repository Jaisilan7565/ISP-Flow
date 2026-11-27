/**
 * Real-time sync (Socket.io). Every signed-in browser joins its company's room; whenever a change is recorded
 * (activity log) the room gets a `changed` event and the app refreshes its data — so Billing sees a site go live,
 * or a manager sees a field engineer's survey, without reloading.
 * Events are emitted only after the database transaction commits.
 */
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const env = require('../config/env');
const logger = require('../utils/logger');

let io = null;
const room = (tenantId) => (tenantId ? `tenant:${tenantId}` : 'platform');

const init = (httpServer) => {
  io = new Server(httpServer, { path: '/socket.io', cors: { origin: env.clientUrl, credentials: true } });

  // Same JWT + account checks as the REST API
  io.use(async (socket, next) => {
    try {
      const claims = jwt.verify(socket.handshake.auth?.token || '', env.jwtSecret);
      const { User, Tenant } = require('../models');
      const u = await User.findByPk(claims.sub, { attributes: ['id', 'tenantId', 'role', 'isActive'], include: [{ model: Tenant, as: 'tenant', attributes: ['status'] }] });
      if (!u || !u.isActive || (u.tenantId && u.tenant?.status !== 'ACTIVE')) return next(new Error('unauthorized'));
      socket.data.user = { id: u.id, tenantId: u.tenantId, role: u.role };
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(room(socket.data.user.tenantId));
  });
  logger.info('Real-time sync (Socket.io) ready on /socket.io');
  return io;
};

/** Tell every open screen of the company that something changed */
const notify = (tenantId, payload) => {
  if (!io) return;
  io.to(room(tenantId)).emit('changed', { ...payload, at: Date.now() });
  if (payload.entityType === 'TENANT') io.to('platform').emit('changed', { ...payload, at: Date.now() });
};

module.exports = { init, notify };
