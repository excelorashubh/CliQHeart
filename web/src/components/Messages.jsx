import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, MessageCircle, RefreshCw, Search, Send } from 'lucide-react';
import { Avatar } from './Brand.jsx';
import { EmptyState, ErrorState, Skeleton } from './Feedback.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { messageApi, userApi } from '../services/api.js';

export function MessageWorkspace() {
  const { conversationId } = useParams();
  const { user: currentUser } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [error, setError] = useState('');
  const [messageError, setMessageError] = useState('');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [sending, setSending] = useState(false);
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const requestId = useRef(0);
  const preserveScroll = useRef(null);

  const loadConversations = useCallback(async () => {
    setError('');
    try {
      const data = await messageApi.conversations();
      setConversations(data.conversations || []);
    } catch (reason) {
      setError(reason.message || 'Could not load conversations.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    const request = ++requestId.current;
    setMessageLoading(true);
    setMessageError('');
    try {
      const data = await messageApi.messages(conversationId);
      if (request === requestId.current) {
        const page = data.messages || [];
        setMessages(page);
        setHasOlderMessages(page.length === 30);
      }
    } catch (reason) {
      if (request === requestId.current) setMessageError(reason.message || 'Could not load messages.');
    } finally {
      if (request === requestId.current) setMessageLoading(false);
    }
  }, [conversationId]);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => { loadMessages(); }, [loadMessages]);
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    if (preserveScroll.current) {
      const { top, height } = preserveScroll.current;
      scrollRef.current.scrollTop = top + scrollRef.current.scrollHeight - height;
      preserveScroll.current = null;
    } else {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2) {
      setResults([]);
      setSearchError('');
      setSearching(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError('');
      try {
        const data = await userApi.search(clean, { signal: controller.signal });
        setResults(data.users || []);
      } catch (reason) {
        if (reason.name !== 'AbortError') setSearchError(reason.message);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  async function startConversation(participantId) {
    try {
      const result = await messageApi.createConversation(participantId);
      await loadConversations();
      const id = result.conversation?.id;
      if (id) {
        setQuery('');
        navigate(`/messages/${id}`);
      }
    } catch (reason) {
      setSearchError(reason.message || 'Could not start this conversation.');
    }
  }

  async function send(event) {
    event.preventDefault();
    const content = text.trim();
    if (!content || sending || !conversationId) return;
    setSending(true);
    setMessageError('');
    try {
      const result = await messageApi.send(conversationId, content);
      if (result.message) {
        setMessages((current) => [...current.filter((item) => item.id !== result.message.id), result.message]);
        setText('');
        await loadConversations();
      }
    } catch (reason) {
      setMessageError(reason.message || 'Could not send this message.');
    } finally {
      setSending(false);
    }
  }

  async function loadOlder() {
    const oldest = messages[0]?.createdAt;
    if (!oldest || loadingOlder || !scrollRef.current) return;
    preserveScroll.current = {
      top: scrollRef.current.scrollTop,
      height: scrollRef.current.scrollHeight,
    };
    setLoadingOlder(true);
    setMessageError('');
    try {
      const data = await messageApi.messages(conversationId, { before: oldest });
      const older = data.messages || [];
      setMessages((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...older.filter((item) => !known.has(item.id)), ...current];
      });
      setHasOlderMessages(older.length === 30);
      if (!older.length) preserveScroll.current = null;
    } catch (reason) {
      preserveScroll.current = null;
      setMessageError(reason.message || 'Could not load older messages.');
    } finally {
      setLoadingOlder(false);
    }
  }

  const active = conversations.find((item) => item.id === conversationId);
  return <div className="messages-page">
    <aside className={`inbox-panel${conversationId ? ' inbox-panel--mobile-hidden' : ''}`}>
      <header className="inbox-header"><div><p className="eyebrow">YOUR CONNECTIONS</p><h1>Messages</h1></div><button className="icon-button" aria-label="Refresh conversations" onClick={loadConversations}><RefreshCw size={17} /></button></header>
      <label className="search-field inbox-search"><Search size={17} /><input placeholder="Find someone to message" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search users to message" /></label>
      {searching && <p className="helper-text">Finding people…</p>}
      {searchError && <p className="form-error">{searchError}</p>}
      {results.length > 0 && <div className="message-search-results">{results.map((person) => <button key={person.id} className="conversation-row" onClick={() => startConversation(person.id)}><Avatar name={person.displayName} src={person.avatarUrl} /><span><b>{person.displayName}</b><small>@{person.username}</small></span><ArrowUpRight size={16} /></button>)}</div>}
      {loading ? <Skeleton rows={4} /> : error ? <ErrorState error={error} onRetry={loadConversations} /> : conversations.length === 0 && query.trim().length < 2 ? <EmptyState title="A little quiet here" description="Search for someone above to start a conversation." icon={MessageCircle} /> : (
        <div className="conversation-list">{conversations.map((item) => <Link key={item.id} to={`/messages/${item.id}`} className={`conversation-row${conversationId === item.id ? ' is-selected' : ''}`}>
          <Avatar name={item.participant?.displayName || ''} src={item.participant?.avatarUrl} />
          <span><b>{item.participant?.displayName || 'Unavailable account'}</b><small>{item.lastMessage?.text || 'Start a conversation'}</small></span>
          {item.lastMessageAt && <time>{formatTime(item.lastMessageAt)}</time>}
        </Link>)}</div>
      )}
    </aside>
    <section className={`chat-panel${conversationId ? ' chat-panel--mobile-active' : ''}`}>
      {!conversationId ? <div className="chat-welcome"><span className="chat-welcome-icon"><MessageCircle size={28} /></span><h2>Your conversations</h2><p>Choose a conversation or find someone new to say hello.</p><span className="helper-text">Messages refresh when you open or manually refresh a conversation.</span></div>
        : <><header className="chat-header"><Link to="/messages" className="back-link" aria-label="Back to messages"><ArrowLeft size={19} /></Link><Avatar name={active?.participant?.displayName || ''} src={active?.participant?.avatarUrl} size="small" /><span><b>{active?.participant?.displayName || 'Conversation'}</b><small>@{active?.participant?.username || ''}</small></span><button className="icon-button chat-refresh" aria-label="Refresh messages" onClick={loadMessages}><RefreshCw size={17} /></button></header>
          <div className="chat-messages" ref={scrollRef}>
            {messageLoading ? <Skeleton rows={5} /> : messageError && messages.length === 0 ? <ErrorState error={messageError} onRetry={loadMessages} /> : messages.length === 0 ? <EmptyState title="Your first hello" description="Send a message to get things started." icon={MessageCircle} /> : <>
              {hasOlderMessages && <button className="button button--outline older-messages" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'Loading older messages…' : 'Load older messages'}</button>}
              {messages.map((message) => <div key={message.id} className={`message-bubble${message.senderId === currentUser?.id ? ' message-bubble--mine' : ''}`}><p>{message.text}</p><time>{formatTime(message.createdAt)}</time></div>)}
            </>}
          </div>
          {messageError && messages.length > 0 && <p className="inline-error">{messageError}</p>}
          <form className="message-composer" onSubmit={send}><input aria-label="Write a message" maxLength="4000" value={text} onChange={(event) => setText(event.target.value)} placeholder="Write a message…" /><button className="send-button" aria-label="Send message" disabled={sending || !text.trim()}><Send size={18} /></button></form>
        </>}
    </section>
  </div>;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}
