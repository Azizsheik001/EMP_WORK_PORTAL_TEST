# New features (schedule view, departments, add member/client)

## 1. Run migration 002 (required for departments and assignments)

In **Supabase SQL Editor**, run the contents of:

**`docs/migrations/002_departments_and_assignments.sql`**

This adds:

- **departments** table (e.g. Solar, Finance, Development)
- **clients.department_id** (optional)
- **user_client_assignments** (many-to-many: assign employees to clients)
- **shift_assignments.is_off** and nullable times for "OFF" days

After this, you can create departments, link clients to departments, and assign users to clients.

---

## 2. Date filters and View schedule

- **View schedule** tab: pick a **date range** (From / To) and optionally a **client**. The grid shows employees × dates with shift times or OFF (like your Excel layout).
- **Upload Schedules** already uses week range; date filters are used in the schedule grid view.

---

## 3. Role badges (M, TL, CEO)

- **M** next to Manager names  
- **TL** next to Team Lead names  
- **CEO** next to Shree and Siva (admin role + name match)

Shown in:

- **User management** list
- **Schedule grid** (View schedule) employee column

---

## 4. Add team member

- **User management** (right panel) → **Add member** (admin/manager only).
- Form: Name, Email, Password, Role (Employee / Team Lead / Manager / Admin), Client, Team Lead, Manager.
- Saves to DB via `POST /api/users`.

---

## 5. Add client (API only)

- Backend: **POST /api/clients** with `name`, optional `department_id`, optional `team_lead_id`.
- **PATCH /api/clients/:id** to update.
- Frontend: no "Add client" modal yet; can be added in the same way as Add Member, with a dropdown for department and team lead.

---

## 6. Departments

- Backend: **GET /api/departments**, **POST /api/departments** (admin).
- Default seed: Solar, Finance, Development.
- **Filter by department**: e.g. "Solar department – all these clients and records visible" can be done by filtering clients by `department_id` in the UI (dropdown or sidebar). Frontend can add a department filter that limits clients to the selected department.

---

## 7. Assign employees to client (pool + drag)

- Backend: **GET /api/assignments/by-client/:clientId** (list assigned users), **POST /api/assignments** (assign), **DELETE /api/assignments/:userId/:clientId** (unassign).
- **Drag-from-pool UI**: not yet built. Planned: "Add client" or "Edit client" screen with a pool of all candidates and a list of assigned employees; drag from pool to assign, drag out to unassign. For now you can use the API directly or add a simple dropdown "Assign user to client".

---

## 8. In-app schedule builder (TL/manager)

- Backend: **GET /api/shifts/grid?from=&to=&client_id=** (read grid), **POST /api/shifts/bulk** (save grid).
- **Build schedule** in the app: pick client + date range, then fill a grid (employee × date) with shift times or OFF and save. Not yet in the UI; the API is ready. Next step: add a "Build schedule" tab or section with:
  - Client + From/To dates
  - Editable grid (input or dropdown per cell: shift slot or OFF)
  - Save button → `POST /api/shifts/bulk`

---

## Summary

| Feature              | Backend | Frontend |
|----------------------|--------|----------|
| Date filters         | ✅     | ✅ View schedule |
| Schedule grid view   | ✅     | ✅       |
| Role badges M/TL/CEO | -      | ✅       |
| Add team member      | ✅     | ✅       |
| Add client           | ✅     | Optional modal   |
| Departments          | ✅     | Filter (optional)|
| Assign to client     | ✅     | Drag UI (optional)|
| In-app build schedule| ✅     | Grid editor (optional)|

Run **migration 002** to enable departments and assignments.
