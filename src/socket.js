import { io } from 'socket.io-client';

const RAILWAY_BACKEND_URL = 'https://alertu-server-production.up.railway.app';

const configuredSocketUrl = (
  import.meta.env.VITE_SOCKET_URL ||
  import.meta.env.VITE_BACKEND_URL ||
  RAILWAY_BACKEND_URL
).trim();

// Socket.IO must use the backend origin, without /api.
const SOCKET_URL = configuredSocketUrl.replace(/\/+$/, '').replace(/\/api$/i, '');

// 2. Instantiate singleton Socket.IO instance connected to Railway
export const socket = io(SOCKET_URL, {
  path: '/socket.io',
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 25,
  reconnectionDelay: 1000,
  transports: ['polling', 'websocket'],
  upgrade: true, // Start through polling, then upgrade when Railway permits WebSocket.
  withCredentials: true,
});

// Helper getter for consumers needing dynamic socket references
export const getSocket = () => socket;

// Active state preservation across reconnects
const activeRooms = new Set();
let cachedUserData = null;

// Multi-subscriber callback sets
const sosAlertCallbacks = new Set();
const sosLocationCallbacks = new Set();
const sosStatusCallbacks = new Set();

// Bind central multi-alias listeners to cover all backend emission patterns
const handleSosAlert = (data) => sosAlertCallbacks.forEach((cb) => cb(data));
const handleSosLocation = (data) => sosLocationCallbacks.forEach((cb) => cb(data));
const handleSosStatus = (data) => sosStatusCallbacks.forEach((cb) => cb(data));

// Dual binding for event name variations (Backend / App interoperability)
socket.on('sos:alert_triggered', handleSosAlert);
socket.on('sos:trigger', handleSosAlert);

socket.on('sos:location_updated', handleSosLocation);
socket.on('sos:location_update', handleSosLocation);

socket.on('sos:status_updated', handleSosStatus);
socket.on('sos:status_change', handleSosStatus);

/**
 * Join a specific socket room (e.g., 'admins', 'superadmins')
 */
export const joinSocketRoom = (roomName) => {
  if (!roomName) return;
  activeRooms.add(roomName);

  if (socket.connected) {
    socket.emit('join_room', roomName);
    socket.emit('joinSocketRoom', roomName);
    console.log(`📌 Joined room: ${roomName}`);
  }
};

/**
 * Leave a specific socket room
 */
export const leaveSocketRoom = (roomName) => {
  if (!roomName) return;
  activeRooms.delete(roomName);

  if (socket.connected) {
    socket.emit('leave_room', roomName);
    console.log(`🚪 Left room: ${roomName}`);
  }
};

/**
 * Authenticate and register user identity with backend presence engine
 */
export const registerSocketUser = (userData) => {
  if (!userData) return;
  cachedUserData = userData;

  if (socket.connected) {
    socket.emit('register_user', userData);
    socket.emit('user_online', userData);
    console.log(`👤 Registered presence engine identity:`, userData);
  }
};

/**
 * Explicitly log out or disconnect presence
 */
export const disconnectSocketUser = () => {
  if (socket.connected && cachedUserData) {
    socket.emit('user_offline', cachedUserData);
  }
  cachedUserData = null;
  activeRooms.clear();
};

// ==========================================
// 🚨 SOS SIGNALING & ROOM WRAPPERS
// ==========================================

/**
 * Formats key to standard single-document room pattern (`sos_{id}`)
 */
const formatSosRoomKey = (rawId) => {
  if (!rawId) return 'sos_global';
  const clean = String(rawId).trim().replace(/^sos_/, '');
  return `sos_${clean}`;
};

/**
 * Join specific SOS monitoring room (e.g., "sos_CID12345") or global SOS dashboard room
 */
export const joinSosRoom = (sosId) => {
  if (!sosId) {
    joinSocketRoom('admins');
    return;
  }

  const standardizedSosId = formatSosRoomKey(sosId);
  const cleanSosId = standardizedSosId.replace(/^sos_/, '');
  activeRooms.add(standardizedSosId);

  if (socket.connected) {
    socket.emit('sos:join_room', {
      sosId: standardizedSosId,
      cleanSosId,
    });
    socket.emit('join_room', standardizedSosId);
    console.log(`🚨 Joined SOS room: ${standardizedSosId}`);
  }
};

/**
 * Leave specific SOS monitoring room
 */
export const leaveSosRoom = (sosId) => {
  if (!sosId) return;
  const standardizedSosId = formatSosRoomKey(sosId);
  const cleanSosId = standardizedSosId.replace(/^sos_/, '');
  activeRooms.delete(standardizedSosId);

  if (socket.connected) {
    socket.emit('sos:leave_room', {
      sosId: standardizedSosId,
      cleanSosId,
    });
    socket.emit('leave_room', standardizedSosId);
    console.log(`🚨 Left SOS room: ${standardizedSosId}`);
  }
};

/**
 * Emit client-initiated Emergency SOS Alert
 */
export const emitSosTriggerAlert = (payload) => {
  if (!socket.connected) return console.warn('⚠️ SOS trigger alert dropped: Socket offline.');

  const rawId = payload.sosId || payload.id || `sos_${Date.now()}`;
  const standardizedSosId = formatSosRoomKey(rawId);

  socket.emit('sos:trigger_alert', {
    ...payload,
    sosId: standardizedSosId,
    id: standardizedSosId,
    status: payload.status || 'ACTIVE',
    triggeredAt: new Date().toISOString(),
  });
};

/**
 * Update dynamic GIS position for an active SOS alert
 */
export const emitSosLocationUpdate = (sosId, gisLocation, citizenUid) => {
  if (!socket.connected) return console.warn('⚠️ SOS location update dropped: Socket offline.');

  const standardizedSosId = formatSosRoomKey(sosId);
  const cleanSosId = standardizedSosId.replace(/^sos_/, '');

  socket.emit('sos:update_location', {
    sosId: standardizedSosId,
    cleanSosId,
    citizenUid,
    gisLocation,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Emit status update for an SOS session (ACTIVE, ACKNOWLEDGED, DISPATCHED, RESOLVED, CANCELLED)
 */
export const emitSosStatusUpdate = (sosId, status, responderNotes = '', citizenUid = '') => {
  if (!socket.connected) return console.warn('⚠️ SOS status update dropped: Socket offline.');

  const standardizedSosId = formatSosRoomKey(sosId);
  const cleanSosId = standardizedSosId.replace(/^sos_/, '');

  socket.emit('sos:update_status', {
    sosId: standardizedSosId,
    cleanSosId,
    citizenUid,
    status: String(status).toUpperCase(),
    responderNotes,
    updatedAt: new Date().toISOString(),
  });
};

/**
 * Listen for new incoming SOS alerts (returns an unsubscribe function)
 */
export const onSosAlertTriggered = (callback) => {
  if (typeof callback !== 'function') return () => {};
  sosAlertCallbacks.add(callback);
  return () => sosAlertCallbacks.delete(callback);
};

/**
 * Listen for SOS location updates (returns an unsubscribe function)
 */
export const onSosLocationUpdated = (callback) => {
  if (typeof callback !== 'function') return () => {};
  sosLocationCallbacks.add(callback);
  return () => sosLocationCallbacks.delete(callback);
};

/**
 * Listen for SOS status updates (returns an unsubscribe function)
 */
export const onSosStatusUpdated = (callback) => {
  if (typeof callback !== 'function') return () => {};
  sosStatusCallbacks.add(callback);
  return () => sosStatusCallbacks.delete(callback);
};

// ==========================================
// 💬 CHAT SIGNALING WRAPPERS
// ==========================================

export const joinChatRoom = (arg1, arg2) => {
  const chatId = typeof arg1 === 'string' ? arg1 : arg2;
  if (!chatId) return;

  const roomKey = `chat_${chatId}`;
  activeRooms.add(roomKey);

  if (socket.connected) {
    socket.emit('join_chat', { chatId });
    console.log(`💬 Joined chat room: ${chatId}`);
  }
};

export const leaveChatRoom = (arg1, arg2) => {
  const chatId = typeof arg1 === 'string' ? arg1 : arg2;
  if (!chatId) return;

  const roomKey = `chat_${chatId}`;
  activeRooms.delete(roomKey);

  if (socket.connected) {
    socket.emit('leave_chat', { chatId });
    console.log(`💬 Left chat room: ${chatId}`);
  }
};

export const sendChatMessage = (arg1, arg2) => {
  const messagePayload = arg1 && arg1.emit ? arg2 : arg1;

  if (!messagePayload) {
    console.warn('⚠️ Cannot send message: Invalid payload provided.');
    return;
  }

  if (!socket.connected) {
    console.error('⚠️ Message dropped: Socket offline.');
    return;
  }

  socket.emit('send_message', messagePayload);
  console.log(`💬 Sent chat message to room ${messagePayload.chatId}:`, messagePayload);
};

export const markChatAsRead = (arg1, arg2, arg3) => {
  let chatId, userRole;

  if (typeof arg1 === 'string') {
    chatId = arg1;
    userRole = arg2 || 'admin';
  } else {
    chatId = arg2;
    userRole = arg3 || 'admin';
  }

  if (!chatId) return;

  if (socket.connected) {
    socket.emit('mark_read', { chatId, userRole });
  }
};

// ==========================================
// 📞 AGORA EMERGENCY SIGNALING WRAPPERS
// ==========================================

export const emitCallInvite = (targetRoom, channelName, callerName = 'Emergency Dispatcher') => {
  if (!socket.connected) return console.error('⚠️ Signalling dropped: Socket offline.');
  socket.emit('call_invite', {
    channelName,
    targetRoom: targetRoom || 'admins',
    callerName,
    callerId: socket.id,
    timestamp: new Date().toISOString(),
  });
};

export const emitCallAccept = (targetRoom, channelName, targetSocketId) => {
  if (!socket.connected) return;
  socket.emit('call_accept', {
    targetRoom,
    channelName,
    callerId: targetSocketId,
    targetSocketId,
    senderSocketId: socket.id,
  });
};

export const emitCallReject = (targetRoom, channelName, targetSocketId, reason = 'User rejected the call') => {
  if (!socket.connected) return;
  socket.emit('call_reject', {
    targetRoom,
    channelName,
    callerId: targetSocketId,
    targetSocketId,
    reason,
  });
};

export const emitCallEnded = (targetRoom, channelName) => {
  if (!socket.connected) return;
  socket.emit('call_ended', {
    targetRoom: targetRoom || 'admins',
    channelName,
  });
};

// ==========================================
// 🔄 LIFECYCLE MANAGEMENT PIPELINE
// ==========================================

socket.on('connect', () => {
  console.log(`⚡ Connected to AlertU Socket Server on Railway (ID: ${socket.id})`);

  // Restore presence state
  if (cachedUserData) {
    socket.emit('register_user', cachedUserData);
    setTimeout(() => {
      if (socket.connected) socket.emit('user_online', cachedUserData);
    }, 150);
    console.log(`🔄 Restored presence state upon reconnection.`);
  }

  // Restore room memberships across drops
  if (activeRooms.size > 0) {
    activeRooms.forEach((roomName) => {
      if (roomName.startsWith('chat_')) {
        const chatId = roomName.replace('chat_', '');
        socket.emit('join_chat', { chatId });
      } else if (roomName.startsWith('sos_')) {
        const cleanSosId = roomName.replace('sos_', '');
        socket.emit('sos:join_room', { sosId: roomName, cleanSosId });
        socket.emit('join_room', roomName);
      } else {
        socket.emit('join_room', roomName);
        socket.emit('joinSocketRoom', roomName);
      }
      console.log(`📌 Re-joined room on connect: ${roomName}`);
    });
  }
});

socket.on('disconnect', (reason) => {
  console.warn(`❌ Socket disconnected: ${reason}`);
});

socket.on('connect_error', (error) => {
  console.error('⚠️ Socket Connection Error:', error.message);
});

export default socket;