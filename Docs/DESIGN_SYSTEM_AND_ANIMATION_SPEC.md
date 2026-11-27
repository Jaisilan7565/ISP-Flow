# ISP-Flow — Design System & Motion Specification

> **Scope.** The visual design language, layout hierarchy, and motion physics are inherited directly from the proven production standard of `EduTechLab` (`Docs/DESIGN_SYSTEM_AND_ANIMATION_SPEC.md`).
> The visual system adapts the **"Calm Organic Productivity"** philosophy into **"Calm Precision Operations"** for high-density, mission-critical B2B telecom workflows.
> Source of truth in code: `Web/frontend/src/styles/theme.css` (tokens) and `Web/frontend/src/utils/motion.js` (motion physics).

---

## 1. Design Philosophy — "Calm Precision Operations"

| Principle | Implementation Rule |
| :--- | :--- |
| **Depth by Layering, Not Heavy Shadows** | Three flat neutral layers (`--canvas` → `--panel` → `--card`) create depth. Cards feature no aggressive borders and a practically invisible elevation shadow (`0 1px 2px rgba(17,20,18,0.03)`). |
| **Pills & Circular Geometry** | Buttons, status badges, filter tabs, search bars, and entity chips are fully rounded pills (`rounded-full` / `9999px`). |
| **Signature Dark Contour Surfaces** | Deep `--brand-950` cards with fine concentric topographic contour lines, used for Hero SLA cards, live delivery countdowns, and treasury waterfall totals. |
| **Hatching for "Uncommitted / Pending"** | Diagonal 45-degree hatching (`.hatch`) visually denotes pending site feasibility, unsubmitted billing cycles, and unallocated budget shares. |
| **Kinetic Numbers & Tabular Figures** | All financial figures (₹), bandwidth metrics (Mbps/Gbps), and SLA counters roll smoothly without jitter using `font-variant-numeric: tabular-nums` (`.tnum`). |
| **Cohesive Brand Adaptation** | A 9-step semantic color scale that allows instant runtime re-tinting across the entire application with zero stylesheet rewrites. |

---

## 2. Design Tokens

### 2.1 Neutral Layers & Typography Colors

```css
:root {
  --canvas: #E9EBE9;        /* Outer application canvas behind floating panels */
  --panel: #F5F6F5;         /* Floating sidebar, header bar, main content frame */
  --card: #FDFDFC;          /* Surface for every metric tile, table, and form card */
  --line: #ECEEEC;          /* Hairline dividers, column borders, table grid lines */
  --line-strong: #DADDDB;   /* Outlined button strokes, input borders, tooltip edges */
  --ink: #111412;           /* Headings, KPI numbers, primary values */
  --ink-2: #3D4540;         /* Body copy, table content, secondary labels */
  --muted: #737B76;         /* Captions, subtext, inactive navigation items */
  --subtle: #9AA29D;        /* Empty state descriptions, disabled hints */
}
```

### 2.2 Brand Scales (4 Accent Themes)

Theme switching is triggered via `document.documentElement.dataset.theme = 'cobalt' | 'emerald' | 'amber' | 'titanium'` and persisted in `localStorage.isp_theme`:

| Token | Role | Cobalt (Default B2B) | Emerald (Fiber Ops) | Amber (Carrier Ops) | Titanium (NOC Console) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--brand-950` | Contour hero cards | `#071326` | `#072013` | `#261304` | `#0C0E10` |
| `--brand-900` | Darkest chart, button gradient | `#0C2448` | `#0D3A23` | `#422006` | `#16191D` |
| `--brand-800` | Primary CTA, active pill, toast | `#143D75` | `#145534` | `#663207` | `#23272E` |
| `--brand-700` | Nav indicator, active logos | `#1B549E` | `#1D7347` | `#8C450A` | `#333A44` |
| `--brand-600` | Progress bars, live SLA gauge | `#256EC9` | `#27865A` | `#B85B0D` | `#4A5462` |
| `--brand-400` | Metric sparklines, light bars | `#5B9DEE` | `#5DBD8B` | `#E88A3C` | `#7E8B9B` |
| `--brand-200` | Heatmap level 1, soft focus | `#B8D6FB` | `#BFE3CE` | `#F7CEAC` | `#C6CDD5` |
| `--brand-100` | Active nav tint, chip background | `#E2EEFD` | `#E3F2E9` | `#FDEEE3` | `#E5E8EB` |
| `--brand-50` | Hover tint, dropzone fill | `#F0F6FE` | `#F0F8F3` | `#FEF8F4` | `#F3F4F6` |

### 2.3 Status & Domain Colors (Fixed Across Themes)

* **`--danger` (`#D7263D`):** Blocker: Pending RailTel / Vendor, Overdue Bill, Unfeasible survey, SLA breach.
* **`--warning` (`#E8A317`):** Blocker: Pending Customer, Under Negotiation, Partial Payment, 80%+ SLA elapsed.
* **`--info` (`#3B5BDB`):** Feasibility Assigned, PO Ingestion, Link in Testing, Courier Dispatched.
* **`--good` (`#1D7347`):** Site Live & Commissioned, Bill Acknowledged, Bid Won, 100% SLA compliant.
* **`--todo` (`#8D9A92`):** Draft Survey, Cycle 2 Pending, Scheduled Payout.

### 2.4 Shape, Elevation & Special Fills

| Token | Value | Applied To |
| :--- | :--- | :--- |
| `--radius-card` | `20px` | Metric widgets, site cards, comparison tables |
| `--radius-panel` | `28px` | Floating outer shell, sidebar, modal drawers |
| Inner Radii | `12px` (inputs), `9999px` (pills & buttons), `5px` (status badges) | Inputs, chips, badges |
| `--shadow-card` | `0 1px 2px rgba(17, 20, 18, 0.03)` | Flat aesthetic with clean layering |
| `--shadow-lift` | `0 18px 40px -12px rgba(17, 20, 18, 0.22)` | Modals, drawers, drag-and-drop cards |
| `--shadow-hero` | `0 12px 28px -10px color-mix(in srgb, var(--brand-900) 55%, transparent)` | Contour hero KPI tiles |
| `.surface-hero` | `linear-gradient(160deg, var(--brand-800), var(--brand-900))` with radial ambient highlight | Topographic summary cards |
| `.hatch` | `repeating-linear-gradient(-45deg, #8E9A93 0 1.6px, transparent 1.6px 7px)` | Uncommitted budget, pending cycles |

### 2.5 Typography — Plus Jakarta Sans

* **Page Title:** `36px (30px mobile) / 600 weight / tracking -0.03em`
* **KPI Number:** `44px / 600 weight / tracking -0.04em, .tnum`
* **Card Title:** `17px / 500 weight / ink`
* **Nav Label:** `15px / 400 weight (600 active)`
* **Body / Data Grid:** `14px / 400 weight / ink-2`
* **Micro Label:** `11px / 500 weight / uppercase / tracking 0.08em`

---

## 3. Motion System & Animation Grammar

Every transition follows physical real-world spring and easing parameters measured and calibrated from `EduTechLab`:

```javascript
// src/utils/motion.js
export const ease = {
  out: [0.22, 1, 0.36, 1],      // Swift entry curve (easeOutQuint-like)
  inOut: [0.65, 0, 0.35, 1],    // Morphing: gauge arcs, waterfall splits
  in: [0.55, 0, 1, 0.45]        // Swift exits
};

export const spring = {
  soft: { type: 'spring', stiffness: 260, damping: 30 },
  snappy: { type: 'spring', stiffness: 420, damping: 34 },
  drawer: { type: 'spring', stiffness: 320, damping: 36 },
  layout: { type: 'spring', stiffness: 380, damping: 36, mass: 0.9 }
};

// Orchestrated Page Enter / Exit
export const page = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
  exit: { transition: { staggerChildren: 0.025, staggerDirection: 1 } }
};

// Universal Card Entrance: Translation + Blur Dissolve
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

// Rise Solid: Blur-free for drag-and-drop or overflow escape
export const riseSolid = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: ease.out } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.22, ease: ease.in } }
};

// Modal Backdrop & Pop-in
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

// Slide Drawer (Site Detail / Feasibility Inspector)
export const drawer = {
  hidden: { x: '100%' },
  visible: { x: 0, transition: { ...spring.drawer, staggerChildren: 0.05, delayChildren: 0.18 } },
  exit: { x: '100%', transition: { duration: 0.28, ease: ease.in } }
};

// Notification Toast Pill
export const toast = {
  hidden: { opacity: 0, y: 24, scale: 0.92, filter: 'blur(4px)' },
  visible: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: spring.snappy },
  exit: { opacity: 0, y: 12, scale: 0.96, filter: 'blur(4px)', transition: { duration: 0.2 } }
};
```

---

## 4. Production Component Library

| Component | Source Path | Behavior & Role |
| :--- | :--- | :--- |
| `Card`, `CardTitle` | `components/common/ui.jsx` | 20px rounded widget container with `rise` animation variant. |
| `Button` | `components/common/ui.jsx` | Variants: `primary`, `outline`, `ghost`, `light`. Springs with `whileTap={{ scale: 0.97 }}`. |
| `PillTabs` | `components/common/PillTabs.jsx` | Floating pill selector; the active dark background slides smoothly with Framer Motion `layoutId`. |
| `AnimatedNumber` | `components/common/AnimatedNumber.jsx` | Smooth count-up on paint; tweened roll on change with Indian currency (`en-IN`) grouping (`₹12,45,000`). |
| `RollingText` | `components/common/RollingText.jsx` | Odometer digit rolls for live link speed (e.g. `100 Mbps`) and days remaining. |
| `RevealText` | `components/common/RevealText.jsx` | Per-character blur-rise header title animations. |
| `TopographicCard` | `components/common/TopographicCard.jsx` | Hero dark contour widget with ambient radial glow and SVG isolines. |
| `SegmentGauge` | `components/common/SegmentGauge.jsx` | Semicircular progress arc showing Delivery SLA compliance or Cash Waterfall split. |
| `BlockerChip` | `features/implementation/components/BlockerChip.jsx` | Outlined pill indicating blocker entity (`Vendor`, `UDIN`, `Customer`, `RailTel`) with an animated pulse dot. |
| `WaterfallVisualizer`| `features/treasury/components/WaterfallVisualizer.jsx` | 3-bar animated payout breakdown (Vendor Settlement → Loan EMI → 3-Month Runway). |
| `QuoteMatrix` | `features/commercial/components/QuoteMatrix.jsx` | 3-way side-by-side comparison with dynamic Bid-Win highlight and margin slider. |
| `Overlay` (Modal/Drawer) | `components/common/Overlay.jsx` | Portaled backdrop with ESC listener and smooth focus trap. |
| `ToastProvider` | `components/common/Toast.jsx` | Bottom-center floating pill with 2.6s autohide for user feedback. |

---

## 5. Screen Layout & Interactive Guidelines

1. **Header Layout Rhythm:**
   * Every page opens with `PageHeader` (Title with `RevealText`, descriptive subtitle, and top-right primary actions).
   * Filter controls sit directly underneath using `PillTabs` with right-aligned record counters.
   * Content grids follow a consistent 14px gap (`gap-3.5`).
2. **Keyboard Accessibility (`Ctrl K` / `/`):**
   * Global search focuses with `Ctrl+K` or `/`.
   * Fast jumping with `G` then:
     * `G` + `F` → Feasibility Tracker
     * `G` + `I` → Implementation Tracker
     * `G` + `C` → Commercial Quotes & Budgeting
     * `G` + `B` → Milestone Billing Tracker
     * `G` + `T` → Treasury & Payment Waterfall
