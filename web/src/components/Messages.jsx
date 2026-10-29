import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, MessageCircle, RefreshCw, Search, Send } from 'lucide-react';
import { Avatar } from './Brand.jsx';
import { EmptyState, ErrorState, Skeleton } from './Feedback.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { messageApi, userApi } from '../services/api.js';

export function MessageWorkspace() {
  const { conversationId } = useParams();
  const { user: currentUser, realtimeSocket, realtimeStatus } = useAuth();
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
  const nearBottom = useRef(true);
  const pendingSend = useRef(null);
  const readInFlight = useRef(false);
  const outgoingTypingTimer = useRef(null);
  const incomingTypingTimer = useRef(null);
  const [typing, setTyping] = useState(false);

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
        setHasOlderMessages(data.hasMore ?? page.length === 30);
      }
    } catch (reason) {
      if (request === requestId.current) setMessageError(reason.message || 'Could not load messages.');
    } finally {
      if (request === requestId.current) setMessageLoading(false);
    }
  }, [conversationId]);

  const markRead = useCallback(async () => {
    if (!conversationId || document.visibilityState !== 'visible' ||
        (typeof document.hasFocus === 'function' && !document.hasFocus()) ||
        readInFlight.current) return;
    readInFlight.current = true;
    try {
      await messageApi.markRead(conversationId);
      setConversations((current) => current.map((item) =>
        item.id === conversationId ? { ...item, unreadCount: 0 } : item));
    } catch (reason) {
      if (reason?.name !== 'AbortError') setMessageError(reason.message || 'Could not update read status.');
    } finally {
      readInFlight.current = false;
    }
  }, [conversationId]);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => { loadMessages(); }, [loadMessages]);
  useEffect(() => {
    if (!realtimeSocket) return undefined;
    const join = () => {
      if (conversationId) realtimeSocket.emit('conversation:join', conversationId);
      void loadConversations();
      if (conversationId) void loadMessages();
    };
    const onMessage = (payload) => {
      void loadConversations();
      if (payload?.conversationId !== conversationId || !payload.message?.id) return;
      const message = payload.message;
      setMessages((current) => current.some((item) => item.id === message.id)
        ? current
        : [...current, message]);
      if (message.senderId !== currentUser?.id) {
        realtimeSocket.emit('message:delivered', { conversationId, messageId: message.id });
        void markRead();
      }
    };
    const onMessageSent = (payload) => {
      if (payload?.conversationId !== conversationId || !payload.message?.id) return;
      setMessages((current) => current.some((item) => item.id === payload.message.id)
        ? current
        : [...current, payload.message]);
      void loadConversations();
    };
    const onConversation = () => { void loadConversations(); };
    const onDelivered = (payload) => {
      setMessages((current) => current.map((item) => item.id === payload?.messageId
        ? { ...item, deliveredAt: payload.deliveredAt }
        : item));
    };
    const onRead = (payload) => {
      if (payload?.conversationId !== conversationId) return;
      const readIds = new Set(payload.messageIds || []);
      setMessages((current) => current.map((item) => readIds.has(item.id)
        ? { ...item, readAt: payload.readAt }
        : item));
    };
    const onTypingStart = (payload) => {
      if (payload?.conversationId !== conversationId || payload.userId === currentUser?.id) return;
      setTyping(true);
      clearTimeout(incomingTypingTimer.current);
      incomingTypingTimer.current = window.setTimeout(() => setTyping(false), 3500);
    };
    const onTypingStop = (payload) => {
      if (payload?.conversationId === conversationId) {
        clearTimeout(incomingTypingTimer.current);
        setTyping(false);
      }
    };
    realtimeSocket.on('connect', join);
    realtimeSocket.on('conversation:created', onConversation);
    realtimeSocket.on('conversation:updated', onConversation);
    realtimeSocket.on('message:new', onMessage);
    realtimeSocket.on('message:sent', onMessageSent);
    realtimeSocket.on('message:delivered', onDelivered);
    realtimeSocket.on('message:read', onRead);
    realtimeSocket.on('typing:start', onTypingStart);
    realtimeSocket.on('typing:stop', onTypingStop);
    if (realtimeSocket.connected) {
      if (conversationId) realtimeSocket.emit('conversation:join', conversationId);
    }
    return () => {
      realtimeSocket.off('connect', join);
      realtimeSocket.off('conversation:created', onConversation);
      realtimeSocket.off('conversation:updated', onConversation);
      realtimeSocket.off('message:new', onMessage);
      realtimeSocket.off('message:sent', onMessageSent);
      realtimeSocket.off('message:delivered', onDelivered);
      realtimeSocket.off('message:read', onRead);
      realtimeSocket.off('typing:start', onTypingStart);
      realtimeSocket.off('typing:stop', onTypingStop);
      if (conversationId && realtimeSocket.connected) realtimeSocket.emit('conversation:leave', conversationId);
      clearTimeout(incomingTypingTimer.current);
      clearTimeout(outgoingTypingTimer.current);
    };
  }, [realtimeSocket, conversationId, currentUser?.id, loadConversations, loadMessages, markRead]);
  useEffect(() => {
    if (!conversationId) return undefined;
    const updateReadState = () => { void markRead(); };
    document.addEventListener('visibilitychange', updateReadState);
    window.addEventListener('focus', updateReadState);
    return () => {
      document.removeEventListener('visibilitychange', updateReadState);
      window.removeEventListener('focus', updateReadState);
    };
  }, [conversationId, markRead]);
  useEffect(() => {
    if (messages.length > 0) void markRead();
  }, [messages.length, markRead]);
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    if (preserveScroll.current) {
      const { top, height } = preserveScroll.current;
      scrollRef.current.scrollTop = top + scrollRef.current.scrollHeight - height;
      preserveScroll.current = null;
    } else if (nearBottom.current) {
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

  function onComposerChange(value) {
    setText(value);
    if (!realtimeSocket || !conversationId) return;
    realtimeSocket.emit('typing:start', conversationId);
    clearTimeout(outgoingTypingTimer.current);
    outgoingTypingTimer.current = window.setTimeout(() => {
      realtimeSocket.emit('typing:stop', conversationId);
    }, 1200);
  }

  async function sendMessage() {
    const content = text.trim();
    if (!content || sending || !conversationId) return;
    setSending(true);
    setMessageError('');
    try {
      const clientMessageId = pendingSend.current?.text === content
        ? pendingSend.current.id
        : createClientMessageId();
      pendingSend.current = { text: content, id: clientMessageId };
      const result = await messageApi.send(conversationId, content, clientMessageId);
      if (result.message) {
        setMessages((current) => [...current.filter((item) => item.id !== result.message.id), result.message]);
        setText('');
        pendingSend.current = null;
        realtimeSocket?.emit('typing:stop', conversationId);
        await loadConversations();
      }
    } catch (reason) {
      setMessageError(reason.message || 'Could not send this message.');
    } finally {
      setSending(false);
    }
  }

  function send(event) {
    event.preventDefault();
    void sendMessage();
  }

  function handleComposerKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  }

  async function loadOlder() {
    const oldest = messages[0]?.id;
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
      setHasOlderMessages(data.hasMore ?? older.length === 30);
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
          {item.unreadCount > 0 && <span className="message-unread-badge" aria-label={`${item.unreadCount} unread messages`}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</span>}
        </Link>)}</div>
      )}
    </aside>
    <section className={`chat-panel${conversationId ? ' chat-panel--mobile-active' : ''}`}>
      {!conversationId ? <div className="chat-welcome"><span className="chat-welcome-icon"><MessageCircle size={28} /></span><h2>Your conversations</h2><p>Choose a conversation or find someone new to say hello.</p><span className="helper-text">Messages refresh when you open or manually refresh a conversation.</span></div>
        : <><header className="chat-header"><Link to="/messages" className="back-link" aria-label="Back to messages"><ArrowLeft size={19} /></Link><Avatar name={active?.participant?.displayName || ''} src={active?.participant?.avatarUrl} size="small" /><span><b>{active?.participant?.displayName || 'Conversation'}</b><small>@{active?.participant?.username || ''}</small></span><span className={`chat-connection-status chat-connection-status--${realtimeStatus}`} role="status">{realtimeStatus === 'connected' ? 'Live' : realtimeStatus === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span><button className="icon-button chat-refresh" aria-label="Refresh messages" onClick={loadMessages}><RefreshCw size={17} /></button></header>
          <div className="chat-messages" ref={scrollRef} onScroll={(event) => {
            const element = event.currentTarget;
            nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
          }}>
            {messageLoading ? <Skeleton rows={5} /> : messageError && messages.length === 0 ? <ErrorState error={messageError} onRetry={loadMessages} /> : messages.length === 0 ? <EmptyState title="Your first hello" description="Send a message to get things started." icon={MessageCircle} /> : <>
              {hasOlderMessages && <button className="button button--outline older-messages" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'Loading older messages…' : 'Load older messages'}</button>}
              {messages.map((message, index) => <div key={message.id}>
                {isNewMessageDay(messages[index - 1], message) && <p className="message-date-separator">{formatDate(message.createdAt)}</p>}
                <div className={`message-bubble${message.senderId === currentUser?.id ? ' message-bubble--mine' : ''}`}><p>{message.text}</p><time>{formatTime(message.createdAt)}{message.senderId === currentUser?.id && <span className="message-delivery-state">{message.readAt ? ' · Read' : message.deliveredAt ? ' · Delivered' : ' · Sent'}</span>}</time></div>
              </div>)}
            </>}
            {typing && <p className="typing-indicator" role="status">{active?.participant?.displayName || 'They'} is typing…</p>}
          </div>
          {messageError && messages.length > 0 && <p className="inline-error">{messageError}</p>}
          {messageError && pendingSend.current && <button className="message-retry" type="button" onClick={() => void sendMessage()}>Retry sending</button>}
          <form className="message-composer" onSubmit={send}><textarea aria-label="Write a message" maxLength="4000" rows="1" value={text} onChange={(event) => onComposerChange(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder="Write a message…" /><button className="send-button" aria-label="Send message" disabled={sending || !text.trim()}><Send size={18} /></button></form>
        </>}
    </section>
  </div>;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function isNewMessageDay(previous, current) {
  if (!previous) return true;
  return new Date(previous.createdAt).toDateString() !== new Date(current.createdAt).toDateString();
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function createClientMessageId() {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
