/**
 * Excel import of a client order: the fixed template (what the tool needs, column by column),
 * and the parser that turns a filled sheet into site / ISP rows ready for the API, with row-level errors.
 *
 * The parser reads the template's own headers and common alternatives (e.g. "Entity Location", "Lat",
 * "Name of the District"), so a client's sheet often works as-is. Columns it does not know are kept:
 * they are written into each site's Notes as "Header: value".
 */
import { siteSchema } from './siteSchema';
import { MEDIUMS } from '../shared';
import { PATTERNS } from '../../validation/rules';
import { buildXlsx } from '../../utils/spreadsheet';

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[*:]/g, '').trim();
const text = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
/** Like text(), but keeps line breaks (Notes cells often hold one item per line) */
const multiline = (v) => (v === null || v === undefined ? '' : String(v).split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'));

/* ------------------------------- columns ------------------------------- */
const MEDIUM_VALUES = MEDIUMS.map((m) => m.label);

export const SITE_COLUMNS = [
  { key: 'siteName', header: 'Site Name *', width: 26, required: true, aliases: ['site name', 'site', 'location', 'site location', 'entity location', 'branch', 'branch name', 'name of the site', 'location name'], example: 'Pedabayalu MLS Point', help: 'Short name your team will recognise (2–255 characters).' },
  { key: 'address', header: 'Address *', width: 48, required: true, aliases: ['address', 'site address', 'full address', 'installation address'], example: 'CSC MLS Point, Pedabayalu Mandal, ASR District, PIN 531040', help: 'Full address the engineer will visit.' },
  { key: 'city', header: 'City / District', width: 20, aliases: ['city', 'district', 'name of the district', 'town', 'city / district', 'city/district'], example: 'Alluri Sitharama Raju', help: 'Up to 64 characters.' },
  { key: 'pincode', header: 'Pincode', width: 10, aliases: ['pincode', 'pin code', 'pin', 'zip', 'postal code'], example: '531040', help: '6 digits. If blank, it is read from the address when the address has one.' },
  { key: 'latitude', header: 'Latitude', width: 12, aliases: ['latitude', 'lat'], example: 18.2853174, help: 'Decimal degrees, e.g. 18.2853. Swapped latitude / longitude are fixed automatically.' },
  { key: 'longitude', header: 'Longitude', width: 12, aliases: ['longitude', 'long', 'lng', 'lon'], example: 82.5872297, help: 'Decimal degrees, e.g. 82.5872.' },
  { key: 'mapsUrl', header: 'Google Maps Link', width: 28, aliases: ['google maps link', 'maps link', 'map link', 'maps url', 'location link', 'google map'], example: '', help: 'Optional. Coordinates are read from the link when Latitude / Longitude are blank.' },
  { key: 'bandwidthMbps', header: 'Bandwidth (Mbps) *', width: 16, required: true, aliases: ['bandwidth (mbps)', 'bandwidth', 'speed', 'mbps', 'bandwidth mbps', 'internet requirement', 'requirement'], example: 20, help: 'Whole number in Mbps (1–100000). "1 Gbps" or "20 Mbps ILL" also work.' },
  { key: 'medium', header: 'Medium', width: 14, aliases: ['medium', 'link medium', 'connectivity', 'media'], list: MEDIUM_VALUES, example: 'Leased line', help: `One of: ${MEDIUM_VALUES.join(', ')}. Blank = Fiber.` },
  { key: 'linkRole', header: 'Link Type', width: 12, aliases: ['link type', 'link role', 'primary / secondary', 'primary/secondary'], list: ['Primary', 'Secondary'], example: 'Primary', help: 'Primary or Secondary (backup). Blank = Primary.' },
  { key: 'staticIpCount', header: 'Static IPs', width: 10, aliases: ['static ips', 'static ip', 'public ips', 'public ip', 'no of ips', 'ips'], example: 1, help: 'How many static IPs (0–256), or a block like /29. Blank = 0.' },
  { key: 'clientSiteRef', header: 'Client Site ID', width: 14, aliases: ['client site id', 'site id', 'site code', 'client site ref', 'entity number', 'entity no', 'client ref'], example: '2813055', help: "The client's own code for the site (printed on the bill). Up to 64 characters." },
  { key: 'siteContactName', header: 'Site Contact Name', width: 18, aliases: ['site contact name', 'contact name', 'contact person', 'site contact'], example: '', help: 'Person to meet at the site (optional).' },
  { key: 'siteContactPhone', header: 'Site Contact Phone', width: 16, aliases: ['site contact phone', 'contact phone', 'site phone', 'mobile', 'mobile number'], example: '', help: '10–15 digits (optional).' },
  { key: 'engineer', header: 'Field Engineer', width: 18, aliases: ['field engineer', 'engineer', 'assigned to', 'assign to', 'surveyor'], example: '', help: 'Name of the field engineer as listed in Team (optional). Blank = the order owner.' },
  { key: 'notes', header: 'Notes', width: 40, aliases: ['notes', 'remarks', 'comments', 'note'], example: 'CCTV: 8 bullet cameras', help: 'Anything else about the site (up to 5000 characters).' }
];

export const ISP_COLUMNS = [
  { key: 'name', header: 'ISP / Vendor Name *', width: 34, required: true, aliases: ['isp / vendor name', 'isp name', 'vendor name', 'isp', 'vendor', 'name', 'full isp / local cable operator name', 'company name'], example: 'Bharti Airtel Limited (Airtel Business)', help: 'Company name (2–255 characters). Names already in ISPs & Vendors are skipped.' },
  { key: 'vendorType', header: 'Type', width: 12, aliases: ['type', 'vendor type'], list: ['ISP', 'Partner', 'Contractor'], example: 'ISP', help: 'ISP, Partner or Contractor. Blank = ISP.' },
  { key: 'contactName', header: 'Contact Person', width: 18, aliases: ['contact person', 'contact name', 'account manager'], example: '', help: 'Optional.' },
  { key: 'contactPhone', header: 'Phone', width: 18, aliases: ['phone', 'contact number', 'contact phone', 'mobile', 'enterprise / noc contact number', 'noc number'], example: '1800-103-0123', help: '10–15 digits. If several are given ("A / B"), the first is used and all are kept in Notes.' },
  { key: 'contactEmail', header: 'Email', width: 28, aliases: ['email', 'email id', 'contact email', 'enterprise / support email id', 'support email'], example: 'enterprise.ap@airtel.com', help: 'Optional.' },
  { key: 'gstin', header: 'GSTIN', width: 18, aliases: ['gstin', 'gst', 'gst no', 'gst number'], example: '', help: '15 characters (optional).' },
  { key: 'paymentTermsDays', header: 'Payment Terms (days)', width: 12, aliases: ['payment terms (days)', 'payment terms', 'credit days'], example: 30, help: '0–365. Blank = 30.' },
  { key: 'address', header: 'Address', width: 30, aliases: ['address', 'office address'], example: '', help: 'Optional.' },
  { key: 'city', header: 'City', width: 14, aliases: ['city', 'town'], example: '', help: 'Optional.' },
  { key: 'state', header: 'State', width: 14, aliases: ['state'], example: 'Andhra Pradesh', help: 'Optional.' },
  { key: 'pincode', header: 'Pincode', width: 10, aliases: ['pincode', 'pin code', 'pin'], example: '', help: '6 digits (optional).' },
  { key: 'notes', header: 'Notes', width: 34, aliases: ['notes', 'remarks', 'comments'], example: 'National enterprise ILL', help: 'Optional (up to 2000 characters).' }
];

/* ------------------------------- template ------------------------------- */
export const TEMPLATE_FILE = 'ISP-Flow_Order_Import_Template.xlsx';

export const buildTemplate = () => {
  const how = [
    ['ISP-Flow — client order import'],
    [''],
    ['1. Fill the "Sites" sheet: one row per location. Columns marked * are required.'],
    ['2. Optional: list new ISPs / vendors in the "ISPs" sheet (names already in the app are skipped).'],
    ['3. In the app: Clients & Orders › Import from Excel › choose the client › upload this file.'],
    ['4. Check the preview: rows with errors are listed and left out; fix them and import again, or import the rest.'],
    ['   Delete the example rows before importing. Do not rename the column headers.'],
    [''],
    ['Sites sheet', 'What to enter'],
    ...SITE_COLUMNS.map((c) => [c.header, c.help]),
    [''],
    ['ISPs sheet', 'What to enter'],
    ...ISP_COLUMNS.map((c) => [c.header, c.help])
  ];
  const sheet = (cols) => ({
    rows: [cols.map((c) => c.header), cols.map((c) => c.example ?? '')],
    widths: cols.map((c) => c.width),
    header: true,
    lists: cols.map((c, col) => (c.list ? { col, values: c.list } : null)).filter(Boolean)
  });
  return buildXlsx([
    { name: 'Sites', ...sheet(SITE_COLUMNS) },
    { name: 'ISPs', ...sheet(ISP_COLUMNS) },
    { name: 'How to fill', rows: how, widths: [26, 110], styleOf: (r, c) => (r === 0 || ((r === 8 || r === 10 + SITE_COLUMNS.length) && c <= 1) ? 1 : 0) }
  ]);
};

/* ------------------------------- value parsing ------------------------------- */
const num = (v) => {
  if (typeof v === 'number') return v;
  const s = text(v).replace(/,/g, '');
  return s && !Number.isNaN(Number(s)) ? Number(s) : null;
};

const parseBandwidth = (v) => {
  if (typeof v === 'number') return { value: v };
  const s = text(v);
  if (!s) return { value: null };
  const m = s.match(/(\d+(?:\.\d+)?)\s*(g|m|k)?\s*(bps|b\b|\b)/i);
  if (!m) return { value: NaN };
  const n = Number(m[1]);
  const unit = (m[2] || 'm').toLowerCase();
  return { value: Math.round(unit === 'g' ? n * 1000 : unit === 'k' ? n / 1000 : n), extra: /^\d+(\.\d+)?$/.test(s) ? null : s };
};

const MEDIUM_WORDS = [
  [/^(fiber|fibre|ftth|ofc|optical)/i, 'FIBER'], [/broadband/i, 'BROADBAND'], [/(leased|\bill\b|dedicated)/i, 'LEASED_LINE'],
  [/(^rf\b|microwave|wireless|radio|p2p)/i, 'RF'], [/(4g|5g|lte|sim)/i, '4G_5G']
];
const parseMedium = (v) => {
  const s = text(v);
  if (!s) return null;
  const code = MEDIUMS.find((m) => m.value === s.toUpperCase() || norm(m.label) === norm(s));
  if (code) return code.value;
  const hit = MEDIUM_WORDS.find(([re]) => re.test(s));
  return hit ? hit[1] : undefined;
};

const parseLinkRole = (v) => {
  const s = norm(v);
  if (!s) return null;
  if (/^(primary|main|p)$/.test(s)) return 'PRIMARY';
  if (/^(secondary|backup|redundant|s)$/.test(s)) return 'SECONDARY';
  return undefined;
};

const parseStaticIps = (v) => {
  if (typeof v === 'number') return v;
  const s = text(v);
  if (!s || /^(no|none|nil|na|n\/a|-)$/i.test(s)) return s ? 0 : null;
  const cidr = s.match(/\/\s*(\d{2})\b/);
  if (cidr) return 2 ** (32 - Number(cidr[1]));
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : undefined;
};

const firstPhone = (v) => {
  const parts = text(v).split(/[/,;]| or /i).map((p) => p.trim()).filter(Boolean);
  return parts.find((p) => PATTERNS.phone.test(p)) || (parts[0] ?? '');
};

const pincodeFrom = (address) => {
  const m = text(address).match(/(?:^|\D)([1-9]\d{2})\s?(\d{3})(?!\d)/);
  return m ? m[1] + m[2] : '';
};

/* ------------------------------- sheet → rows ------------------------------- */
/** Find the header row (first 10 rows) and map each column to a field */
const mapHeader = (rows, columns) => {
  let best = null;
  for (let r = 0; r < Math.min(rows.length, 10); r += 1) {
    const map = {}; const extra = [];
    (rows[r] || []).forEach((h, i) => {
      const n = norm(h);
      if (!n) return;
      const col = columns.find((c) => norm(c.header) === n || c.aliases.includes(n));
      if (col && map[col.key] === undefined) map[col.key] = i; else extra.push({ i, header: text(h) });
    });
    const score = Object.keys(map).length;
    if (score >= 2 && (!best || score > best.score)) best = { row: r, map, extra, score };
  }
  return best;
};

const isTotalRow = (r) => /^(grand\s+)?total\b/i.test(text(r.find((c) => text(c) !== '')));
const IGNORED_EXTRA = /^(s\.?\s*no\.?|sl\.?\s*no\.?|sr\.?\s*no\.?|#)$/i;

/** Unknown columns are kept in Notes ("Header: value") so nothing in the client's sheet is lost */
const extraNotes = (row, extra) => extra
  .filter((e) => !IGNORED_EXTRA.test(e.header) && text(row[e.i]) !== '')
  .map((e) => `${e.header || `Column ${e.i + 1}`}: ${text(row[e.i])}`);

const yupErrors = (schema, value) => {
  // Blank cells mean "not given" (as in the forms), so optional rules like "at least 2 characters" do not fire
  const given = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  try { schema.validateSync(given, { abortEarly: false }); return []; } catch (e) { return (e.inner?.length ? e.inner : [e]).map((x) => ({ field: x.path, message: x.message })); }
};

const LABEL = Object.fromEntries([...SITE_COLUMNS, ...ISP_COLUMNS].map((c) => [c.key, c.header.replace(' *', '')]));
const labelled = (errs, cols) => errs.map((e) => `${cols.find((c) => c.key === e.field)?.header.replace(' *', '') || LABEL[e.field] || e.field}: ${e.message}`);

const parseSites = (sheet, header, engineers) => {
  const out = [];
  const seen = new Map();
  for (let r = header.row + 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r] || [];
    const get = (k) => (header.map[k] === undefined ? '' : row[header.map[k]]);
    if (!row.some((c) => text(c) !== '') || isTotalRow(row)) continue;
    // Rows with none of the main fields (e.g. a footer with only a number) are not sites
    if (!['siteName', 'address', 'bandwidthMbps'].some((k) => text(get(k)))) continue;

    const errors = []; const warnings = []; const notes = [];
    const bw = parseBandwidth(get('bandwidthMbps'));
    if (bw.extra) notes.push(`Requirement: ${bw.extra}`);

    let medium = parseMedium(get('medium'));
    if (medium === undefined) { errors.push(`Medium: "${text(get('medium'))}" is not one of ${MEDIUM_VALUES.join(', ')}`); medium = null; }
    if (!medium && bw.extra) medium = parseMedium(bw.extra) || null;

    let linkRole = parseLinkRole(get('linkRole'));
    if (linkRole === undefined) { errors.push(`Link Type: "${text(get('linkRole'))}" — use Primary or Secondary`); linkRole = null; }

    let ips = parseStaticIps(get('staticIpCount'));
    if (ips === undefined) { errors.push(`Static IPs: "${text(get('staticIpCount'))}" is not a number`); ips = null; }
    if (ips === null && bw.extra) { const m = bw.extra.match(/(\d+)\s*(?:no'?s?\.?\s*(?:of)?\s*)?(?:public|static)\s*ip/i); if (m) ips = Number(m[1]); }

    let lat = num(get('latitude')); let lng = num(get('longitude'));
    if (text(get('latitude')) && lat === null) errors.push(`Latitude: "${text(get('latitude'))}" is not a number`);
    if (text(get('longitude')) && lng === null) errors.push(`Longitude: "${text(get('longitude'))}" is not a number`);
    if (lat !== null && lng !== null && ((Math.abs(lat) > 90 && Math.abs(lng) <= 90) || (lat > 40 && lng > 0 && lng < 40))) {
      [lat, lng] = [lng, lat];
      warnings.push('Latitude and longitude were swapped — fixed');
    }
    if ((lat === null) !== (lng === null)) warnings.push('Only one of latitude / longitude given — both left empty');
    if (lat === null || lng === null) { lat = null; lng = null; }

    const address = text(get('address'));
    let pincode = text(get('pincode')).replace(/\s/g, '');
    if (!pincode && address) { pincode = pincodeFrom(address); if (pincode) warnings.push(`Pincode ${pincode} taken from the address`); }

    let assignedTo = '';
    const eng = text(get('engineer'));
    if (eng) {
      if (!engineers) warnings.push('Field Engineer column ignored — only managers can assign sites');
      else {
        const hit = engineers.find((u) => norm(u.name) === norm(eng));
        if (hit) assignedTo = hit.id; else warnings.push(`Field engineer "${eng}" not found in Team — left to the order owner`);
      }
    }

    notes.push(...extraNotes(row, header.extra));
    const allNotes = [multiline(get('notes')), ...notes].filter(Boolean).join('\n');

    const site = {
      siteName: text(get('siteName')), address, city: text(get('city')), pincode,
      latitude: lat ?? '', longitude: lng ?? '', mapsUrl: text(get('mapsUrl')),
      bandwidthMbps: bw.value === null ? '' : Number.isNaN(bw.value) ? text(get('bandwidthMbps')) : bw.value,
      medium: medium || 'FIBER', linkRole: linkRole || 'PRIMARY', staticIpCount: ips ?? 0,
      clientSiteRef: text(get('clientSiteRef')), siteContactName: text(get('siteContactName')),
      siteContactPhone: firstPhone(get('siteContactPhone')), notes: allNotes.slice(0, 5000), assignedTo
    };
    if (allNotes.length > 5000) warnings.push('Notes were longer than 5000 characters — cut short');
    errors.push(...labelled(yupErrors(siteSchema, site), SITE_COLUMNS));

    const dupKey = `${norm(site.siteName)}|${norm(site.address)}`;
    if (seen.has(dupKey)) warnings.push(`Same site name and address as row ${seen.get(dupKey)}`); else seen.set(dupKey, r + 1);

    out.push({ rowNo: r + 1, site, errors, warnings });
  }
  return out;
};

const VENDOR_TYPES = { isp: 'ISP', partner: 'PARTNER', contractor: 'CONTRACTOR' };
const parseIsps = (sheet, header) => {
  const out = [];
  const seen = new Set();
  for (let r = header.row + 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r] || [];
    const get = (k) => (header.map[k] === undefined ? '' : row[header.map[k]]);
    if (!row.some((c) => text(c) !== '') || isTotalRow(row) || !text(get('name'))) continue;
    const errors = []; const warnings = []; const notes = [];
    const typeText = norm(get('vendorType'));
    const vendorType = typeText ? VENDOR_TYPES[typeText] : 'ISP';
    if (!vendorType) errors.push(`Type: "${text(get('vendorType'))}" — use ISP, Partner or Contractor`);
    const phones = text(get('contactPhone'));
    const phone = firstPhone(phones);
    if (phones && phone !== phones) notes.push(`Phone: ${phones}`);
    const terms = num(get('paymentTermsDays'));
    notes.push(...extraNotes(row, header.extra));
    const name = text(get('name'));
    const v = {
      name, vendorType: vendorType || 'ISP', contactName: text(get('contactName')), contactPhone: phone,
      contactEmail: text(get('contactEmail')).toLowerCase(), gstin: text(get('gstin')).toUpperCase(),
      paymentTermsDays: terms ?? 30, address: text(get('address')), city: text(get('city')), state: text(get('state')),
      pincode: text(get('pincode')).replace(/\s/g, ''), notes: [multiline(get('notes')), ...notes].filter(Boolean).join('\n').slice(0, 2000)
    };
    if (name.length < 2 || name.length > 255) errors.push('ISP / Vendor Name: 2–255 characters');
    if (v.contactPhone && !PATTERNS.phone.test(v.contactPhone)) errors.push('Phone: enter 10–15 digits');
    if (v.contactEmail && !PATTERNS.email.test(v.contactEmail)) errors.push('Email: not a valid email address');
    if (v.gstin && !PATTERNS.gstin.test(v.gstin)) errors.push('GSTIN: not a valid 15-character GSTIN');
    if (v.pincode && !PATTERNS.pincode.test(v.pincode)) errors.push('Pincode: enter 6 digits');
    if (!Number.isInteger(v.paymentTermsDays) || v.paymentTermsDays < 0 || v.paymentTermsDays > 365) errors.push('Payment Terms: whole number 0–365');
    if (seen.has(norm(name))) warnings.push('Listed twice in the sheet — imported once'); else seen.add(norm(name));
    out.push({ rowNo: r + 1, vendor: v, errors, warnings, duplicate: warnings.length > 0 });
  }
  return out;
};

/**
 * workbook (from readSpreadsheet) → { sites, isps, siteSheet, ispSheet }
 * engineers: list of { id, name } when the user may assign, else null
 */
export const parseWorkbook = (workbook, engineers) => {
  let siteSheet = null; let ispSheet = null;
  for (const sheet of workbook.sheets) {
    if (/^how to fill|instruction/i.test(sheet.name)) continue;
    const s = mapHeader(sheet.rows, SITE_COLUMNS);
    const i = mapHeader(sheet.rows, ISP_COLUMNS);
    const siteFit = s && s.map.siteName !== undefined ? s.score : 0;
    const ispFit = i && i.map.name !== undefined ? i.score : 0;
    if (siteFit && siteFit >= ispFit && !siteSheet) siteSheet = { sheet, header: s };
    else if (ispFit && !ispSheet) ispSheet = { sheet, header: i };
  }
  if (!siteSheet) {
    throw new Error('No sites found: the file needs a sheet with a "Site Name" column (download the template to see the format)');
  }
  return {
    siteSheet: { name: siteSheet.sheet.name, unknownColumns: siteSheet.header.extra.map((e) => e.header).filter((h) => h && !IGNORED_EXTRA.test(h)) },
    ispSheet: ispSheet && { name: ispSheet.sheet.name },
    sites: parseSites(siteSheet.sheet, siteSheet.header, engineers),
    isps: ispSheet ? parseIsps(ispSheet.sheet, ispSheet.header) : []
  };
};
