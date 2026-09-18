import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { IncidentProvider } from './pages/IncidentContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Create_Reports from './pages/Create_Reports';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import Send_Reports from './pages/Send_Reports';
import Report_Management from './pages/Report_Management';
import Citizen_Management from './pages/Citizen_Management';
import Settings from './pages/Settings';
import PublicReportPage from './pages/PublicReportPage';
import PublicReportPage2 from './pages/PublicReportPage2';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, collectionGroup, doc, query, onSnapshot } from 'firebase/firestore';
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import '@mantine/dates/styles.css';

// 📡 SOCKET & CUSTOM SOS HOOK IMPORTS
import socket, { joinSocketRoom, registerSocketUser } from './socket';
import { useSOSHandler } from './useSOSHandler';

// 📞 AGORA CALL & ANSWER/DECLINE MODAL IMPORTS
import AdminCallModal from './admin_call/AdminCallModal';
import AnswerOrDeclineCall from './admin_call/AnswerOrDeclineCall';

// 🚨 SOS EMERGENCY DISPATCH MODAL IMPORT
import SOSadminModal from './sos_emergency/SOSadminModal';

// 📦 SONNER IMPORT
import { Toaster, toast } from 'sonner';
import MessagesDrawer from './components/MessagesDrawer';

// 📦 MANTINE IMPORTS
import '@mantine/core/styles.css';
import { MantineProvider } from '@mantine/core';

// 🎵 MESSAGETONE HOOK IMPORT
import { useMessagetone } from './useMessagetone';

// Backend API URL
const BACKEND_URL =
  import.meta.env.VITE_SOCKET_URL ||
  import.meta.env.VITE_BACKEND_URL ||
  'https://alertu-server-production.up.railway.app';

function AdminDashboardShell({
  currentPage,
  onNavigate,
  pageTitle,
  darkMode,
  setDarkMode,
  onLogout,
  onSelectSos,
  children
}) {
  const [isMessagesOpen, setIsMessagesOpen] = useState(false);
  const [isSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const handleOpenMessages = () => setIsMessagesOpen((prev) => !prev);
  const handleCloseMessages = () => setIsMessagesOpen(false);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-['Roboto',sans-serif] antialiased transition-colors duration-200">
      <Sidebar
        currentPage={currentPage}
        setCurrentPage={onNavigate}
        onLogout={onLogout}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        isCollapsed={isSidebarCollapsed}
        isOpen={isMobileSidebarOpen}
        setIsOpen={setIsMobileSidebarOpen}
      />

      <div
        className={`flex flex-col transition-[padding] duration-300 ease-[cubic-bezier(0.2,0,0,1)] will-change-[padding] ${
          isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64'
        }`}
      >
        <Navbar
          pageTitle={pageTitle}
          onOpenMessages={handleOpenMessages}
          onSelectSos={onSelectSos}
          isOpen={isMobileSidebarOpen}
          setIsOpen={setIsMobileSidebarOpen}
        />
        <main className="flex-1 pt-2 sm:pt-3 lg:pt-3 px-4 sm:px-6 lg:px-6 pb-8 w-full text-left">
          {children}
        </main>
      </div>

      <MessagesDrawer
        isOpen={isMessagesOpen}
        onClose={handleCloseMessages}
      />
    </div>
  );
}

function AppRoutes() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('authToken'));
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark' ||
      (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  // 📞 GLOBAL CALL STATES & QUEUE
  const [incomingCallsQueue, setIncomingCallsQueue] = useState([]);
  const [activeCallSession, setActiveCallSession] = useState(null);

  // 🚨 CONSUME REAL-TIME SOS HOOK STATE (SINGLE SOURCE OF TRUTH)
  const { selectedSos, selectSosAlert } = useSOSHandler();

  // 🎵 AUDIO TONE FOR REAL-TIME CHAT MESSAGES
  const { playMessagetone } = useMessagetone('/messagetone.mp3');
  const isInitialChatLoad = useRef(true);

  const navigate = useNavigate();
  const location = useLocation();

  // 🔓 UNLOCK BROWSER AUTOPLAY RESTRICTIONS ON FIRST USER INTERACTION
  useEffect(() => {
    const unlockAudio = () => {
      const unlockSound = new Audio('/messagetone.mp3');
      unlockSound.volume = 0.01;
      unlockSound.play().then(() => {
        unlockSound.pause();
        unlockSound.currentTime = 0;
      }).catch(() => {});

      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };

    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  // 💬 REAL-TIME FIRESTORE CHAT SOUND & TOAST LISTENER
  useEffect(() => {
    if (!isAuthenticated) return;

    const messagesQuery = query(collectionGroup(db, 'messages'));

    const unsubscribeMessages = onSnapshot(
      messagesQuery,
      (snapshot) => {
        if (isInitialChatLoad.current) {
          isInitialChatLoad.current = false;
          return;
        }

        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            const senderRole = (data.senderRole || '').toLowerCase();
            const isCitizenMessage = senderRole === 'citizen' || senderRole === 'user' || (senderRole !== 'admin' && senderRole !== 'dispatcher');

            // Check if message is already marked as read
            const isRead = data.isRead === true || data.read === true || data.isReadAdmin === true;

            // Only trigger tone and toast if message is from citizen AND unread
            if (isCitizenMessage && !isRead) {
              playMessagetone();

              toast.custom((t) => (
                <div className="w-full flex items-center justify-between p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg text-slate-800 dark:text-slate-100 font-sans">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0 animate-pulse" />
                    <div>
                      <h4 className="font-semibold text-xs text-slate-800 dark:text-slate-100">New Message Received</h4>
                      <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5 leading-snug">
                        {data.text ? `"${data.text.slice(0, 35)}..."` : "You have a new message."}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => toast.dismiss(t)}
                    className="ml-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                    aria-label="Close toast"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ), { duration: 4000 });
            }
          }
        });
      },
      (error) => {
        console.error("❌ Error listening to Firestore chat messages:", error);
      }
    );

    return () => unsubscribeMessages();
  }, [isAuthenticated, playMessagetone]);

  // 📞 REAL-TIME FIRESTORE ACTIVE CALLS LISTENER (SYNC ACROSS ALL ADMINS)
  useEffect(() => {
    if (!isAuthenticated) return;

    const unsubscribeCalls = onSnapshot(
      collection(db, 'active_calls'),
      (snapshot) => {
        const calls = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.status !== 'completed' && data.status !== 'ended') {
            calls.push({
              id: doc.id,
              channelName: data.channelName || doc.id,
              callerName: data.callerName || data.submitterName || data.citizenName || 'Emergency Citizen',
              citizenId: data.citizenId || '',
              status: data.status || 'ringing',
              assignedAdminId: data.assignedAdminId || null,
              assignedAdminName: data.assignedAdminName || null,
              createdAt: data.createdAt,
            });
          }
        });
        setIncomingCallsQueue(calls);
      },
      (error) => {
        console.error("❌ Error listening to active_calls collection:", error);
      }
    );

    return () => unsubscribeCalls();
  }, [isAuthenticated]);

  // 🚫 REAL-TIME ACCOUNT STATUS LISTENER
  // The Login screen (Login.jsx) only checks `archived`/`isDisabled` ONCE,
  // at sign-in time. Without this, a Super Admin archiving or disabling an
  // admin's account mid-session has no effect until that admin manually
  // logs out and back in — they keep full access with their existing
  // session. This listener watches the logged-in admin's own Firestore doc
  // for the rest of the session and force-logs-them-out the moment either
  // flag flips to true.
  useEffect(() => {
    if (!isAuthenticated) return undefined;

    let unsubscribeDoc = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (unsubscribeDoc) {
        unsubscribeDoc();
        unsubscribeDoc = null;
      }
      if (!currentUser) return;

      // Register presence here (not just in the socket-connect effect) because
      // right after a page refresh, isAuthenticated is already true from
      // localStorage while Firebase Auth is still restoring the session —
      // auth.currentUser can still be null at that moment. This callback's
      // currentUser is guaranteed valid, so it's the reliable place to send
      // the admin's real uid to the presence engine.
      registerSocketUser({ role: 'admin', uid: currentUser.uid });

      unsubscribeDoc = onSnapshot(
        doc(db, 'admins', currentUser.uid),
        (snap) => {
          if (!snap.exists()) return;
          const data = snap.data();
          if (data.archived === true || data.isDisabled === true) {
            toast.error('Your account has been archived/disabled by a Super Administrator.', {
              id: 'account-revoked',
            });
            auth.signOut();
            localStorage.removeItem('authToken');
            setIsAuthenticated(false);
            if (socket.connected) {
              socket.disconnect();
            }
            navigate('/');
          }
        },
        (error) => {
          console.error('❌ Error listening to admin account status:', error);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeDoc) unsubscribeDoc();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // 🟢 SOCKET EMERGENCY AGORA CALL LISTENERS
  useEffect(() => {
    if (isAuthenticated) {
      if (!socket.connected) {
        socket.connect();
      } else {
        joinSocketRoom('admins');
        registerSocketUser({ role: 'admin', uid: auth.currentUser?.uid, socketId: socket.id });
      }

      const handleConnect = () => {
        joinSocketRoom('admins');
        registerSocketUser({ role: 'admin', uid: auth.currentUser?.uid, socketId: socket.id });
      };

      const handleIncomingCall = (data) => {
        const targetRoom = data.channelName || data.targetRoom || data.room;
        const callerName = data.callerName || data.submitterName || data.citizenName || "Emergency Citizen";
        const citizenId = data.citizenId || '';

        toast.info("Incoming Emergency Call", {
          id: `call-toast-${targetRoom}`,
          description: `${callerName} is calling dispatch.`,
        });

        setIncomingCallsQueue((prev) => {
          const exists = prev.some((c) => c.channelName === targetRoom);
          if (exists) {
            return prev.map((c) =>
              c.channelName === targetRoom
                ? { ...c, ...data, channelName: targetRoom, callerName, citizenId }
                : c
            );
          }
          return [
            ...prev,
            {
              id: targetRoom,
              channelName: targetRoom,
              callerName,
              citizenId,
              status: data.status || 'ringing',
              assignedAdminId: data.assignedAdminId || null,
              assignedAdminName: data.assignedAdminName || null,
            },
          ];
        });
      };

      const handleCallClaimed = (data) => {
        const { channelName, assignedAdminId, assignedAdminName } = data || {};
        if (channelName) {
          setIncomingCallsQueue((prev) =>
            prev.map((c) =>
              c.channelName === channelName
                ? {
                    ...c,
                    status: 'in_call',
                    assignedAdminId,
                    assignedAdminName,
                  }
                : c
            )
          );
        }
      };

      const handleCallEnded = (data) => {
        const channelName = typeof data === 'string' ? data : data?.channelName;
        if (channelName) {
          setIncomingCallsQueue((prev) => prev.filter((c) => c.channelName !== channelName));
          setActiveCallSession((prev) => (prev && prev.targetRoom === channelName ? null : prev));
        } else {
          setIncomingCallsQueue([]);
          setActiveCallSession(null);
        }
      };

      socket.on('connect', handleConnect);
      socket.on('call_invite', handleIncomingCall);
      socket.on('incoming_call', handleIncomingCall);
      socket.on('admin:incoming_call', handleIncomingCall);
      socket.on('call_claimed', handleCallClaimed);
      socket.on('call_ended', handleCallEnded);

      return () => {
        socket.off('connect', handleConnect);
        socket.off('call_invite', handleIncomingCall);
        socket.off('incoming_call', handleIncomingCall);
        socket.off('admin:incoming_call', handleIncomingCall);
        socket.off('call_claimed', handleCallClaimed);
        socket.off('call_ended', handleCallEnded);
      };
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith('/admin/')) {
      const page = path.replace('/admin/', '');
      if (page && page !== currentPage) {
        setCurrentPage(page);
      }
    }
  }, [location.pathname, currentPage]);

  // 🏷️ Dynamic Browser Tab Title Listener
  useEffect(() => {
    const path = location.pathname;
    if (path === '/') {
      if (isAuthenticated) {
        document.title = 'Dashboard – AlertU';
      }
    } else if (path.startsWith('/admin/create-reports')) {
      document.title = 'Create Reports – AlertU';
    } else if (path.startsWith('/admin/send-reports')) {
      document.title = 'Send Reports – AlertU';
    } else if (path.startsWith('/admin/report-management')) {
      document.title = 'Manage Reports – AlertU';
    } else if (path.startsWith('/admin/citizen-management')) {
      document.title = 'Manage Citizens – AlertU';
    } else if (path.startsWith('/admin/settings')) {
      document.title = 'Profile Settings – AlertU';
    } else if (path.startsWith('/admin/dashboard')) {
      document.title = 'Dashboard – AlertU';
    } else if (path.startsWith('/report/')) {
      document.title = 'Emergency Report – AlertU';
    }
  }, [location.pathname, isAuthenticated]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  const handleLoginSuccess = async (adminData) => {
    if (adminData.token) {
      localStorage.setItem('authToken', adminData.token);
      setIsAuthenticated(true);

      socket.connect();
      joinSocketRoom('admins');
      registerSocketUser({ role: 'admin', uid: adminData.uid || auth.currentUser?.uid });

      navigate('/admin/dashboard');
    }
  };

  const handleLogout = async () => {
    await auth.signOut();
    localStorage.removeItem('authToken');
    setIsAuthenticated(false);

    if (socket.connected) {
      socket.disconnect();
    }

    navigate('/');
  };

  const handleNavigation = (page) => {
    setCurrentPage(page);
    navigate(`/admin/${page}`);
  };

  // 📞 CALL HANDLERS (ATOMIC CLAIM TO PREVENT DUPLICATE ANSWERING)
  const handleAnswerCall = async (callData) => {
    const currentAdminId = auth.currentUser?.uid || 'admin';
    const currentAdminName = auth.currentUser?.displayName || auth.currentUser?.email || 'Dispatcher';
    const channelName = callData.channelName;

    try {
      const response = await fetch(`${BACKEND_URL}/api/calls/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelName,
          adminId: currentAdminId,
          adminName: currentAdminName,
        }),
      });

      const result = await response.json();

      if (response.status === 409) {
        const claimedBy = result.claimedBy || 'another dispatcher';
        toast.error('Call Already Claimed', {
          id: `claimed-${channelName}`,
          description: `This call has already been answered by ${claimedBy}.`,
        });

        // Update local queue immediately
        setIncomingCallsQueue((prev) =>
          prev.map((c) =>
            c.channelName === channelName
              ? { ...c, status: 'in_call', assignedAdminName: claimedBy, assignedAdminId: result.assignedAdminId }
              : c
          )
        );
        return false;
      }

      if (!response.ok) {
        toast.error('Unable to claim call', {
          description: result.message || 'Call may have ended.',
        });
        return false;
      }

      // Successfully claimed! Open call modal for this admin
      setActiveCallSession({
        targetRoom: channelName,
        citizenName: callData.callerName || callData.citizenName || 'Emergency Citizen',
        citizenId: callData.citizenId || '',
      });

      return true;
    } catch (err) {
      console.error('❌ Error claiming call:', err);
      // Fallback: If network error reaching backend, proceed with call session
      setActiveCallSession({
        targetRoom: channelName,
        citizenName: callData.callerName || callData.citizenName || 'Emergency Citizen',
        citizenId: callData.citizenId || '',
      });
      return true;
    }
  };

  const handleDeclineCall = (callData) => {
    const channelName = callData?.channelName;
    if (channelName) {
      setIncomingCallsQueue((prev) => prev.filter((c) => c.channelName !== channelName));
    } else {
      setIncomingCallsQueue([]);
    }
  };

  const staticTitle = "Dashboard";

  // ❌ HANDLER TO CLOSE SOS MODAL
  const handleCloseSosModal = useCallback(() => {
    if (typeof selectSosAlert === 'function') {
      selectSosAlert(null);
    }
  }, [selectSosAlert]);

  return (
    <>
      <Routes>
        <Route path="/report/:id" element={<PublicReportPage />} />
        <Route path="/report/public/:id" element={<PublicReportPage2 />} />

        <Route path="/" element={isAuthenticated ? <Navigate to="/admin/dashboard" replace /> : <Login onLoginSuccess={handleLoginSuccess} />} />

        <Route path="/admin/dashboard" element={
          isAuthenticated ? (
            <AdminDashboardShell
              currentPage="dashboard"
              onNavigate={handleNavigation}
              pageTitle={staticTitle}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              onLogout={handleLogout}
              onSelectSos={selectSosAlert}
            >
              <Dashboard />
            </AdminDashboardShell>
          ) : <Navigate to="/" replace />
        } />

        <Route path="/admin/dashboard-mid" element={
          isAuthenticated ? (
            <AdminDashboardShell
              currentPage="dashboard-mid"
              onNavigate={handleNavigation}
              pageTitle={staticTitle}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              onLogout={handleLogout}
              onSelectSos={selectSosAlert}
            >
              <Dashboard />
            </AdminDashboardShell>
          ) : <Navigate to="/" replace />
        } />

        <Route path="/admin/dashboard-bottom" element={
          isAuthenticated ? (
            <AdminDashboardShell
              currentPage="dashboard-bottom"
              onNavigate={handleNavigation}
              pageTitle={staticTitle}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              onLogout={handleLogout}
              onSelectSos={selectSosAlert}
            >
              <Dashboard />
            </AdminDashboardShell>
          ) : <Navigate to="/" replace />
        } />

        <Route path="/admin/dashboard-last" element={
          isAuthenticated ? (
            <AdminDashboardShell
              currentPage="dashboard-last"
              onNavigate={handleNavigation}
              pageTitle={staticTitle}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              onLogout={handleLogout}
              onSelectSos={selectSosAlert}
            >
              <Dashboard />
            </AdminDashboardShell>
          ) : <Navigate to="/" replace />
        } />

        <Route path="/admin/create-reports" element={
          isAuthenticated ? (
            <AdminDashboardShell
              currentPage="create-reports"
              onNavigate={handleNavigation}
              pageTitle={staticTitle}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              onLogout={handleLogout}
              onSelectSos={selectSosAlert}
            >
              <Create_Reports />
            </AdminDashboardShell>
          ) : <Navigate to="/" replace />
        } />

        <Route path="/admin/send-reports" element={
          isAuthenticated ? (
            <AdminDashboardShell
              currentPage="send-reports"
              onNavigate={handleNavigation}
              pageTitle={staticTitle}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              onLogout={handleLogout}
              onSelectSos={selectSosAlert}
            >
              <Send_Reports />
            </AdminDashboardShell>
          ) : <Navigate to="/" replace />
        } />

        <Route path="/admin/report-management" element={
          isAuthenticated ? (
            <AdminDashboardShell
              currentPage="report-management"
              onNavigate={handleNavigation}
              pageTitle={staticTitle}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              onLogout={handleLogout}
              onSelectSos={selectSosAlert}
            >
              <Report_Management />
            </AdminDashboardShell>
          ) : <Navigate to="/" replace />
        } />

        <Route path="/admin/citizen-management" element={
          isAuthenticated ? (
            <AdminDashboardShell
              currentPage="citizen-management"
              onNavigate={handleNavigation}
              pageTitle={staticTitle}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              onLogout={handleLogout}
              onSelectSos={selectSosAlert}
            >
              <Citizen_Management />
            </AdminDashboardShell>
          ) : <Navigate to="/" replace />
        } />

        <Route path="/admin/settings" element={
          isAuthenticated ? (
            <AdminDashboardShell
              currentPage="settings"
              onNavigate={handleNavigation}
              pageTitle={staticTitle}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              onLogout={handleLogout}
              onSelectSos={selectSosAlert}
            >
              <Settings />
            </AdminDashboardShell>
          ) : <Navigate to="/" replace />
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* 🔔 1. INCOMING RINGING CALL PROMPT WITH RINGTONE & CALL QUEUE */}
      {incomingCallsQueue.length > 0 && (
        <AnswerOrDeclineCall
          callsQueue={incomingCallsQueue}
          onAnswer={handleAnswerCall}
          onDecline={handleDeclineCall}
          currentAdminId={auth.currentUser?.uid}
          isCallActive={Boolean(activeCallSession)}
        />
      )}

      {/* 📞 2. GLOBAL AGORA EMERGENCY VIDEO CALL OVERLAY */}
      {activeCallSession && (
        <AdminCallModal
          targetRoom={activeCallSession.targetRoom}
          citizenName={activeCallSession.citizenName}
          backendUrl={BACKEND_URL}
          onClose={() => setActiveCallSession(null)}
        />
      )}

      {/* 🚨 3. SINGLE GLOBAL SOS EMERGENCY LIVE TRACKER & DISPATCH MODAL */}
      {Boolean(selectedSos && (selectedSos.sosId || selectedSos.id)) && (
        <SOSadminModal
          sosId={selectedSos.sosId || selectedSos.id}
          targetRoom={selectedSos.targetRoom || (selectedSos.sosId || selectedSos.id)}
          citizenName={
            selectedSos.citizenName ||
            selectedSos.submitterName ||
            selectedSos.name ||
            selectedSos.user?.name ||
            'Emergency Citizen'
          }
          submitterName={
            selectedSos.submitterName ||
            selectedSos.citizenName
          }
          citizenId={
            selectedSos.citizenId ||
            selectedSos.citizenUid ||
            selectedSos.citizenID ||
            selectedSos.userId ||
            'N/A'
          }
          citizenPhone={
            selectedSos.citizenPhone ||
            selectedSos.submitterPhone ||
            selectedSos.phone ||
            selectedSos.phoneNumber ||
            selectedSos.contactNumber ||
            selectedSos.mobile ||
            selectedSos.user?.phoneNumber ||
            selectedSos.user?.phone
          }
          submitterPhone={
            selectedSos.submitterPhone ||
            selectedSos.citizenPhone ||
            selectedSos.phone
          }
          phone={
            selectedSos.phone ||
            selectedSos.citizenPhone ||
            selectedSos.submitterPhone
          }
          citizenEmail={
            selectedSos.citizenEmail ||
            selectedSos.submitterEmail ||
            selectedSos.email ||
            selectedSos.emailAddress ||
            selectedSos.user?.email
          }
          submitterEmail={
            selectedSos.submitterEmail ||
            selectedSos.citizenEmail ||
            selectedSos.email
          }
          email={
            selectedSos.email ||
            selectedSos.citizenEmail ||
            selectedSos.submitterEmail
          }
          locationData={selectedSos.locationData || selectedSos.gisLocation || selectedSos}
          emergencyContacts={
            selectedSos.emergencyContacts ||
            selectedSos.contacts ||
            []
          }
          sosDetails={
            selectedSos.sosDetails ||
            selectedSos.notes ||
            selectedSos.details ||
            selectedSos.note ||
            'Emergency SOS Triggered'
          }
          backendUrl={BACKEND_URL}
          onClose={handleCloseSosModal}
        />
      )}

      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnHover
        draggable
        theme={darkMode ? "dark" : "light"}
      />

      <Toaster
        position="top-right"
        duration={4000}
        visibleToasts={3}
      />
    </>
  );
}

export default function App() {
  return (
    <MantineProvider>
      <IncidentProvider>
        <Router>
          <AppRoutes />
        </Router>
      </IncidentProvider>
    </MantineProvider>
  );
}
