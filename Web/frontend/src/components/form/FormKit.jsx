/**
 * Formik + Yup form kit. Every field shows a label, a hint (what to type / why) and its own validation message.
 * Field errors returned by the API (Joi: [{ field, message }]) are shown under the matching field too.
 */
import React, { useId } from 'react';
import { Formik, Form, useField, useFormikContext, getIn } from 'formik';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../common/ui';
import { inputClass } from '../common/Overlay';
import { selectClass } from '../common/kit';

const errorRing = 'border-[#C0283C]! focus:border-[#C0283C]!';

/** Error for a field: shown after the user leaves it, or after a submit attempt */
const useFieldError = (name) => {
  const [, meta] = useField(name);
  const { submitCount } = useFormikContext();
  return (meta.touched || submitCount > 0) && meta.error && typeof meta.error === 'string' ? meta.error : null;
};

export const FieldShell = ({ id, label, hint, error, className = '', children }) => (
  <div className={`block ${className}`}>
    {label && <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted">{label}</label>}
    {children}
    {error
      ? <p id={`${id}-err`} className="mt-1 flex items-start gap-1 text-[11px] font-medium text-[#C0283C]"><AlertCircle className="mt-px h-3 w-3 shrink-0" />{error}</p>
      : hint && <p id={`${id}-hint`} className="mt-1 block text-[11px] text-subtle">{hint}</p>}
  </div>
);

const describedBy = (id, error, hint) => (error ? `${id}-err` : hint ? `${id}-hint` : undefined);

/** Text / email / password / date / number input (or textarea with rows) */
export const TextField = ({ name, label, hint, className, inputClassName = '', rows, transform, onValueChange, ...rest }) => {
  const id = useId();
  const [field, , helpers] = useField(name);
  const error = useFieldError(name);
  const Tag = rows ? 'textarea' : 'input';
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <Tag
        id={id}
        name={field.name}
        rows={rows}
        value={field.value ?? ''}
        onChange={(e) => {
          const v = transform ? transform(e.target.value) : e.target.value;
          helpers.setValue(v);
          onValueChange?.(v);
        }}
        onBlur={field.onBlur}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(id, error, hint)}
        className={`${inputClass} ${error ? errorRing : ''} ${inputClassName}`}
        {...rest}
      />
    </FieldShell>
  );
};

export const NumberField = (props) => <TextField type="number" inputMode="decimal" step="any" {...props} />;
export const DateField = (props) => <TextField type="date" {...props} />;

/** <select>; options = [{ value, label }] or [value] */
export const SelectField = ({ name, label, hint, options = [], placeholder, className, onValueChange, ...rest }) => {
  const id = useId();
  const [field, , helpers] = useField(name);
  const error = useFieldError(name);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <select
        id={id}
        name={field.name}
        value={field.value ?? ''}
        onChange={(e) => { helpers.setValue(e.target.value); onValueChange?.(e.target.value); }}
        onBlur={field.onBlur}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(id, error, hint)}
        className={`${selectClass} ${error ? errorRing : ''}`}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (typeof o === 'object'
          ? <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
          : <option key={o} value={o}>{o}</option>))}
      </select>
    </FieldShell>
  );
};

export const CheckboxField = ({ name, label, hint, className = '' }) => {
  const id = useId();
  const [field] = useField({ name, type: 'checkbox' });
  return (
    <div className={className}>
      <label htmlFor={id} className="flex items-center gap-2 text-sm text-ink">
        <input id={id} type="checkbox" {...field} className="h-4 w-4 accent-[var(--brand-700)]" aria-describedby={hint ? `${id}-hint` : undefined} />
        {label}
      </label>
      {hint && <p id={`${id}-hint`} className="mt-1 text-[11px] text-subtle">{hint}</p>}
    </div>
  );
};

/** Shows the first error of an array / object level rule (e.g. "A + B + C must equal 100%") */
export const FormError = ({ name }) => {
  const { errors, submitCount, touched } = useFormikContext();
  const e = getIn(errors, name);
  if (!e || typeof e !== 'string' || !(submitCount > 0 || getIn(touched, name))) return null;
  return <p className="flex items-center gap-1 text-xs font-semibold text-[#C0283C]"><AlertCircle className="h-3.5 w-3.5" />{e}</p>;
};

/** Maps API field errors ([{ field: 'admin.email', message }]) onto the form */
const applyServerErrors = (err, setFieldError) => {
  (err?.errors || []).forEach((x) => {
    if (!x?.field) return;
    const leaf = x.field.split('.').pop();
    const msg = x.message.startsWith(`${x.field} `) ? x.message.slice(x.field.length + 1)
      : x.message.startsWith(`${leaf} `) ? x.message.slice(leaf.length + 1) : x.message;
    setFieldError(x.field, msg.charAt(0).toUpperCase() + msg.slice(1));
  });
};

/**
 * <FormikForm initialValues schema onSubmit(values cast by the schema) submitLabel busy extra inline>
 *   children (or (formik) => children)
 * onSubmit may return a promise (e.g. mutation.mutateAsync) — field errors from the API are shown inline.
 * inline: a quick action (assign, stop, reason…) — the fields and the button sit on one line (stacked on phones).
 */
export const FormikForm = ({ initialValues, schema, onSubmit, submitLabel = 'Save', busy, extra, children, className = '', enableReinitialize, hideSubmit, inline }) => (
  <Formik
    initialValues={initialValues}
    validationSchema={schema}
    enableReinitialize={enableReinitialize}
    validateOnBlur
    validateOnChange={false}
    onSubmit={async (values, helpers) => {
      const cast = schema ? schema.cast(values, { assert: false }) : values;
      try {
        await onSubmit(cast, values, helpers);
      } catch (err) {
        applyServerErrors(err, helpers.setFieldError);
      }
    }}
  >
    {(formik) => {
      const fields = typeof children === 'function' ? children(formik) : children;
      const submit = (
        <Button type="submit" className={inline ? 'h-[38px] shrink-0' : ''} disabled={busy || formik.isSubmitting}>
          {(busy || formik.isSubmitting) && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      );
      const invalid = formik.submitCount > 0 && !formik.isValid;
      if (inline) {
        return (
          <Form noValidate className={className}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">{fields}</div>
              {!hideSubmit && <div className="flex shrink-0 items-center gap-2">{extra}{submit}</div>}
            </div>
          </Form>
        );
      }
      return (
        <Form noValidate className={`space-y-3.5 ${className}`}>
          {fields}
          {invalid && <p className="text-xs font-medium text-[#C0283C]" role="alert">Please fix the highlighted fields.</p>}
          {!hideSubmit && (
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              {extra}
              {submit}
            </div>
          )}
        </Form>
      );
    }}
  </Formik>
);

export { useFormikContext };
