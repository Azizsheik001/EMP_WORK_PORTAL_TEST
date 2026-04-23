# Data & seeds — organized reference

Use this when you add a **new doc** with extra columns (DOB, phone, designation, client) or when you need to seed clients and employees in order.

---

## 1. Migrations (run in Supabase SQL Editor)

| Migration | Purpose |
|-----------|---------|
| `migrations/002_departments_and_assignments.sql` | Departments, user_client_assignments, shift `is_off`. |
| `migrations/003_employee_no.sql` | `users.employee_no` (e.g. LI1135). |
| `migrations/004_shift_assignments_date_based.sql` | Date-based shifts so Build schedule save works. |
| `migrations/005_leave_requests_date_range.sql` | Leave request creation (start_date, end_date, etc.). |
| **`migrations/006_users_extra_columns.sql`** | **DOB, phone, designation** on users (for new docs). |

---

## 2. Clients

- **Source:** `docs/clients-to-seed.json`  
  Current list: Ameresco, Demo Client, Cleanleaf, Standard Solar, Puresky (with optional department).
- **Add new clients:** Edit `clients-to-seed.json` (add `{ "name": "New Client", "department": "Solar" }`), then run the seed.
- **Seed command:** From `backend`:  
  `npm run seed:clients`  
  Creates each client by name if it doesn’t exist; links to department when migration 002 is run.

---

## 3. Employee data (new doc with DOB, etc.)

- **Schema:** See **`EMPLOYEE_DATA_SCHEMA.md`** for supported columns:  
  `employee_no`, `name`, `join_date`, `date_of_birth`, `phone`, `designation`, `client`, `department`.
- **Data file:** Put rows in `docs/employee-data.json` (or point the seed script at your file).  
  You can use only the columns you have; extra columns in the doc are ignored if not in the schema.
- **Order:**  
  1. Run **migration 006** (DOB, phone, designation).  
  2. Run **seed:clients** so `client` names resolve.  
  3. Run **seed:employees** so employees (and optional DOB/phone/designation/client) are created/updated.

**Seed command:** From `backend`:  
`npm run seed:employees`

---

## 4. Quick checklist

- [ ] Run migrations 002, 003, 004, 005 (and **006** if you have DOB/phone/designation).
- [ ] Run `npm run seed:clients` (creates clients from `clients-to-seed.json`).
- [ ] Run `npm run seed` (admin + Demo Client if needed).
- [ ] Run `npm run seed:employees` (employees from `employee-data.json`; uses client, DOB, etc. when present).

All paths above are relative to the repo root or `backend` as noted.
