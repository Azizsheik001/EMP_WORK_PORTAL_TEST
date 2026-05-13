/**
 * API client for AGS Workforce backend.
 * In dev: uses same-origin /api (Vite proxies to backend). In production: uses VITE_API_URL.
 */

const getBaseUrl = () => {
  if (import.meta.env.DEV) return '';
  const envUrl = (import.meta.env.VITE_API_URL || '').trim();
  // If VITE_API_URL is literally "/api", return empty string to avoid double /api/api
  if (envUrl === '/api') return '';
  return envUrl.replace(/\\n/g, '').replace(/\s+/g, '').replace(/\/$/, '');
};

export function hasApi() {
  return true; // Assume API is available at /api if not specified
}

export function getToken() {
  try {
    return localStorage.getItem('ags_token') || '';
  } catch {
    return '';
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem('ags_token', token);
    else localStorage.removeItem('ags_token');
  } catch {}
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem('ags_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  try {
    if (user) localStorage.setItem('ags_user', JSON.stringify(user));
    else localStorage.removeItem('ags_user');
  } catch {}
}

let onUnauthorized = null;

export function setOnUnauthorized(cb) {
  onUnauthorized = cb;
}

async function request(path, options = {}) {
  const base = getBaseUrl().replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const token = getToken();

  const isFormData =
    typeof FormData !== 'undefined' && options.body instanceof FormData;

  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    ...options,
    headers,
    body:
      options.body !== undefined
        ? isFormData
          ? options.body
          : typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body)
        : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) {
      onUnauthorized();
    }

    const rawError = data?.error;
    const safeMessage =
      res.status === 401
        ? 'Authentication required. Please log in again.'
        : typeof rawError === 'string'
          ? rawError
          : Array.isArray(rawError)
            ? rawError.map((e) => e.message || String(e)).join(', ')
            : 'Request failed';

    const err = new Error(safeMessage);
    err.status = res.status;

    if (data && typeof data.error !== 'string') {
      data.error = safeMessage;
    }

    err.data = data;
    throw err;
  }

  return data;
}

export const api = {
  get: (path) => request(path, { method: 'GET' }),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' }),

  auth: {
    login: (email, password) => api.post('/api/auth/login', { email, password }),
    logout: () => api.post('/api/auth/logout', {}),
    forgotPassword: (email) => api.post('/api/auth/forgot-password', { email }),
    resetPassword: (token, new_password) => api.post('/api/auth/reset-password', { token, new_password }),
    changePassword: (new_password) => api.post('/api/auth/change-password', { new_password }),
    viewPassword: (userId) => api.get(`/api/auth/view-password/${userId}`),
  },

  nda: {
    getActiveTemplate: () => api.get('/api/nda/templates/active'),
    getAllTemplates: () => api.get('/api/nda/templates'),
    deleteTemplate: (id) => api.delete(`/api/nda/templates/${id}`),
    getTemplateFields: (id) => api.get(`/api/nda/templates/${id}/fields`),
    updateTemplate: (id, data) => api.put(`/api/nda/templates/${id}`, data),

    createRequestForEmployee: (employee) =>
      api.post('/api/nda/create-for-employee', {
        employee_id: employee.id,
        employee_name: employee.name || employee.full_name || '',
        employee_email: employee.email,
      }),
    sendDocumentToUsers: (templateId, userIds, isStandard = false) =>
      api.post('/api/nda/send-to-users', {
        template_id: templateId,
        user_ids: userIds,
        is_standard: isStandard,
      }),

    getMyPending: (email) =>
      api.get(`/api/nda/me/pending?email=${encodeURIComponent(email || '')}`),

    getShreePending: () =>
      api.get('/api/nda/shree/pending'),

    getCarrieCompleted: () =>
      api.get('/api/nda/carrie/completed'),

    getAllCompleted: () =>
      api.get('/api/nda/all-completed'),

    getEmployeeDocuments: (employeeId) =>
      api.get(`/api/nda/employee/${employeeId}`),

    downloadFinalPdf: async (ndaId) => {
      const data = await api.get(`/api/nda/${ndaId}/download-url`);
      if (data?.url) window.open(data.url, '_blank');
      return data;
    },

    dismissCarrieNotification: (ndaId) =>
      api.patch(`/api/nda/${ndaId}/carrie-dismiss`, {}),

    uploadTemplate: (formData) =>
      request('/api/nda/templates', {
        method: 'POST',
        body: formData,
      }),

    updateTemplate: (id, formData) =>
      request(`/api/nda/templates/${id}`, {
        method: 'PUT',
        body: formData,
      }),

    saveTemplateFields: (templateId, fields) =>
      api.post(`/api/nda/templates/${templateId}/fields`, { fields }),

    setTemplateActive: (templateId) =>
      api.patch(`/api/nda/templates/${templateId}/set-active`, {}),
  },

  me: () => api.get('/api/users/me'),
  users: () => api.get('/api/users'),
  myTeam: () => api.get('/api/users/my-team'),
  clients: () => api.get('/api/clients'),
  createClient: (body) => api.post('/api/clients', body),
  updateClient: (id, body) => api.patch(`/api/clients/${id}`, body),
  departments: () => api.get('/api/departments'),
  createDepartment: (name) => api.post('/api/departments', { name }),
  updateDepartment: (id, name) => api.patch(`/api/departments/${id}`, { name }),
  deleteDepartment: (id) => api.delete(`/api/departments/${id}`),
  deleteClient: (id) => api.delete(`/api/clients/${id}`),
  usersAll: () => api.get('/api/users?include_inactive=true'),
  createUser: (body) => api.post('/api/users', body),
  updateUser: (id, body) => api.patch(`/api/users/${id}`, body),
  deleteUser: (id) => api.delete(`/api/users/${id}`),
  deactivateUser: (id) => api.patch(`/api/users/${id}/deactivate`, {}),
  activateUser: (id) => api.patch(`/api/users/${id}/activate`, {}),
  resetUserPassword: (id) => api.post(`/api/users/${id}/reset-password`, {}),
  bulkSetPassword: (password, userIds) => api.post('/api/users/bulk-set-password', { password, user_ids: userIds || null }),

  assignments: {
    byClient: (clientId) => api.get(`/api/assignments/by-client/${clientId}`),
    assign: (userId, clientId) => api.post('/api/assignments', { user_id: userId, client_id: clientId }),
    unassign: (userId, clientId) => api.delete(`/api/assignments/${userId}/${clientId}`),
    userClients: () => api.get('/api/assignments/user-clients'),
  },

  leaveRequests: {
    list: () => api.get('/api/leave-requests'),
    create: (body) => api.post('/api/leave-requests', body),
    approve: (id) => api.patch(`/api/leave-requests/${id}/approve`, {}),
    reject: (id, body) => api.patch(`/api/leave-requests/${id}/reject`, body || {}),
    acknowledge: (id) => api.patch(`/api/leave-requests/${id}/acknowledge`, {}),
    balance: (userId, year) => api.get(`/api/leave-requests/balance/${userId}${year ? `?year=${year}` : ''}`),
    balanceAll: (year, month) => {
      const sp = new URLSearchParams();
      if (year) sp.set('year', year);
      if (month) sp.set('month', month);
      const qs = sp.toString();
      return api.get(`/api/leave-requests/balance-all${qs ? `?${qs}` : ''}`);
    },
    cancel: (id) => api.delete(`/api/leave-requests/${id}`),
    edit: (id, body) => api.patch(`/api/leave-requests/${id}/edit`, body),
    split: (id, excludeDates) => api.post(`/api/leave-requests/${id}/split`, { exclude_dates: excludeDates }),
  },

  shifts: (params) => {
    const sp = new URLSearchParams();
    if (params?.from) sp.set('from', params.from);
    if (params?.to) sp.set('to', params.to);
    if (params?.week != null) sp.set('week', params.week);
    if (params?.year != null) sp.set('year', params.year);
    if (params?.client_id) sp.set('client_id', params.client_id);
    return api.get(`/api/shifts?${sp.toString()}`);
  },

  myClockStatus: (date, timezone) => {
    const sp = new URLSearchParams();
    if (date) sp.set('date', date);
    if (timezone) sp.set('timezone', timezone);
    return api.get(`/api/shifts/my-status?${sp.toString()}`);
  },

  shiftsGrid: (from, to, clientId, departmentId) => {
    const sp = new URLSearchParams({ from, to });
    if (clientId) sp.set('client_id', clientId);
    if (departmentId) sp.set('department_id', departmentId);
    return api.get(`/api/shifts/grid?${sp.toString()}`);
  },

  shiftsBulk: (body) => api.post('/api/shifts/bulk', body),

  scheduleInfo: (clientId) => {
    const sp = new URLSearchParams();
    if (clientId) sp.set('client_id', clientId);
    return api.get(`/api/shifts/schedule-info?${sp.toString()}`);
  },

  clockIn: (shiftDate, timezone, isWfh) =>
    api.post('/api/shifts/clock-in', {
      shift_date: shiftDate || undefined,
      timezone: timezone || undefined,
      is_wfh: isWfh != null ? isWfh : undefined,
    }),

  clockOut: (shiftDate, timezone) =>
    api.post('/api/shifts/clock-out', {
      shift_date: shiftDate || undefined,
      timezone: timezone || undefined,
    }),

  adminClockIn: (userId, shiftDate) =>
    api.post('/api/shifts/admin-clock-in', {
      user_id: userId,
      shift_date: shiftDate || undefined,
    }),

  adminClockOut: (userId, shiftDate) =>
    api.post('/api/shifts/admin-clock-out', {
      user_id: userId,
      shift_date: shiftDate || undefined,
    }),

  autoLogoutNotices: () => api.get('/api/shifts/auto-logout-notices'),

  dismissAutoLogoutNotice: (shiftDate) =>
    api.post('/api/shifts/auto-logout-notices/dismiss', { shift_date: shiftDate }),

  adminAlerts: {
    list: (all) => api.get(`/api/shifts/admin-alerts${all ? '?all=true' : ''}`),
    markRead: (id) => api.patch(`/api/shifts/admin-alerts/${id}/read`, {}),
    markAllRead: () => api.patch('/api/shifts/admin-alerts/read-all', {}),
  },

  schedules: {
    list: () => api.get('/api/schedules'),
    upload: (body) => api.post('/api/schedules', body),
    parseCSV: (body) => api.post('/api/schedules/parse-csv', body),
  },

  assets: {
    list: (params) => {
      const sp = new URLSearchParams();
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          if (v) sp.set(k, v);
        });
      }
      return api.get(`/api/assets?${sp.toString()}`);
    },
    detail: (id) => api.get(`/api/assets/detail/${id}`),
    create: (body) => api.post('/api/assets', body),
    update: (id, body) => api.patch(`/api/assets/${id}`, body),
    remove: (id) => api.delete(`/api/assets/${id}`),
    assign: (id, body) => api.post(`/api/assets/${id}/assign`, body),
    unassign: (id) => api.post(`/api/assets/${id}/unassign`, {}),
    assignments: (params) => {
      const sp = new URLSearchParams();
      if (params?.asset_id) sp.set('asset_id', params.asset_id);
      return api.get(`/api/assets/assignments?${sp.toString()}`);
    },
    dashboard: () => api.get('/api/assets/dashboard'),
    byEmployee: () => api.get('/api/assets/by-employee'),
    nextTag: (prefix) => api.get(`/api/assets/next-tag/${prefix}`),
    categories: () => api.get('/api/assets/categories'),
    createCategory: (body) => api.post('/api/assets/categories', body),
    updateCategory: (id, body) => api.patch(`/api/assets/categories/${id}`, body),
    deleteCategory: (id) => api.delete(`/api/assets/categories/${id}`),
    bulkCsv: (rows) => api.post('/api/assets/bulk-csv', { rows }),
  },

  assistant: {
    query: (question) => api.post('/api/assistant/query', { query: question }),
  },

  celebrations: {
    today: () => api.get('/api/celebrations/today'),
    upcoming: () => api.get('/api/celebrations/upcoming'),
    all: () => api.get('/api/celebrations/all'),
    month: (m) => api.get(`/api/celebrations/month/${m}`),
  },

  allowances: {
    policies: () => api.get('/api/allowances/policies'),
    createPolicy: (body) => api.post('/api/allowances/policies', body),
    updatePolicy: (id, body) => api.patch(`/api/allowances/policies/${id}`, body),
    claims: (params) => {
      const sp = new URLSearchParams();
      if (params) Object.entries(params).forEach(([k, v]) => {
        if (v) sp.set(k, v);
      });
      return api.get(`/api/allowances/claims?${sp.toString()}`);
    },
    submitClaim: (body) => api.post('/api/allowances/claims', body),
    approveClaim: (id) => api.patch(`/api/allowances/claims/${id}/approve`, {}),
    rejectClaim: (id) => api.patch(`/api/allowances/claims/${id}/reject`, {}),
    summary: (params) => {
      const sp = new URLSearchParams();
      if (params) Object.entries(params).forEach(([k, v]) => {
        if (v) sp.set(k, v);
      });
      return api.get(`/api/allowances/summary?${sp.toString()}`);
    },
  },
  shiftCodes: {
    list: () => api.get('/api/shift-codes'),
    save: (body) => api.post('/api/shift-codes', body),
    delete: (id) => api.delete(`/api/shift-codes/${id}`)
  },

  shiftChanges: {
    list: () => api.get('/api/shift-changes'),
    create: (body) => api.post('/api/shift-changes', body),
    approve: (id) => api.patch(`/api/shift-changes/${id}/approve`, {}),
    reject: (id) => api.patch(`/api/shift-changes/${id}/reject`, {}),
    acknowledge: (id) => api.patch(`/api/shift-changes/${id}/acknowledge`, {}),
  },

  reports: {
    hr: (params) => {
      const sp = new URLSearchParams();
      if (params?.from) sp.set('from', params.from);
      if (params?.to) sp.set('to', params.to);
      if (params?.client_id) sp.set('client_id', params.client_id);
      return api.get(`/api/reports/hr?${sp.toString()}`);
    },
  },

  budgeting: {
    list: () => api.get('/api/budgeting'),
    create: (body) => api.post('/api/budgeting', body),
    update: (id, body) => api.patch(`/api/budgeting/${id}`, body),
    remove: (id) => api.delete(`/api/budgeting/${id}`),
    expenses: (budgetId) => api.get(`/api/budgeting/${budgetId}/expenses`),
    addExpense: (budgetId, body) => api.post(`/api/budgeting/${budgetId}/expenses`, body),
    removeExpense: (expenseId) => api.delete(`/api/budgeting/expenses/${expenseId}`),
    summary: () => api.get('/api/budgeting/summary'),
  },

  dinners: {
    list: (params) => {
      const sp = new URLSearchParams();
      if (params?.date) sp.set('date', params.date);
      if (params?.from) sp.set('from', params.from);
      if (params?.to) sp.set('to', params.to);
      const qs = sp.toString();
      return api.get(`/api/dinners${qs ? `?${qs}` : ''}`);
    },
    addExtra: (data) => api.post('/api/dinners/extras', data),
    removeExtra: (id) => api.delete(`/api/dinners/extras/${id}`),
    exclude: (data) => api.post('/api/dinners/exclusions', data),
    removeExclusion: (id) => api.delete(`/api/dinners/exclusions/${id}`),
    summary: () => api.get('/api/dinners/summary'),
    settings: () => api.get('/api/dinners/settings'),
    updateSettings: (body) => api.patch('/api/dinners/settings', body),
  },

  getUserMultiAssignments: () => api.get('/api/users/multi-assignments'),
  saveUserMultiAssignments: (userId, body) => api.put(`/api/users/${userId}/multi-assignments`, body),
  teamHierarchy: () => api.get('/api/users/team-hierarchy'),
  assignTeamLead: (data) => api.patch('/api/users/assign-team-lead', data),
  assignManager: (data) => api.patch('/api/users/assign-manager', data),

  holidays: {
    list: (year) => api.get(`/api/holidays${year ? `?year=${year}` : ''}`),
    create: (body) => api.post('/api/holidays', body),
    remove: (id) => api.delete(`/api/holidays/${id}`),
    compOffs: () => api.get('/api/holidays/comp-offs'),
    compOffsAll: () => api.get('/api/holidays/comp-offs/all'),
    useCompOff: (id, usedDate) => api.patch(`/api/holidays/comp-offs/${id}/use`, { used_date: usedDate }),
    compOffsByEmployee: (year) => api.get(`/api/holidays/comp-offs/by-employee${year ? `?year=${year}` : ''}`),
  },

  ideas: {
    list: (params) => {
      const sp = new URLSearchParams();
      if (params?.status) sp.set('status', params.status);
      const qs = sp.toString();
      return api.get(`/api/ideas${qs ? `?${qs}` : ''}`);
    },
    create: (data) => api.post('/api/ideas', data),
    update: (id, data) => api.patch(`/api/ideas/${id}`, data),
    remove: (id) => api.delete(`/api/ideas/${id}`),
  },

  shiftCodes: {
    list: () => api.get('/api/shift-codes'),
    save: (data) => api.post('/api/shift-codes', data),
    remove: (id) => api.delete(`/api/shift-codes/${id}`),
  },

  hrDocuments: (() => {
    const STORE_KEY = 'ags_hr_documents';
    const delay = (ms = 80) => new Promise((r) => setTimeout(r, ms));

    const getAll = () => {
      try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
      catch { return []; }
    };
    const saveAll = (docs) => localStorage.setItem(STORE_KEY, JSON.stringify(docs));

    return {
      list: async () => { await delay(); return { documents: getAll() }; },

      create: async (body) => {
        await delay();
        const docs = getAll();
        const doc = {
          id: crypto.randomUUID(),
          title: body.title || 'Untitled',
          description: body.description || '',
          category: body.category || 'general',
          file_name: body.file_name || '',
          file_data: body.file_data || '',   // base64 data-URL for file preview/download
          file_type: body.file_type || '',
          show_to_new_users: !!body.show_to_new_users,
          visible_to: body.visible_to || 'all',  // 'all' | 'admin' | 'employee'
          created_by: body.created_by || '',
          created_by_name: body.created_by_name || 'Carrie Lu',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        docs.push(doc);
        saveAll(docs);
        return { document: doc };
      },

      update: async (id, body) => {
        await delay();
        const docs = getAll();
        const idx = docs.findIndex((d) => d.id === id);
        if (idx !== -1) {
          docs[idx] = { ...docs[idx], ...body, updated_at: new Date().toISOString() };
          saveAll(docs);
        }
        return { success: true };
      },

      remove: async (id) => {
        await delay();
        saveAll(getAll().filter((d) => d.id !== id));
        return { success: true };
      },
    };
  })(),
};