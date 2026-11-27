import React, { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import RollingText from './RollingText';

const formatValue = (v, decimals, locale) =>
  v.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/**
 * KPI number counting up from 0 on mount and tweening on change.
 */
export const AnimatedNumber = ({
  value,
  decimals = 0,
  duration = 1.1,
  delay = 0.2,
  prefix = '',
  suffix = '',
  locale = 'en-IN',
  className = ''
}) => {
  const reduced = useReducedMotion();
  const numValue = Number(value) || 0;
  const [display, setDisplay] = useState(reduced ? numValue : 0);
  const from = useRef(reduced ? numValue : 0);
  const counted = useRef(false);

  useEffect(() => {
    if (reduced) {
      setDisplay(numValue);
      from.current = numValue;
      return undefined;
    }
    const isFirst = !counted.current;
    const controls = animate(from.current, numValue, {
      duration: isFirst ? duration : 0.7,
      delay: isFirst ? delay : 0,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        from.current = v;
        setDisplay(Number(v.toFixed(decimals)));
      },
      onComplete: () => {
        counted.current = true;
      }
    });
    return () => controls.stop();
  }, [numValue, decimals, duration, delay, reduced]);

  return <RollingText className={className} text={`${prefix}${formatValue(display, decimals, locale)}${suffix}`} />;
};

export default AnimatedNumber;
