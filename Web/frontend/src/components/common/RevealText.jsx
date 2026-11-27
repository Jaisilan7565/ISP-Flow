import React from 'react';
import { motion } from 'framer-motion';
import { titleChar, titleChars } from '../../utils/motion';

/**
 * Page title that reveals itself character by character, rising out of a blur.
 */
export const RevealText = ({ text, as = 'h1', className = '' }) => {
  const Tag = motion[as] || motion.h1;
  return (
    <Tag variants={titleChars} className={className} aria-label={text}>
      {text.split('').map((ch, i) => (
        <motion.span key={i} variants={titleChar} className="inline-block whitespace-pre" aria-hidden="true">
          {ch}
        </motion.span>
      ))}
    </Tag>
  );
};

export default RevealText;
