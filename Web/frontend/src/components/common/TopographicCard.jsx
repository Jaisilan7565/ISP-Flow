import React, { useId } from 'react';

/**
 * Dark contour surface — signature visual element of ISP-Flow.
 */
const Rings = ({ id }) => (
  <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="xMaxYMax slice" viewBox="0 0 200 180" aria-hidden="true">
    <defs>
      <radialGradient id={`${id}-fade`} cx="85%" cy="100%" r="100%">
        <stop offset="0%" stopColor="white" stopOpacity="0.22" />
        <stop offset="100%" stopColor="white" stopOpacity="0.06" />
      </radialGradient>
    </defs>
    {Array.from({ length: 16 }, (_, i) => (
      <circle key={i} cx="170" cy="180" r={14 + i * 13} fill="none" stroke={`url(#${id}-fade)`} strokeWidth="0.8" />
    ))}
  </svg>
);

const Lines = ({ id }) => (
  <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 400 260" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-fade`} x1="0" y1="1" x2="1" y2="0">
        <stop offset="0%" stopColor="white" stopOpacity="0.16" />
        <stop offset="100%" stopColor="white" stopOpacity="0.07" />
      </linearGradient>
    </defs>
    {Array.from({ length: 34 }, (_, i) => (
      <circle key={i} cx="520" cy="560" r={260 + i * 11} fill="none" stroke={`url(#${id}-fade)`} strokeWidth="0.9" />
    ))}
  </svg>
);

export const TopographicCard = ({ children, pattern = 'lines', glow = true, className = '', as: Tag = 'div', ...props }) => {
  const id = useId().replace(/:/g, '');
  return (
    <Tag className={`relative overflow-hidden bg-brand-950 text-white rounded-card shadow-hero ${className}`} {...props}>
      {glow && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(70% 80% at 100% 100%, color-mix(in srgb, var(--brand-700) 45%, transparent) 0%, transparent 70%)'
          }}
        />
      )}
      <div className="pointer-events-none absolute inset-0">
        {pattern === 'rings' ? <Rings id={id} /> : <Lines id={id} />}
      </div>
      <div className="relative z-10 h-full">{children}</div>
    </Tag>
  );
};

export default TopographicCard;
