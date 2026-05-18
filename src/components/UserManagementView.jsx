import { useState, useEffect, useMemo, useCallback } from "react";
import { hasApi, api } from "../api/client";
import RoleBadge from "./RoleBadge";
import {
  isCarrieLu,
  fileToBase64,
  sendDocumentToEmployee,
} from "../utils/documentStorage";

function formatName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const ROLES = ["admin", "manager", "team_lead", "employee"];
const ROLE_LABELS = {
  admin: "Admin",
  manager: "Manager",
  team_lead: "Team Lead",
  employee: "Employee",
};
const ITEMS_PER_PAGE = 20;

function StatCard({ label, value, color, isDark }) {
  return (
    <div
      className={`rounded-xl border p-4 ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}
    >
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p
        className={`text-xs font-medium mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
      >
        {label}
      </p>
    </div>
  );
}

function SortIcon({ active, direction }) {
  if (!active)
    return (
      <svg
        className="w-3.5 h-3.5 text-gray-400 ml-1 opacity-0 group-hover:opacity-100"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
        />
      </svg>
    );
  return (
    <svg
      className={`w-3.5 h-3.5 ml-1 text-brand transition-transform ${direction === "desc" ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 15l7-7 7 7"
      />
    </svg>
  );
}

export default function UserManagementView({
  isDark,
  currentUser,
  clients = [],
  departments = [],
  showToast,
  onRefreshUsers,
  allUsers: externalAllUsers,
  onEditNdaForm,
}) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [sortCol, setSortCol] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);

  // Side panel state
  const [panelMode, setPanelMode] = useState(null); // 'add' | 'edit' | null
  const [editUser, setEditUser] = useState(null);

  // Dept management
  const [deptSectionOpen, setDeptSectionOpen] = useState(false);
  const [localDepts, setLocalDepts] = useState(departments);
  const [newDeptName, setNewDeptName] = useState("");
  const [editingDeptId, setEditingDeptId] = useState(null);
  const [editingDeptName, setEditingDeptName] = useState("");
  const [deptError, setDeptError] = useState("");

  // Client management
  const [clientSectionOpen, setClientSectionOpen] = useState(false);
  const [localClients, setLocalClients] = useState(clients);
  const [newClientName, setNewClientName] = useState("");
  const [editingClientId, setEditingClientId] = useState(null);
  const [editingClientName, setEditingClientName] = useState("");
  const [clientError, setClientError] = useState("");

  // Right slide-out for dept/client management
  const [manageOpen, setManageOpen] = useState(false);

  // Password reset
  const [resetResult, setResetResult] = useState(null);

  // Deactivation confirm
  const [confirmDeactivate, setConfirmDeactivate] = useState(null);



  // Send document modal (Carrie Lu only)
  const [docTargetUser, setDocTargetUser] = useState(null);
  const [docFile, setDocFile] = useState(null);
  const [docTemplateId, setDocTemplateId] = useState("");
  const [sendingDoc, setSendingDoc] = useState(false);

  // Send document to multiple users (HR / Admin)
  const [sendDocModalOpen, setSendDocModalOpen] = useState(false);
  const [sendDocTemplateId, setSendDocTemplateId] = useState("");
  const [sendDocUserIds, setSendDocUserIds] = useState([]);
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [sendingDocs, setSendingDocs] = useState(false);

  useEffect(() => {
    setLocalDepts(departments);
  }, [departments]);
  useEffect(() => {
    setLocalClients(clients);
  }, [clients]);

  const fetchUsers = useCallback(async () => {
    if (!hasApi()) return;
    setLoading(true);
    try {
      const data = await api.usersAll();
      setUsers(data.users || []);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const getClientName = (clientId) =>
    localClients.find((c) => c.id === clientId)?.name || "";
  const getDeptName = (deptId) =>
    localDepts.find((d) => d.id === deptId)?.name || "";
  const getUserName = (userId) =>
    users.find((u) => u.id === userId)?.name || "";

  // Filtering & sorting
  const filteredUsers = useMemo(() => {
    let list = [...users];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (u) =>
          (u.name || "").toLowerCase().includes(q) ||
          (u.email || "").toLowerCase().includes(q) ||
          (u.designation || "").toLowerCase().includes(q),
      );
    }
    if (filterRole) list = list.filter((u) => u.role === filterRole);
    if (filterDept) list = list.filter((u) => u.department_id === filterDept);
    if (filterClient) list = list.filter((u) => u.client_id === filterClient);
    if (filterStatus === "active")
      list = list.filter((u) => u.is_active !== false);
    if (filterStatus === "inactive")
      list = list.filter((u) => u.is_active === false);

    list.sort((a, b) => {
      let va, vb;
      switch (sortCol) {
        case "name":
          va = (a.name || "").toLowerCase();
          vb = (b.name || "").toLowerCase();
          break;
        case "email":
          va = (a.email || "").toLowerCase();
          vb = (b.email || "").toLowerCase();
          break;
        case "role":
          va = a.role || "";
          vb = b.role || "";
          break;
        case "department":
          va = getDeptName(a.department_id).toLowerCase();
          vb = getDeptName(b.department_id).toLowerCase();
          break;
        case "employee_id":
          va = (a.employee_id || a.employee_no || "").toLowerCase();
          vb = (b.employee_id || b.employee_no || "").toLowerCase();
          break;
        case "client":
          va = getClientName(a.client_id).toLowerCase();
          vb = getClientName(b.client_id).toLowerCase();
          break;
        case "status":
          va = a.is_active === false ? 1 : 0;
          vb = b.is_active === false ? 1 : 0;
          break;
        default:
          va = (a.name || "").toLowerCase();
          vb = (b.name || "").toLowerCase();
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [
    users,
    search,
    filterRole,
    filterDept,
    filterClient,
    filterStatus,
    sortCol,
    sortDir,
    localClients,
    localDepts,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredUsers.length / ITEMS_PER_PAGE),
  );
  const pagedUsers = filteredUsers.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  );

  useEffect(() => {
    setPage(1);
  }, [search, filterRole, filterDept, filterClient, filterStatus]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  // Stats
  // "Total Employees" uses the same rule as the Dashboard: active users, excluding admins.
  // "All Users" separately shows the full list count (including admins + inactive).
  const stats = useMemo(() => {
    const allUsers = users.length;
    const active = users.filter((u) => u.is_active !== false).length;
    const inactive = allUsers - active;
    const total = users.filter(
      (u) => u.is_active !== false && u.role !== "admin",
    ).length;
    const byRole = {};
    ROLES.forEach((r) => {
      byRole[r] = users.filter(
        (u) => u.role === r && u.is_active !== false,
      ).length;
    });
    return { total, allUsers, active, inactive, byRole };
  }, [users]);

  // Toggle active/inactive
  const handleToggleStatus = async (user) => {
    if (user.id === currentUser?.id) {
      showToast?.("Cannot deactivate yourself", "error");
      return;
    }
    if (user.is_active === false) {
      try {
        await api.activateUser(user.id);
        showToast?.("User activated");
        fetchUsers();
        onRefreshUsers?.();
      } catch (e) {
        showToast?.(e.message || "Failed", "error");
      }
    } else {
      if (confirmDeactivate !== user.id) {
        setConfirmDeactivate(user.id);
        return;
      }
      try {
        await api.deactivateUser(user.id);
        showToast?.("User deactivated");
        setConfirmDeactivate(null);
        fetchUsers();
        onRefreshUsers?.();
      } catch (e) {
        showToast?.(e.message || "Failed", "error");
        setConfirmDeactivate(null);
      }
    }
  };

  // Reset password
  const handleResetPassword = async (user) => {
    try {
      const result = await api.resetUserPassword(user.id);
      setResetResult({ userId: user.id, password: result.temp_password });
      showToast?.(`Temp password set for ${user.name}`);
    } catch (e) {
      showToast?.(e.message || "Failed to reset password", "error");
    }
  };


  // Department CRUD
  const handleAddDept = async () => {
    if (!newDeptName.trim()) return;
    setDeptError("");
    try {
      await api.createDepartment(newDeptName.trim());
      setNewDeptName("");
      const d = await api.departments();
      setLocalDepts(d.departments || []);
      showToast?.("Department added");
    } catch (e) {
      setDeptError(e.data?.error || e.message || "Failed");
    }
  };

  const handleUpdateDept = async (id) => {
    if (!editingDeptName.trim()) return;
    setDeptError("");
    try {
      await api.updateDepartment(id, editingDeptName.trim());
      setEditingDeptId(null);
      setEditingDeptName("");
      const d = await api.departments();
      setLocalDepts(d.departments || []);
      showToast?.("Department updated");
    } catch (e) {
      setDeptError(e.data?.error || e.message || "Failed");
    }
  };

  const handleDeleteDept = async (id) => {
    setDeptError("");
    try {
      await api.deleteDepartment(id);
      const d = await api.departments();
      setLocalDepts(d.departments || []);
      showToast?.("Department deleted");
    } catch (e) {
      setDeptError(e.data?.error || e.message || "Failed");
    }
  };

  // Client CRUD
  const handleAddClient = async () => {
    if (!newClientName.trim()) return;
    setClientError("");
    try {
      await api.createClient({ name: newClientName.trim() });
      setNewClientName("");
      const c = await api.clients();
      setLocalClients(c.clients || []);
      showToast?.("Client added");
    } catch (e) {
      setClientError(e.data?.error || e.message || "Failed");
    }
  };

  const handleUpdateClient = async (id) => {
    if (!editingClientName.trim()) return;
    setClientError("");
    try {
      await api.updateClient(id, { name: editingClientName.trim() });
      setEditingClientId(null);
      setEditingClientName("");
      const c = await api.clients();
      setLocalClients(c.clients || []);
      showToast?.("Client updated");
    } catch (e) {
      setClientError(e.data?.error || e.message || "Failed");
    }
  };

  const handleDeleteClient = async (id) => {
    setClientError("");
    try {
      await api.deleteClient(id);
      const c = await api.clients();
      setLocalClients(c.clients || []);
      showToast?.("Client deleted");
    } catch (e) {
      setClientError(e.data?.error || e.message || "Failed");
    }
  };

  // Send PDF document from Carrie Lu to employee
  const handleSendDocument = async () => {
    if (!docTargetUser) {
      showToast?.("Please select an employee", "error");
      return;
    }

    if (!docFile && !docTemplateId) {
      showToast?.("Please choose a document template or upload a PDF", "error");
      return;
    }

    try {
      setSendingDoc(true);

      if (docTemplateId) {
        await api.nda.sendDocumentToUsers(docTemplateId, [docTargetUser.id]);
        showToast?.(`Document sent to ${docTargetUser.name}`);
      } else {
        if (docFile.type !== "application/pdf") {
          showToast?.("Only PDF files are allowed", "error");
          setSendingDoc(false);
          return;
        }

        const fileData = await fileToBase64(docFile);

        sendDocumentToEmployee({
          employee: docTargetUser,
          sender: currentUser,
          fileName: docFile.name,
          fileData,
        });

        showToast?.(`Document sent to ${docTargetUser.name}`);
      }

      setDocTargetUser(null);
      setDocFile(null);
      setDocTemplateId("");
    } catch (e) {
      showToast?.(e.message || "Failed to send document", "error");
    } finally {
      setSendingDoc(false);
    }
  };

  const inputClass = isDark
    ? "bg-slate-700 border-slate-600 text-white rounded-lg px-3 py-2 w-full text-sm border"
    : "bg-white border-gray-300 text-gray-900 rounded-lg px-3 py-2 w-full text-sm border";
  const selectClass = inputClass;
  const cardClass = isDark
    ? "bg-slate-800 border-slate-700"
    : "bg-white border-gray-200";
  const thClass = `px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none group ${isDark ? "text-gray-400" : "text-gray-500"}`;
  const tdClass = `px-3 py-3 text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`;

  const isAdmin = currentUser?.type === "admin";
  const carrieOnly = isCarrieLu(currentUser);

  return (
    <div className="space-y-6">
      {/* Title row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1
            className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}
          >
            User Management
          </h1>
          <p
            className={`text-sm mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            Manage employees, roles, departments, and access
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${isDark ? "border-slate-600 text-gray-300 hover:bg-slate-700" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              Depts & Clients
            </button>
          )}
          {isAdmin || (currentUser?.type === "manager" && ["hr", "finance"].includes((currentUser?.department_name || "").toLowerCase())) ? (
            <button
              type="button"
              onClick={async () => {
                setSendDocModalOpen(true);
                setSendDocTemplateId("");
                setSendDocUserIds([]);
                if (hasApi()) {
                  try {
                    const r = await api.nda.getAllTemplates();
                    if (r.templates) setAvailableTemplates(r.templates);
                  } catch (e) {}
                }
              }}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${isDark ? "border-brand text-brand hover:bg-brand/10" : "border-brand text-brand hover:bg-brand/5"}`}
              title="Send an interactive document template to multiple users"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
              Send Document
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setPanelMode("add");
              setEditUser(null);
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-medium text-sm transition-colors shadow-sm"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add Employee
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Total Employees"
          value={stats.total}
          color="text-brand"
          isDark={isDark}
        />
        <StatCard
          label="Active"
          value={stats.active}
          color="text-green-500"
          isDark={isDark}
        />
        <StatCard
          label="Inactive"
          value={stats.inactive}
          color="text-red-500"
          isDark={isDark}
        />
        <StatCard
          label="Admins"
          value={stats.byRole.admin}
          color={isDark ? "text-white" : "text-gray-800"}
          isDark={isDark}
        />
        <StatCard
          label="Managers"
          value={stats.byRole.manager}
          color="text-purple-500"
          isDark={isDark}
        />
        <StatCard
          label="Team Leads"
          value={stats.byRole.team_lead}
          color="text-brand"
          isDark={isDark}
        />
      </div>

      {/* Filters */}
      <div className={`border rounded-xl p-4 ${cardClass}`}>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or designation..."
              className={inputClass + " pl-9"}
            />
          </div>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className={selectClass + " sm:w-36"}
          >
            <option value="">All Roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <select
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            className={selectClass + " sm:w-40"}
          >
            <option value="">All Departments</option>
            {localDepts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
            className={selectClass + " sm:w-40"}
          >
            <option value="">All Clients</option>
            {localClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={selectClass + " sm:w-32"}
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <p
          className={`text-xs mt-2 ${isDark ? "text-gray-500" : "text-gray-400"}`}
        >
          {filteredUsers.length} of {users.length} users
        </p>
      </div>

      {/* Table */}
      <div className={`border rounded-xl overflow-hidden ${cardClass}`}>
        {loading ? (
          <div className="p-8 text-center">
            <p
              className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              Loading users...
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-full">
              <thead>
                <tr className={isDark ? "bg-slate-700/50" : "bg-gray-50"}>
                  {[
                    { id: "name", label: "Name" },
                    { id: "employee_id", label: "Emp ID" },
                    { id: "email", label: "Email" },
                    { id: "role", label: "Role" },
                    { id: "department", label: "Department" },
                    { id: "phone", label: "Phone", sortable: false },
                    { id: "client", label: "Client" },
                    { id: "tl", label: "Team Lead", sortable: false },
                    { id: "manager", label: "Manager", sortable: false },
                    { id: "timezone", label: "Timezone" },
                    { id: "status", label: "Status" },
                    { id: "actions", label: "Actions", sortable: false },
                  ].map((col) => (
                    <th
                      key={col.id}
                      className={thClass}
                      onClick={
                        col.sortable !== false
                          ? () => handleSort(col.id)
                          : undefined
                      }
                      style={
                        col.sortable === false
                          ? { cursor: "default" }
                          : undefined
                      }
                    >
                      <span className="flex items-center">
                        {col.label}
                        {col.sortable !== false && (
                          <SortIcon
                            active={sortCol === col.id}
                            direction={sortDir}
                          />
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody
                className={`divide-y ${isDark ? "divide-slate-700" : "divide-gray-100"}`}
              >
                {pagedUsers.length === 0 && (
                  <tr>
                    <td
                      colSpan={11}
                      className={`px-4 py-12 text-center text-sm ${isDark ? "text-gray-500" : "text-gray-400"}`}
                    >
                      No users match the current filters.
                    </td>
                  </tr>
                )}
                {pagedUsers.map((u) => (
                  <tr
                    key={u.id}
                    className={`${isDark ? "hover:bg-slate-700/30" : "hover:bg-gray-50/70"} transition-colors ${u.is_active === false ? "opacity-60" : ""}`}
                  >
                    <td className={tdClass}>
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${u.is_active === false ? "bg-gray-300 text-gray-600" : "bg-brand/15 text-brand"}`}
                        >
                          {(u.name || "?")[0].toUpperCase()}
                        </div>
                        <div>
                          <span
                            className={`font-medium block ${isDark ? "text-white" : "text-gray-900"}`}
                          >
                            {formatName(u.name)}
                          </span>
                          {u.designation && (
                            <span
                              className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                            >
                              {u.designation}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={tdClass}>
                      <span className="font-mono text-xs">
                        {u.employee_id || u.employee_no || (
                          <span className="text-gray-400">--</span>
                        )}
                      </span>
                    </td>
                    <td className={tdClass}>{u.email}</td>
                    <td className={tdClass}>
                      <RoleBadge user={{ name: u.name, role: u.role }} />
                      <span className="ml-1 text-xs">
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    </td>
                    <td className={tdClass}>
                      {getDeptName(u.department_id) || (
                        <span className="text-gray-400">--</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {u.phone ? (
                        <div className="flex items-center gap-1.5">
                          <span>{u.phone}</span>
                          <a
                            href={`https://wa.me/${u.phone.replace(/\D/g, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`WhatsApp ${u.name}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#25D366] hover:bg-[#1ebe5d] transition-colors flex-shrink-0"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="w-3.5 h-3.5 fill-white"
                            >
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                            </svg>
                          </a>
                        </div>
                      ) : (
                        <span className="text-gray-400">--</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {getClientName(u.client_id) || (
                        <span className="text-gray-400">--</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {u.team_lead_name || (u.team_lead_id ? (
                        getUserName(u.team_lead_id) || (
                          <span className="text-gray-400">--</span>
                        )
                      ) : (
                        <span className="text-gray-400">--</span>
                      ))}
                    </td>
                    <td className={tdClass}>
                      {u.manager_name || (u.manager_id ? (
                        getUserName(u.manager_id) || (
                          <span className="text-gray-400">--</span>
                        )
                      ) : (
                        <span className="text-gray-400">--</span>
                      ))}
                    </td>
                    <td className={tdClass}>
                      <span className="text-xs font-medium">
                        {u.work_timezone === 'America/New_York' ? 'EST' : 
                         u.work_timezone === 'America/Chicago' ? 'CST' : 
                         u.work_timezone === 'America/Denver' ? 'MST' : 
                         u.work_timezone === 'America/Los_Angeles' ? 'PST' : 
                         u.work_timezone === 'Etc/UTC' ? 'UTC' : 
                         'IST'}
                      </span>
                    </td>
                    <td className={tdClass}>
                      {(currentUser?.type === "admin" ||
                        currentUser?.type === "manager") &&
                      u.id !== currentUser?.id ? (
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(u)}
                          className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            u.is_active !== false
                              ? "bg-green-500"
                              : "bg-gray-300 dark:bg-slate-600"
                          }`}
                          title={
                            u.is_active !== false
                              ? "Click to deactivate"
                              : "Click to activate"
                          }
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ease-in-out ${
                              u.is_active !== false
                                ? "translate-x-5"
                                : "translate-x-0"
                            }`}
                          />
                        </button>
                      ) : (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            u.is_active !== false
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                          }`}
                        >
                          {u.is_active !== false ? "Active" : "Inactive"}
                        </span>
                      )}
                      {confirmDeactivate === u.id && (
                        <div className="mt-1">
                          <span className="text-xs text-red-500 font-medium">
                            Confirm?
                          </span>
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(u)}
                            className="ml-1 text-xs text-red-600 font-bold underline"
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeactivate(null)}
                            className="ml-1 text-xs text-gray-500"
                          >
                            No
                          </button>
                        </div>
                      )}
                    </td>
                    <td className={tdClass}>
                      <div className="flex items-center gap-1.5">
                        {(currentUser?.type === "admin" ||
                          currentUser?.type === "manager") && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditUser(u);
                              setPanelMode("edit");
                            }}
                            className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${isDark ? "border-slate-600 hover:bg-slate-700 text-gray-300" : "border-gray-300 hover:bg-gray-100 text-gray-700"}`}
                          >
                            Edit
                          </button>
                        )}
                        {carrieOnly &&
                          u.id !== currentUser?.id &&
                          u.is_active !== false && (
                            <button
                              type="button"
                              onClick={async () => {
                                setDocTargetUser(u);
                                setDocFile(null);
                                setDocTemplateId("");
                                if (hasApi() && availableTemplates.length === 0) {
                                  try {
                                    const r = await api.nda.getAllTemplates();
                                    if (r.templates) setAvailableTemplates(r.templates);
                                  } catch (e) {}
                                }
                              }}
                              className="px-2 py-1 rounded text-xs font-medium border border-blue-400 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                              title="Send PDF document"
                            >
                              Send Document
                            </button>
                          )}
                        {isAdmin && u.role !== "admin" && (
                          <button
                            type="button"
                            onClick={() => handleResetPassword(u)}
                            className="px-2 py-1 rounded text-xs font-medium border border-amber-400 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                            title="Reset password"
                          >
                            Reset Pwd
                          </button>
                        )}
                        {resetResult?.userId === u.id && (
                          <span className="text-xs font-mono text-brand bg-brand/10 px-2 py-0.5 rounded">
                            {resetResult.password}
                          </span>
                        )}

                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            className={`flex items-center justify-between px-4 py-3 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}
          >
            <p
              className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
            >
              Page {page} of {totalPages} ({filteredUsers.length} users)
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className={`px-3 py-1 rounded text-xs font-medium border disabled:opacity-40 ${isDark ? "border-slate-600 text-gray-300 hover:bg-slate-700" : "border-gray-300 text-gray-700 hover:bg-gray-100"}`}
              >
                Previous
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum;
                if (totalPages <= 7) pageNum = i + 1;
                else if (page <= 4) pageNum = i + 1;
                else if (page >= totalPages - 3) pageNum = totalPages - 6 + i;
                else pageNum = page - 3 + i;
                return (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setPage(pageNum)}
                    className={`px-2.5 py-1 rounded text-xs font-medium ${
                      page === pageNum
                        ? "bg-brand text-white"
                        : isDark
                          ? "text-gray-400 hover:bg-slate-700"
                          : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
                className={`px-3 py-1 rounded text-xs font-medium border disabled:opacity-40 ${isDark ? "border-slate-600 text-gray-300 hover:bg-slate-700" : "border-gray-300 text-gray-700 hover:bg-gray-100"}`}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Slide-out Panel for Departments & Clients */}
      {manageOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onClick={() => setManageOpen(false)}
        >
          <div className="absolute inset-0 bg-black/30" aria-hidden="true" />
          <div
            className={`relative w-full max-w-md shadow-2xl flex flex-col max-h-full overflow-y-auto ${isDark ? "bg-slate-800" : "bg-white"}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Panel header */}
            <div
              className={`p-5 border-b flex items-center justify-between flex-shrink-0 ${isDark ? "border-slate-700" : "border-gray-200"}`}
            >
              <h2
                className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}
              >
                Departments & Clients
              </h2>
              <button
                type="button"
                onClick={() => setManageOpen(false)}
                className={`p-1.5 rounded-lg ${isDark ? "hover:bg-slate-700 text-gray-400" : "hover:bg-gray-100 text-gray-500"}`}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-6 flex-1 overflow-y-auto">
              {/* Department Management */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <svg
                    className="w-4 h-4 text-brand"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5"
                    />
                  </svg>
                  <h3
                    className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}
                  >
                    Departments ({localDepts.length})
                  </h3>
                </div>
                {deptError && (
                  <p className="text-sm text-red-500 mb-2">{deptError}</p>
                )}
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                    placeholder="New department name"
                    className={inputClass}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddDept();
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddDept}
                    className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium whitespace-nowrap"
                  >
                    Add
                  </button>
                </div>
                <div className="space-y-1.5">
                  {localDepts.map((dept) => (
                    <div
                      key={dept.id}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2.5 ${isDark ? "bg-slate-700/50" : "bg-gray-50"}`}
                    >
                      {editingDeptId === dept.id ? (
                        <>
                          <input
                            type="text"
                            value={editingDeptName}
                            onChange={(e) => setEditingDeptName(e.target.value)}
                            className={inputClass}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleUpdateDept(dept.id);
                              if (e.key === "Escape") setEditingDeptId(null);
                            }}
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleUpdateDept(dept.id)}
                            className="text-xs text-brand font-medium"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingDeptId(null)}
                            className="text-xs text-gray-500"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <span
                            className={`flex-1 text-sm font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}
                          >
                            {dept.name}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${isDark ? "bg-slate-600 text-gray-400" : "bg-gray-200 text-gray-500"}`}
                          >
                            {
                              users.filter(
                                (u) =>
                                  u.department_id === dept.id &&
                                  u.is_active !== false,
                              ).length
                            }
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDeptId(dept.id);
                              setEditingDeptName(dept.name);
                            }}
                            className="text-xs text-brand hover:underline flex-shrink-0"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDept(dept.id)}
                            className="text-xs text-red-500 hover:underline flex-shrink-0"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                  {localDepts.length === 0 && (
                    <p
                      className={`text-sm italic ${isDark ? "text-gray-500" : "text-gray-400"}`}
                    >
                      No departments yet.
                    </p>
                  )}
                </div>
              </div>

              <hr className={isDark ? "border-slate-700" : "border-gray-200"} />

              {/* Client Management */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <svg
                    className="w-4 h-4 text-purple-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                  <h3
                    className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}
                  >
                    Clients ({localClients.length})
                  </h3>
                </div>
                {clientError && (
                  <p className="text-sm text-red-500 mb-2">{clientError}</p>
                )}
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="New client name"
                    className={inputClass}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddClient();
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddClient}
                    className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium whitespace-nowrap"
                  >
                    Add
                  </button>
                </div>
                <div className="space-y-1.5">
                  {localClients.map((client) => (
                    <div
                      key={client.id}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2.5 ${isDark ? "bg-slate-700/50" : "bg-gray-50"}`}
                    >
                      {editingClientId === client.id ? (
                        <>
                          <input
                            type="text"
                            value={editingClientName}
                            onChange={(e) =>
                              setEditingClientName(e.target.value)
                            }
                            className={inputClass}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                handleUpdateClient(client.id);
                              if (e.key === "Escape") setEditingClientId(null);
                            }}
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleUpdateClient(client.id)}
                            className="text-xs text-brand font-medium"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingClientId(null)}
                            className="text-xs text-gray-500"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <span
                            className={`flex-1 text-sm font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}
                          >
                            {client.name}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${isDark ? "bg-slate-600 text-gray-400" : "bg-gray-200 text-gray-500"}`}
                          >
                            {
                              users.filter(
                                (u) =>
                                  u.client_id === client.id &&
                                  u.is_active !== false,
                              ).length
                            }
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingClientId(client.id);
                              setEditingClientName(client.name);
                            }}
                            className="text-xs text-brand hover:underline flex-shrink-0"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteClient(client.id)}
                            className="text-xs text-red-500 hover:underline flex-shrink-0"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                  {localClients.length === 0 && (
                    <p
                      className={`text-sm italic ${isDark ? "text-gray-500" : "text-gray-400"}`}
                    >
                      No clients yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Send Document Modal */}
      {docTargetUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => {
            if (!sendingDoc) {
              setDocTargetUser(null);
              setDocFile(null);
              setDocTemplateId("");
            }
          }}
        >
          <div
            className={`w-full max-w-md rounded-xl border shadow-2xl ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`p-5 border-b flex items-center justify-between ${isDark ? "border-slate-700" : "border-gray-200"}`}
            >
              <div>
                <h2
                  className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}
                >
                  Send Document
                </h2>
                <p
                  className={`text-sm mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  To: {docTargetUser.name}
                </p>
              </div>

              <button
                type="button"
                disabled={sendingDoc}
                onClick={() => {
                  setDocTargetUser(null);
                  setDocFile(null);
                  setDocTemplateId("");
                }}
                className={`p-1.5 rounded-lg ${isDark ? "hover:bg-slate-700 text-gray-400" : "hover:bg-gray-100 text-gray-500"}`}
                aria-label="Close send document modal"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                  Select Existing Template
                </label>
                <select
                  value={docTemplateId}
                  onChange={(e) => {
                    setDocTemplateId(e.target.value);
                    setDocFile(null);
                  }}
                  className={`block w-full text-sm rounded-lg border px-3 py-2 mb-4 ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                >
                  <option value="">-- Choose Template --</option>
                  {availableTemplates.map(t => (
                    <option key={t.id} value={t.id}>{t.name} {t.category ? `(${t.category})` : ""}</option>
                  ))}
                </select>

                <div className="flex items-center gap-4 mb-4">
                  <hr className="flex-1 border-gray-300 dark:border-slate-600" />
                  <span className="text-sm font-medium text-gray-500">OR</span>
                  <hr className="flex-1 border-gray-300 dark:border-slate-600" />
                </div>

                <label
                  className={`block text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                >
                  Upload New PDF Document
                </label>

                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    setDocFile(e.target.files?.[0] || null);
                    setDocTemplateId("");
                  }}
                  className={`block w-full text-sm rounded-lg border px-3 py-2 ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                />

                {docFile && (
                  <p
                    className={`text-xs mt-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    Selected: {docFile.name}
                  </p>
                )}
              </div>

              <p
                className={`text-xs rounded-lg p-3 ${isDark ? "bg-blue-900/20 text-blue-300" : "bg-blue-50 text-blue-700"}`}
              >
                This PDF will appear in the employee notification panel. The
                employee can open, edit, and submit it.
              </p>
            </div>

            <div
              className={`p-5 border-t flex justify-end gap-3 ${isDark ? "border-slate-700" : "border-gray-200"}`}
            >
              <button
                type="button"
                disabled={sendingDoc}
                onClick={() => {
                  setDocTargetUser(null);
                  setDocFile(null);
                  setDocTemplateId("");
                }}
                className={`px-4 py-2 rounded-lg border text-sm font-medium ${isDark ? "border-slate-600 text-gray-300 hover:bg-slate-700" : "border-gray-300 text-gray-700 hover:bg-gray-100"}`}
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={(!docFile && !docTemplateId) || sendingDoc}
                onClick={handleSendDocument}
                className="px-5 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium disabled:opacity-50"
              >
                {sendingDoc ? "Sending..." : "Send Document"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slide-out Panel for Add/Edit */}
      {panelMode && (
        <UserFormPanel
          mode={panelMode}
          user={editUser}
          isDark={isDark}
          clients={localClients}
          departments={localDepts}
          allUsers={users}
          onClose={() => {
            setPanelMode(null);
            setEditUser(null);
          }}
          onSaved={() => {
            setPanelMode(null);
            setEditUser(null);
            fetchUsers();
            onRefreshUsers?.();
            showToast?.(
              panelMode === "add" ? "Employee added" : "Employee updated",
            );
          }}
        />
      )}

      <SendDocumentModal
        isOpen={sendDocModalOpen}
        onClose={() => setSendDocModalOpen(false)}
        isDark={isDark}
        templates={availableTemplates}
        users={users}
        templateId={sendDocTemplateId}
        setTemplateId={setSendDocTemplateId}
        selectedUserIds={sendDocUserIds}
        setSelectedUserIds={setSendDocUserIds}
        sending={sendingDocs}
        onSend={async () => {
          setSendingDocs(true);
          try {
            await api.nda.sendDocumentToUsers(sendDocTemplateId, sendDocUserIds);
            showToast?.(`Document sent to ${sendDocUserIds.length} users!`);
            setSendDocModalOpen(false);
          } catch(e) {
            showToast?.(e.message || "Failed to send document", "error");
          } finally {
            setSendingDocs(false);
          }
        }}
      />
    </div>
  );
}

/* ── Slide-out Panel for Add/Edit ──────────────────── */
function UserFormPanel({
  mode,
  user,
  isDark,
  clients,
  departments,
  allUsers,
  onClose,
  onSaved,
}) {
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(user?.role || "employee");
  const [departmentIds, setDepartmentIds] = useState(
    user?.department_id ? [user.department_id] : [],
  );
  const [clientIds, setClientIds] = useState(
    user?.client_id ? [user.client_id] : [],
  );
  const [teamLeadIds, setTeamLeadIds] = useState(
    user?.team_lead_id ? [user.team_lead_id] : [],
  );
  const [managerIds, setManagerIds] = useState(
    user?.manager_id ? [user.manager_id] : [],
  );
  const [dateOfBirth, setDateOfBirth] = useState(user?.date_of_birth || "");

  // Country code helpers
  const COUNTRY_CODES = [
    { code: "+91", label: "🇮🇳 +91 (India)" },
    { code: "+1", label: "🇺🇸 +1  (US/Canada)" },
    { code: "+44", label: "🇬🇧 +44 (UK)" },
    { code: "+61", label: "🇦🇺 +61 (Australia)" },
    { code: "+971", label: "🇦🇪 +971 (UAE)" },
    { code: "+65", label: "🇸🇬 +65 (Singapore)" },
    { code: "+60", label: "🇲🇾 +60 (Malaysia)" },
    { code: "+49", label: "🇩🇪 +49 (Germany)" },
    { code: "+33", label: "🇫🇷 +33 (France)" },
    { code: "+81", label: "🇯🇵 +81 (Japan)" },
  ];

  // Parse stored phone: if it starts with a known code, split it out
  const parsePhone = (raw) => {
    if (!raw) return { code: "+91", digits: "" };
    const s = raw.trim();
    // Try matching longest code first to avoid +1 matching +1x numbers
    const sorted = [...COUNTRY_CODES].sort(
      (a, b) => b.code.length - a.code.length,
    );
    for (const c of sorted) {
      if (s.startsWith(c.code))
        return { code: c.code, digits: s.slice(c.code.length).trim() };
    }
    return { code: "+91", digits: s };
  };

  const parsed = parsePhone(user?.phone);
  const [countryCode, setCountryCode] = useState(parsed.code);
  const [phone, setPhone] = useState(parsed.digits);

  const [designation, setDesignation] = useState(user?.designation || "");
  const [workTimezone, setWorkTimezone] = useState(
    user?.work_timezone || "Asia/Kolkata",
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setEmail(user.email || "");
      setRole(user.role || "employee");
      setDateOfBirth(user.date_of_birth || "");
      const parsedPhone = parsePhone(user.phone);
      setCountryCode(parsedPhone.code);
      setPhone(parsedPhone.digits);
      setDesignation(user.designation || "");
      setWorkTimezone(user.work_timezone || "Asia/Kolkata");
      setPassword("");
      // Fetch multi-assignments for this user
      api
        .getUserMultiAssignments()
        .then((data) => {
          const uid = user.id;
          setDepartmentIds(
            (data.user_departments || [])
              .filter((r) => r.user_id === uid)
              .map((r) => r.department_id),
          );
          setClientIds(
            (data.user_clients || [])
              .filter((r) => r.user_id === uid)
              .map((r) => r.client_id),
          );
          setManagerIds(
            (data.user_managers || [])
              .filter((r) => r.user_id === uid)
              .map((r) => r.manager_id),
          );
          setTeamLeadIds(
            (data.user_team_leads || [])
              .filter((r) => r.user_id === uid)
              .map((r) => r.team_lead_id),
          );
        })
        .catch(() => {
          setDepartmentIds(user.department_id ? [user.department_id] : []);
          setClientIds(user.client_id ? [user.client_id] : []);
          setManagerIds(user.manager_id ? [user.manager_id] : []);
          setTeamLeadIds(user.team_lead_id ? [user.team_lead_id] : []);
        });
    } else {
      setName("");
      setEmail("");
      setPassword("");
      setRole("employee");
      setDepartmentIds([]);
      setClientIds([]);
      setTeamLeadIds([]);
      setManagerIds([]);
      setDateOfBirth("");
      setPhone("");
      setDesignation("");
      setWorkTimezone("Asia/Kolkata");
      setCountryCode("+91");
    }
  }, [user]);

  const teamLeads = allUsers.filter(
    (u) => u.role === "team_lead" && u.id !== user?.id && u.is_active !== false,
  );
  const managers = allUsers.filter(
    (u) => u.role === "manager" && u.id !== user?.id && u.is_active !== false,
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      if (mode === "add") {
        if (password.length < 6) {
          setError("Password must be at least 6 characters");
          setSaving(false);
          return;
        }
        const created = await api.createUser({
          email: email.trim(),
          password,
          name: name.trim(),
          role,
          client_id: clientIds[0] || null,
          manager_id: managerIds[0] || null,
          team_lead_id: teamLeadIds[0] || null,
          department_id: departmentIds[0] || null,
          phone: phone.trim() ? `${countryCode}${phone.trim()}` : null,
          designation: designation.trim() || null,
          work_timezone: workTimezone,
        });
        if (created?.id) {
          try {
            await api.nda.createRequestForEmployee({
              id: created.id,
              name: created.name || name.trim(),
              full_name: created.full_name || created.name || name.trim(),
              email: created.email || email.trim(),
            });
          } catch (ndaErr) {
            console.warn("Failed to create NDA request for employee", ndaErr);
          }
          try {
            await api.saveUserMultiAssignments(created.id, {
              department_ids: departmentIds,
              client_ids: clientIds,
              manager_ids: managerIds,
              team_lead_ids: teamLeadIds,
            });
          } catch (_) {}
        }
      } else {
        const body = {
          email: email.trim(),
          name: name.trim(),
          role,
          client_id: clientIds[0] || null,
          department_id: departmentIds[0] || null,
          team_lead_id: teamLeadIds[0] || null,
          manager_id: managerIds[0] || null,
          date_of_birth:
            dateOfBirth.trim() && /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth.trim())
              ? dateOfBirth.trim()
              : null,
          phone: phone.trim() ? `${countryCode}${phone.trim()}` : null,
          designation: designation.trim() || null,
          work_timezone: workTimezone,
        };
        if (password.trim().length >= 6) body.password = password;
        await api.updateUser(user.id, body);
        await api.saveUserMultiAssignments(user.id, {
          department_ids: departmentIds,
          client_ids: clientIds,
          manager_ids: managerIds,
          team_lead_ids: teamLeadIds,
        });
      }
      onSaved();
    } catch (err) {
      const raw = err.data?.error;
      const msg = Array.isArray(raw)
        ? raw.map((e) => `${(e.path || []).join(".")}: ${e.message}`).join(", ")
        : typeof raw === "string"
          ? raw
          : err.message || "Failed";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const inputClass = isDark
    ? "bg-slate-700 border-slate-600 text-white rounded-lg px-3 py-2 w-full text-sm border"
    : "bg-white border-gray-300 text-gray-900 rounded-lg px-3 py-2 w-full text-sm border";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" aria-hidden="true" />
      <div
        className={`relative w-full max-w-lg shadow-2xl flex flex-col max-h-full overflow-y-auto ${isDark ? "bg-slate-800" : "bg-white"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Panel header */}
        <div
          className={`p-5 border-b flex items-center justify-between flex-shrink-0 ${isDark ? "border-slate-700" : "border-gray-200"}`}
        >
          <h2
            className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}
          >
            {mode === "add" ? "Add New Employee" : `Edit: ${user?.name}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className={`p-1.5 rounded-lg ${isDark ? "hover:bg-slate-700 text-gray-400" : "hover:bg-gray-100 text-gray-500"}`}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="p-5 space-y-4 flex-1 overflow-y-auto"
          autoComplete="off"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Full Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className={inputClass}
                placeholder="John Doe"
              />
            </div>
            {/* Fake autofill trap - keep before real email/password */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: "-9999px",
                width: "1px",
                height: "1px",
                overflow: "hidden",
              }}
            >
              <input
                type="text"
                name="username"
                autoComplete="username"
                tabIndex={-1}
              />
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                tabIndex={-1}
              />
            </div>

            <div className="sm:col-span-2">
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Email *
              </label>
              <input
                type="text"
                inputMode="email"
                name="new_employee_email_field"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputClass}
                placeholder="john@example.com"
              />
            </div>
            <div className="sm:col-span-2">
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {mode === "add"
                  ? "Password *"
                  : "New Password (leave blank to keep current)"}
              </label>
              <input
                type="password"
                name="new_employee_password_field"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder={
                  mode === "add"
                    ? "Min 6 characters"
                    : "Leave blank to keep current"
                }
                minLength={mode === "add" ? 6 : undefined}
                required={mode === "add"}
              />
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Role *
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className={inputClass}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Departments
              </label>
              <div
                className={`border rounded-lg max-h-28 overflow-y-auto p-2 ${isDark ? "border-slate-600 bg-slate-700" : "border-gray-300 bg-gray-50"}`}
              >
                {departments.length === 0 && (
                  <p className="text-xs text-gray-400">No departments</p>
                )}
                {departments.map((d) => (
                  <label
                    key={d.id}
                    className={`flex items-center gap-2 py-0.5 text-sm cursor-pointer ${isDark ? "text-gray-200" : "text-gray-800"}`}
                  >
                    <input
                      type="checkbox"
                      checked={departmentIds.includes(d.id)}
                      onChange={(e) => {
                        if (e.target.checked)
                          setDepartmentIds((p) => [...p, d.id]);
                        else
                          setDepartmentIds((p) => p.filter((x) => x !== d.id));
                      }}
                      className="rounded"
                    />
                    {d.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Clients
              </label>
              <div
                className={`border rounded-lg max-h-28 overflow-y-auto p-2 ${isDark ? "border-slate-600 bg-slate-700" : "border-gray-300 bg-gray-50"}`}
              >
                {clients.length === 0 && (
                  <p className="text-xs text-gray-400">No clients</p>
                )}
                {clients.map((c) => (
                  <label
                    key={c.id}
                    className={`flex items-center gap-2 py-0.5 text-sm cursor-pointer ${isDark ? "text-gray-200" : "text-gray-800"}`}
                  >
                    <input
                      type="checkbox"
                      checked={clientIds.includes(c.id)}
                      onChange={(e) => {
                        if (e.target.checked) setClientIds((p) => [...p, c.id]);
                        else setClientIds((p) => p.filter((x) => x !== c.id));
                      }}
                      className="rounded"
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Team Leads
              </label>
              <div
                className={`border rounded-lg max-h-28 overflow-y-auto p-2 ${isDark ? "border-slate-600 bg-slate-700" : "border-gray-300 bg-gray-50"}`}
              >
                {teamLeads.length === 0 && (
                  <p className="text-xs text-gray-400">No team leads</p>
                )}
                {teamLeads.map((u) => (
                  <label
                    key={u.id}
                    className={`flex items-center gap-2 py-0.5 text-sm cursor-pointer ${isDark ? "text-gray-200" : "text-gray-800"}`}
                  >
                    <input
                      type="checkbox"
                      checked={teamLeadIds.includes(u.id)}
                      onChange={(e) => {
                        if (e.target.checked)
                          setTeamLeadIds((p) => [...p, u.id]);
                        else setTeamLeadIds((p) => p.filter((x) => x !== u.id));
                      }}
                      className="rounded"
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Managers
              </label>
              <div
                className={`border rounded-lg max-h-28 overflow-y-auto p-2 ${isDark ? "border-slate-600 bg-slate-700" : "border-gray-300 bg-gray-50"}`}
              >
                {managers.length === 0 && (
                  <p className="text-xs text-gray-400">No managers</p>
                )}
                {managers.map((u) => (
                  <label
                    key={u.id}
                    className={`flex items-center gap-2 py-0.5 text-sm cursor-pointer ${isDark ? "text-gray-200" : "text-gray-800"}`}
                  >
                    <input
                      type="checkbox"
                      checked={managerIds.includes(u.id)}
                      onChange={(e) => {
                        if (e.target.checked)
                          setManagerIds((p) => [...p, u.id]);
                        else setManagerIds((p) => p.filter((x) => x !== u.id));
                      }}
                      className="rounded"
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Designation
              </label>
              <input
                type="text"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                className={inputClass}
                placeholder="e.g. Field Technician"
              />
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Timezone
              </label>
              <select
                value={workTimezone}
                onChange={(e) => setWorkTimezone(e.target.value)}
                className={inputClass}
              >
                <option value="Asia/Kolkata">IST (Asia/Kolkata)</option>
                <option value="America/Chicago">CST (America/Chicago)</option>
                <option value="America/New_York">EST (America/New_York)</option>
                <option value="America/Denver">MST (America/Denver)</option>
                <option value="America/Los_Angeles">
                  PST (America/Los_Angeles)
                </option>
                <option value="Etc/UTC">UTC</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Phone
              </label>

              <div className="grid grid-cols-[150px_1fr] gap-3 items-center">
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className={`${inputClass} min-w-0`}
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>

                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  className={inputClass}
                  placeholder="9876543210"
                />
              </div>

              {phone && (
                <p
                  className={`text-xs mt-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}
                >
                  Will be saved as:
                  <span className="font-mono font-medium ml-1">
                    {countryCode}
                    {phone}
                  </span>
                </p>
              )}
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Date of Birth
              </label>
              <input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
              {typeof error === "string" ? error : JSON.stringify(error)}
            </p>
          )}
        </form>

        {/* Panel footer */}
        <div
          className={`p-5 border-t flex gap-3 flex-shrink-0 ${isDark ? "border-slate-700" : "border-gray-200"}`}
        >
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2.5 rounded-lg border text-sm font-medium ${isDark ? "border-slate-600 text-gray-300 hover:bg-slate-700" : "border-gray-300 text-gray-700 hover:bg-gray-100"}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            onClick={handleSubmit}
            className="px-6 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {saving
              ? "Saving..."
              : mode === "add"
                ? "Add Employee"
                : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SendDocumentModal({
  isOpen,
  onClose,
  isDark,
  templates,
  users,
  templateId,
  setTemplateId,
  selectedUserIds,
  setSelectedUserIds,
  onSend,
  sending,
}) {
  if (!isOpen) return null;
  const inputClass = isDark
    ? "bg-slate-700 border-slate-600 text-white rounded-lg px-3 py-2 w-full text-sm border"
    : "bg-white border-gray-300 text-gray-900 rounded-lg px-3 py-2 w-full text-sm border";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className={`w-full max-w-lg rounded-xl shadow-xl flex flex-col max-h-[90vh] ${isDark ? "bg-slate-800" : "bg-white"}`}>
        <div className={`p-5 border-b flex items-center justify-between ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          <h2 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Send Document to Users</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Select Document Template</label>
            <select value={templateId} onChange={e => setTemplateId(e.target.value)} className={inputClass}>
              <option value="">-- Choose Template --</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} {t.category ? `(${t.category})` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium">Select Users</label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer hover:text-brand">
                <input 
                  type="checkbox" 
                  className="accent-brand"
                  checked={selectedUserIds.length === users.filter(u => u.is_active !== false).length && users.filter(u => u.is_active !== false).length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedUserIds(users.filter(u => u.is_active !== false).map(u => u.id));
                    } else {
                      setSelectedUserIds([]);
                    }
                  }}
                />
                Select All
              </label>
            </div>
            <div className={`border rounded-lg max-h-60 overflow-y-auto p-2 space-y-1 ${isDark ? "border-slate-700 bg-slate-900/50" : "border-gray-200 bg-gray-50"}`}>
              {users.filter(u => u.is_active !== false).map(u => (
                <label key={u.id} className="flex items-center gap-2 p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded cursor-pointer">
                  <input type="checkbox" checked={selectedUserIds.includes(u.id)} onChange={e => {
                    if (e.target.checked) setSelectedUserIds(prev => [...prev, u.id]);
                    else setSelectedUserIds(prev => prev.filter(id => id !== u.id));
                  }} className="accent-brand" />
                  <span className="text-sm">{u.name} <span className="text-xs text-gray-400">({u.role})</span></span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">{selectedUserIds.length} users selected</p>
          </div>
        </div>
        <div className={`p-5 border-t flex gap-3 flex-shrink-0 justify-end ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          <button onClick={onClose} className={`px-4 py-2 rounded-lg border text-sm font-medium ${isDark ? "border-slate-600 text-gray-300 hover:bg-slate-700" : "border-gray-300 text-gray-700 hover:bg-gray-100"}`}>
            Cancel
          </button>
          <button disabled={sending || !templateId || selectedUserIds.length === 0} onClick={onSend} className="px-5 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium disabled:opacity-50">
            {sending ? "Sending..." : "Send Document"}
          </button>
        </div>
      </div>
    </div>
  );
}

