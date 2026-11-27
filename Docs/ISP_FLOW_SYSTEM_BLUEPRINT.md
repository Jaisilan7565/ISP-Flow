# ISP-Flow: Telecom Lifecycle & Financial Operations ERP
## Comprehensive Technical Blueprint, Architecture & Feature Matrix

> **Source of Truth:** Architectural blueprint based on the handwritten operations workflow, inheriting the production-grade engineering, design system, and multi-layered motion architecture of `EduTechLab`.

---

## 1. Executive Summary & Domain Context

**ISP-Flow** is an enterprise-grade Telecom Lifecycle & Financial Operations ERP tailored for **Internet Service Providers (ISPs), B2B Bandwidth Aggregators, Managed Network Providers, and Telecom Infrastructure Partners**.

In enterprise B2B telecom (e.g., enterprise leased lines, SD-WAN, MPLS, dark fiber, broadband aggregation), companies must coordinate between multiple upstream carriers (Airtel, RailTel, Tata Communications, Jio, BSNL, local dark fiber vendors) and downstream corporate clients (banks, retail chains, enterprise branch networks). 

The platform digitizes, automates, and unifies the five core operational pillars captured in the operational blueprint:
1. **Feasibility Tracker:** Multi-channel lead ingestion (WhatsApp feeds, Google Maps geo-coordinates), field survey routing (Muthu, Fiberwa, Amit/Shanker), multi-ISP feasibility checking, price discovery, and feasibility qualification.
2. **Commercial Pricing, RFQ & Budgeting Engine:** Multi-quote vendor matrix (Quote-1, Quote-2, Quote-3), margin optimizer, Bid Win confirmation, and automated revenue/budget partitioning (`% to vendor`, `% to partner/UDIN`, `% site implementation/capex`).
3. **Implementation & Delivery SLA Tracker:** PO ingestion, ISP work orders, and real-time blocker resolution (`Pending with Vendor / UDIN / Customer / RailTel`) through site live sign-off and Commissioning Report (CR) handover.
4. **Milestone Billing & Invoice Tracker:** Site OTC (One-Time Charge) invoicing and recurring lifecycle billing (`Cycle 1`, `Cycle 2`, quarterly/monthly), paired with physical & digital Bill Submission tracking (courier AWB, portal upload, acknowledgment stamp).
5. **Payment Waterfall & Treasury Management:** Sitewise receivable reconciliation and automated waterfall cashflow allocation (`Priority 1: Vendor/ISP Settlement` -> `Priority 2: Loan/Debt Service` -> `Priority 3: 3-Month Payroll/Runway Reserve`).

---

## 2. End-to-End Operational Workflow Architecture

The diagram below maps the complete lifecycle of a telecom link across the five interconnected modules:

```mermaid
flowchart TD
    subgraph M1["Module 1: Feasibility Tracker"]
        A1[Client Inquiry / Feed] --> A2[WhatsApp Feeds & Location Maps]
        A2 --> A3{Survey Assignee}
        A3 -->|Field Lead| A4[Muthu / Fiberwa / Amit / Shanker]
        A4 --> A5[Multi-ISP Feasibility Survey<br/>RailTel, Airtel, Tata, Jio, LCOs]
        A5 --> A6[Price Discovery: OTC + MRC]
        A6 --> A7[Finalized Purchase Price]
        A7 --> A8[Feasibility Complete & Locked]
    end

    subgraph M2["Module 2: Commercial Pricing & Budgeting"]
        A8 --> B1[RFQ Multi-Quote Evaluation<br/>Quote-1 | Quote-2 | Quote-3]
        B1 --> B2[Margin Calculator & Client Proposal]
        B2 --> B3{BID STATUS}
        B3 -->|Won| B4[Finalized Quote Value]
        B3 -->|Lost| B5[Archived with Win/Loss Analysis]
        B4 --> B6[Budget Partitioning Engine]
        B6 --> B7[A: % to ISP Vendor]
        B6 --> B8[B: % to Partner / UDIN / Net Margin]
        B6 --> B9[C: % Site Implementation / Capex]
    end

    subgraph M3["Module 3: Implementation Tracker"]
        B4 --> C1[Customer PO Received]
        C1 --> C2[ISP Work Order Start]
        C2 --> C3{Bottleneck SLA Tracker}
        C3 -->|Blocker 1| C4[Pending with Vendor<br/>Fiber splicing, port allocation]
        C3 -->|Blocker 2| C5[Pending with UDIN / Partner<br/>Contract sign-off, statutory]
        C3 -->|Blocker 3| C6[Pending with Customer<br/>Rack/Power readiness, NOC]
        C3 -->|Blocker 4| C7[Pending with RailTel / ROW<br/>Crossing permissions, trenching]
        C4 & C5 & C6 & C7 --> C8[Link Testing, Latency & MRTG Verification]
        C8 --> C9[Site Live & Acceptance Test Sign-off]
    end

    subgraph M4["Module 4: Milestone Billing Tracker"]
        C9 --> D1[Site OTC Invoice Generated<br/>Amount + Submission Date]
        D1 --> D2[1st Cycle Recurring Invoice<br/>MRC Amount + Period + Submission]
        D2 --> D3[2nd Cycle Recurring Invoice<br/>Subsequent Cycles + Renewals]
        D1 & D2 & D3 --> D4[Bill Submission Tracker<br/>Physical Stamp / Courier AWB / Portal Receipt]
    end

    subgraph M5["Module 5: Payment Waterfall & Treasury"]
        D4 --> E1[Sitewise Customer Payment Received]
        E1 --> E2[Automated Waterfall Allocation Engine]
        E2 -->|Priority 1| E3[Vendor Payout / Site ISP Settlement<br/>Guarantees link continuity]
        E2 -->|Priority 2| E4[Loan & Debt Service Payment<br/>Capex financing, equipment EMI]
        E2 -->|Priority 3| E5[Salary & Operations Reserve<br/>Guaranteed 3-Month Runway]
    end
```

---

## 3. Detailed Module Specifications

### 3.1 Module 1: Feasibility Tracker
* **Inflow Channels:**
  * WhatsApp Webhook / Chat Parser: Ingests unstructured messages, addresses, and shared Google Maps links (`https://maps.app.goo.gl/...` or lat/long coordinates `12.9716, 77.5946`).
  * Manual Web Form / Bulk CSV Upload: For multi-site corporate RFPs (e.g., 50 ATM sites or 20 retail outlets).
* **Survey & Vendor Assignment:**
  * Auto-tagging or manual assignment to field leads:
    * `Muthu` (South Zone / Metros)
    * `Fiberwa` (Dark Fiber Infrastructure & Last-Mile Splicing)
    * `Amit / Shanker` (North Zone / Enterprise Fiber Operations)
* **Survey Parameter Capture:**
  * Distance from nearest fiber POP (meters / km).
  * Last Mile Medium: Single Mode Fiber (1310/1550nm), Microwave RF (with Line of Sight status), Leased Line, 4G/5G Enterprise Backup.
  * Right of Way (ROW) complexity: Municipal, Highway, Railway Crossing (RailTel clearance required).
  * Survey Latency & Bandwidth capacity (10 Mbps to 10 Gbps).
* **Price Discovery Matrix:**
  * Operator quotes: RailTel, Bharti Airtel, Tata Tele, Reliance Jio, BSNL, Local Dark Fiber Provider.
  * Upstream OTC (One-Time Setup Cost) & MRC (Monthly Recurring Charge).
* **Status State Machine:**
  `DRAFT_SURVEY -> ASSIGNED -> SURVEY_IN_PROGRESS -> MULTI_QUOTE_RECEIVED -> PRICE_NEGOTIATION -> FEASIBILITY_LOCKED -> EXPIRED / CANCELLED`

---

### 3.2 Module 2: Commercial Pricing, RFQ & Budgeting Engine
* **Vendor Quote Comparison:**
  * Side-by-side comparative table for Quote-1, Quote-2, and Quote-3.
  * Parameters: Bandwidth, Medium, SLA commitment (99.5% vs 99.9%), MTTR (Mean Time To Repair: 2 hrs vs 4 hrs), Upstream OTC & MRC.
* **Margin & Bid Optimizer:**
  * Target margin slider (e.g., 25% gross margin).
  * Automated tax calculation (18% GST in India, SAC Code `998422` for Internet Telecommunications Services).
  * Bid status tracking: `DRAFT_QUOTE -> SUBMITTED_TO_CLIENT -> UNDER_NEGOTIATION -> BID_WON -> BID_LOST`.
* **Budget Allocation Engine (Post Bid Win):**
  * When a quote is won, the system locks the contract value and splits the budget according to predetermined or custom ratios:
    * **Bucket A (% to ISP Vendor):** Upstream bandwidth cost, fiber maintenance, port charges.
    * **Bucket B (% to Partner / UDIN):** Channel partner / franchise commission, statutory certification fees (UDIN - Unique Document Identification Number), net corporate margin.
    * **Bucket C (% Site Implementation / Capex):** Media Converters, CPE Router (Cisco, MikroTik, Ubiquiti), 19-inch rack, patch cords, field technician deployment, earthing and power cabling.

---

### 3.3 Module 3: Implementation & Delivery SLA Tracker
* **Purchase Order (PO) Ingestion:**
  * Captures Customer PO Number, PO Date, PO Value, SLA start commitment, and committed Delivery Lead Time (e.g., 15 / 30 / 45 calendar days).
* **Work Order Initiation:**
  * Generates digital Work Order to chosen ISP vendor.
  * Assigns delivery project manager and field provisioning engineer.
* **Milestone & Blocker SLA Tracker:**
  * Clear accountability tagging across four distinct blocker categories:
    1. `Pending with Vendor`: Fiber pulling, joint enclosure splicing, upstream POP port provisioning, CPE hardware dispatch.
    2. `Pending with UDIN / Partner`: Partner agreement sign-off, compliance clearance, insurance coverage.
    3. `Pending with Customer`: Server room access, UPS raw power readiness, 2U rack space availability, local contact person (LCP) non-responsive.
    4. `Pending with RailTel / Authority`: Railway track crossing permission, NHAI road digging clearance, Municipal tree pruning or ROW fee payment.
  * Real-time SLA breach countdown timers (`LiveTimer` component from design spec).
* **Site Live Sign-off:**
  * Network test capture: Primary & Secondary WAN IP, Subnet mask, Default Gateway, MTU, Primary/Secondary DNS.
  * Ping test results (packet loss %, avg jitter, latency in ms).
  * MRTG / PRTG link monitoring URL setup.
  * Customer Acceptance Test (AT) sign-off document upload and Commissioning Report (CR) generation.

---

### 3.4 Module 4: Milestone Billing & Submission Tracker
* **Billing Triggers & Cycles:**
  * **Site OTC Invoicing:** Triggered automatically upon AT Sign-off / Site Live date. Captures OTC invoice amount, GST component, and invoice date.
  * **1st Cycle Recurring Billing:** First month or first quarter in advance/arrears as per contract.
  * **2nd Cycle Recurring Billing:** Subsequent billing cycles with automatic recurring schedule generator.
* **Bill Submission Verification Engine:**
  * In Indian telecom enterprise operations, payment credit clocks (30/45/60 days) start **only** upon physical or validated portal submission of the invoice.
  * The system tracks:
    * Mode: `PHYSICAL_HAND_DELIVERY`, `COURIER_TRACKED`, `ENTERPRISE_PORTAL_UPLOAD`, `EMAIL_ACKNOWLEDGED`.
    * Proof: Scanned copy of physically stamped invoice acknowledgment or courier AWB tracking receipt.
    * Dates: Bill Generation Date, Dispatch Date, Acknowledged Submission Date, and Computed Payment Due Date.

---

### 3.5 Module 5: Payment Waterfall & Treasury Management
* **Sitewise Customer Receivable Reconciliation:**
  * Inflow tracking: Client payment received against specific site invoices (Bank UTR number, TDS deducted under Section 194C/194J, GST-TDS under Section 51, Net amount credited).
* **Priority Waterfall Cashflow Distribution:**
  * Automated distribution into three segregated accounts/buckets:
    1. **Priority 1: Vendor / Site Payment:** Settlement of upstream carrier invoices for the respective site. Ensures no upstream service disconnection or SLA degradation.
    2. **Priority 2: Loan & Debt Service:** Scheduled debt payment, equipment finance EMI, working capital credit line paydown.
    3. **Priority 3: 3-Month Runway & Salary Reserve:** Allocation to corporate operational reserve ensuring at least 90 days of staff payroll and overhead security.
* **Executive Treasury Dashboard:**
  * Visualizes cash waterfall using stacked gauges, live burn rates, vendor payables aging, and runway indicators.

---

## 4. Multi-Tenant Role-Based Access Control (RBAC)

The system enforces strict permission scopes across roles:

| Role | Feasibility | Quotes & Budget | Implementation | Billing & Submission | Treasury & Payouts | Settings & Team |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Platform / Super Owner** | Full | Full | Full | Full | Full | Full |
| **Commercial Manager** | Full | Full (Quotes, Margins) | View Only | View Only | View Only | No |
| **Operations / Field Lead** (Muthu, Amit) | Full (Surveys) | View Only | Full (Blockers, Work Orders) | View Only | No | No |
| **Billing / Accounts Executive** | View Only | View (Finalized) | View (Site Live) | Full (Invoices, AWB) | View Only | No |
| **Finance / Treasury Head** | View Only | Full (Budgeting) | View Only | Full | Full (Waterfall) | View Only |
| **Vendor / Partner (External)** | Submit Quote | View Assigned Quote | Update Blocker | Submit Vendor Bill | View Payout Status | No |

---

## 5. PostgreSQL Database Schema Architecture

The relational schema implements standard multi-tenant scoping (`tenant_id`), UUID primary keys, and robust indexing:

```sql
-- ENUMS
CREATE TYPE feasibility_status AS ENUM (
  'DRAFT', 'ASSIGNED', 'IN_SURVEY', 'PRICE_DISCOVERY', 'FEASIBLE', 'UNFEASIBLE', 'EXPIRED'
);

CREATE TYPE quote_status AS ENUM (
  'DRAFT', 'PENDING_APPROVAL', 'SENT_TO_CLIENT', 'WON', 'LOST', 'REVISED'
);

CREATE TYPE implementation_status AS ENUM (
  'PO_RECEIVED', 'WORK_ORDER_ISSUED', 'IN_PROGRESS', 'BLOCKED', 'TESTING', 'SITE_LIVE', 'HANDOVER_COMPLETED'
);

CREATE TYPE blocker_entity AS ENUM (
  'VENDOR', 'UDIN_PARTNER', 'CUSTOMER', 'RAILTEL_AUTHORITY', 'NONE'
);

CREATE TYPE invoice_type AS ENUM (
  'OTC', 'CYCLE_1', 'CYCLE_2', 'RECURRING_MONTHLY', 'RECURRING_QUARTERLY', 'RECURRING_ANNUAL'
);

CREATE TYPE submission_mode AS ENUM (
  'PHYSICAL_STAMP', 'COURIER_AWB', 'PORTAL_UPLOAD', 'EMAIL_ACK'
);

-- 1. FEASIBILITY REQUESTS TABLE
CREATE TABLE feasibility_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_code VARCHAR(32) NOT NULL UNIQUE, -- e.g. FEAS-26-0012
  client_name VARCHAR(255) NOT NULL,
  source_channel VARCHAR(64) DEFAULT 'WHATSAPP_FEED', -- WHATSAPP, EMAIL, PORTAL
  raw_message_text TEXT,
  site_name VARCHAR(255) NOT NULL,
  address TEXT NOT NULL,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  pincode VARCHAR(10),
  required_bandwidth_mbps INT NOT NULL,
  preferred_medium VARCHAR(32) DEFAULT 'FIBER', -- FIBER, RF, LEASED_LINE
  assigned_surveyor_id UUID REFERENCES users(id), -- Muthu, Amit, etc.
  surveyor_notes TEXT,
  status feasibility_status DEFAULT 'DRAFT',
  feasible_isp_names TEXT[], -- ['RailTel', 'Airtel', 'LocalFiber']
  nearest_pop_distance_meters INT,
  los_status VARCHAR(32), -- CLEAR, BLOCKED, NA
  vendor_otc_quote DECIMAL(12, 2) DEFAULT 0.00,
  vendor_mrc_quote DECIMAL(12, 2) DEFAULT 0.00,
  finalized_price DECIMAL(12, 2) DEFAULT 0.00,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. COMMERCIAL QUOTES & BUDGETING TABLE
CREATE TABLE commercial_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_number VARCHAR(32) NOT NULL UNIQUE, -- e.g. QTE-26-0045
  feasibility_id UUID REFERENCES feasibility_requests(id),
  client_name VARCHAR(255) NOT NULL,
  
  -- Multi-Quote Vendor Submissions
  quote_1_vendor VARCHAR(128),
  quote_1_mrc DECIMAL(12, 2),
  quote_1_otc DECIMAL(12, 2),
  quote_1_sla DECIMAL(4, 2), -- e.g. 99.50
  
  quote_2_vendor VARCHAR(128),
  quote_2_mrc DECIMAL(12, 2),
  quote_2_otc DECIMAL(12, 2),
  quote_2_sla DECIMAL(4, 2),

  quote_3_vendor VARCHAR(128),
  quote_3_mrc DECIMAL(12, 2),
  quote_3_otc DECIMAL(12, 2),
  quote_3_sla DECIMAL(4, 2),

  -- Final Selected / Won Proposal
  status quote_status DEFAULT 'DRAFT',
  finalized_vendor_name VARCHAR(128),
  finalized_quote_value DECIMAL(12, 2) NOT NULL, -- Total Client Price
  margin_percentage DECIMAL(5, 2) NOT NULL,

  -- Budgeting Allocation Split
  vendor_payout_pct DECIMAL(5, 2) NOT NULL, -- Bucket A: % to vendor
  partner_udin_pct DECIMAL(5, 2) NOT NULL,  -- Bucket B: % to partner/UDIN
  site_capex_pct DECIMAL(5, 2) NOT NULL,    -- Bucket C: % to site implementation

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. IMPLEMENTATION & SITE DELIVERY TABLE
CREATE TABLE implementation_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_code VARCHAR(32) NOT NULL UNIQUE, -- e.g. SITE-BLR-01
  quote_id UUID REFERENCES commercial_quotes(id),
  po_number VARCHAR(64) NOT NULL,
  po_date DATE NOT NULL,
  po_value DECIMAL(12, 2) NOT NULL,
  isp_vendor_name VARCHAR(128) NOT NULL,
  
  work_start_date DATE,
  committed_sla_days INT DEFAULT 30,
  target_live_date DATE,
  
  status implementation_status DEFAULT 'PO_RECEIVED',
  current_blocker blocker_entity DEFAULT 'NONE',
  blocker_reason TEXT,
  blocker_raised_at TIMESTAMPTZ,

  -- Technical Handover Details
  wan_ip_address VARCHAR(45),
  subnet_mask VARCHAR(45),
  gateway_ip VARCHAR(45),
  primary_dns VARCHAR(45),
  secondary_dns VARCHAR(45),
  mrtg_graph_url TEXT,
  tested_latency_ms DECIMAL(5, 2),
  acceptance_signoff_date DATE,
  commissioning_report_url TEXT,
  is_live BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. MILESTONE BILLING & SUBMISSION TRACKER
CREATE TABLE site_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number VARCHAR(64) NOT NULL UNIQUE,
  site_id UUID NOT NULL REFERENCES implementation_sites(id) ON DELETE CASCADE,
  invoice_type invoice_type NOT NULL, -- OTC, CYCLE_1, CYCLE_2
  billing_period_start DATE,
  billing_period_end DATE,
  base_amount DECIMAL(12, 2) NOT NULL,
  gst_amount DECIMAL(12, 2) NOT NULL,
  total_amount DECIMAL(12, 2) NOT NULL,
  
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,

  -- Submission Tracking
  submission_status VARCHAR(32) DEFAULT 'PENDING_SUBMISSION', -- PENDING, SUBMITTED, ACKNOWLEDGED
  submission_mode submission_mode,
  submission_date DATE,
  courier_awb_number VARCHAR(128),
  submission_receipt_url TEXT,
  customer_acknowledged_by VARCHAR(128),

  -- Payment Status
  payment_status VARCHAR(32) DEFAULT 'UNPAID', -- UNPAID, PARTIALLY_PAID, PAID
  amount_received DECIMAL(12, 2) DEFAULT 0.00,
  tds_deducted DECIMAL(12, 2) DEFAULT 0.00,
  payment_received_date DATE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. PAYMENT WATERFALL & TREASURY ALLOCATIONS
CREATE TABLE payment_waterfall_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES site_invoices(id),
  total_inflow_received DECIMAL(12, 2) NOT NULL,
  received_date DATE NOT NULL,
  bank_utr_ref VARCHAR(128) NOT NULL,

  -- Priority 1: Upstream ISP Vendor Settlement
  vendor_allocation_amount DECIMAL(12, 2) NOT NULL,
  vendor_payout_status VARCHAR(32) DEFAULT 'SCHEDULED', -- SCHEDULED, PAID
  vendor_payout_date DATE,
  vendor_utr_ref VARCHAR(128),

  -- Priority 2: Loan / Debt Service
  loan_allocation_amount DECIMAL(12, 2) NOT NULL,
  loan_account_ref VARCHAR(128),
  loan_payment_status VARCHAR(32) DEFAULT 'SCHEDULED',

  -- Priority 3: 3-Month Salary / Operational Runway Reserve
  salary_reserve_amount DECIMAL(12, 2) NOT NULL,
  reserve_account_ref VARCHAR(128) DEFAULT 'RUNWAY_RESERVE_ESCROW',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 6. REST API Design & Contracts

The REST API implements standard 3-layer architecture with strict Joi validation and standardized envelope responses:

```json
{
  "success": true,
  "data": { ... },
  "message": "Resource fetched successfully",
  "meta": { "timestamp": "2026-10-17T15:30:00Z" }
}
```

### Core API Endpoints:

| Category | Method | Endpoint | Description |
| :--- | :--- | :--- | :--- |
| **Feasibility** | `POST` | `/api/v1/feasibility` | Create feasibility request (auto-parses WhatsApp/Maps) |
| | `GET` | `/api/v1/feasibility` | List surveys with filters (status, surveyor, pincode) |
| | `PATCH` | `/api/v1/feasibility/:id/assign` | Assign field surveyor (Muthu/Fiberwa/Amit) |
| | `PUT` | `/api/v1/feasibility/:id/quote` | Update multi-ISP feasibility quotes & finalized price |
| **Commercials** | `POST` | `/api/v1/quotes` | Create multi-quote comparison (Quote-1, 2, 3) |
| | `POST` | `/api/v1/quotes/:id/bid-win` | Lock Bid Win and calculate A/B/C budget percentages |
| **Implementation**| `POST` | `/api/v1/sites/from-po` | Create implementation site from PO |
| | `PATCH` | `/api/v1/sites/:id/blocker` | Update blocker (Vendor/UDIN/Customer/RailTel) with SLA note |
| | `POST` | `/api/v1/sites/:id/commission` | Complete link test & submit Acceptance Test (AT) |
| **Billing** | `POST` | `/api/v1/invoices/generate-otc` | Auto-generate OTC invoice on site live |
| | `POST` | `/api/v1/invoices/:id/submission` | Record bill submission (AWB / physical acknowledgment) |
| | `GET` | `/api/v1/invoices/submission-tracker`| Invoices aging & bill submission acknowledgment tracker |
| **Treasury** | `POST` | `/api/v1/treasury/record-receipt`| Record customer payment & execute waterfall split |
| | `GET` | `/api/v1/treasury/waterfall-summary`| Executive summary of vendor payables, loan, and runway |

---

## 7. Performance, Indexing & High-Volume Strategy

1. **Spatial & Geographic Queries:**
   * PostgreSQL PostGIS or composite index on `(latitude, longitude)` enables sub-10ms nearest-POP lookup across 100,000+ past survey pins.
2. **Composite Tenant Indexing:**
   * `CREATE INDEX idx_feas_tenant_status ON feasibility_requests (tenant_id, status);`
   * `CREATE INDEX idx_sites_tenant_blocker ON implementation_sites (tenant_id, current_blocker);`
   * `CREATE INDEX idx_invoices_tenant_submission ON site_invoices (tenant_id, submission_status, due_date);`
3. **Redis Caching:**
   * Active blocker summary counts cached in Redis (`TTL: 120s`, invalidated on blocker update).
   * Live treasury waterfall cashflow snapshot cached (`TTL: 300s`).
