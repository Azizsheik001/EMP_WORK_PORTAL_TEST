import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  CLIENTS,
  PRESENTATION_SHIFT_ROWS,
  getTeamLeadIdForEmployee,
  getManagerIdForTeamLead,
  LEAVE_STATUS,
} from './data/mockData';
import { hasApi, api, getToken, getStoredUser, setToken, setStoredUser, setOnUnauthorized } from './api/client';
import { normalizeUser, normalizeLeaveRequest, buildShiftRowsFromApi } from './api/normalize';
import { attemptSsoAutoLogin, clearSsoSession, hasPendingSso } from './utils/ssoAutoLogin';
import { resolveTimezone } from './utils/timezone';
import ShiftsTable from './components/ShiftsTable';
import EmployeeModal from './components/EmployeeModal';
import UploadSchedules from './components/UploadSchedules';
import Header from './components/Header';
import FilterBar from './components/FilterBar';
import ChangelogModal from './components/ChangelogModal';
import UserManagementModal from './components/UserManagementModal';
import AddMemberModal from './components/AddMemberModal';
import AddClientModal from './components/AddClientModal';
import AIAssistant from './components/AIAssistant';
import EmployeeView from './components/EmployeeView';
import RightPanel from './components/RightPanel';
import LoginPage from './components/LoginPage';
import NotificationsPanel from './components/NotificationsPanel';
import LeavesView from './components/LeavesView';
import SchedulesView from './components/SchedulesView';
import Toast from './components/Toast';
import AssetManagementView from './components/AssetManagementView';
import DashboardView from './components/DashboardView';
import CelebrationsView from './components/CelebrationsView';
import FoodCabView from './components/FoodCabView';
import BudgetingView from './components/BudgetingView';
import MyWorkView from './components/MyWorkView';
import ReportsView from './components/ReportsView';
import DinnerTrackingView from './components/DinnerTrackingView';
import AttendanceCalendar from './components/AttendanceCalendar';
import IdeasView from './components/IdeasView';
import TeamView from './components/TeamView';
import UserManagementView from './components/UserManagementView';
import CompOffView from './components/CompOffView';
import LeaveReportView from './components/LeaveReportView';
import CabDropsView from './components/CabDropsView';
import ErrorBoundary from './components/ErrorBoundary';
import CelebrationBanner from './components/CelebrationBanner';

const MAX_ISO_WEEKS = 53;

/* ── SVG Icons ────────────────────────────────────── */
const ICONS = {
  dashboard: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  ),
  celebrations: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 15.546c-.523 0-1.046.151-1.5.454a2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0 2.704 2.704 0 00-3 0 2.704 2.704 0 01-3 0A1.75 1.75 0 013 15.546M12 3v1m0 11v1m-4.93-9.07l.7.7m8.46 8.46l.7.7M3 12h1m15 0h1M7.07 7.07l-.7-.7m8.46 8.46l-.7-.7" />
    </svg>
  ),
  myShift: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  leaves: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  ),
  schedules: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  allClients: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  clientWise: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  ),
  leaveApprovals: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  assets: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  budgeting: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  foodCab: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
    </svg>
  ),
  reports: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  ai: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  attendance: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  dinners: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
    </svg>
  ),
  ideas: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  people: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  compOff: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  hr: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  cab: (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 17h8m-9 0a2 2 0 104 0m5 0a2 2 0 104 0M3 13l1.5-6A2 2 0 016.46 5.5h11.08a2 2 0 011.96 1.5L21 13m-18 0h18m-18 0v4a1 1 0 001 1h1m15-5v4a1 1 0 01-1 1h-1M7 10h3m4 0h3" />
    </svg>
  ),
};

/* ── Flat Sidebar Navigation Config ──────────────────── */
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', roles: ['admin', 'manager', 'team_lead', 'employee'] },
  { id: 'my-work', label: 'My Work', icon: 'myShift', roles: ['admin', 'manager', 'team_lead', 'employee'] },
  { id: 'ideas', label: 'Ideas', icon: 'ideas', roles: ['admin', 'manager', 'team_lead', 'employee'] },
  { id: 'divider-1', divider: true, roles: ['admin', 'manager', 'team_lead', 'employee'] },
  { id: 'schedules', label: 'Schedules', icon: 'schedules', roles: ['admin', 'manager', 'team_lead'] },
  { id: 'team', label: 'Team', icon: 'allClients', roles: ['admin', 'manager', 'team_lead', 'employee'] },
  { id: 'attendance', label: 'Attendance', icon: 'attendance', roles: ['admin', 'manager', 'team_lead', 'employee'] },
  { id: 'approvals', label: 'Requests', icon: 'leaveApprovals', roles: ['admin', 'manager', 'team_lead', 'employee'], badge: true },
  { id: 'comp-off', label: 'Holidays & Comp Off', icon: 'compOff', roles: ['admin', 'manager', 'team_lead', 'employee'] },
  { id: 'divider-2', divider: true, roles: ['admin', 'manager', 'team_lead', 'employee'] },
  {
    id: 'hr',
    label: 'HR',
    icon: 'hr',
    group: true,
    roles: ['admin', 'manager', 'team_lead', 'employee'],
    children: [
      { id: 'allowances', label: 'Allowances', icon: 'foodCab', roles: ['admin', 'manager', 'team_lead', 'employee'] },
      { id: 'asset-management', label: 'Assets', icon: 'assets', roles: ['admin', 'manager', 'team_lead'] },
      { id: 'budgeting', label: 'Budgeting', icon: 'budgeting', roles: ['admin', 'manager', 'team_lead'] },
      { id: 'reports', label: 'HR Reports', icon: 'reports', roles: ['admin', 'manager', 'team_lead'] },
      { id: 'leave-report', label: 'Leave Report', icon: 'leaves', roles: ['admin', 'manager', 'team_lead'] },
      { id: 'dinner-tracker', label: 'Food Coupons', icon: 'dinners', roles: ['admin', 'manager', 'team_lead'] },
      { id: 'cab-drops', label: 'Cab Drops', icon: 'cab', roles: ['admin', 'manager', 'team_lead', 'employee'] },
    ],
  },
];

function getISOMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date;
}

// Whether ssoAutoLogin captured a suite_token at module-load (before URL cleanup)
const _hasSsoParams = hasPendingSso;

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    // Restore SSO session from localStorage immediately (for page refresh)
    try {
      const raw = localStorage.getItem('ags_sso_session');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  const [ssoLoading, setSsoLoading] = useState(_hasSsoParams);
  const [clockedInEmployeeIds, setClockedInEmployeeIds] = useState(new Set());
  const [clockedInTimes, setClockedInTimes] = useState({});

  const [activeTab, setActiveTabRaw] = useState(() => {
    const hash = window.location.hash.replace('#', '').replace(/^\//, '');
    return hash || 'dashboard';
  });
  const setActiveTab = useCallback((tab) => {
    setActiveTabRaw(tab);
    window.location.hash = tab;
  }, []);

  // Sync activeTab when hash changes (browser back/forward)
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace('#', '').replace(/^\//, '');
      if (hash) setActiveTabRaw(hash);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const [week, setWeek] = useState(1);
  const [dateFrom, setDateFrom] = useState(() => {
    // Before 5 AM IST, overnight shifts from yesterday are still active — default to yesterday
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    if (nowIST.getHours() < 5) {
      const y = new Date(nowIST); y.setDate(y.getDate() - 1);
      return `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
    }
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  });
  const [dateTo, setDateTo] = useState(() => {
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    if (nowIST.getHours() < 5) {
      const y = new Date(nowIST); y.setDate(y.getDate() - 1);
      return `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
    }
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  });
  const [clientId, setClientId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [isDark, setIsDark] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [userMgmtOpen, setUserMgmtOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [userListRefreshKey, setUserListRefreshKey] = useState(0);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [aiAssistantOpen, setAIAssistantOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [allLeaveRequests, setAllLeaveRequests] = useState([]);
  const [apiClients, setApiClients] = useState([]);
  const [apiShifts, setApiShifts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [allUsers, setAllUsers] = useState([]);
  const [assignedEmployeesByClient, setAssignedEmployeesByClient] = useState({});
  const [myClockStatus, setMyClockStatus] = useState(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('ags_sidebar_collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('ags_sidebar_collapsed', sidebarCollapsed ? '1' : '0'); } catch {}
  }, [sidebarCollapsed]);
  const [toast, setToast] = useState(null);
  const [shiftChangeRequests, setShiftChangeRequests] = useState([]);
  const [allShiftChangeRequests, setAllShiftChangeRequests] = useState([]);
  const [userClientMap, setUserClientMap] = useState({});
  const [compOffSummary, setCompOffSummary] = useState({});
  const [adminAlerts, setAdminAlerts] = useState([]);
  const [autoLogoutNotices, setAutoLogoutNotices] = useState([]);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type, key: Date.now() });
  }, []);

  const handleLogout = useCallback(() => {
    if (hasApi()) { setToken(''); setStoredUser(null); }
    clearSsoSession();
    setCurrentUser(null);
    setRightPanelOpen(false);
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => {
      setToken('');
      setStoredUser(null);
      setCurrentUser(null);
    });
  }, []);

  useEffect(() => {
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDark]);

  // SSO Auto-Login: check for suite_token in URL (from AGS Suite dashboard)
  useEffect(() => {
    if (!_hasSsoParams && !currentUser) {
      // No SSO params and no stored user — nothing to do
      setSsoLoading(false);
      return;
    }
    attemptSsoAutoLogin().then((ssoUser) => {
      if (ssoUser) {
        setStoredUser(ssoUser);
        setCurrentUser(ssoUser);
      }
    }).finally(() => setSsoLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchLeaveRequests = useCallback(async () => {
    if (!hasApi() || !getToken()) return;
    try {
      const data = await api.leaveRequests.list();
      const actionable = (data.leave_requests || []).map(normalizeLeaveRequest).filter(Boolean);
      setLeaveRequests(actionable);
      // all_leave_requests contains requests from all employees (for dashboard stats)
      const allOther = (data.all_leave_requests || []).map(normalizeLeaveRequest).filter(Boolean);
      // Merge: actionable (includes own) + allOther (excludes own) — deduplicate by id
      const seen = new Set(actionable.map((r) => r.id));
      const merged = [...actionable, ...allOther.filter((r) => !seen.has(r.id))];
      setAllLeaveRequests(merged);
    } catch (e) {
      if (e.status !== 401) setApiError(e.message);
    }
  }, []);

  const fetchShiftChangeRequests = useCallback(async () => {
    if (!hasApi() || !getToken()) return;
    try {
      const data = await api.shiftChanges.list();
      setShiftChangeRequests(data.shift_change_requests || []);
      setAllShiftChangeRequests(data.all_shift_change_requests || data.shift_change_requests || []);
    } catch (e) {
      // shift_change_requests table may not exist yet
    }
  }, []);

  useEffect(() => {
    if (!hasApi() || !getToken()) return;
    const stored = getStoredUser();
    if (stored) setCurrentUser(stored);
    setApiError(null);
    api.me()
      .then((data) => {
        const u = normalizeUser(data.user);
        setCurrentUser(u);
        setStoredUser(u);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentUser || !hasApi()) return;
    api.clients().then((data) => setApiClients(data.clients || [])).catch(() => {});
    api.departments().then((data) => setDepartments(data.departments || [])).catch(() => {});
    if (currentUser.type === 'admin' || currentUser.type === 'manager' || currentUser.type === 'team_lead') {
      api.users().then((data) => setAllUsers(data.users || [])).catch(() => {});
    } else if (currentUser.type === 'employee') {
      api.myTeam().then((data) => setAllUsers(data.users || [])).catch(() => {});
    }
    fetchLeaveRequests();
    fetchShiftChangeRequests();
    // Fetch comp-off summary per employee (for pretext in approval cards)
    if (currentUser.type === 'admin' || currentUser.type === 'manager' || currentUser.type === 'team_lead') {
      api.holidays.compOffsByEmployee().then((data) => setCompOffSummary(data.comp_off_summary || {})).catch(() => {});
      // Fetch admin alerts (mobile device flags, etc.)
      api.adminAlerts.list().then((data) => setAdminAlerts(data.alerts || [])).catch(() => {});
    }
    // Fetch auto-logout notices for ALL users (employees see their own missed logouts)
    api.autoLogoutNotices().then((data) => setAutoLogoutNotices(data.notices || [])).catch(() => {});
    // Fetch user-client assignments for team tab (Solar dept client display)
    if (currentUser.type === 'admin' || currentUser.type === 'manager' || currentUser.type === 'team_lead') {
      api.assignments.userClients()
        .then((data) => {
          const map = {};
          (data.user_clients || []).forEach((uc) => {
            if (!map[uc.user_id]) map[uc.user_id] = [];
            map[uc.user_id].push(uc.client_name);
          });
          setUserClientMap(map);
        })
        .catch(() => {});
    }
  }, [currentUser, fetchLeaveRequests, fetchShiftChangeRequests]);

  // Keep the notification bell live — refetch alerts + auto-logout notices
  // every 60s, and also immediately when the panel is opened. This fixes the
  // "I resolved it but the bell still shows 50" stale-state issue.
  useEffect(() => {
    if (!currentUser || !hasApi()) return;
    const refetch = () => {
      if (currentUser.type === 'admin' || currentUser.type === 'manager' || currentUser.type === 'team_lead') {
        api.adminAlerts.list().then((data) => setAdminAlerts(data.alerts || [])).catch(() => {});
      }
      api.autoLogoutNotices().then((data) => setAutoLogoutNotices(data.notices || [])).catch(() => {});
    };
    if (notificationsOpen) refetch();
    const id = setInterval(refetch, 60_000);
    return () => clearInterval(id);
  }, [currentUser, notificationsOpen]);

  useEffect(() => {
    if (!currentUser || !hasApi()) return;
    const needShifts = activeTab === 'team' || activeTab === 'my-work';
    if (!needShifts) return;
    setApiLoading(true);
    const params = { client_id: clientId || undefined };
    if (dateFrom && dateTo && dateFrom <= dateTo) {
      params.from = dateFrom;
      params.to = dateTo;
    } else {
      params.week = week;
      params.year = new Date().getFullYear();
    }
    api.shifts(params)
      .then((data) => setApiShifts(data.shifts || []))
      .catch((e) => {
        if (e.status !== 401) setApiError(e.message);
      })
      .finally(() => setApiLoading(false));
  }, [currentUser, activeTab, week, dateFrom, dateTo, clientId]);

  useEffect(() => {
    if (!hasApi() || !clientId || activeTab !== 'team') return;
    api.assignments.byClient(clientId)
      .then((data) => setAssignedEmployeesByClient((prev) => ({ ...prev, [clientId]: data.users || [] })))
      .catch(() => setAssignedEmployeesByClient((prev) => ({ ...prev, [clientId]: [] })));
  }, [activeTab, clientId]);

  useEffect(() => {
    if (!currentUser || !hasApi()) return;
    const userTz = currentUser.work_timezone || 'Asia/Kolkata';
    api.myClockStatus(undefined, userTz)
      .then((data) => setMyClockStatus(data))
      .catch(() => setMyClockStatus(null));
  }, [currentUser]);

  const weekOptions = useMemo(
    () => Array.from({ length: MAX_ISO_WEEKS }, (_, i) => ({ value: i + 1, label: `Week ${i + 1}` })),
    []
  );

  const resolvedClients = useMemo(
    () => (hasApi() && apiClients.length ? apiClients : CLIENTS),
    [apiClients]
  );

  const userDeptMap = useMemo(() => {
    const map = {};
    allUsers.forEach((u) => { if (u.department_id) map[u.id] = u.department_id; });
    return map;
  }, [allUsers]);

  const userDeptNameMap = useMemo(() => {
    const map = {};
    allUsers.forEach((u) => { if (u.department_name) map[u.id] = u.department_name; });
    return map;
  }, [allUsers]);

  const shiftRowsForTable = useMemo(() => {
    if (!hasApi()) return null;
    const adminIds = new Set((allUsers || []).filter((u) => u.role === 'admin').map((u) => u.id));
    const allApiRows = buildShiftRowsFromApi(apiShifts, { searchQuery, clientId: clientId || null, today: dateFrom || undefined, adminIds });

    // If we have shift data from the API, use it — but also include employees without shifts
    if (allApiRows.length > 0) {
      let rows = allApiRows.map((r) => ({
        ...r,
        department_name: r.department_name || userDeptNameMap[r.employeeId] || null,
        department_id: r.department_id || userDeptMap[r.employeeId] || null,
        client_names: userClientMap[r.employeeId] || null,
      }));
      // Merge in active employees who have no shift assignment for this date
      const shiftEmployeeIds = new Set(rows.map((r) => r.employeeId));
      const usersToCheck = clientId
        ? (assignedEmployeesByClient[clientId] || [])
        : allUsers;
      usersToCheck.forEach((u) => {
        if (!shiftEmployeeIds.has(u.id)) {
          rows.push({
            employeeId: u.id,
            employeeName: u.name,
            shiftTime: '\u2014',
            status: 'current_not_logged_in',
            loginTime: '\u2014',
            logoutTime: '\u2014',
            client_id: u.client_id || clientId || null,
            department_id: u.department_id || userDeptMap[u.id] || null,
            department_name: u.department_name || userDeptNameMap[u.id] || null,
            client_names: userClientMap[u.id] || null,
          });
        }
      });
      const q = (searchQuery || '').trim().toLowerCase();
      if (q) rows = rows.filter((r) => (r.employeeName || '').toLowerCase().includes(q));
      if (selectedDepartment) {
        rows = rows.filter((r) => r.department_id === selectedDepartment);
      }
      return rows;
    }

    // No shift data — build rows from real users (allUsers or assigned employees)
    let userList = [];

    if (clientId) {
      // If a client is selected, use assigned employees for that client
      userList = assignedEmployeesByClient[clientId] || [];
    } else if (allUsers.length > 0) {
      // No client filter — show all real users from the database
      userList = allUsers;
    }

    if (userList.length > 0) {
      const q = (searchQuery || '').trim().toLowerCase();
      let list = [...userList];
      if (q) list = list.filter((u) => (u.name || '').toLowerCase().includes(q));
      if (selectedDepartment) list = list.filter((u) => (u.department_id || userDeptMap[u.id]) === selectedDepartment);
      return list.map((u) => ({
        employeeId: u.id,
        employeeName: u.name,
        shiftTime: '\u2014',
        status: 'not_current',
        loginTime: '\u2014',
        logoutTime: '\u2014',
        client_id: u.client_id || clientId || null,
        department_id: u.department_id || null,
        department_name: u.department_name || userDeptNameMap[u.id] || null,
        client_names: userClientMap[u.id] || null,
      }));
    }

    // When the API is available but users haven't loaded yet, return an empty
    // list so counts stay blank until real data arrives (prevents flicker from
    // the presentation mock data flashing during initial load).
    if (hasApi()) return [];

    // Fallback to presentation mock data only if no real users available (no API)
    const q = (searchQuery || '').trim().toLowerCase();
    let rows = q
      ? PRESENTATION_SHIFT_ROWS.filter((r) => r.employeeName.toLowerCase().includes(q))
      : PRESENTATION_SHIFT_ROWS;
    if (selectedDepartment) {
      rows = rows.filter((r) => userDeptMap[r.employeeId] === selectedDepartment);
    }
    return rows;
  }, [apiShifts, searchQuery, clientId, assignedEmployeesByClient, allUsers, selectedDepartment, userDeptMap, userDeptNameMap, userClientMap]);

  const showFilters = activeTab === 'team' && currentUser?.type !== 'employee' && currentUser?.type !== 'team_lead';

  const handleLogin = useCallback((user) => {
    setCurrentUser(user);
    setActiveTab('dashboard');
  }, []);

  // Determine which department is selected (for conditional client filter)
  const selectedDeptName = useMemo(() => {
    if (!selectedDepartment) return '';
    const dept = departments.find((d) => d.id === selectedDepartment);
    return dept?.name || '';
  }, [selectedDepartment, departments]);

  // Filter clients based on department selection
  const filteredClients = useMemo(() => {
    // Only show client filter when Solar dept is selected or no dept filter
    if (selectedDeptName && selectedDeptName.toLowerCase() !== 'solar') return [];
    return resolvedClients;
  }, [resolvedClients, selectedDeptName]);

  const refreshShifts = useCallback(async () => {
    if (!hasApi() || !currentUser) return;
    try {
      const params = { client_id: clientId || undefined };
      if (dateFrom && dateTo && dateFrom <= dateTo) {
        params.from = dateFrom;
        params.to = dateTo;
      } else {
        params.week = week;
        params.year = new Date().getFullYear();
      }
      const data = await api.shifts(params);
      setApiShifts(data.shifts || []);
    } catch {}
  }, [currentUser, week, dateFrom, dateTo, clientId]);

  const refreshClockStatus = useCallback(async () => {
    if (!hasApi() || !currentUser) return;
    try {
      const userTimezone = currentUser.work_timezone || 'Asia/Kolkata';
      const status = await api.myClockStatus(undefined, userTimezone);
      setMyClockStatus(status);
      const year = new Date().getFullYear();
      const data = await api.shifts({ week, year, client_id: clientId || undefined });
      setApiShifts(data.shifts || []);
      showToast('Clocked in successfully');
    } catch {}
  }, [currentUser, week, clientId, showToast]);

  const handleClockIn = useCallback(async (employeeId) => {
    if (hasApi() && currentUser?.id === employeeId) {
      // EmployeeView now handles the actual API call to catch 403 errors.
      // This callback is used as a success handler to refresh state.
      await refreshClockStatus();
      return;
    }
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
    setClockedInEmployeeIds((prev) => new Set([...prev, employeeId]));
    setClockedInTimes((prev) => ({ ...prev, [employeeId]: timeStr }));
    showToast('Clocked in successfully');
  }, [currentUser?.id, refreshClockStatus, showToast]);

  const handleClockOut = useCallback(async (employeeId) => {
    if (hasApi() && currentUser?.id === employeeId) {
      try {
        const userTimezone = currentUser.work_timezone || 'Asia/Kolkata';
        await api.clockOut(null, userTimezone);
        const status = await api.myClockStatus(undefined, userTimezone);
        setMyClockStatus(status);
        const year = new Date().getFullYear();
        const data = await api.shifts({ week, year, client_id: clientId || undefined });
        setApiShifts(data.shifts || []);
        showToast('Clocked out successfully');
      } catch (e) {
        showToast(e.message || 'Failed to clock out', 'error');
      }
      return;
    }
    // Admin/manager/TL clocking out another employee
    if (hasApi()) {
      try {
        await api.adminClockOut(employeeId);
        const year = new Date().getFullYear();
        const data = await api.shifts({ week, year, client_id: clientId || undefined });
        setApiShifts(data.shifts || []);
        showToast('Clocked out successfully');
      } catch (e) {
        showToast(typeof e.data?.error === 'string' ? e.data.error : (e.message || 'Failed to clock out'), 'error');
      }
      return;
    }
    setClockedInEmployeeIds((prev) => {
      const next = new Set(prev);
      next.delete(employeeId);
      return next;
    });
    setClockedInTimes((prev) => {
      const next = { ...prev };
      delete next[employeeId];
      return next;
    });
    showToast('Clocked out successfully');
  }, [currentUser?.id, week, clientId, showToast]);

  const handleLeaveRequest = useCallback(async (employeeId, employeeName, leaveClientId, leaveDate, reason, endDate, fromSession, toSession, leaveType) => {
    if (hasApi()) {
      try {
        const startD = leaveDate;
        const endD = endDate || leaveDate;
        const start = new Date(startD + 'T00:00:00');
        const end = new Date(endD + 'T00:00:00');
        const fullDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
        const fs = fromSession || 1;
        const ts = toSession || 2;
        let totalDays;
        if (fullDays === 1) {
          // Same day: session 1 to 1 = 0.5, session 2 to 2 = 0.5, session 1 to 2 = 1
          totalDays = fs === ts ? 0.5 : 1;
        } else {
          // Multi-day: subtract 0.5 if starting from session 2, subtract 0.5 if ending at session 1
          totalDays = fullDays - (fs === 2 ? 0.5 : 0) - (ts === 1 ? 0.5 : 0);
        }
        await api.leaveRequests.create({
          start_date: startD,
          end_date: endD,
          total_days: totalDays,
          leave_type: leaveType || 'casual',
          reason: reason || undefined,
          start_session: fs,
          end_session: ts,
        });
        fetchLeaveRequests();
        showToast('Leave request submitted');
      } catch (e) {
        if (e.status !== 401) {
          const msg = typeof (e.data?.error) === 'string' ? e.data.error : (e.message || 'Request failed');
          setApiError(msg);
          showToast(msg, 'error');
        }
      }
      return;
    }
    const teamLeadId = getTeamLeadIdForEmployee(employeeId);
    const managerId = teamLeadId ? getManagerIdForTeamLead(teamLeadId) : null;
    setLeaveRequests((prev) => [...prev, {
      id: `lr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      employeeId,
      employeeName,
      clientId: leaveClientId,
      teamLeadId,
      managerId,
      leaveDate,
      start_date: leaveDate,
      end_date: endDate || leaveDate,
      total_days: 1,
      reason,
      leave_type: leaveType || 'casual',
      status: LEAVE_STATUS.PENDING_TEAM_LEAD,
      requestedAt: new Date().toISOString(),
      approvalChain: [],
    }]);
    showToast('Leave request submitted');
  }, [fetchLeaveRequests, showToast]);

  const handleApproveLeave = useCallback(async (requestId) => {
    if (hasApi()) {
      try {
        await api.leaveRequests.approve(requestId);
        fetchLeaveRequests();
        showToast('Leave approved');
      } catch {}
      return;
    }
    const user = currentUser;
    if (!user) return;
    const now = new Date().toISOString();
    const step = { userId: user.id, userName: user.name, role: user.type, approvedAt: now };
    setLeaveRequests((prev) =>
      prev.map((r) => {
        if (r.id !== requestId) return r;
        const chain = [...(r.approvalChain || []), step];
        if (r.status === LEAVE_STATUS.PENDING_TEAM_LEAD && user.type === 'team_lead') return { ...r, status: LEAVE_STATUS.PENDING_MANAGERS, approvalChain: chain };
        if (r.status === LEAVE_STATUS.PENDING_MANAGERS && user.type === 'manager') return { ...r, status: LEAVE_STATUS.PENDING_CEO, approvalChain: chain };
        if (r.status === LEAVE_STATUS.PENDING_CEO && user.type === 'admin') return { ...r, status: LEAVE_STATUS.APPROVED, approvalChain: chain };
        return r;
      })
    );
    showToast('Leave approved');
  }, [currentUser, fetchLeaveRequests, showToast]);

  const handleApproveShiftChange = useCallback(async (requestId) => {
    if (hasApi()) {
      try {
        await api.shiftChanges.approve(requestId);
        fetchShiftChangeRequests();
        showToast('Shift change approved');
      } catch (e) {
        showToast(typeof e.data?.error === 'string' ? e.data.error : (e.message || 'Failed to approve'), 'error');
      }
    }
  }, [fetchShiftChangeRequests, showToast]);

  const handleRejectShiftChange = useCallback(async (requestId) => {
    if (hasApi()) {
      try {
        await api.shiftChanges.reject(requestId);
        fetchShiftChangeRequests();
        showToast('Shift change rejected', 'error');
      } catch (e) {
        showToast(typeof e.data?.error === 'string' ? e.data.error : (e.message || 'Failed to reject'), 'error');
      }
    }
  }, [fetchShiftChangeRequests, showToast]);

  const handleRejectLeave = useCallback(async (requestId, notes) => {
    if (hasApi()) {
      try {
        await api.leaveRequests.reject(requestId, notes ? { notes } : {});
        fetchLeaveRequests();
        showToast('Leave rejected', 'error');
      } catch {}
      return;
    }
    const user = currentUser;
    setLeaveRequests((prev) =>
      prev.map((r) =>
        r.id === requestId ? { ...r, status: LEAVE_STATUS.REJECTED, rejectedBy: user ? { userId: user.id, userName: user.name } : null, rejectedAt: new Date().toISOString() } : r
      )
    );
    showToast('Leave rejected', 'error');
  }, [currentUser, fetchLeaveRequests, showToast]);

  const handleAcknowledgeLeave = useCallback(async (requestId) => {
    if (hasApi()) {
      try {
        await api.leaveRequests.acknowledge(requestId);
        fetchLeaveRequests();
        showToast('Leave acknowledged');
      } catch {}
      return;
    }
    // Mock fallback: just mark as acknowledged locally
    setLeaveRequests((prev) =>
      prev.map((r) =>
        r.id === requestId ? { ...r, acknowledgedBy: currentUser?.id, acknowledgedAt: new Date().toISOString() } : r
      )
    );
    showToast('Leave acknowledged');
  }, [currentUser, fetchLeaveRequests, showToast]);

  const handleCancelLeave = useCallback(async (requestId) => {
    if (hasApi()) {
      try {
        await api.leaveRequests.cancel(requestId);
        fetchLeaveRequests();
        showToast('Leave request cancelled');
      } catch (e) {
        if (e.status !== 401) {
          showToast(typeof e.data?.error === 'string' ? e.data.error : (e.message || 'Failed to cancel'), 'error');
        }
      }
    }
  }, [fetchLeaveRequests, showToast]);

  const handleSplitLeave = useCallback(async (requestId, excludeDates) => {
    if (hasApi()) {
      try {
        await api.leaveRequests.split(requestId, excludeDates);
        fetchLeaveRequests();
        showToast('Leave request updated');
      } catch (e) {
        if (e.status !== 401) {
          showToast(typeof e.data?.error === 'string' ? e.data.error : (e.message || 'Failed to update'), 'error');
        }
      }
    }
  }, [fetchLeaveRequests, showToast]);

  const pendingLeaveCount = (() => {
    if (!currentUser || !leaveRequests) return 0;
    const userId = currentUser.id;
    const type = currentUser.type;
    const leaveCount = leaveRequests.filter((r) => {
      if (r.employeeId === userId) return false;
      if ((r.approvalChain || []).some((a) => a.userId === userId)) return false;
      if (type === 'team_lead') return r.status === 'pending_team_lead';
      if (type === 'manager') return r.status === 'pending_managers';
      if (type === 'admin') return r.status === 'pending_ceo';
      return false;
    }).length;
    const unacknowledgedCount = type === 'admin'
      ? leaveRequests.filter((r) => r.status === 'approved' && !r.acknowledgedBy && r.employeeId !== userId).length
      : 0;
    const shiftChangeCount = (type === 'team_lead' || type === 'manager' || type === 'admin')
      ? shiftChangeRequests.filter((r) => {
          if (r.user_id === userId) return false;
          if ((r.approval_chain || []).some((a) => a.user_id === userId)) return false;
          // Check for new pending statuses (pending_team_lead, pending_managers)
          const st = r.status || '';
          if (type === 'team_lead') return st === 'pending_team_lead';
          if (type === 'manager') return st === 'pending_managers';
          if (type === 'admin') return st === 'pending_ceo';
          return false;
        }).length
      : 0;
    return leaveCount + unacknowledgedCount + shiftChangeCount + adminAlerts.length + autoLogoutNotices.length;
  })();

  const handleDismissAlert = useCallback(async (alertId) => {
    try {
      await api.adminAlerts.markRead(alertId);
      setAdminAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (e) { /* ignore */ }
  }, []);

  const handleDismissAutoLogout = useCallback(async (shiftDate) => {
    try {
      await api.dismissAutoLogoutNotice(shiftDate);
    } catch (e) { /* ignore */ }
    setAutoLogoutNotices((prev) => prev.filter((n) => n.shift_date !== shiftDate));
  }, []);

  const isClockedInFromApi = hasApi() && myClockStatus?.clocked_in === true;
  const clockedInAtRaw = hasApi() ? (myClockStatus?.clocked_in_at || null) : null;
  const clockedInAtFromApi = hasApi() && myClockStatus?.clocked_in_at
    ? new Date(myClockStatus.clocked_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: resolveTimezone(currentUser?.work_timezone) })
    : null;

  // Build visible navigation items based on user role (filters group children too)
  const visibleNavItems = useMemo(() => {
    if (!currentUser) return [];
    const role = currentUser.type;
    return NAV_ITEMS
      .filter((item) => item.roles.includes(role))
      .map((item) => {
        if (item.group && item.children) {
          return { ...item, children: item.children.filter((c) => c.roles.includes(role)) };
        }
        return item;
      })
      .filter((item) => !(item.group && item.children.length === 0));
  }, [currentUser]);

  // Set of tab IDs the current user is allowed to access (flat, includes group children)
  const allowedTabIds = useMemo(() => {
    const set = new Set();
    visibleNavItems.forEach((item) => {
      if (item.divider) return;
      if (item.group) {
        item.children.forEach((c) => set.add(c.id));
      } else {
        set.add(item.id);
      }
    });
    // user-management is accessed via RightPanel, not sidebar nav
    if (currentUser?.type !== 'employee') {
      set.add('user-management');
    }
    return set;
  }, [visibleNavItems, currentUser]);

  const handleTabClick = useCallback((tabId) => {
    // If the user doesn't have access to the requested tab, redirect to dashboard
    if (!allowedTabIds.has(tabId)) {
      setActiveTab('dashboard');
      setSidebarOpen(false);
      return;
    }
    setActiveTab(tabId);
    setSidebarOpen(false);
  }, [allowedTabIds, setActiveTab]);

  // Auto-redirect if activeTab (e.g. from URL hash) isn't allowed for the current user
  useEffect(() => {
    if (!currentUser) return;
    if (activeTab && !allowedTabIds.has(activeTab)) {
      setActiveTab('dashboard');
    }
  }, [activeTab, allowedTabIds, currentUser, setActiveTab]);

  // Track which nav groups are expanded (default: expand any group whose child is active)
  const [expandedGroups, setExpandedGroups] = useState(() => {
    try {
      const raw = localStorage.getItem('ags_nav_groups');
      return raw ? JSON.parse(raw) : { hr: false };
    } catch { return { hr: false }; }
  });
  useEffect(() => {
    try { localStorage.setItem('ags_nav_groups', JSON.stringify(expandedGroups)); } catch {}
  }, [expandedGroups]);
  // Auto-expand a group if its child is the active tab
  useEffect(() => {
    const grp = NAV_ITEMS.find((it) => it.group && it.children?.some((c) => c.id === activeTab));
    if (grp && !expandedGroups[grp.id]) {
      setExpandedGroups((prev) => ({ ...prev, [grp.id]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  if (ssoLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mb-4"></div>
          <p className="text-gray-600">Signing in from Suite...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-white">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-brand focus:text-white focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-60'} w-60 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 flex flex-col transform transition-all duration-300 ease-in-out lg:relative lg:translate-x-0 lg:z-auto lg:flex-shrink-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className={`border-b border-gray-200 dark:border-slate-700 flex items-center ${sidebarCollapsed ? 'lg:justify-center p-3' : 'justify-between p-4'}`}>
          <div className={`flex flex-1 items-center min-w-0 ${sidebarCollapsed ? 'lg:justify-start' : 'justify-center'}`}>
            <img src="/leftpanel.png" alt="AGS Logo" className="h-12 w-auto object-contain flex-shrink-0" />
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className={`lg:hidden p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400 ${sidebarCollapsed ? 'hidden' : ''}`}
            aria-label="Close sidebar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Collapse toggle (desktop only) */}
        <button
          type="button"
          onClick={() => setSidebarCollapsed((c) => !c)}
          className="hidden lg:flex absolute -right-3 top-20 w-6 h-6 rounded-full items-center justify-center shadow z-10 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-600"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg className={`w-4 h-4 transition-transform duration-300 ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <nav className={`flex-1 py-2 overflow-y-auto overflow-x-hidden ${sidebarCollapsed ? 'lg:px-0' : 'px-2'}`}>
          {visibleNavItems.map((item) => {
            if (item.divider) {
              return <div key={item.id} className={`my-2 border-t border-gray-200 dark:border-slate-700 ${sidebarCollapsed ? 'lg:mx-2' : 'mx-2'}`} />;
            }

            // Group header (e.g. HR) with collapsible children
            if (item.group) {
              const isExpanded = !!expandedGroups[item.id];
              const isGroupActive = item.children.some((c) => c.id === activeTab);
              return (
                <div key={item.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedGroups((p) => ({ ...p, [item.id]: !p[item.id] }))}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={`w-full text-left text-sm font-medium transition-all flex items-center gap-2.5 border-l-4 ${
                      sidebarCollapsed ? 'lg:flex-col lg:items-center lg:gap-1 lg:py-3 lg:px-2 lg:text-[10px] px-3 py-2 rounded-lg' : 'px-3 py-2 rounded-lg'
                    } ${
                      isGroupActive
                        ? 'bg-brand/10 border-brand text-brand'
                        : 'border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-white'
                    }`}
                    aria-expanded={isExpanded}
                  >
                    <span className={`flex-shrink-0 ${isGroupActive ? 'text-brand' : ''}`}>{ICONS[item.icon] || null}</span>
                    <span className={`${sidebarCollapsed ? 'lg:text-center lg:leading-tight lg:truncate lg:w-full' : ''} truncate`}>{item.label}</span>
                    <svg className={`${sidebarCollapsed ? 'lg:hidden' : ''} ml-auto w-4 h-4 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {isExpanded && item.children.map((child) => {
                    const isChildActive = activeTab === child.id;
                    return (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => handleTabClick(child.id)}
                        title={sidebarCollapsed ? child.label : undefined}
                        className={`w-full text-left text-sm font-medium transition-all flex items-center gap-2.5 border-l-4 ${
                          sidebarCollapsed
                            ? 'lg:flex-col lg:items-center lg:gap-1 lg:py-3 lg:px-2 lg:text-[10px] pl-8 pr-3 py-2 rounded-lg'
                            : 'pl-8 pr-3 py-2 rounded-lg text-[13px]'
                        } ${
                          isChildActive
                            ? 'bg-brand/10 border-brand text-brand'
                            : 'border-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-white'
                        }`}
                        aria-current={isChildActive ? 'page' : undefined}
                      >
                        <span className={`flex-shrink-0 ${isChildActive ? 'text-brand' : ''}`}>{ICONS[child.icon] || null}</span>
                        <span className={`${sidebarCollapsed ? 'lg:text-center lg:leading-tight lg:truncate lg:w-full' : ''} truncate`}>{child.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            }

            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleTabClick(item.id)}
                title={sidebarCollapsed ? item.label : undefined}
                className={`w-full text-left text-sm font-medium transition-all flex items-center gap-2.5 border-l-4 ${
                  sidebarCollapsed ? 'lg:flex-col lg:items-center lg:gap-1 lg:py-3 lg:px-2 lg:text-[10px] px-3 py-2 rounded-lg' : 'px-3 py-2 rounded-lg'
                } ${
                  isActive
                    ? 'bg-brand/10 border-brand text-brand'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-white'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className={`flex-shrink-0 ${isActive ? 'text-brand' : ''}`}>{ICONS[item.icon] || null}</span>
                <span className={`${sidebarCollapsed ? 'lg:text-center lg:leading-tight lg:truncate lg:w-full' : ''} truncate`}>{item.label}</span>
                {item.badge && pendingLeaveCount > 0 && (
                  <span className={`${sidebarCollapsed ? 'lg:absolute lg:top-1 lg:right-1 lg:ml-0' : 'ml-auto'} min-w-[20px] h-5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center px-1.5`}>
                    {pendingLeaveCount > 99 ? '99+' : pendingLeaveCount}
                  </span>
                )}
              </button>
            );
          })}
          {/* AI Assistant */}
          <div className={`pt-2 mt-2 border-t border-gray-200 dark:border-slate-700 ${sidebarCollapsed ? 'lg:mx-0' : ''}`}>
            <button
              type="button"
              onClick={() => { setAIAssistantOpen(true); setSidebarOpen(false); }}
              title={sidebarCollapsed ? 'AI Assistant' : undefined}
              className={`w-full text-left text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center gap-2.5 border-l-4 border-transparent ${
                sidebarCollapsed ? 'lg:flex-col lg:items-center lg:gap-1 lg:py-3 lg:px-2 lg:text-[10px] px-3 py-2 rounded-lg' : 'px-3 py-2 rounded-lg'
              }`}
            >
              <span className="flex-shrink-0">{ICONS.ai}</span>
              <span className={`${sidebarCollapsed ? 'lg:text-center lg:leading-tight lg:truncate lg:w-full' : ''} truncate`}>AI Assistant</span>
              <span className={`${sidebarCollapsed ? 'lg:hidden' : 'ml-auto'} text-[10px] px-1.5 py-0.5 rounded bg-brand/10 text-brand font-semibold`}>AI</span>
            </button>
          </div>
        </nav>
        <div className={`border-t border-gray-200 dark:border-slate-700 ${sidebarCollapsed ? 'lg:p-2 p-3' : 'p-3'}`}>
          <div className={`flex items-center gap-2 px-1 ${sidebarCollapsed ? 'lg:justify-center lg:px-0' : ''}`}>
            <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center text-brand text-xs font-bold flex-shrink-0">
              {(currentUser?.name || '?')[0].toUpperCase()}
            </div>
            <div className={`min-w-0 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{currentUser?.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate capitalize">{currentUser?.role || currentUser?.type}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0" id="main-content">
        <Header
          title="AGS Workforce Portal"
          subtitle="Workforce Management and Employee Scheduling"
          onOpenRightPanel={() => setRightPanelOpen(true)}
          onOpenNotifications={() => setNotificationsOpen(true)}
          notificationCount={pendingLeaveCount}
          onMenuToggle={() => setSidebarOpen(true)}
        />
        {showFilters && (
          <FilterBar
            week={week}
            weekOptions={weekOptions}
            dateFrom={dateFrom}
            dateTo={dateTo}
            clientId={clientId}
            clients={filteredClients}
            searchQuery={searchQuery}
            onWeekChange={setWeek}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            onClientChange={setClientId}
            onSearchChange={setSearchQuery}
            departments={departments}
            departmentId={selectedDepartment}
            onDepartmentChange={setSelectedDepartment}
            showClientFilter={!selectedDeptName || selectedDeptName.toLowerCase() === 'solar'}
          />
        )}

        <div className="flex-1 overflow-auto p-4 sm:p-6">
          {activeTab === 'dashboard' && (
            <ErrorBoundary inline fallbackMessage="Could not load Dashboard. Please try again.">
              <DashboardView
                isDark={isDark}
                currentUser={currentUser}
                onNavigate={(tab) => {
                  const remap = { 'employee-view': 'my-work', 'leaves': 'my-work', 'leave-approvals': 'approvals', 'food-cab': 'allowances' };
                  handleTabClick(remap[tab] || tab);
                }}
                leaveRequests={leaveRequests}
                allLeaveRequests={allLeaveRequests}
                onApprove={handleApproveLeave}
                onReject={handleRejectLeave}
                myClockStatus={myClockStatus}
                pendingLeaveCount={pendingLeaveCount}
                allUsers={allUsers}
                shiftChangeRequests={shiftChangeRequests}
                allShiftChangeRequests={allShiftChangeRequests}
                compOffSummary={compOffSummary}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'celebrations' && (
            <ErrorBoundary inline fallbackMessage="Could not load Celebrations. Please try again.">
              <CelebrationsView isDark={isDark} currentUser={currentUser} />
            </ErrorBoundary>
          )}
          {activeTab === 'team' && (
            <ErrorBoundary inline fallbackMessage="Could not load Team view. Please try again.">
              <TeamView
                isDark={isDark}
                currentUser={currentUser}
                allUsers={allUsers}
                showToast={showToast}
                clients={resolvedClients}
                departments={departments}
                leaveRequests={leaveRequests}
                week={week}
                clientId={clientId}
                searchQuery={searchQuery}
                onEmployeeClick={setSelectedEmployee}
                clockedInEmployeeIds={clockedInEmployeeIds}
                clockedInTimes={clockedInTimes}
                shiftRows={shiftRowsForTable}
                apiLoading={apiLoading}
                onRefreshShifts={refreshShifts}
                apiError={apiError}
                setApiError={setApiError}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'schedules' && (
            <ErrorBoundary inline fallbackMessage="Could not load Schedules. Please try again.">
              <SchedulesView
                clients={resolvedClients}
                isDark={isDark}
                defaultBuildMode={false}
                showUpload={true}
                allUsers={allUsers}
                departments={departments}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'my-work' && (
            <ErrorBoundary inline fallbackMessage="Could not load My Work. Please try again.">
              <MyWorkView
                isDark={isDark}
                currentUser={currentUser}
                clockedInAt={hasApi() ? clockedInAtFromApi : clockedInTimes[currentUser.id]}
                clockedInAtRaw={clockedInAtRaw}
                onClockIn={() => handleClockIn(currentUser.id)}
                onClockOut={() => handleClockOut(currentUser.id)}
                isClockedIn={hasApi() ? isClockedInFromApi : clockedInEmployeeIds.has(currentUser.id)}
                onLeaveRequest={handleLeaveRequest}
                clients={resolvedClients}
                leaveRequests={leaveRequests}
                onApprove={handleApproveLeave}
                onReject={handleRejectLeave}
                onCancelLeave={handleCancelLeave}
                onSplitLeave={handleSplitLeave}
                apiShifts={apiShifts}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'approvals' && (
            <ErrorBoundary inline fallbackMessage="Could not load Approvals. Please try again.">
              <LeavesView
                leaveRequests={leaveRequests}
                allLeaveRequests={allLeaveRequests}
                currentUser={currentUser}
                onApprove={handleApproveLeave}
                onReject={handleRejectLeave}
                isDark={isDark}
                approvalsOnly={true}
                shiftChangeRequests={shiftChangeRequests}
                allShiftChangeRequests={allShiftChangeRequests}
                onApproveShiftChange={handleApproveShiftChange}
                onRejectShiftChange={handleRejectShiftChange}
                compOffSummary={compOffSummary}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'asset-management' && (
            <ErrorBoundary inline fallbackMessage="Could not load Asset Management. Please try again.">
              <AssetManagementView
                isDark={isDark}
                currentUser={currentUser}
                showToast={showToast}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'allowances' && (
            <ErrorBoundary inline fallbackMessage="Could not load Allowances. Please try again.">
              <FoodCabView
                isDark={isDark}
                currentUser={currentUser}
                showToast={showToast}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'budgeting' && (
            <ErrorBoundary inline fallbackMessage="Could not load Budgeting. Please try again.">
              <BudgetingView
                isDark={isDark}
                currentUser={currentUser}
                showToast={showToast}
                departments={departments}
                clients={resolvedClients}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'attendance' && (
            <ErrorBoundary inline fallbackMessage="Could not load Attendance. Please try again.">
              <AttendanceCalendar
                isDark={isDark}
                currentUser={currentUser}
                onNavigate={(tab) => handleTabClick(tab)}
                showToast={showToast}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'reports' && (
            <ErrorBoundary inline fallbackMessage="Could not load Reports. Please try again.">
              <ReportsView
                isDark={isDark}
                clients={resolvedClients}
                showToast={showToast}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'comp-off' && (
            <ErrorBoundary inline fallbackMessage="Could not load Comp-Off. Please try again.">
              <CompOffView
                isDark={isDark}
                currentUser={currentUser}
                showToast={showToast}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'dinner-tracker' && (
            <ErrorBoundary inline fallbackMessage="Could not load Dinner Tracker. Please try again.">
              <DinnerTrackingView
                isDark={isDark}
                currentUser={currentUser}
                allUsers={allUsers}
                showToast={showToast}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'cab-drops' && (
            <ErrorBoundary inline fallbackMessage="Could not load Cab Drops. Please try again.">
              <CabDropsView
                isDark={isDark}
                currentUser={currentUser}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'leave-report' && (
            <ErrorBoundary inline fallbackMessage="Could not load Leave Report. Please try again.">
              <LeaveReportView
                isDark={isDark}
                currentUser={currentUser}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'ideas' && (
            <ErrorBoundary inline fallbackMessage="Could not load Ideas. Please try again.">
              <IdeasView
                isDark={isDark}
                currentUser={currentUser}
                showToast={showToast}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'user-management' && currentUser?.type !== 'employee' && (
            <ErrorBoundary inline fallbackMessage="Could not load User Management. Please try again.">
              <UserManagementView
                isDark={isDark}
                currentUser={currentUser}
                clients={resolvedClients}
                departments={departments}
                showToast={showToast}
                allUsers={allUsers}
                onRefreshUsers={() => {
                  api.users().then((data) => setAllUsers(data.users || [])).catch(() => {});
                  api.departments().then((data) => setDepartments(data.departments || [])).catch(() => {});
                  api.clients().then((d) => setApiClients(d.clients || [])).catch(() => {});
                }}
              />
            </ErrorBoundary>
          )}
        </div>
      </main>

      {/* Modals and panels */}
      {selectedEmployee && (
        <EmployeeModal
          employee={selectedEmployee}
          onClose={() => setSelectedEmployee(null)}
          isDark={isDark}
          onLeaveRequest={handleLeaveRequest}
          clients={resolvedClients}
        />
      )}
      <RightPanel
        isOpen={rightPanelOpen}
        onClose={() => setRightPanelOpen(false)}
        isDark={isDark}
        currentUser={currentUser}
        onThemeToggle={(dark) => setIsDark(dark)}
        onChangelogClick={() => setChangelogOpen(true)}
        onUserManagementClick={() => setUserMgmtOpen(true)}
        onAddClientClick={currentUser && (currentUser.type === 'admin' || currentUser.type === 'manager') ? () => setAddClientOpen(true) : undefined}
        onLogout={handleLogout}
        onNavigate={(tab) => { setActiveTab(tab); setRightPanelOpen(false); }}
      />
      {changelogOpen && <ChangelogModal onClose={() => setChangelogOpen(false)} isDark={isDark} />}
      {userMgmtOpen && (
        <UserManagementModal
          onClose={() => setUserMgmtOpen(false)}
          isDark={isDark}
          currentUser={currentUser}
          onAddMember={() => setAddMemberOpen(true)}
          clients={resolvedClients}
          refreshTrigger={userListRefreshKey}
        />
      )}
      {addMemberOpen && (
        <AddMemberModal
          onClose={() => setAddMemberOpen(false)}
          onSaved={() => { setAddMemberOpen(false); setUserListRefreshKey((k) => k + 1); api.users().then((data) => setAllUsers(data.users || [])).catch(() => {}); showToast('Member added'); }}
          isDark={isDark}
          clients={resolvedClients}
          departments={departments}
        />
      )}
      {addClientOpen && hasApi() && (
        <AddClientModal
          onClose={() => setAddClientOpen(false)}
          onSaved={() => { api.clients().then((d) => setApiClients(d.clients || [])); setAddClientOpen(false); showToast('Client added'); }}
          isDark={isDark}
        />
      )}
      <AIAssistant isOpen={aiAssistantOpen} onClose={() => setAIAssistantOpen(false)} isDark={isDark} />
      <NotificationsPanel
        isOpen={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        leaveRequests={leaveRequests}
        allLeaveRequests={allLeaveRequests}
        currentUser={currentUser}
        onApprove={handleApproveLeave}
        onReject={handleRejectLeave}
        onAcknowledge={handleAcknowledgeLeave}
        shiftChangeRequests={shiftChangeRequests}
        allShiftChangeRequests={allShiftChangeRequests}
        onApproveShiftChange={handleApproveShiftChange}
        onRejectShiftChange={handleRejectShiftChange}
        isDark={isDark}
        compOffSummary={compOffSummary}
        adminAlerts={adminAlerts}
        onDismissAlert={handleDismissAlert}
        autoLogoutNotices={autoLogoutNotices}
        onDismissAutoLogout={handleDismissAutoLogout}
      />

      {toast && (
        <Toast
          key={toast.key}
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
      <CelebrationBanner isDark={isDark} />
    </div>
  );
}
