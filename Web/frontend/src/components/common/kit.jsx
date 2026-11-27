import { useToast } from './Toast';
import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, FileText, Upload, Trash2, Download, Inbox, AlertTriangle } from 'lucide-react';
import { useApi, useAction } from '../../api/hooks';
import { api, del, downloadUrl } from '../../api/client';
import { Button } from './ui';
import { inputClass } from './Overlay';
import { formatDateTime } from '../../utils/formatters';
import { listItem } from '../../utils/motion';

export const selectClass = `${inputClass} appearance-none pr-8 bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737B76' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")] bg-[length:12px] bg-[right_12px_center] bg-no-repeat`;

export const Loading = ({ label = 'Loading…' }) => (
  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
    <Loader2 className="h-4 w-4 animate-spin" /> {label}
  </div>
);

export const ErrorBox = ({ error }) => (
  <div className="flex items-start gap-2 rounded-xl border border-[#E0566A] bg-[#FDF0F1] p-3 text-sm text-[#C0283C]">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
    <span>{error?.message || String(error)}</span>
  </div>
);

export const EmptyState = ({ title, hint, action }) => (
  <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-card/60 px-6 py-12 text-center">
    <Inbox className="h-8 w-8 text-subtle" />
    <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
    {hint && <p className="mt-1 max-w-md text-xs text-muted">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** Label / value pairs */
export const KV = ({ items, cols = 2 }) => (
  <dl className={`grid gap-x-4 gap-y-2.5 text-sm ${cols === 4 ? 'grid-cols-2 sm:grid-cols-4' : cols === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
    {items.filter(Boolean).map(([k, v]) => (
      <div key={k} className="min-w-0">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-subtle">{k}</dt>
        <dd className="mt-0.5 break-words font-medium text-ink">{v ?? '—'}</dd>
      </div>
    ))}
  </dl>
);

export const Section = ({ title, actions, children, className = '' }) => (
  <section className={`mt-5 ${className}`}>
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <h4 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h4>
      {actions}
    </div>
    {children}
  </section>
);

/** Simple responsive table. columns: [{ key, label, render?, className? }] */
export const Table = ({ columns, rows, onRowClick, empty = 'No records yet', rowKey = 'id' }) => {
  if (!rows?.length) return <EmptyState title={empty} />;
  return (
    <div className="overflow-x-auto rounded-card bg-card shadow-card">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wide text-subtle">
            {columns.map((c) => (
              <th key={c.key} className={`px-4 py-3 font-semibold ${c.className || ''}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <motion.tr
              key={r[rowKey]}
              variants={listItem}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={`border-b border-line/70 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-brand-50/60' : ''}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 align-top text-ink-2 ${c.className || ''}`}>
                  {c.render ? c.render(r) : r[c.key] ?? '—'}
                </td>
              ))}
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Form wrapper: handles submit + disabled state */
export const Form = ({ onSubmit, busy, submitLabel = 'Save', children, extra, className = '' }) => (
  <form
    className={`space-y-3.5 ${className}`}
    onSubmit={(e) => {
      e.preventDefault();
      onSubmit();
    }}
  >
    {children}
    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
      {extra}
      <Button type="submit" disabled={busy}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitLabel}
      </Button>
    </div>
  </form>
);

/** Small inline banner explaining what happens next in the workflow */
export const NextStep = ({ children, tone = 'info' }) => (
  <div className={`rounded-xl border px-3.5 py-2.5 text-[13px] leading-relaxed ${tone === 'warn' ? 'border-[#D9922B]/50 bg-[#FEF7EC] text-[#8A5300]' : 'border-brand-200 bg-brand-50 text-brand-900'}`}>
    {children}
  </div>
);

const DOC_LABEL = {
  PO_COPY: 'PO copy', WORK_ORDER: 'Work order', AT_SIGNOFF: 'AT sign-off', COMMISSIONING_REPORT: 'Commissioning report', SURVEY_PHOTO: 'Survey photo',
  QUOTE_PDF: 'Quote PDF', INVOICE_COPY: 'Invoice copy', SUBMISSION_PROOF: 'Submission proof (stamp)', COURIER_RECEIPT: 'Courier receipt', PAYMENT_PROOF: 'Payment proof', OTHER: 'Other'
};

const UPLOAD_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'csv'];
const UPLOAD_MAX_MB = 10; // same as the API's MAX_UPLOAD_MB

/** Upload / list / download documents for any record */
export const DocumentsPanel = ({ entityType, entityId, types, canEdit = true }) => {
  const { data: docs = [], isLoading } = useApi('/documents', { entityType, entityId });
  const [docType, setDocType] = useState(types[0]);
  // The upload box stays closed until "Upload document" is clicked, and closes again after a successful upload
  const [adding, setAdding] = useState(false);
  const fileRef = useRef();
  const uploadDoc = useAction((file) => {
    const form = new FormData();
    form.append('entityType', entityType);
    form.append('entityId', entityId);
    form.append('docType', docType);
    form.append('file', file);
    return api.post('/documents', form);
  }, { onSuccess: () => { if (fileRef.current) fileRef.current.value = ''; setAdding(false); } });
  const remove = useAction((id) => del(`/documents/${id}`));
  const toast = useToast();
  const pick = (file) => {
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!UPLOAD_EXT.includes(ext)) { toast('⚠ Only PDF, image, Word, Excel or CSV files are allowed'); fileRef.current.value = ''; return; }
    if (file.size > UPLOAD_MAX_MB * 1024 * 1024) { toast(`⚠ File is larger than ${UPLOAD_MAX_MB} MB`); fileRef.current.value = ''; return; }
    uploadDoc.mutate(file);
  };

  return (
    <div className="space-y-2.5">
      {canEdit && !adding && (
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}><Upload className="h-3.5 w-3.5" /> Upload document</Button>
      )}
      {canEdit && adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-strong bg-panel p-2.5">
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={`${selectClass} w-auto flex-1 min-w-[160px]`} aria-label="Document type">
            {types.map((t) => <option key={t} value={t}>{DOC_LABEL[t] || t}</option>)}
          </select>
          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.csv"
            onChange={(e) => pick(e.target.files[0])} />
          <Button type="button" size="sm" variant="outline" disabled={uploadDoc.isPending} onClick={() => fileRef.current?.click()}>
            {uploadDoc.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Choose file
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={uploadDoc.isPending} onClick={() => setAdding(false)}>Cancel</Button>
          <p className="w-full text-[11px] text-subtle">Choose the document type, then the file. PDF, image, Word, Excel or CSV · up to {UPLOAD_MAX_MB} MB.</p>
        </div>
      )}
      {isLoading ? <Loading /> : docs.length === 0 ? (
        <p className="text-xs text-subtle">No documents uploaded.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-card">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-brand-600" />
              <div className="min-w-0 flex-1">
                <a href={downloadUrl(d.id, true)} target="_blank" rel="noreferrer" className="block truncate font-medium text-ink hover:underline">{d.file_name}</a>
                <span className="text-[11px] text-muted">{DOC_LABEL[d.doc_type] || d.doc_type} · {d.uploaded_by_name} · {formatDateTime(d.created_at)}</span>
              </div>
              <a href={downloadUrl(d.id)} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-panel" aria-label="Download"><Download className="h-3.5 w-3.5" /></a>
              {canEdit && (
                <button type="button" onClick={() => window.confirm(`Delete ${d.file_name}?`) && remove.mutate(d.id)} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-[#FDF0F1] hover:text-[#C0283C]" aria-label="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** Activity timeline */
export const Timeline = ({ items }) => {
  if (!items?.length) return <p className="text-xs text-subtle">No activity yet.</p>;
  return (
    <ol className="relative space-y-3 border-l border-line pl-4">
      {items.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-brand-600" />
          <p className="text-[13px] leading-snug text-ink">{a.message}</p>
          <p className="mt-0.5 text-[11px] text-muted">{a.user_name || 'System'} · {formatDateTime(a.created_at)}</p>
        </li>
      ))}
    </ol>
  );
};

/** Workflow stepper */
export const Stepper = ({ steps, current }) => (
  <ol className="flex flex-wrap items-center gap-1.5">
    {steps.map((s, i) => {
      const done = i < current;
      const active = i === current;
      return (
        <li key={s} className="flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${done ? 'bg-brand-100 text-brand-800' : active ? 'btn-primary' : 'bg-panel text-subtle'}`}>
            <span className="tnum">{i + 1}</span> {s}
          </span>
          {i < steps.length - 1 && <span className={`h-px w-3 ${done ? 'bg-brand-400' : 'bg-line-strong'}`} />}
        </li>
      );
    })}
  </ol>
);
