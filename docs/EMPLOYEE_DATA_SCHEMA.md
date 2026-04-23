# Employee data schema (for JSON / new docs)

Use this format when you have a **new doc** with extra columns (DOB, phone, designation, client, etc.). The seed script and API support these fields when the DB has the columns (run migration 006 for DOB, phone, designation).

---

## Supported columns

| Column          | Type   | Required | Notes |
|-----------------|--------|----------|--------|
| `sno`           | string | No       | Serial number (display only). |
| `employee_no`   | string | **Yes**  | Business key, e.g. LI1135, OB01. Used to match rows on re-seed (upsert by employee_no). |
| `email`         | string | No       | Login email. If provided, this is used; otherwise `{employee_no}@amgsol.com`. Re-running the seed with updated emails will update the DB. |
| `name`          | string | **Yes**  | Full name. |
| `join_date`     | string | No       | e.g. "06 Jul 2022" (stored for reference; not yet in DB). |
| `date_of_birth` | string | No       | ISO date YYYY-MM-DD, or parseable date. **Add this column** for DOB to show in the app; requires migration 006. |
| `phone`         | string | No       | Phone number. **Add this column** for phone to show; requires migration 006. |
| `designation`   | string | No       | Job title. **Add this column** for designation to show; requires migration 006. |
| `client`        | string | No       | Client name (e.g. Ameresco, Cleanleaf). Resolved to client_id; run seed:clients first. |
| `department`    | string | No       | Department name (for reference; client has department_id). |

---

## Example row (minimal)

```json
{ "employee_no": "LI1135", "name": "Kasturi Shiva Kumar Goud", "join_date": "06 Jul 2022" }
```

## Example row (with email, DOB and other columns)

Add `email`, `date_of_birth`, `phone`, and `designation` to your JSON so they are stored and shown in the app. Re-run `npm run seed:employees` after updating the file.

```json
{
  "sno": "1",
  "employee_no": "LI1135",
  "email": "kasturi.shiva@amgsol.com",
  "name": "Kasturi Shiva Kumar Goud",
  "join_date": "06 Jul 2022",
  "date_of_birth": "1990-05-15",
  "phone": "+91 9876543210",
  "designation": "Senior Associate",
  "client": "Ameresco"
}
```

---

## Order of operations

1. **Run migration 006** (adds `date_of_birth`, `phone`, `designation` to users):  
   In Supabase SQL Editor run `docs/migrations/006_users_extra_columns.sql`.

2. **Seed clients** so `client` name resolves:  
   `cd backend && npm run seed:clients`  
   (reads `docs/clients-to-seed.json`).

3. **Put your data** in `docs/employee-data.json` (or a new file and point the seed script at it). Use the columns above; extra columns are ignored.

4. **Seed employees**:  
   `cd backend && npm run seed:employees`  
   - Rows are matched by **employee_no** (upsert): re-running with an updated file updates names, **email**, client, DOB, phone, and designation.  
   - If your file includes `email`, that value is used; otherwise login email is `{employee_no}@amgsol.com`.  
   - DOB, phone, and designation only get values if you add those columns to `docs/employee-data.json` and run the seed again (or set them in **Manage Users → Edit**).

---

## Clients list (seed:clients)

Defined in **`docs/clients-to-seed.json`**. Current entries:

- Ameresco (Solar)
- Demo Client
- Cleanleaf (Solar)
- Standard Solar (Solar)
- Puresky (Solar)

Add new clients there, then run `npm run seed:clients`. New names in employee data will then resolve when you run seed:employees.
