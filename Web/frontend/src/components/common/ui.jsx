import React from 'react';
import { motion } from 'framer-motion';
import { rise, spring } from '../../utils/motion';

/**
 * Small layout primitives shared across every page in ISP-Flow.
 */

/** White widget card — r=20px, 20px padding, no visible border (depth from layering) */
export const Card = ({ children, className = '', as = 'div', ...props }) => {
  const Tag = motion[as] || motion.div;
  return (
    <Tag variants={rise} className={`rounded-card bg-card shadow-card p-5 ${className}`} {...props}>
      {children}
    </Tag>
  );
};

/** Card heading — 17px, medium weight, ink */
export const CardTitle = ({ children, className = '' }) => (
  <h3 className={`text-[17px] font-medium text-ink ${className}`}>{children}</h3>
);

const BUTTON = {
  primary: 'btn-primary shadow-[0_6px_16px_-8px_var(--brand-900)]',
  outline: 'bg-card text-ink border border-brand-900/80 hover:bg-brand-50',
  ghost: 'text-ink-2 hover:bg-brand-50',
  light: 'bg-white text-brand-950 hover:bg-brand-50'
};

const BUTTON_SIZE = {
  sm: 'h-8 px-3.5 text-[13px] gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  lg: 'h-[46px] px-6 text-[15px] gap-2'
};

export const Button = ({ variant = 'primary', size = 'md', className = '', children, ...props }) => (
  <motion.button
    whileTap={{ scale: 0.97 }}
    transition={spring.snappy}
    className={`inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap transition-colors disabled:opacity-50 ${BUTTON[variant]} ${BUTTON_SIZE[size]} ${className}`}
    {...props}
  >
    {children}
  </motion.button>
);

/** Circular outlined link button on stat cards */
export const CircleIconButton = ({ children, dark = false, className = '', ...props }) => (
  <motion.button
    whileHover={{ rotate: 45 }}
    transition={spring.snappy}
    className={`grid place-items-center w-8 h-8 rounded-full ${
      dark ? 'bg-white text-brand-900' : 'border border-ink/80 text-ink'
    } ${className}`}
    {...props}
  >
    {children}
  </motion.button>
);

/** Tiny delta chip used under stat numbers */
export const DeltaChip = ({ value, dark = false }) => (
  <span
    className={`inline-flex items-center gap-0.5 rounded-[5px] border px-1 text-[10px] leading-[14px] tnum ${
      dark ? 'border-white/70 text-white' : 'border-muted text-muted'
    }`}
  >
    {value}
    <svg viewBox="0 0 8 8" className="w-2 h-2" aria-hidden="true">
      <path d="M1.5 5.5 4 3l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  </span>
);

/** Outlined status badge for Telecom lifecycle */
const STATUS_BADGE = {
  good: 'border-brand-600 text-brand-700 bg-brand-50',
  warn: 'border-[#D9922B] text-[#B26B00] bg-[#FEF7EC]',
  bad: 'border-[#E0566A] text-[#C0283C] bg-[#FDF0F1]',
  info: 'border-[#6B83E6] text-[#3B5BDB] bg-[#F1F4FD]',
  off: 'border-line-strong text-muted bg-panel'
};

export const TONE = {
  // Feasibility
  NEW: 'warn',
  ASSIGNED: 'info',
  SURVEY_DONE: 'info',
  PRICE_FINALIZED: 'info',
  COMPLETED: 'good',
  NOT_FEASIBLE: 'bad',
  CANCELLED: 'off',
  // Quotes
  DRAFT: 'off',
  SENT: 'info',
  WON: 'good',
  LOST: 'bad',
  // Implementation
  AWAITING_PO: 'warn',
  PO_RECEIVED: 'info',
  WORK_STARTED: 'info',
  BLOCKED: 'bad',
  LIVE: 'good',
  TERMINATED: 'off',
  // Billing
  PENDING_SUBMISSION: 'warn',
  SUBMITTED: 'info',
  PARTIALLY_PAID: 'warn',
  PAID: 'good',
  OVERDUE: 'bad',
  // Tenants / users
  ACTIVE: 'good',
  SUSPENDED: 'bad'
};

export const STATUS_LABEL = {
  NEW: 'New',
  ASSIGNED: 'Assigned',
  SURVEY_DONE: 'Survey done',
  PRICE_FINALIZED: 'Price finalized',
  COMPLETED: 'Feasibility complete',
  NOT_FEASIBLE: 'Not feasible',
  CANCELLED: 'Cancelled',
  DRAFT: 'Draft',
  SENT: 'Sent to client',
  WON: 'Bid won',
  LOST: 'Lost',
  AWAITING_PO: 'Awaiting PO',
  PO_RECEIVED: 'PO received',
  WORK_STARTED: 'ISP work started',
  BLOCKED: 'Pending',
  LIVE: 'Live',
  PENDING_SUBMISSION: 'Not submitted',
  SUBMITTED: 'Submitted',
  PARTIALLY_PAID: 'Part paid',
  PAID: 'Paid'
};

export const Status = ({ value, className = '' }) => (
  <StatusBadge tone={TONE[value] || 'off'} className={className}>{STATUS_LABEL[value] || String(value || '—').replace(/_/g, ' ')}</StatusBadge>
);

export const StatusBadge = ({ tone = 'good', children, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-[5px] border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
      STATUS_BADGE[tone] || STATUS_BADGE.off
    } ${className}`}
  >
    <span className="w-1.5 h-1.5 rounded-full bg-current" />
    {children}
  </span>
);

export const ProgressBar = ({ value = 0, max = 100, className = '', barClassName = 'bg-brand-600' }) => {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-line ${className}`}>
      <motion.div
        className={`h-full rounded-full ${barClassName}`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
};
