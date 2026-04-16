/**
 * FibreFlow Chat Widget
 * Floating chat button + topic-scoped conversation panel.
 */

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Sparkles, ChevronDown, ChevronLeft, Bot, User,
  LayoutDashboard, FolderKanban, CheckCircle, MapPin, Wrench, ShoppingCart, Package, Truck, Users, BarChart3, MessageSquare, Settings, HelpCircle, HardHat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { log } from '@/lib/logger';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface Topic {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
}

const TOPICS: Topic[] = [
  { id: 'getting-started', label: 'Getting Started', icon: <HelpCircle className="w-4 h-4" />, color: 'text-blue-400' },
  { id: 'dashboard', label: 'Dashboard & Meetings', icon: <LayoutDashboard className="w-4 h-4" />, color: 'text-purple-400' },
  { id: 'projects', label: 'Project Management', icon: <FolderKanban className="w-4 h-4" />, color: 'text-emerald-400' },
  { id: 'activate', label: 'Activate & QA', icon: <CheckCircle className="w-4 h-4" />, color: 'text-cyan-400' },
  { id: 'construction-qa', label: 'Construction QA', icon: <HardHat className="w-4 h-4" />, color: 'text-amber-400' },
  { id: 'field-ops', label: 'Field Operations', icon: <MapPin className="w-4 h-4" />, color: 'text-green-400' },
  { id: 'maintenance', label: 'Maintenance', icon: <Wrench className="w-4 h-4" />, color: 'text-orange-400' },
  { id: 'procurement', label: 'Procurement', icon: <ShoppingCart className="w-4 h-4" />, color: 'text-yellow-400' },
  { id: 'assets', label: 'Assets', icon: <Package className="w-4 h-4" />, color: 'text-pink-400' },
  { id: 'fleet', label: 'Fleet Management', icon: <Truck className="w-4 h-4" />, color: 'text-red-400' },
  { id: 'hr', label: 'Human Resources', icon: <Users className="w-4 h-4" />, color: 'text-indigo-400' },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4" />, color: 'text-teal-400' },
  { id: 'communications', label: 'Communications', icon: <MessageSquare className="w-4 h-4" />, color: 'text-violet-400' },
  { id: 'system', label: 'System Admin', icon: <Settings className="w-4 h-4" />, color: 'text-gray-400' },
];

interface ChatWidgetProps {
  userName?: string;
  userRole?: string;
  userId?: string;
}

const STORAGE_KEY = 'ff-chat-widget';
const BTN_SIZE = 56;
const DRAG_THRESHOLD = 5;

export const ChatWidget: React.FC<ChatWidgetProps> = ({ userName, userRole, userId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [dataAccess, setDataAccess] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [position, setPosition] = useState({ x: 24, y: 24 });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dragState = useRef({ dragging: false, moved: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  // Restore persisted position + hidden state
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.x !== undefined) setPosition({ x: parsed.x, y: parsed.y });
        if (parsed.hidden) setIsHidden(true);
      }
    } catch { /* ignore corrupt storage */ }
  }, []);

  // Persist position + hidden state
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: position.x, y: position.y, hidden: isHidden }));
  }, [position, isHidden]);

  // Drag handlers — pointer events for mouse + touch
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragState.current = { dragging: true, moved: false, startX: e.clientX, startY: e.clientY, origX: position.x, origY: position.y };
    btnRef.current?.setPointerCapture(e.pointerId);
  }, [position]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds.dragging) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (!ds.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    ds.moved = true;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPosition({
      x: Math.max(4, Math.min(vw - BTN_SIZE - 4, ds.origX + dx)),
      y: Math.max(4, Math.min(vh - BTN_SIZE - 4, ds.origY - dy)),
    });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current;
    btnRef.current?.releasePointerCapture(e.pointerId);
    if (ds.moved) { ds.dragging = false; return; }
    ds.dragging = false;
    setIsOpen(prev => !prev);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsHidden(true);
    setIsOpen(false);
  }, []);

  // Check if user has data lookup permission
  useEffect(() => {
    if (userId) {
      fetch('/api/chat/access', { credentials: 'include' })
        .then(r => r.json())
        .then(d => setDataAccess(!!d.dataAccess))
        .catch((e) => log.debug('Chat access check failed', { error: e instanceof Error ? e.message : 'unknown' }, 'help-center'));
    }
  }, [userId]);

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen && selectedTopic && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen, selectedTopic]);

  const handleScroll = useCallback(() => {
    const c = messagesContainerRef.current;
    if (!c) return;
    setShowScrollDown(c.scrollHeight - c.scrollTop - c.clientHeight > 100 && messages.length > 3);
  }, [messages.length]);

  const sendMessage = async (text?: string) => {
    const trimmed = (text || input).trim();
    if (!trimmed || isLoading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`, role: 'user', content: trimmed, timestamp: new Date(),
    };
    const assistantId = `assistant-${Date.now()}`;
    setMessages(prev => [...prev, userMessage]);
    if (!text) setInput('');
    setIsLoading(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed, userName, userRole, userId,
          topic: selectedTopic?.id,
          history, dataAccess,
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      // Add placeholder message, then stream tokens into it
      setMessages(prev => [...prev, {
        id: assistantId, role: 'assistant', content: '', timestamp: new Date(),
      }]);
      setIsLoading(false);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;
          const payload = trimmedLine.slice(6);
          if (payload === '[DONE]') break outer;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: parsed.error } : m
              ));
              break outer;
            }
            if (parsed.token) {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: m.content + parsed.token } : m
              ));
            }
          } catch {
            // malformed SSE chunk — skip
          }
        }
      }
    } catch {
      setIsLoading(false);
      setMessages(prev => {
        const hasPlaceholder = prev.some(m => m.id === assistantId);
        if (hasPlaceholder) {
          return prev.map(m =>
            m.id === assistantId
              ? { ...m, content: 'Sorry, I couldn\'t connect to the help service. Please try again.' }
              : m
          );
        }
        return [...prev, {
          id: `error-${Date.now()}`, role: 'assistant' as const,
          content: 'Sorry, I couldn\'t connect to the help service. Please try again.',
          timestamp: new Date(),
        }];
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const selectTopic = (topic: Topic) => {
    setSelectedTopic(topic);
    setMessages([]);
  };

  const goBack = () => {
    setSelectedTopic(null);
    setMessages([]);
  };

  // Simple markdown rendering
  const renderContent = (content: string) => {
    return content.split('\n').map((line, i) => {
      const parts: React.ReactNode[] = [];
      let remaining = line;
      let key = 0;

      while (remaining) {
        const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
        if (boldMatch && boldMatch.index !== undefined) {
          if (boldMatch.index > 0) parts.push(remaining.substring(0, boldMatch.index));
          parts.push(<strong key={`b-${i}-${key++}`}>{boldMatch[1]}</strong>);
          remaining = remaining.substring(boldMatch.index + boldMatch[0].length);
          continue;
        }
        const codeMatch = remaining.match(/`([^`]+)`/);
        if (codeMatch && codeMatch.index !== undefined) {
          if (codeMatch.index > 0) parts.push(remaining.substring(0, codeMatch.index));
          parts.push(<code key={`c-${i}-${key++}`} className="bg-card/10 px-1.5 py-0.5 rounded text-xs font-mono">{codeMatch[1]}</code>);
          remaining = remaining.substring(codeMatch.index + codeMatch[0].length);
          continue;
        }
        parts.push(remaining);
        break;
      }

      const processed = parts.length > 0 ? <>{parts}</> : line;
      if (line.match(/^#{1,3}\s/)) return <p key={i} className="font-semibold text-[var(--ff-text-primary)] mt-2 mb-1">{processed}</p>;
      if (line.match(/^\d+\.\s/)) return <li key={i} className="ml-4 list-decimal">{processed}</li>;
      if (line.match(/^[-*]\s/)) return <li key={i} className="ml-4 list-disc">{processed}</li>;
      if (!line.trim()) return <br key={i} />;
      return <p key={i} className="mb-1">{processed}</p>;
    });
  };

  const panelLeft = Math.min(position.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 416);
  const panelBottom = position.y + BTN_SIZE + 12;

  return (
    <>
      {/* Restore pill — visible when widget is hidden */}
      {isHidden && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsHidden(false)}
          className="fixed bottom-2 left-1/2 -translate-x-1/2 z-[9999] rounded-full border border-[var(--ff-border-light)] text-[10px] shadow-lg"
        >
          Show Velo chat
        </Button>
      )}

      {/* Floating Button — draggable, right-click to hide */}
      {!isHidden && (
        <button
          ref={btnRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onContextMenu={handleContextMenu}
          className={cn(
            'fixed z-[9999] flex items-center justify-center rounded-full shadow-2xl select-none touch-none transition-all duration-300 hover:scale-110 active:scale-95',
            isOpen
              ? 'w-12 h-12 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              : 'w-14 h-14 bg-gradient-to-br from-emerald-500 to-cyan-500 text-white hover:from-emerald-400 hover:to-cyan-400'
          )}
          style={{ left: position.x, bottom: position.y }}
          title={isOpen ? 'Close chat · Right-click to hide' : 'Ask Velo · Drag to move · Right-click to hide'}
        >
          {isOpen ? <X className="w-5 h-5" /> : <MessageCircle className="w-6 h-6" />}
          {!isOpen && messages.length === 0 && (
            <span className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 animate-ping opacity-20" />
          )}
        </button>
      )}

      {/* Chat Panel */}
      <div
        className={cn(
          'fixed z-[9998] w-[400px] max-w-[calc(100vw-48px)] transition-all duration-300 ease-out',
          isOpen && !isHidden ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'
        )}
        style={{ left: panelLeft, bottom: panelBottom }}
      >
        <div className="flex flex-col h-[560px] max-h-[70vh] rounded-2xl overflow-hidden shadow-2xl border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)]">
          
          {/* Header */}
          <div className="flex-shrink-0 bg-gradient-to-r from-emerald-600 to-cyan-600 p-4">
            <div className="flex items-center gap-3">
              {selectedTopic && (
                <Button variant="ghost" size="icon" onClick={goBack} className="text-white/70 hover:text-white hover:bg-card/10">
                  <ChevronLeft className="w-5 h-5" />
                </Button>
              )}
              <div className="w-10 h-10 rounded-full bg-card/20 flex items-center justify-center backdrop-blur-sm">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white text-sm">Velo - Your Digital Assistant</h3>
                <p className="text-xs text-white/70">
                  {selectedTopic ? selectedTopic.label : 'Choose a topic to get started'}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="text-white/70 hover:text-white hover:bg-card/10">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Topic Selection */}
          {!selectedTopic && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="text-center mb-4">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center mb-3">
                  <Bot className="w-7 h-7 text-emerald-400" />
                </div>
                <h4 className="font-semibold text-[var(--ff-text-primary)] mb-1">
                  Hi{userName ? `, ${userName}` : ''}! 👋
                </h4>
                <p className="text-xs text-[var(--ff-text-tertiary)]">
                  What do you need help with?
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {TOPICS.map((topic) => (
                  <button
                    key={topic.id}
                    onClick={() => selectTopic(topic)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-left hover:bg-[var(--ff-bg-tertiary)] hover:border-emerald-500/30 transition-all group"
                  >
                    <span className={cn('transition-colors', topic.color)}>{topic.icon}</span>
                    <span className="text-xs text-[var(--ff-text-secondary)] group-hover:text-[var(--ff-text-primary)] transition-colors leading-tight">{topic.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat Area */}
          {selectedTopic && (
            <>
              <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center px-4">
                    <div className={cn('w-12 h-12 rounded-xl bg-[var(--ff-bg-secondary)] flex items-center justify-center mb-3', selectedTopic.color)}>
                      {selectedTopic.icon}
                    </div>
                    <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
                      Ask anything about <strong>{selectedTopic.label}</strong>
                    </p>
                    <div className="space-y-2 w-full">
                      {getQuickQuestions(selectedTopic.id).map((q) => (
                        <Button
                          key={q}
                          variant="ghost"
                          size="sm"
                          onClick={() => sendMessage(q)}
                          className="w-full text-left text-xs"
                        >
                          {q}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <div key={msg.id} className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                    {msg.role === 'assistant' && (
                      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center mt-0.5">
                        <Bot className="w-3.5 h-3.5 text-emerald-400" />
                      </div>
                    )}
                    <div className={cn(
                      'max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-gradient-to-br from-emerald-600 to-cyan-600 text-white rounded-br-md'
                        : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-bl-md'
                    )}>
                      {msg.role === 'assistant' ? renderContent(msg.content) : msg.content}
                    </div>
                    {msg.role === 'user' && (
                      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[var(--ff-bg-tertiary)] flex items-center justify-center mt-0.5">
                        <User className="w-3.5 h-3.5 text-[var(--ff-text-secondary)]" />
                      </div>
                    )}
                  </div>
                ))}

                {isLoading && (
                  <div className="flex gap-2 items-start">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-2xl rounded-bl-md px-4 py-3">
                      <div className="flex gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 rounded-full bg-emerald-400/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 rounded-full bg-emerald-400/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {showScrollDown && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                  className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full shadow-lg"
                >
                  <ChevronDown className="w-4 h-4" />
                </Button>
              )}

              {/* Input */}
              <div className="flex-shrink-0 p-3 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`Ask about ${selectedTopic.label}...`}
                    rows={1}
                    className="flex-1 resize-none rounded-xl px-3.5 py-2.5 text-sm bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 max-h-24"
                    style={{ minHeight: '40px' }}
                    onInput={(e) => {
                      const t = e.target as HTMLTextAreaElement;
                      t.style.height = '40px';
                      t.style.height = Math.min(t.scrollHeight, 96) + 'px';
                    }}
                  />
                  <Button
                    variant="primary"
                    size="icon"
                    onClick={() => sendMessage()}
                    disabled={!input.trim() || isLoading}
                    className="flex-shrink-0 rounded-xl"
                  >
                    {isLoading ? <InlineSpinner size="sm" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-[10px] text-[var(--ff-text-tertiary)] mt-1.5 text-center">
                  AI-powered • May occasionally be inaccurate
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

// Quick questions per topic
function getQuickQuestions(topicId: string): string[] {
  const questions: Record<string, string[]> = {
    'getting-started': ['How do I log in?', 'What are the user roles?', 'How do I navigate the sidebar?'],
    'dashboard': ['What do the dashboard cards show?', 'How do I view meetings?', 'How do action items work?'],
    'projects': ['How do I create a new project?', 'What tabs are in project detail?', 'How does the pipeline work?'],
    'activate': ['What is the QA wizard?', 'How does the 5-phase review work?', 'What is PP Data?'],
    'construction-qa': [
      'How does the Construction QA workflow work?',
      'How do I export QA data to Excel?',
      'How do I drill down by zone and PON?',
      'What are the discipline-specific checklists?',
    ],
    'field-ops': ['How does QField QA work?', 'How are photos validated?', 'What is the Construction QA wizard?'],
    'maintenance': ['How do I create a ticket?', 'What are the SLA targets?', 'How does the Kanban board work?'],
    'procurement': [
      'How do I create a BOQ?',
      'How do I process a field stock transfer?',
      'How do I report a faulty item?',
      'How do I view the procurement audit trail?',
    ],
    'assets': ['How do I check out an asset?', 'How does calibration tracking work?', 'How do I create an asset?'],
    'fleet': ['How do vehicle check-ins work?', 'How is fuel managed?', 'What is GPS investigation?'],
    'hr': ['How do I add a staff member?', 'How does compliance tracking work?', 'How do departments work?'],
    'analytics': ['What KPIs are available?', 'How do I generate reports?', 'What is technician performance?'],
    'communications': [
      'How does WhatsApp admin work?',
      'How do I use Mission Control?',
      'What PDF tools are available?',
    ],
    'system': [
      'What is the System Health Hub?',
      'How does Data Sync work?',
      'How do I use Mission Control to manage AI agents?',
      'What is VLM Learning?',
    ],
  };
  return questions[topicId] || ['How does this module work?'];
}
