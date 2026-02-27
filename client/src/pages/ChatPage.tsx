import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../api';
import {
  Hash, LogOut, Users,
  MessageSquare, Settings, Smile, Shield, Reply, MoreVertical, Plus, X
} from 'lucide-react';
import SettingsPage from './SettingsPage';
import { supabase } from '../lib/supabase';
import './ChatPage.css';

interface Room {
  id: string;
  name: string;
  description: string;
  icon: string;
  last_message?: string | null;
  last_message_at?: number | null;
  last_message_sender?: string | null;
  has_unread?: boolean;
}

interface Message {
  id: string;
  content: string;
  created_at: number;
  sender_id: string;
  display_name: string;
  avatar_color: string;
  avatar_url?: string | null;
  reply_to_message_id?: string | null;
  reply_to?: ReplyMeta | null;
  is_deleted?: number | boolean;
  reactions?: ReactionSummary[];
}

interface ReplyMeta {
  id: string;
  sender_id: string;
  display_name: string;
  content: string;
  is_deleted: boolean;
}

interface ReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

interface DMConversation {
  id: string;
  other_id: string;
  other_name: string;
  other_color: string;
  other_avatar_url?: string | null;
  last_message?: string | null;
  last_message_at?: number | null;
  last_message_sender?: string | null;
  has_unread?: boolean;
}

type NavTab = 'rooms' | 'dms' | 'settings';

export default function ChatPage() {
  const { user, token, logout } = useAuth();
  const { socket, connected } = useSocket();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<NavTab>('rooms');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [dmConversations, setDmConversations] = useState<DMConversation[]>([]);
  const [selectedDM, setSelectedDM] = useState<DMConversation | null>(null);
  const [dmMessages, setDmMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [chatOpen, setChatOpen] = useState(false);

  const [replyingTo, setReplyingTo] = useState<ReplyMeta | null>(null);
  const [sendError, setSendError] = useState<string>('');
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);

  const [emojiPicker, setEmojiPicker] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [reportModal, setReportModal] = useState<{ messageId: string; open: boolean; type: 'message' | 'user' } | null>(null);
  const [reportReason, setReportReason] = useState<'spam' | 'harassment' | 'inappropriate' | 'other'>('spam');
  const longPressTimerRef = useRef<number | null>(null);

  const [newDMModal, setNewDMModal] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<{ id: string; displayName: string; avatarColor: string }[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [fullEmojiPicker, setFullEmojiPicker] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [inputEmojiPicker, setInputEmojiPicker] = useState(false);
  const [dmContextMenu, setDmContextMenu] = useState<{ conversationId: string; x: number; y: number } | null>(null);

  const [reactionMap, setReactionMap] = useState<Record<string, ReactionSummary[]>>({});
  const visibleMessageIdsRef = useRef<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const cooldownSeconds = useMemo(() => {
    const ms = cooldownUntil - Date.now();
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
  }, [cooldownUntil]);

  useEffect(() => {
    if (!cooldownUntil || Date.now() >= cooldownUntil) return;
    const id = window.setInterval(() => {
      if (Date.now() >= cooldownUntil) {
        setCooldownUntil(0);
        setSendError('');
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  // Load rooms
  useEffect(() => {
    api('/rooms', { token }).then(setRooms).catch(console.error);
  }, [token]);

  // Load DMs
  useEffect(() => {
    if (activeTab === 'dms') {
      api('/dms', { token }).then(setDmConversations).catch(console.error);
    }
  }, [activeTab, token]);

  // Join room via socket
  useEffect(() => {
    if (!socket || !selectedRoom) return;

    socket.emit('join_room', selectedRoom.id);

    api(`/rooms/${selectedRoom.id}/messages`, { token })
      .then((msgs) => {
        setMessages(msgs);
        setTimeout(scrollToBottom, 100);
      })
      .catch(console.error);

    return () => {
      socket.emit('leave_room', selectedRoom.id);
    };
  }, [socket, selectedRoom, token, scrollToBottom]);

  // Load DM messages
  useEffect(() => {
    if (!selectedDM) return;

    api(`/dms/${selectedDM.other_id}/messages`, { token })
      .then((msgs) => {
        setDmMessages(msgs);
        setTimeout(scrollToBottom, 100);
      })
      .catch(console.error);
  }, [selectedDM, token, scrollToBottom]);

  // Socket listeners
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (data: { roomId: string; message: Message }) => {
      if (selectedRoom && data.roomId === selectedRoom.id) {
        setMessages((prev) => [...prev, data.message]);
        setTimeout(scrollToBottom, 50);
      }
    };

    const handleNewDM = (data: { recipientId: string; message: Message }) => {
      if (selectedDM && (data.recipientId === selectedDM.other_id || data.message.sender_id === selectedDM.other_id)) {
        setDmMessages((prev) => [...prev, data.message]);
        setTimeout(scrollToBottom, 50);
      }
    };

    const handleDMStarted = (data: { other_id: string; other_name: string; other_color: string }) => {
      const newConvo: DMConversation = {
        id: data.other_id,
        other_id: data.other_id,
        other_name: data.other_name,
        other_color: data.other_color,
        last_message: null,
        last_message_at: null,
      };
      setSelectedDM(newConvo);
      setDmMessages([]);
      setActiveTab('dms');
      setChatOpen(true);
    };

    socket.on('new_message', handleNewMessage);
    socket.on('new_dm', handleNewDM);
    socket.on('dm_started', handleDMStarted);

    const handleMessageDeleted = (data: { messageId: string }) => {
      const { messageId } = data;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, is_deleted: 1, content: '' } : m)));
      setDmMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, is_deleted: 1, content: '' } : m)));
    };

    const handleSendError = (data: { code: string; message: string; retryAfter?: number }) => {
      setSendError(data.message || 'Unable to send message');
      if (data.code === 'RATE_LIMIT' && data.retryAfter) {
        setCooldownUntil(Date.now() + data.retryAfter * 1000);
      }
    };

    socket.on('message_deleted', handleMessageDeleted);
    socket.on('send_error', handleSendError);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('new_dm', handleNewDM);
      socket.off('dm_started', handleDMStarted);
      socket.off('message_deleted', handleMessageDeleted);
      socket.off('send_error', handleSendError);
    };
  }, [socket, selectedRoom, selectedDM, scrollToBottom]);

  useEffect(() => {
    const onDown = () => {
      setEmojiPicker(null);
      setMoreMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !socket) return;

    if (cooldownUntil && Date.now() < cooldownUntil) {
      setSendError("You're sending messages too fast, slow down");
      return;
    }

    setSendError('');

    if (activeTab === 'rooms' && selectedRoom) {
      socket.emit('room_message', { roomId: selectedRoom.id, content: inputValue.trim(), replyToMessageId: replyingTo?.id || null });
    } else if (activeTab === 'dms' && selectedDM) {
      socket.emit('dm_message', { recipientId: selectedDM.other_id, content: inputValue.trim(), replyToMessageId: replyingTo?.id || null });
    }

    setInputValue('');
    setReplyingTo(null);
    inputRef.current?.focus();
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = (messageId: string, x: number, y: number) => {
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      setMoreMenu({ messageId, x, y });
    }, 450);
  };

  const getMessageById = (messageId: string) => {
    return (activeTab === 'dms' ? dmMessages : messages).find((m) => m.id === messageId) || null;
  };

  const upsertLocalReaction = (messageId: string, emoji: string, delta: 1 | -1, isMineDelta: boolean | null) => {
    setReactionMap((prev) => {
      const current = prev[messageId] ? [...prev[messageId]] : [];
      const idx = current.findIndex((r) => r.emoji === emoji);

      if (idx === -1 && delta > 0) {
        current.push({ emoji, count: 1, reactedByMe: !!isMineDelta });
      } else if (idx !== -1) {
        const next = { ...current[idx] };
        next.count += delta;
        if (isMineDelta !== null) next.reactedByMe = isMineDelta;
        if (next.count <= 0) {
          current.splice(idx, 1);
        } else {
          current[idx] = next;
        }
      }

      return { ...prev, [messageId]: current };
    });
  };

  const refreshReactions = useCallback(async (messageIds: string[]) => {
    if (!user?.id || messageIds.length === 0) return;
    const { data, error } = await supabase
      .from('message_reactions')
      .select('message_id, emoji, user_id')
      .in('message_id', messageIds);

    if (error || !data) return;

    const next: Record<string, ReactionSummary[]> = {};
    const counts: Record<string, Record<string, { count: number; reactedByMe: boolean }>> = {};
    for (const row of data) {
      if (!counts[row.message_id]) counts[row.message_id] = {};
      if (!counts[row.message_id][row.emoji]) counts[row.message_id][row.emoji] = { count: 0, reactedByMe: false };
      counts[row.message_id][row.emoji].count += 1;
      if (row.user_id === user.id) counts[row.message_id][row.emoji].reactedByMe = true;
    }

    for (const mid of messageIds) {
      const byEmoji = counts[mid] || {};
      next[mid] = Object.entries(byEmoji).map(([emoji, v]) => ({ emoji, count: v.count, reactedByMe: v.reactedByMe }));
    }

    setReactionMap((prev) => ({ ...prev, ...next }));
  }, [user?.id]);

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!user?.id) return;
    const current = reactionMap[messageId] || [];
    const mine = current.find((r) => r.emoji === emoji)?.reactedByMe;

    if (mine) {
      upsertLocalReaction(messageId, emoji, -1, false);
      const { error } = await supabase
        .from('message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('emoji', emoji)
        .eq('user_id', user.id);
      if (error) {
        await refreshReactions([messageId]);
      }
      return;
    }

    upsertLocalReaction(messageId, emoji, 1, true);
    const { error } = await supabase
      .from('message_reactions')
      .insert({ message_id: messageId, emoji, user_id: user.id });
    if (error) {
      await refreshReactions([messageId]);
    }
  };

  const deleteMessage = (messageId: string) => {
    if (!socket) return;
    socket.emit('delete_message', { messageId });
  };

  const submitReport = () => {
    if (!socket || !reportModal?.messageId) return;
    socket.emit('report_message', { messageId: reportModal.messageId, reason: reportReason, type: reportModal.type });
    setReportModal(null);
  };

  const openRoom = (room: Room) => {
    setSelectedRoom(room);
    setChatOpen(true);
    setMessages([]);
    void api(`/rooms/${room.id}/messages`, { token })
      .then((msgs) => {
        setMessages(msgs);
        setTimeout(scrollToBottom, 100);
      })
      .catch(console.error);
  };

  const openDM = (convo: DMConversation) => {
    setSelectedDM(convo);
    setChatOpen(true);
    setDmMessages([]);
  };

  const startDMWithUser = (userId: string) => {
    if (!socket || userId === user?.id) return;
    socket.emit('start_dm', { targetUserId: userId });
  };

  const searchUsers = useCallback(async (query: string) => {
    if (!query.trim() || query.trim().length < 2) {
      setUserSearchResults([]);
      return;
    }
    setSearchingUsers(true);
    try {
      const results = await api(`/users/search?q=${encodeURIComponent(query.trim())}`, { token });
      setUserSearchResults(results);
    } catch (err) {
      console.error('User search error:', err);
      setUserSearchResults([]);
    } finally {
      setSearchingUsers(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (newDMModal && userSearchQuery) {
        void searchUsers(userSearchQuery);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [userSearchQuery, newDMModal, searchUsers]);

  const startNewDM = (userId: string) => {
    startDMWithUser(userId);
    setNewDMModal(false);
    setUserSearchQuery('');
    setUserSearchResults([]);
  };

  const deleteDMConversation = async (conversationId: string) => {
    if (!token) return;
    try {
      await api(`/dms/${conversationId}`, { token, method: 'DELETE' });
      setDmConversations(dmConversations.filter(c => c.id !== conversationId));
      if (selectedDM?.id === conversationId) {
        setSelectedDM(null);
        setChatOpen(false);
      }
      setDmContextMenu(null);
    } catch (err) {
      console.error('Delete DM error:', err);
    }
  };

  const loadRooms = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api('/rooms', { token });
      console.log('[ChatPage] Loaded rooms:', data);
      const unreadRooms = data.filter((r: Room) => r.has_unread);
      console.log('[ChatPage] Rooms with unread messages:', unreadRooms.map((r: Room) => ({ name: r.name, has_unread: r.has_unread, last_message: r.last_message })));
      setRooms(data);
    } catch (err) {
      console.error('Load rooms error:', err);
    }
  }, [token]);

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const isInChat = chatOpen && ((activeTab === 'rooms' && selectedRoom) || (activeTab === 'dms' && selectedDM));
  const currentMessages = activeTab === 'dms' ? dmMessages : messages;

  useEffect(() => {
    visibleMessageIdsRef.current = new Set(currentMessages.map((m) => m.id));
  }, [currentMessages]);

  useEffect(() => {
    if (!isInChat) return;
    const ids = currentMessages.map((m) => m.id);
    void refreshReactions(ids);
  }, [isInChat, currentMessages.length, activeTab, selectedRoom?.id, selectedDM?.other_id, refreshReactions]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('message-reactions')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const row = payload.new as { message_id: string; emoji: string; user_id: string };
          if (!visibleMessageIdsRef.current.has(row.message_id)) return;
          upsertLocalReaction(row.message_id, row.emoji, 1, row.user_id === user.id ? true : null);
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const row = payload.old as { message_id: string; emoji: string; user_id: string };
          if (!visibleMessageIdsRef.current.has(row.message_id)) return;
          upsertLocalReaction(row.message_id, row.emoji, -1, row.user_id === user.id ? false : null);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  useEffect(() => {
    setMessages((prev) => prev.map((m) => ({ ...m, reactions: reactionMap[m.id] || [] })));
  }, [reactionMap]);

  useEffect(() => {
    setDmMessages((prev) => prev.map((m) => ({ ...m, reactions: reactionMap[m.id] || [] })));
  }, [reactionMap]);

  const navItems: { id: NavTab; label: string; icon: React.ReactNode }[] = [
    { id: 'rooms', label: 'Rooms', icon: <Hash className="lcIconNav" /> },
    { id: 'dms', label: 'Messages', icon: <MessageSquare className="lcIconNav" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="lcIconNav" /> },
  ];

  // Settings uses a two-column layout: left nav + full settings panel
  if (activeTab === 'settings') {
    return (
      <div className="chatLayout">
        {/* Left Nav */}
        <div className="sidebar">
          <div className="sidebarLogo">
            <div className="sidebarLogoRow">
              <img src="/Lancaster-Uni-Icon-1.png" alt="LancsChat" className="sidebarLogoImg" />
              <span className="sidebarLogoText">LancsChat</span>
            </div>
          </div>

          <nav className="sidebarNav">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => { setActiveTab(item.id); setChatOpen(false); }}
                className={`sidebarNavItem ${activeTab === item.id ? 'isActive' : ''}`}
              >
                {item.icon}
                <span className="sidebarNavLabel">{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="sidebarBottom">
            <div className="sidebarUserRow">
              {user && user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.displayName}
                  className="sidebarUserAvatarImg"
                />
              ) : (
                <div
                  className="sidebarUserAvatarFallback"
                  style={{ backgroundColor: user?.avatarColor }}
                >
                  {user?.displayName?.charAt(0)}
                </div>
              )}
              <span className="sidebarUserName">{user?.displayName}</span>
            </div>
            <button
              onClick={logout}
              className="sidebarNavItem"
            >
              <LogOut className="lcIconLogout" />
              <span className="sidebarNavLabel">Log out</span>
            </button>
          </div>
        </div>
        {/* Settings content fills the rest */}
        <div className="mainPanel" style={{ overflowY: 'auto' }}>
          <SettingsPage />
        </div>
      </div>
    );
  }

  return (
    <div className="chatLayout">

      {/* ─── LEFT NAV (icon-only on small, icon+text on xl) ─── */}
      <div className="sidebar">

        {/* Logo */}
        <div className="sidebarLogo">
          <div className="sidebarLogoRow">
            <img src="/Lancaster-Uni-Icon-1.png" alt="LancsChat" className="sidebarLogoImg" />
            <span className="sidebarLogoText">LancsChat</span>
          </div>
        </div>

        {/* Nav — vertically centered like Instagram */}
        <nav className="sidebarNav">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => { setActiveTab(item.id); setChatOpen(false); }}
              className={`sidebarNavItem ${activeTab === item.id ? 'isActive' : ''}`}
            >
              {item.icon}
              <span className="sidebarNavLabel">{item.label}</span>
            </button>
          ))}
          {user?.isAdmin && (
            <button
              onClick={() => navigate('/admin')}
              className="sidebarNavItem"
            >
              <Shield className="lcIconNav" />
              <span className="sidebarNavLabel">Admin</span>
            </button>
          )}
        </nav>

        {/* Bottom: User + Logout */}
        <div className="sidebarBottom">
          <div className="sidebarUserRow">
            {user && user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.displayName}
                className="sidebarUserAvatarImg"
              />
            ) : (
              <div
                className="sidebarUserAvatarFallback"
                style={{ backgroundColor: user?.avatarColor }}
              >
                {user?.displayName?.charAt(0)}
              </div>
            )}
            <span className="sidebarUserName">{user?.displayName}</span>
          </div>
          <button
            onClick={logout}
            className="sidebarNavItem"
          >
            <LogOut className="lcIconLogout" />
            <span className="sidebarNavLabel">Log out</span>
          </button>
        </div>
      </div>

      {/* ─── MIDDLE PANEL (room / DM list) ─── */}
      <div className="middlePanel">

        {/* Panel Header */}
        <div className="panelHeader">
          <h2 className="panelTitle">
            {activeTab === 'rooms' ? 'Rooms' : 'Messages'}
          </h2>
          {activeTab === 'dms' && (
            <button
              onClick={() => setNewDMModal(true)}
              className="newDMBtn"
              title="New message"
            >
              <Plus size={20} />
            </button>
          )}
          {!connected && (
            <p className="panelSubtle">Connecting...</p>
          )}
        </div>

        {/* List */}
        <div className="panelList">
          {activeTab === 'rooms' && (
            <div className="listStack">
              {rooms.map((room) => (
                <button
                  key={room.id}
                  onClick={() => openRoom(room)}
                  className={`listItem ${selectedRoom?.id === room.id && chatOpen ? 'isActive' : ''} ${room.has_unread ? 'hasUnread' : ''}`}
                >
                  <div className="roomIcon">{room.icon}</div>
                  <div className="listItemMain">
                    <p className="listItemTitle">{room.name}</p>
                    <p className="listItemDesc">
                      {room.last_message ? (
                        <>
                          {room.last_message_sender && (
                            <span className="lastMsgSender">
                              {room.last_message_sender === user?.displayName ? 'You' : room.last_message_sender}:{' '}
                            </span>
                          )}
                          {room.last_message}
                        </>
                      ) : room.description}
                    </p>
                  </div>
                  {room.has_unread && <div className="unreadDot" />}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'dms' && (
            <div className="listStack">
              {dmConversations.length === 0 ? (
                <div className="emptyList">
                  <MessageSquare className="lcIconEmpty" style={{ width: 64, height: 64, color: 'rgba(255,255,255,0.06)', margin: '0 auto 20px', display: 'block' }} />
                  <p className="emptyListTitle">No messages yet</p>
                  <p className="emptyListDesc">Click on a username in chat to start a DM</p>
                </div>
              ) : (
                dmConversations.map((convo) => (
                  <div key={convo.id} className="dmConvoRow">
                    <button
                      onClick={() => void openDM(convo)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setDmContextMenu({ conversationId: convo.id, x: e.clientX, y: e.clientY });
                      }}
                      className={`listItem ${selectedDM?.other_id === convo.other_id && chatOpen ? 'isActive' : ''} ${convo.has_unread ? 'hasUnread' : ''}`}
                    >
                      {convo.other_avatar_url ? (
                        <img
                          src={convo.other_avatar_url}
                          alt={convo.other_name}
                          className="dmAvatar dmAvatarImg"
                        />
                      ) : (
                        <div
                          className="dmAvatar"
                          style={{ backgroundColor: convo.other_color }}
                        >
                          {convo.other_name?.charAt(0)}
                        </div>
                      )}
                      <div className="listItemMain">
                        <p className="listItemTitle">{convo.other_name}</p>
                        {convo.last_message && (
                          <p className="listItemDesc">
                            {convo.last_message_sender === user?.id ? 'You: ' : ''}
                            {convo.last_message}
                          </p>
                        )}
                      </div>
                      {convo.has_unread && <div className="unreadDot" />}
                    </button>
                    <button
                      className="dmDeleteBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Delete conversation with ${convo.other_name}?`)) {
                          void deleteDMConversation(convo.id);
                        }
                      }}
                      title="Delete conversation"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── MAIN CONTENT (chat or welcome) ─── */}
      <div className="mainPanel">
        {isInChat ? (
          <>
            {/* Chat Header */}
            <div className="chatHeader">
              {activeTab === 'rooms' && selectedRoom && (
                <div className="chatHeaderRow">
                  <span style={{ fontSize: 24 }}>{selectedRoom.icon}</span>
                  <h2 className="chatHeaderTitle">{selectedRoom.name}</h2>
                </div>
              )}

              {activeTab === 'dms' && selectedDM && (
                <div className="chatHeaderRow">
                  <div
                    className="dmAvatar"
                    style={{ width: 40, height: 40, backgroundColor: selectedDM.other_color, fontSize: 12 }}
                  >
                    {selectedDM.other_name?.charAt(0)}
                  </div>
                  <h2 className="chatHeaderTitle">{selectedDM.other_name}</h2>
                </div>
              )}
            </div>

            {/* Messages */}
            <div className="messages">
              <div className="msgList">
              {currentMessages.filter(msg => !msg.is_deleted).map((msg, i) => {
                const filteredMessages = currentMessages.filter(m => !m.is_deleted);
                const isOwn = msg.sender_id === user?.id;
                const showAvatar = i === 0 || filteredMessages[i - 1]?.sender_id !== msg.sender_id;
                const reactions = msg.reactions || [];
                const replyTo = msg.reply_to || null;

                return (
                  <div
                    key={msg.id}
                    className={`messageRow ${isOwn ? 'isOwn' : ''} ${showAvatar ? 'isSpaced' : ''}`}
                    onTouchStart={(e) => {
                      const t = e.touches[0];
                      startLongPress(msg.id, t.clientX, t.clientY);
                    }}
                    onTouchEnd={clearLongPress}
                    onTouchMove={clearLongPress}
                  >
                    {showAvatar ? (
                      msg.avatar_url ? (
                        <button
                          onClick={() => !isOwn && activeTab === 'rooms' && startDMWithUser(msg.sender_id)}
                          className={`msgAvatarBtn ${!isOwn && activeTab === 'rooms' ? 'isClickable' : ''}`}
                          title={!isOwn ? `DM ${msg.display_name}` : undefined}
                        >
                          <img src={msg.avatar_url} alt={msg.display_name} className="msgAvatarImg" />
                        </button>
                      ) : (
                        <button
                          onClick={() => !isOwn && activeTab === 'rooms' && startDMWithUser(msg.sender_id)}
                          className={`msgAvatarBtn ${!isOwn && activeTab === 'rooms' ? 'isClickable' : ''}`}
                          style={{ backgroundColor: msg.avatar_color }}
                          title={!isOwn ? `DM ${msg.display_name}` : undefined}
                        >
                          {msg.display_name?.charAt(0)}
                        </button>
                      )
                    ) : (
                      <div className="msgAvatarSpacer" />
                    )}

                    <div className="msgBlock">
                      {showAvatar && (
                        <div className={`msgMeta ${isOwn ? 'isOwn' : ''}`}>
                          <span className="msgName">{msg.display_name}</span>
                          <span className="msgTime">{formatTime(msg.created_at)}</span>
                        </div>
                      )}
                      <div className={`msgBubbleWrap ${isOwn ? 'isOwn' : ''}`}>
                        <div className={`msgActions ${isOwn ? 'isOwn' : ''}`}>
                          <button
                            className="msgActionBtn"
                            type="button"
                            onClick={() => {
                              setReplyingTo({
                                id: msg.id,
                                sender_id: msg.sender_id,
                                display_name: msg.display_name,
                                content: msg.content,
                                is_deleted: !!msg.is_deleted,
                              });
                              setTimeout(() => inputRef.current?.focus(), 0);
                            }}
                            title="Reply"
                          >
                            <Reply className="msgActionIcon" />
                          </button>
                          <button
                            className="msgActionBtn"
                            type="button"
                            onClick={(e) => {
                              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                              setEmojiPicker({ messageId: msg.id, x: rect.left, y: rect.top });
                              setMoreMenu(null);
                            }}
                            title="React"
                          >
                            <Smile className="msgActionIcon" />
                          </button>
                          <button
                            className="msgActionBtn"
                            type="button"
                            onClick={(e) => {
                              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                              setMoreMenu({ messageId: msg.id, x: rect.left, y: rect.bottom });
                              setEmojiPicker(null);
                            }}
                            title="More"
                          >
                            <MoreVertical className="msgActionIcon" />
                          </button>
                        </div>

                        <div
                          className={`msgBubble ${isOwn ? 'isOwn' : 'isOther'}`}
                        >
                        {replyTo && (
                          <div className="replyQuote">
                            <div className="replyQuoteName">{replyTo.display_name}</div>
                            <div className="replyQuoteText">{replyTo.content}</div>
                          </div>
                        )}
                        <div className="msgContent">
                          {msg.content}
                        </div>
                        </div>
                      </div>
                      {reactions.length > 0 && (
                        <div className={`reactionBar ${isOwn ? 'isOwn' : ''}`}>
                          {reactions.map((r) => (
                            <button
                              key={r.emoji}
                              className={`reactionChip ${r.reactedByMe ? 'isMine' : ''}`}
                              onClick={() => toggleReaction(msg.id, r.emoji)}
                              type="button"
                            >
                              <span className="reactionEmoji">{r.emoji}</span>
                              <span className="reactionCount">{r.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              </div>
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="inputBarWrap">
              {(replyingTo || sendError || cooldownSeconds > 0) && (
                <div className="composerInfo">
                  {replyingTo && (
                    <div className="replyPreview">
                      <div className="replyPreviewText">
                        Replying to <strong>{replyingTo.display_name}</strong>: {replyingTo.is_deleted ? 'Message deleted' : replyingTo.content}
                      </div>
                      <button className="replyCancel" type="button" onClick={() => setReplyingTo(null)}>×</button>
                    </div>
                  )}
                  {(sendError || cooldownSeconds > 0) && (
                    <div className="sendWarning">
                      {cooldownSeconds > 0 ? `You're sending messages too fast, slow down (${cooldownSeconds}s)` : sendError}
                    </div>
                  )}
                </div>
              )}
              <form onSubmit={sendMessage} className="inputForm">
                <div className="inputBar">
                  <button
                    type="button"
                    className="emojiBtn"
                    title="Emoji"
                    onClick={() => setInputEmojiPicker(!inputEmojiPicker)}
                  >
                    <Smile className="lcIconEmoji" />
                  </button>
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Message..."
                    className="inputField"
                  />
                  {inputValue.trim() && (
                    <button
                      type="submit"
                      className="sendBtn"
                      disabled={cooldownSeconds > 0}
                    >
                      Send
                    </button>
                  )}
                </div>
              </form>
            </div>
          </>
        ) : (
          /* Welcome / Empty State */
          <div className="welcome">
            <div className="welcomeInner">
              <div className="welcomeIcon">
                <Users className="lcIconEmpty" />
              </div>
              <h2 className="welcomeTitle">
                {activeTab === 'rooms' ? 'Select a room' : 'Your messages'}
              </h2>
              <p className="welcomeDesc">
                {activeTab === 'rooms' ? 'Choose a room from the list to start chatting' : 'Click on a username in chat to start a DM'}
              </p>
            </div>
          </div>
        )}
      </div>

      {emojiPicker && (() => {
        const msg = getMessageById(emojiPicker.messageId);
        if (!msg) return null;
        const x = Math.min(emojiPicker.x, window.innerWidth - 220);
        const y = Math.max(10, emojiPicker.y - 56);
        return (
          <div className="emojiPicker" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
            {['👍', '❤️', '😂', '😮', '😢', '😠'].map((emoji) => (
              <button
                key={emoji}
                className="emojiPick"
                type="button"
                onClick={() => {
                  void toggleReaction(msg.id, emoji);
                  setEmojiPicker(null);
                }}
              >
                {emoji}
              </button>
            ))}
            <button
              className="emojiPick emojiPickPlus"
              type="button"
              onClick={() => {
                setFullEmojiPicker({ messageId: msg.id, x: emojiPicker.x, y: emojiPicker.y });
                setEmojiPicker(null);
              }}
              title="More reactions"
            >
              +
            </button>
          </div>
        );
      })()}

      {moreMenu && (() => {
        const msg = getMessageById(moreMenu.messageId);
        if (!msg) return null;
        const isOwn = msg.sender_id === user?.id;
        const canDelete = isOwn;
        const canReport = !isOwn;
        const canAdminDelete = !!user?.isAdmin && !isOwn;
        const canAdminBan = !!user?.isAdmin && !isOwn;
        const menuX = Math.min(moreMenu.x, window.innerWidth - 220);
        const menuY = Math.min(moreMenu.y, window.innerHeight - 220);

        const copyText = async () => {
          const text = msg.is_deleted ? '' : (msg.content || '');
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            /* no-op */
          }
        };

        return (
          <div className="moreMenu" style={{ left: menuX, top: menuY }} onMouseDown={(e) => e.stopPropagation()}>
            <button className="moreItem" type="button" onClick={() => { void copyText(); setMoreMenu(null); }}>Copy</button>
            {canDelete && (
              <button className="moreItem danger" type="button" onClick={() => { deleteMessage(msg.id); setMoreMenu(null); }}>Unsend / Delete</button>
            )}
            {canReport && (
              <>
                <button
                  className="moreItem"
                  type="button"
                  onClick={() => {
                    setReportReason('spam');
                    setReportModal({ messageId: msg.id, open: true, type: 'message' });
                    setMoreMenu(null);
                  }}
                >
                  Report message
                </button>
                <button
                  className="moreItem"
                  type="button"
                  onClick={() => {
                    setReportReason('spam');
                    setReportModal({ messageId: msg.id, open: true, type: 'user' });
                    setMoreMenu(null);
                  }}
                >
                  Report user
                </button>
              </>
            )}
            {canAdminDelete && (
              <button className="moreItem danger" type="button" onClick={() => { deleteMessage(msg.id); setMoreMenu(null); }}>Delete message (admin)</button>
            )}
            {canAdminBan && (
              <button
                className="moreItem danger"
                type="button"
                onClick={() => {
                  if (!token) return;
                  const reason = window.prompt('Ban reason', 'Violation of community rules') || 'Banned by admin';
                  void api('/admin/ban', { token, method: 'POST', body: { userId: msg.sender_id, reason } });
                  setMoreMenu(null);
                }}
              >
                Ban user (admin)
              </button>
            )}
          </div>
        );
      })()}

      {reportModal?.open && (
        <div className="modalOverlay" onMouseDown={() => setReportModal(null)}>
          <div className="modalCard" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalTitle">{reportModal.type === 'user' ? 'Report user' : 'Report message'}</div>
            <div className="modalDesc">Why are you reporting this?</div>
            <select
              className="modalSelect"
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value as typeof reportReason)}
            >
              <option value="spam">Spam</option>
              <option value="harassment">Harassment</option>
              <option value="inappropriate">Inappropriate content</option>
              <option value="other">Other</option>
            </select>
            <div className="modalActions">
              <button className="modalBtn" onClick={() => setReportModal(null)}>Cancel</button>
              <button className="modalBtn primary" onClick={submitReport}>Submit</button>
            </div>
          </div>
        </div>
      )}

      {newDMModal && (
        <div className="modalOverlay" onMouseDown={() => { setNewDMModal(false); setUserSearchQuery(''); setUserSearchResults([]); }}>
          <div className="modalCard newDMModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div className="modalTitle">New message</div>
              <button className="modalCloseBtn" onClick={() => { setNewDMModal(false); setUserSearchQuery(''); setUserSearchResults([]); }}>
                <X size={20} />
              </button>
            </div>
            <input
              type="text"
              placeholder="Search users..."
              value={userSearchQuery}
              onChange={(e) => setUserSearchQuery(e.target.value)}
              className="modalSearchInput"
              autoFocus
            />
            <div className="modalUserList">
              {searchingUsers && <div className="modalMuted">Searching...</div>}
              {!searchingUsers && userSearchQuery.length >= 2 && userSearchResults.length === 0 && (
                <div className="modalMuted">No users found</div>
              )}
              {!searchingUsers && userSearchResults.map((u) => (
                <button
                  key={u.id}
                  className="modalUserItem"
                  onClick={() => startNewDM(u.id)}
                >
                  <div className="modalUserAvatar" style={{ backgroundColor: u.avatarColor }}>
                    {u.displayName.charAt(0)}
                  </div>
                  <div className="modalUserName">{u.displayName}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {fullEmojiPicker && (
        <div className="modalOverlay" onMouseDown={() => setFullEmojiPicker(null)}>
          <div className="emojiPickerModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div className="modalTitle">React</div>
              <button className="modalCloseBtn" onClick={() => setFullEmojiPicker(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="emojiGrid">
              {['❤️', '😂', '😮', '😢', '😠', '👍', '👎', '🔥', '🎉', '😍', '😊', '😎', '🤔', '😴', '😭', '🤣', '😅', '😇', '🥰', '😘', '😜', '🤗', '🤩', '😏', '😳', '🙄', '😬', '🤐', '😶', '🫡', '🤯', '😱', '🥺', '😡', '🤬', '💀', '☠️', '💩', '🤡', '👻', '👽', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '💋', '👋', '🤚', '✋', '🖐️', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '🫵', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄'].map((emoji) => (
                <button
                  key={emoji}
                  className="emojiGridItem"
                  type="button"
                  onClick={() => {
                    if (fullEmojiPicker.messageId) {
                      void toggleReaction(fullEmojiPicker.messageId, emoji);
                    }
                    setFullEmojiPicker(null);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {inputEmojiPicker && (
        <div className="emojiPickerOverlay" onMouseDown={() => setInputEmojiPicker(false)}>
          <div className="emojiPickerModal inputEmojiModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div className="modalTitle">Emoji</div>
              <button className="modalCloseBtn" onClick={() => setInputEmojiPicker(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="emojiGrid">
              {['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '🫠', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '☺️', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🫢', '🫣', '🤫', '🤔', '🫡', '🤐', '🤨', '😐', '😑', '😶', '🫥', '😶‍🌫️', '😏', '😒', '🙄', '😬', '😮‍💨', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '😵‍💫', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '🫤', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '🥹', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🛗', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧️', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '🟰', '♾️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '🔚', '🔙', '🔛', '🔝', '🔜', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '👁️‍🗨️', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦', '🕧'].map((emoji) => (
                <button
                  key={emoji}
                  className="emojiGridItem"
                  type="button"
                  onClick={() => {
                    setInputValue(inputValue + emoji);
                    setInputEmojiPicker(false);
                    inputRef.current?.focus();
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {dmContextMenu && (
        <div className="msgMenuOverlay" onMouseDown={() => setDmContextMenu(null)}>
          <div
            className="msgMenu"
            style={{ left: dmContextMenu.x, top: dmContextMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="msgMenuItem danger"
              onClick={() => {
                if (window.confirm('Delete this conversation?')) {
                  void deleteDMConversation(dmContextMenu.conversationId);
                }
              }}
            >
              Delete Conversation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
