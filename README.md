# Employee Shift Management Portal

React frontend prototype for an employee shift management portal.

---

## Project status — prototype (UI only)

**This application is a layout and UX prototype.** It is **not** connected to any backend, database, or external services. All data is in-memory and mock; nothing is persisted.

- **Purpose:** Validate flows, navigation, and layout with stakeholders.
- **Next step:** Once the UI and flows are approved, backend and database design will be implemented to support authentication, persistence, and business logic.

---

## Features

- **Top bar:** Week (1–53), Client dropdown, Employee name search
- **Main table:** Employee Name, Shift Time, Status, Login/Logout Time
- **Status colors:** Green = current shift & logged in; Red = current shift & not logged in; Grey = not current shift
- **Employee modal:** Click any name → Leaves remaining, leaves in last 4 weeks, planned leaves, assigned client, and **Request Leave** (date picker + reason; submit logs to console)
- **Tabs:** All Clients | Client-wise | Upload Schedules (team leads upload for their clients)
- **Layout:** Left panel (nav + logos), right panel (content), dark theme inspired by [Pulse AMGSOL](https://pulse.amgsol.com/)

## Client & team structure (from org chart)

- **Ameresco** — Team lead: Sanjay Gunde (employees under Sanjay)
- **Cleanleaf** — Team lead: Arun Pandian (employees under Arun)
- **Standard Solar** — Team lead: Srinivasa Krishnan
- **Puresky** — Team lead: Srinivasa Krishnan (separate employees)

Logos: `public/leftpanel.png`, `public/rightpanel.png` (from your code folder).

After signing in, go to **My shift** to **Login to shift (Clock in)**. Your row in the shift table will show as **Logged in** (green) with your clock-in time.

### Leave requests and approvals

- **Employee** requests leave (My shift → Request leave, or from a profile modal). The request is sent to their **team lead** and **manager** as notifications.
- **Team lead** and **manager** see pending requests in the **Notifications** bell (header) and in the **Leaves** tab. Either can **Approve** or **Reject**.
- **Leaves** tab shows: **My leave requests** (status), **Pending** (for lead/manager, with Approve/Reject), and **Leaves approved** (visible to employee, team lead, and manager — who approved and when).

## Run

```bash
npm install
npm run dev
```

Then open the URL shown (e.g. http://localhost:5173).

## Build

```bash
npm run build
npm run preview
```
