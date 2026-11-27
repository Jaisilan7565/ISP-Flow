# ISP-Flow — Development Folder Structure & Engineering Guidelines

> **Architectural Standard.** Directly matches the clean, 3-layer modular architecture and hybrid feature-driven design established in `EduTechLab` (`Docs/DEVELOPMENT_FOLDER_STRUCTURE.md`).

---

## 1. Top-Level Directory Layout

```text
ISP-Flow/
├── Docs/                        # Architecture specs, database blueprints, design & motion specs
│   ├── ISP_FLOW_SYSTEM_BLUEPRINT.md
│   ├── DESIGN_SYSTEM_AND_ANIMATION_SPEC.md
│   └── DEVELOPMENT_FOLDER_STRUCTURE.md
├── Web/
│   ├── backend/                 # Node.js 24 + Express + Sequelize + PostgreSQL + Redis
│   ├── frontend/                # React 19 + Vite 6 + Tailwind CSS v4 + Framer Motion 12
│   ├── docker-compose.yml       # Dev orchestration (Node + Postgres + Redis)
│   └── nginx/                   # Reverse proxy configuration
└── README.md                    # Quick-start guide & repository index
```

---

## 2. Backend Architecture (`Web/backend/`)
*Tech Stack: Node.js 24, Express.js 4.21, Sequelize ORM 6.37, PostgreSQL 16, Redis / BullMQ, Joi, Winston, Socket.io*

We implement a clean **3-Layer Architecture** (*Route → Controller → Service → Model*) grouped by domain modules:

```text
Web/backend/
├── src/
│   ├── config/                  # Database, Redis, and environment configs
│   │   ├── database.js          # Sequelize connection with connection pooling
│   │   ├── redis.js             # Redis client initialization (pub/sub & cache)
│   │   └── swagger.js           # OpenAPI / Swagger auto-documentation
│   │
│   ├── constants/               # Global enumerations & codes
│   │   ├── roles.js             # SUPER_ADMIN, COMMERCIAL_MGR, OPS_LEAD, BILLING_EXEC, TREASURY_HEAD
│   │   ├── statuses.js          # Feasibility, Quote, Implementation, and Billing enum mappings
│   │   └── httpCodes.js         # HTTP status code constants
│   │
│   ├── database/                # Database versioning
│   │   ├── migrations/          # Sequelize migration scripts
│   │   └── seeders/             # Initial master seeders (demo carriers, sample sites, pricing rules)
│   │
│   ├── middlewares/             # Request lifecycle filters
│   │   ├── auth.middleware.js   # Verifies JWT access token
│   │   ├── tenant.middleware.js # Extracts and injects tenant_id for multi-tenant data isolation
│   │   ├── rbac.middleware.js   # Role-based access control and permission enforcement
│   │   ├── validate.middleware.js # Generic Joi schema request validator
│   │   └── error.middleware.js  # Global centralized error handler
│   │
│   ├── models/                  # Sequelize schema definitions
│   │   ├── index.js             # Model associations & relationship loader
│   │   ├── tenant.model.js      # ISP Organization account
│   │   ├── user.model.js        # Internal users (Muthu, Amit, Shanker, Accounts team)
│   │   ├── feasibility.model.js # Feasibility survey requests and geo-coordinates
│   │   ├── quote.model.js       # Multi-quote comparison and budget allocation records
│   │   ├── site.model.js        # Implementation sites, PO details, and blocker statuses
│   │   ├── invoice.model.js     # OTC, Cycle 1, Cycle 2 invoices and submission tracking
│   │   └── waterfall.model.js   # Cashflow allocations (Vendor, Loan, Runway reserve)
│   │
│   ├── modules/                 # Feature-Based Domain Logic
│   │   ├── auth/                # Sign-in, token refresh, and user profiles
│   │   │   ├── auth.routes.js
│   │   │   ├── auth.controller.js
│   │   │   ├── auth.service.js
│   │   │   └── auth.validation.js
│   │   ├── feasibility/         # WhatsApp parser, field survey routing, multi-carrier price discovery
│   │   │   ├── feasibility.routes.js
│   │   │   ├── feasibility.controller.js
│   │   │   ├── feasibility.service.js
│   │   │   └── feasibility.validation.js
│   │   ├── commercial/          # RFQ multi-quotes, margin calculations, and budget partitioning
│   │   │   ├── commercial.routes.js
│   │   │   ├── commercial.controller.js
│   │   │   ├── commercial.service.js
│   │   │   └── commercial.validation.js
│   │   ├── implementation/      # PO tracking, ISP work orders, and blocker management
│   │   │   ├── site.routes.js
│   │   │   ├── site.controller.js
│   │   │   ├── site.service.js
│   │   │   └── site.validation.js
│   │   ├── billing/             # OTC, Cycle 1 & 2 billing, physical AWB & portal submission
│   │   │   ├── invoice.routes.js
│   │   │   ├── invoice.controller.js
│   │   │   ├── invoice.service.js
│   │   │   └── invoice.validation.js
│   │   └── treasury/            # Sitewise payments, waterfall priority distributor, runway health
│   │       ├── treasury.routes.js
│   │       ├── treasury.controller.js
│   │       ├── treasury.service.js
│   │       └── treasury.validation.js
│   │
│   ├── jobs/                    # BullMQ background workers
│   │   ├── slaTracker.job.js    # Checks overdue site deliveries & triggers warning notifications
│   │   ├── submissionAlert.job.js # Alerts on invoices lacking bill submission acknowledgment
│   │   └── recurringCycle.job.js# Generates recurring cycle invoices based on contract frequency
│   │
│   ├── utils/                   # Reusable utility functions
│   │   ├── logger.js            # Winston structured logger
│   │   ├── response.js          # Uniform API response helper
│   │   ├── apiError.js          # AppError class with HTTP status codes
│   │   └── geoParser.js         # Parses Google Maps URLs and WhatsApp coordinate strings
│   │
│   ├── routes/                  # Central router aggregator
│   │   └── index.js             # Combines `/api/v1/feasibility`, `/api/v1/sites`, etc.
│   │
│   ├── app.js                   # Express application setup
│   └── server.js                # Server entry point with Socket.io real-time listener
├── package.json
└── nodemon.json
```

---

## 3. Frontend Architecture (`Web/frontend/`)
*Tech Stack: React 19, Vite 6, Tailwind CSS v4, Framer Motion 12, Redux Toolkit, TanStack React Query 5, Lucide React*

We use a **Hybrid Feature-Driven Architecture** mirroring `EduTechLab`:

```text
Web/frontend/
├── index.html                   # Loads Plus Jakarta Sans font
├── src/
│   ├── main.jsx                 # Mount point: Redux Provider + QueryClientProvider
│   ├── App.jsx                  # Main shell: Sidebar, Header, dynamic page switcher, and toasts
│   │
│   ├── styles/
│   │   ├── theme.css            # CSS variables, 4 accent scales, @theme definitions, .hatch, .tnum
│   │   └── index.css            # Base scrollbars, resets, and focus rings
│   │
│   ├── utils/
│   │   ├── motion.js            # Framer motion variants: rise, modal, drawer, ease, spring
│   │   ├── router.js            # Lightweight URL routing helper
│   │   └── formatters.js        # Indian currency formatting (₹), bandwidth (Mbps), and date formatters
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.jsx      # Left navigation with active sliding pill
│   │   │   └── Header.jsx       # Global search (Ctrl+K), notification center, theme selector
│   │   └── common/
│   │       ├── ui.jsx           # Card, Button, StatusBadge, CircleIconButton, DeltaChip, ProgressBar
│   │       ├── PillTabs.jsx     # Sliding layoutId pill selector
│   │       ├── AnimatedNumber.jsx # Tabular animated number counter
│   │       ├── RollingText.jsx  # Odometer digit counter
│   │       ├── RevealText.jsx   # Blur-rise per-character page title animation
│   │       ├── TopographicCard.jsx # Contour dark hero card with radial glow
│   │       ├── SegmentGauge.jsx # Circular arc progress gauge
│   │       ├── Overlay.jsx      # Modal, Drawer, Field primitives
│   │       └── Toast.jsx        # Bottom-center floating notification toast
│   │
│   ├── features/                # Domain-Driven Modules
│   │   ├── dashboard/           # Operations Overview: KPI tiles, Live Blockers, Delivery Velocity
│   │   │   ├── pages/DashboardPage.jsx
│   │   │   └── components/BlockerSummaryCard.jsx
│   │   ├── feasibility/         # Feasibility Tracker: Survey table, Assign modal, Map preview
│   │   │   ├── pages/FeasibilityPage.jsx
│   │   │   └── components/SurveyDrawer.jsx
│   │   ├── commercial/          # Quotes & Budgeting: Multi-Quote Matrix, Margin & Budget Splitter
│   │   │   ├── pages/CommercialPage.jsx
│   │   │   └── components/QuoteComparisonMatrix.jsx
│   │   ├── implementation/      # Implementation Tracker: Blocker resolution, Live SLA Countdown
│   │   │   ├── pages/ImplementationPage.jsx
│   │   │   └── components/SiteLiveModal.jsx
│   │   ├── billing/             # Billing & Submission: OTC & Cycle 1/2 tracking, AWB proof upload
│   │   │   ├── pages/BillingPage.jsx
│   │   │   └── components/BillSubmissionModal.jsx
│   │   ├── treasury/            # Payment Waterfall: WaterfallVisualizer, 3-Month Runway Gauge
│   │   │   ├── pages/TreasuryPage.jsx
│   │   │   └── components/WaterfallVisualizer.jsx
│   │   ├── auth/                # Login, MFA, Password Reset
│   │   │   └── pages/LoginPage.jsx
│   │   └── settings/            # Organization details, Carrier API keys, Team members, Accent theme
│   │       └── pages/SettingsPage.jsx
│   │
│   ├── services/
│   │   └── api.js               # Central Axios client with token rotation & error handling
│   │
│   └── store/
│       ├── index.js             # Redux root store
│       └── slices/
│           ├── uiSlice.js       # Active tab, search term, theme mode, drawer open states
│           └── ispSlice.js      # Cached dashboard filters, active site selection
```

---

## 4. Developer Cheat Sheet

| Development Task | Target Location |
| :--- | :--- |
| **Add a new database column or table** | `Web/backend/src/database/migrations/` and `Web/backend/src/models/` |
| **Add a new API endpoint** | `Web/backend/src/modules/<feature>/<feature>.routes.js` |
| **Validate request payload with Joi** | `Web/backend/src/modules/<feature>/<feature>.validation.js` |
| **Write business logic or SQL queries** | `Web/backend/src/modules/<feature>/<feature>.service.js` |
| **Update or create a new UI Component** | `Web/frontend/src/components/common/` or `Web/frontend/src/features/<feature>/components/` |
| **Adjust animations or spring physics** | `Web/frontend/src/utils/motion.js` |
| **Modify color tokens or theme styling** | `Web/frontend/src/styles/theme.css` |
| **Add a scheduled background job (BullMQ)** | `Web/backend/src/jobs/` |
| **Add a new page to the main navigation** | `Web/frontend/src/features/<feature>/pages/` and register in `Web/frontend/src/App.jsx` |
