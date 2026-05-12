# Insert records into the DB from the frontend

Everything below saves to your database through the API. No SQL needed.

**If saving a schedule fails or does not persist:**  
1. Run **002**: `docs/migrations/002_departments_and_assignments.sql` (adds `is_off`).  
2. If the table was created from the initial schema (week-based), also run **004**: `docs/migrations/004_shift_assignments_date_based.sql` (adds `shift_date`, `shift_start_time`, `shift_end_time`, and the unique constraint so bulk save works).  
In Supabase: **SQL Editor** → paste/run each script → try **Save schedule** again.

**New doc with DOB / phone / designation / client?** See **`docs/EMPLOYEE_DATA_SCHEMA.md`** for the column format and **`docs/DATA_AND_SEEDS_README.md`** for migration 006, clients seed, and employee seed order.

---

## When will the DB show employee details and clients on the frontend?

The DB is **not** updated by the JSON file until you run the seed. To see **email**, **DOB**, **phone**, **designation**, and **client** for each employee on the frontend:

1. **Run migrations in Supabase** (if not already done):  
   - **003** (`docs/migrations/003_employee_no.sql`) — adds `employee_no` (used by seed to upsert).  
   - **006** (`docs/migrations/006_users_extra_columns.sql`) — adds `date_of_birth`, `phone`, `designation`.

2. **Seed clients** so client names resolve:  
   `cd backend && npm run seed:clients`

3. **Seed employees** so the DB gets data from `docs/employee-data.json`:  
   `cd backend && npm run seed:employees`

After that, open the app → **Manage Users**. Each row will show **email**, **client name**, and when present **DOB**, **phone**, **designation**, **TL**, **Mgr**. Employees are **segregated by client**: each row in `employee-data.json` has a **`client`** field (e.g. Ameresco, Cleanleaf, Standard Solar, Puresky). The seed assigns each user to that client; you can change `client` in the file and re-run `npm run seed:employees` to update assignments, or change **Client** in **Manage Users → Edit** for a user.

---

## 1. Open the app

- **Frontend:** http://localhost:5173 (or the port shown when you run `npm run dev:all`)
- **Backend:** http://localhost:3000

**Login credentials (after running `cd backend && npm run seed` and optionally `npm run seed:employees`):**

| Role      | Email               | Password |
|-----------|---------------------|----------|
| **Admin** | admin@amgsol.com | admin123 |
| **Team lead** | li1257@amgsol.com | emp123   |
| **Employee** | li1243@amgsol.com | emp123   |

- **Admin** — Created by `npm run seed`. Use as above.
- **Team lead** — No separate seed. After `npm run seed:employees`, log in as **admin** → **Manage Users** → **Edit** on **Arun Pandian S** → set **Role** to **Team Lead** → **Save**. Then log in with **li1257@amgsol.com** / **emp123** as team lead.
- **Employee** — Any seeded user: email = `{employee_no}@amgsol.com` (lowercase), password **emp123**. Examples:

| Name              | Email              | Password |
|-------------------|--------------------|----------|
| Arun Pandian S    | li1257@amgsol.com  | emp123   |
| Siriki Dileep Kumar | li1048@amgsol.com | emp123   |
| Anjana Sisti     | li1243@amgsol.com  | emp123   |

**Leave hierarchy (to test from Anjana’s account):** Log in as **Anjana** (li1243@amgsol.com / emp123) → **Leaves** or **My shift** → Request leave. The request goes: Employee → **Team Lead** → **Manager** → **Admin** → Approved. **Important:** Arun (or any team lead) will only see Anjana’s request in **Leaves** and **Notifications** if Anjana has that user set as her **Team lead**. In **Manage Users**, click **Edit** on Anjana → set **Team lead** to **Arun Pandian S** → Save. Then when Anjana submits leave, Arun will see it under Pending and in the notification bell. If **submitting leave** fails or **Leaves/Notifications stay empty** for the team lead: run **005**: `docs/migrations/005_leave_requests_date_range.sql` in Supabase SQL Editor (adds start_date/end_date/total_days/leave_type so leave creation works).

---

## 2. Insert clients

1. Click your **profile/avatar** (top right) to open the **right panel**.
2. Click **Add client**.
3. Fill in:
   - **Client name** (e.g. *Ameresco*, *Cleanleaf*)
   - **Department** (optional)
   - **Team lead** (optional — pick a user)
4. Click **Add client**.

Repeat to add more clients. They appear in all client dropdowns (All Clients, View schedule, Build schedule, Upload Schedules).

---

## 3. Insert employees (users)

1. Open the **right panel** → **Manage Users**.
2. Click **Add member**.
3. Fill in:
   - **Name**
   - **Email** (must be unique)
   - **Password** (min 6 characters)
   - **Role** (Employee, Team Lead, Manager, Admin)
   - **Client** (assign to a client so they show in Build schedule for that client)
   - **Team Lead** / **Manager** (optional)
4. Click **Add member**.

New users are stored in the DB and show in the user list and in Build schedule when you select their client.

---

## 4. Edit or delete employees

1. **Right panel** → **Manage Users**.
2. Each row shows **name**, **role**, **client**.
3. **Edit** — Change name, role, client, team lead, manager, or set a new password. Saving updates the DB and adds them to the selected client’s assignments if needed.
4. **Delete** — Click once for “Confirm delete?”, then again to soft-delete (sets `deleted_at`). You cannot delete yourself.

---

## 5. Insert schedule (shift assignments)

1. Go to the **Build schedule** tab.
2. Choose **From** and **To** dates.
3. Select a **client** (e.g. Demo Client, Ameresco).
4. You should see the **employee list** for that client. If it’s empty, add members and assign them to that client (step 3), or edit their client (step 4).
5. For each cell, pick a shift (e.g. *6:00 AM - 2:00 PM*) or **OFF**.
6. Click **Save schedule**.

Shifts are saved to the DB and show in **View schedule** and **All Clients** / **Client-wise** (with date filters).

---

## 6. Save and reuse schedules (templates)

- **Timezone:** In Build schedule, choose **Schedule timezone** (IST or EST). Shift labels (e.g. 9:00 AM – 6:00 PM) are shown in that zone; times are stored without timezone in the DB.
- **9-hour shifts:** Use options like *9:00 AM - 6:00 PM (9h)* or *8:00 AM - 5:00 PM (9h)* from each cell dropdown.
- **Save as template:** After filling the grid, enter a **Template name** and click **Save as template**. The pattern is stored in your browser so you can **Apply template** later (same or different week).
- **Reuse after months:** Templates stay in the browser until you clear site data. To keep a backup or use on another device: click **Export templates** to download a JSON file; later use **Import templates** and select that file to restore them. Then use **Apply template** to fill the grid and **Save schedule** to write to the DB.

---

## 7. Optional: seed from terminal first

To get one client and one admin user in the DB before using the frontend:

```bash
cd backend
npm run seed
```

Then log in with **admin@amgsol.com** / **admin123** and use the steps above to add more clients and employees from the UI.
