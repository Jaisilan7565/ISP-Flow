import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import { Modal } from '../../components/common/Overlay';
import { ErrorBox, NextStep } from '../../components/common/kit';
import { FormikForm, TextField } from '../../components/form/FormKit';
import { R, MSG, yup } from '../../validation/rules';
import { post } from '../../api/client';
import { profileLoaded, signedOut } from '../../store/slices/authSlice';
import { useToast } from '../../components/common/Toast';

const schema = yup.object({
  currentPassword: yup.string().required(MSG.required),
  newPassword: R.password().required(MSG.required)
    .notOneOf([yup.ref('currentPassword')], 'New password must be different from the current password'),
  confirm: yup.string().required(MSG.required).oneOf([yup.ref('newPassword')], 'Passwords do not match')
});

/** forced=true when the account still has a temporary password */
export const ChangePasswordModal = ({ open, onClose, forced }) => {
  const dispatch = useDispatch();
  const toast = useToast();
  const [error, setError] = useState(null);

  const submit = async (v) => {
    setError(null);
    try {
      const res = await post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword });
      dispatch(profileLoaded(res.data));
      toast('Password changed');
      onClose?.();
    } catch (e) {
      if (!e.errors) setError(e);
      throw e;
    }
  };

  return (
    <Modal open={open} onClose={forced ? () => {} : onClose} title={forced ? 'Set your own password' : 'Change password'}>
      {forced && <div className="mb-4"><NextStep tone="warn">You are using a temporary password. Choose your own password to continue.</NextStep></div>}
      {error && <div className="mb-3"><ErrorBox error={error} /></div>}
      <FormikForm
        initialValues={{ currentPassword: '', newPassword: '', confirm: '' }}
        schema={schema}
        onSubmit={submit}
        submitLabel="Update password"
        extra={forced && <button type="button" className="mr-auto text-xs text-muted underline" onClick={() => dispatch(signedOut())}>Sign out</button>}
      >
        <TextField name="currentPassword" type="password" autoComplete="current-password" label={forced ? 'Temporary password' : 'Current password'}
          hint={forced ? 'The password you were given by your admin' : 'The password you signed in with'} />
        <TextField name="newPassword" type="password" autoComplete="new-password" label="New password"
          hint="8–72 characters with at least one letter and one number" />
        <TextField name="confirm" type="password" autoComplete="new-password" label="Confirm new password" hint="Type the new password again" />
      </FormikForm>
    </Modal>
  );
};

export default ChangePasswordModal;
