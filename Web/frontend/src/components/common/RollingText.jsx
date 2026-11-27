import React, { useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ease } from '../../utils/motion';

/**
 * Odometer-style text: each digit sits in its own clipped slot and rolls
 * when changing values without layout shifts.
 */
const DigitSlot = ({ char, delay }) => {
  const prev = useRef(char);
  const version = useRef(0);
  if (prev.current !== char) {
    prev.current = char;
    version.current += 1;
  }
  return (
    <span className="relative inline-block overflow-hidden align-top" aria-hidden="true">
      <span className="invisible">0</span>
      <AnimatePresence initial={delay != null} mode="popLayout">
        <motion.span
          key={version.current}
          className="absolute inset-0 text-center"
          initial={{ y: '100%', opacity: 0, filter: 'blur(3px)' }}
          animate={{ y: '0%', opacity: 1, filter: 'blur(0px)' }}
          exit={{ y: '-100%', opacity: 0, filter: 'blur(3px)' }}
          transition={{ duration: 0.38, ease: ease.out, delay: version.current === 0 ? delay ?? 0 : 0 }}
        >
          {char}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};

export const RollingText = ({ text, className = '', intro = false, stagger = 0.045 }) => {
  const chars = String(text).split('');
  return (
    <span className={`inline-flex tnum ${className}`} aria-label={String(text)} role="text">
      {chars.map((c, i) => {
        const slot = chars.length - i;
        return /\d/.test(c) ? (
          <DigitSlot key={`d${slot}`} char={c} delay={intro ? i * stagger : undefined} />
        ) : (
          <span key={`s${slot}`} aria-hidden="true" className="whitespace-pre">
            {c}
          </span>
        );
      })}
    </span>
  );
};

export default RollingText;
