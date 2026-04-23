import { useState, useRef, useEffect } from 'react';
import { hasApi, getToken } from '../api/client';
import { api } from '../api/client';
import useModalKeyboard from '../hooks/useModalKeyboard';

const AGENT_COLORS = {
  db: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  solar: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  hr: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  code: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  general: 'bg-gray-100 text-gray-800 dark:bg-gray-700/40 dark:text-gray-300',
};

const AGENT_ICONS = {
  db: '\u{1F5C4}\uFE0F', solar: '\u2600\uFE0F', hr: '\u{1F465}', code: '\u{1F4BB}', general: '\u{1F4AC}',
};

// ── Markdown renderer ────────────────────────────────────────────
function renderInline(text) {
  // Handle inline bold, inline code, and plain text
  const parts = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code `...`
    const codeMatch = remaining.match(/`([^`]+)`/);
    // Inline bold **...**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);

    let firstMatch = null;
    let matchType = null;

    if (codeMatch && (!firstMatch || codeMatch.index < firstMatch.index)) {
      firstMatch = codeMatch;
      matchType = 'code';
    }
    if (boldMatch && (!firstMatch || boldMatch.index < firstMatch.index)) {
      firstMatch = boldMatch;
      matchType = 'bold';
    }

    if (!firstMatch) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    if (firstMatch.index > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, firstMatch.index)}</span>);
    }

    if (matchType === 'bold') {
      parts.push(<strong key={key++} className="font-semibold">{firstMatch[1]}</strong>);
    } else {
      parts.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-xs font-mono">
          {firstMatch[1]}
        </code>
      );
    }

    remaining = remaining.slice(firstMatch.index + firstMatch[0].length);
  }

  return parts;
}

function MarkdownContent({ text }) {
  const lines = text.split('\n');
  const elements = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block ```
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={key++} className="my-2 p-2.5 rounded-lg bg-black/10 dark:bg-black/30 overflow-x-auto text-xs font-mono leading-relaxed">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Empty line → spacer
    if (line.trim() === '') {
      elements.push(<div key={key++} className="h-2" />);
      i++;
      continue;
    }

    // Headers # ## ###
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const cls = level === 1
        ? 'text-base font-bold mt-3 mb-1'
        : level === 2
          ? 'text-sm font-bold mt-2.5 mb-1'
          : 'text-sm font-semibold mt-2 mb-0.5';
      elements.push(<div key={key++} className={cls}>{renderInline(headerMatch[2])}</div>);
      i++;
      continue;
    }

    // Bullet lists: - item, * item, • item
    const bulletMatch = line.match(/^(\s*)([-*•])\s+(.*)/);
    if (bulletMatch) {
      const indent = Math.floor(bulletMatch[1].length / 2);
      elements.push(
        <div key={key++} className="flex items-start gap-1.5" style={{ paddingLeft: `${indent * 12}px` }}>
          <span className="text-brand mt-0.5 flex-shrink-0">•</span>
          <span>{renderInline(bulletMatch[3])}</span>
        </div>
      );
      i++;
      continue;
    }

    // Numbered lists: 1. item, 2) item
    const numMatch = line.match(/^(\s*)(\d+)[.)]\s+(.*)/);
    if (numMatch) {
      const indent = Math.floor(numMatch[1].length / 2);
      elements.push(
        <div key={key++} className="flex items-start gap-1.5" style={{ paddingLeft: `${indent * 12}px` }}>
          <span className="text-brand/80 font-medium flex-shrink-0 min-w-[1.2em] text-right">{numMatch[2]}.</span>
          <span>{renderInline(numMatch[3])}</span>
        </div>
      );
      i++;
      continue;
    }

    // Horizontal rule --- or ***
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      elements.push(<hr key={key++} className="my-2 border-current opacity-15" />);
      i++;
      continue;
    }

    // Normal paragraph
    elements.push(<p key={key++}>{renderInline(line)}</p>);
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

const SUGGESTIONS = [
  { label: 'Who is on leave today?', agent: 'db' },
  { label: 'Employees at Ameresco', agent: 'db' },
  { label: 'Pending leave requests', agent: 'db' },
  { label: 'Upcoming holidays', agent: 'db' },
  { label: 'Who has the most comp leaves?', agent: 'db' },
  { label: 'Who worked on holidays this year?', agent: 'db' },
  { label: 'My comp off balance', agent: 'db' },
  { label: 'Asset summary', agent: 'db' },
  { label: '@solar latest industry news', agent: 'solar' },
  { label: '@hr leave policy info', agent: 'hr' },
];

export default function AIAssistant({ isOpen, onClose, isDark }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: "Hi! I'm your AI assistant. I can help with:\n\n\u2022 @nick \u2014 Workforce & app queries (employees, leaves, assets, schedules)\n\u2022 @solar \u2014 Solar industry news & updates\n\u2022 @hr \u2014 HR policies & procedures\n\nUse @ prefix to target a specific agent, or just ask anything!",
      data: null,
      agent: null,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // Sticky agent — once @nick/@solar/@hr is triggered, follow-ups stay on that
  // agent until the user explicitly switches. Cleared when the panel closes.
  const [activeAgent, setActiveAgent] = useState(null); // 'db' | 'solar' | 'hr' | null
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const modalRef = useModalKeyboard(isOpen, onClose);

  // Reset sticky agent whenever the assistant is reopened so stale context
  // doesn't leak across sessions.
  useEffect(() => { if (!isOpen) setActiveAgent(null); }, [isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  const handleSend = async (text) => {
    const raw = (text || input).trim();
    if (!raw || loading) return;

    // Detect explicit @agent mention. If present, lock it as the active agent.
    // Otherwise, inherit the current active agent (sticky).
    const explicitMatch = raw.match(/^@(nick|solar|hr)\b/i);
    let nextActive = activeAgent;
    if (explicitMatch) {
      const tag = explicitMatch[1].toLowerCase();
      nextActive = tag === 'nick' ? 'db' : tag;
      setActiveAgent(nextActive);
    }

    // Build the query the backend sees — prefix @<agent> when we have a sticky
    // agent and the user didn't type one explicitly.
    let q = raw;
    if (!explicitMatch && nextActive) {
      const prefix = nextActive === 'db' ? '@nick' : `@${nextActive}`;
      q = `${prefix} ${raw}`;
    }

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: raw }]);
    setLoading(true);

    try {
      if (!hasApi() || !getToken()) {
        setMessages((prev) => [...prev, { role: 'assistant', text: 'Please log in to use the assistant.', data: null }]);
        return;
      }
      const result = await api.assistant.query(q);
      // Lock sticky agent to whichever agent actually answered — handles the
      // case where the router chose (e.g. general → nick without explicit tag).
      if (result.agent && ['db', 'solar', 'hr'].includes(result.agent)) {
        setActiveAgent(result.agent);
      }
      setMessages((prev) => [...prev, {
        role: 'assistant',
        text: result.text || 'No response.',
        data: result.data,
        agent: result.agent || null,
        agentName: result.agentName || null,
      }]);
    } catch (e) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        text: `Error: ${e.message || 'Something went wrong. Please try again.'}`,
        data: null,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const panelClass = isDark
    ? 'bg-slate-800 border-slate-600 text-white'
    : 'bg-white border-gray-200 text-gray-900';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose} role="dialog" aria-modal="true" aria-label="AI Assistant">
      <div
        ref={modalRef}
        className={`w-full max-w-md ${panelClass} border-l shadow-xl flex flex-col max-h-full animate-slide-in-right`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-inherit flex items-center justify-between">
          <span className="font-semibold flex items-center gap-2">
            <svg className="w-5 h-5 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            AI Assistant
            <span className="text-xs font-normal opacity-60">multi-agent</span>
          </span>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Sticky agent bar — always visible so users know which agent to call.
            Clicking a pill switches the sticky agent; the ring highlights
            whoever is currently answering follow-ups. */}
        <div className={`px-4 py-2 border-b text-[11px] leading-snug ${isDark ? 'bg-slate-900/60 border-slate-700 text-gray-300' : 'bg-amber-50 border-amber-100 text-gray-700'}`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {[
              { id: 'db', label: '@nick', desc: 'workforce & DB' },
              { id: 'solar', label: '@solar', desc: 'industry news' },
              { id: 'hr', label: '@hr', desc: 'HR policy' },
            ].map((a, i) => (
              <span key={a.id} className="inline-flex items-center gap-1">
                {i > 0 && <span className="opacity-40 mr-1">·</span>}
                <button
                  type="button"
                  onClick={() => setActiveAgent(a.id)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold ${AGENT_COLORS[a.id]} ${
                    activeAgent === a.id ? 'ring-2 ring-offset-1 ring-amber-400' : ''
                  }`}
                  title={activeAgent === a.id ? `Active — follow-ups go to ${a.label}` : `Switch to ${a.label}`}
                >
                  {AGENT_ICONS[a.id]} {a.label}
                </button>
                <span className="opacity-80">{a.desc}</span>
              </span>
            ))}
            {activeAgent && (
              <button
                type="button"
                onClick={() => setActiveAgent(null)}
                className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                  isDark ? 'bg-slate-700 hover:bg-slate-600 text-gray-300' : 'bg-white hover:bg-gray-100 text-gray-600'
                }`}
                title="Stop routing to a specific agent"
              >
                clear
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className="max-w-[90%]">
                {/* Agent badge */}
                {m.role === 'assistant' && m.agent && (
                  <div className="mb-1">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${AGENT_COLORS[m.agent] || AGENT_COLORS.general}`}>
                      {AGENT_ICONS[m.agent] || '🤖'} {m.agentName || m.agent}
                    </span>
                  </div>
                )}
                <div
                  className={`rounded-lg px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-brand text-white'
                      : isDark
                        ? 'bg-slate-700 text-gray-100'
                        : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <MarkdownContent text={m.text} />

                  {m.data && m.data.length > 0 && (
                    <div className={`mt-2 rounded-lg overflow-hidden border ${isDark ? 'border-slate-600' : 'border-gray-200'}`}>
                      {m.data.map((item, j) => (
                        <div
                          key={j}
                          className={`px-3 py-2 text-xs flex flex-col gap-0.5 ${
                            j % 2 === 0
                              ? isDark ? 'bg-slate-600/50' : 'bg-gray-50'
                              : isDark ? 'bg-slate-700/50' : 'bg-white'
                          }`}
                        >
                          <span className="font-medium">{item.name}</span>
                          <div className="flex gap-2 flex-wrap text-xs opacity-75">
                            {item.detail && <span>{item.detail}</span>}
                            {item.extra && <span>{item.extra}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className={`rounded-lg px-4 py-2 text-sm ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`}>
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 bg-brand rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-brand rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-brand rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Quick suggestions with agent tags */}
        <div className={`px-4 py-2 border-t ${isDark ? 'border-slate-700' : 'border-gray-100'}`}>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => handleSend(s.label)}
                disabled={loading}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  isDark
                    ? 'bg-slate-700 text-gray-300 hover:bg-slate-600 hover:text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-brand/10 hover:text-brand'
                } disabled:opacity-50`}
              >
                {AGENT_ICONS[s.agent] || ''} {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Input */}
        <div className="p-4 border-t border-inherit flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={activeAgent
              ? `Chatting with ${activeAgent === 'db' ? '@nick' : `@${activeAgent}`} — type @solar / @hr to switch`
              : 'Ask anything, or use @nick @solar @hr'}
            disabled={loading}
            className={`flex-1 rounded-lg px-3 py-2 text-sm border ${
              isDark ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400' : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-500'
            } focus:ring-2 focus:ring-brand disabled:opacity-50`}
          />
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={loading || !input.trim()}
            className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
