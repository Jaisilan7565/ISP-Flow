# ISP-Flow — Telecom Lifecycle & Financial Operations ERP

A high-performance B2B Telecom ERP platform for Internet Service Providers (ISPs), Bandwidth Aggregators, and Telecom Infrastructure Partners. Built directly upon the production architectural patterns, multi-layer design system, and motion grammar of `EduTechLab`.

| Subsystem | Directory | Tech Stack |
| :--- | :--- | :--- |
| **REST API** | `Web/backend` | Node.js 24 · Express · PostgreSQL 16+ with **Sequelize** (models + Umzug migrations) · **Joi** · JWT · **Socket.io** live sync · **Swagger UI** (`/api/docs`) · **Winston + Morgan** |
| **Web App** | `Web/frontend` | React 19 · Vite 6 · Tailwind CSS v4 · Framer Motion 12 · Redux Toolkit · TanStack Query · **Formik + Yup** (every field validated, with a hint) |
| **Infrastructure** | repo root | **Docker + Docker Compose + Nginx** (`docker-compose.yml`, `Web/*/Dockerfile`, `Web/frontend/nginx.conf`) |
| **Specifications**| `Docs/` | Blueprint, Design System & Motion Spec, Folder Structure |

---

## 1. Core Modules (Derived from Operations Workflow)

0. **Clients & Orders:**
   * Clients send orders for links at one or many sites, on WhatsApp or email.
   * The company's field engineers enter it in the **New client order** form: order details plus one row per site. Each site becomes its own request.
   * Order tracker and client view (sites per stage, billed / received / outstanding).
1. **Feasibility Tracker (`Docs/ISP_FLOW_SYSTEM_BLUEPRINT.md#31`):**
   * Intake from WhatsApp / email messages and Google Maps location pins.
   * The field engineer who took the order owns the site from feasibility to delivery.
   * Multi-ISP feasibility discovery (Airtel, Tata, Jio, BSNL, local dark fiber) and price locking.
2. **Commercial Pricing, RFQ & Budgeting (`Docs/ISP_FLOW_SYSTEM_BLUEPRINT.md#32`):**
   * Multi-quote vendor matrix (`Quote-1`, `Quote-2`, `Quote-3`).
   * Margin optimizer & Bid Win workflow.
   * Dynamic budget breakdown: **Bucket A** (`% to Vendor`), **Bucket B** (`% kept by the ISP company itself`), and **Bucket C** (`% Site Implementation / Capex`).
3. **Implementation & Delivery SLA Tracker (`Docs/ISP_FLOW_SYSTEM_BLUEPRINT.md#33`):**
   * Customer Purchase Order (PO) ingestion and digital work orders.
   * Pending-item triage. The parties are: `Pending with <client name>`, `Pending with ISP / Vendor`, `Pending with <your company> (internal)`, `Pending with Customer at site`, and `ROW / Authority`.
   * One client PO can cover several sites. Operations can hand a site to another engineer.
   * Live link commissioning (IP subnets, latency testing, MRTG integration, and Acceptance Test sign-off).
4. **Milestone Billing & Submission Tracker (`Docs/ISP_FLOW_SYSTEM_BLUEPRINT.md#34`):**
   * Automated OTC (One-Time Charge) invoicing upon site live date.
   * Recurring billing cycles (`1st Cycle`, `2nd Cycle`, monthly/quarterly).
   * Verified Bill Submission tracking with courier AWB tracking and stamped physical receipt validation.
5. **Payment Waterfall & Treasury Management (`Docs/ISP_FLOW_SYSTEM_BLUEPRINT.md#35`):**
   * Sitewise customer receivable tracking.
   * Priority cashflow distribution: **Priority 1** (ISP Vendor / Site Settlement) → **Priority 2** (Debt / Equipment Loan Service) → **Priority 3** (Guaranteed 3-Month Payroll & Runway Reserve).

---

## 2. Design & Motion System

Inheriting the visual precision of `EduTechLab`:
* **Layered Surfaces:** Canvas (`#E9EBE9`) → Panel (`#F5F6F5`) → Card (`#FDFDFC`).
* **Signature Dark Contour Hero:** Deep `--brand-950` cards with concentric topographic isolines.
* **4 Curated Color Themes:** Telecom Cobalt (default), Fiber Emerald, Carrier Amber, and NOC Titanium.
* **Framer Motion Choreography:** Staggered card entrances (`rise` with blur dissolve), fluid `PillTabs` with sliding `layoutId`, and odometer-style tabular kinetic numbers (`.tnum`).

---

## 3. Quick Start (Local Development)

> **How to use the software, start to end:** see the [User Guide](USER_GUIDE.md). It covers installation, first-time setup, the full workflow from a client order to payment, roles, and the money rules.

Prerequisites: Node 24, PostgreSQL 16+ with an empty database `isp_flow` (and `isp_flow_test` for tests).

```bash
# 1. API Server
cd Web/backend
cp .env.example .env        # set DATABASE_URL, JWT_SECRET, PLATFORM_OWNER_EMAIL / PASSWORD
npm install
npm run db:setup            # creates tables + first Platform Admin
npm run seed:demo           # optional: sample company to try things out (prints its logins)
npm run dev                 # http://localhost:4000  (health: /api/v1/health)
npm test                    # 29 end-to-end steps + Joi/Yup validation parity (uses isp_flow_test)
# API docs (Swagger UI): http://localhost:4000/api/docs

# 2. Frontend Application
cd ../frontend
npm install
npm run dev                 # http://localhost:2000
```

**Or run everything with Docker** (Postgres + API + Nginx):

```bash
cp .env.docker.example .env      # set passwords, JWT secret, platform admin
docker compose up -d --build     # app: http://localhost:2000 · API docs: http://localhost:2000/api/docs
```

Frontend checks: `cd Web/frontend && npm run lint && npm run build`.

Who does what:
1. **Platform Admin** onboards an ISP company and its **Company Admin**.
2. The Company Admin adds the team, clients, ISPs / vendors and settings.
3. A **field engineer** enters the client's order in the order form (one row per site).
4. Each site then runs Feasibility → Quote → Implementation → Billing → Payment, and each step hands over to the next automatically.

---

## 4. Delivery Tracking

[`Tracking/`](Tracking/README.md) holds the requirement matrix (sketch → feature → test), plan, progress log, the client UAT script,
test results with screenshots, and open decisions.

## 5. Documentation Index

* 📘 [System Architecture & Feature Blueprint](file:///d:/TechGlora/Development/ISP-Flow/Docs/ISP_FLOW_SYSTEM_BLUEPRINT.md)
* 🎨 [Design System & Motion Specification](file:///d:/TechGlora/Development/ISP-Flow/Docs/DESIGN_SYSTEM_AND_ANIMATION_SPEC.md)
* 📁 [Development Folder Structure & Guidelines](file:///d:/TechGlora/Development/ISP-Flow/Docs/DEVELOPMENT_FOLDER_STRUCTURE.md)
