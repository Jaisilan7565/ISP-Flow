/**
 * Documents — PO copy, AT sign-off, stamped bill / courier receipt, survey photos, etc.
 */
const router = require('express').Router();
const Joi = require('joi');
const { R, guardIds } = require('../../validation/rules');
const fs = require('fs');
const path = require('path');
const db = require('../../config/db');
const ApiError = require('../../utils/apiError');
const { ah } = require('../../utils/helpers');
const { sendSuccess } = require('../../utils/response');
const { authenticate, requireTenant } = require('../../middlewares/auth.middleware');
const { upload, uploadRoot } = require('../../middlewares/upload.middleware');
const { can } = require('../../constants/roles');
const activity = require('../../utils/activity');
const { Document, toRow } = require('../../models');

router.use(authenticate, requireTenant);

const ENTITY = {
  ORDER: { table: 'client_orders', label: 'code', view: 'orders.view', edit: ['orders.create'] },
  FEASIBILITY: { table: 'feasibility_requests', label: 'code', view: 'feasibility.view', edit: ['feasibility.create', 'feasibility.survey'] },
  QUOTE: { table: 'quotes', label: 'code', view: 'commercial.view', edit: ['commercial.manage'] },
  SITE: { table: 'sites', label: 'code', view: 'implementation.view', edit: ['implementation.manage', 'implementation.execute'] },
  INVOICE: { table: 'invoices', label: 'invoice_number', view: 'billing.view', edit: ['billing.manage'] },
  RECEIPT: { table: 'receipts', label: 'utr_ref', view: 'treasury.view', edit: ['treasury.manage', 'billing.manage'] },
  PAYOUT: { table: 'payouts', label: 'reference', view: 'treasury.view', edit: ['treasury.manage'] }
};
const DOC_TYPES = ['CLIENT_ORDER', 'PO_COPY', 'WORK_ORDER', 'AT_SIGNOFF', 'COMMISSIONING_REPORT', 'SURVEY_PHOTO', 'QUOTE_PDF', 'INVOICE_COPY', 'SUBMISSION_PROOF', 'COURIER_RECEIPT', 'PAYMENT_PROOF', 'OTHER'];

const findEntity = async (tenantId, type, id) => {
  const cfg = ENTITY[type];
  if (!cfg) throw ApiError.badRequest('Unknown record type');
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw ApiError.badRequest('Invalid record id');
  const row = await db.one(`SELECT id, ${cfg.label} AS label FROM ${cfg.table} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!row) throw ApiError.notFound('Record');
  return { cfg, row };
};

router.get('/', ah(async (req, res) => {
  const { entityType, entityId } = req.query;
  const { cfg } = await findEntity(req.tenantId, entityType, entityId);
  if (!can(req.user.role, cfg.view)) throw ApiError.forbidden();
  return sendSuccess(res, await db.many(
    `SELECT d.*, u.name AS uploaded_by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.tenant_id = $1 AND d.entity_type = $2 AND d.entity_id = $3 ORDER BY d.created_at DESC`, [req.tenantId, entityType, entityId]));
}));

const uploadSchema = Joi.object({
  entityType: Joi.string().valid(...Object.keys(ENTITY)).required(),
  entityId: R.uuid().required(),
  docType: Joi.string().valid(...DOC_TYPES).required()
});

router.post('/', upload.single('file'), Object.assign((req, res, next) => {
  // validate the multipart fields after multer; remove the stored file if they are invalid
  const { error, value } = uploadSchema.validate(req.body || {}, { abortEarly: false, stripUnknown: true });
  if (!error) { req.body = value; return next(); }
  if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
  const errors = error.details.map((d) => ({ field: d.path.join('.'), message: d.message.replace(/"/g, '') }));
  return next(ApiError.badRequest(errors.map((e) => e.message).join('; '), errors));
}, { schema: uploadSchema.keys({ file: Joi.any().meta({ swaggerType: 'file' }).description('PDF, image, Word, Excel or CSV, up to MAX_UPLOAD_MB') }), source: 'multipart' }), ah(async (req, res) => {
  const cleanup = () => req.file && fs.promises.unlink(req.file.path).catch(() => {});
  try {
    if (!req.file) throw ApiError.badRequest('Choose a file to upload');
    const { entityType, entityId, docType } = req.body;
    if (!DOC_TYPES.includes(docType)) throw ApiError.badRequest(`Document type must be one of ${DOC_TYPES.join(', ')}`);
    const { cfg, row } = await findEntity(req.tenantId, entityType, entityId);
    if (!cfg.edit.some((p) => can(req.user.role, p))) throw ApiError.forbidden();
    const doc = toRow(await Document.create({
      tenantId: req.tenantId, entityType, entityId, docType, fileName: req.file.originalname.slice(0, 255), storedName: req.file.filename,
      mimeType: req.file.mimetype, sizeBytes: req.file.size, uploadedBy: req.user.id
    }));
    await activity.log(null, { tenantId: req.tenantId, userId: req.user.id, entityType, entityId, action: 'DOC_UPLOADED', message: `${docType.replace(/_/g, ' ')} uploaded to ${row.label}: ${doc.file_name}` });
    return sendSuccess(res, doc, 'Document uploaded', 201);
  } catch (e) {
    cleanup();
    throw e;
  }
}));

router.get('/:id/download', ah(async (req, res) => {
  const doc = toRow(await Document.findOne({ where: { id: req.params.id, tenantId: req.tenantId } }));
  if (!doc) throw ApiError.notFound('Document');
  if (!can(req.user.role, ENTITY[doc.entity_type].view)) throw ApiError.forbidden();
  const file = path.join(uploadRoot, req.tenantId, doc.stored_name);
  if (!file.startsWith(uploadRoot) || !fs.existsSync(file)) throw ApiError.notFound('File');
  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(doc.file_name)}"`);
  return fs.createReadStream(file).pipe(res);
}));

router.delete('/:id', ah(async (req, res) => {
  const record = await Document.findOne({ where: { id: req.params.id, tenantId: req.tenantId } });
  if (!record) throw ApiError.notFound('Document');
  const doc = toRow(record);
  if (doc.uploaded_by !== req.user.id && !can(req.user.role, 'users.manage')) throw ApiError.forbidden('Only the uploader or company admin can delete');
  await record.destroy();
  fs.promises.unlink(path.join(uploadRoot, req.tenantId, doc.stored_name)).catch(() => {});
  await activity.log(null, { tenantId: req.tenantId, userId: req.user.id, entityType: doc.entity_type, entityId: doc.entity_id, action: 'DOC_DELETED', message: `Document ${doc.file_name} deleted` });
  return sendSuccess(res, { id: doc.id }, 'Document deleted');
}));

router.get('/types', (req, res) => sendSuccess(res, DOC_TYPES));

guardIds(router, ['id']);

module.exports = router;
