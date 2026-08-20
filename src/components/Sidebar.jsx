import React from 'react';
import { flushSync } from 'react-dom';
import { Badge } from '@mantine/core';
import {
  LayoutDashboard,
  FilePlus2,
  Radio,
  FolderKanban,
  Users,
  Settings as SettingsIcon,
  Sun,
  Moon,
  LogOut,
  ShieldCheck,
  Activity,
  BarChart3,
  Building2,
} from 'lucide-react';
import { auth } from '../firebase'; // Adjust path to your firebase config
import useAuditLog from '../useAuditLog'; // Adjust path if needed

export default function Sidebar({
  currentPage = 'dashboard',
  setCurrentPage,
  onLogout,
  darkMode,
  setDarkMode,
  isCollapsed = false,
}) {
  const currentUser = auth.currentUser;

  // Initialize Audit Log Hook with current Admin context
  const { logMovement } = useAuditLog({
    adminId: currentUser?.uid || 'ADMIN-UNKNOWN',
    adminName: currentUser?.displayName || currentUser?.email || 'System Admin',
  });

  // Intercept logout to record audit movement before logging out
  const handleLogout = async () => {
    try {
      await logMovement('LOGOUT', currentUser?.uid || 'ADMIN-SESSION', {
        email: currentUser?.email || 'N/A',
        loggedOutAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Audit log error on logout:', error);
    } finally {
      if (onLogout) {
        onLogout();
      }
    }
  };

  // Dashboard internal targeted section IDs
  const dashboardSubItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'dashboard-mid', label: 'Report Statistics', icon: Activity },
    { id: 'dashboard-bottom', label: 'Baranggay', icon: BarChart3 },
    { id: 'dashboard-last', label: 'Agency Statistics', icon: Building2 },
  ];

  // Core structural views
  const menuItems = [
    { id: 'create-reports', label: 'Create Report', icon: FilePlus2 },
    { id: 'send-reports', label: 'Send Reports', icon: Radio },
    { id: 'report-management', label: 'Manage Reports', icon: FolderKanban },
    { id: 'citizen-management', label: 'Manage Citizens', icon: Users },
    { id: 'settings', label: 'Profile Settings', icon: SettingsIcon },
  ];

  // Smooth Circular View Transition Theme Toggle
  const handleThemeToggle = (e) => {
    const isDark = !darkMode;

    if (!document.startViewTransition) {
      setDarkMode(isDark);
      return;
    }

    const x = e.clientX;
    const y = e.clientY;

    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = document.startViewTransition(() => {
      flushSync(() => {
        setDarkMode(isDark);
        if (isDark) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      });
    });

    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`,
      ];

      document.documentElement.animate(
        { clipPath },
        {
          duration: 450,
          easing: 'ease-in-out',
          pseudoElement: '::view-transition-new(root)',
        }
      );
    });
  };

  // Determines if any variation of the dashboard sub-elements is active
  const isDashboardActive = dashboardSubItems.some(sub => sub.id === currentPage || currentPage.startsWith('dashboard'));

  // Handles filtering state routing vs page routing
  const handleItemClick = (targetId, isDashboardChild = false) => {
    if (!setCurrentPage) return;
    
    if (isDashboardChild) {
      // For dashboard scroll anchors/sub-views, tell the navigation handler to stay on dashboard URL path
      setCurrentPage(targetId);
    } else {
      // Standard page shift
      setCurrentPage(targetId);
    }
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-slate-200/80 bg-white text-slate-600 transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 lg:flex ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* BRAND HEADER */}
      <div
        className={`flex h-20 items-center border-b border-slate-100 dark:border-slate-800/80 transition-all duration-300 overflow-hidden ${
          isCollapsed ? 'justify-center px-0' : 'justify-between px-4'
        }`}
      >
        {isCollapsed ? (
          <img
            src="/logo1.png"
            alt="Logo Icon"
            className="h-10 w-auto object-contain shrink-0 transition-all duration-300"
          />
        ) : (
          <>
            <div className="flex items-center gap-0 min-w-0 shrink-0">
              <img
                src="/logo1.png"
                alt="Logo Icon"
                className="h-13 w-auto object-contain shrink-0"
              />
              <img
                src="/AlertU.png"
                alt="AlertU"
                className="h-20 w-auto object-contain shrink-0"
              />
            </div>

            <Badge
              variant="light"
              color="blue"
              size="sm"
              radius="md"
              leftSection={<ShieldCheck className="h-3 w-3" />}
              className="font-bold uppercase tracking-wider shrink-0"
            >
              Admin
            </Badge>
          </>
        )}
      </div>

      {/* NAVIGATION AREA */}
      <nav className="flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden px-3 py-5">
        
        {/* DASHBOARD PARENT ELEMENT */}
        <div className="space-y-1">
          <button
            title={isCollapsed ? 'Dashboard' : undefined}
            onClick={() => handleItemClick('dashboard', true)}
            className={`group relative flex w-full items-center rounded-xl py-3 text-sm font-semibold tracking-wide transition-all outline-none duration-200 cursor-pointer overflow-hidden ${
              isCollapsed ? 'justify-center px-0' : 'gap-3.5 px-3.5'
            } ${
              isDashboardActive
                ? 'bg-blue-50 text-blue-700 shadow-xs dark:bg-blue-500/10 dark:text-blue-400'
                : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
            }`}
          >
            {isDashboardActive && (
              <span className="absolute left-0 top-2.5 h-6 w-1 rounded-r-full bg-blue-600 dark:bg-blue-500" />
            )}

            <LayoutDashboard
              className={`h-5 w-5 shrink-0 transition-transform duration-150 ${
                isDashboardActive
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300'
              }`}
            />

            <span
              className={`truncate whitespace-nowrap transition-opacity duration-200 ${
                isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
              }`}
            >
              Dashboard
            </span>
          </button>

          {/* Sub-menu Navigation Links */}
          <div className={`${isCollapsed ? 'space-y-1' : 'ml-2 space-y-1 border-l-2 border-slate-100 pl-2 dark:border-slate-800'}`}>
            {dashboardSubItems.map((sub) => {
              const SubIcon = sub.icon;
              const isSubActive = currentPage === sub.id;

              return (
                <button
                  key={sub.id}
                  title={isCollapsed ? sub.label : undefined}
                  onClick={() => handleItemClick(sub.id, true)}
                  className={`group relative flex w-full items-center rounded-xl py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all outline-none duration-200 cursor-pointer overflow-hidden ${
                    isCollapsed ? 'justify-center px-0' : 'gap-2 px-3.5'
                  } ${
                    isSubActive
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
                  }`}
                >
                  <SubIcon
                    className={`h-4 w-4 shrink-0 transition-transform duration-150 ${
                      isSubActive
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300'
                    }`}
                  />

                  <span
                    className={`truncate whitespace-nowrap transition-opacity duration-200 ${
                      isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
                    }`}
                  >
                    {sub.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* CORE PLATFORM DIRECTORY */}
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;

          return (
            <button
              key={item.id}
              title={isCollapsed ? item.label : undefined}
              onClick={() => handleItemClick(item.id, false)}
              className={`group relative flex w-full items-center rounded-xl py-3 text-sm font-semibold tracking-wide transition-all outline-none duration-200 cursor-pointer overflow-hidden ${
                isCollapsed ? 'justify-center px-0' : 'gap-3.5 px-3.5'
              } ${
                isActive
                  ? 'bg-blue-50 text-blue-700 shadow-xs dark:bg-blue-500/10 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-2.5 h-6 w-1 rounded-r-full bg-blue-600 dark:bg-blue-500" />
              )}

              <Icon
                className={`h-5 w-5 shrink-0 transition-transform duration-150 ${
                  isActive
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300'
                }`}
              />

              <span
                className={`truncate whitespace-nowrap transition-opacity duration-200 ${
                  isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* FOOTER ACTION PILLS */}
      <div className="space-y-1.5 border-t border-slate-100 p-3 dark:border-slate-800/80 overflow-hidden">
        <button
          title={isCollapsed ? (darkMode ? 'Light Theme' : 'Dark Theme') : undefined}
          onClick={handleThemeToggle}
          className={`flex w-full items-center rounded-xl py-2.5 text-xs font-semibold text-slate-600 transition-all cursor-pointer hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100 outline-none whitespace-nowrap ${
            isCollapsed ? 'justify-center px-0' : 'gap-3.5 px-3.5'
          }`}
        >
          {darkMode ? (
            <Sun className="h-4.5 w-4.5 text-amber-500 shrink-0" />
          ) : (
            <Moon className="h-4.5 w-4.5 text-slate-400 shrink-0" />
          )}
          <span
            className={`transition-opacity duration-200 ${
              isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
            }`}
          >
            {darkMode ? 'Light Theme' : 'Dark Theme'}
          </span>
        </button>

        <button
          title={isCollapsed ? 'Logout Session' : undefined}
          onClick={handleLogout}
          className={`flex w-full items-center rounded-xl py-2.5 text-xs font-semibold text-rose-600 transition-all cursor-pointer hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30 outline-none whitespace-nowrap ${
            isCollapsed ? 'justify-center px-0' : 'gap-3.5 px-3.5'
          }`}
        >
          <LogOut className="h-4.5 w-4.5 shrink-0" />
          <span
            className={`transition-opacity duration-200 ${
              isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
            }`}
          >
            Logout Session
          </span>
        </button>
      </div>
    </aside>
  );
}