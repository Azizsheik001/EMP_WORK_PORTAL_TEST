/**
 * API client for AGS Workforce backend.
 * In dev: uses same-origin /api (Vite proxies to backend). In production: uses VITE_API_URL.
 */

const getBaseUrl = () => {
  if (import.meta.env.DEV) return '';
  return (import.meta.env.VITE_API_URL || '').trim().replace(/\\n/g, '').replace(/\s+/g, '').replace(/\/$/, '');
};

export function hasApi() {
  return import.meta.env.DEV || !!import.meta.env.VITE_API_URL?.trim();
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

  assets: (() => {
    const delay = (ms = 150) => new Promise((res) => setTimeout(res, ms));
    const getAssets = () => {
      try {
        return JSON.parse(localStorage.getItem('ags_assets') || '[]');
      } catch {
        return [];
      }
    };
    const setAssets = (d) => localStorage.setItem('ags_assets', JSON.stringify(d));
    const getCategories = () => {
      try {
        return JSON.parse(localStorage.getItem('ags_asset_categories') || '[]');
      } catch {
        return [];
      }
    };
    const setCategories = (d) => localStorage.setItem('ags_asset_categories', JSON.stringify(d));

    if (getCategories().length === 0) {
      setCategories([
        { id: 'cat-1', name: 'Laptop', description: 'Computers', created_at: new Date().toISOString() },
        { id: 'cat-2', name: 'Mouse', description: 'Peripherals', created_at: new Date().toISOString() },
        { id: 'cat-3', name: 'Headset', description: 'Audio', created_at: new Date().toISOString() },
        { id: 'cat-4', name: 'Keyboard', description: 'Peripherals', created_at: new Date().toISOString() },
        { id: 'cat-5', name: 'Monitor', description: 'Displays', created_at: new Date().toISOString() },
      ]);
    }

    return {
      list: async (params) => {
        await delay();
        let assets = getAssets();
        const cats = getCategories();

        if (params?.category_id) assets = assets.filter((a) => a.category_id === params.category_id);
        if (params?.status) assets = assets.filter((a) => a.status === params.status);
        if (params?.assigned_to) assets = assets.filter((a) => a.assigned_to_id === params?.assigned_to);

        if (params?.search) {
          const q = params.search.toLowerCase();
          assets = assets.filter(
            (a) =>
              (a.asset_tag || '').toLowerCase().includes(q) ||
              (a.brand || '').toLowerCase().includes(q) ||
              (a.model || '').toLowerCase().includes(q) ||
              (a.serial_number || '').toLowerCase().includes(q)
          );
        }

        assets = assets.map((a) => {
          const cat = cats.find((c) => c.id === a.category_id);
          return { ...a, category_name: cat ? cat.name : 'Unknown' };
        });

        return { assets };
      },

      detail: async (id) => {
        await delay();
        const asset = getAssets().find((a) => a.id === id);
        if (!asset) throw new Error('Asset not found');
        return asset;
      },

      create: async (body) => {
        await delay();
        const assets = getAssets();
        const newAsset = {
          ...body,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          audit_log: [],
        };

        if (newAsset.assigned_to || newAsset.assigned_to_id) {
          const assignedId = newAsset.assigned_to || newAsset.assigned_to_id;
          newAsset.status = 'assigned';
          newAsset.assigned_to_id = assignedId;
          newAsset.audit_log.push({
            date: new Date().toISOString(),
            type: 'assigned',
            assigned_to_id: assignedId,
          });
        }

        assets.push(newAsset);
        setAssets(assets);
        return { id: newAsset.id };
      },

      update: async (id, body) => {
        await delay();
        const assets = getAssets();
        const idx = assets.findIndex((a) => a.id === id);

        if (idx !== -1) {
          const oldAsset = assets[idx];
          const newAuditLog = oldAsset.audit_log || [];

          const oldAssignedId = oldAsset.assigned_to_id || oldAsset.assigned_to;
          const newAssignedId =
            body.assigned_to_id !== undefined ? body.assigned_to_id : body.assigned_to;

          if (newAssignedId !== undefined && newAssignedId !== oldAssignedId) {
            if (newAssignedId) {
              newAuditLog.push({
                date: new Date().toISOString(),
                type: 'assigned',
                assigned_to_id: newAssignedId,
              });
            } else if (oldAssignedId) {
              newAuditLog.push({
                date: new Date().toISOString(),
                type: 'unassigned',
                previous_assigned_to_id: oldAssignedId,
              });
            }
          }

          assets[idx] = {
            ...oldAsset,
            ...body,
            audit_log: newAuditLog,
            updated_at: new Date().toISOString(),
          };
          setAssets(assets);
        }

        return { success: true };
      },

      remove: async (id) => {
        await delay();
        setAssets(getAssets().filter((a) => a.id !== id));
        return { success: true };
      },

      assign: async (id, body) => {
        await delay();
        const assets = getAssets();
        const idx = assets.findIndex((a) => a.id === id);

        if (idx !== -1) {
          const oldAsset = assets[idx];
          const newAuditLog = oldAsset.audit_log || [];
          const d = body.assigned_date
            ? new Date(body.assigned_date).toISOString()
            : new Date().toISOString();

          newAuditLog.push({
            date: d,
            type: 'assigned',
            assigned_to_id: body.user_id,
            notes: body.notes,
          });

          assets[idx].status = 'assigned';
          assets[idx].assigned_to_id = body.user_id;
          assets[idx].assigned_to_name = body.user_name || 'Assigned User';
          assets[idx].audit_log = newAuditLog;
          setAssets(assets);
        }

        return { success: true };
      },

      unassign: async (id) => {
        await delay();
        const assets = getAssets();
        const idx = assets.findIndex((a) => a.id === id);

        if (idx !== -1) {
          const oldAsset = assets[idx];
          const newAuditLog = oldAsset.audit_log || [];

          if (oldAsset.assigned_to_id) {
            newAuditLog.push({
              date: new Date().toISOString(),
              type: 'unassigned',
              previous_assigned_to_id: oldAsset.assigned_to_id,
            });
          }

          assets[idx].status = 'available';
          assets[idx].assigned_to_id = null;
          assets[idx].assigned_to_name = null;
          assets[idx].audit_log = newAuditLog;
          setAssets(assets);
        }

        return { success: true };
      },

      assignments: async () => {
        await delay();
        return { assignments: [] };
      },

      dashboard: async () => {
        await delay();
        const assets = getAssets();
        const total = assets.length;
        const available = assets.filter((a) => a.status === 'available').length;
        const assigned = assets.filter((a) => a.status === 'assigned').length;
        const under_repair = assets.filter((a) => a.status === 'under_repair').length;
        const warranties_expiring_soon = assets.filter((a) => {
          if (!a.warranty_expiry_date) return false;
          const exp = new Date(a.warranty_expiry_date);
          const in30days = new Date();
          in30days.setDate(in30days.getDate() + 30);
          return exp <= in30days && exp > new Date();
        }).length;

        return {
          total,
          available,
          assigned,
          under_repair,
          warranties_expiring_soon,
        };
      },

      byEmployee: async () => {
        await delay();
        const assets = getAssets();
        const cats = getCategories();
        const emps = {};

        for (const a of assets) {
          if (a.assigned_to_id) {
            if (!emps[a.assigned_to_id]) {
              emps[a.assigned_to_id] = {
                user_id: a.assigned_to_id,
                employee_name: a.assigned_to_name || a.assigned_to_emp_name || a.assigned_to_id,
                total_cost: 0,
                assets: [],
              };
            }

            const cost = parseFloat(a.purchase_cost) || 0;
            emps[a.assigned_to_id].total_cost += cost;
            const cat = cats.find((c) => c.id === a.category_id);

            const pd =
              Object.prototype.toString.call(a.purchase_date) === '[object Date]'
                ? a.purchase_date
                : new Date(a.purchase_date);
            const now = new Date();
            const yearsOwned = !isNaN(pd.getTime())
              ? (now - pd) / (365.25 * 24 * 60 * 60 * 1000)
              : 0;
            const pct = Math.min(100, Math.max(0, Math.round(yearsOwned * 25)));
            const currVal = Math.max(0, cost * (1 - pct / 100));

            emps[a.assigned_to_id].assets.push({
              asset_id: a.id,
              category: cat ? cat.name : a.category_name || 'Unknown',
              brand: a.brand,
              model: a.model,
              serial_number: a.serial_number,
              purchase_cost: cost,
              depreciation_pct: pct,
              needs_replacement: pct >= 100,
              current_value: currVal,
              warranty_expiry_date: a.warranty_expiry_date,
              notes: a.notes,
              status: a.status,
            });
          }
        }

        return { employees: Object.values(emps) };
      },

      nextTag: async (prefix) => {
        await delay();
        const c = getAssets().filter((a) => a.asset_tag?.startsWith(prefix)).length + 1;
        return { next_tag: `${prefix}-${String(c).padStart(3, '0')}` };
      },

      categories: async () => {
        await delay();
        return { categories: getCategories() };
      },

      createCategory: async (body) => {
        await delay();
        const cats = getCategories();
        const newCat = {
          ...body,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        };
        cats.push(newCat);
        setCategories(cats);
        return newCat;
      },

      updateCategory: async (id, body) => {
        await delay();
        const cats = getCategories();
        const idx = cats.findIndex((c) => c.id === id);
        if (idx !== -1) cats[idx] = { ...cats[idx], ...body };
        setCategories(cats);
        return { success: true };
      },

      deleteCategory: async (id) => {
        await delay();
        setCategories(getCategories().filter((c) => c.id !== id));
        return { success: true };
      },

      bulkCsv: async (rows) => {
        await delay();
        const cats = getCategories();
        const assets = getAssets();
        let created = 0;
        let updated = 0;
        const errors = [];

        rows.forEach((r, idx) => {
          let catId = r.category_id;
          const catName = r.category || 'Other';

          if (!catId) {
            const existingCat = cats.find((c) => c.name.toLowerCase() === catName.toLowerCase());
            if (existingCat) {
              catId = existingCat.id;
            } else {
              catId = crypto.randomUUID();
              cats.push({
                id: catId,
                name: catName,
                description: 'Auto-created during CSV import',
                created_at: new Date().toISOString(),
              });
            }
          }

          const serialNumber = (r.serial_number || '').trim();
          const model = (r.model || '').trim();
          const brand = (r.brand || '').trim();
          const assignedToId = r.assigned_to_emp_id || null;

          let existingAssetIdx = -1;
          if (assignedToId) {
            existingAssetIdx = assets.findIndex(
              (a) =>
                a.assigned_to_id === assignedToId &&
                a.category_id === catId &&
                (a.model || '').trim().toLowerCase() === model.toLowerCase() &&
                (a.brand || '').trim().toLowerCase() === brand.toLowerCase()
            );
          } else if (r.asset_tag_override) {
            existingAssetIdx = assets.findIndex((a) => a.asset_tag === r.asset_tag_override.trim());
          }

          if (existingAssetIdx !== -1) {
            const a = assets[existingAssetIdx];
            if (r.purchase_date) a.purchase_date = r.purchase_date;
            if (r.purchase_cost) a.purchase_cost = parseFloat(r.purchase_cost) || 0;
            if (r.warranty_expiry_date) a.warranty_expiry_date = r.warranty_expiry_date;
            if (serialNumber) a.serial_number = serialNumber;
            if (r.notes) a.notes = r.notes;
            a.updated_at = new Date().toISOString();
            updated += 1;
            return;
          }

          if (
            serialNumber &&
            assets.some(
              (a) => a.serial_number && a.serial_number.toLowerCase() === serialNumber.toLowerCase()
            )
          ) {
            errors.push({
              row: idx + 1,
              error: `Skipped duplicate serial number: ${serialNumber}`,
            });
            return;
          }

          let assetTag = (r.asset_tag_override || r.asset_tag || '').toString().trim();
          if (!assetTag) {
            const prefix = (r.category || 'AST').replace(/\s+/g, '').slice(0, 3).toUpperCase();
            const c = assets.filter((a) => a.asset_tag?.startsWith(prefix)).length + 1;
            assetTag = `${prefix}-${String(c).padStart(3, '0')}`;
          }

          assets.push({
            id: crypto.randomUUID(),
            asset_tag: assetTag,
            category_id: catId,
            brand,
            model,
            serial_number: serialNumber,
            purchase_date: r.purchase_date || new Date().toISOString(),
            purchase_cost: parseFloat(r.purchase_cost) || 0,
            warranty_expiry_date: r.warranty_expiry_date || null,
            status: r.status || 'available',
            notes: r.notes || '',
            support_phone: r.support_phone || '',
            assigned_to_id: assignedToId,
            assigned_to_name: r.assigned_to_emp_name || null,
            created_at: new Date().toISOString(),
          });
          created += 1;
        });

        setCategories(cats);
        setAssets(assets);
        return { created, updated, errors };
      },
    };
  })(),

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