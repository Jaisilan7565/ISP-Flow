import React, { useCallback, useState } from 'react';
import { useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { Plus, Pencil, MapPin, Trash2 } from 'lucide-react';
import { page, rise } from '../../utils/motion';
import { Button, Status } from '../../components/common/ui';
import PageHeader from '../../components/common/PageHeader';
import { Modal } from '../../components/common/Overlay';
import { Table, Loading, ErrorBox } from '../../components/common/kit';
import { FormikForm } from '../../components/form/FormKit';
import { VENDOR, fromVendor, vendorSchema, VendorFields } from './VendorForm';
import { VendorDrawer } from './VendorDrawer';
import { useApi, useAction } from '../../api/hooks';
import { post, put, del } from '../../api/client';
import { hasPerm } from '../../store/slices/authSlice';
import { useFocusRecord } from '../shared';

/** ISPs we buy links from, contractors and other vendors we pay. Clients live under Clients & Orders. */
export const MastersPage = () => {
  const user = useSelector((s) => s.auth.user);
  const canEdit = hasPerm(user, 'masters.manage');
  const vendors = useApi('/admin/vendors');
  const [edit, setEdit] = useState(null); // { id?, form }
  const [viewId, setViewId] = useState(null);
  const focus = useCallback((id) => setViewId(id), []);
  useFocusRecord('masters', focus);

  const save = useAction(({ id, form }) => (id ? put(`/admin/vendors/${id}`, form) : post('/admin/vendors', form)), { onSuccess: () => setEdit(null) });
  const remove = useAction((id) => del(`/admin/vendors/${id}`));

  return (
    <motion.div variants={page} initial="hidden" animate="visible" exit="exit" className="space-y-4">
      <PageHeader title="ISPs & Vendors" subtitle="Everyone you pay: ISPs that supply the link (Airtel, Jio, Tata, BSNL…), contractors for site work, other vendors. Click an ISP to see its sites, surveys and what you owe it."
        actions={canEdit && <Button onClick={() => setEdit({ form: VENDOR })}><Plus className="h-4 w-4" /> Add ISP / vendor</Button>} />
      {vendors.isLoading ? <Loading /> : vendors.error ? <ErrorBox error={vendors.error} /> : (
        <motion.div variants={rise}>
          <Table rows={vendors.data} onRowClick={(v) => setViewId(v.id)} empty="No ISPs yet. Add the ISPs you buy links from and your contractors."
            columns={[
              { key: 'name', label: 'Name', render: (v) => <div><p className="font-semibold text-ink">{v.name}</p><p className="text-[11px] text-muted">{v.gstin || 'No GSTIN'}</p></div> },
              { key: 'type', label: 'Type', render: (v) => <span className="rounded-md bg-panel px-2 py-0.5 text-[11px] font-semibold">{v.vendor_type}</span> },
              { key: 'contact', label: 'Contact', render: (v) => <span className="text-xs">{[v.contact_name, v.contact_phone].filter(Boolean).join(' · ') || '—'}</span> },
              { key: 'location', label: 'Location', render: (v) => <span className="text-xs">{[v.city, v.pincode].filter(Boolean).join(' · ') || '—'}{v.latitude !== null && v.latitude !== undefined && <MapPin className="ml-1 inline h-3 w-3 text-brand-700" aria-label="Map location saved" />}</span> },
              { key: 'terms', label: 'Pay terms', render: (v) => `${v.payment_terms_days} days` },
              { key: 'sites', label: 'Live links', render: (v) => <span className="text-xs tnum">{v.live_sites ? <b>{v.live_sites}</b> : '—'}{v.site_count > v.live_sites ? <span className="text-muted"> · {v.site_count - v.live_sites} other</span> : ''}</span> },
              { key: 'used', label: 'Used in', render: (v) => <span className="text-xs">{v.used_in || <span className="text-subtle">Not used yet</span>}</span> },
              { key: 'st', label: 'Status', render: (v) => <Status value={v.is_active ? 'ACTIVE' : 'SUSPENDED'} /> },
              { key: 'e', label: '', render: (v) => canEdit && (
                <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" aria-label={`Edit ${v.name}`} onClick={() => setEdit({ id: v.id, form: fromVendor(v) })}><Pencil className="h-3.5 w-3.5" /></Button>
                  {/* Only a vendor that nothing uses can be deleted; otherwise it is marked inactive */}
                  <Button size="sm" variant="ghost" aria-label={`Delete ${v.name}`} disabled={Boolean(v.used_in) || remove.isPending}
                    className="text-[#C0283C]! hover:bg-[#FDF0F1]! disabled:text-subtle!"
                    title={v.used_in ? `Cannot delete: used in ${v.used_in}. Edit it and untick Active instead.` : `Delete ${v.name}`}
                    onClick={() => window.confirm(`Delete ${v.name}? It is not used in any survey, quote, site or payout. This cannot be undone.`) && remove.mutate(v.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </span>
              ) }
            ]} />
        </motion.div>
      )}

      <VendorDrawer id={viewId} onClose={() => setViewId(null)} onEdit={(v) => { setViewId(null); setEdit({ id: v.id, form: fromVendor(v) }); }} />

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={`${edit?.id ? 'Edit' : 'Add'} ISP / vendor`} width="max-w-[560px]">
        {edit && (
          <FormikForm initialValues={edit.form} schema={vendorSchema} busy={save.isPending} onSubmit={(v) => save.mutateAsync({ id: edit.id, form: v })}>
            <VendorFields />
          </FormikForm>
        )}
      </Modal>
    </motion.div>
  );
};

export default MastersPage;
