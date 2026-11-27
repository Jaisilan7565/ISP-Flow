import React, { useState } from 'react';
import { Formik, Form } from 'formik';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { Radio, Loader2, LogIn } from 'lucide-react';
import { post } from '../../api/client';
import { signedIn } from '../../store/slices/authSlice';
import { setActiveTab } from '../../store/slices/uiSlice';
import { TextField } from '../../components/form/FormKit';
import { R, MSG, yup } from '../../validation/rules';
import { Button } from '../../components/common/ui';
import { ErrorBox, NextStep } from '../../components/common/kit';
import TopographicCard from '../../components/common/TopographicCard';
import { rise } from '../../utils/motion';

const schema = yup.object({
  email: R.email().required(MSG.required),
  password: yup.string().required(MSG.required)
});

export const LoginPage = () => {
  const dispatch = useDispatch();
  const notice = useSelector((s) => s.auth.notice);
  const [error, setError] = useState(null);

  const submit = async (v) => {
    setError(null);
    try {
      const res = await post('/auth/login', { email: v.email.trim().toLowerCase(), password: v.password });
      dispatch(signedIn(res.data));
      dispatch(setActiveTab(res.data.user.role === 'PLATFORM_OWNER' ? 'platform' : 'dashboard'));
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center overflow-y-auto bg-canvas p-4">
      <motion.div initial="hidden" animate="visible" variants={rise} className="grid w-full max-w-[920px] overflow-hidden rounded-panel bg-card shadow-lift md:grid-cols-2">
        <TopographicCard className="hidden rounded-none p-10 md:block" pattern="lines">
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15"><Radio className="h-5 w-5" /></div>
              <span className="text-lg font-semibold">ISP-Flow</span>
            </div>
            <h1 className="mt-auto text-3xl font-semibold leading-tight">Every link, from WhatsApp feed to vendor payout.</h1>
            <ol className="mt-6 space-y-1.5 text-sm text-white/80">
              <li>1 · Feasibility & ISP pricing</li>
              <li>2 · Quote, bid win & A/B/C budget</li>
              <li>3 · PO, ISP work & site live</li>
              <li>4 · OTC & cycle billing with submission tracking</li>
              <li>5 · Sitewise payment → vendor, loan, salary reserve</li>
            </ol>
          </div>
        </TopographicCard>
        <Formik initialValues={{ email: '', password: '' }} validationSchema={schema} validateOnChange={false} onSubmit={submit}>
        {({ isSubmitting }) => (
        <Form noValidate className="space-y-4 p-8 sm:p-10">
          <div>
            <h2 className="text-2xl font-semibold text-ink">Sign in</h2>
            <p className="mt-1 text-sm text-muted">Use the login given by your company admin or platform admin.</p>
          </div>
          {!error && notice && <NextStep tone="warn">{notice}</NextStep>}
          {error && <ErrorBox error={error} />}
          <TextField name="email" type="email" autoComplete="username" label="Email" hint="The email your admin registered for you" />
          <TextField name="password" type="password" autoComplete="current-password" label="Password" hint="Forgot it? Ask your company admin to reset it" />
          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Sign in
          </Button>
        </Form>
        )}
        </Formik>
      </motion.div>
    </div>
  );
};

export default LoginPage;
