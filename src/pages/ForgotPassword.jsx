import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Loader2, 
  AlertCircle, 
  ArrowLeft, 
  ArrowRight, 
  CheckCircle2, 
  KeyRound, 
  Mail, 
  ShieldCheck,
  Eye,
  EyeOff
} from "lucide-react";
import { useDocumentTitle } from '../hooks/useDocumentTitle';

// Same pattern used everywhere else in this app (see Settings.jsx) — call the
// Railway backend directly instead of a relative '/api/...' path. A relative
// path resolves against whatever domain the page is served from, which on
// Vercel is the Vercel domain itself, not the backend. Since vercel.json
// rewrites every unmatched path to index.html, those calls never reach the
// real API — this was the actual cause of the 404 / connection errors.
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'https://alertu-server-production.up.railway.app';

// Safely extract a human-readable error message regardless of whether the
// backend sends a string or an error object (prevents "[object Object]").
const extractErrorMessage = (data, fallback) => {
  const raw = data?.message ?? data?.error ?? fallback;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    return raw.message || raw.error || JSON.stringify(raw);
  }
  return fallback;
};

export default function ForgotPassword({ onBackToLogin }) {
  // 🏷️ Dynamic Document Title
  useDocumentTitle('Forgot Password – AlertU');

  // Step 1: Send OTP, Step 2: Verify & Reset, Step 3: Success
  const [step, setStep] = useState(1);

  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Password Visibility Toggles
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');

  // Resend Timer State
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Safely parse JSON or text error responses
  const parseResponse = async (response) => {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }
    const rawText = await response.text();
    return { error: rawText || `Server error (${response.status})` };
  };

  // Helper fetch wrapper that automatically retries if Render server is waking up (502/503/504)
  const fetchWithAutoRetry = async (url, options, maxRetries = 3) => {
    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      try {
        const response = await fetch(url, options);
        if ([502, 503, 504].includes(response.status)) {
          if (attempt < maxRetries) {
            setLoadingStatus(`Waking up server (Attempt ${attempt}/${maxRetries-1})...`);
            await new Promise((resolve) => setTimeout(resolve, 4000)); // wait 4 seconds
            continue;
          }
          throw new Error('Backend server is starting up. Please wait a few seconds and click submit again.');
        }
        return response;
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        setLoadingStatus(`Retrying connection (${attempt}/${maxRetries-1})...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  };

  // Handle Step 1: Send OTP
  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!email || !email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    setLoading(true);
    setLoadingStatus('Sending code...');

    try {
      const response = await fetchWithAutoRetry(`${API_BASE_URL}/api/auth/send-admin-reset-otp`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await parseResponse(response);

      if (!response.ok || !data.success) {
        throw new Error(extractErrorMessage(data, 'Failed to send verification code.'));
      }

      setSuccessMsg('A 6-digit verification code has been sent to your email.');
      setStep(2);
      setResendCooldown(60); // 60s cooldown
    } catch (err) {
      console.error('Send OTP Error:', err);
      if (err.name === 'TypeError' && err.message.includes('Fetch')) {
        setError('Network error: Unable to reach backend server via proxy.');
      } else {
        setError(err.message || 'Unable to connect to server. Please try again.');
      }
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  };

  // Handle Step 2: Reset Password with OTP
  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!otp || otp.trim().length !== 6) {
      setError('Please enter the full 6-digit verification code.');
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    setLoading(true);
    setLoadingStatus('Updating password...');

    try {
      const response = await fetchWithAutoRetry(`${API_BASE_URL}/api/auth/reset-admin-password`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          email: email.trim(),
          otp: otp.trim(),
          newPassword,
        }),
      });

      const data = await parseResponse(response);

      if (!response.ok || !data.success) {
        throw new Error(extractErrorMessage(data, 'Failed to reset password.'));
      }

      setStep(3);
    } catch (err) {
      console.error('Reset Password Error:', err);
      if (err.name === 'TypeError' && err.message.includes('Fetch')) {
        setError('Network error: Unable to reach backend server via proxy.');
      } else {
        setError(err.message || 'Verification failed. Please try again.');
      }
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  };

  // Resend OTP trigger
  const handleResendOtp = async () => {
    if (resendCooldown > 0 || loading) return;
    setError('');
    setSuccessMsg('');
    setLoading(true);
    setLoadingStatus('Resending code...');

    try {
      const response = await fetchWithAutoRetry(`${API_BASE_URL}/api/auth/send-admin-reset-otp`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await parseResponse(response);

      if (!response.ok || !data.success) {
        throw new Error(extractErrorMessage(data, 'Failed to resend code.'));
      }

      setSuccessMsg('A new verification code has been sent.');
      setResendCooldown(60);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  };

  return (
    <div className="grid min-h-svh lg:grid-cols-2 bg-slate-50/50">
      {/* Left Column: Form Section */}
      <div className="relative flex min-h-svh flex-col justify-center items-center p-6 sm:p-10 lg:p-16">
        
        {/* Header / Brand Logos — Anchored to Top */}
        <div className="absolute top-6 left-6 sm:top-10 sm:left-10 lg:top-12 lg:left-16 flex items-center gap-6 shrink-0">
          <img 
            src="/logo1.png" 
            alt="Logo" 
            className="h-16 sm:h-20 lg:h-24 w-auto object-contain"
          />
          <img 
            src="/AlertU.png" 
            alt="AlertU Logo" 
            className="h-16 sm:h-20 lg:h-24 w-auto object-contain"
          />
        </div>

        {/* Main Form Area — Guaranteed Viewport Centered */}
        <div className="w-full max-w-md mx-auto py-12">
          
          {/* Back to Login Link */}
          <button
            type="button"
            onClick={onBackToLogin}
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors mb-6 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to sign in</span>
          </button>

          {/* STEP 1: REQUEST OTP */}
          {step === 1 && (
            <>
              <div className="space-y-2 text-left mb-8">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700 mb-2">
                  <Mail className="h-5 w-5" />
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                  Forgot password?
                </h1>
                <p className="text-sm text-slate-500">
                  Enter your registered administrator email address and we'll send you a 6-digit verification code.
                </p>
              </div>

              {/* Feedback Alerts */}
              {error && (
                <Alert variant="destructive" className="mb-6 rounded-xl border-red-200 bg-red-50/80 text-red-900">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-xs font-medium leading-relaxed">
                    {error}
                  </AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSendOtp} className="space-y-5">
                <div className="space-y-2">
                  <Label 
                    htmlFor="email" 
                    className="text-xs font-semibold text-slate-700 tracking-wide"
                  >
                    Email address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    disabled={loading}
                    placeholder="admin@alertu.gov"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 rounded-lg border-slate-200 bg-white px-3.5 text-sm transition-all focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold text-sm transition-all shadow-sm hover:shadow active:scale-[0.99]"
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                      <span>{loadingStatus || 'Sending code...'}</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <span>Send Verification Code</span>
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  )}
                </Button>
              </form>
            </>
          )}

          {/* STEP 2: VERIFY OTP & NEW PASSWORD */}
          {step === 2 && (
            <>
              <div className="space-y-2 text-left mb-8">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700 mb-2">
                  <KeyRound className="h-5 w-5" />
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                  Reset password
                </h1>
                <p className="text-sm text-slate-500">
                  Enter the 6-digit code sent to <strong className="text-slate-700">{email}</strong> along with your new password.
                </p>
              </div>

              {/* Success Alert */}
              {successMsg && (
                <Alert className="mb-6 rounded-xl border-emerald-200 bg-emerald-50/80 text-emerald-900">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <AlertDescription className="text-xs font-medium leading-relaxed">
                    {successMsg}
                  </AlertDescription>
                </Alert>
              )}

              {/* Feedback Error Alert */}
              {error && (
                <Alert variant="destructive" className="mb-6 rounded-xl border-red-200 bg-red-50/80 text-red-900">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-xs font-medium leading-relaxed">
                    {error}
                  </AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleResetPassword} className="space-y-4">
                {/* OTP Input */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label 
                      htmlFor="otp" 
                      className="text-xs font-semibold text-slate-700 tracking-wide"
                    >
                      6-Digit Verification Code
                    </Label>
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={resendCooldown > 0 || loading}
                      className="text-xs font-semibold text-blue-700 hover:text-blue-800 disabled:text-slate-400 hover:underline transition-colors cursor-pointer"
                    >
                      {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                    </button>
                  </div>
                  <Input
                    id="otp"
                    type="text"
                    maxLength={6}
                    required
                    disabled={loading}
                    placeholder="123456"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    className="h-11 rounded-lg border-slate-200 bg-white px-3.5 text-center tracking-[0.4em] font-mono font-bold text-base transition-all focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1"
                  />
                </div>

                {/* New Password Input */}
                <div className="space-y-2">
                  <Label 
                    htmlFor="newPassword" 
                    className="text-xs font-semibold text-slate-700 tracking-wide"
                  >
                    New Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNewPassword ? "text" : "password"}
                      required
                      disabled={loading}
                      placeholder="••••••••••••"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="h-11 rounded-lg border-slate-200 bg-white pl-3.5 pr-10 text-sm transition-all focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none"
                      tabIndex="-1"
                    >
                      {showNewPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Confirm New Password Input */}
                <div className="space-y-2">
                  <Label 
                    htmlFor="confirmPassword" 
                    className="text-xs font-semibold text-slate-700 tracking-wide"
                  >
                    Confirm New Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      required
                      disabled={loading}
                      placeholder="••••••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="h-11 rounded-lg border-slate-200 bg-white pl-3.5 pr-10 text-sm transition-all focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none"
                      tabIndex="-1"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold text-sm transition-all shadow-sm hover:shadow active:scale-[0.99] mt-2"
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                      <span>{loadingStatus || 'Updating password...'}</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <span>Reset Password</span>
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                  )}
                </Button>
              </form>
            </>
          )}

          {/* STEP 3: SUCCESS CONFIRMATION */}
          {step === 3 && (
            <div className="text-center space-y-6 py-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-8 w-8" />
              </div>

              <div className="space-y-2">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                  Password reset complete
                </h1>
                <p className="text-sm text-slate-500">
                  Your password has been successfully updated. You can now log into your administrator account using your new password.
                </p>
              </div>

              <Button
                type="button"
                onClick={onBackToLogin}
                className="w-full h-11 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold text-sm transition-all shadow-sm hover:shadow active:scale-[0.99]"
              >
                Return to sign in
              </Button>
            </div>
          )}

        </div>

        {/* Footer info — Anchored to Bottom */}
        <div className="absolute bottom-6 left-6 sm:bottom-8 sm:left-10 lg:left-16 text-xs text-slate-400 text-center sm:text-left shrink-0">
          &copy; {new Date().getFullYear()} AlertU Incident & Risk Management. All rights reserved.
        </div>
      </div>

      {/* Right Column: Hero Visual Panel */}
      <div className="relative hidden lg:flex flex-col justify-end p-12 lg:p-16 overflow-hidden bg-slate-900">
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-85 transition-transform duration-1000 scale-100 hover:scale-105"
          style={{ backgroundImage: "url('/loginimage.jpg')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent" />

        <div className="relative z-10 max-w-lg space-y-4">
          <h2 className="text-4xl xl:text-5xl font-extrabold tracking-tight text-white leading-[1.15] drop-shadow-md">
            Real-time Monitoring & Response Management.
          </h2>
          <p className="text-base text-slate-100 font-medium leading-relaxed drop-shadow">
            Coordinate emergency dispatches, track field reports live, and manage barangay risk operations with secure end-to-end telemetry.
          </p>
        </div>
      </div>
    </div>
  );
}
