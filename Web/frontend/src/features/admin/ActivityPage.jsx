import React from 'react';
import { motion } from 'framer-motion';
import { page, rise } from '../../utils/motion';
import { Card } from '../../components/common/ui';
import PageHeader from '../../components/common/PageHeader';
import { Loading, ErrorBox, Timeline } from '../../components/common/kit';
import { useApi } from '../../api/hooks';

export const ActivityPage = () => {
  const q = useApi('/admin/activity', { limit: 300 });
  return (
    <motion.div variants={page} initial="hidden" animate="visible" exit="exit" className="space-y-4">
      <PageHeader title="Activity Log" subtitle="Who did what and when — every step of the workflow is recorded." />
      <motion.div variants={rise}>
        <Card>{q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : <Timeline items={q.data} />}</Card>
      </motion.div>
    </motion.div>
  );
};

export default ActivityPage;
