import { db } from './firebase'; // Adjust this import path to match your firebase configuration
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  setDoc, 
  addDoc, 
  serverTimestamp,
  increment 
} from 'firebase/firestore';

/**
 * Safely converts Firestore Timestamps or String dates to ISO String.
 */
const formatTimestamp = (val) => {
  if (!val) return new Date().toISOString();
  if (typeof val.toDate === 'function') return val.toDate().toISOString();
  if (typeof val === 'string') return new Date(val).toISOString();
  return new Date().toISOString();
};

/**
 * Real-time listener for all active conversations in the drawer.
 * @param {Function} callback - Called with updated conversation list whenever Firestore changes.
 * @returns {Function} Unsubscribe function to clean up listener.
 */
export function subscribeConversations(callback) {
  const chatsRef = collection(db, 'chats');
  const q = query(chatsRef, orderBy('lastMessageTimestamp', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const conversations = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          chatId: docSnap.id,
          ...data,
          lastMessageTimestamp: formatTimestamp(data.lastMessageTimestamp),
        };
      });
      callback(conversations);
    },
    (error) => {
      console.error('Error fetching conversations from Firestore:', error);
      callback([]);
    }
  );
}

/**
 * Real-time listener for messages in a specific chat room.
 * @param {string} chatId 
 * @param {Function} callback - Called with updated message array whenever a new message arrives.
 * @returns {Function} Unsubscribe function to clean up listener.
 */
export function subscribeMessages(chatId, callback) {
  if (!chatId) return () => {};

  const messagesRef = collection(db, 'chats', chatId, 'messages');
  const q = query(messagesRef, orderBy('timestamp', 'asc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const messages = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          timestamp: formatTimestamp(data.timestamp || data.createdAt),
        };
      });
      callback(messages);
    },
    (error) => {
      console.error(`Error fetching messages for chat ${chatId}:`, error);
      callback([]);
    }
  );
}

/**
 * Send an Admin dispatch message directly to Firestore.
 */
export async function sendChatMessage({ 
  chatId, 
  senderId, 
  text, 
  recipientUid, 
  citizenId, 
  citizenName 
}) {
  if (!chatId || !text.trim()) return;

  const chatDocRef = doc(db, 'chats', chatId);
  const messagesRef = collection(chatDocRef, 'messages');
  const isoTimestamp = new Date().toISOString();

  try {
    // 1. Add message document to subcollection
    await addDoc(messagesRef, {
      chatId,
      senderId: senderId || 'admin_dispatch',
      senderRole: 'admin',
      text: text.trim(),
      recipientUid: recipientUid || '',
      timestamp: isoTimestamp,
      createdAt: serverTimestamp(),
      ...(citizenId && { citizenId }),
      ...(citizenName && { citizenName }),
    });

    // 2. Update conversation header metadata for list previews
    await setDoc(
      chatDocRef,
      {
        chatId,
        lastMessage: text.trim(),
        lastSenderId: senderId || 'admin_dispatch',
        lastSenderRole: 'admin',
        lastMessageTimestamp: serverTimestamp(),
        unreadCountUser: increment(1),
        ...(recipientUid && { citizenUid: recipientUid }),
        ...(citizenId && { citizenId }),
        ...(citizenName && { citizenName }),
      },
      { merge: true }
    );
  } catch (error) {
    console.error('Error sending message via Firestore:', error);
  }
}

/**
 * Mark unread messages as read for admin.
 */
export async function markChatAsRead(chatId) {
  if (!chatId) return;

  const chatDocRef = doc(db, 'chats', chatId);
  try {
    await setDoc(chatDocRef, { unreadCountAdmin: 0 }, { merge: true });
  } catch (error) {
    console.error('Error marking chat as read:', error);
  }
}