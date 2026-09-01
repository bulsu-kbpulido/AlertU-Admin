import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dayjs from 'dayjs';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';

dayjs.extend(isToday);
dayjs.extend(isYesterday);

// Lucide Icons
import { 
  X, 
  Send, 
  Search, 
  ArrowLeft, 
  User, 
  ShieldAlert, 
  MessageSquare, 
  Clock, 
  CheckCheck,
  AlertCircle
} from 'lucide-react';

// Real-time Chat Handlers
import { 
  subscribeConversations, 
  subscribeMessages, 
  sendChatMessage, 
  markChatAsRead 
} from '../chatHandler'; 

// Audit Log Hook
import useAuditLog from '../useAuditLog'; // Adjust path if needed

// UI / Design System Imports
import { BorderBeam } from "@/components/ui/border-beam";

const MAX_CHAR_LIMIT = 300;

export default function MessagesDrawer({ isOpen, onClose, adminUser }) {
  const [conversations, setConversations] = useState([]);
  const [activeChat, setActiveChat] = useState(null); 
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const messagesEndRef = useRef(null);

  // Initialize Audit Log Hook
  const { logMovement } = useAuditLog({
    adminId: adminUser?.uid || adminUser?.id || 'ADMIN-UNKNOWN',
    adminName: adminUser?.displayName || adminUser?.name || adminUser?.email || 'System Admin',
  });

  // Smooth scroll to chat bottom
  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  // 1. Subscribe to real-time conversation list when drawer is open
  useEffect(() => {
    if (!isOpen) return;

    const unsubscribe = subscribeConversations((updatedConversations) => {
      setConversations(updatedConversations || []);
    });

    return () => unsubscribe();
  }, [isOpen]);

  // 2. Subscribe to real-time message feed when an active chat is selected
  useEffect(() => {
    if (!activeChat) {
      setMessages([]);
      return;
    }

    const chatId = activeChat.chatId || activeChat.id;

    // Reset unread count for admin in Firestore
    markChatAsRead(chatId);

    const unsubscribe = subscribeMessages(chatId, (fetchedMessages) => {
      setMessages(fetchedMessages || []);
      scrollToBottom();
    });

    return () => unsubscribe();
  }, [activeChat]);

  // Handle selecting a conversation
  const handleSelectChat = async (conv) => {
    setActiveChat(conv);

    setConversations((prev) =>
      prev.map((c) =>
        (c.chatId || c.id) === (conv.chatId || conv.id)
          ? { ...c, unreadCountAdmin: 0 }
          : c
      )
    );

    // Audit Log for opening/selecting an emergency chat channel
    const chatId = conv.chatId || conv.id;
    const citizenId = conv.citizenId || conv.citizenUid || 'UNKNOWN_CITIZEN';
    const citizenName = conv.citizenName || 'Unknown Citizen';

    try {
      await logMovement('OPEN_EMERGENCY_CHAT', citizenId, {
        chatId,
        citizenName,
        openedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Audit log error on opening chat:', err);
    }
  };

  // Handle sending an admin dispatch message directly to Firestore
  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChat || inputText.length > MAX_CHAR_LIMIT) return;

    const cleanText = inputText.trim();
    const chatId = activeChat.chatId || activeChat.id;
    const adminId = adminUser?.uid || adminUser?.id || 'admin_dispatch';
    const citizenId = activeChat.citizenId || activeChat.citizenUid || 'UNKNOWN_CITIZEN';
    const citizenName = activeChat.citizenName || 'Unknown Citizen';

    const messagePayload = {
      chatId,
      senderId: adminId,
      text: cleanText,
      senderRole: 'admin',
      recipientUid: activeChat.citizenUid || activeChat.userId || activeChat.senderId || '',
      citizenId: activeChat.citizenId || '',
      citizenName: activeChat.citizenName || '',
    };

    setInputText('');

    await sendChatMessage(messagePayload);
    scrollToBottom();

    // Audit Log for sending a dispatch message
    try {
      await logMovement('SEND_DISPATCH_MESSAGE', citizenId, {
        chatId,
        citizenName,
        messageLength: cleanText.length,
        sentAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Audit log error on sending message:', err);
    }
  };

  // Resolve display name for citizen
  const getCitizenDisplayName = (conv) => {
    if (!conv) return 'Unknown Citizen';
    if (conv.citizenName && conv.citizenId) {
      return `${conv.citizenName} (${conv.citizenId})`;
    }
    return conv.citizenName || conv.citizenId || `Room: ${conv.chatId || conv.id}`;
  };

  const getRoomTitle = (conv) => {
    if (!conv) return 'Dispatch Communications';
    return getCitizenDisplayName(conv);
  };

  // Group messages chronologically by date using dayjs
  const groupMessagesByDate = (msgList) => {
    const groups = {};

    msgList.forEach((msg) => {
      const msgDate = dayjs(msg.timestamp);
      let dateKey = msgDate.format('YYYY-MM-DD');

      if (msgDate.isToday()) {
        dateKey = 'Today';
      } else if (msgDate.isYesterday()) {
        dateKey = 'Yesterday';
      } else {
        dateKey = msgDate.format('MMMM D, YYYY');
      }

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(msg);
    });

    return groups;
  };

  // Search filter across citizen names, citizen IDs, channel IDs, and message texts
  const filteredConversations = conversations.filter((c) => {
    const term = searchTerm.toLowerCase();
    const name = (c.citizenName || '').toLowerCase();
    const cid = (c.citizenId || '').toLowerCase();
    const chatId = (c.chatId || c.id || '').toLowerCase();
    const msg = (c.lastMessage || '').toLowerCase();

    return name.includes(term) || cid.includes(term) || chatId.includes(term) || msg.includes(term);
  });

  // Normalize timestamps so Firestore Timestamp values and ISO strings sort together.
  const getMessageTime = (message) => {
    const timestamp = message?.timestamp;
    if (timestamp?.toDate) return timestamp.toDate().getTime();
    if (typeof timestamp?.seconds === 'number') {
      return timestamp.seconds * 1000 + Math.floor((timestamp.nanoseconds || 0) / 1000000);
    }
    const parsed = dayjs(timestamp).valueOf();
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  };

  // Always render one shared conversation timeline, sorted by message timestamp.
  const chronologicalMessages = [...messages].sort(
    (a, b) => getMessageTime(a) - getMessageTime(b)
  );

  const groupedMessages = groupMessagesByDate(chronologicalMessages);

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end transition-all duration-300 ${
        isOpen ? 'pointer-events-auto visible' : 'pointer-events-none invisible'
      }`}
    >
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity duration-300 ease-in-out ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Main Drawer Panel */}
      <div
        className={`relative z-10 flex h-full w-full sm:w-[480px] lg:w-[520px] flex-col bg-white dark:bg-slate-950 shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] border-l border-slate-200 dark:border-slate-800 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* MagicUI BorderBeam Integration */}
        <BorderBeam size={220} duration={14} delay={5} colorFrom="#3b82f6" colorTo="#6366f1" />

        {/* Modal Header */}
        <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/90 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {activeChat ? (
              <button
                onClick={() => setActiveChat(null)}
                className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-all shadow-sm active:scale-95 shrink-0"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                  {activeChat ? 'Live Channel' : 'Dispatch Center'}
                </span>
                {activeChat?.unreadCountAdmin > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                    New Update
                  </span>
                )}
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight truncate mt-0.5">
                {getRoomTitle(activeChat)}
              </h3>
            </div>
          </div>

          <button 
            onClick={onClose} 
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all shadow-sm active:scale-95 shrink-0"
            aria-label="Close drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Dynamic View: Conversations List vs Message Stream */}
        {!activeChat ? (
          <div className="flex-1 flex flex-col min-h-0 bg-slate-50/40 dark:bg-slate-900/40">
            {/* Search Input Bar */}
            <div className="p-4 border-b border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-950 shrink-0">
              <div className="relative flex items-center">
                <Search className="absolute left-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search citizen name, ID, or message text..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/80 py-2.5 pl-10 pr-4 text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>
            </div>

            {/* Conversation Items List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filteredConversations.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl my-4">
                  <MessageSquare className="w-10 h-10 text-slate-300 mb-2" />
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">No active conversations found</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Incoming emergency chat channels will appear here.</p>
                </div>
              ) : (
                filteredConversations.map((conv) => {
                  const avatarLabel = (
                    conv.citizenName ||
                    conv.citizenId ||
                    conv.chatId ||
                    conv.id ||
                    'C'
                  ).substring(0, 2).toUpperCase();

                  const hasUnread = conv.unreadCountAdmin > 0;

                  return (
                    <motion.div
                      key={conv.id || conv.chatId}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => handleSelectChat(conv)}
                      className={`group flex items-center gap-3.5 rounded-2xl p-4 transition-all cursor-pointer border ${
                        hasUnread 
                          ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 shadow-sm' 
                          : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm'
                      }`}
                    >
                      {/* Avatar Initials Badge */}
                      <div className="relative shrink-0">
                        <div className={`h-11 w-11 rounded-xl flex items-center justify-center font-bold text-sm border shadow-xs ${
                          hasUnread 
                            ? 'bg-blue-600 text-white border-blue-500' 
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                        }`}>
                          {avatarLabel}
                        </div>
                        {hasUnread && (
                          <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-blue-600 ring-2 ring-white dark:ring-slate-950 animate-pulse" />
                        )}
                      </div>

                      {/* Conversation Content Summary */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate pr-2">
                            {getRoomTitle(conv)}
                          </h4>
                          <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 shrink-0 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {conv.lastMessageTimestamp
                              ? dayjs(conv.lastMessageTimestamp).format('h:mm A')
                              : ''}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate">
                          {conv.lastMessage || 'No recent communications'}
                        </p>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          /* Active Chat Feed & Input Form */
          <div className="flex-1 flex flex-col min-h-0 bg-slate-50/30 dark:bg-slate-900/30">
            {/* Scrollable Message List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              <AnimatePresence initial={false}>
                {Object.keys(groupedMessages).length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-xs font-semibold text-slate-400 dark:text-slate-500">No messages in this emergency channel yet.</p>
                  </div>
                ) : (
                  Object.entries(groupedMessages).map(([dateLabel, msgGroup]) => (
                    <div key={dateLabel} className="space-y-4">
                      
                      {/* Dayjs Date Segregator Header */}
                      <div className="relative flex items-center justify-center my-4">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                        </div>
                        <div className="relative bg-white dark:bg-slate-900 px-3 py-1 rounded-full border border-slate-200 dark:border-slate-700 shadow-2xs">
                          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Clock className="w-3 h-3 text-blue-600" />
                            {dateLabel} Chats
                          </span>
                        </div>
                      </div>

                      {/* Messages within Date Group */}
                      {msgGroup.map((msg, index) => {
                        const isAdmin =

                          msg.senderRole === 'admin' ||
                          msg.senderId === (adminUser?.uid || adminUser?.id);

                        const citizenLabel =
                          msg.citizenName ||
                          (msg.citizenId ? `ID: ${msg.citizenId}` : null) ||
                          activeChat.citizenName ||
                          activeChat.citizenId ||
                          'Citizen User';

                        return (
                          <motion.div
                            key={msg.id || index}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.15 }}
                                                        className={`flex w-full items-end gap-2.5 ${
                              isAdmin ? 'flex-row-reverse justify-start' : 'flex-row justify-start'
                            }`}

                          >
                            {/* Avatar Badge Icon */}
                            <div
                              className={`h-8 w-8 rounded-xl shrink-0 flex items-center justify-center text-xs font-bold border shadow-2xs ${
                                isAdmin
                                  ? 'bg-blue-600 text-white border-blue-500'
                                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {isAdmin ? (
                                <ShieldAlert className="h-4 w-4" />
                              ) : (
                                <User className="h-4 w-4" />
                              )}
                            </div>

                            {/* Chat Bubble Container */}
                            <div
                                className={`group flex max-w-[80%] flex-col space-y-1.5 ${
                                  isAdmin ? 'items-end' : 'items-start'
                                }`}

                            >
                              <div
                                className={`rounded-2xl px-4 py-3 text-xs leading-relaxed font-medium shadow-xs ${
                                  isAdmin
                                    ? 'bg-blue-600 text-white rounded-br-xs border border-blue-500'
                                    : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-bl-xs border border-slate-200 dark:border-slate-700'
                                }`}
                              >
                                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed font-medium">
                                  {msg.text}
                                </p>
                              </div>

                              {/* Message Metadata Tag */}
                              <div
                                className={`flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 dark:text-slate-500 px-1 ${
                                  isAdmin ? 'justify-end' : 'justify-start'
                                }`}

                              >
                                <span>{isAdmin ? 'Dispatch Officer' : citizenLabel}</span>
                                <span>•</span>
                                <span>
                                  {msg.timestamp ? dayjs(msg.timestamp).format('h:mm A') : ''}
                                </span>
                                {isAdmin && <CheckCheck className="w-3 h-3 text-blue-500 ml-0.5" />}
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  ))
                )}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>

            {/* Sticky Dispatch Message Input Form */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0">
              <form onSubmit={handleSend} className="space-y-2">
                <div className="relative flex items-center">
                  <input
                    type="text"
                    maxLength={MAX_CHAR_LIMIT}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Type dispatch instructions (Max 300 chars)..."
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 py-3 pl-4 pr-12 text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 outline-none transition-all focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-blue-500/20"
                  />
                  <button
                    type="submit"
                    disabled={!inputText.trim() || inputText.length > MAX_CHAR_LIMIT}
                    className="absolute right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0 shadow-sm active:scale-95"
                    aria-label="Send message"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>

                {/* Character Counter & Warnings */}
                <div className="flex items-center justify-between px-1 text-[11px]">
                  <span className="text-slate-400 dark:text-slate-500 font-medium">
                    Press <kbd className="px-1 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[10px] text-slate-600 dark:text-slate-300 font-sans">Enter</kbd> to send
                  </span>
                  
                  <div className="flex items-center gap-1 font-bold">
                    {inputText.length >= MAX_CHAR_LIMIT && (
                      <span className="text-rose-600 flex items-center gap-1 mr-1">
                        <AlertCircle className="w-3 h-3" /> Character limit reached
                      </span>
                    )}
                    <span className={inputText.length > 270 ? 'text-rose-600' : 'text-slate-400'}>
                      {inputText.length} / {MAX_CHAR_LIMIT}
                    </span>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
