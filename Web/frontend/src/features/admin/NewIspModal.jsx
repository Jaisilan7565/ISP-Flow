import React from 'react';
import { Modal } from '../../components/common/Overlay';
import { FormikForm } from '../../components/form/FormKit';
import { useAction } from '../../api/hooks';
import { post } from '../../api/client';
import { VENDOR, vendorSchema, VendorFields } from './VendorForm';

/**
 * Add a missing ISP without leaving the survey. Same fields as ISPs & Vendors
 * (contact, GSTIN, payment terms, bank, address, map location, notes); only the name is required.
 */
export const NewIspModal = ({ open, onClose, onCreated }) => {
  const save = useAction((body) => post('/admin/vendors', body), {
    onSuccess: (res) => { onCreated?.(res.data); onClose(); }
  });
  return (
    <Modal open={open} onClose={onClose} title="New ISP" width="max-w-[560px]">
      {open && (
        <FormikForm initialValues={VENDOR} schema={vendorSchema} busy={save.isPending} submitLabel="Add ISP"
          onSubmit={(v) => save.mutateAsync({ ...v, vendorType: 'ISP', isActive: true })}>
          <VendorFields ispOnly />
          <p className="text-xs text-muted">Only the name is required. The ISP is added to <b>ISPs & Vendors</b> and picked in the survey.</p>
        </FormikForm>
      )}
    </Modal>
  );
};

export default NewIspModal;
