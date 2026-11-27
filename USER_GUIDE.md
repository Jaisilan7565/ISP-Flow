# ISP-Flow — User Guide (start to end)

This guide follows one client order all the way through the software:

> **A client sends an order on WhatsApp or email → a field engineer enters it in the order form → each site is surveyed, quoted, won, delivered, billed and paid → the money is split automatically.**

Read Part 1 once to get the software running and Part 2 once to set up your company. After that, Part 3 is the everyday workflow. Parts 4–7 are reference.

| Part | What it covers | Who needs it |
| :- | :--- | :--- |
| [1. Install and start](#part-1--install-and-start-the-software) | Getting the software running on a computer | Developer / IT, once |
| [2. First-time setup](#part-2--first-time-setup) | Creating the company, team, clients, ISPs / vendors and settings | Platform Admin and Company Admin, once |
| [3. The everyday workflow](#part-3--the-everyday-workflow-one-order-from-start-to-end) | One client order from WhatsApp to payment, step by step | Everyone |
| [4. Other everyday tasks](#part-4--other-everyday-tasks) | Hand-over, more sites, one PO for many sites, search, documents | Everyone |
| [5. How the money works](#part-5--how-the-money-works) | Quote value, budget split, billing cycles, payment waterfall | Office, billing, finance |
| [6. Rules the software enforces](#part-6--rules-the-software-enforces-why-is-this-button-missing) | Why a button is missing or an action is refused | Everyone |
| [7. Limits](#part-7--what-is-not-built-yet) | What is not built yet | Owner |

### Words used in this guide

| Word | Meaning |
| :--- | :--- |
| **Client** | The company that orders links from you and pays your bills, e.g. a telecom operator, a bank or an enterprise. One order can cover many sites. |
| **Site** | One location where a link is delivered. |
| **ISP / vendor** | The provider you buy the link from, or a contractor you pay for site work. |
| **Your company** | The ISP company that uses ISP-Flow, onboarded by the Platform Admin. Screens show it by its own name, e.g. **"B → *Your company* share"** (the part of each deal you keep) and **"Pending with *Your company* (internal)"** (work waiting on your own side). |
| **Field engineer** | Your own staff member who takes a site from feasibility through to delivery. |
| **OTC / MRC** | One-time charge / monthly recurring charge. |

---

## The whole flow on one page

```
 SET UP (once)
 Platform Admin ──► creates the company + its Company Admin
 Company Admin ───► adds team · clients · ISPs & vendors · company settings

 EVERY ORDER
 ⓪ Clients & Orders   A client sends an order on WhatsApp / email
                      Field engineer fills "New client order" (client + the first site) ─► Log order ─► "Add a site" for each extra location
                      (the engineer who logs it OWNS those sites until delivery)
        │
 ① Feasibility        Field engineer surveys ISPs per site (feasible? ISP OTC / MRC)
                      Commercial picks the ISP + client price ─► Finalize price ─► Mark feasibility complete
                      (or STOP the site if not feasible)
        │  automatic: a quote is created
 ② Quote & Budget     Quote-1 / 2 / 3 compared ─► Mark as sent ─► Bid win (A % vendor · B % own share · C % site)
        │  automatic: the site is created, "Awaiting PO", owner = the same field engineer
 ③ Implementation     Office records the client's PO ─► Engineer: Start ISP work
                      ─► Pending with client / ISP / your company / customer at site (raise ⇄ resolve)
                      ─► Engineer fills live details ─► Mark site live
        │  automatic: the 1st bill (OTC + 1st cycle) is created
 ④ Billing            Print GST invoice ─► record bill submission (physical / courier / email / portal)
                      later cycles are created automatically (or "Run billing")
        │
 ⑤ Payments           Record payment received (UTR, TDS) ─► split automatically:
                      ① vendor of that site ─► ② loan EMI ─► ③ salary reserve (3 months)
                      ─► record payouts to vendor / loan / salary
```

Nothing is typed twice. Each step carries its data forward: site name, the client's site ID, location, bandwidth, owner, prices and PO.

**Two things that help everywhere:**
- **Every input has a hint** underneath it, saying what to type. If something is wrong, the hint turns into a red message explaining what to fix, and nothing is saved until every field is right.
- **Screens update by themselves.** When a colleague changes something (e.g. a site goes live, or a payment is recorded), your open screen refreshes within a second. You don't need to reload.

---

## Part 1 — Install and start the software

*For the developer or IT person. Do this once per computer.*

### What you need

- **Node.js 24**
- **PostgreSQL 16 or newer**, with an empty database called `isp_flow`. A second one, `isp_flow_test`, is needed only to run the automated tests.
- Chrome or Edge, on a laptop or a phone.

### Steps

```bash
# 1. The server (API)
cd Web/backend
cp .env.example .env      # then open .env and edit it (see below)
npm install
npm run db:setup          # creates all tables and the first Platform Admin login
npm run seed:demo         # OPTIONAL: adds a sample company with sample users, clients and ISPs to try things out
npm run dev               # server runs at http://localhost:4000

# 2. The web app (in a second terminal)
cd Web/frontend
npm install
npm run dev               # open http://localhost:2000 in the browser
```

**Edit these lines in `Web/backend/.env`:**

| Setting | What to put |
| :--- | :--- |
| `DATABASE_URL` | Your PostgreSQL connection, e.g. `postgres://postgres:yourpassword@localhost:5432/isp_flow` |
| `JWT_SECRET` | Any long random text. **Change it before real use.** |
| `PLATFORM_OWNER_EMAIL` / `PLATFORM_OWNER_PASSWORD` | The first Platform Admin login. You must change the password on first sign-in. |
| `BILLING_SCHEDULER_MINUTES` | How often recurring bills are created automatically (default every 360 minutes; `0` = off) |
| `APP_TIMEZONE` | Leave as `Asia/Kolkata`. "Today", SLA days and due dates use India time. |

**To check it is running**, open http://localhost:4000/api/v1/health. It should show `"status":"ok"` and `"database":"ok"`.

**Every day after that:** run `npm run dev` in `Web/backend` and in `Web/frontend`, then open http://localhost:2000.

**API documentation (for developers):** http://localhost:4000/api/docs (Swagger UI). Sign in with `POST /api/v1/auth/login`, copy the token, then click **Authorize**.

### Or: run it with Docker

On a server or PC with Docker installed, from the project folder:

```bash
cp .env.docker.example .env      # open .env and change the passwords, JWT secret and Platform Admin login
docker compose up -d --build
```

Then open http://localhost:2000 (API docs at http://localhost:2000/api/docs). This starts three containers:
- `db`: PostgreSQL, with its data kept in a volume;
- `api`: the server, which updates the database tables automatically on start;
- `web`: Nginx, which serves the app and forwards `/api` and live updates to the server.

Uploaded documents are kept in a volume. For a public server, put HTTPS in front and set `PUBLIC_URL` in `.env` to the address people use.

**First sign-in:** use the Platform Admin email and password from `.env`, then continue with Part 2. If you ran `npm run seed:demo`, the sample company's logins are printed when it finishes, and all of them use the password `Demo@1234`.

> **Tip:** to be two people at once (e.g. a field engineer and the admin), use a normal browser window for one and an InPrivate / Incognito window for the other.

---

## Part 2 — First-time setup

### 2.1 Platform Admin: create the company

1. Sign in with the Platform Admin login. Set your own password when asked.
2. On **Companies**, click **Onboard company**.
3. Fill in the company name, a short code, GSTIN, state, and the **Company Admin's** name and email.
4. Click **Create**. A box shows the admin's email and a **temporary password**. Send these to the Company Admin.

On each company's row, the Platform Admin can also:
- **Edit** (pencil button): change the company's name, code, GSTIN, state, contact or address, and the Company Admin's name, sign-in email or phone. If you change the admin's email, they sign in with the new email and their password stays the same. Every edit is recorded in the activity log.
- **Reset admin password** (key button): gives the Company Admin a new temporary password.
- **Suspend**: signs all the company's users out immediately. **Activate** lets them back in.

### 2.2 Company Admin: set up the company

Sign in with the temporary password and set your own. The dashboard shows a **Getting started** checklist. Do these things in any order; the checklist disappears when they are done.

| Menu | What to add | Notes |
| :--- | :--- | :--- |
| **Company Settings** | GSTIN, state, address, invoice prefix, GST %, default credit days, default A / B / C %, contract months, delivery SLA days, **monthly salary & overheads**, **loan EMI per month** | The salary and EMI drive the payment split (Part 5). A + B + C must equal 100; B % is your company's own share. |
| **Clients & Orders → Clients → Add client** | Each client: name, type (PSU / Govt, Telecom, BFSI, Enterprise, Other), GSTIN, state, billing address, contact, **credit days**, billing cycle (monthly / quarterly), and an optional **note** | Clients are the companies that order from you and pay you. |
| **ISPs & Vendors → Add ISP / vendor** | Each ISP you buy links from, contractors for site work, and any other vendor. Optional: their **address** (address, city, state, pincode, Google Maps link or latitude / longitude) and a **note** | These are the companies *you pay*. Fill the address for ISPs: it will be used to find ISPs near a new feasibility site (planned feature). The bin icon deletes a vendor added by mistake, but only while the **Used in** column says *Not used yet*. Once a survey, quote, site or payout uses it, untick **Active** instead. |
| **Team & Roles → Add user** | Each person with their role (table below). Staff who take sites from survey to delivery get the **Field Engineer** role. | Each new user gets a temporary password and must change it at first sign-in. **Reset password** gives them a new one. **Field team workload** shows each engineer's open work. |

### 2.3 Who can do what

| Role | Can do | Cannot do / see |
| :--- | :--- | :--- |
| **Company Admin** | Everything | — |
| **Field Engineer** | Log client orders, survey ISPs, start ISP work, raise / resolve pending items, mark site live, **log link down / restored** — **only on their own sites**; see all live sites and each ISP's sites (amounts in the activity history are masked) | Prices, quotes, bills, payments, money of any kind; recording the PO; stopping, renewing or disconnecting a site; other engineers' sites |
| **Commercial Manager** | Everything in Feasibility (assign, finalize price, complete, stop), Quotes and Bid win, add ISPs / vendors, log orders | Record PO, billing, payments |
| **Operations / Field Lead** | Log orders, assign engineers, **record client POs**, hand a site to another engineer, run delivery on any site, **renew, disconnect or reconnect** a site, log link faults | Finalize price, quotes, billing, payments |
| **Billing / Accounts** | Bills: print, submission, cancel & re-issue, next cycle, record payment received | Payouts, settings, team |
| **Finance / Treasury Head** | Everything Billing can do, plus **Payments**: record payouts to vendor / loan / salary | Settings, team |

Each person sees only the menus they can use. A field engineer's menu is: Dashboard, Live Sites, Clients & Orders, Feasibility, Implementation, ISPs & Vendors, and Activity Log.

---

## Part 3 — The everyday workflow: one order from start to end

The example below is a client ordering links at three of its locations.

### Step 0 · The order arrives and is entered — *Field Engineer*

The client sends an order on WhatsApp, email, a letter or a portal, for links at one or more locations.

1. In ISP-Flow, click **New client order**. It is on **My work** (the dashboard), on **Clients & Orders**, and on **1 · Feasibility**.
2. Choose **Received on** (WhatsApp / Email / Portal / Letter / Phone) and the **Client** (required).
3. Fill in the **site**:
   - required: **Site name**, **Bandwidth (Mbps)** and **Address**;
   - **Link type**: *Primary* (the default) or *Secondary (backup) link*, for a second link at a location that has or will have a primary link. Log the backup as its own site, with the same name and address;
   - **Static IP**: *Not needed* (default), *1 IP*, or a block (/30 = 4, /29 = 8, /28 = 16, /27 = 32, /26 = 64 IPs) if the client wants static IPs with the link;
   - optional: city, a 6-digit **pincode**, the **medium** (fiber / RF / leased line / broadband / 4G-5G), a **Google Maps link** (the map location is read from it) or latitude / longitude, the client's **site ID** (printed on bills later), and the **contact at site** with their phone.
4. Managers choose the **field engineer** who takes it forward. A field engineer always owns the orders they log.
5. Optional: open **More order details** for the client's **order / ref no.**, the **wanted-by date**, the received date (today by default), who sent the order (name, phone, email) and notes.
6. Click **Log order**.

Each field has a hint underneath saying what to enter. If something is wrong, for example a 5-digit pincode or a short phone number, the field turns red with a message, and nothing is saved until it is fixed.

**What happens:** an order **ORD-…** is created with its first site request, **owned by the engineer who logged it**, and the order opens.

**More locations in the same order?** In the open order, click **Add a site to this order** at the bottom, fill the same site fields and click **Add site**. Repeat for each location (Part 4.1).

To keep the client's original message, attach a screenshot or the email under **Documents** in the order.

### Step 1 · Feasibility survey — *Field Engineer, then Commercial*

**Field engineer (the owner):**
1. Open **1 · Feasibility**. "Only mine" is ticked, so you see your own sites.
2. Open a site, e.g. *City Branch Office*.
3. For each ISP you checked, click **Add ISP** and enter:
   - whether it is feasible (or not feasible, with a reason);
   - the ISP's **OTC** (one-time) and **MRC** (monthly) price;
   - if the site needs static IPs, the ISP's **static IP charge per month** (0 if it is included);
   - medium (fiber / RF / broadband / leased line), distance to the nearest POP, lead time and remarks.
   - **ISP not in the list?** Click **New ISP (not in the list)**, fill the same details as in ISPs & Vendors (only the name is required: contact, GSTIN, address, pincode, map link, notes if you have them) and click **Add ISP**. It is saved to *ISPs & Vendors* and picked in the survey. The same name cannot be added twice.
4. Click **Save survey**. The status becomes **Survey done**.

**Commercial Manager (or Admin):**
5. Open the same site. Under **Price → finalized price**, choose the ISP to use and enter the **client OTC** and **client MRC** (what the client will pay). If the site needs static IPs, also enter the **client static IP charge per month**; the hint shows the margin on it.
6. Click **Finalize price**, then **Mark feasibility complete**.

**Not feasible?** Commercial, Operations or the Admin clicks **Stop → Not feasible** with a reason. The site is closed, and the order tracker shows it as *Stopped*.

**What happens:** a quote **QTE-…** is created automatically, with Quote-1 / Quote-2 / Quote-3 pre-filled from the feasible ISPs.

### Step 2 · Quote & Budget — *Commercial Manager*

1. Open **2 · Quote & Budget** and click the quote.
2. Compare Quote-1 / 2 / 3. The margin is calculated for each, including the static IP charge if the site has one. Adjust prices if needed.
3. Click **Mark as sent** once the quote has gone to the client.
4. When the client accepts, click **Bid win**:
   - choose the winning quote;
   - check the final client OTC / MRC and the contract months;
   - set the budget split: **A % → Vendor**, **B % → your company's own share**, **C % → Site implementation**. These must add up to 100.
5. If the client refuses, click **Bid lost** with a reason.

**What happens on Bid win:** the **finalized quote value** and the A / B / C amounts are shown, and site **SITE-…** is created as **Awaiting PO**. It carries over the client's site ID, the order, the site contact and the **delivery owner** (the same field engineer).

### Step 3 · Implementation (delivery) — *Office, then Field Engineer*

**Operations / Admin: record the client's PO**
1. Open **3 · Implementation** and click the site.
2. Enter the client PO number, PO date and PO value. Click **Record PO received**.
3. Upload the PO copy under **Documents**.
   - **One PO for several sites?** Use **One PO for several sites** instead (Part 4.3).

**Field engineer (the owner): deliver the link**
4. Open the site and fill **Step 2 · ISP work start**: work start date, ISP work order number and **delivery SLA days**. Click **Start ISP work**. The SLA clock starts.
5. When something holds the work up, use **Pending with** to raise it. Choose the party and give a reason, then click **Raise**. The parties are:
   - **the client** (shown by its own name): waiting on the client, e.g. room access or a letter;
   - **ISP / vendor**: e.g. the ISP's last-mile work;
   - **your own company** (shown as "*Your company* (internal)"): work waiting on your side, e.g. equipment not yet issued or an internal approval;
   - **Customer at site**: the people at the location, e.g. the branch or building manager;
   - **ROW / authority**: right-of-way or crossing permission (renamable in Settings).
6. When it is sorted, click **Resolve** and say how. The history is kept.
   - While any item is open, **the site cannot go live**.
   - Open items appear on the dashboard as "Pending with *client name*: reason".
7. When the link is up, fill **Step 3 · Details of site live**:
   - required: live date, circuit ID, WAN IP / subnet and the AT sign-off date, plus the **static IPs allotted** (e.g. 103.21.4.8/29) when the site needs static IPs;
   - optional: gateway, DNS, latency, packet loss, MRTG / PRTG link, and who signed the AT for the client.
8. Click **Mark site live & start billing**. Upload the AT sign-off under **Documents**.

**What happens on go-live:** the **first bill** is created automatically. It is **one invoice** with the OTC and the 1st cycle together: OTC + 1st month (or quarter) MRC + static IP charge, plus GST. It is addressed to the client, with the client's site ID and PO printed on it. In Billing it is labelled **Cycle 1 + OTC**; the printout shows the OTC, the link service and the static IPs as separate lines. The link is described by its **medium** from the order (for example *Broadband internet service 100 Mbps*). From cycle 2 on, each bill is the MRC only.

> Sites that went live before this change have a separate *Site OTC* bill. To combine it with the cycle 1 bill, open the *Site OTC* bill and use **Cancel & re-issue**: if cycle 1 has no payment yet, both are replaced by one *Cycle 1 + OTC* bill.

### Step 4 · Billing — *Billing / Accounts*

1. Open **4 · Billing** and click the bill.
2. Click **Print GST invoice**. The invoice shows:
   - both GSTINs and SAC 998422;
   - CGST + SGST (same state) or IGST (other state);
   - the amount in words;
   - **the client's site ID and PO**.
3. Send the bill to the client. Then fill **Bill submission** and click **Record bill submission**:
   - mode: Physical (stamp & sign), Courier (AWB number required), Email, or Customer portal;
   - date of submission;
   - who acknowledged it.
4. Upload the stamped copy or courier receipt under **Documents**.

**What happens:** the **due date** is set to the submission date plus the client's credit days. An unpaid bill past its due date turns **overdue** and shows on the dashboard.

**Later months:** the next cycle (2nd, 3rd …) is created automatically every few hours. To create it now, click **Run billing** (all sites) or **Next cycle** (one site). A bill raised before its period starts (billing in advance) is dated the day you raise it, with the coming period printed on it, so you can submit it to the client straight away. A wrong bill that is still unpaid can be fixed with **Cancel & re-issue**.

**Credit notes:** to reduce a bill (an outage, a goodwill discount, a wrong charge), open it → **Credit notes** → **Issue credit note**: the amount before GST (GST is added at the bill's rate), the reason, and — only if the ISP also gave you a credit — how much to take off the ISP cost. The credit note has its own number (e.g. `INV-CN/26-27/0001`) and **Print** gives a GST credit note. The bill's outstanding goes down; a bill fully covered by payments and credits is settled. If the bill was already paid, it shows **Excess received** — refund it or adjust it on the next bill. A bill with a credit note cannot be cancelled.

### Step 5 · Payment received and the automatic split — *Billing or Finance*

1. When the client pays, open the bill (or **5 · Payments**) and click **Record payment**. Enter:
   - the amount received;
   - the date;
   - the UTR / cheque number;
   - any TDS deducted.
2. Click **Record payment received**. The message shows **how the money was split**, in order:
   1. **Vendor / site payment**: what is still owed to the ISP for *this* site;
   2. **Loan payment**: this month's EMI, if not yet covered;
   3. **Salary reserve**: topped up to the reserve months (default 3) of salary and overheads;
   4. the rest is surplus.

**Finance Head: pay out the money**
3. In **5 · Payments**, the three pools show what is set aside: vendor, loan and salary.
4. Click **Pay** (or **Record payout**). Choose vendor / loan / salary, the amount, the date and the UTR / reference. The software refuses to pay out more than a pool holds.

### Step 6 · Track the order and the client — *Anyone with access*

- **Clients & Orders → Orders → the order:**
  - a progress bar and table show every site's stage: Feasibility, Quote, Awaiting PO, In delivery, Live, Stopped, Lost;
  - click a site row to open **Site 360** for it;
  - managers also see the money.
- **Clients & Orders → Clients → the client:**
  - all of the client's orders and sites;
  - live monthly charge, total billed, received, outstanding and **overdue**.
- **Dashboard:**
  - pipeline counts per stage;
  - alerts for SLA overdue, items pending with the client / ISP, bills not submitted, and overdue payments;
  - field engineers see **My work**: surveys pending, sites with commercial, awaiting PO, ready to start, in delivery, blocked and delivered.

---

## Part 4 — Other everyday tasks

### 4.1 The client sends more sites for the same order
Open the order. At the bottom, under **Add more sites to this order**, click **Add a site to this order**, fill the site and click **Add site** (or **Cancel**). Repeat for each location. Only the order's owner or a manager can do this.

### 4.1a Edit or delete an order
Open the order and click **Edit order** to correct the client, the received date and channel, the client's ref no., the wanted-by date, the client contact, the notes or (managers) the order owner. Changing the client moves all the order's sites to that client. Once any site of the order has a quote, the client is locked.

**Delete order** is for an order logged by mistake. It removes the order, its site requests and their documents, and the Activity Log keeps a record. It is switched off once any site of the order has a quote: from then on, stop the site in Feasibility or mark the bid lost instead, so the history is kept. Only the order's owner or a manager can edit or delete it.

### 4.2 Hand a site to another engineer
For example, when the owner is on leave. Operations or the Admin opens the site in **3 · Implementation** and uses **Hand over to…**. Only someone who can deliver can be chosen. The new owner sees the site in "Only mine", and the old owner can no longer act on it. A site that is already live cannot be handed over.

**Team & Roles → Field team workload** shows, for each engineer, open surveys, sites in delivery, blocked sites, SLA-overdue sites and delivered sites. Use it to balance work.

### 4.3 One PO for several sites
In **3 · Implementation**, click **One PO for several sites**:
1. Choose the client.
2. Tick the sites that are awaiting a PO.
3. Enter the PO number and date, and the value for each site.
4. Click **Record PO for N site(s)**.

All the sites must belong to the same client.

### 4.4 Find anything
Type in the **search box** at the top. It finds:
- a site name or the client's site ID (e.g. `S-014`);
- an order ref or order code (`ORD-…`);
- a client name or address;
- a PO number, quote code, site code, circuit ID, WAN IP, bill number or courier AWB.

### 4.5 See one link's complete history — Site 360
Open **Site 360** from any site: the search box, an order's site table, or the lifecycle links. It shows the whole chain on one screen:
- order → feasibility survey → quote → site;
- bills → payments → payouts;
- every document, and a timeline of who did what and when.

### 4.5a All live sites in one place — Live Sites
**Live Sites** (under Overview in the menu) lists every running link:
- site and client, the **ISP**, medium and bandwidth, circuit ID and IPs, live date;
- **contract end** (live date + contract months) and the days left; amber within 60 days, red once ended;
- for the office: the monthly price, the ISP's monthly cost and the margin, the next bill date and what is outstanding.

The tiles at the top add up the live links, the monthly billing, the monthly ISP cost and the contracts ending. Filter by client, ISP or medium, or type a site, circuit, IP or PO. Tabs: **Live**, **Contract ending (60 days)** and **Disconnected**. **Export to Excel (CSV)** downloads what is on screen.

Click a site to open it. Click the ISP name to open that ISP's view (4.5b). Field engineers see the same list without any amounts.

### 4.5b One ISP's sites and account — ISP view
In **ISPs & Vendors**, click an ISP (or click its name in Live Sites). It shows:
- **At a glance:** live links and bandwidth, sites in delivery, disconnected, surveys (how many feasible), the monthly cost of its live links, what was accrued and paid to it, and **what you owe it**;
- **Sites** with this ISP, by tab: Live, In delivery, Disconnected, All. Click one for its Site 360;
- **Surveys:** every site it was surveyed for, feasible or not, with its OTC / MRC;
- **Link faults** on its sites, and how fast it restores them;
- **Its bills to you:** **Record an ISP bill** (Billing / Finance) with the bill no., date, service period, amount before GST and GST (and the site, if the bill is for one site). Each bill is checked against what you **expected** it to bill for that period (the ISP cost on your own bills of its sites) and marked **Matches** or **Over / Under by ₹…**. A mismatch also shows on the dashboard. The due date follows the ISP's payment terms;
- **Payments** made to it, and its contact, address and bank details.

The **Live links** column in the ISP list shows how many running links each ISP has.

### 4.5c Renew a contract, or disconnect a live site
Open a live site (from Live Sites or Implementation). Under **Contract · renew or disconnect** (Operations / Admin):
- **Renew contract** — extend by a number of months, optionally with the client's renewal PO (it then shows on new bills). This clears the contract-end alert.
- **Disconnect site** — enter the disconnection date (today or earlier) and the reason, and confirm. Then:
  - the billing month (or quarter) running on that date is billed **in full** — there is no pro-rata;
  - if a whole period after the disconnection was already billed (billing in advance), a **credit note** is issued for it automatically (the link part, not one-time charges), and its ISP cost is taken off;
  - **billing and the ISP cost stop**; the site moves to **Disconnected** with the date, reason and who did it. Tell the ISP to switch off the link too.

**Reconnect a disconnected site** (Operations / Admin): open it (Live Sites → Disconnected) → **Reconnect site**. Enter the reconnection date and reason; optionally a one-time **reconnection charge** (to the client, and the ISP's to you), a **new contract** length from that date, and a new circuit ID. The site is live again and **billing restarts from the reconnection date** — the days it was off are not billed. If the link is reconnected inside a period that was already billed in full, billing restarts the day after that period, so no day is billed twice. The first bill after reconnecting carries the reconnection charge.

The dashboard warns **Contract ending within 60 days** and **Contract ended — renew or disconnect**.

### 4.5d Link down — log the fault with the ISP
When a live link goes down, the site owner (or Operations) opens the site → **Link faults** → **Log link down**: the time it went down, the ISP's **docket / complaint number** and the problem. The dashboard shows **Link down**, and Live Sites has a **Down now** tab. When it is back, fill **Restored at** and the **cause / fix** and click **Mark restored**.

Each site shows its downtime history and its **uptime over the last 30 days** (next to the SLA % from the quote, in red if below it). Each ISP's view shows its faults in the last 90 days and the **average time to restore**, so you can compare ISPs. If the client is owed something for an outage, issue a credit note on the bill (Step 4).

### 4.5e Upgrade / downgrade or change the price of a live link
Open the live site → **Bandwidth / price changes** → **Change bandwidth / price** (Commercial / Admin). Enter the new bandwidth, client MRC and ISP MRC (and static IP charges if any), the reason, and the client's PO for the change if there is one. The change applies **from the next bill not yet raised**; bills already raised keep the old price, also if they are cancelled and re-issued. Each bill prints the bandwidth of its own period. The history of changes stays on the site.

### 4.6 Documents
Most records have a **Documents** section. Upload the order screenshot, PO copy, AT sign-off, stamped bill and so on there. Files up to 10 MB are accepted.

### 4.7 Activity log
**Activity Log** lists every action with who did it and when. Each person sees only the activity of the areas they have access to.

### 4.8 Using it on a phone
Open the same address on a phone. The menu becomes a dropdown at the top. Field engineers can log orders, record surveys and mark sites live from the site.

---

## Part 5 — How the money works

| Item | Rule | Example |
| :--- | :--- | :--- |
| **Price** | What the ISP charges you per site: ISP OTC + ISP MRC | OTC ₹10,000, MRC ₹6,000 |
| **Finalized price** | What the client pays you: client OTC + client MRC | OTC ₹20,000, MRC ₹15,000 |
| **Static IP** (only sites that need it) | A separate monthly charge: the ISP's static IP charge (your cost) and the client's static IP charge (their price). It is added to the monthly amount everywhere below, and shown as its own line on each cycle bill. | ISP ₹500, client ₹1,200 a month |
| **Finalized quote value** | Client OTC + (client MRC + client static IP) × contract months | ₹20,000 + ₹15,000 × 12 = ₹2,00,000 |
| **Budget split** | A % vendor + B % your company's own share + C % site implementation = 100 % of the quote value | 55 / 25 / 20 → ₹1,10,000 / ₹50,000 / ₹40,000 |
| **GST** | 18 %: CGST 9 % + SGST 9 % if the client is in the same state, otherwise IGST 18 % | First bill: OTC ₹20,000 + MRC ₹15,000 = ₹35,000 → ₹41,300 with GST |
| **Bills** | One first bill on the live date (OTC + 1st cycle), then one bill per cycle (monthly or quarterly per client), billed in advance | — |
| **Due date** | Submission date + client credit days. A bill must be submitted before a payment can be recorded. | Submitted 1 Dec, 45 days → due 15 Jan |
| **Vendor owed for a site** | Vendor OTC (once live) + (vendor MRC + vendor static IP) for each billed cycle − what you already paid them | — |
| **Payment split (waterfall)** | ① vendor owed for that site → ② this month's loan EMI still uncovered → ③ salary reserve up to *reserve months* × monthly salary → ④ surplus | Client pays ₹23,600; ₹18,000 is owed to the ISP → ₹18,000 to vendor, ₹5,600 to loan |

Field engineers never see any of these amounts.

---

## Part 6 — Rules the software enforces ("why is this button missing?")

| You see / try | Why | What to do |
| :--- | :--- | :--- |
| A field engineer cannot open or edit a colleague's site | Engineers act only on sites they own | Ask Operations to hand it over (4.2) |
| A field engineer does not see **Finalize price**, **Stop**, quotes or bills | Pricing and money are for the office | Commercial / Admin does it |
| A field engineer does not see **Record PO** | The PO reaches the office | Operations / Admin records it |
| **Start ISP work** is missing | No PO has been recorded yet | Record the PO first |
| **Mark site live** is refused | A "Pending with" item is still open, or work has not started | Resolve the item first |
| A not-feasible ISP cannot be chosen | Only feasible ISPs can be priced | Mark another ISP feasible |
| **Bid win** is refused | The quote has not been marked as sent, or A + B + C ≠ 100 | Mark as sent; fix the split |
| A payment cannot be recorded | The bill has not been submitted, the UTR is already used, or the amount is more than due | Record the submission; check the UTR |
| A paid bill cannot be cancelled | Only unpaid bills can be cancelled & re-issued | — |
| A payout is refused | More than the pool holds, or more than owed to the vendor | Check the pool on **5 · Payments** |
| You are sent back to sign-in with "suspended" | The Platform Admin suspended the company | Platform Admin clicks **Activate** |
| **Renew** / **Disconnect** is missing on a site | Only a live site can be renewed or disconnected, by Operations / Admin | Ask Operations |
| **Change bandwidth / price** is missing | Price changes are for Commercial / Admin, on a live site | Ask Commercial |
| A price change "from cycle 2" is refused | That cycle is already billed | Use the next cycle, or cancel & re-issue the bill first |
| **Cancel & re-issue** is missing on a bill | The bill has a payment or a credit note | Issue a credit note instead |
| **Log link down** is refused | The site already has an open fault | Mark the open one restored first |
| A date "in the future" is refused | Dates are checked against India time | Use today or an earlier date |

---

## Part 7 — What is not built yet

- Orders arriving directly from WhatsApp or email. For now, they are entered in the order form.
- Email / SMS alerts. For now, alerts are on the dashboard and in My work.
- A client portal login.
- Uploading many sites from an Excel / CSV file. For now, each site is a row in the order form.
- One combined bill per PO or per month. For now, bills are per site.
- One combined proposal for a whole order. For now, quotes are per site.
- A credit balance per client: an excess received after a credit note is shown on the bill, but refunding it or carrying it to the next bill is done by hand.
- Automatic SLA credits from downtime. Uptime is shown against the SLA; the credit note is issued by hand.
- **Nearby-ISP check for a new site:** list the ISPs whose address is close to a new feasibility site, so the field engineer knows whom to contact. ISP addresses can already be recorded.
- Production hosting: HTTPS, backups and file storage.

Decisions and open items are tracked in [Tracking/06_KNOWN_GAPS_AND_DECISIONS.md](Tracking/06_KNOWN_GAPS_AND_DECISIONS.md).

---

## For developers and testers

- **Automated end-to-end test:** `cd Web/backend && npm test`. It runs the whole flow above in 26 steps on the separate `isp_flow_test` database, which it wipes on every run.
- **Test script** (about 50 minutes, tick-box): [Tracking/04_UAT_TEST_SCRIPT.md](Tracking/04_UAT_TEST_SCRIPT.md).
- **Requirements, progress, results and screenshots:** [Tracking/](Tracking/README.md).
