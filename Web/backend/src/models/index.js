/**
 * Sequelize models — one per table (schema is owned by the migrations in src/database/migrations; models never sync).
 * Attributes are camelCase and map to snake_case columns (underscored: true).
 * Used for plain CRUD (users, clients, vendors, settings, companies, documents, activity log, auth);
 * workflow and reporting queries use parameterised SQL through the same Sequelize instance (src/config/db.js).
 */
const { DataTypes: T } = require('sequelize');
const { sequelize } = require('../config/database');

const id = () => ({ type: T.UUID, primaryKey: true, defaultValue: T.UUIDV4 });
const tenantId = () => ({ type: T.UUID, allowNull: false });
const money = () => ({ type: T.DECIMAL(14, 2), allowNull: false, defaultValue: 0 });
const moneyNull = () => ({ type: T.DECIMAL(14, 2) });
const str = (len = 255, opts = {}) => ({ type: T.STRING(len), ...opts });
const req = (type) => ({ type, allowNull: false });

/** define(name, table, attributes, { created, updated }) */
const define = (name, tableName, attributes, { created = true, updated = true, ...opts } = {}) =>
  sequelize.define(name, attributes, {
    tableName,
    timestamps: created || updated,
    createdAt: created ? 'createdAt' : false,
    updatedAt: updated ? 'updatedAt' : false,
    ...opts
  });

const Tenant = define('Tenant', 'tenants', {
  id: id(),
  code: { ...str(16), allowNull: false, unique: true, validate: { is: { args: /^[A-Z0-9]{2,16}$/, msg: 'Code must be 2–16 letters or digits' } } },
  name: { ...str(), allowNull: false, validate: { len: { args: [2, 255], msg: 'Name must be 2–255 characters' } } },
  gstin: str(20), address: { type: T.TEXT }, state: str(64), contactEmail: str(), contactPhone: str(32),
  status: { ...str(16), allowNull: false, defaultValue: 'ACTIVE', validate: { isIn: { args: [['ACTIVE', 'SUSPENDED']], msg: 'Status must be ACTIVE or SUSPENDED' } } }
});

const TenantSetting = define('TenantSetting', 'tenant_settings', {
  tenantId: { type: T.UUID, primaryKey: true },
  gstPct: { ...money(), defaultValue: 18 }, defaultVendorPct: { ...money(), defaultValue: 55 },
  defaultPartnerPct: { ...money(), defaultValue: 25 }, defaultCapexPct: { ...money(), defaultValue: 20 },
  defaultContractMonths: { type: T.INTEGER, allowNull: false, defaultValue: 12 }, defaultCreditDays: { type: T.INTEGER, allowNull: false, defaultValue: 30 },
  defaultSlaDays: { type: T.INTEGER, allowNull: false, defaultValue: 30 }, monthlySalaryBurn: money(),
  salaryReserveMonths: { type: T.INTEGER, allowNull: false, defaultValue: 3 }, loanEmiMonthly: money(), loanAccountRef: str(128),
  authorityLabel: { ...str(64), allowNull: false, defaultValue: 'ROW / Authority' }, invoicePrefix: { ...str(16), allowNull: false, defaultValue: 'INV' }
}, { created: false });

const User = define('User', 'users', {
  id: id(), tenantId: { type: T.UUID },
  name: { ...str(128), allowNull: false, validate: { len: { args: [2, 128], msg: 'Name must be 2–128 characters' } } },
  email: { ...str(), allowNull: false, unique: true, set(v) { this.setDataValue('email', String(v).trim().toLowerCase()); } },
  phone: str(32), zone: str(64), role: { ...str(32), allowNull: false },
  passwordHash: req(T.TEXT), isActive: { type: T.BOOLEAN, allowNull: false, defaultValue: true },
  mustChangePassword: { type: T.BOOLEAN, allowNull: false, defaultValue: false }, lastLoginAt: { type: T.DATE }
}, { defaultScope: { attributes: { exclude: ['passwordHash'] } }, scopes: { withPassword: { attributes: { include: ['passwordHash'] } } } });

const Customer = define('Customer', 'customers', {
  id: id(), tenantId: tenantId(), name: { ...str(), allowNull: false }, clientType: { ...str(16), allowNull: false, defaultValue: 'ENTERPRISE' },
  gstin: str(20), billingAddress: { type: T.TEXT }, state: str(64), contactName: str(128), contactPhone: str(32), contactEmail: str(),
  creditDays: { type: T.INTEGER, allowNull: false, defaultValue: 30 }, billingFrequency: { ...str(16), allowNull: false, defaultValue: 'MONTHLY' },
  notes: { type: T.TEXT },
  isActive: { type: T.BOOLEAN, allowNull: false, defaultValue: true }
});

const Vendor = define('Vendor', 'vendors', {
  id: id(), tenantId: tenantId(), name: { ...str(), allowNull: false }, vendorType: { ...str(16), allowNull: false, defaultValue: 'ISP' },
  gstin: str(20), contactName: str(128), contactPhone: str(32), contactEmail: str(),
  paymentTermsDays: { type: T.INTEGER, allowNull: false, defaultValue: 30 }, bankDetails: { type: T.TEXT },
  address: { type: T.TEXT }, city: str(64), state: str(64), pincode: str(10), mapsUrl: { type: T.TEXT },
  latitude: { type: T.DECIMAL(9, 6) }, longitude: { type: T.DECIMAL(9, 6) }, notes: { type: T.TEXT },
  isActive: { type: T.BOOLEAN, allowNull: false, defaultValue: true }
});

const Counter = define('Counter', 'counters', {
  tenantId: { type: T.UUID, primaryKey: true }, key: { ...str(32), primaryKey: true }, value: { type: T.INTEGER, allowNull: false, defaultValue: 0 }
}, { created: false, updated: false });

const ClientOrder = define('ClientOrder', 'client_orders', {
  id: id(), tenantId: tenantId(), code: { ...str(32), allowNull: false }, customerId: req(T.UUID), clientRef: str(128),
  receivedVia: { ...str(16), allowNull: false, defaultValue: 'WHATSAPP' }, receivedDate: req(T.DATEONLY),
  clientContactName: str(128), clientContactPhone: str(32), clientContactEmail: str(), expectedBy: { type: T.DATEONLY },
  rawMessage: { type: T.TEXT }, notes: { type: T.TEXT }, ownerId: { type: T.UUID }, createdBy: { type: T.UUID }
});

const FeasibilityRequest = define('FeasibilityRequest', 'feasibility_requests', {
  id: id(), tenantId: tenantId(), code: { ...str(32), allowNull: false }, customerId: req(T.UUID), orderId: { type: T.UUID },
  siteName: { ...str(), allowNull: false }, address: req(T.TEXT), city: str(64), pincode: str(10),
  latitude: { type: T.DECIMAL(9, 6) }, longitude: { type: T.DECIMAL(9, 6) }, mapsUrl: { type: T.TEXT },
  sourceChannel: { ...str(16), allowNull: false, defaultValue: 'WHATSAPP' }, rawMessage: { type: T.TEXT },
  bandwidthMbps: req(T.INTEGER), medium: { ...str(16), allowNull: false, defaultValue: 'FIBER' },
  linkRole: { ...str(10), allowNull: false, defaultValue: 'PRIMARY', validate: { isIn: [['PRIMARY', 'SECONDARY']] } }, staticIpCount: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
  requesterName: str(128), requesterPhone: str(32), clientSiteRef: str(64), siteContactName: str(128), siteContactPhone: str(32),
  assignedTo: { type: T.UUID }, assignedAt: { type: T.DATE }, status: { ...str(24), allowNull: false, defaultValue: 'NEW' },
  surveyNotes: { type: T.TEXT }, nearestPopM: { type: T.INTEGER }, surveyedAt: { type: T.DATE }, selectedOptionId: { type: T.UUID },
  finalClientOtc: moneyNull(), finalClientMrc: moneyNull(), finalClientIpMrc: moneyNull(), priceFinalizedAt: { type: T.DATE }, completedAt: { type: T.DATE },
  stopReason: { type: T.TEXT }, createdBy: { type: T.UUID }
});

const FeasibilityIspOption = define('FeasibilityIspOption', 'feasibility_isp_options', {
  id: id(), tenantId: tenantId(), feasibilityId: req(T.UUID), vendorId: req(T.UUID), isFeasible: { type: T.BOOLEAN, allowNull: false, defaultValue: true },
  medium: str(16), distanceM: { type: T.INTEGER }, vendorOtc: money(), vendorMrc: money(), vendorIpMrc: money(), leadTimeDays: { type: T.INTEGER }, remarks: { type: T.TEXT }
}, { updated: false });

const Quote = define('Quote', 'quotes', {
  id: id(), tenantId: tenantId(), code: { ...str(32), allowNull: false }, feasibilityId: req(T.UUID), customerId: req(T.UUID),
  siteName: { ...str(), allowNull: false }, bandwidthMbps: req(T.INTEGER), contractMonths: { type: T.INTEGER, allowNull: false, defaultValue: 12 },
  status: { ...str(16), allowNull: false, defaultValue: 'DRAFT' }, sentAt: { type: T.DATE }, decidedAt: { type: T.DATE }, lostReason: { type: T.TEXT },
  wonOptionNo: { type: T.INTEGER }, finalVendorId: { type: T.UUID }, finalVendorOtc: moneyNull(), finalVendorMrc: moneyNull(),
  finalClientOtc: moneyNull(), finalClientMrc: moneyNull(), finalVendorIpMrc: moneyNull(), finalClientIpMrc: moneyNull(), finalizedValue: moneyNull(),
  vendorPct: moneyNull(), partnerPct: moneyNull(), capexPct: moneyNull(), vendorAmount: moneyNull(), partnerAmount: moneyNull(), capexAmount: moneyNull(),
  partnerVendorId: { type: T.UUID }, createdBy: { type: T.UUID }
});

const QuoteOption = define('QuoteOption', 'quote_options', {
  id: id(), tenantId: tenantId(), quoteId: req(T.UUID), optionNo: req(T.INTEGER), vendorId: req(T.UUID),
  vendorOtc: money(), vendorMrc: money(), vendorIpMrc: money(), clientOtc: money(), clientMrc: money(), clientIpMrc: money(), slaPct: moneyNull(), notes: { type: T.TEXT }
}, { created: false, updated: false });

const Site = define('Site', 'sites', {
  id: id(), tenantId: tenantId(), code: { ...str(32), allowNull: false }, quoteId: req(T.UUID), feasibilityId: req(T.UUID), orderId: { type: T.UUID },
  customerId: req(T.UUID), vendorId: req(T.UUID), siteName: { ...str(), allowNull: false }, address: { type: T.TEXT },
  clientSiteRef: str(64), siteContactName: str(128), siteContactPhone: str(32), bandwidthMbps: req(T.INTEGER),
  clientOtc: money(), clientMrc: money(), vendorOtc: money(), vendorMrc: money(), clientIpMrc: money(), vendorIpMrc: money(), contractMonths: { type: T.INTEGER, allowNull: false, defaultValue: 12 },
  linkRole: { ...str(10), allowNull: false, defaultValue: 'PRIMARY' }, staticIpCount: { type: T.INTEGER, allowNull: false, defaultValue: 0 }, staticIpBlock: str(64), medium: { ...str(16), allowNull: false, defaultValue: 'FIBER' },
  terminatedOn: { type: T.DATEONLY }, terminationReason: { type: T.TEXT }, terminatedBy: { type: T.UUID },
  status: { ...str(16), allowNull: false, defaultValue: 'AWAITING_PO' },
  poNumber: str(64), poDate: { type: T.DATEONLY }, poValue: moneyNull(), poReceivedAt: { type: T.DATE },
  workOrderNo: str(64), workStartDate: { type: T.DATEONLY }, slaDays: { type: T.INTEGER }, targetLiveDate: { type: T.DATEONLY }, ownerId: { type: T.UUID },
  liveDate: { type: T.DATEONLY }, circuitId: str(64), wanIp: str(64), subnetMask: str(45), gatewayIp: str(45), primaryDns: str(45), secondaryDns: str(45),
  latencyMs: moneyNull(), packetLossPct: moneyNull(), mrtgUrl: { type: T.TEXT }, atSignoffDate: { type: T.DATEONLY }, atSignedBy: str(128), liveRemarks: { type: T.TEXT },
  billingFrequency: { ...str(16), allowNull: false, defaultValue: 'MONTHLY' }, creditDays: { type: T.INTEGER, allowNull: false, defaultValue: 30 },
  lastCycleNo: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
  billingStart: { type: T.DATEONLY }, cycleBase: { type: T.INTEGER, allowNull: false, defaultValue: 0 }, contractStart: { type: T.DATEONLY },
  reconnectCharge: money(), reconnectVendorCharge: money()
});

const SiteBlocker = define('SiteBlocker', 'site_blockers', {
  id: id(), tenantId: tenantId(), siteId: req(T.UUID),
  party: { ...str(16), allowNull: false, validate: { isIn: { args: [['CLIENT', 'VENDOR', 'COMPANY', 'CUSTOMER', 'AUTHORITY', 'OTHER']], msg: 'Unknown party' } } },
  reason: req(T.TEXT), raisedBy: { type: T.UUID }, raisedAt: { type: T.DATE, allowNull: false, defaultValue: T.NOW },
  resolvedAt: { type: T.DATE }, resolvedBy: { type: T.UUID }, resolution: { type: T.TEXT }
}, { created: false, updated: false });

const Invoice = define('Invoice', 'invoices', {
  id: id(), tenantId: tenantId(), invoiceNumber: { ...str(32), allowNull: false }, siteId: req(T.UUID), customerId: req(T.UUID),
  invoiceType: { ...str(16), allowNull: false }, cycleNo: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
  periodStart: { type: T.DATEONLY }, periodEnd: { type: T.DATEONLY }, baseAmount: money(), ipAmount: money(), otcAmount: money(), gstPct: money(), gstAmount: money(), totalAmount: money(),
  vendorCost: money(), invoiceDate: req(T.DATEONLY), status: { ...str(24), allowNull: false, defaultValue: 'PENDING_SUBMISSION' },
  submissionMode: str(16), submissionDate: { type: T.DATEONLY }, courierAwb: str(128), acknowledgedBy: str(128), submissionRemarks: { type: T.TEXT },
  dueDate: { type: T.DATEONLY }, amountReceived: money(), tdsAmount: money(), creditAmount: money(), billedBandwidthMbps: { type: T.INTEGER }, createdBy: { type: T.UUID }
});

/** Credit note against a bill (unused days after disconnection, goodwill …) */
const CreditNote = define('CreditNote', 'credit_notes', {
  id: id(), tenantId: tenantId(), creditNumber: { ...str(32), allowNull: false }, invoiceId: req(T.UUID), siteId: req(T.UUID), customerId: req(T.UUID),
  creditDate: req(T.DATEONLY), reason: req(T.TEXT), baseAmount: money(), gstPct: money(), gstAmount: money(), totalAmount: money(), vendorCostReduction: money(), createdBy: { type: T.UUID }
}, { updated: false });

/** Bandwidth / price change on a live link from a billing cycle onwards */
const SiteRevision = define('SiteRevision', 'site_revisions', {
  id: id(), tenantId: tenantId(), siteId: req(T.UUID), fromCycle: req(T.INTEGER), effectiveFrom: req(T.DATEONLY),
  oldBandwidthMbps: req(T.INTEGER), newBandwidthMbps: req(T.INTEGER), oldClientMrc: money(), newClientMrc: money(), oldClientIpMrc: money(), newClientIpMrc: money(),
  oldVendorMrc: money(), newVendorMrc: money(), oldVendorIpMrc: money(), newVendorIpMrc: money(), reason: req(T.TEXT), poNumber: str(64), createdBy: { type: T.UUID }
}, { updated: false });

/** The ISP's own bill to us, checked against the cost we accrued for that period */
const VendorBill = define('VendorBill', 'vendor_bills', {
  id: id(), tenantId: tenantId(), vendorId: req(T.UUID), siteId: { type: T.UUID }, billNumber: { ...str(64), allowNull: false }, billDate: req(T.DATEONLY),
  periodFrom: req(T.DATEONLY), periodTo: req(T.DATEONLY), amount: money(), gstAmount: money(), expectedAmount: money(), dueDate: { type: T.DATEONLY }, notes: { type: T.TEXT }, createdBy: { type: T.UUID }
}, { updated: false });

/** Link down → restored, with the ISP's docket */
const SiteFault = define('SiteFault', 'site_faults', {
  id: id(), tenantId: tenantId(), siteId: req(T.UUID), vendorId: req(T.UUID), reportedAt: req(T.DATE), docketNo: str(64), description: req(T.TEXT),
  restoredAt: { type: T.DATE }, cause: { type: T.TEXT }, reportedBy: { type: T.UUID }, restoredBy: { type: T.UUID }
}, { updated: false });

const Receipt = define('Receipt', 'receipts', {
  id: id(), tenantId: tenantId(), invoiceId: req(T.UUID), siteId: req(T.UUID), amount: money(), tdsAmount: money(), receivedDate: req(T.DATEONLY),
  utrRef: { ...str(128), allowNull: false }, mode: { ...str(16), allowNull: false, defaultValue: 'NEFT' }, remarks: { type: T.TEXT }, createdBy: { type: T.UUID }
}, { updated: false });

const WaterfallAllocation = define('WaterfallAllocation', 'waterfall_allocations', {
  id: id(), tenantId: tenantId(), receiptId: req(T.UUID), siteId: req(T.UUID), vendorAmount: money(), loanAmount: money(), salaryAmount: money(), surplusAmount: money()
}, { updated: false });

const Payout = define('Payout', 'payouts', {
  id: id(), tenantId: tenantId(), category: { ...str(16), allowNull: false }, siteId: { type: T.UUID }, vendorId: { type: T.UUID }, amount: money(),
  paidDate: req(T.DATEONLY), reference: { ...str(128), allowNull: false }, periodLabel: str(32), remarks: { type: T.TEXT }, createdBy: { type: T.UUID }
}, { updated: false });

const Document = define('Document', 'documents', {
  id: id(), tenantId: tenantId(), entityType: { ...str(16), allowNull: false }, entityId: req(T.UUID), docType: { ...str(32), allowNull: false },
  fileName: { ...str(), allowNull: false }, storedName: { ...str(), allowNull: false }, mimeType: str(128), sizeBytes: { type: T.INTEGER }, uploadedBy: { type: T.UUID }
}, { updated: false });

const ActivityLog = define('ActivityLog', 'activity_log', {
  id: { type: T.BIGINT, primaryKey: true, autoIncrement: true }, tenantId: { type: T.UUID }, userId: { type: T.UUID },
  entityType: { ...str(32), allowNull: false }, entityId: { type: T.UUID }, action: { ...str(64), allowNull: false },
  message: req(T.TEXT), meta: { type: T.JSONB }
}, { updated: false });

/* ------------------------------- associations ------------------------------- */
Tenant.hasOne(TenantSetting, { foreignKey: 'tenantId', as: 'settings' });
TenantSetting.belongsTo(Tenant, { foreignKey: 'tenantId' });
Tenant.hasMany(User, { foreignKey: 'tenantId', as: 'users' });
User.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });
for (const M of [Customer, Vendor, ClientOrder, FeasibilityRequest, Quote, Site, Invoice, Receipt, Payout, Document]) {
  Tenant.hasMany(M, { foreignKey: 'tenantId' });
  M.belongsTo(Tenant, { foreignKey: 'tenantId' });
}
Customer.hasMany(ClientOrder, { foreignKey: 'customerId', as: 'orders' });
ClientOrder.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
ClientOrder.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });
ClientOrder.hasMany(FeasibilityRequest, { foreignKey: 'orderId', as: 'requests' });
FeasibilityRequest.belongsTo(ClientOrder, { foreignKey: 'orderId', as: 'order' });
FeasibilityRequest.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
FeasibilityRequest.belongsTo(User, { foreignKey: 'assignedTo', as: 'assignee' });
FeasibilityRequest.hasMany(FeasibilityIspOption, { foreignKey: 'feasibilityId', as: 'options' });
FeasibilityIspOption.belongsTo(FeasibilityRequest, { foreignKey: 'feasibilityId' });
FeasibilityIspOption.belongsTo(Vendor, { foreignKey: 'vendorId', as: 'vendor' });
FeasibilityRequest.hasOne(Quote, { foreignKey: 'feasibilityId', as: 'quote' });
Quote.belongsTo(FeasibilityRequest, { foreignKey: 'feasibilityId', as: 'feasibility' });
Quote.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
Quote.hasMany(QuoteOption, { foreignKey: 'quoteId', as: 'options' });
QuoteOption.belongsTo(Quote, { foreignKey: 'quoteId' });
QuoteOption.belongsTo(Vendor, { foreignKey: 'vendorId', as: 'vendor' });
Quote.hasOne(Site, { foreignKey: 'quoteId', as: 'site' });
Site.belongsTo(Quote, { foreignKey: 'quoteId', as: 'quote' });
Site.belongsTo(FeasibilityRequest, { foreignKey: 'feasibilityId', as: 'feasibility' });
Site.belongsTo(ClientOrder, { foreignKey: 'orderId', as: 'order' });
Site.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
Site.belongsTo(Vendor, { foreignKey: 'vendorId', as: 'vendor' });
Site.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });
Site.hasMany(SiteBlocker, { foreignKey: 'siteId', as: 'blockers' });
SiteBlocker.belongsTo(Site, { foreignKey: 'siteId' });
Site.hasMany(Invoice, { foreignKey: 'siteId', as: 'invoices' });
Invoice.belongsTo(Site, { foreignKey: 'siteId', as: 'site' });
Invoice.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
Invoice.hasMany(Receipt, { foreignKey: 'invoiceId', as: 'receipts' });
Receipt.belongsTo(Invoice, { foreignKey: 'invoiceId', as: 'invoice' });
Receipt.hasOne(WaterfallAllocation, { foreignKey: 'receiptId', as: 'allocation' });
WaterfallAllocation.belongsTo(Receipt, { foreignKey: 'receiptId' });
Payout.belongsTo(Site, { foreignKey: 'siteId', as: 'site' });
Payout.belongsTo(Vendor, { foreignKey: 'vendorId', as: 'vendor' });
Document.belongsTo(User, { foreignKey: 'uploadedBy', as: 'uploader' });
ActivityLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });

/** Model instance -> plain row with the DB column names (snake_case), the shape every API response uses */
const toRow = (inst, { omit = ['password_hash'] } = {}) => {
  if (!inst) return null;
  const M = inst.constructor;
  const o = inst.get({ plain: true });
  const row = {};
  for (const [k, v] of Object.entries(o)) {
    const col = (M.rawAttributes && M.rawAttributes[k] && M.rawAttributes[k].field) || k;
    if (!omit.includes(col)) row[col] = v;
  }
  return row;
};

module.exports = {
  toRow, sequelize, Tenant, TenantSetting, User, Customer, Vendor, Counter, ClientOrder, FeasibilityRequest, FeasibilityIspOption,
  Quote, QuoteOption, Site, SiteBlocker, Invoice, Receipt, WaterfallAllocation, Payout, Document, ActivityLog,
  CreditNote, SiteRevision, VendorBill, SiteFault
};
