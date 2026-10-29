import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MessageWorkspace } from './Messages.jsx';
import { messageApi } from '../services/api.js';

const { eventHandlers, realtimeSocket } = vi.hoisted(() => {
  const eventHandlers = new Map();
  return {
    eventHandlers,
    realtimeSocket: {
      connected: true,
      on: vi.fn((event, handler) => eventHandlers.set(event, handler)),
      off: vi.fn((event) => eventHandlers.delete(event)),
      emit: vi.fn(),
    },
  };
});

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { id: 'user-a', displayName: 'User A' },
    realtimeSocket,
    realtimeStatus: 'connected',
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  eventHandlers.clear();
  realtimeSocket.on.mockClear();
  realtimeSocket.off.mockClear();
  realtimeSocket.emit.mockClear();
});

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/messages/conversation-1']}>
      <Routes>
        <Route path="/messages" element={<MessageWorkspace />} />
        <Route path="/messages/:conversationId/details" element={<MessageWorkspace />} />
        <Route path="/messages/:conversationId" element={<MessageWorkspace />} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockConversationApi() {
  vi.spyOn(messageApi, 'conversations').mockResolvedValue({
    conversations: [{
      id: 'conversation-1',
      participant: { id: 'user-b', displayName: 'User B', username: 'user_b', avatarUrl: null },
      lastMessage: null,
      unreadCount: 2,
    }],
  });
  vi.spyOn(messageApi, 'messages').mockResolvedValue({
    messages: [{
      id: 'message-1',
      conversationId: 'conversation-1',
      senderId: 'user-b',
      text: 'Earlier message',
      createdAt: '2026-10-29T10:00:00.000Z',
      deliveredAt: null,
      readAt: null,
    }],
    hasMore: false,
    nextCursor: null,
  });
  vi.spyOn(messageApi, 'markRead').mockResolvedValue({ readCount: 1 });
}

describe('real-time message workspace', () => {
  it('renders persisted incoming messages once, sends delivery receipts, and marks visible messages read', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    mockConversationApi();
    renderWorkspace();
    expect(await screen.findByText('Earlier message')).toBeInTheDocument();

    eventHandlers.get('message:new')({
      conversationId: 'conversation-1',
      message: {
        id: 'message-2',
        conversationId: 'conversation-1',
        senderId: 'user-b',
        text: 'Live message',
        createdAt: '2026-10-29T10:01:00.000Z',
      },
    });

    expect(await screen.findByText('Live message')).toBeInTheDocument();
    await waitFor(() => expect(messageApi.markRead).toHaveBeenCalledWith('conversation-1'));
    expect(realtimeSocket.emit).toHaveBeenCalledWith('message:delivered', {
      conversationId: 'conversation-1',
      messageId: 'message-2',
    });
    expect(realtimeSocket.emit).toHaveBeenCalledWith('conversation:join', 'conversation-1');
  });

  it('sends a stable client idempotency key and cleans socket listeners on unmount', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    mockConversationApi();
    const send = vi.spyOn(messageApi, 'send').mockResolvedValue({
      message: {
        id: 'message-sent',
        conversationId: 'conversation-1',
        senderId: 'user-a',
        text: 'Hello there',
        createdAt: '2026-10-29T10:02:00.000Z',
        deliveredAt: null,
        readAt: null,
      },
    });
    const view = renderWorkspace();
    await screen.findByText('Earlier message');
    fireEvent.change(screen.getByRole('textbox', { name: 'Write a message' }), {
      target: { value: 'Hello there' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    const [conversationId, text, clientMessageId] = send.mock.calls[0];
    expect(conversationId).toBe('conversation-1');
    expect(text).toBe('Hello there');
    expect(clientMessageId).toEqual(expect.any(String));
    expect(clientMessageId.length).toBeGreaterThanOrEqual(8);

    view.unmount();
    expect(realtimeSocket.off).toHaveBeenCalledWith('message:new', expect.any(Function));
  });

  it('aligns message bubbles by authenticated sender ID and opens public chat details', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    mockConversationApi();
    renderWorkspace();
    const incoming = await screen.findByText('Earlier message');
    expect(incoming.closest('.message-bubble')).not.toHaveClass('message-bubble--mine');

    eventHandlers.get('message:sent')({
      conversationId: 'conversation-1',
      message: {
        id: 'message-mine',
        conversationId: 'conversation-1',
        senderId: 'user-a',
        text: 'My message',
        createdAt: '2026-10-29T10:01:00.000Z',
      },
    });
    expect((await screen.findByText('My message')).closest('.message-bubble'))
      .toHaveClass('message-bubble--mine');

    fireEvent.click(screen.getByRole('link', { name: 'Chat details' }));
    expect(await screen.findByRole('heading', { name: 'Chat details' })).toBeInTheDocument();
    expect(screen.getByText('@user_b')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View profile' }))
      .toHaveAttribute('href', '/profile/user_b');
  });

  it('filters the real conversation list to unread conversations', async () => {
    vi.spyOn(messageApi, 'conversations').mockResolvedValue({
      conversations: [{
        id: 'conversation-1',
        participant: { id: 'user-b', displayName: 'User B', username: 'user_b' },
        lastMessage: { text: 'Unread message' },
        unreadCount: 2,
      }],
    });
    render(
      <MemoryRouter initialEntries={['/messages']}>
        <Routes>
          <Route path="/messages" element={<MessageWorkspace />} />
          <Route path="/messages/:conversationId" element={<MessageWorkspace />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('User B')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unread' }));
    expect(screen.getByRole('link', { name: /User B/ })).toBeInTheDocument();
  });
});
