/**
 * Motion tokens & Framer Motion variants for ISP-Flow.
 * Calibrated against the EduTechLab motion specification.
 */

export const ease = {
  out: [0.22, 1, 0.36, 1],      // Default enter curve
  inOut: [0.65, 0, 0.35, 1],    // Morphs: gauge, waterfall splits, chart paths
  in: [0.55, 0, 1, 0.45]        // Exits
};

export const spring = {
  soft: { type: 'spring', stiffness: 260, damping: 30 },
  snappy: { type: 'spring', stiffness: 420, damping: 34 },
  drawer: { type: 'spring', stiffness: 320, damping: 36 },
  layout: { type: 'spring', stiffness: 380, damping: 36, mass: 0.9 }
};

/* Page-level orchestration */
export const page = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.04, delayChildren: 0.05 }
  },
  exit: {
    transition: { staggerChildren: 0.025, staggerDirection: 1 }
  }
};

/* Universal Card Entrance */
export const rise = {
  hidden: { opacity: 0, y: 18, filter: 'blur(6px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.6, ease: ease.out }
  },
  exit: {
    opacity: 0,
    y: -6,
    filter: 'blur(6px)',
    transition: { duration: 0.22, ease: ease.in }
  }
};

/* Solid rise without blur (for drag-and-drop or overflow escape) */
export const riseSolid = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: ease.out } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.22, ease: ease.in } }
};

/* Nested lists inside cards */
export const list = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.15 } },
  exit: {}
};

export const listItem = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: ease.out } },
  exit: { opacity: 0, transition: { duration: 0.15 } }
};

/* Page title per-character blur reveal */
export const titleChars = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.028 } },
  exit: { opacity: 0, filter: 'blur(6px)', transition: { duration: 0.2 } }
};

export const titleChar = {
  hidden: { opacity: 0, y: '0.35em', filter: 'blur(8px)' },
  visible: {
    opacity: 1,
    y: '0em',
    filter: 'blur(0px)',
    transition: { duration: 0.5, ease: ease.out }
  }
};

/* Modal backdrop & panel pop */
export const backdrop = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.25 } },
  exit: { opacity: 0, transition: { duration: 0.2, delay: 0.05 } }
};

export const modal = {
  hidden: { opacity: 0, scale: 0.94, y: 12, filter: 'blur(4px)' },
  visible: { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)', transition: spring.snappy },
  exit: { opacity: 0, scale: 0.96, y: 8, filter: 'blur(4px)', transition: { duration: 0.18, ease: ease.in } }
};

/* Side Drawer (Site details, Feasibility drawer) */
export const drawer = {
  hidden: { x: '100%' },
  visible: { x: 0, transition: { ...spring.drawer, staggerChildren: 0.05, delayChildren: 0.18 } },
  exit: { x: '100%', transition: { duration: 0.28, ease: ease.in } }
};

/* Bottom-center notification pill */
export const toast = {
  hidden: { opacity: 0, y: 24, scale: 0.92, filter: 'blur(4px)' },
  visible: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: spring.snappy },
  exit: { opacity: 0, y: 12, scale: 0.96, filter: 'blur(4px)', transition: { duration: 0.2 } }
};
