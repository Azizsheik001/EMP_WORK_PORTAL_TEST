import React, { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { api } from '../api/client';

// ── Helpers ─────────────────────────────────────────────────────

const STATUS_COLORS = {
  available: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  assigned: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  under_repair: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  retired: 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400',
};

const STATUS_LABELS = {
  available: 'Available',
  assigned: 'Assigned',
  under_repair: 'Under Repair',
  retired: 'Retired',
};

const CATEGORY_TAG_PREFIX = {
  Laptop: 'AGS-LAP',
  Mouse: 'AGS-MOU',
  Headset: 'AGS-HDS',
  Monitor: 'AGS-MON',
  Keyboard: 'AGS-KEY',
};

function warrantyClass(expiryDate) {
  if (!expiryDate) return '';
  const now = new Date();
  const exp = new Date(expiryDate);
  if (exp < now) return 'text-red-600 dark:text-red-400 font-medium';
  const thirtyDays = new Date();
  thirtyDays.setDate(thirtyDays.getDate() + 30);
  if (exp <= thirtyDays) return 'text-amber-600 dark:text-amber-400 font-medium';
  return 'text-green-600 dark:text-green-400';
}

function formatDate(d) {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatCurrency(v) {
  if (v == null) return '--';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(v);
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

function getCategoryColor(category) {
  const cat = (category || '').toLowerCase();
  if (cat.includes('laptop')) return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300';
  if (cat.includes('mouse')) return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
  if (cat.includes('headset')) return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300';
  if (cat.includes('keyboard')) return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300';
  if (cat.includes('monitor')) return 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300';
  return 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-300';
}

// ── Sub-view constants ──────────────────────────────────────────
const SUB_VIEWS = { LIST: 'list', BY_EMPLOYEE: 'by_employee', CATEGORIES: 'categories', UPLOAD: 'upload' };

// Depreciation helper: 10% per year from purchase_date
function calcDepreciation(purchaseDate, purchaseCost) {
  if (!purchaseDate || !purchaseCost) return { pct: 0, currentValue: purchaseCost || 0, needsReplacement: false };
  const pd = new Date(purchaseDate);
  const now = new Date();
  const yearsOwned = (now - pd) / (365.25 * 24 * 60 * 60 * 1000);
  const pct = Math.min(100, Math.round(yearsOwned * 10));
  const currentValue = Math.max(0, (purchaseCost || 0) * (1 - pct / 100));
  return { pct, currentValue: Math.round(currentValue * 100) / 100, needsReplacement: pct >= 100 };
}

// ── Main Component ──────────────────────────────────────────────

export default function AssetManagementView({ isDark, currentUser, showToast }) {
  const [subView, setSubView] = useState(SUB_VIEWS.BY_EMPLOYEE);
  const [assets, setAssets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [users, setUsers] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [currentEmpPage, setCurrentEmpPage] = useState(1);
  const itemsPerPage = 15;

  // Filters
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Expandable groups
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const toggleGroup = (empId, e) => {
    e.stopPropagation();
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(empId)) next.delete(empId);
      else next.add(empId);
      return next;
    });
  };

  // Modals
  const [addAssetOpen, setAddAssetOpen] = useState(false);
  const [assignModalAsset, setAssignModalAsset] = useState(null);
  const [detailAsset, setDetailAsset] = useState(null);
  const [editAsset, setEditAsset] = useState(null);
  const [prefillEmployee, setPrefillEmployee] = useState(null); // { id, name } to pre-select employee in Add modal
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [editCategory, setEditCategory] = useState(null);

  // Employee-centric view
  const [employeeAssets, setEmployeeAssets] = useState([]);
  const [kitModalEmployee, setKitModalEmployee] = useState(null);

  // CSV upload state
  const [csvRows, setCsvRows] = useState([]);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState(null);

  const handleCsvFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result;

        // Robust CSV Parser (handles newlines inside quotes)
        const parseCSV = (str) => {
          const result = [];
          let currentRow = [];
          let currentCell = '';
          let inQuotes = false;
          for (let i = 0; i < str.length; i++) {
            let char = str[i];
            let nextChar = str[i + 1];
            if (char === '"') {
              if (inQuotes && nextChar === '"') {
                currentCell += '"';
                i++; // skip escaped quote
              } else {
                inQuotes = !inQuotes;
              }
            } else if (char === ',' && !inQuotes) {
              currentRow.push(currentCell.trim());
              currentCell = '';
            } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !inQuotes) {
              if (char === '\r') i++;
              currentRow.push(currentCell.trim());
              if (currentRow.some(c => c)) result.push(currentRow);
              currentRow = [];
              currentCell = '';
            } else {
              currentCell += char;
            }
          }
          if (currentCell !== '' || currentRow.length > 0) {
            currentRow.push(currentCell.trim());
            if (currentRow.some(c => c)) result.push(currentRow);
          }
          return result;
        };

        const parsedRows = parseCSV(text);
        if (parsedRows.length < 2) { setError('CSV must have a header row and at least one data row'); return; }

        const headers = parsedRows[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
        const rows = [];

        for (let i = 1; i < parsedRows.length; i++) {
          const values = parsedRows[i];
          if (values.every((v) => !v)) continue;
          const row = {};
          headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

          // Flexible matching for Excel export headers
          // Try exact matches or startsWith first, then fallback to includes
          const getKey = (keywords) => {
            const keys = Object.keys(row);
            for (const kw of keywords) {
              const exact = keys.find(k => k === kw);
              if (exact) return exact;
            }
            for (const kw of keywords) {
              const starts = keys.find(k => k.startsWith(kw));
              if (starts) return starts;
            }
            return keys.find(k => keywords.some(kw => k.includes(kw)));
          };

          const empIdRaw = (row[getKey(['emp_id', 'employee_id'])] || '').toString().trim();
          const empName = (row[getKey(['name', 'employee_name'])] || '').toString().trim();

          // Resolve employee_no to system user.id so that dropdowns match
          let empId = empIdRaw;
          if (empIdRaw) {
            const matched = users.find(u => u.employee_no?.toLowerCase() === empIdRaw.toLowerCase());
            if (matched) empId = matched.id;
          } else if (empName) {
            const matched = users.find(u => u.name?.toLowerCase() === empName.toLowerCase());
            if (matched) empId = matched.id;
          }

          const addAsset = (category, modelRaw, extras = {}) => {
            const fullModel = (modelRaw || '').toString().trim();
            if (fullModel && fullModel.toLowerCase() !== 'no' && fullModel.toLowerCase() !== 'n/a' && fullModel.toLowerCase() !== 'na') {
              let brand = '';
              let model = fullModel;
              
              // Extract Brand from the first word of the model string
              const parts = fullModel.split(' ');
              if (parts.length > 1) {
                 brand = parts[0];
                 model = parts.slice(1).join(' ');
              } else {
                 brand = fullModel; // Fallback if it's only one word
              }

              rows.push({
                category: category,
                brand: brand,
                model: model,
                notes: (extras.notes || '').toString().trim() || '',
                serial_number: (extras.serial_number || '').toString().trim() || '',
                asset_tag_override: extras.asset_tag_override || '',
                purchase_cost: extras.purchase_cost ? parseFloat(extras.purchase_cost) || '' : '',
                purchase_date: extras.purchase_date || '',
                warranty_expiry_date: (extras.warranty || '').toString().trim() || '',
                assigned_to_emp_id: empId,
                assigned_to_emp_name: empName,
                status: empId ? 'assigned' : 'available'
              });
            }
          };

          // Extract shared/per-device fields from the new template columns
          const laptopAssetNo = row[getKey(['laptop_asset_no', 'laptop_asset'])] || '';
          const laptopSerial = row[getKey(['laptop_serial_no', 'laptop_serial', 'serial'])] || '';
          const laptopSpec = row[getKey(['laptop_device_spec', 'device_spec', 'specification'])] || '';
          const purchaseCost = row[getKey(['purchase_cost', 'cost', 'price'])] || '';
          const warranty = row[getKey(['warranty_expiry', 'warranty'])] || '';
          const purchaseDate = row[getKey(['purchase_date'])] || '';

          addAsset('Laptop', row[getKey(['laptop_model', 'laptop_brand', 'laptop'])] || row['laptop model & brand'] || row['laptop_model_&_brand'], {
            notes: laptopSpec || row['laptop device specification & windows\uFFFDspecification'] || row['laptop_device_specification_&_windows_specification'],
            serial_number: laptopSerial,
            asset_tag_override: laptopAssetNo,
            purchase_cost: purchaseCost,
            purchase_date: purchaseDate,
            warranty: warranty
          });
          addAsset('Mouse', row[getKey(['mouse_model', 'mouse_brand', 'mouse'])] || row['mouse model (wired mouse or wireless)'] || row['mouse_model_(wired_mouse_or_wireless)'], {
            notes: row[getKey(['mouse_device_spec', 'mouse_spec'])] || '',
            asset_tag_override: row[getKey(['mouse_asset_no', 'mouse_asset'])] || ''
          });
          addAsset('Headset', row[getKey(['headset_model', 'headset_brand', 'headset'])] || row['headset & model number'] || row['headset_&_model_number'], {
            notes: row[getKey(['headset_device_spec', 'headset_spec'])] || '',
            asset_tag_override: row[getKey(['headset_asset_no', 'headset_asset'])] || ''
          });
          addAsset('Keyboard', row[getKey(['keyboard_model', 'keyboard_brand', 'keyboard'])] || row['keyboard (brand, model number)'] || row['keyboard_(brand,_model_number)'], {
            notes: row[getKey(['keyboard_device_spec', 'keyboard_spec'])] || '',
            asset_tag_override: row[getKey(['keyboard_asset_no', 'keyboard_asset'])] || ''
          });

          const others = row[getKey(['other_assets', 'other'])];
          if (others) addAsset('Other', others, {});
        }

        setCsvRows(rows);
        setCsvResult(null);
      } catch (_) {
        setError('Failed to parse CSV file');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleCsvUpload = async () => {
    if (csvRows.length === 0) return;
    setCsvUploading(true);
    setCsvResult(null);
    try {
      const result = await api.assets.bulkCsv(csvRows);
      setCsvResult(result);
      if (result.created > 0) {
        showToast?.(`${result.created} assets imported successfully`);
        fetchAll();
      }
    } catch (e) {
      setError(e.message || 'Failed to upload assets');
    } finally {
      setCsvUploading(false);
    }
  };

  const handleDownloadTemplate = () => {
    const headers = [
      'EMP_ID', 'EMPLOYEE_NAME',
      'LAPTOP_ASSET_NO', 'LAPTOP_MODEL', 'LAPTOP_SERIAL_NO', 'LAPTOP_DEVICE_SPEC', 'PURCHASE_DATE', 'WARRANTY_EXPIRY', 'PURCHASE_COST',
      'MOUSE_ASSET_NO', 'MOUSE_MODEL', 'MOUSE_DEVICE_SPEC',
      'KEYBOARD_ASSET_NO', 'KEYBOARD_MODEL', 'KEYBOARD_DEVICE_SPEC',
      'HEADSET_ASSET_NO', 'HEADSET_MODEL', 'HEADSET_DEVICE_SPEC',
      'OTHER_ASSETS'
    ].join(',');
    const example = [
      'LI1001', 'John Doe',
      'LAP-001', 'Dell Inspiron 14 5430', 'SN-DELL-12345', '16GB RAM / 512GB SSD / Windows 11', '2024-01-15', '2027-01-15', '65000',
      'MSE-001', 'Dell Wireless WM118', 'Wireless USB Mouse',
      'KBD-001', 'Dell Wireless KB216', 'Wireless USB Keyboard',
      'HST-001', 'Noise CM7003', 'Noise Cancelling Headset',
      'USB Hub'
    ].join(',');
    const template = `${headers}\n${example}`;
    const blob = new Blob([template], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'employee-assets-upload-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  //Data fetching

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [assetData, catData, dashData, userData, empAssetData] = await Promise.all([
        api.assets.list({ category_id: filterCategory || undefined, status: filterStatus || undefined, search: searchQuery || undefined }),
        api.assets.categories(),
        api.assets.dashboard(),
        api.users().catch(() => ({ users: [
          { id: 'mock-1', name: 'John Doe', employee_no: 'LI1001', email: 'john@example.com' },
          { id: 'mock-2', name: 'Jane Smith', employee_no: 'LI1002', email: 'jane@example.com' }
        ] })),
        api.assets.byEmployee().catch(() => ({ employees: [] })),
      ]);
      setAssets(assetData.assets || []);
      setCategories(catData.categories || []);
      setDashboard(dashData);
      setUsers(userData.users || []);
      setEmployeeAssets(empAssetData.employees || []);
    } catch (e) {
      if (e.status !== 401) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterCategory, filterStatus, searchQuery]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ── Filtered assets ─────────────────────────────────────────

  const filteredAssets = useMemo(() => assets, [assets]);

  useEffect(() => { setCurrentPage(1); }, [searchQuery, filterCategory, filterStatus, subView]);
  useEffect(() => { setCurrentEmpPage(1); }, [employeeAssets, subView]);

  const sortedFiltered = useMemo(() => [...filteredAssets].sort((a, b) => {
    const nameA = a.assigned_to_name || 'ZZZ';
    const nameB = b.assigned_to_name || 'ZZZ';
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    // Sort Laptop/Primary first
    const catA = a.category_name?.toLowerCase() || '';
    const catB = b.category_name?.toLowerCase() || '';
    if (catA === 'laptop' && catB !== 'laptop') return -1;
    if (catA !== 'laptop' && catB === 'laptop') return 1;
    return 0;
  }), [filteredAssets]);

  const groupedFiltered = useMemo(() => {
    const groups = [];
    const empMap = new Map();

    sortedFiltered.forEach(asset => {
      if (!asset.assigned_to_id) {
        groups.push({ isGroup: false, ...asset });
      } else {
        if (!empMap.has(asset.assigned_to_id)) {
          const newGroup = { isGroup: true, assigned_to_id: asset.assigned_to_id, assigned_to_name: asset.assigned_to_name, assets: [] };
          empMap.set(asset.assigned_to_id, newGroup);
          groups.push(newGroup);
        }
        empMap.get(asset.assigned_to_id).assets.push(asset);
      }
    });
    
    return groups.map(g => {
      if (g.isGroup && g.assets.length === 1) {
        return { isGroup: false, ...g.assets[0] };
      }
      return g;
    });
  }, [sortedFiltered]);

  const totalPages = Math.max(1, Math.ceil(groupedFiltered.length / itemsPerPage));
  const paginatedGroups = useMemo(() => groupedFiltered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage), [groupedFiltered, currentPage]);

  const sortedEmployeeKits = useMemo(() => [...employeeAssets].sort((a, b) => (a.employee_name || '').localeCompare(b.employee_name || '')), [employeeAssets]);
  const empTotalPages = Math.max(1, Math.ceil(sortedEmployeeKits.length / itemsPerPage));
  const paginatedEmpKits = useMemo(() => sortedEmployeeKits.slice((currentEmpPage - 1) * itemsPerPage, currentEmpPage * itemsPerPage), [sortedEmployeeKits, currentEmpPage]);

  const cardClass = isDark
    ? 'bg-slate-800 border-slate-700 text-white shadow-sm'
    : 'bg-white border-gray-200 text-gray-900 shadow-sm';
  const tableRowClass = isDark
    ? 'border-slate-700 hover:bg-slate-700/50'
    : 'border-gray-200 hover:bg-gray-50';
  const inputClass = isDark
    ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400 focus:border-brand focus:ring-brand'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-brand focus:ring-brand';
  const selectClass = `${inputClass} rounded-lg px-3 py-2 text-sm border`;

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Asset Management</h1>
        <div className={`flex flex-wrap p-1 rounded-xl shadow-sm border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-gray-100/80 border-gray-200'}`}>
          {[
            { key: SUB_VIEWS.LIST, label: 'Assets' },
            { key: SUB_VIEWS.BY_EMPLOYEE, label: 'By Employee' },
            { key: SUB_VIEWS.CATEGORIES, label: 'Categories' },
            { key: SUB_VIEWS.UPLOAD, label: 'Upload CSV' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSubView(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${subView === tab.key
                  ? `shadow-sm ${isDark ? 'bg-brand text-white' : 'bg-white text-brand border border-gray-200/50'}`
                  : isDark ? 'text-gray-400 hover:text-gray-200 hover:bg-slate-700/50' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-200/50'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button type="button" onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600 p-0.5" aria-label="Dismiss error">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {subView === SUB_VIEWS.LIST && (
        <>
          {/* Dashboard cards */}
          {dashboard && <DashboardCards dashboard={dashboard} isDark={isDark} cardClass={cardClass} />}

          {/* Filters + Add button */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`${selectClass} w-full sm:w-48`}
            />
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={selectClass}>
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={selectClass}>
              <option value="">All Statuses</option>
              <option value="available">Available</option>
              <option value="assigned">Assigned</option>
              <option value="under_repair">Under Repair</option>
              <option value="retired">Retired</option>
            </select>
            <div className="ml-auto">
              <button
                type="button"
                onClick={() => { setPrefillEmployee(null); setEditAsset(null); setAddAssetOpen(true); }}
                className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium transition-colors"
              >
                + Add Asset
              </button>
            </div>
          </div>

          {/* Asset table */}
          <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
            {loading ? (
              <div className="p-8 text-center">
                <div className="inline-block w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading assets...</p>
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className="py-16 px-6 text-center">
                <div className="mx-auto w-16 h-16 bg-gray-50 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4 border border-gray-100 dark:border-slate-700">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">No assets found</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Get started by creating a new asset or change your search filters.</p>
                <button type="button" onClick={() => { setPrefillEmployee(null); setEditAsset(null); setAddAssetOpen(true); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium transition-colors shadow-sm">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  Add Asset
                </button>
              </div>
            ) : (
              <div className="flex flex-col h-full">
                <div className="overflow-x-auto flex-1">
                  <table className="w-full min-w-full text-left text-sm">
                    <thead className={isDark ? 'bg-slate-800/80' : 'bg-gray-50/80'}>
                      <tr className={`border-b ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
                        <th className="px-4 py-3 font-medium whitespace-nowrap">Employee</th>
                        <th className="px-4 py-3 font-medium whitespace-nowrap">Category</th>
                        <th className="px-4 py-3 font-medium hidden md:table-cell whitespace-nowrap">Asset Tag</th>
                        <th className="px-4 py-3 font-medium whitespace-nowrap">Brand / Model</th>
                        <th className="px-4 py-3 font-medium whitespace-nowrap">Status</th>
                        <th className="px-4 py-3 font-medium hidden lg:table-cell whitespace-nowrap">Depreciation</th>
                        <th className="px-4 py-3 font-medium hidden lg:table-cell whitespace-nowrap">Warranty Expiry</th>
                        <th className="px-4 py-3 font-medium whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedGroups.map((item) => {
                        if (!item.isGroup) {
                          const asset = item;
                          const dep = calcDepreciation(asset.purchase_date, parseFloat(asset.purchase_cost));
                          return (
                            <tr key={asset.id} className={`border-b cursor-pointer ${tableRowClass}`} onClick={() => setDetailAsset(asset)}>
                              <td className="px-4 py-3 font-medium">
                                {asset.assigned_to_name ? (
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-brand/10 text-brand flex items-center justify-center text-xs font-bold shrink-0">
                                      {getInitials(asset.assigned_to_name)}
                                    </div>
                                    <span className="truncate max-w-[150px]" title={asset.assigned_to_name}>{asset.assigned_to_name}</span>
                                  </div>
                                ) : (
                                  <span className="text-gray-400 italic">Unassigned</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${getCategoryColor(asset.category_name)}`}>
                                  {asset.category_name || 'Other'}
                                </span>
                              </td>
                              <td className="px-4 py-3 hidden md:table-cell font-mono text-xs">{asset.asset_tag || '--'}</td>
                              <td className="px-4 py-3">{asset.brand} {asset.model}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[asset.status]}`}>
                                  {STATUS_LABELS[asset.status]}
                                </span>
                              </td>
                              <td className="px-4 py-3 hidden lg:table-cell">
                                {asset.purchase_date && asset.purchase_cost ? (
                                  <div className="flex flex-col">
                                    <div className="flex items-center gap-1.5">
                                      <div className="w-16 h-1.5 rounded-full bg-gray-200 dark:bg-slate-600 overflow-hidden">
                                        <div className={`h-full rounded-full ${dep.pct >= 100 ? 'bg-red-500' : dep.pct >= 75 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${dep.pct}%` }} />
                                      </div>
                                      <span className={`text-xs font-medium ${dep.pct >= 100 ? 'text-red-600 dark:text-red-400' : dep.pct >= 75 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-600 dark:text-gray-400'}`}>
                                        {dep.pct}%
                                      </span>
                                    </div>
                                    {dep.needsReplacement && (
                                      <span className="text-[10px] text-red-500 font-medium mt-0.5">Needs replacement</span>
                                    )}
                                  </div>
                                ) : '--'}
                              </td>
                              <td className={`px-4 py-3 hidden lg:table-cell ${warrantyClass(asset.warranty_expiry_date)}`}>
                                {formatDate(asset.warranty_expiry_date)}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  {asset.status === 'available' && (
                                    <button type="button" onClick={() => setAssignModalAsset(asset)} className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 transition-colors tooltip-trigger" title="Assign">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                                    </button>
                                  )}
                                  {asset.status === 'assigned' && (
                                    <>
                                      <button type="button" onClick={() => { setPrefillEmployee({ id: asset.assigned_to_id, name: asset.assigned_to_name }); setEditAsset(null); setAddAssetOpen(true); }} className="p-1.5 rounded-lg bg-brand/10 text-brand hover:bg-brand/20 transition-colors" title="Add to Kit">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                      </button>
                                      <button type="button" onClick={() => handleUnassign(asset)} className="p-1.5 rounded-lg bg-orange-50 text-orange-600 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400 dark:hover:bg-orange-900/50 transition-colors" title="Unassign">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" /></svg>
                                      </button>
                                    </>
                                  )}
                                  <button type="button" onClick={() => { setEditAsset(asset); setPrefillEmployee(null); setAddAssetOpen(true); }} className="p-1.5 rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600 transition-colors" title="Edit Asset">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        } else {
                          // Grouped row
                          const firstAsset = item.assets[0];
                          const remainingAssets = item.assets.slice(1);
                          const isExpanded = expandedGroups.has(item.assigned_to_id);
                          const dep = calcDepreciation(firstAsset.purchase_date, parseFloat(firstAsset.purchase_cost));

                          const renderAssetCols = (asset) => {
                            const d = calcDepreciation(asset.purchase_date, parseFloat(asset.purchase_cost));
                            return (
                              <>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${getCategoryColor(asset.category_name)}`}>
                                    {asset.category_name || 'Other'}
                                  </span>
                                </td>
                                <td className="px-4 py-3 hidden md:table-cell font-mono text-xs">{asset.asset_tag || '--'}</td>
                                <td className="px-4 py-3">{asset.brand} {asset.model}</td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[asset.status]}`}>
                                    {STATUS_LABELS[asset.status]}
                                  </span>
                                </td>
                                <td className="px-4 py-3 hidden lg:table-cell">
                                  {asset.purchase_date && asset.purchase_cost ? (
                                    <div className="flex flex-col">
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-16 h-1.5 rounded-full bg-gray-200 dark:bg-slate-600 overflow-hidden">
                                          <div className={`h-full rounded-full ${d.pct >= 100 ? 'bg-red-500' : d.pct >= 75 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${d.pct}%` }} />
                                        </div>
                                        <span className={`text-xs font-medium ${d.pct >= 100 ? 'text-red-600 dark:text-red-400' : d.pct >= 75 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-600 dark:text-gray-400'}`}>
                                          {d.pct}%
                                        </span>
                                      </div>
                                      {d.needsReplacement && (
                                        <span className="text-[10px] text-red-500 font-medium mt-0.5">Needs replacement</span>
                                      )}
                                    </div>
                                  ) : '--'}
                                </td>
                                <td className={`px-4 py-3 hidden lg:table-cell ${warrantyClass(asset.warranty_expiry_date)}`}>
                                  {formatDate(asset.warranty_expiry_date)}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    {asset.status === 'assigned' && (
                                      <>
                                        <button type="button" onClick={() => { setPrefillEmployee({ id: asset.assigned_to_id, name: asset.assigned_to_name }); setEditAsset(null); setAddAssetOpen(true); }} className="p-1.5 rounded-lg bg-brand/10 text-brand hover:bg-brand/20 transition-colors" title="Add to Kit">
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                        </button>
                                        <button type="button" onClick={() => handleUnassign(asset)} className="p-1.5 rounded-lg bg-orange-50 text-orange-600 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400 dark:hover:bg-orange-900/50 transition-colors" title="Unassign">
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" /></svg>
                                        </button>
                                      </>
                                    )}
                                    <button type="button" onClick={() => { setEditAsset(asset); setPrefillEmployee(null); setAddAssetOpen(true); }} className="p-1.5 rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-300 dark:hover:bg-slate-600 transition-colors" title="Edit Asset">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                    </button>
                                  </div>
                                </td>
                              </>
                            );
                          };

                          return (
                            <React.Fragment key={`group-${item.assigned_to_id}`}>
                              {/* Parent Row */}
                              <tr className={`border-b cursor-pointer ${tableRowClass}`} onClick={() => setDetailAsset(firstAsset)}>
                                <td className="px-4 py-3 font-medium">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-brand/10 text-brand flex items-center justify-center text-xs font-bold shrink-0">
                                      {getInitials(firstAsset.assigned_to_name)}
                                    </div>
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                      <span className="truncate max-w-[150px]" title={firstAsset.assigned_to_name}>{firstAsset.assigned_to_name}</span>
                                      <button 
                                        type="button"
                                        onClick={(e) => toggleGroup(item.assigned_to_id, e)} 
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 text-[11px] font-medium text-gray-600 dark:text-gray-300 transition-colors shadow-sm w-fit"
                                      >
                                        <span>{item.assets.length} items</span>
                                        <svg className={`w-3 h-3 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                      </button>
                                    </div>
                                  </div>
                                </td>
                                {renderAssetCols(firstAsset)}
                              </tr>
                              {/* Child Rows */}
                              {isExpanded && remainingAssets.map((asset) => (
                                <tr key={asset.id} className={`border-b cursor-pointer ${isDark ? 'bg-slate-800/40' : 'bg-gray-50/40'} ${tableRowClass}`} onClick={() => setDetailAsset(asset)}>
                                  <td className="px-4 py-3 font-medium pl-14">
                                    <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                      <span className="text-xs font-normal">{asset.assigned_to_name || 'Sub-item'}</span>
                                    </div>
                                  </td>
                                  {renderAssetCols(asset)}
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        }
                      })}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className={`px-4 py-3 border-t flex items-center justify-between sm:px-6 ${isDark ? 'border-slate-700 bg-slate-800' : 'border-gray-100 bg-gray-50/50'}`}>
                    <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Showing <span className="font-medium text-gray-900 dark:text-white">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium text-gray-900 dark:text-white">{Math.min(currentPage * itemsPerPage, groupedFiltered.length)}</span> of <span className="font-medium text-gray-900 dark:text-white">{groupedFiltered.length}</span> results
                      </p>
                      <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors">
                          <span className="sr-only">Previous</span>
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                        </button>
                        <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm font-medium text-gray-700 dark:text-gray-300">
                          {currentPage} <span className="mx-1 text-gray-400">/</span> {totalPages}
                        </span>
                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors">
                          <span className="sr-only">Next</span>
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                        </button>
                      </nav>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {subView === SUB_VIEWS.BY_EMPLOYEE && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">Employee Kits</h2>
          {employeeAssets.length === 0 ? (
            <div className={`rounded-xl border p-6 text-center ${cardClass}`}>
              <p className="text-sm text-gray-500 dark:text-gray-400">No assets currently assigned to employees.</p>
            </div>
          ) : (
            <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-full text-left text-sm">
                  <thead className={isDark ? 'bg-slate-800/80' : 'bg-gray-50/80'}>
                    <tr className={`border-b ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
                      <th className="px-4 py-3 font-medium">Emp ID</th>
                      <th className="px-4 py-3 font-medium">Employee</th>
                      <th className="px-4 py-3 font-medium">Primary Device (Laptop)</th>
                      <th className="px-4 py-3 font-medium hidden md:table-cell">Mouse</th>
                      <th className="px-4 py-3 font-medium hidden md:table-cell">Headset</th>
                      <th className="px-4 py-3 font-medium hidden lg:table-cell">Keyboard</th>
                      <th className="px-4 py-3 font-medium text-center">Total Items</th>
                      <th className="px-4 py-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedEmpKits.map((emp) => {
                      const laptop = emp.assets.find(a => a.category?.toLowerCase() === 'laptop');
                      const mouse = emp.assets.find(a => a.category?.toLowerCase() === 'mouse');
                      const headset = emp.assets.find(a => a.category?.toLowerCase() === 'headset');
                      const keyboard = emp.assets.find(a => a.category?.toLowerCase() === 'keyboard');
                      return (
                        <tr
                          key={emp.user_id}
                          className={`border-b ${tableRowClass}`}
                        >
                          <td className="px-4 py-3 font-mono text-xs">
                             {users.find(u => u.id === emp.user_id)?.employee_no || emp.user_id?.slice(0, 8) || '--'}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-brand/10 text-brand flex items-center justify-center text-xs font-bold shrink-0">
                                {getInitials(emp.employee_name)}
                              </div>
                              <span className="truncate max-w-[150px]" title={emp.employee_name}>{emp.employee_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">{laptop ? <span className="inline-flex px-2 py-1 rounded-md bg-gray-50 border border-gray-100 dark:bg-slate-700 dark:border-slate-600 text-xs shadow-sm">{`${laptop.brand || ''} ${laptop.model}`.trim()}</span> : <span className="text-gray-400">--</span>}</td>
                          <td className="px-4 py-3 hidden md:table-cell">{mouse ? <span className="inline-flex px-2 py-1 rounded-md bg-gray-50 border border-gray-100 dark:bg-slate-700 dark:border-slate-600 text-xs shadow-sm">{`${mouse.brand || ''} ${mouse.model}`.trim()}</span> : <span className="text-gray-400">--</span>}</td>
                          <td className="px-4 py-3 hidden md:table-cell">{headset ? <span className="inline-flex px-2 py-1 rounded-md bg-gray-50 border border-gray-100 dark:bg-slate-700 dark:border-slate-600 text-xs shadow-sm">{`${headset.brand || ''} ${headset.model}`.trim()}</span> : <span className="text-gray-400">--</span>}</td>
                          <td className="px-4 py-3 hidden lg:table-cell">{keyboard ? <span className="inline-flex px-2 py-1 rounded-md bg-gray-50 border border-gray-100 dark:bg-slate-700 dark:border-slate-600 text-xs shadow-sm">{`${keyboard.brand || ''} ${keyboard.model}`.trim()}</span> : <span className="text-gray-400">--</span>}</td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand/10 text-brand">
                              {emp.assets.length}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setKitModalEmployee(emp)}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand hover:bg-brand-hover text-white transition-colors"
                            >
                              View Assets
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {empTotalPages > 1 && (
                <div className={`px-4 py-3 border-t flex items-center justify-between sm:px-6 ${isDark ? 'border-slate-700 bg-slate-800' : 'border-gray-100 bg-gray-50/50'}`}>
                  <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Showing <span className="font-medium text-gray-900 dark:text-white">{(currentEmpPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium text-gray-900 dark:text-white">{Math.min(currentEmpPage * itemsPerPage, sortedEmployeeKits.length)}</span> of <span className="font-medium text-gray-900 dark:text-white">{sortedEmployeeKits.length}</span> results
                    </p>
                    <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                      <button onClick={() => setCurrentEmpPage(p => Math.max(1, p - 1))} disabled={currentEmpPage === 1} className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors">
                        <span className="sr-only">Previous</span>
                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      </button>
                      <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm font-medium text-gray-700 dark:text-gray-300">
                        {currentEmpPage} <span className="mx-1 text-gray-400">/</span> {empTotalPages}
                      </span>
                      <button onClick={() => setCurrentEmpPage(p => Math.min(empTotalPages, p + 1))} disabled={currentEmpPage === empTotalPages} className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors">
                        <span className="sr-only">Next</span>
                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                      </button>
                    </nav>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {subView === SUB_VIEWS.CATEGORIES && (
        <CategoryManagement
          categories={categories}
          isDark={isDark}
          cardClass={cardClass}
          tableRowClass={tableRowClass}
          onAdd={() => setAddCategoryOpen(true)}
          onEdit={(c) => { setEditCategory(c); setAddCategoryOpen(true); }}
          onDelete={handleDeleteCategory}
        />
      )}

      {subView === SUB_VIEWS.UPLOAD && (
        <div className={`rounded-xl border p-6 space-y-4 ${cardClass}`}>
          <h2 className="text-lg font-semibold">Upload Assets via CSV</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Upload a CSV file with asset details. Categories will be created automatically if they don't exist.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <label className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium cursor-pointer transition-colors">
              Choose CSV File
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvFile} />
            </label>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-700"
            >
              Download Template
            </button>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p><strong>Required columns:</strong> EMPLOYEE_NAME, LAPTOP_MODEL</p>
            <p><strong>Optional columns:</strong> EMP_ID, LAPTOP_ASSET_NO, LAPTOP_SERIAL_NO, LAPTOP_DEVICE_SPEC, PURCHASE_DATE, WARRANTY_EXPIRY, PURCHASE_COST, MOUSE_ASSET_NO, MOUSE_MODEL, MOUSE_DEVICE_SPEC, KEYBOARD_ASSET_NO, KEYBOARD_MODEL, KEYBOARD_DEVICE_SPEC, HEADSET_ASSET_NO, HEADSET_MODEL, HEADSET_DEVICE_SPEC, OTHER_ASSETS</p>
            <p className="mt-2 italic">Note: Each row represents one employee's complete hardware kit. Download the template to see the exact format.</p>
          </div>

          {csvRows.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-600">
                <table className="w-full min-w-full text-left text-xs">
                  <thead>
                    <tr className={`border-b ${isDark ? 'border-slate-600' : 'border-gray-200'}`}>
                      <th className="px-3 py-2 font-medium">#</th>
                      {Object.keys(csvRows[0]).map((h) => (
                        <th key={h} className="px-3 py-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.slice(0, 20).map((row, i) => (
                      <tr key={i} className={`border-b ${isDark ? 'border-slate-700' : 'border-gray-100'}`}>
                        <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                        {Object.values(row).map((v, j) => (
                          <td key={j} className="px-3 py-1.5">{v || '--'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {csvRows.length > 20 && (
                <p className="text-xs text-gray-400">Showing first 20 of {csvRows.length} rows</p>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCsvUpload}
                  disabled={csvUploading}
                  className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  {csvUploading ? 'Uploading...' : `Upload ${csvRows.length} Assets`}
                </button>
                <button
                  type="button"
                  onClick={() => { setCsvRows([]); setCsvResult(null); }}
                  className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 text-sm"
                >
                  Clear
                </button>
              </div>
            </>
          )}

          {csvResult && (
            <div className={`rounded-lg p-4 ${csvResult.created > 0 ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'}`}>
              <p className="text-sm font-medium">{csvResult.created} asset(s) imported successfully.</p>
              {csvResult.errors?.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">{csvResult.errors.length} error(s):</p>
                  {csvResult.errors.slice(0, 10).map((err, i) => (
                    <p key={i} className="text-xs text-red-500">Row {err.row}: {err.error}</p>
                  ))}
                  {csvResult.errors.length > 10 && <p className="text-xs text-gray-400">...and {csvResult.errors.length - 10} more</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Asset Modal */}
      {addAssetOpen && (
        <AddAssetModal
          key={editAsset ? `edit-${editAsset.id}` : prefillEmployee ? `add-for-${prefillEmployee.id}` : 'add-new'}
          isDark={isDark}
          categories={categories}
          users={users}
          editData={editAsset}
          prefillEmployee={prefillEmployee}
          onClose={() => { setAddAssetOpen(false); setEditAsset(null); setPrefillEmployee(null); }}
          onSaved={() => { setAddAssetOpen(false); setEditAsset(null); setPrefillEmployee(null); fetchAll(); showToast?.(editAsset ? 'Asset updated' : 'Asset added'); }}
          onCategoryCreated={fetchAll}
        />
      )}

      {/* Assign Modal */}
      {assignModalAsset && (
        <AssignAssetModal
          isDark={isDark}
          asset={assignModalAsset}
          users={users}
          onClose={() => setAssignModalAsset(null)}
          onSaved={() => { setAssignModalAsset(null); fetchAll(); showToast?.('Asset assigned'); }}
        />
      )}

      {/* Detail Modal */}
      {detailAsset && (
        <AssetDetailModal
          isDark={isDark}
          asset={detailAsset}
          categories={categories}
          users={users}
          onClose={() => setDetailAsset(null)}
          onEdit={(a) => { setDetailAsset(null); setEditAsset(a); setPrefillEmployee(null); setAddAssetOpen(true); }}
          onAssign={(a) => { setDetailAsset(null); setAssignModalAsset(a); }}
          onUnassign={(a) => { handleUnassign(a); setDetailAsset(null); }}
          onRefresh={fetchAll}
          showToast={showToast}
        />
      )}

      {/* Add / Edit Category Modal */}
      {addCategoryOpen && (
        <CategoryModal
          isDark={isDark}
          editData={editCategory}
          onClose={() => { setAddCategoryOpen(false); setEditCategory(null); }}
          onSaved={() => { setAddCategoryOpen(false); setEditCategory(null); fetchAll(); showToast?.(editCategory ? 'Category updated' : 'Category added'); }}
        />
      )}

      {/* Employee Kit Modal */}
      {kitModalEmployee && (
        <EmployeeKitModal
          isDark={isDark}
          employee={kitModalEmployee}
          onClose={() => setKitModalEmployee(null)}
        />
      )}
    </div>
  );

  // ── Handlers ────────────────────────────────────────────────

  async function handleUnassign(asset) {
    if (!confirm(`Unassign ${asset.asset_tag} from its current user?`)) return;
    try {
      await api.assets.unassign(asset.id);
      fetchAll();
      showToast?.('Asset unassigned');
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDeleteCategory(cat) {
    if (!confirm(`Delete category "${cat.name}"?`)) return;
    try {
      await api.assets.deleteCategory(cat.id);
      fetchAll();
      showToast?.('Category deleted');
    } catch (e) {
      setError(e.message);
    }
  }
}

// ── Dashboard Cards ─────────────────────────────────────────────

function DashboardCards({ dashboard, isDark, cardClass }) {
  const cards = [
    { label: 'Total Assets', value: dashboard.total, icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', color: 'text-brand' },
    { label: 'Assigned', value: dashboard.assigned, icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z', color: 'text-blue-500' },
    { label: 'Available', value: dashboard.available, icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', color: 'text-green-500' },
    { label: 'Under Repair', value: dashboard.under_repair, icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', color: 'text-orange-500' },
    { label: 'Warranty Expiring', value: dashboard.warranties_expiring_soon, icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z', color: 'text-amber-500' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {cards.map((c) => (
        <div key={c.label} className={`rounded-xl border p-5 flex flex-col items-center justify-center text-center ${isDark ? 'bg-slate-800 border-slate-700 shadow-sm' : 'bg-white border-gray-200 shadow-sm'}`}>
          <p className={`text-3xl font-bold ${c.color}`}>{c.value}</p>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-1.5">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Category Management ─────────────────────────────────────────

function CategoryManagement({ categories, isDark, cardClass, tableRowClass, onAdd, onEdit, onDelete }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white">Categories</h2>
        <button
          type="button"
          onClick={onAdd}
          className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium transition-colors"
        >
          + Add Category
        </button>
      </div>
      <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
        {categories.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400 text-center">No categories yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <table className="w-full min-w-full text-left text-sm">
              <thead>
                <tr className={`border-b ${isDark ? 'border-slate-600' : 'border-gray-200'}`}>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id} className={`border-b ${tableRowClass}`}>
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{c.description || '--'}</td>
                    <td className="px-4 py-3">{formatDate(c.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => onEdit(c)} className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600">
                          Edit
                        </button>
                        <button type="button" onClick={() => onDelete(c)} className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Modal Backdrop ──────────────────────────────────────────────

function ModalBackdrop({ children, onClose, isDark, maxWidth = 'max-w-lg' }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm transition-opacity duration-300 animate-in fade-in" onClick={onClose}>
      <div
        className={`rounded-2xl shadow-2xl border w-full ${maxWidth} max-h-[90vh] overflow-y-auto transform transition-all duration-300 ${isDark ? 'bg-slate-800 border-slate-600 text-white shadow-black/50' : 'bg-white border-gray-200 text-gray-900 shadow-gray-200/50'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ── Add / Edit Asset Modal ──────────────────────────────────────

function AddAssetModal({ isDark, categories, users, editData, prefillEmployee, onClose, onSaved, onCategoryCreated }) {
  const isEdit = !!editData;
  const [form, setForm] = useState({
    asset_tag: editData?.asset_tag || '',
    category_id: editData?.category_id || '',
    brand: editData?.brand || '',
    model: editData?.model || '',
    serial_number: editData?.serial_number || '',
    purchase_date: editData?.purchase_date ? editData.purchase_date.slice(0, 10) : '',
    purchase_cost: editData?.purchase_cost ?? '',
    warranty_months: '',
    warranty_expiry_date: editData?.warranty_expiry_date ? editData.warranty_expiry_date.slice(0, 10) : '',
    status: editData?.status || 'available',
    notes: editData?.notes || '',
    support_phone: editData?.support_phone || '',
    assigned_to: editData?.assigned_to_id || prefillEmployee?.id || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [newCatName, setNewCatName] = useState('');
  const [showNewCat, setShowNewCat] = useState(false);
  const [empSearch, setEmpSearch] = useState('');

  const filteredEmployees = useMemo(() => {
    if (!users || !users.length) return [];
    const q = empSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.employee_no || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
  }, [users, empSearch]);

  const inputClass = isDark
    ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400 focus:border-brand focus:ring-brand'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-brand focus:ring-brand';

  // Auto-generate tag when category changes (only for new assets)
  useEffect(() => {
    if (isEdit || !form.category_id) return;
    const cat = categories.find((c) => c.id === form.category_id);
    if (!cat) return;
    const prefix = CATEGORY_TAG_PREFIX[cat.name] || `AGS-${cat.name.slice(0, 3).toUpperCase()}`;
    api.assets.nextTag(prefix).then((d) => {
      setForm((f) => ({ ...f, asset_tag: d.tag }));
    }).catch(() => { });
  }, [form.category_id, categories, isEdit]);

  // Auto-calculate warranty expiry from purchase date + months
  useEffect(() => {
    if (!form.purchase_date || !form.warranty_months) return;
    const d = new Date(form.purchase_date);
    d.setMonth(d.getMonth() + parseInt(form.warranty_months, 10));
    setForm((f) => ({ ...f, warranty_expiry_date: d.toISOString().slice(0, 10) }));
  }, [form.purchase_date, form.warranty_months]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        asset_tag: form.asset_tag,
        category_id: form.category_id,
        brand: form.brand,
        model: form.model,
        serial_number: form.serial_number || null,
        purchase_date: form.purchase_date || null,
        purchase_cost: form.purchase_cost !== '' ? parseFloat(form.purchase_cost) : null,
        warranty_expiry_date: form.warranty_expiry_date || null,
        status: form.status,
        notes: form.notes || null,
        support_phone: form.support_phone || null,
      };
      if (isEdit) {
        await api.assets.update(editData.id, payload);
        // Handle assignment change
        const prevAssigned = editData.assigned_to_id || '';
        const newAssigned = form.assigned_to || '';
        if (newAssigned !== prevAssigned) {
          if (prevAssigned && !newAssigned) {
            // Unassign
            await api.assets.unassign(editData.id);
          } else if (newAssigned) {
            // Unassign first if was assigned to someone else
            if (prevAssigned) {
              await api.assets.unassign(editData.id);
            }
            await api.assets.assign(editData.id, {
              user_id: newAssigned,
              assigned_date: new Date().toISOString().slice(0, 10),
            });
          }
        }
      } else {
        const created = await api.assets.create(payload);
        // If an employee was selected, assign right away
        if (form.assigned_to && created?.id) {
          await api.assets.assign(created.id, {
            user_id: form.assigned_to,
            assigned_date: new Date().toISOString().slice(0, 10),
          });
        }
      }
      onSaved();
    } catch (e) {
      setErr(e.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCategory() {
    if (!newCatName.trim()) return;
    // Check if category already exists (case-insensitive) — select it instead of creating
    const existing = categories.find((c) => c.name.toLowerCase() === newCatName.trim().toLowerCase());
    if (existing) {
      setForm((f) => ({ ...f, category_id: existing.id }));
      setNewCatName('');
      setShowNewCat(false);
      return;
    }
    try {
      const cat = await api.assets.createCategory({ name: newCatName.trim() });
      setForm((f) => ({ ...f, category_id: cat.id }));
      setNewCatName('');
      setShowNewCat(false);
      onCategoryCreated();
    } catch (e) {
      setErr(e.data?.error || e.message);
    }
  }

  return (
    <ModalBackdrop onClose={onClose} isDark={isDark} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        <div className="border-b pb-4 dark:border-slate-700">
          <h2 className="text-xl font-bold">
            {isEdit ? 'Edit Asset' : prefillEmployee ? `Add Asset for ${prefillEmployee.name}` : 'Add New Asset'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {isEdit ? 'Update details and assignment information.' : 'Fill out the details below to create a new hardware asset.'}
          </p>
        </div>

        {err && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg border border-red-200 dark:border-red-800">
            {typeof err === 'string' ? err : JSON.stringify(err)}
          </div>
        )}

        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-brand tracking-wider uppercase mb-2">Basic Information</h3>
        {/* Category */}
        <div>
          <label className="block text-sm font-medium mb-1">Category *</label>
          <div className="flex gap-2">
            <select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              required
              className={`flex-1 rounded-lg px-3 py-2 text-sm border ${inputClass}`}
            >
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button type="button" onClick={() => setShowNewCat(!showNewCat)} className="px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600">
              +
            </button>
          </div>
          {showNewCat && (
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                placeholder="New category name"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm border ${inputClass}`}
              />
              <button type="button" onClick={handleAddCategory} className="px-3 py-2 rounded-lg text-sm font-medium bg-brand text-white hover:bg-brand-hover">
                Add
              </button>
            </div>
          )}
        </div>

        {/* Asset Tag */}
        <div>
          <label className="block text-sm font-medium mb-1">Asset Tag *</label>
          <input
            type="text"
            value={form.asset_tag}
            onChange={(e) => setForm({ ...form, asset_tag: e.target.value })}
            required
            placeholder="e.g. AGS-LAP-001"
            className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
          />
        </div>

        {/* Brand & Model */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Brand *</label>
            <input
              type="text"
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              required
              placeholder="e.g. Dell"
              className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Model *</label>
            <input
              type="text"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              required
              placeholder="e.g. Latitude 5540"
              className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
            />
          </div>
        </div>

        {/* Serial Number */}
        <div>
          <label className="block text-sm font-medium mb-1">Serial Number</label>
          <input
            type="text"
            value={form.serial_number}
            onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
            placeholder="Optional"
            className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
          />
        </div>

        </div>

        <div className="space-y-4 pt-2">
          <h3 className="text-sm font-semibold text-brand tracking-wider uppercase border-t pt-6 dark:border-slate-700">Purchase & Warranty</h3>
        {/* Purchase Date & Cost */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Purchase Date</label>
            <input
              type="date"
              value={form.purchase_date}
              onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
              className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Purchase Cost ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.purchase_cost}
              onChange={(e) => setForm({ ...form, purchase_cost: e.target.value })}
              placeholder="0.00"
              className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
            />
          </div>
        </div>

        {/* Warranty */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Warranty (months)</label>
            <input
              type="number"
              min="0"
              value={form.warranty_months}
              onChange={(e) => setForm({ ...form, warranty_months: e.target.value })}
              placeholder="e.g. 36"
              className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Warranty Expiry</label>
            <input
              type="date"
              value={form.warranty_expiry_date}
              onChange={(e) => setForm({ ...form, warranty_expiry_date: e.target.value })}
              className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
            />
          </div>
        </div>

        </div>

        <div className="space-y-4 pt-2">
          <h3 className="text-sm font-semibold text-brand tracking-wider uppercase border-t pt-6 dark:border-slate-700">Assignment & Support</h3>
        {/* Status (only for edit) */}
        {isEdit && (
          <div>
            <label className="block text-sm font-medium mb-1">Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
            >
              <option value="available">Available</option>
              <option value="assigned">Assigned</option>
              <option value="under_repair">Under Repair</option>
              <option value="retired">Retired</option>
            </select>
          </div>
        )}

        {/* Assigned Employee */}
        <div>
          <label className="block text-sm font-medium mb-1">Assigned Employee</label>
          <input
            type="text"
            placeholder="Search by name, employee ID, or email..."
            value={empSearch}
            onChange={(e) => setEmpSearch(e.target.value)}
            className={`w-full rounded-lg px-3 py-2 text-sm border mb-2 ${inputClass}`}
          />
          <select
            value={form.assigned_to}
            onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
            className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
            size={Math.min(filteredEmployees.length + 1, 6)}
          >
            <option value="">-- None (Unassigned) --</option>
            {filteredEmployees.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}{u.employee_no ? ` (${u.employee_no})` : ''} — {u.email}
              </option>
            ))}
          </select>
          {form.assigned_to && (
            <p className="mt-1.5 text-xs text-brand">
              {(() => {
                const u = (users || []).find((u) => u.id === form.assigned_to);
                if (!u) return '';
                return `Selected: ${u.name}${u.employee_no ? ' | ID: ' + u.employee_no : ''} | ${u.email}`;
              })()}
            </p>
          )}
        </div>

        {/* Support Phone */}
        <div>
          <label className="block text-sm font-medium mb-1">Support Phone</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
              </svg>
            </span>
            <input
              type="tel"
              value={form.support_phone}
              onChange={(e) => setForm({ ...form, support_phone: e.target.value })}
              placeholder="e.g. +91 98765 43210"
              className={`w-full rounded-lg pl-9 pr-3 py-2 text-sm border ${inputClass}`}
            />
          </div>
          <p className="mt-1 text-xs text-gray-400">Phone number employees can call for equipment support</p>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium mb-1">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            placeholder="Optional notes"
            className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
          />
        </div>

        {/* Audit Log */}
        {isEdit && (editData?.audit_log?.length > 0) && (
          <div className="col-span-1 sm:col-span-1 pt-4 border-t dark:border-slate-700 mt-4">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Audit Log
            </h4>
            <div className={`space-y-2 max-h-40 overflow-y-auto pr-1 rounded-lg border p-2 ${isDark ? 'bg-slate-800/50 border-slate-700' : 'bg-gray-50 border-gray-200'}`}>
              {[...editData.audit_log].reverse().map((entry, idx) => {
                const dateObj = new Date(entry.date);
                const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                
                let text = '';
                if (entry.type === 'assigned') {
                  const u = (users || []).find(u => u.id === entry.assigned_to_id);
                  text = `Assigned to ${u ? u.name : 'Unknown User'}`;
                  if (entry.notes) text += ` (${entry.notes})`;
                } else if (entry.type === 'unassigned') {
                  text = `Unassigned`;
                  if (entry.previous_assigned_to_id) {
                    const u = (users || []).find(u => u.id === entry.previous_assigned_to_id);
                    text += ` (previously ${u ? u.name : 'Unknown User'})`;
                  }
                } else {
                  text = entry.type;
                }

                return (
                  <div key={idx} className="flex gap-2 text-xs">
                    <span className={`w-20 flex-shrink-0 font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {dateStr}
                    </span>
                    <span className={`flex-1 ${entry.type === 'assigned' ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {text}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-5 border-t dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-slate-700 hover:bg-slate-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving...' : isEdit ? 'Update Asset' : 'Create Asset'}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

// ── Assign Asset Modal ──────────────────────────────────────────

function AssignAssetModal({ isDark, asset, users, onClose, onSaved }) {
  const [userId, setUserId] = useState('');
  const [assignedDate, setAssignedDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const inputClass = isDark
    ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400 focus:border-brand focus:ring-brand'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-brand focus:ring-brand';

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await api.assets.assign(asset.id, {
        user_id: userId,
        assigned_date: assignedDate,
        notes: notes || null,
      });
      onSaved();
    } catch (e) {
      setErr(e.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalBackdrop onClose={onClose} isDark={isDark}>
      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        <div className="border-b pb-4 dark:border-slate-700">
          <h2 className="text-xl font-bold">Assign Asset</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Assigning <strong>{asset.asset_tag}</strong> ({asset.brand} {asset.model}) to an employee.
          </p>
        </div>

        {err && <p className="text-sm text-red-500">{typeof err === 'string' ? err : JSON.stringify(err)}</p>}

        <div>
          <label className="block text-sm font-medium mb-1">Employee *</label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
            className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
          >
            <option value="">Select employee</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Assignment Date</label>
          <input
            type="date"
            value={assignedDate}
            onChange={(e) => setAssignedDate(e.target.value)}
            className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional notes"
            className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
          />
        </div>

        <div className="flex gap-3 justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-slate-700 hover:bg-slate-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Assigning...' : 'Assign'}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

// ── Asset Detail Modal ──────────────────────────────────────────

function AssetDetailModal({ isDark, asset, categories, users, onClose, onEdit, onAssign, onUnassign, onRefresh, showToast }) {
  const [assignments, setAssignments] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    setLoadingHistory(true);
    api.assets.assignments(asset.id)
      .then((d) => setAssignments(d.assignments || []))
      .catch(() => { })
      .finally(() => setLoadingHistory(false));
  }, [asset.id]);

  const cardClass = isDark
    ? 'bg-slate-700/50 border-slate-600'
    : 'bg-gray-50 border-gray-200';

  return (
    <ModalBackdrop onClose={onClose} isDark={isDark} maxWidth="max-w-2xl">
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold">{asset.asset_tag}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{asset.brand} {asset.model}</p>
            </div>
            <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[asset.status]}`}>
              {STATUS_LABELS[asset.status]}
            </span>
          </div>

          {/* Details grid */}
          <div className={`rounded-xl border p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm ${cardClass}`}>
            <div>
              <p className="text-gray-500 dark:text-gray-400">Category</p>
              <p className="font-medium">{asset.category_name || '--'}</p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400">Serial Number</p>
              <p className="font-medium font-mono">{asset.serial_number || '--'}</p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400">Purchase Date</p>
              <p className="font-medium">{formatDate(asset.purchase_date)}</p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400">Purchase Cost</p>
              <p className="font-medium">{formatCurrency(asset.purchase_cost)}</p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400">Warranty Expiry</p>
              <p className={`font-medium ${warrantyClass(asset.warranty_expiry_date)}`}>
                {formatDate(asset.warranty_expiry_date)}
              </p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400">Assigned To</p>
              <p className="font-medium">{asset.assigned_to_name || '--'}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-gray-500 dark:text-gray-400">Support Phone</p>
              {asset.support_phone ? (
                <a
                  href={`tel:${asset.support_phone}`}
                  className="inline-flex items-center gap-2 font-medium text-brand hover:underline"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                  </svg>
                  {asset.support_phone}
                </a>
              ) : (
                <p className="font-medium">--</p>
              )}
            </div>
            {asset.notes && (
              <div className="sm:col-span-2">
                <p className="text-gray-500 dark:text-gray-400">Notes</p>
                <p className="font-medium">{asset.notes}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onEdit(asset)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-slate-700 hover:bg-slate-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
            >
              Edit Details
            </button>
            {asset.status === 'available' && (
              <button
                type="button"
                onClick={() => onAssign(asset)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50"
              >
                Assign
              </button>
            )}
            {asset.status === 'assigned' && (
              <button
                type="button"
                onClick={() => onUnassign(asset)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-900/50"
              >
                Unassign
              </button>
            )}
          </div>

          {/* Asset History */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Asset History</h3>
            {loadingHistory ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
            ) : assignments.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No asset history.</p>
            ) : (
              <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
                <table className="w-full min-w-full text-left text-sm">
                  <thead>
                    <tr className={`border-b ${isDark ? 'border-slate-600' : 'border-gray-200'}`}>
                      <th className="px-3 py-2 font-medium text-xs">Employee</th>
                      <th className="px-3 py-2 font-medium text-xs">Assigned</th>
                      <th className="px-3 py-2 font-medium text-xs">Returned</th>
                      <th className="px-3 py-2 font-medium text-xs">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((a) => (
                      <tr key={a.id} className={`border-b ${isDark ? 'border-slate-600' : 'border-gray-200'}`}>
                        <td className="px-3 py-2">{a.user_name}</td>
                        <td className="px-3 py-2">{formatDate(a.assigned_date)}</td>
                        <td className="px-3 py-2">{a.returned_date ? formatDate(a.returned_date) : <span className="text-green-600 dark:text-green-400">Current</span>}</td>
                        <td className="px-3 py-2">{a.assigned_by_name || '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Close button */}
          <div className="flex justify-end pt-4 border-t dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-slate-700 hover:bg-slate-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
            >
              Close
            </button>
          </div>
        </div>
    </ModalBackdrop>
  );
}

// ── Category Modal ──────────────────────────────────────────────

function CategoryModal({ isDark, editData, onClose, onSaved }) {
  const isEdit = !!editData;
  const [name, setName] = useState(editData?.name || '');
  const [description, setDescription] = useState(editData?.description || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const inputClass = isDark
    ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400 focus:border-brand focus:ring-brand'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-brand focus:ring-brand';

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const payload = { name: name.trim(), description: description.trim() || null };
      if (isEdit) {
        await api.assets.updateCategory(editData.id, payload);
      } else {
        await api.assets.createCategory(payload);
      }
      onSaved();
    } catch (e) {
      setErr(e.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalBackdrop onClose={onClose} isDark={isDark}>
      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        <div className="border-b pb-4 dark:border-slate-700">
          <h2 className="text-xl font-bold">{isEdit ? 'Edit Category' : 'Add Category'}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {isEdit ? 'Update category details below.' : 'Create a new asset category.'}
          </p>
        </div>

        {err && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg border border-red-200 dark:border-red-800">
            {typeof err === 'string' ? err : JSON.stringify(err)}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Laptop, Mouse, Monitor"
            className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional description"
            className={`w-full rounded-lg px-3 py-2 text-sm border ${inputClass}`}
          />
        </div>

        <div className="flex gap-3 justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-slate-700 hover:bg-slate-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

// ── Employee Kit Modal ──────────────────────────────────────────

function EmployeeKitModal({ isDark, employee, onClose }) {
  const tableRowClass = isDark
    ? 'border-slate-600 hover:bg-slate-700/50'
    : 'border-gray-200 hover:bg-gray-50';

  const totalCost = employee.assets.reduce((sum, a) => sum + (parseFloat(a.purchase_cost) || 0), 0);

  return (
    <ModalBackdrop onClose={onClose} isDark={isDark} maxWidth="max-w-5xl">
        <div className="p-6 space-y-5">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-brand/10 text-brand flex items-center justify-center text-lg font-bold">
                {(employee.employee_name || 'U').charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-xl font-semibold">{employee.employee_name}</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">Emp ID: {employee.user_id || 'N/A'} · {employee.assets.length} device{employee.assets.length !== 1 ? 's' : ''} assigned</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {/* Devices Table */}
          <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-slate-600' : 'border-gray-200'}`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-full text-left text-sm">
                <thead>
                  <tr className={`border-b ${isDark ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'}`}>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">#</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Category</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Device / Model</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Serial Number</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Specifications / Notes</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Warranty Expiry</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Purchase Cost</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {employee.assets.map((a, idx) => {
                    const warrantyText = a.warranty_expiry_date
                      ? new Date(a.warranty_expiry_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                      : '--';
                    const isExpired = a.warranty_expiry_date && new Date(a.warranty_expiry_date) < new Date();
                    const costText = a.purchase_cost ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(a.purchase_cost) : '--';
                    const statusLabel = a.status === 'assigned' ? 'Assigned' : a.status === 'available' ? 'Available' : a.status === 'under_repair' ? 'Under Repair' : a.status || '--';
                    const statusColor = a.status === 'assigned' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                      : a.status === 'available' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400';
                    return (
                      <tr key={a.asset_id} className={`border-b ${tableRowClass}`}>
                        <td className="px-4 py-3 text-xs text-gray-400">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-300">
                            {a.category || 'Other'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{a.brand ? `${a.brand} ` : ''}{a.model || '--'}</p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{a.serial_number || '--'}</td>
                        <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 max-w-[200px]">{a.notes || '--'}</td>
                        <td className={`px-4 py-3 text-xs font-medium ${isExpired ? 'text-red-500' : ''}`}>
                          {warrantyText}
                          {isExpired && <span className="block text-[10px] text-red-400 mt-0.5">Expired</span>}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium">{costText}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
                            {statusLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary Footer */}
          <div className={`rounded-xl border p-4 flex flex-wrap gap-6 items-center justify-between ${isDark ? 'border-slate-600 bg-slate-700/30' : 'border-gray-200 bg-gray-50'}`}>
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">Total Devices</p>
                <p className="text-lg font-bold">{employee.assets.length}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">Total Purchase Value</p>
                <p className="text-lg font-bold">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(totalCost)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">Warranties Expired</p>
                <p className="text-lg font-bold text-red-500">{employee.assets.filter(a => a.warranty_expiry_date && new Date(a.warranty_expiry_date) < new Date()).length}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className={`px-5 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-slate-700 hover:bg-slate-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
            >
              Close
            </button>
          </div>

        </div>
    </ModalBackdrop>
  );
}
