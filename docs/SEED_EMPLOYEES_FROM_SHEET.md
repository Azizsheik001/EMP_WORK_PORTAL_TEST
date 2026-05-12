# Seed employees from your Excel sheet into the DB

This adds all 59 employees from **docs/employee-data.json** (from your `Employee data (2).xlsx` sheet) into the database as **employees** assigned to **Ameresco**. You can later change roles (team lead, manager) and clients from the frontend (Manage Users → Edit).

---

## 1. Run migration 003 (adds sheet ID column)

In **Supabase SQL Editor**, run:

**`docs/migrations/003_employee_no.sql`**

This adds `employee_no` (e.g. LI1135, OB01) to the `users` table so the sheet IDs are stored as the business key.

---

## 2. Ensure Ameresco exists

- Either create **Ameresco** from the app: Right panel → **Add client** → name "Ameresco".
- Or the seed script will create it if missing.

---

## 3. Run the seed script

From the **backend** folder:

```bash
cd backend
npm run seed:employees
```

This will:

- Create **Ameresco** client if it doesn’t exist
- Insert/update all 59 users with:
  - **employee_no** = from sheet (LI1135, OB01, etc.)
  - **name** = from sheet
  - **email** = `{employee_no}@amgsol.com` (e.g. li1135@amgsol.com)
  - **password** = `emp123` (default)
  - **role** = `employee`
  - **client_id** = Ameresco
- Assign each user to Ameresco in `user_client_assignments` (so they show in Build schedule for Ameresco)

---

## 4. After seeding

- **Manage Users** will list everyone; each row shows name, role, client, and **employee_no** (e.g. LI1135) if migration 003 was run.
- **Build schedule** → select **Ameresco** → you’ll see all 59 employees; you can assign shifts or leave OFF.
- To change someone to team lead/manager or another client: **Manage Users** → **Edit** → change Role and/or Client → **Save**.

---

## Logins

Any seeded employee can log in with:

- **Email:** `{employee_no}@amgsol.com` (e.g. `li1135@amgsol.com`, `ob01@amgsol.com`)
- **Password:** `emp123`

Admin (from `npm run seed`) remains **admin@amgsol.com** / **admin123**.
