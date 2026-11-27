import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { backdrop, drawer, modal } from '../../utils/motion';

/**
 * Escape closes only the top-most layer: a modal opened over a drawer (e.g. "New ISP" during a survey)
 * listens first (capture) and marks the key as handled, so the drawer underneath stays open.
 */
const useEscape = (open, onClose, top = false) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, top);
    return () => window.removeEventListener('keydown', onKey, top);
  }, [open, onClose, top]);
};

export const Modal = ({ open, onClose, title, children, width = 'max-w-[480px]' }) => {
  useEscape(open, onClose, true);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <motion.div variants={backdrop} onClick={onClose} className="absolute inset-0 bg-[#071326]/40 backdrop-blur-[3px]" />
          <motion.div
            variants={modal}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`relative flex max-h-[calc(100dvh-2rem)] w-full ${width} flex-col rounded-panel bg-card shadow-lift`}
          >
            <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-6">
              <h2 className="text-lg font-medium text-ink">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="grid w-8 h-8 place-items-center rounded-full text-muted hover:bg-panel transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain px-6 pb-6">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export const Drawer = ({ open, onClose, children, label = 'Details', width = 'sm:w-[420px]' }) => {
  useEscape(open, onClose);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50" initial="hidden" animate="visible" exit="exit">
          <motion.div variants={backdrop} onClick={onClose} className="absolute inset-0 bg-[#071326]/30 backdrop-blur-[2px]" />
          <motion.aside
            variants={drawer}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className={`absolute right-3 top-3 bottom-3 w-[calc(100%-24px)] ${width} overflow-y-auto rounded-panel bg-card p-6 shadow-lift`}
          >
            <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 grid w-8 h-8 place-items-center rounded-full text-muted hover:bg-panel transition-colors">
              <X className="w-4 h-4" />
            </button>
            {children}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export const Field = ({ label, hint, children, className = '' }) => (
  <label className={`group block has-[:disabled]:cursor-not-allowed ${className}`}>
    {label && <span className="mb-1.5 block text-xs font-medium text-muted transition-colors group-has-[:disabled]:text-subtle">{label}</span>}
    {children}
    {hint && <span className="mt-1 block text-[11px] text-subtle">{hint}</span>}
  </label>
);

export const inputClass =
  'w-full rounded-xl border border-line-strong bg-panel px-3.5 py-2 text-sm text-ink outline-none transition-colors placeholder:text-subtle focus:border-brand-600 focus:bg-card disabled:border-dashed disabled:bg-line/40 disabled:text-subtle';
