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
import { collectionGroup, query, onSnapshot } from 'firebase/firestore'; 
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

  // 📞 GLOBAL CALL STATES
  const [incomingCallSession, setIncomingCallSession] = useState(null);
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

  // 🟢 SOCKET EMERGENCY AGORA CALL LISTENERS
  useEffect(() => {
    if (isAuthenticated) {
      if (!socket.connected) {
        socket.connect();
      } else {
        joinSocketRoom('admins');
        registerSocketUser({ role: 'admin', socketId: socket.id });
      }

      const handleConnect = () => {
        joinSocketRoom('admins');
        registerSocketUser({ role: 'admin', socketId: socket.id });
      };

      const handleIncomingCall = (data) => {
        const targetRoom = data.channelName || data.targetRoom || data.room;
        const callerName = data.callerName || data.citizenName || "Emergency Citizen";

        toast.info("Incoming Emergency Call", {
          id: `call-toast-${targetRoom}`,
          description: `${callerName} is calling dispatch.`,
        });

        setIncomingCallSession({
          channelName: targetRoom,
          callerName: callerName,
        });
      };

      const handleCallEnded = () => {
        setIncomingCallSession(null);
        setActiveCallSession(null);
      };

      socket.on('connect', handleConnect);
      socket.on('call_invite', handleIncomingCall);
      socket.on('incoming_call', handleIncomingCall);
      socket.on('call_ended', handleCallEnded);

      return () => {
        socket.off('connect', handleConnect);
        socket.off('call_invite', handleIncomingCall);
        socket.off('incoming_call', handleIncomingCall);
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
      registerSocketUser({ role: 'admin', uid: adminData.uid || 'admin' });

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

  // 📞 CALL HANDLERS
  const handleAnswerCall = (callData) => {
    setIncomingCallSession(null);
    setActiveCallSession({
      targetRoom: callData.channelName,
      citizenName: callData.callerName,
    });
  };

  const handleDeclineCall = () => {
    setIncomingCallSession(null);
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

      {/* 🔔 1. INCOMING RINGING CALL PROMPT WITH RINGTONE */}
      {incomingCallSession && (
        <AnswerOrDeclineCall 
          callData={incomingCallSession}
          onAnswer={handleAnswerCall}
          onDecline={handleDeclineCall}
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