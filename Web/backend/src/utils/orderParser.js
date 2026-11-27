/**
 * Reads a client order pasted from WhatsApp or email by a client and suggests
 * order details + one row per site. Everything it returns is a suggestion the field engineer edits.
 *
 * Handles:  numbered lists ("1. …", "2) …", "Site 3: …"), blocks separated by blank lines,
 * Google Maps links / raw coordinates, 6-digit pincodes, bandwidth (100 Mbps / 1 Gbps),
 * phone numbers, and the client's own site / location id ("Site ID: RT-BLR-014").
 */
const { parseCoordinates, extractMapsUrl, extractPincode } = require('./helpers');

const BW_RE = /(\d{1,5})\s*(mbps|mb|gbps|gb)\b/i;
const PHONE_RE = /(?:\+91[\s-]?)?\b[6-9]\d{9}\b/;
const REF_LABEL = String.raw`(?:site\s*(?:id|code|ref)|loc(?:ation)?\s*(?:id|code)|station\s*code|branch\s*code|sol\s*id)`;
const SITE_REF_RE = new RegExp(String.raw`\b${REF_LABEL}\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-\/_]{1,40})`, 'i');
const ORDER_REF_RE = /\b(?:order|po|loi|wo|work\s*order|tender|ref(?:erence)?)\s*(?:no\.?|number|#|id)?\s*[:#.\-]\s*([A-Z0-9][A-Z0-9\-\/_.]{2,60})/i;
const ITEM_RE = /^\s*(?:(?:site|location|loc)\s*[-#]?\s*)?(\d{1,3})\s*[.):\-]\s+(.*)$/i;
const CONTACT_RE = /\b(?:contact|spoc|person|poc|attn)\s*[:\-]?\s*([A-Za-z][A-Za-z .]{1,40}?)(?=\s*[,\-–(]|\s+(?:\+91|[6-9]\d{9})|$)/i;
const URL_RE = /https?:\/\/\S+/gi;
const COORD_RE = /-?\d{1,2}\.\d{3,}\s*[, ]\s*-?\d{1,3}\.\d{3,}/g;
const GREETING_RE = /^(?:hi|hello|dear|good\s+(?:morning|afternoon|evening)|greetings|team|sir|madam|please|pls|kindly|request|new\s+(?:link|order|requirement)|requirement|thanks|thank\s+you|regards)\b/i;
const NAME_CUT_RE = new RegExp(String.raw`\s*(?:,|\s-\s|\||–)\s*|(?=\b\d{1,5}\s*(?:mbps|mb|gbps|gb)\b)|(?=\b${REF_LABEL}\b)`, 'i');

const bandwidthOf = (t) => {
  const m = String(t || '').match(BW_RE);
  return m ? Number(m[1]) * (/^g/i.test(m[2]) ? 1000 : 1) : null;
};

const cleanLine = (l) => l.replace(URL_RE, '').replace(/[*_~]/g, '').replace(/\s+/g, ' ').trim();

/** Remove ids, bandwidth, phone, coordinates and contact mentions — what is left is name / address */
const stripNoise = (l) => cleanLine(l)
  .replace(SITE_REF_RE, '')
  .replace(CONTACT_RE, '')
  .replace(PHONE_RE, '')
  .replace(BW_RE, '')
  .replace(COORD_RE, '')
  .replace(/\b(?:ill|internet)?\s*(?:link\s+)?(?:required|req)\b/gi, '')
  .replace(/\b(?:bandwidth|bw)\b\s*[:\-]?/gi, '')
  .replace(/\b(?:ill|each)\b\.?/gi, '')
  .replace(/\s*([,;|])(?:\s*[,;|])+/g, '$1')
  .replace(/\s+,/g, ',')
  .replace(/\s+/g, ' ')
  .replace(/[\s,;:.\-–|]+$/g, '')
  .replace(/^[\s,;:.\-–|]+/g, '')
  .trim();

/** Site name = first meaningful segment of the first line ("KSR Station, Gubbi Rd…" → "KSR Station") */
const nameFrom = (line) => {
  const first = cleanLine(line).replace(/^(?:site|location|loc)\s*(?:name)?\s*[:\-]\s*/i, '');
  return stripNoise(first.split(NAME_CUT_RE)[0] || '').slice(0, 120);
};

const siteFrom = (rawLines, defaults) => {
  const lines = [...rawLines];
  while (lines.length > 1 && GREETING_RE.test(cleanLine(lines[0]))) lines.shift();
  const text = lines.join('\n');
  const coords = parseCoordinates(text);
  const ref = text.match(SITE_REF_RE);
  const phone = text.match(PHONE_RE);
  const contact = text.match(CONTACT_RE);
  const parts = lines.map(stripNoise).filter(Boolean);
  const siteName = nameFrom(lines[0]) || parts[0] || '';
  return {
    siteName,
    address: parts.join(', ').slice(0, 500) || siteName,
    pincode: extractPincode(text.replace(new RegExp(PHONE_RE.source, 'g'), '')),
    mapsUrl: extractMapsUrl(text),
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    bandwidthMbps: bandwidthOf(text) || defaults.bandwidthMbps || null,
    clientSiteRef: ref ? ref[1] : null,
    siteContactName: contact ? contact[1].trim() : null,
    siteContactPhone: phone ? phone[0] : null
  };
};

const parseOrderText = (raw = '') => {
  const text = String(raw).replace(/\r/g, '');
  const lines = text.split('\n');
  const header = [];
  const blocks = [];
  const numbered = lines.some((l) => ITEM_RE.test(l));

  if (numbered) {
    let cur = null;
    for (const l of lines) {
      const m = l.match(ITEM_RE);
      if (m) { cur = [m[2]]; blocks.push(cur); } else if (cur) { if (l.trim()) cur.push(l); } else if (l.trim()) header.push(l);
    }
  } else {
    let cur = [];
    for (const l of lines) {
      if (l.trim()) cur.push(l); else if (cur.length) { blocks.push(cur); cur = []; }
    }
    if (cur.length) blocks.push(cur);
    // A first block without any location signal is the greeting / order header
    const hasLocation = (b) => { const t = b.join('\n'); return parseCoordinates(t) || extractMapsUrl(t) || extractPincode(t); };
    if (blocks.length > 1 && !hasLocation(blocks[0])) header.push(...blocks.shift());
  }

  const headerText = header.join('\n');
  const orderRef = text.match(ORDER_REF_RE);
  const defaults = { bandwidthMbps: bandwidthOf(headerText) };
  const sites = blocks.map((b) => siteFrom(b, defaults)).filter((s) => s.siteName || s.address);
  const headerPhone = headerText.match(PHONE_RE);
  const headerContact = headerText.match(CONTACT_RE);

  return {
    clientRef: orderRef ? orderRef[1].replace(/[.,]$/, '') : null,
    clientContactName: headerContact ? headerContact[1].trim() : null,
    clientContactPhone: headerPhone ? headerPhone[0] : null,
    defaultBandwidthMbps: defaults.bandwidthMbps,
    sites
  };
};

module.exports = { parseOrderText, bandwidthOf };
