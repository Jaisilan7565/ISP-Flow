import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast as toastVariants } from '../../utils/motion';

const ToastContext = createContext(() => {});

export const ToastProvider = ({ children }) => {
  const [item, setItem] = useState(null);
  const timer = useRef();

  const show = useCallback((message) => {
    clearTimeout(timer.current);
    setItem({ id: Date.now(), message });
    const ms = Math.min(2600 + Math.max(String(message).length - 60, 0) * 45, 8000);
    timer.current = setTimeout(() => setItem(null), ms);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4" aria-live="polite">
          <AnimatePresence mode="wait">
            {item && (
              <motion.div
                key={item.id}
                variants={toastVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                role="status"
                className="max-w-[560px] rounded-full bg-brand-800 px-5 py-2.5 text-center text-[13px] font-medium leading-snug text-white shadow-lift"
              >
                {item.message}
              </motion.div>
            )}
          </AnimatePresence>
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);
