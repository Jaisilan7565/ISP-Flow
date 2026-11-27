import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { spring } from '../../utils/motion';

/**
 * Floating pill filter bar with sliding layoutId indicator.
 */
export const PillTabs = ({ options, value, onChange, size = 'md', className = '' }) => {
  const group = useId();
  const pad = size === 'sm' ? 'h-8 px-3.5 text-[12.5px]' : 'h-9 px-4 text-[13px]';
  return (
    <div role="tablist" className={`inline-flex items-center gap-0.5 rounded-full bg-card p-1 shadow-card overflow-x-auto no-scrollbar max-w-full ${className}`}>
      {options.map((opt) => {
        const id = typeof opt === 'string' ? opt : opt.id;
        const label = typeof opt === 'string' ? opt : opt.label;
        const count = typeof opt === 'object' && opt.count !== undefined ? opt.count : null;
        const active = id === value;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={`relative shrink-0 rounded-full font-medium transition-colors ${pad} ${active ? 'text-white' : 'text-muted hover:text-ink'}`}
          >
            {active && (
              <motion.span
                layoutId={`pill-${group}`}
                transition={spring.layout}
                className="absolute inset-0 rounded-full btn-primary"
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {label}
              {count !== null && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full tnum ${active ? 'bg-white/20 text-white' : 'bg-line text-muted'}`}>
                  {count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default PillTabs;
