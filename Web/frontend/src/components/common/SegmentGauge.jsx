import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { Card, CardTitle } from './ui';
import AnimatedNumber from './AnimatedNumber';
import { ease } from '../../utils/motion';

const ARC = 'M 30 128 A 90 90 0 0 1 210 128';
const STROKE = 44;

const Segment = ({ offset, length, stroke, delay }) => (
  <motion.path
    d={ARC}
    fill="none"
    stroke={stroke}
    strokeWidth={STROKE}
    strokeLinecap="round"
    initial={{ pathLength: 0, pathOffset: offset, opacity: 0 }}
    animate={{ pathLength: length, pathOffset: offset, opacity: length > 0 ? 1 : 0 }}
    transition={{ duration: 1.1, ease: ease.inOut, delay, opacity: { duration: 0.01, delay } }}
  />
);

const Legend = ({ swatch, label }) => (
  <span className="flex items-center gap-1.5 text-xs">
    {swatch}
    {label}
  </span>
);

export const SegmentGauge = ({ title, centerLabel, segments, footer, className = '' }) => {
  const id = useId().replace(/:/g, '');
  const [a = { value: 0, label: 'A' }, b = { value: 0, label: 'B' }, c = { value: 0, label: 'C' }] = segments || [];
  const total = Math.max(a.value + b.value + c.value, 1);
  const fa = a.value / total;
  const fb = b.value / total;
  const fc = c.value / total;
  const pct = Math.round(fa * 100);

  return (
    <Card className={`flex flex-col ${className}`}>
      <CardTitle>{title}</CardTitle>
      <div className="relative mx-auto mt-4 w-full max-w-[240px]">
        <svg viewBox="0 0 240 152" className="w-full overflow-visible" role="img" aria-label={`${pct}% ${centerLabel}`}>
          <defs>
            <pattern id={`${id}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="var(--card)" />
              <rect width="1.8" height="7" fill="#8E9A93" />
            </pattern>
          </defs>
          <Segment offset={fa + fb} length={fc} stroke={`url(#${id}-hatch)`} delay={0.75} />
          <Segment offset={fa} length={fb} stroke="var(--brand-900)" delay={0.5} />
          <Segment offset={0} length={fa} stroke="var(--brand-700)" delay={0.3} />
        </svg>
        <div className="absolute inset-x-0 bottom-1 flex flex-col items-center">
          <AnimatedNumber value={pct} suffix="%" className="text-[42px] font-semibold leading-none tracking-[-0.04em] text-ink" />
          <span className="mt-1 text-[11px] text-muted">{centerLabel}</span>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-3 text-[12px] text-muted">
        <Legend swatch={<span className="h-2.5 w-2.5 rounded-full bg-brand-700" />} label={a.label} />
        <Legend swatch={<span className="h-2.5 w-2.5 rounded-full bg-brand-900" />} label={b.label} />
        <Legend swatch={<span className="hatch h-2.5 w-2.5 rounded-full border border-[#C9CFCB]" />} label={c.label} />
      </div>
      {footer}
    </Card>
  );
};

export default SegmentGauge;
