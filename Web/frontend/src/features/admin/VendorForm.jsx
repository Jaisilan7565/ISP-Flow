import React from 'react';
import { TextField, NumberField, SelectField, CheckboxField } from '../../components/form/FormKit';
import { R, MSG, yup } from '../../validation/rules';

/**
 * The ISP / vendor form — one definition used by ISPs & Vendors (add / edit)
 * and by "New ISP" inside a feasibility survey, so both always ask the same things.
 */
export const VENDOR = { name: '', vendorType: 'ISP', gstin: '', contactName: '', contactPhone: '', contactEmail: '', paymentTermsDays: 30, bankDetails: '', address: '', city: '', state: '', pincode: '', mapsUrl: '', latitude: '', longitude: '', notes: '', isActive: true };
export const fromVendor = (v) => ({ name: v.name, vendorType: v.vendor_type, gstin: v.gstin || '', contactName: v.contact_name || '', contactPhone: v.contact_phone || '', contactEmail: v.contact_email || '', paymentTermsDays: v.payment_terms_days, bankDetails: v.bank_details || '', address: v.address || '', city: v.city || '', state: v.state || '', pincode: v.pincode || '', mapsUrl: v.maps_url || '', latitude: v.latitude ?? '', longitude: v.longitude ?? '', notes: v.notes || '', isActive: v.is_active });
export const TYPE = { ISP: 'ISP (link provider)', PARTNER: 'Other vendor', CONTRACTOR: 'Contractor' };

/** Mirrors POST / PUT /admin/vendors (Joi) */
export const vendorSchema = yup.object({
  name: R.name(255).required(MSG.required),
  vendorType: R.select(Object.keys(TYPE)).required(MSG.required),
  gstin: R.gstin(),
  contactName: R.name(128),
  contactPhone: R.phone(),
  contactEmail: R.email(),
  paymentTermsDays: R.int(0, 365).required(MSG.required),
  bankDetails: R.text(1000),
  address: R.text(1000),
  city: R.text(64),
  state: R.text(64),
  pincode: R.pincode(),
  mapsUrl: R.url(),
  latitude: R.number().min(-90, 'Latitude must be between -90 and 90').max(90, 'Latitude must be between -90 and 90'),
  longitude: R.number().min(-180, 'Longitude must be between -180 and 180').max(180, 'Longitude must be between -180 and 180'),
  notes: R.text(2000),
  isActive: yup.boolean()
});

/**
 * All vendor fields. ispOnly: the type is fixed to ISP (adding from a survey) and the
 * Active tick is not shown (a new ISP picked in a survey must be active).
 */
export const VendorFields = ({ ispOnly = false }) => (
  <>
    <TextField name="name" label={ispOnly ? 'ISP name *' : 'Name *'} placeholder={ispOnly ? 'e.g. ACT Fibernet' : undefined}
      hint="Company name as on their invoices; must not already be in ISPs & Vendors" />
    <div className="grid gap-3 sm:grid-cols-2">
      {ispOnly
        ? <SelectField name="vendorType" label="Type" hint="Added from a survey, so it is an ISP" options={[{ value: 'ISP', label: TYPE.ISP }]} disabled />
        : <SelectField name="vendorType" label="Type" hint="ISP = supplies the link; contractor = site work" options={Object.entries(TYPE).map(([value, label]) => ({ value, label }))} />}
      <TextField name="gstin" label="GSTIN" hint="15 characters, e.g. 29ABCDE1234F1Z5 (optional)" transform={(v) => v.toUpperCase()} maxLength={15} />
      <TextField name="contactName" label="Contact person" hint="Who you deal with there (optional)" />
      <TextField name="contactPhone" type="tel" label="Phone" hint="10–15 digits (optional)" />
      <TextField name="contactEmail" type="email" label="Email" hint="For POs and payment advice (optional)" />
      <NumberField name="paymentTermsDays" min="0" max="365" label="Payment terms (days)" hint="Days after their bill that payment is due (0–365)" />
    </div>
    <TextField name="bankDetails" rows={2} label="Bank details" placeholder="A/c no, IFSC, bank" hint="Used when paying them from Payments (optional)" />
    <p className="pt-1 text-[13px] font-semibold uppercase tracking-wide text-muted">Address</p>
    <TextField name="address" rows={2} label="Address" hint="Office / POP address (optional). Will be used to find ISPs near a new site." />
    <div className="grid gap-3 sm:grid-cols-3">
      <TextField name="city" label="City" hint="Optional" />
      <TextField name="state" label="State" hint="Optional" />
      <TextField name="pincode" maxLength={6} inputMode="numeric" label="Pincode" hint="6 digits (optional)" />
    </div>
    <TextField name="mapsUrl" label="Google Maps link" placeholder="https://maps.google.com/…" hint="Optional — the map location is read from the link" />
    <div className="grid gap-3 sm:grid-cols-2">
      <NumberField name="latitude" label="Latitude" hint="Optional, −90 to 90 (filled from the link if blank)" />
      <NumberField name="longitude" label="Longitude" hint="Optional, −180 to 180" />
    </div>
    <TextField name="notes" rows={2} label="Notes" hint="Anything useful about this ISP / vendor (optional)" />
    {!ispOnly && <CheckboxField name="isActive" label="Active" hint="Inactive vendors are hidden from survey and quote lists" />}
  </>
);
