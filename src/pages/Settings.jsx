import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from '../firebase'; // Adjust path if needed
import { doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { Eye, EyeOff, Lock, ShieldCheck, X, Loader2, Mail, KeyRound, ArrowLeft } from 'lucide-react';
import useAuditLog from '../useAuditLog'; // Adjust path if needed

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'https://alertu-server-production.up.railway.app';

export default function Settings() {
  const fileInputRef = useRef(null);
  const isEditingRef = useRef(false);

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });

  // Password Modal & Form States
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordStep, setPasswordStep] = useState('request'); // 'request' | 'verify'
  const [resetEmail, setResetEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Show / Hide Password Toggles
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Profile State matching updated schema
  const [profile, setProfile] = useState({
    uid: '',
    adminId: '',
    name: '',
    phone: '',
    email: '',
    department: '',
    address: '',
    avatar: '',
  });

  // Initialize Audit Log Hook with current Admin context
  const { logMovement } = useAuditLog({
    adminId: profile.adminId || profile.uid || 'ADMIN-UNKNOWN',
    adminName: profile.name || 'System Admin',
    apiBaseUrl: API_BASE_URL ? `${API_BASE_URL}/api` : '/api',
  });

  // Helper for displaying toast feedback notifications
  const showFeedback = (type, text) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage({ type: '', text: '' }), 5000);
  };

  // Reset Password Modal Fields
  const resetPasswordModalState = () => {
    setPasswordStep('request');
    setResetEmail(auth.currentUser?.email || profile.email || '');
    setOtpCode('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  // ==========================================================
  // REAL-TIME FIRESTORE & AUTH SYNC
  // ==========================================================
  useEffect(() => {
    let unsubscribeFirestore = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (unsubscribeFirestore) {
        unsubscribeFirestore();
        unsubscribeFirestore = null;
      }

      if (currentUser) {
        setLoadingProfile(true);

        const adminDocRef = doc(db, 'admins', currentUser.uid);

        unsubscribeFirestore = onSnapshot(
          adminDocRef,
          (docSnap) => {
            const firestoreData = docSnap.exists() ? docSnap.data() : {};

            setProfile((prev) => {
              if (isEditingRef.current) {
                return {
                  ...prev,
                  avatar: firestoreData.avatar || prev.avatar,
                };
              }

              const resolvedName =
                firestoreData.name ||
                firestoreData.displayName ||
                currentUser.displayName ||
                '';

              const resolvedEmail =
                firestoreData.email ||
                currentUser.email ||
                '';

              const resolvedPhone =
                firestoreData.phone ||
                firestoreData.phoneNumber ||
                currentUser.phoneNumber ||
                '';

              const resolvedAvatar =
                firestoreData.avatar ||
                firestoreData.photoURL ||
                currentUser.photoURL ||
                '';

              return {
                uid: currentUser.uid,
                adminId: firestoreData.adminId || '',
                name: resolvedName,
                phone: resolvedPhone,
                email: resolvedEmail,
                department: firestoreData.department || '',
                address: firestoreData.address || '',
                avatar: resolvedAvatar,
              };
            });

            setLoadingProfile(false);
          },
          (error) => {
            console.error('Firestore admin doc listener error:', error);
            setProfile((prev) => ({
              ...prev,
              uid: currentUser.uid,
              name: currentUser.displayName || '',
              email: currentUser.email || '',
              phone: currentUser.phoneNumber || '',
              avatar: currentUser.photoURL || '',
            }));
            setLoadingProfile(false);
          }
        );
      } else {
        setLoadingProfile(false);
      }
    });

    return () => {
      if (unsubscribeFirestore) unsubscribeFirestore();
      unsubscribeAuth();
    };
  }, []);

  const handleInputChange = (field, value) => {
    isEditingRef.current = true;
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  // ==========================================================
  // AVATAR UPLOAD HANDLER -> /api/admin/upload-avatar
  // ==========================================================
  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const currentUser = auth.currentUser;
    if (!currentUser) {
      showFeedback('error', 'Active login session not found.');
      return;
    }

    setUploadingAvatar(true);
    try {
      const token = await currentUser.getIdToken(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('uid', currentUser.uid);

      const response = await fetch(`${API_BASE_URL}/api/admin/upload-avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || data.message || 'Failed to upload avatar.');
      }

      setProfile((prev) => ({ ...prev, avatar: data.fileUrl }));
      showFeedback('success', 'Avatar updated successfully!');

      // Audit Log: Avatar Upload
      await logMovement('UPDATE_AVATAR', profile.adminId || currentUser.uid, {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        avatarUrl: data.fileUrl,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Avatar upload error:', error);
      showFeedback('error', `Avatar upload failed: ${error.message}`);
    } finally {
      setUploadingAvatar(false);
    }
  };

  // ==========================================================
  // SUBMIT PROFILE FORM -> /api/admin/update-admin-auth
  // ==========================================================
  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      showFeedback('error', 'Active login session not found.');
      return;
    }

    setSavingProfile(true);
    try {
      const token = await currentUser.getIdToken(true);

      const response = await fetch(`${API_BASE_URL}/api/admin/update-admin-auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          uid: currentUser.uid,
          name: profile.name,
          email: profile.email,
          phone: profile.phone,
          department: profile.department,
          address: profile.address,
          avatar: profile.avatar,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || data.message || 'Failed to update profile.');
      }

      isEditingRef.current = false;
      showFeedback('success', 'Profile synchronized successfully!');

      // Audit Log: Update Profile
      await logMovement('UPDATE_PROFILE_SETTINGS', profile.adminId || currentUser.uid, {
        updatedFields: {
          name: profile.name,
          email: profile.email,
          phone: profile.phone,
          department: profile.department,
          address: profile.address,
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to update profile:', error);
      showFeedback('error', `Update failed: ${error.message}`);
    } finally {
      setSavingProfile(false);
    }
  };

  // ==========================================================
  // OTP RESET FLOW (STEP 1: REQUEST OTP)
  // ==========================================================
  const handleSendResetOtp = async (e) => {
    e.preventDefault();
    setPasswordError('');

    if (!resetEmail) {
      setPasswordError('Please enter a valid email address.');
      return;
    }

    setChangingPassword(true);
    try {
      // Get authentication bearer token if active user is logged in
      const currentUser = auth.currentUser;
      const token = currentUser ? await currentUser.getIdToken(true) : '';

      // UPDATED ENDPOINT PATH -> /api/auth/send-admin-reset-otp
      const response = await fetch(`${API_BASE_URL}/api/auth/send-admin-reset-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ email: resetEmail }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to send verification code.');
      }

      setPasswordStep('verify');

      // Audit Log: Password Reset OTP Requested
      await logMovement('REQUEST_PASSWORD_RESET_OTP', resetEmail, {
        targetEmail: resetEmail,
        requestedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Send reset OTP error:', error);
      setPasswordError(error.message || 'Failed to send verification code.');
    } finally {
      setChangingPassword(false);
    }
  };

  // ==========================================================
  // OTP RESET FLOW (STEP 2: VERIFY OTP & SET NEW PASSWORD)
  // ==========================================================
  const handleResetPasswordWithOtp = async (e) => {
    e.preventDefault();
    setPasswordError('');

    if (!otpCode || otpCode.trim().length < 6) {
      setPasswordError('Please enter the 6-digit verification code.');
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setChangingPassword(true);
    try {
      // Get authentication bearer token if active user is logged in
      const currentUser = auth.currentUser;
      const token = currentUser ? await currentUser.getIdToken(true) : '';

      // UPDATED ENDPOINT PATH -> /api/auth/reset-admin-password
      const response = await fetch(`${API_BASE_URL}/api/auth/reset-admin-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          email: resetEmail,
          otp: otpCode.trim(),
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to reset password.');
      }

      setIsPasswordModalOpen(false);
      resetPasswordModalState();
      showFeedback('success', 'Password updated successfully!');

      // Audit Log: Password Reset Completed
      await logMovement('RESET_PASSWORD_VIA_OTP', resetEmail, {
        targetEmail: resetEmail,
        resetAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Reset password error:', error);
      setPasswordError(error.message || 'Failed to reset password.');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 font-sans antialiased text-slate-900 dark:text-slate-100 space-y-6">
      {/* Status Alert Toast */}
      {statusMessage.text && (
        <div
          className={`px-4 py-3 rounded-2xl text-xs font-semibold backdrop-blur-md shadow-md transition-all flex items-center justify-between border ${
            statusMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
          }`}
        >
          <div className="flex items-center space-x-2">
            <span
              className={`w-2 h-2 rounded-full ${
                statusMessage.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
            />
            <span>{statusMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage({ type: '', text: '' })}
            className="text-[10px] font-bold tracking-wider uppercase opacity-70 hover:opacity-100 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Profile Container Card */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="px-6 sm:px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">Profile Settings</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Manage your administrator account details and contact information.
            </p>
          </div>
          {loadingProfile && (
            <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 animate-pulse">
              Syncing...
            </span>
          )}
        </div>

        {/* Profile Settings Form */}
        <form onSubmit={handleProfileSubmit} className="p-6 sm:p-8 space-y-6">
          {/* Avatar Section */}
          <div className="flex items-center space-x-5 pb-6 border-b border-slate-100 dark:border-slate-800">
            <div className="relative w-20 h-20 rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
              {profile.avatar ? (
                <img src={profile.avatar} alt="User Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-black text-slate-400 dark:text-slate-500">
                  {profile.name ? profile.name.charAt(0).toUpperCase() : 'A'}
                </span>
              )}
            </div>

            <div className="space-y-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleAvatarChange}
                accept="image/png, image/jpeg, image/webp, image/gif"
                className="hidden"
              />
              <button
                type="button"
                disabled={uploadingAvatar}
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
              >
                {uploadingAvatar ? 'Uploading image...' : 'Change Avatar'}
              </button>
              <p className="text-[11px] text-slate-400">JPG, PNG, WEBP or GIF up to 5MB.</p>
            </div>
          </div>

          {/* Input Fields Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Full Name
              </label>
              <input
                type="text"
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 text-xs font-medium bg-slate-50/50 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                value={profile.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Email Address
              </label>
              <input
                type="email"
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 text-xs font-medium bg-slate-50/50 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                value={profile.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Phone Number
              </label>
              <input
                type="tel"
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 text-xs font-medium bg-slate-50/50 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                value={profile.phone}
                onChange={(e) => handleInputChange('phone', e.target.value)}
                placeholder="+639..."
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Department
              </label>
              <input
                type="text"
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 text-xs font-medium bg-slate-50/50 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                value={profile.department}
                onChange={(e) => handleInputChange('department', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Address / HQ Location
            </label>
            <input
              type="text"
              className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 text-xs font-medium bg-slate-50/50 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={profile.address}
              onChange={(e) => handleInputChange('address', e.target.value)}
            />
          </div>

          <div className="pt-4 flex justify-end">
            <button
              type="submit"
              disabled={savingProfile}
              className="px-6 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold tracking-wide shadow-md shadow-blue-500/20 transition-all cursor-pointer disabled:opacity-50"
            >
              {savingProfile ? 'Saving Changes...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </div>

      {/* Security & Authentication Section */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="px-6 sm:px-8 py-6 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Account Security</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage your password and active security credentials.
          </p>
        </div>

        <div className="p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Password</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Reset your password using an email verification code (OTP).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              resetPasswordModalState();
              setIsPasswordModalOpen(true);
            }}
            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer shrink-0"
          >
            Reset Password
          </button>
        </div>
      </div>

      {/* CHANGE / RESET PASSWORD VIA OTP MODAL */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {passwordStep === 'request' ? 'Request Password Reset OTP' : 'Verify OTP & Reset Password'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsPasswordModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Message Header */}
            {passwordError && (
              <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-xs font-medium text-rose-600 dark:text-rose-400">
                {passwordError}
              </div>
            )}

            {/* STEP 1: REQUEST OTP */}
            {passwordStep === 'request' && (
              <form onSubmit={handleSendResetOtp} className="p-6 space-y-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  We will send a 6-digit verification code to your registered admin email address.
                </p>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Admin Email Address
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      required
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 pl-10 pr-4 py-3 text-xs font-medium bg-slate-50/50 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      placeholder="admin@example.com"
                    />
                    <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>

                <div className="pt-4 flex items-center justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setIsPasswordModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={changingPassword}
                    className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold tracking-wide shadow-md shadow-blue-500/20 transition-all cursor-pointer disabled:opacity-50 flex items-center space-x-2"
                  >
                    {changingPassword ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Sending Code...</span>
                      </>
                    ) : (
                      <span>Send Verification Code</span>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* STEP 2: VERIFY OTP & UPDATE PASSWORD */}
            {passwordStep === 'verify' && (
              <form onSubmit={handleResetPasswordWithOtp} className="p-6 space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <span>Code sent to: <strong className="text-slate-800 dark:text-slate-200">{resetEmail}</strong></span>
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordStep('request');
                      setPasswordError('');
                    }}
                    className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-semibold"
                  >
                    <ArrowLeft className="w-3 h-3" /> Change Email
                  </button>
                </div>

                {/* 6-Digit Verification Code */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    6-Digit Verification Code
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 pl-10 pr-4 py-3 text-xs font-bold tracking-widest bg-slate-50/50 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      placeholder="123456"
                    />
                    <KeyRound className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>

                {/* New Password */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 pl-4 pr-10 py-3 text-xs font-medium bg-slate-50/50 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      placeholder="••••••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none cursor-pointer"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirm New Password */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 pl-4 pr-10 py-3 text-xs font-medium bg-slate-50/50 dark:bg-slate-950/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      placeholder="••••••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none cursor-pointer"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Modal Actions */}
                <div className="pt-4 flex items-center justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setIsPasswordModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={changingPassword}
                    className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold tracking-wide shadow-md shadow-blue-500/20 transition-all cursor-pointer disabled:opacity-50 flex items-center space-x-2"
                  >
                    {changingPassword ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Updating Password...</span>
                      </>
                    ) : (
                      <span>Reset & Save Password</span>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}