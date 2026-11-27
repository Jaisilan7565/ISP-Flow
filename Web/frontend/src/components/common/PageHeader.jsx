import React from 'react';
import RevealText from './RevealText';

export const PageHeader = ({ title, subtitle, actions, children }) => {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <RevealText text={title} as="h1" className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl" />
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {(actions || children) && (
        <div className="flex items-center gap-2.5 shrink-0">
          {actions}
          {children}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
