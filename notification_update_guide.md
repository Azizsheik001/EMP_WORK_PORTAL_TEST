# Shift Change Notification Update Guide

This guide outlines the exact code changes required to implement the "Awaiting Acknowledgement" notification flow for Shift Change Requests in the Admin panel.

## 1. Backend: Add the Acknowledge Route
**File:** `backend/src/routes/shift-changes.js`
**Action:** Add this new route at the bottom of the file, just above `export default router;`.

```javascript
// PATCH /api/shift-changes/:id/acknowledge
router.patch('/:id/acknowledge', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    await migrate();
    const id = req.params.id;
    const userId = req.user.sub;
    
    // Add user_id to the seen_by JSONB array if it doesn't already exist
    await query(
      `UPDATE shift_change_requests 
       SET seen_by = COALESCE(seen_by, '[]'::jsonb) || jsonb_build_array($1::text),
           updated_at = now()
       WHERE id = $2 AND NOT (COALESCE(seen_by, '[]'::jsonb) @> jsonb_build_array($1::text))`,
      [userId, id]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
```

---

## 2. Frontend API Client: Add Acknowledge Method
**File:** `src/api/client.js`
**Action:** Find the `shiftChanges` object (around line 469) and add the `acknowledge` method to it.

```javascript
  shiftChanges: {
    list: () => api.get('/api/shift-changes'),
    create: (body) => api.post('/api/shift-changes', body),
    approve: (id) => api.patch(`/api/shift-changes/${id}/approve`, {}),
    reject: (id) => api.patch(`/api/shift-changes/${id}/reject`, {}),
    
    // --> ADD THIS LINE:
    acknowledge: (id) => api.patch(`/api/shift-changes/${id}/acknowledge`, {}),
  },
```

---

## 3. Frontend App: Add State and Handlers
**File:** `src/App.jsx`
**Action A (Update Badge Count):** Find the `pendingLeaveCount` calculation (around line 822) and update the return block to include unacknowledged shift changes:

```javascript
    // --> ADD THESE LINES before the return statement:
    const unacknowledgedShiftCount = type === 'admin'
      ? shiftChangeRequests.filter((r) => r.status === 'approved' && !(r.seen_by || []).includes(userId)).length
      : 0;
      
    // --> UPDATE the return statement:
    return leaveCount + unacknowledgedCount + shiftChangeCount + unacknowledgedShiftCount + adminAlerts.length + autoLogoutNotices.length;
```

**Action B (Add Handler):** Find where the other handle functions are defined (like `handleRejectShiftChange`) and add this new function:

```javascript
  const handleAcknowledgeShiftChange = useCallback(async (requestId) => {
    if (hasApi()) {
      try {
        await api.shiftChanges.acknowledge(requestId);
        fetchShiftChangeRequests();
        showToast('Shift change acknowledged');
      } catch (e) {
        showToast(typeof e.data?.error === 'string' ? e.data.error : (e.message || 'Failed to acknowledge'), 'error');
      }
    }
  }, [fetchShiftChangeRequests, showToast]);
```

**Action C (Pass Prop):** Down in the `return` statement where `<NotificationsPanel>` is rendered, pass the new prop:

```jsx
      <NotificationsPanel
        // ... existing props ...
        onApproveShiftChange={handleApproveShiftChange}
        onRejectShiftChange={handleRejectShiftChange}
        // --> ADD THIS LINE:
        onAcknowledgeShiftChange={handleAcknowledgeShiftChange}
```

---

## 4. Frontend UI: Render the Notification
**File:** `src/components/NotificationsPanel.jsx`
**Action A (Add Props & Filter):** Update the component props and add the filter logic at the top of the component (around line 190):

```javascript
export default function NotificationsPanel({
  // ... existing props ...
  onRejectShiftChange,
  onAcknowledgeShiftChange, // --> ADD THIS PROP
  shiftChangeRequests = [],
  // ...
}) {
  // ... existing logic ...
  
  // --> ADD THIS FILTER LOGIC:
  const unacknowledgedShiftChanges = currentUser?.type === 'admin'
    ? shiftChangeRequests.filter((r) => r.status === 'approved' && !(r.seen_by || []).includes(currentUser?.id))
    : [];
```

**Action B (Update Empty State Logic):** Ensure the empty state check includes the new array (around line 260):

```jsx
// --> ADD unacknowledgedShiftChanges.length === 0 to the check:
{pending.length === 0 && unacknowledged.length === 0 && pendingShiftChanges.length === 0 && unacknowledgedShiftChanges.length === 0 && adminAlerts.length === 0 && recentRejectedLeaves.length === 0 && autoLogoutNotices.length === 0 ? (
  <p className="text-sm text-gray-500 dark:text-gray-400">No pending notifications.</p>
) : (
```

**Action C (Render the Blocks):** Inside the `<div className="space-y-4">` (around line 555), add the UI block to render these specific notifications:

```jsx
              {/* --> ADD THIS ENTIRE BLOCK <-- */}
              {unacknowledgedShiftChanges.length > 0 && (
                <>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Approved shift changes - awaiting acknowledgement ({unacknowledgedShiftChanges.length})
                  </p>
                  {unacknowledgedShiftChanges.map((req) => {
                    const fmtTime = (t) => t ? t.split(':').slice(0, 2).join(':') : '—';
                    return (
                      <div
                        key={req.id}
                        className={`rounded-lg border-2 p-3 ${
                          isDark ? 'border-green-800/50 bg-green-900/20' : 'border-green-200 bg-green-50'
                        }`}
                      >
                        <p className="font-medium text-gray-900 dark:text-white">{req.user_name || 'Employee'}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                          Date: {req.request_date ? String(req.request_date).slice(0, 10) : '—'}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-500 mt-0.5">
                          {fmtTime(req.original_start_time)}-{fmtTime(req.original_end_time)} → <span className="font-medium text-blue-600 dark:text-blue-400">{fmtTime(req.requested_start_time)}-{fmtTime(req.requested_end_time)}</span>
                        </p>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 mt-1.5">
                          Approved
                        </span>
                        <div className="flex gap-2 mt-3">
                          <button
                            type="button"
                            onClick={() => onAcknowledgeShiftChange?.(req.id)}
                            className="px-3 py-1.5 rounded-lg text-white text-sm font-medium bg-brand hover:bg-brand-hover"
                          >
                            OK
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
```
