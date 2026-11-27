/**
 * Tiny spreadsheet reader / writer — no libraries.
 *   readSpreadsheet(file)  → { sheets: [{ name, rows: [[cell, …], …] }] }   (.xlsx or .csv)
 *   buildXlsx(sheets)      → Blob of a real .xlsx (bold frozen header, column widths, dropdown lists)
 *   downloadBlob(blob, name)
 * .xlsx is a zip of XML files: read with the browser's DecompressionStream, written uncompressed ("stored").
 */

/* ------------------------------- zip ------------------------------- */
const inflateRaw = async (bytes) => {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const unzip = async (buf) => {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = buf.byteLength - 22;
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error('This is not a valid .xlsx file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const files = {};
  const utf8 = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    files[name] = { method, data: bytes.subarray(start, start + size) };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    has: (n) => Boolean(files[n]),
    text: async (n) => {
      const f = files[n];
      if (!f) return '';
      return utf8.decode(f.method === 8 ? await inflateRaw(f.data) : f.data);
    }
  };
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (data) => {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** files: [{ name, text }] → zip Blob (stored, no compression) */
const zip = (files) => {
  const enc = new TextEncoder();
  const parts = []; const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(local.buffer, name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(cd.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

/* ------------------------------- read ------------------------------- */
const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
const runText = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('');
const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

const readXlsx = async (buf) => {
  const z = await unzip(buf);
  const shared = [...(await z.text('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runText(m[1]));
  const rels = {};
  for (const m of (await z.text('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b([^>]*)>/g)) {
    const id = (m[1].match(/\bId="([^"]+)"/) || [])[1];
    const target = (m[1].match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && target) rels[id] = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheets = [];
  for (const m of (await z.text('xl/workbook.xml')).matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = decodeXml((m[1].match(/\bname="([^"]*)"/) || [])[1] || `Sheet${sheets.length + 1}`);
    const rid = (m[1].match(/\br:id="([^"]+)"/) || [])[1];
    const path = rels[rid];
    if (!path || !z.has(path)) continue;
    const xml = await z.text(path);
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rowNo = Number((rm[1].match(/\br="(\d+)"/) || [])[1]) || rows.length + 1;
      const row = [];
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = (cm[1].match(/\br="([A-Z]+)\d+"/) || [])[1];
        const t = (cm[1].match(/\bt="(\w+)"/) || [])[1];
        const body = cm[2] || '';
        let val = '';
        if (t === 'inlineStr') val = runText(body);
        else {
          const vm = body.match(/<v>([\s\S]*?)<\/v>/);
          if (vm) val = t === 's' ? shared[Number(vm[1])] ?? '' : t === 'str' || t === 'e' ? decodeXml(vm[1]) : t === 'b' ? vm[1] === '1' : Number.isNaN(Number(vm[1])) ? decodeXml(vm[1]) : Number(vm[1]);
        }
        row[ref ? colIndex(ref) : row.length] = val;
      }
      rows[rowNo - 1] = Array.from(row, (x) => (x === undefined ? '' : x));
    }
    sheets.push({ name, rows: Array.from(rows, (r) => r || []) });
  }
  return { sheets };
};

/** RFC 4180 CSV (quotes, commas and new lines inside quotes) */
const readCsv = (text) => {
  const rows = []; let row = []; let cell = ''; let q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return { sheets: [{ name: 'CSV', rows }] };
};

export const readSpreadsheet = async (file) => {
  if (/\.csv$/i.test(file.name)) return readCsv(await file.text());
  if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files are not supported — in Excel use File › Save As › Excel Workbook (.xlsx)');
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read .xlsx files — update the browser, or save the sheet as .csv');
  return readXlsx(await file.arrayBuffer());
};

/* ------------------------------- write ------------------------------- */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // characters XML 1.0 does not allow
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colLetters = (i) => { let s = ''; let n = i + 1; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

/**
 * sheets: [{ name, rows: [[…]], widths?: [chars], header?: true (bold + frozen first row),
 *            lists?: [{ col, values: ['A','B'] }] (dropdown in that column), wrap?: true }]
 * Style ids: 0 normal, 1 header, 2 wrapped text, 3 note (italic grey)
 */
export const buildXlsx = (sheets) => {
  const sheetXml = (s) => {
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      if (v === '' || v === null || v === undefined) return '';
      const ref = `${colLetters(ci)}${ri + 1}`;
      const style = s.header && ri === 0 ? ' s="1"' : s.styleOf ? ` s="${s.styleOf(ri, ci)}"` : s.wrap ? ' s="2"' : '';
      return typeof v === 'number' ? `<c r="${ref}"${style}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const views = s.header ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const cols = s.widths ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const lists = (s.lists || []).map((l) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Choose from the list" error="Pick one of the values in the list" sqref="${colLetters(l.col)}2:${colLetters(l.col)}5000"><formula1>"${esc(l.values.join(','))}"</formula1></dataValidation>`);
    const dv = lists.length ? `<dataValidations count="${lists.length}">${lists.join('')}</dataValidations>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${views}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${dv}</worksheet>`;
  };
  const files = [
    { name: '[Content_Types].xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) }))
  ];
  return zip(files);
};

export const downloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
