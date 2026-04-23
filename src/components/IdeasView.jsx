import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../api/client';

// ── Constants ─────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'idea', label: 'Idea', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { value: 'implemented', label: 'Implemented', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  { value: 'archived', label: 'Archived', color: 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low', dot: 'bg-gray-400' },
  { value: 'normal', label: 'Normal', dot: null },
  { value: 'high', label: 'High', dot: 'bg-red-500' },
];

const FILTER_TABS = [
  { value: '', label: 'All' },
  { value: 'idea', label: 'Ideas' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'implemented', label: 'Implemented' },
  { value: 'archived', label: 'Archived' },
];

function getStatusMeta(status) {
  return STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];
}

function getPriorityMeta(priority) {
  return PRIORITY_OPTIONS.find(p => p.value === priority) || PRIORITY_OPTIONS[1];
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function truncate(text, maxLen = 120) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '...';
}

// ── Quick-action helpers ─────────────────────────────────────────

function getQuickActions(status) {
  switch (status) {
    case 'idea': return [{ label: 'Start Working', nextStatus: 'in_progress' }];
    case 'in_progress': return [
      { label: 'Mark Implemented', nextStatus: 'implemented' },
      { label: 'Back to Idea', nextStatus: 'idea' },
    ];
    case 'implemented': return [{ label: 'Archive', nextStatus: 'archived' }];
    case 'archived': return [{ label: 'Reopen', nextStatus: 'idea' }];
    default: return [];
  }
}

// ── SVG Icons ────────────────────────────────────────────────────

function LightbulbIcon({ className = 'w-6 h-6' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

// ── Main Component ───────────────────────────────────────────────

export default function IdeasView({ isDark, currentUser, showToast }) {
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('all'); // 'all' or 'mine'
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIdea, setEditingIdea] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Form state
  const emptyForm = { title: '', content: '', status: 'idea', priority: 'normal', tags: '' };
  const [form, setForm] = useState(emptyForm);

  const card = isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200';
  const input = isDark
    ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400 focus:border-amber-400 focus:ring-amber-400'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:ring-amber-500';

  // ── Fetch ideas ──────────────────────────────────────────────

  const fetchIdeas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = viewMode === 'mine' ? { mine: 'true' } : {};
      const data = await api.ideas.list(params);
      setIdeas(data.ideas || []);
    } catch (e) {
      if (e.status !== 401) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [viewMode]);

  useEffect(() => { fetchIdeas(); }, [fetchIdeas]);

  // ── Filtered + searched ideas ────────────────────────────────

  const filtered = useMemo(() => {
    let list = ideas;
    if (filterStatus) list = list.filter(i => i.status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        i.title.toLowerCase().includes(q) ||
        (i.content && i.content.toLowerCase().includes(q)) ||
        (i.tags && i.tags.some(t => t.toLowerCase().includes(q)))
      );
    }
    return list;
  }, [ideas, filterStatus, search]);

  // ── Handlers ─────────────────────────────────────────────────

  function openCreate() {
    setEditingIdea(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(idea) {
    setEditingIdea(idea);
    setForm({
      title: idea.title,
      content: idea.content || '',
      status: idea.status,
      priority: idea.priority || 'normal',
      tags: (idea.tags || []).join(', '),
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingIdea(null);
    setForm(emptyForm);
    setDeleteConfirm(null);
  }

  function parseTags(str) {
    if (!str) return null;
    const arr = str.split(',').map(t => t.trim()).filter(Boolean);
    return arr.length ? arr : null;
  }

  async function handleSave() {
    if (!form.title.trim()) {
      showToast?.('Title is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        content: form.content || null,
        priority: form.priority,
        tags: parseTags(form.tags),
      };

      if (editingIdea) {
        payload.status = form.status;
        await api.ideas.update(editingIdea.id, payload);
        showToast?.('Idea updated', 'success');
      } else {
        await api.ideas.create(payload);
        showToast?.('Idea created', 'success');
      }

      closeModal();
      fetchIdeas();
    } catch (e) {
      showToast?.(e.message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      await api.ideas.remove(id);
      showToast?.('Idea deleted', 'success');
      closeModal();
      fetchIdeas();
    } catch (e) {
      showToast?.(e.message || 'Failed to delete', 'error');
    }
  }

  async function handleQuickStatus(idea, nextStatus) {
    try {
      await api.ideas.update(idea.id, { status: nextStatus });
      fetchIdeas();
    } catch (e) {
      showToast?.(e.message || 'Failed to update status', 'error');
    }
  }

  // ── Status counts ────────────────────────────────────────────

  const counts = useMemo(() => {
    const c = { '': ideas.length, idea: 0, in_progress: 0, implemented: 0, archived: 0 };
    ideas.forEach(i => { if (c[i.status] !== undefined) c[i.status]++; });
    return c;
  }, [ideas]);

  // ── Render ───────────────────────────────────────────────────

  if (loading && !ideas.length) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className={isDark ? 'text-red-400' : 'text-red-600'}>{error}</p>
        <button onClick={fetchIdeas} className="mt-4 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/20">
              <LightbulbIcon className="w-6 h-6" />
            </div>
            <div>
              <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Ideas</h1>
              <p className={`text-sm mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Every idea matters — capture it before it fades
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 hover:from-amber-600 hover:to-orange-600 transition-all active:scale-95"
        >
          <PlusIcon /> New Idea
        </button>
      </div>

      {/* View toggle + Filter tabs + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-600 text-xs mr-2">
          <button
            onClick={() => setViewMode('all')}
            className={`px-3 py-1.5 font-medium transition-colors ${
              viewMode === 'all'
                ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white'
                : isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            All Ideas
          </button>
          <button
            onClick={() => setViewMode('mine')}
            className={`px-3 py-1.5 font-medium transition-colors ${
              viewMode === 'mine'
                ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white'
                : isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            My Ideas
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilterStatus(tab.value)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                filterStatus === tab.value
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/20'
                  : isDark
                    ? 'bg-slate-700/60 text-gray-300 hover:bg-slate-600'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 text-xs ${filterStatus === tab.value ? 'text-amber-100' : isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {counts[tab.value]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:flex-1 sm:max-w-xs">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <SearchIcon />
          </div>
          <input
            type="text"
            placeholder="Search ideas..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`w-full pl-9 pr-3 py-2 border rounded-xl text-sm ${input} outline-none transition-colors`}
          />
        </div>
      </div>

      {/* Ideas Grid */}
      {filtered.length === 0 ? (
        <EmptyState isDark={isDark} hasFilter={!!filterStatus || !!search.trim()} onCreate={openCreate} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(idea => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              isDark={isDark}
              card={card}
              isOwner={idea.user_id === currentUser?.id}
              onClick={() => openEdit(idea)}
              onQuickStatus={handleQuickStatus}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <IdeaModal
          isDark={isDark}
          input={input}
          card={card}
          form={form}
          setForm={setForm}
          editing={!!editingIdea}
          ideaId={editingIdea?.id}
          ideaAuthor={editingIdea ? { name: editingIdea.author_name, role: editingIdea.author_role, created_at: editingIdea.created_at } : null}
          canEdit={!editingIdea || editingIdea.user_id === currentUser?.id}
          currentUser={currentUser}
          showToast={showToast}
          saving={saving}
          deleteConfirm={deleteConfirm}
          onSave={handleSave}
          onClose={closeModal}
          onDelete={() => {
            if (deleteConfirm === editingIdea?.id) {
              handleDelete(editingIdea.id);
            } else {
              setDeleteConfirm(editingIdea?.id);
            }
          }}
          onCancelDelete={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

// ── Idea Card ────────────────────────────────────────────────────

function IdeaCard({ idea, isDark, card, onClick, onQuickStatus, isOwner }) {
  const statusMeta = getStatusMeta(idea.status);
  const priorityMeta = getPriorityMeta(idea.priority);
  const quickActions = isOwner ? getQuickActions(idea.status) : [];

  return (
    <div
      onClick={onClick}
      className={`relative border rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5 group ${card}`}
    >
      {/* Priority dot */}
      {priorityMeta.dot && (
        <div className={`absolute top-4 right-4 w-2.5 h-2.5 rounded-full ${priorityMeta.dot}`} title={`${priorityMeta.label} priority`} />
      )}

      {/* Author */}
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
          isDark ? 'bg-amber-900/40 text-amber-300' : 'bg-amber-100 text-amber-700'
        }`}>
          {(idea.author_name || '?')[0].toUpperCase()}
        </div>
        <span className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {idea.author_name || 'Unknown'}
          {idea.author_role === 'admin' && <span className="ml-1 text-amber-500">CEO</span>}
        </span>
      </div>

      {/* Title */}
      <h3 className={`font-semibold text-base pr-6 mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
        {idea.title}
      </h3>

      {/* Content preview */}
      {idea.content && (
        <p className={`text-sm leading-relaxed mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {truncate(idea.content)}
        </p>
      )}

      {/* Tags */}
      {idea.tags && idea.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {idea.tags.map((tag, i) => (
            <span
              key={i}
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                isDark ? 'bg-slate-700 text-gray-300' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer: status badge + date */}
      <div className="flex items-center justify-between mt-auto pt-2">
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${statusMeta.color}`}>
          {statusMeta.label}
        </span>
        <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {formatDate(idea.created_at)}
        </span>
      </div>

      {/* Quick action buttons - visible on hover (owner only) */}
      {quickActions.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 p-3 pt-6 bg-gradient-to-t from-white/95 via-white/80 to-transparent dark:from-slate-800/95 dark:via-slate-800/80 rounded-b-2xl opacity-0 group-hover:opacity-100 transition-opacity flex gap-2 justify-end">
          {quickActions.map(action => (
            <button
              key={action.nextStatus}
              onClick={e => { e.stopPropagation(); onQuickStatus(idea, action.nextStatus); }}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                isDark
                  ? 'bg-slate-600 text-gray-200 hover:bg-slate-500'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Empty State ──────────────────────────────────────────────────

function EmptyState({ isDark, hasFilter, onCreate }) {
  return (
    <div className="text-center py-16">
      <div className={`inline-flex p-5 rounded-full mb-5 ${isDark ? 'bg-slate-700/50' : 'bg-amber-50'}`}>
        <LightbulbIcon className={`w-12 h-12 ${isDark ? 'text-amber-400' : 'text-amber-500'}`} />
      </div>
      {hasFilter ? (
        <>
          <h3 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>No ideas match your filter</h3>
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Try a different filter or search term.</p>
        </>
      ) : (
        <>
          <h3 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Your ideas board is empty</h3>
          <p className={`text-sm mb-6 max-w-md mx-auto ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Great things start with a single thought. Capture your ideas, refine them, and watch them come to life.
          </p>
          <button
            onClick={onCreate}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 transition-all active:scale-95"
          >
            <PlusIcon /> Write Your First Idea
          </button>
        </>
      )}
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────

function IdeaModal({
  isDark, input, form, setForm, editing, ideaId, ideaAuthor,
  canEdit = true, currentUser, showToast,
  saving, deleteConfirm, onSave, onClose, onDelete, onCancelDelete,
}) {
  const modalBg = isDark ? 'bg-slate-800' : 'bg-white';
  const subtle = isDark ? 'text-gray-400' : 'text-gray-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Panel — tall, wide, flex column with sticky header + footer, scrollable body */}
      <div
        className={`relative w-full max-w-3xl h-[92vh] sm:h-[88vh] rounded-2xl shadow-2xl ${modalBg} flex flex-col overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        {/* Sticky Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-slate-700' : 'border-gray-100'} flex-shrink-0`}>
          <div className="min-w-0">
            <h2 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'} truncate`}>
              {editing ? (form.title || 'Untitled Idea') : 'New Idea'}
            </h2>
            {ideaAuthor && (
              <div className={`text-xs mt-0.5 ${subtle}`}>
                by <span className="font-medium">{ideaAuthor.name || 'Unknown'}</span>
                {ideaAuthor.created_at && <> · {formatDate(ideaAuthor.created_at)}</>}
              </div>
            )}
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-slate-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'} flex-shrink-0 ml-2`}>
            <CloseIcon />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Title */}
          <input
            type="text"
            placeholder="What's your idea?"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            readOnly={!canEdit}
            className={`w-full px-4 py-3 border rounded-xl text-lg font-medium ${input} outline-none transition-colors ${!canEdit ? 'opacity-80 cursor-default' : ''}`}
            autoFocus={canEdit && !editing}
          />

          {/* Content — auto-grows to fit full idea (no internal scrollbar).
              The outer modal body scrolls if the whole thing overflows. */}
          <IdeaContentField
            value={form.content}
            onChange={(v) => setForm(f => ({ ...f, content: v }))}
            readOnly={!canEdit}
            isDark={isDark}
            input={input}
          />

          {/* Status (only when editing) */}
          {editing && (
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${subtle}`}>Status</label>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setForm(f => ({ ...f, status: opt.value }))}
                    disabled={!canEdit}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      form.status === opt.value
                        ? opt.color + ' ring-2 ring-offset-1 ring-amber-400'
                        : isDark
                          ? 'bg-slate-700 text-gray-400 hover:bg-slate-600'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    } disabled:cursor-default disabled:opacity-80`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Priority */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${subtle}`}>Priority</label>
            <div className="flex gap-2">
              {PRIORITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setForm(f => ({ ...f, priority: opt.value }))}
                  disabled={!canEdit}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    form.priority === opt.value
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md'
                      : isDark
                        ? 'bg-slate-700 text-gray-400 hover:bg-slate-600'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  } disabled:cursor-default disabled:opacity-80`}
                >
                  {opt.dot && form.priority !== opt.value && <span className={`w-2 h-2 rounded-full ${opt.dot}`} />}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${subtle}`}>Tags (comma-separated)</label>
            <input
              type="text"
              placeholder="e.g. automation, ux, quick-win"
              value={form.tags}
              onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              readOnly={!canEdit}
              className={`w-full px-4 py-2.5 border rounded-xl text-sm ${input} outline-none transition-colors ${!canEdit ? 'opacity-80 cursor-default' : ''}`}
            />
          </div>

          {/* Attachments — only for saved ideas (we need an ideaId) */}
          {ideaId && (
            <AttachmentsPanel
              ideaId={ideaId}
              isDark={isDark}
              canManage={canEdit}
              currentUserId={currentUser?.id}
              showToast={showToast}
            />
          )}

          {editing && !ideaId && (
            <div className={`text-xs ${subtle} italic`}>
              Save the idea first to attach documents.
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        <div className={`flex items-center justify-between px-6 py-4 border-t ${isDark ? 'border-slate-700 bg-slate-800' : 'border-gray-100 bg-white'} flex-shrink-0`}>
          <div>
            {editing && canEdit && (
              deleteConfirm ? (
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>Confirm delete?</span>
                  <button onClick={onDelete} className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 transition-colors">
                    Yes, delete
                  </button>
                  <button onClick={onCancelDelete} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${isDark ? 'bg-slate-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={onDelete}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isDark ? 'text-red-400 hover:bg-red-900/30' : 'text-red-600 hover:bg-red-50'
                  }`}
                >
                  <TrashIcon /> Delete
                </button>
              )
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {canEdit ? 'Cancel' : 'Close'}
            </button>
            {canEdit && (
              <button
                onClick={onSave}
                disabled={saving}
                className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 hover:from-amber-600 hover:to-orange-600 transition-all disabled:opacity-50 active:scale-95"
              >
                {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Idea'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Auto-growing content field ───────────────────────────────────

function IdeaContentField({ value, onChange, readOnly, isDark, input }) {
  const ref = useRef(null);

  // Grow the textarea to fit its contents so the user doesn't scroll inside it.
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => { resize(); }, [value, resize]);

  // Re-measure on window resize (e.g. modal width changing from responsive classes).
  useEffect(() => {
    const onWin = () => resize();
    window.addEventListener('resize', onWin);
    return () => window.removeEventListener('resize', onWin);
  }, [resize]);

  if (readOnly) {
    // Plain prose — no textarea chrome, content flows naturally.
    return (
      <div
        className={`whitespace-pre-wrap break-words text-sm leading-relaxed px-4 py-3 rounded-xl border ${
          isDark ? 'bg-slate-900/30 border-slate-700 text-gray-200' : 'bg-gray-50/60 border-gray-200 text-gray-800'
        }`}
      >
        {value || <span className="italic opacity-60">No description.</span>}
      </div>
    );
  }

  return (
    <textarea
      ref={ref}
      placeholder="Flesh it out... describe details, benefits, steps..."
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onInput={resize}
      rows={4}
      style={{ resize: 'none', overflow: 'hidden' }}
      className={`w-full px-4 py-3 border rounded-xl text-sm leading-relaxed min-h-[140px] ${input} outline-none transition-colors`}
    />
  );
}

// ── Attachments Panel ────────────────────────────────────────────

function AttachmentsPanel({ ideaId, isDark, canManage, currentUserId, showToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.ideas.attachments(ideaId);
      setItems(data.attachments || []);
    } catch (e) {
      if (e.status !== 401) showToast?.(e.message || 'Failed to load attachments', 'error');
    } finally {
      setLoading(false);
    }
  }, [ideaId, showToast]);

  useEffect(() => { load(); }, [load]);

  const uploadFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        await api.ideas.uploadAttachment(ideaId, file);
      }
      showToast?.(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''}`, 'success');
      load();
    } catch (e) {
      showToast?.(e.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  }, [ideaId, showToast, load]);

  function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    if (!canManage) return;
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) uploadFiles(files);
  }

  async function openAttachment(att) {
    try {
      const { url } = await api.ideas.attachmentUrl(att.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      showToast?.(e.message || 'Failed to open file', 'error');
    }
  }

  async function deleteAttachment(att) {
    if (!confirm(`Delete "${att.file_name}"?`)) return;
    try {
      await api.ideas.removeAttachment(att.id);
      setItems(prev => prev.filter(x => x.id !== att.id));
    } catch (e) {
      showToast?.(e.message || 'Failed to delete', 'error');
    }
  }

  const subtle = isDark ? 'text-gray-400' : 'text-gray-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className={`block text-xs font-medium ${subtle}`}>
          Attachments {items.length > 0 && <span className="font-normal opacity-70">· {items.length}</span>}
        </label>
      </div>

      {/* Drop zone (only when owner/admin/manager) */}
      {canManage && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
            dragActive
              ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-900/20'
              : isDark ? 'border-slate-600 hover:border-slate-500 bg-slate-900/20' : 'border-gray-300 hover:border-amber-300 bg-gray-50/50'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => uploadFiles(Array.from(e.target.files || []))}
          />
          <div className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
            {uploading ? 'Uploading…' : 'Drop files here or click to upload'}
          </div>
          <div className={`text-xs mt-1 ${subtle}`}>
            Up to 20 MB per file. Stored in Supabase bucket.
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className={`mt-3 text-xs ${subtle}`}>Loading attachments…</div>
      ) : items.length === 0 ? (
        <div className={`mt-3 text-xs ${subtle}`}>No attachments yet.</div>
      ) : (
        <ul className={`mt-3 divide-y rounded-xl border ${isDark ? 'divide-slate-700 border-slate-700' : 'divide-gray-100 border-gray-200'}`}>
          {items.map((att) => {
            const canDelete = canManage || att.user_id === currentUserId;
            return (
              <li key={att.id} className="flex items-center gap-3 px-3 py-2">
                <button
                  type="button"
                  onClick={() => openAttachment(att)}
                  className={`flex-1 text-left min-w-0 ${isDark ? 'text-gray-100 hover:text-amber-300' : 'text-gray-800 hover:text-amber-600'}`}
                >
                  <div className="text-sm font-medium truncate">{att.file_name}</div>
                  <div className={`text-xs ${subtle}`}>
                    {formatBytes(att.file_size)}
                    {att.uploader_name ? ` · ${att.uploader_name}` : ''}
                    {att.created_at ? ` · ${formatDate(att.created_at)}` : ''}
                  </div>
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => deleteAttachment(att)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      isDark ? 'text-red-400 hover:bg-red-900/30' : 'text-red-600 hover:bg-red-50'
                    }`}
                    title="Delete attachment"
                    aria-label="Delete attachment"
                  >
                    <TrashIcon />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
