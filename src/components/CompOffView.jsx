import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../api/client';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(d) {
  if (!d) return '--';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function calendarBadge(cal, isDark) {
  if (cal === 'IND') return isDark ? 'bg-orange-900/30 text-orange-400' : 'bg-orange-100 text-orange-700';
  if (cal === 'US') return isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-700';
  return isDark ? 'bg-purple-900/30 text-purple-400' : 'bg-purple-100 text-purple-700';
}

export default function CompOffView({ isDark, currentUser, showToast, myCompOffRequests = [] }) {
  const [holidays, setHolidays] = useState([]);
  const [userCalendars, setUserCalendars] = useState([]);
  const [compOffs, setCompOffs] = useState([]);
  const [compSummary, setCompSummary] = useState({ earned: 0, used: 0, available: 0, total_bonus: 0 });
  const [allCompOffs, setAllCompOffs] = useState([]);
  const [byUser, setByUser] = useState([]);
  const [tab, setTab] = useState('holidays');
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  const isApprover = ['admin', 'manager', 'team_lead'].includes(currentUser?.type);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [hData, cData] = await Promise.all([
        api.holidays.list(year),
        api.holidays.compOffs(),
      ]);
      setHolidays(hData.holidays || []);
      setUserCalendars(hData.user_calendars || []);
      setCompOffs(cData.comp_offs || []);
      setCompSummary(cData.summary || { earned: 0, used: 0, available: 0, total_bonus: 0 });

      if (isApprover) {
        const aData = await api.holidays.compOffsAll();
        setAllCompOffs(aData.comp_offs || []);
        setByUser(aData.by_user || []);
      }
    } catch (e) {
      console.error('CompOff fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [year, isApprover]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // Split holidays into "my holidays" vs all
  const myHolidays = useMemo(() =>
    holidays.filter((h) => userCalendars.includes(h.calendar)),
    [holidays, userCalendars]
  );

  const upcomingHolidays = useMemo(() =>
    myHolidays.filter((h) => h.holiday_date >= todayStr),
    [myHolidays, todayStr]
  );

  const pastHolidays = useMemo(() =>
    myHolidays.filter((h) => h.holiday_date < todayStr),
    [myHolidays, todayStr]
  );

  const cardClass = isDark ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-gray-200 text-gray-900';
  const tableRowClass = isDark ? 'border-slate-600 hover:bg-slate-700/50' : 'border-gray-200 hover:bg-gray-50';
  const activeBtnClass = 'bg-brand text-white';
  const inactiveBtnClass = isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200';

  if (loading) {
    return (
      <div className="space-y-4 max-w-5xl mx-auto w-full animate-pulse">
        <div className={`h-8 w-48 rounded ${isDark ? 'bg-slate-700' : 'bg-gray-200'}`} />
        <div className={`h-32 rounded-xl ${isDark ? 'bg-slate-800' : 'bg-gray-100'}`} />
        <div className={`h-64 rounded-xl ${isDark ? 'bg-slate-800' : 'bg-gray-100'}`} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Holidays & Comp Off</h1>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={`text-sm rounded-lg px-3 py-1.5 border ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-700'}`}
          >
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
            <option value={2027}>2027</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`rounded-xl border p-4 ${cardClass}`}>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Upcoming Holidays</p>
          <p className="text-2xl font-bold mt-1 text-brand">{upcomingHolidays.length}</p>
        </div>
        <div className={`rounded-xl border p-4 ${cardClass}`}>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Comp Leaves Earned</p>
          <p className="text-2xl font-bold mt-1 text-green-600 dark:text-green-400">{compSummary.earned}</p>
        </div>
        <div className={`rounded-xl border p-4 ${cardClass}`}>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Comp Leaves Available</p>
          <p className="text-2xl font-bold mt-1 text-blue-600 dark:text-blue-400">{compSummary.available}</p>
        </div>
        <div className={`rounded-xl border p-4 ${cardClass}`}>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">Holiday Bonus Earned</p>
          <p className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">
            {compSummary.total_bonus > 0 ? `\u20B9${compSummary.total_bonus.toLocaleString()}` : '--'}
          </p>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-2 flex-wrap">
        {['holidays', 'my-comp-offs', ...(isApprover ? ['team-comp-offs'] : [])].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? activeBtnClass : inactiveBtnClass}`}
          >
            {t === 'holidays' ? 'Holiday Calendar' : t === 'my-comp-offs' ? 'My Comp Offs' : 'Team Comp Offs'}
          </button>
        ))}
      </div>

      {/* ── Holiday Calendar Tab ──────────────────────── */}
      {tab === 'holidays' && (
        <div className="space-y-6">
          {/* Upcoming */}
          {upcomingHolidays.length > 0 && (
            <section>
              <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                Upcoming Holidays
                <span className="text-xs px-2 py-0.5 rounded-full bg-brand/10 text-brand">{upcomingHolidays.length}</span>
              </h2>
              <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-full text-left text-sm">
                    <thead>
                      <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                        <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Date</th>
                        <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Holiday</th>
                        <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Type</th>
                        <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Calendar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upcomingHolidays.map((h) => {
                        const dt = new Date(h.holiday_date + 'T00:00:00');
                        const dayName = dt.toLocaleDateString('en-US', { weekday: 'short' });
                        return (
                          <tr key={h.id} className={`border-b ${tableRowClass}`}>
                            <td className="px-4 py-3 font-medium whitespace-nowrap">{fmtDate(h.holiday_date)} <span className="text-gray-400 text-xs">({dayName})</span></td>
                            <td className="px-4 py-3">{h.name}</td>
                            <td className="px-4 py-3">
                              {h.is_optional
                                ? <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">Optional</span>
                                : <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Mandatory</span>
                              }
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${calendarBadge(h.calendar, isDark)}`}>{h.calendar}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* Full calendar */}
          <section>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
              All Holidays — {year}
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">({holidays.length} total, {myHolidays.length} for you)</span>
            </h2>
            <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-full text-left text-sm">
                  <thead>
                    <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Date</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Holiday</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Type</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Calendar</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Applies to You</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holidays.map((h) => {
                      const dt = new Date(h.holiday_date + 'T00:00:00');
                      const dayName = dt.toLocaleDateString('en-US', { weekday: 'short' });
                      const appliesForUser = userCalendars.includes(h.calendar);
                      const isPast = h.holiday_date < todayStr;
                      return (
                        <tr key={h.id} className={`border-b ${tableRowClass} ${isPast ? 'opacity-50' : ''}`}>
                          <td className="px-4 py-3 font-medium whitespace-nowrap">{fmtDate(h.holiday_date)} <span className="text-gray-400 text-xs">({dayName})</span></td>
                          <td className="px-4 py-3">{h.name}</td>
                          <td className="px-4 py-3">
                            {h.is_optional
                              ? <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">Optional</span>
                              : <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Mandatory</span>
                            }
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${calendarBadge(h.calendar, isDark)}`}>{h.calendar}</span>
                          </td>
                          <td className="px-4 py-3">
                            {appliesForUser
                              ? <span className="text-green-600 dark:text-green-400 text-xs font-medium">Yes</span>
                              : <span className="text-gray-400 dark:text-gray-600 text-xs">No</span>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Info box */}
          <div className={`rounded-xl border p-4 ${isDark ? 'bg-blue-900/20 border-blue-800/40' : 'bg-blue-50 border-blue-200'}`}>
            <p className={`text-sm font-medium ${isDark ? 'text-blue-300' : 'text-blue-800'}`}>Holiday Work Benefits</p>
            <p className={`text-sm mt-1 ${isDark ? 'text-blue-400' : 'text-blue-700'}`}>
              Indian team: if you clock in on an Indian holiday (IND/All), you automatically earn <strong>{'\u20B9'}500 bonus</strong> + <strong>1 compensatory leave</strong>.
              Comp leaves can be used later as paid time off. US team holidays are for reference only.
            </p>
          </div>
        </div>
      )}

      {/* ── My Comp Offs Tab ──────────────────────── */}
      {tab === 'my-comp-offs' && (
        <div className="space-y-4">
          {myCompOffRequests.length > 0 && (
            <div className={`rounded-xl border p-4 mb-4 ${isDark ? 'bg-amber-900/10 border-amber-800/30' : 'bg-amber-50 border-amber-200'}`}>
              <h3 className={`text-sm font-medium mb-2 ${isDark ? 'text-amber-500' : 'text-amber-800'}`}>Pending Requests</h3>
              <div className="space-y-2">
                {myCompOffRequests.map(req => (
                  <div key={req.id} className={`flex items-center justify-between p-3 rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        Worked on {req.request_type === 'holiday' ? 'Holiday' : 'Week Off'} ({req.shift_date})
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {req.hours_worked} hours • Eligible for {req.earned_days} Comp Off
                        {req.holiday_name ? ` • ${req.holiday_name}` : ''}
                      </p>
                    </div>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                      Pending Approval
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {compOffs.length === 0 && myCompOffRequests.length === 0 ? (
            <div className={`rounded-xl border p-8 text-center ${cardClass}`}>
              <svg className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm text-gray-500 dark:text-gray-400">No comp offs earned or requested yet.</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Clock in on a holiday or week off to earn comp leave.</p>
            </div>
          ) : compOffs.length > 0 ? (
            <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-full text-left text-sm">
                  <thead>
                    <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Holiday</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Date Worked</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Bonus</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Comp Leave</th>
                      <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compOffs.map((c) => (
                      <tr key={c.id} className={`border-b ${tableRowClass}`}>
                        <td className="px-4 py-3 font-medium">{c.holiday_name}</td>
                        <td className="px-4 py-3">{fmtDate(c.holiday_date)}</td>
                        <td className="px-4 py-3 text-amber-600 dark:text-amber-400 font-medium">{'\u20B9'}{parseFloat(c.bonus_amount).toLocaleString()}</td>
                        <td className="px-4 py-3">{c.comp_leave_days} day</td>
                        <td className="px-4 py-3">
                          {c.status === 'earned' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                              Available
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                              Used {c.used_date ? `on ${fmtDate(c.used_date)}` : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Team Comp Offs Tab (approvers only) ──── */}
      {tab === 'team-comp-offs' && isApprover && (
        <div className="space-y-6">
          {/* Per-user summary */}
          {byUser.length > 0 && (
            <section>
              <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3">Team Summary</h2>
              <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-full text-left text-sm">
                    <thead>
                      <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                        <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Employee</th>
                        <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Earned</th>
                        <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Used</th>
                        <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Available</th>
                        <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Total Bonus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byUser.map((u) => (
                        <tr key={u.user_id} className={`border-b ${tableRowClass}`}>
                          <td className="px-4 py-3 font-medium">{u.user_name}</td>
                          <td className="px-4 py-3 text-green-600 dark:text-green-400">{u.earned}</td>
                          <td className="px-4 py-3">{u.used}</td>
                          <td className="px-4 py-3 font-medium text-blue-600 dark:text-blue-400">{u.earned - u.used}</td>
                          <td className="px-4 py-3 text-amber-600 dark:text-amber-400">{'\u20B9'}{u.total_bonus.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* All comp off records */}
          <section>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
              All Comp Off Records ({allCompOffs.length})
            </h2>
            {allCompOffs.length === 0 ? (
              <div className={`rounded-xl border p-6 text-center ${cardClass}`}>
                <p className="text-sm text-gray-500 dark:text-gray-400">No comp offs earned by any team member yet.</p>
              </div>
            ) : (
              <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-full text-left text-sm">
                    <thead>
                      <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                        <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Employee</th>
                        <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Holiday</th>
                        <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Date Worked</th>
                        <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Bonus</th>
                        <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allCompOffs.map((c) => (
                        <tr key={c.id} className={`border-b ${tableRowClass}`}>
                          <td className="px-4 py-3 font-medium">{c.user_name}</td>
                          <td className="px-4 py-3">{c.holiday_name}</td>
                          <td className="px-4 py-3">{fmtDate(c.holiday_date)}</td>
                          <td className="px-4 py-3 text-amber-600 dark:text-amber-400">{'\u20B9'}{parseFloat(c.bonus_amount).toLocaleString()}</td>
                          <td className="px-4 py-3">
                            {c.status === 'earned' ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Available</span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">Used</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
