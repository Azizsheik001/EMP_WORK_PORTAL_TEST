import { useState, useEffect, useMemo, useCallback } from 'react';

/*
 * CabDropsView — Night-shift cab drop management.
 *
 * Workflow:
 *   1. Every day, two cabs depart from the office at 03:30 AM and 04:30 AM IST.
 *   2. A supervisor assigns a vehicle (number + capacity, default 7) to each slot.
 *   3. Employees check in when they sit in the cab.
 *   4. Once full OR supervisor marks "Depart", the cab leaves. Route (drop-off stops)
 *      is recorded and total km is computed (Google Distance Matrix / OR-tools placeholder).
 *   5. Cost = km * per_km_rate. Saved in the daily record, same pattern as Food Coupons.
 *
 * NOTE: This is a frontend-only skeleton. State persists to localStorage so you can
 * demo the workflow end-to-end without a backend. Swap out the `loadRecord` /
 * `saveRecord` helpers for real API calls once the backend is ready.
 */

const DEFAULT_CAPACITY = 7;
const DEFAULT_PER_KM_RATE = 25; // ₹/km — placeholder, make editable later
const DEFAULT_BASE_FARE = 100;  // ₹ flat — placeholder

const SLOTS = [
  { id: 'cab_a', label: 'Cab A', departure: '03:30 AM IST' },
  { id: 'cab_b', label: 'Cab B', departure: '04:30 AM IST' },
];

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function storageKey(dateStr) {
  return `ags_cab_drops_${dateStr}`;
}

function loadRecord(dateStr) {
  try {
    const raw = localStorage.getItem(storageKey(dateStr));
    if (raw) return JSON.parse(raw);
  } catch {}
  // Default empty record
  return {
    date: dateStr,
    cabs: SLOTS.reduce((acc, slot) => {
      acc[slot.id] = {
        vehicle_number: '',
        capacity: DEFAULT_CAPACITY,
        per_km_rate: DEFAULT_PER_KM_RATE,
        base_fare: DEFAULT_BASE_FARE,
        riders: [],        // [{ name, boarding_at }]
        route: [],         // [{ label, lat, lng }]
        status: 'pending', // pending | in_transit | completed
        started_at: null,
        distance_km: null, // computed when route set
        total_cost: null,  // computed when distance set
      };
      return acc;
    }, {}),
  };
}

function saveRecord(dateStr, record) {
  try {
    localStorage.setItem(storageKey(dateStr), JSON.stringify(record));
  } catch {}
}

// ── Haversine fallback for km computation (OR-tools/Google Distance Matrix placeholder) ──
function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function computeRouteKm(route) {
  if (!route || route.length < 2) return 0;
  let km = 0;
  for (let i = 1; i < route.length; i++) {
    km += haversineKm(route[i - 1], route[i]);
  }
  // 1.25x road-factor — rough approximation until Google Distance Matrix is wired in
  return Math.round(km * 1.25 * 100) / 100;
}

export default function CabDropsView({ isDark, currentUser }) {
  const [date, setDate] = useState(todayIST());
  const [record, setRecord] = useState(() => loadRecord(todayIST()));
  const [editingSlot, setEditingSlot] = useState(null);
  const [vehicleDraft, setVehicleDraft] = useState({ vehicle_number: '', capacity: DEFAULT_CAPACITY, per_km_rate: DEFAULT_PER_KM_RATE, base_fare: DEFAULT_BASE_FARE });
  const [stopDraft, setStopDraft] = useState({ slotId: null, label: '', lat: '', lng: '' });

  // Role
  const isSupervisor = ['admin', 'manager', 'team_lead'].includes(currentUser?.type);

  // Refresh record when date changes
  useEffect(() => { setRecord(loadRecord(date)); }, [date]);

  // Persist
  useEffect(() => { saveRecord(date, record); }, [date, record]);

  const card = isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200';
  const subtleText = isDark ? 'text-gray-400' : 'text-gray-500';
  const borderColor = isDark ? 'border-slate-700' : 'border-gray-200';
  const inputCls = `w-full rounded-lg px-3 py-2 border text-sm ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`;

  // ── Mutators ──────────────────────────────────────────────────────
  const updateCab = useCallback((slotId, patch) => {
    setRecord((prev) => ({
      ...prev,
      cabs: { ...prev.cabs, [slotId]: { ...prev.cabs[slotId], ...patch } },
    }));
  }, []);

  const handleStartEditVehicle = (slotId) => {
    const cab = record.cabs[slotId];
    setVehicleDraft({
      vehicle_number: cab.vehicle_number || '',
      capacity: cab.capacity || DEFAULT_CAPACITY,
      per_km_rate: cab.per_km_rate || DEFAULT_PER_KM_RATE,
      base_fare: cab.base_fare || DEFAULT_BASE_FARE,
    });
    setEditingSlot(slotId);
  };

  const handleSaveVehicle = () => {
    if (!editingSlot) return;
    updateCab(editingSlot, {
      vehicle_number: vehicleDraft.vehicle_number.trim(),
      capacity: Math.max(1, Number(vehicleDraft.capacity) || DEFAULT_CAPACITY),
      per_km_rate: Math.max(0, Number(vehicleDraft.per_km_rate) || 0),
      base_fare: Math.max(0, Number(vehicleDraft.base_fare) || 0),
    });
    setEditingSlot(null);
  };

  const handleCheckIn = (slotId) => {
    const cab = record.cabs[slotId];
    const name = currentUser?.name || 'Employee';
    if (cab.riders.some((r) => r.user_id === currentUser?.id)) return; // already in
    if (cab.riders.length >= cab.capacity) return; // full
    const newRiders = [...cab.riders, { user_id: currentUser?.id, name, boarding_at: new Date().toISOString() }];
    // Auto-depart when full
    const nowFull = newRiders.length >= cab.capacity;
    updateCab(slotId, {
      riders: newRiders,
      status: nowFull && cab.status === 'pending' ? 'in_transit' : cab.status,
      started_at: nowFull && !cab.started_at ? new Date().toISOString() : cab.started_at,
    });
  };

  const handleCheckOut = (slotId, userId) => {
    const cab = record.cabs[slotId];
    if (cab.status !== 'pending') return;
    updateCab(slotId, { riders: cab.riders.filter((r) => r.user_id !== userId) });
  };

  const handleDepart = (slotId) => {
    const cab = record.cabs[slotId];
    if (cab.status !== 'pending') return;
    updateCab(slotId, { status: 'in_transit', started_at: new Date().toISOString() });
  };

  const handleAddStop = (slotId) => {
    if (!stopDraft.label.trim()) return;
    const lat = parseFloat(stopDraft.lat);
    const lng = parseFloat(stopDraft.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    const cab = record.cabs[slotId];
    const newRoute = [...cab.route, { label: stopDraft.label.trim(), lat, lng }];
    const km = computeRouteKm(newRoute);
    const cost = Math.round((cab.base_fare + km * cab.per_km_rate) * 100) / 100;
    updateCab(slotId, { route: newRoute, distance_km: km, total_cost: cost });
    setStopDraft({ slotId: null, label: '', lat: '', lng: '' });
  };

  const handleRemoveStop = (slotId, idx) => {
    const cab = record.cabs[slotId];
    const newRoute = cab.route.filter((_, i) => i !== idx);
    const km = computeRouteKm(newRoute);
    const cost = newRoute.length < 2 ? null : Math.round((cab.base_fare + km * cab.per_km_rate) * 100) / 100;
    updateCab(slotId, { route: newRoute, distance_km: newRoute.length < 2 ? null : km, total_cost: cost });
  };

  const handleComplete = (slotId) => {
    updateCab(slotId, { status: 'completed' });
  };

  // ── Month summary (Food Coupons-style tally) ─────────────────────
  const monthSummary = useMemo(() => {
    const dt = new Date(date + 'T00:00:00');
    const monthPrefix = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    let totalRides = 0;
    let totalKm = 0;
    let totalCost = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('ags_cab_drops_')) continue;
        const dayStr = key.replace('ags_cab_drops_', '');
        if (!dayStr.startsWith(monthPrefix)) continue;
        const rec = JSON.parse(localStorage.getItem(key) || '{}');
        Object.values(rec.cabs || {}).forEach((cab) => {
          totalRides += cab.riders?.length || 0;
          if (cab.distance_km) totalKm += cab.distance_km;
          if (cab.total_cost) totalCost += cab.total_cost;
        });
      }
    } catch {}
    return { totalRides, totalKm: Math.round(totalKm * 10) / 10, totalCost: Math.round(totalCost) };
  }, [date, record]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Cab Drops</h1>
          <p className={`text-sm mt-0.5 ${subtleText}`}>
            Night-shift cab drop-off · Office to home · {currentUser?.work_timezone || 'IST'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className={`text-xs ${subtleText}`}>Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls + ' max-w-[160px]'}
          />
        </div>
      </div>

      {/* Month Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Today's Riders</p>
          <p className="text-2xl font-bold mt-1 text-brand">
            {Object.values(record.cabs).reduce((sum, c) => sum + c.riders.length, 0)}
          </p>
          <p className={`text-[10px] mt-1 ${subtleText}`}>Across both cabs</p>
        </div>
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Today's Distance</p>
          <p className="text-2xl font-bold mt-1 text-blue-500">
            {Object.values(record.cabs).reduce((sum, c) => sum + (c.distance_km || 0), 0).toFixed(1)} km
          </p>
          <p className={`text-[10px] mt-1 ${subtleText}`}>Both routes combined</p>
        </div>
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Today's Cost</p>
          <p className="text-2xl font-bold mt-1 text-amber-500">
            {'\u20B9'}{Object.values(record.cabs).reduce((sum, c) => sum + (c.total_cost || 0), 0).toLocaleString('en-IN')}
          </p>
          <p className={`text-[10px] mt-1 ${subtleText}`}>Billed to company</p>
        </div>
        <div className={`rounded-xl border p-4 ${card}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Month to date</p>
          <p className="text-2xl font-bold mt-1 text-purple-500">
            {'\u20B9'}{monthSummary.totalCost.toLocaleString('en-IN')}
          </p>
          <p className={`text-[10px] mt-1 ${subtleText}`}>
            {monthSummary.totalRides} rides · {monthSummary.totalKm} km
          </p>
        </div>
      </div>

      {/* Cab cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {SLOTS.map((slot) => {
          const cab = record.cabs[slot.id];
          const remaining = Math.max(0, cab.capacity - cab.riders.length);
          const alreadyIn = cab.riders.some((r) => r.user_id === currentUser?.id);
          const statusBadge =
            cab.status === 'completed'
              ? (isDark ? 'bg-green-900/40 text-green-300' : 'bg-green-100 text-green-700')
              : cab.status === 'in_transit'
              ? (isDark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700')
              : (isDark ? 'bg-amber-900/40 text-amber-300' : 'bg-amber-100 text-amber-700');
          const statusLabel =
            cab.status === 'completed' ? 'Completed'
            : cab.status === 'in_transit' ? 'In Transit'
            : 'Boarding';

          return (
            <div key={slot.id} className={`rounded-xl border overflow-hidden ${card}`}>
              {/* Header */}
              <div className={`px-5 py-4 border-b ${borderColor} flex items-center justify-between gap-3`}>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold">{slot.label}</h2>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${statusBadge}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <p className={`text-xs mt-0.5 ${subtleText}`}>Departs {slot.departure}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-brand">{cab.riders.length}<span className="text-sm font-medium text-gray-400">/{cab.capacity}</span></p>
                  <p className={`text-[10px] ${subtleText}`}>{remaining} seats left</p>
                </div>
              </div>

              {/* Vehicle assignment */}
              <div className={`px-5 py-3 border-b ${borderColor}`}>
                {editingSlot === slot.id ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={`block text-[10px] font-semibold uppercase tracking-wider ${subtleText} mb-1`}>Vehicle No.</label>
                        <input
                          type="text"
                          value={vehicleDraft.vehicle_number}
                          onChange={(e) => setVehicleDraft({ ...vehicleDraft, vehicle_number: e.target.value })}
                          placeholder="e.g. TS 09 AB 1234"
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={`block text-[10px] font-semibold uppercase tracking-wider ${subtleText} mb-1`}>Capacity</label>
                        <input
                          type="number"
                          min="1"
                          value={vehicleDraft.capacity}
                          onChange={(e) => setVehicleDraft({ ...vehicleDraft, capacity: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={`block text-[10px] font-semibold uppercase tracking-wider ${subtleText} mb-1`}>Rate ({'\u20B9'}/km)</label>
                        <input
                          type="number"
                          min="0"
                          value={vehicleDraft.per_km_rate}
                          onChange={(e) => setVehicleDraft({ ...vehicleDraft, per_km_rate: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={`block text-[10px] font-semibold uppercase tracking-wider ${subtleText} mb-1`}>Base fare ({'\u20B9'})</label>
                        <input
                          type="number"
                          min="0"
                          value={vehicleDraft.base_fare}
                          onChange={(e) => setVehicleDraft({ ...vehicleDraft, base_fare: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleSaveVehicle}
                        className="px-3 py-1.5 rounded-md text-xs font-medium text-white bg-brand hover:bg-brand-hover">Save</button>
                      <button type="button" onClick={() => setEditingSlot(null)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium ${isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Cancel</button>
                    </div>
                  </div>
                ) : cab.vehicle_number ? (
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Vehicle</p>
                      <p className="text-sm font-semibold font-mono">{cab.vehicle_number}</p>
                      <p className={`text-[10px] mt-0.5 ${subtleText}`}>
                        {'\u20B9'}{cab.per_km_rate}/km · {'\u20B9'}{cab.base_fare} base
                      </p>
                    </div>
                    {isSupervisor && cab.status === 'pending' && (
                      <button type="button" onClick={() => handleStartEditVehicle(slot.id)}
                        className={`text-xs font-medium text-brand hover:text-brand-hover`}>Edit</button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-xs ${subtleText}`}>No vehicle assigned yet</p>
                    {isSupervisor ? (
                      <button type="button" onClick={() => handleStartEditVehicle(slot.id)}
                        className="px-3 py-1.5 rounded-md text-xs font-medium text-white bg-brand hover:bg-brand-hover">Assign</button>
                    ) : (
                      <span className={`text-[10px] ${subtleText}`}>Waiting for supervisor</span>
                    )}
                  </div>
                )}
              </div>

              {/* Riders */}
              <div className={`px-5 py-3 border-b ${borderColor}`}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Riders</h3>
                  {cab.vehicle_number && cab.status === 'pending' && !alreadyIn && remaining > 0 && (
                    <button type="button" onClick={() => handleCheckIn(slot.id)}
                      className="px-3 py-1.5 rounded-md text-xs font-medium text-white bg-brand hover:bg-brand-hover">
                      Check in
                    </button>
                  )}
                  {alreadyIn && cab.status === 'pending' && (
                    <button type="button" onClick={() => handleCheckOut(slot.id, currentUser?.id)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium ${isDark ? 'text-amber-300 bg-amber-900/30 hover:bg-amber-900/50' : 'text-amber-700 bg-amber-50 hover:bg-amber-100'}`}>
                      Leave cab
                    </button>
                  )}
                </div>
                {cab.riders.length === 0 ? (
                  <p className={`text-xs ${subtleText}`}>No one has boarded yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {cab.riders.map((rider, i) => (
                      <li key={rider.user_id || i} className="flex items-center gap-2 text-xs">
                        <span className="w-5 h-5 rounded-full bg-brand/20 text-brand flex items-center justify-center font-bold">
                          {i + 1}
                        </span>
                        <span className="font-medium flex-1 truncate">{rider.name}</span>
                        {rider.boarding_at && (
                          <span className={subtleText}>
                            {new Date(rider.boarding_at).toLocaleTimeString('en-GB', {
                              hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata',
                            })}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Route */}
              <div className={`px-5 py-3 border-b ${borderColor}`}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText}`}>Route</h3>
                  {cab.distance_km != null && (
                    <p className={`text-[10px] ${subtleText}`}>
                      <span className="font-semibold">{cab.distance_km.toFixed(1)} km</span> · {'\u20B9'}{(cab.total_cost || 0).toLocaleString('en-IN')}
                    </p>
                  )}
                </div>
                {cab.route.length === 0 ? (
                  <p className={`text-xs ${subtleText} mb-2`}>No stops yet. Supervisor adds drop-off points below.</p>
                ) : (
                  <ol className="space-y-1 mb-2">
                    {cab.route.map((stop, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-5 h-5 rounded bg-blue-500/20 text-blue-500 flex items-center justify-center font-bold text-[10px]">
                          {i === 0 ? 'A' : String.fromCharCode(64 + i + 1)}
                        </span>
                        <span className="flex-1 truncate">{stop.label}</span>
                        <span className={`text-[10px] ${subtleText} font-mono`}>{stop.lat.toFixed(3)}, {stop.lng.toFixed(3)}</span>
                        {isSupervisor && cab.status !== 'completed' && (
                          <button type="button" onClick={() => handleRemoveStop(slot.id, i)}
                            className={`text-[10px] ${isDark ? 'text-red-400 hover:text-red-300' : 'text-red-500 hover:text-red-700'}`}>
                            Remove
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                {isSupervisor && cab.status !== 'completed' && (
                  <div className="space-y-2 mt-2">
                    <input
                      type="text"
                      placeholder="Stop name (e.g. Hitech City)"
                      value={stopDraft.slotId === slot.id ? stopDraft.label : ''}
                      onChange={(e) => setStopDraft({ slotId: slot.id, label: e.target.value, lat: stopDraft.lat, lng: stopDraft.lng })}
                      onFocus={() => stopDraft.slotId !== slot.id && setStopDraft({ slotId: slot.id, label: '', lat: '', lng: '' })}
                      className={inputCls}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        step="0.0001"
                        placeholder="Lat"
                        value={stopDraft.slotId === slot.id ? stopDraft.lat : ''}
                        onChange={(e) => setStopDraft({ ...stopDraft, slotId: slot.id, lat: e.target.value })}
                        className={inputCls}
                      />
                      <input
                        type="number"
                        step="0.0001"
                        placeholder="Lng"
                        value={stopDraft.slotId === slot.id ? stopDraft.lng : ''}
                        onChange={(e) => setStopDraft({ ...stopDraft, slotId: slot.id, lng: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <button type="button" onClick={() => handleAddStop(slot.id)}
                      className="w-full px-3 py-2.5 rounded-md text-sm font-medium text-white bg-brand hover:bg-brand-hover min-h-[44px]">
                      Add stop
                    </button>
                  </div>
                )}
                <p className={`text-[10px] ${subtleText} mt-2 italic`}>
                  Distance computed via haversine (placeholder). Swap for Google Distance Matrix / OR-tools to get real road distance.
                </p>
              </div>

              {/* Supervisor controls */}
              {isSupervisor && (
                <div className="px-5 py-3 flex gap-2">
                  {cab.status === 'pending' && cab.vehicle_number && cab.riders.length > 0 && (
                    <button type="button" onClick={() => handleDepart(slot.id)}
                      className="flex-1 px-3 py-2 rounded-md text-xs font-medium text-white bg-blue-500 hover:bg-blue-600">
                      Depart now
                    </button>
                  )}
                  {cab.status === 'in_transit' && (
                    <button type="button" onClick={() => handleComplete(slot.id)}
                      className="flex-1 px-3 py-2 rounded-md text-xs font-medium text-white bg-green-500 hover:bg-green-600">
                      Mark completed
                    </button>
                  )}
                  {cab.status === 'completed' && (
                    <p className={`text-xs ${subtleText} text-center w-full`}>Trip completed · record saved</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footnote */}
      <div className={`rounded-xl border p-4 ${card}`}>
        <p className={`text-[10px] font-semibold uppercase tracking-wider ${subtleText} mb-1`}>About this module</p>
        <p className={`text-xs ${subtleText} leading-relaxed`}>
          This is a skeleton. Daily records are currently saved to your browser's localStorage.
          To productionize: move state to a <code className={`px-1 rounded ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`}>cab_drops</code> backend table
          (one row per cab per day), plug the Google Distance Matrix API into <code className={`px-1 rounded ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`}>computeRouteKm</code>,
          and use OR-tools VRP solver for optimal drop-order when the supervisor has many stops.
          Billing format mirrors Food Coupons — monthly CSV export can be added with the same pattern.
        </p>
      </div>
    </div>
  );
}
