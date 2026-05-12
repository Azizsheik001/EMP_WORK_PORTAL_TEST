// Clients: Ameresco (Sanjay), Cleanleaf (Arun), Standard Solar & Puresky (Srinivasa)
export const CLIENTS = [
  { id: 'ameresco', name: 'Ameresco', teamLeadId: 'sanjay-gunde' },
  { id: 'cleanleaf', name: 'Cleanleaf', teamLeadId: 'arun-pandian' },
  { id: 'standard-solar', name: 'Standard Solar', teamLeadId: 'srinivasa-krishnan' },
  { id: 'puresky', name: 'Puresky', teamLeadId: 'srinivasa-krishnan' },
];

// Canonical rotational shifts (used for display and nickname normalization)
export const CANONICAL_SHIFTS = [
  '6:00 AM - 2:00 PM',
  '2:00 PM - 10:00 PM',
  '10:00 PM - 6:00 AM',
];

// Nicknames/variations for intelligent scraping (case-insensitive match)
export const SHIFT_ALIASES = {
  '6:00 AM - 2:00 PM': ['6-2', '6:00-2:00', 'morning', 'first shift', '1st shift', 'day', 'am shift', 'early'],
  '2:00 PM - 10:00 PM': ['2-10', '2:00-10:00', 'second shift', '2nd shift', 'evening', 'pm shift', 'afternoon'],
  '10:00 PM - 6:00 AM': ['10-6', '10:00-6:00', 'night', 'third shift', '3rd shift', 'graveyard', 'late', 'night shift'],
};

/** Normalize scraped shift text (handles nicknames, typos, extra spaces) */
export function normalizeShift(raw) {
  if (!raw || typeof raw !== 'string') return CANONICAL_SHIFTS[0];
  const cleaned = raw.trim().toLowerCase();
  for (const [canonical, aliases] of Object.entries(SHIFT_ALIASES)) {
    if (aliases.some((a) => cleaned.includes(a) || cleaned === a)) return canonical;
  }
  // Try to match "6-2" style
  const match = cleaned.match(/(\d{1,2})\s*[-–to]\s*(\d{1,2})/);
  if (match) {
    const [, start, end] = match.map(Number);
    if (start === 6 && end === 2) return CANONICAL_SHIFTS[0];
    if (start === 2 && end === 10) return CANONICAL_SHIFTS[1];
    if (start === 10 && end === 6) return CANONICAL_SHIFTS[2];
  }
  return cleaned ? raw.trim() : CANONICAL_SHIFTS[0];
}

// Role hierarchy: admin (CEO/bosses) > manager > team_lead > employee
// Leave flow: Employee → Team Lead → Manager → Admin (CEO) → Approved

// Mock users with login credentials (email + password)
const MOCK_PASSWORD_HASH = 'mock_only';

export const LOGIN_USERS = [
  { id: 'siva-yarramsetty', name: 'Siva Yarramsetty', role: 'President / Co-founder', email: 'siva@libsysinc.com', _mockAuth: MOCK_PASSWORD_HASH, type: 'admin' },
  { id: 'shree-yerramsetty', name: 'Shree Yerramsetty', role: 'CEO / Co-founder', email: 'shree@libsysinc.com', _mockAuth: MOCK_PASSWORD_HASH, type: 'admin' },
  { id: 'admin-1', name: 'Admin', role: 'Administrator', email: 'admin@libsysinc.com', _mockAuth: MOCK_PASSWORD_HASH, type: 'admin' },
  { id: 'govardhan-kolli', name: 'Govardhan Kolli', role: 'Senior', email: 'govardhan.kolli@libsysinc.com', _mockAuth: MOCK_PASSWORD_HASH, type: 'employee' },
  { id: 'poojith-burra', name: 'Poojith Burra', role: 'Associate', email: 'poojith.burra@libsysinc.com', _mockAuth: MOCK_PASSWORD_HASH, type: 'employee' },
  { id: 'sanjay-gunde', name: 'Sanjay Gunde', role: 'Lead', email: 'sanjay.gunde@libsysinc.com', _mockAuth: MOCK_PASSWORD_HASH, type: 'team_lead' },
  { id: 'arun-pandian', name: 'Arun Pandian', role: 'Lead', email: 'arun.pandian@libsysinc.com', _mockAuth: MOCK_PASSWORD_HASH, type: 'team_lead' },
  { id: 'srinivasa-krishnan', name: 'Srinivasa Krishnan', role: 'Lead', email: 'srinivasa.krishnan@libsysinc.com', _mockAuth: MOCK_PASSWORD_HASH, type: 'team_lead' },
  { id: 'dileep-siriki', name: 'Dileep Siriki', role: 'Manager', email: 'dileep.siriki@libsysinc.com', _mockAuth: MOCK_PASSWORD_HASH, type: 'manager' },
  { id: 'narsimha-karthik', name: 'Narsimha Karthik', role: 'Manager', email: 'narsimha.karthik@libsysinc.com', _mockAuth: MOCK_PASSWORD_HASH, type: 'manager' },
];

export function authenticateUser(email, _password) {
  const user = LOGIN_USERS.find(
    (u) => u.email.toLowerCase() === email.trim().toLowerCase()
  );
  if (!user) return null;
  const { _mockAuth, ...rest } = user;
  return rest;
}

// Legacy: default current user (used when no login flow)
export const CURRENT_USER = LOGIN_USERS[0];

// Employees with onLeaveToday for AI "who is on leave" (mock: use plannedLeaves or this flag)
export const EMPLOYEES = [
  // Ameresco - Sanjay Gunde (team lead)
  { id: 'sanjay-gunde', name: 'Sanjay Gunde', clientId: 'ameresco', role: 'Lead', leavesRemaining: 12, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'govardhan-kolli', name: 'Govardhan Kolli', clientId: 'ameresco', role: 'Senior', leavesRemaining: 10, leavesLast4Weeks: 1, plannedLeaves: ['2025-03-15'], onLeaveToday: true },
  { id: 'poojith-burra', name: 'Poojith Burra', clientId: 'ameresco', role: 'Associate', leavesRemaining: 8, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'revanth-kumar', name: 'Revanth Kumar', clientId: 'ameresco', role: 'Associate', leavesRemaining: 9, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'raghunath-katha', name: 'Raghunath Katha', clientId: 'ameresco', role: 'Associate', leavesRemaining: 7, leavesLast4Weeks: 2, plannedLeaves: [], onLeaveToday: true },
  { id: 'reshma-gurrala', name: 'Reshma Gurrala', clientId: 'ameresco', role: 'Associate', leavesRemaining: 8, leavesLast4Weeks: 0, plannedLeaves: ['2025-03-20'], onLeaveToday: false },
  { id: 'akshay-nandhan', name: 'Akshay Nandhan Kaluvacharla', clientId: 'ameresco', role: 'Associate', leavesRemaining: 6, leavesLast4Weeks: 1, plannedLeaves: [], onLeaveToday: false },
  { id: 'shyamala-nadivinti', name: 'Shyamala Nadivinti', clientId: 'ameresco', role: 'Associate', leavesRemaining: 10, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'anjali-patnaik', name: 'Anjali Patnaik', clientId: 'ameresco', role: 'Associate', leavesRemaining: 8, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'jitendra-satya', name: 'Jitendra Satya Sai', clientId: 'ameresco', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'dhanya-sri', name: 'Dhanya Sri Challagulla', clientId: 'ameresco', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 1, plannedLeaves: [], onLeaveToday: false },
  // Cleanleaf - Arun Pandian (team lead)
  { id: 'arun-pandian', name: 'Arun Pandian', clientId: 'cleanleaf', role: 'Lead', leavesRemaining: 12, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'shanthi-byalla', name: 'Shanthi Byalla', clientId: 'cleanleaf', role: 'Associate', leavesRemaining: 9, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'akhila-sontayana', name: 'Akhila Sontayana', clientId: 'cleanleaf', role: 'Associate', leavesRemaining: 7, leavesLast4Weeks: 1, plannedLeaves: [], onLeaveToday: false },
  { id: 'poojitha-konatham', name: 'Poojitha Konatham', clientId: 'cleanleaf', role: 'Associate', leavesRemaining: 8, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'bharat-guntreddy', name: 'Bharat Guntreddy', clientId: 'cleanleaf', role: 'Associate', leavesRemaining: 6, leavesLast4Weeks: 2, plannedLeaves: ['2025-03-18'], onLeaveToday: true },
  { id: 'preetham-teja', name: 'Preetham Teja Srikande', clientId: 'cleanleaf', role: 'Associate', leavesRemaining: 10, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'ganesh-shanigarapu', name: 'Ganesh Shanigarapu', clientId: 'cleanleaf', role: 'Associate', leavesRemaining: 8, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'surya-raajaani', name: 'Surya Raajaani', clientId: 'cleanleaf', role: 'Associate', leavesRemaining: 7, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'monika-lakshmi', name: 'Monika Lakshmi Kolusu', clientId: 'cleanleaf', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'vidyanand-chataraju', name: 'Vidyanand Chataraju', clientId: 'cleanleaf', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'keerthi-pokuri', name: 'Keerthi Pokuri', clientId: 'cleanleaf', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 1, plannedLeaves: [], onLeaveToday: false },
  // Standard Solar - Srinivasa Krishnan
  { id: 'srinivasa-krishnan', name: 'Srinivasa Krishnan', clientId: 'standard-solar', role: 'Lead', leavesRemaining: 12, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'jayasri-garapti', name: 'Jayasri Garapti', clientId: 'standard-solar', role: 'Senior', leavesRemaining: 10, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'maneesha-vuchidi', name: 'Maneesha Vuchidi', clientId: 'standard-solar', role: 'Senior', leavesRemaining: 9, leavesLast4Weeks: 1, plannedLeaves: [], onLeaveToday: false },
  { id: 'vijay-kumar', name: 'Vijay Kumar', clientId: 'standard-solar', role: 'Solar', leavesRemaining: 8, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'ratna-kumari', name: 'Ratna Kumari Mukkala', clientId: 'standard-solar', role: 'Associate', leavesRemaining: 7, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'pavan-kumar', name: 'Pavan Kumar Madasu', clientId: 'standard-solar', role: 'Associate', leavesRemaining: 8, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'dheeraj-cheripelly', name: 'Dheeraj Cheripelly', clientId: 'standard-solar', role: 'Associate', leavesRemaining: 6, leavesLast4Weeks: 2, plannedLeaves: [], onLeaveToday: false },
  { id: 'roushan-kumar', name: 'Roushan Kumar', clientId: 'standard-solar', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'kushal-mareedu', name: 'Kushal Mareedu', clientId: 'standard-solar', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'shivani-mushini', name: 'Shivani Mushini', clientId: 'standard-solar', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 1, plannedLeaves: [], onLeaveToday: false },
  // Puresky
  { id: 'rakesh-vemula', name: 'Rakesh Vemula', clientId: 'puresky', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'vijay-kumar-kokku', name: 'Vijay Kumar Kokku', clientId: 'puresky', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'mohan-gudde', name: 'Mohan Gudde', clientId: 'puresky', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'kusuma-potlada', name: 'Kusuma Potlada', clientId: 'puresky', role: 'Senior', leavesRemaining: 10, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'dinesh-gadde', name: 'Dinesh Gadde', clientId: 'puresky', role: 'Solar', leavesRemaining: 8, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'pavani-nemala', name: 'Pavani Nemala', clientId: 'puresky', role: 'Associate', leavesRemaining: 7, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'sai-teja-puram', name: 'Sai Teja Puram', clientId: 'puresky', role: 'Associate', leavesRemaining: 8, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'hema-maheswari', name: 'Hema Maheswari', clientId: 'puresky', role: 'Associate', leavesRemaining: 9, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'ranjith-kumar', name: 'Ranjith Kumar', clientId: 'puresky', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'tarun-raj', name: 'Tarun Raj Chityala', clientId: 'puresky', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'geetha-sri', name: 'Geetha Sri Karella', clientId: 'puresky', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'sravani-vasa', name: 'Sravani Vasa', clientId: 'puresky', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'mithra-mogalapu', name: 'Mithra Mogalapu', clientId: 'puresky', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
  { id: 'sri-charan-potti', name: 'Sri Charan Potti', clientId: 'puresky', role: 'Trainee', leavesRemaining: 5, leavesLast4Weeks: 0, plannedLeaves: [], onLeaveToday: false },
];

export function getEmployeesOnLeaveToday() {
  return EMPLOYEES.filter((e) => e.onLeaveToday === true);
}

// Shift status: 'current_logged_in' | 'current_not_logged_in' | 'not_current'
const shiftTimes = [...CANONICAL_SHIFTS];
function randomShift() {
  return shiftTimes[Math.floor(Math.random() * shiftTimes.length)];
}
function randomStatus() {
  const r = Math.random();
  if (r < 0.4) return 'current_logged_in';
  if (r < 0.7) return 'current_not_logged_in';
  return 'not_current';
}
function randomTime() {
  const h = Math.floor(Math.random() * 12) + 6;
  const m = Math.random() < 0.5 ? '00' : '30';
  return `${h}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Mock shift rows for presentation/demo when API has no data */
export const PRESENTATION_SHIFT_ROWS = [
  { employeeId: 'p1', employeeName: 'Alice Johnson', shiftTime: '9:00 AM - 5:00 PM', status: 'not_current', loginTime: '—', logoutTime: '—', client_id: null },
  { employeeId: 'p2', employeeName: 'Bob Williams', shiftTime: '8:00 AM - 4:00 PM', status: 'not_current', loginTime: '7:55 AM', logoutTime: '4:05 PM', client_id: null },
  { employeeId: 'p3', employeeName: 'Carol Davis', shiftTime: '10:00 AM - 6:00 PM', status: 'current_logged_in', loginTime: '9:58 AM', logoutTime: '—', client_id: null },
  { employeeId: 'p4', employeeName: 'David Lee', shiftTime: '1:00 PM - 9:00 PM', status: 'current_logged_in', loginTime: '1:15 PM', logoutTime: '—', client_id: null },
  { employeeId: 'p5', employeeName: 'Emily Rodriguez', shiftTime: '7:30 AM - 3:30 PM', status: 'not_current', loginTime: '7:28 AM', logoutTime: '3:29 PM', client_id: null },
  { employeeId: 'p6', employeeName: 'Sanjay Gunde', shiftTime: '6:00 AM - 2:00 PM', status: 'current_not_logged_in', loginTime: '—', logoutTime: '—', client_id: null },
  { employeeId: 'p7', employeeName: 'Arun Pandian', shiftTime: '2:00 PM - 10:00 PM', status: 'not_current', loginTime: '2:02 PM', logoutTime: '9:58 PM', client_id: null },
  { employeeId: 'p8', employeeName: 'Srinivasa Krishnan', shiftTime: '10:00 PM - 6:00 AM', status: 'not_current', loginTime: '—', logoutTime: '—', client_id: null },
];

export function getShiftRows(weekNum, clientId, searchQuery, clockedInEmployeeIds = new Set(), clockedInTimes = {}) {
  let list = clientId
    ? EMPLOYEES.filter((e) => e.clientId === clientId)
    : [...EMPLOYEES];
  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    list = list.filter((e) => e.name.toLowerCase().includes(q));
  }
  return list.map((emp) => {
    const isClockedIn = clockedInEmployeeIds.has(emp.id);
    const status = isClockedIn ? 'current_logged_in' : randomStatus();
    const shiftTime = randomShift();
    const isCurrent = status.startsWith('current');
    const loginTime = isCurrent && status === 'current_logged_in'
      ? (clockedInTimes[emp.id] || randomTime())
      : '—';
    return {
      employeeId: emp.id,
      employeeName: emp.name,
      shiftTime,
      status,
      loginTime,
      logoutTime: isCurrent && status === 'current_logged_in' ? '—' : (status === 'current_not_logged_in' ? '—' : randomTime()),
    };
  });
}

export function getEmployeeById(id) {
  return EMPLOYEES.find((e) => e.id === id) || null;
}

export function getClientById(id) {
  return CLIENTS.find((c) => c.id === id) || null;
}

export function getEmployeesByClient(clientId) {
  return EMPLOYEES.filter((e) => e.clientId === clientId);
}

// Managers: Dileep (Ameresco, Cleanleaf), Narsimha (Standard Solar, Puresky)
export const TEAM_LEAD_TO_MANAGER = {
  'sanjay-gunde': 'dileep-siriki',
  'arun-pandian': 'dileep-siriki',
  'srinivasa-krishnan': 'narsimha-karthik',
};

export function getTeamLeadIdForEmployee(employeeId) {
  const emp = getEmployeeById(employeeId);
  if (!emp) return null;
  const client = getClientById(emp.clientId);
  return client?.teamLeadId ?? null;
}

export function getManagerIdForTeamLead(teamLeadId) {
  return TEAM_LEAD_TO_MANAGER[teamLeadId] ?? null;
}

export function isTeamLead(userId) {
  return userId in TEAM_LEAD_TO_MANAGER;
}

export function isManager(userId) {
  return ['dileep-siriki', 'narsimha-karthik'].includes(userId);
}

export function isAdmin(userId) {
  return ['admin-1', 'siva-yarramsetty', 'shree-yerramsetty'].includes(userId);
}

// Leave workflow: pending_team_lead → pending_managers → pending_ceo → approved (or rejected at any stage)
export const LEAVE_STATUS = {
  PENDING_TEAM_LEAD: 'pending_team_lead',
  PENDING_MANAGERS: 'pending_managers',
  PENDING_CEO: 'pending_ceo',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

/** Get pending leave requests for a team lead (status = pending_team_lead, not already approved by them) */
export function getPendingRequestsForTeamLead(leaveRequests, teamLeadId) {
  return leaveRequests.filter(
    (r) => r.status === LEAVE_STATUS.PENDING_TEAM_LEAD
      && !(r.approvalChain || []).some((a) => a.userId === teamLeadId)
  );
}

/** Get pending leave requests for a manager (status = pending_managers, not already approved by them) */
export function getPendingRequestsForManager(leaveRequests, managerId) {
  return leaveRequests.filter(
    (r) => r.status === LEAVE_STATUS.PENDING_MANAGERS
      && !(r.approvalChain || []).some((a) => a.userId === managerId)
  );
}

/** Get pending leave requests for admin/CEO (status = pending_ceo) */
export function getPendingRequestsForAdmin(leaveRequests) {
  return leaveRequests.filter((r) => r.status === LEAVE_STATUS.PENDING_CEO);
}

/** Pending requests visible to this user (notifications count and list). Use role (type) when present so API users (UUID ids) work. */
export function getPendingLeaveRequestsForUser(leaveRequests, userIdOrCurrentUser, userType) {
  const userId = typeof userIdOrCurrentUser === 'object' ? userIdOrCurrentUser?.id : userIdOrCurrentUser;
  const type = typeof userIdOrCurrentUser === 'object' ? userIdOrCurrentUser?.type : userType;
  if (type === 'team_lead') return getPendingRequestsForTeamLead(leaveRequests, userId);
  if (type === 'manager') return getPendingRequestsForManager(leaveRequests, userId);
  if (type === 'admin') return getPendingRequestsForAdmin(leaveRequests);
  if (isTeamLead(userId)) return getPendingRequestsForTeamLead(leaveRequests, userId);
  if (isManager(userId)) return getPendingRequestsForManager(leaveRequests, userId);
  if (isAdmin(userId)) return getPendingRequestsForAdmin(leaveRequests);
  return [];
}

export function getApprovedLeaves(leaveRequests) {
  return leaveRequests.filter((r) => r.status === LEAVE_STATUS.APPROVED);
}

export function getMyLeaveRequests(leaveRequests, employeeId) {
  return leaveRequests.filter((r) => r.employeeId === employeeId);
}
