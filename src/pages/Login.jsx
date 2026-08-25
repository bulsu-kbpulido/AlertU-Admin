import { useState } from 'react';
import { auth, db } from '../firebase'; // Update path if necessary
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import useAuditLog from '../useAuditLog'; // Adjust path if needed

// Component Import
import ForgotPassword from './ForgotPassword';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

// shadcn UI components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle, ArrowRight, Eye, EyeOff } from "lucide-react";

export default function Login({ onLoginSuccess }) {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    department: 'barangay',
    rememberMe: false
  });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // New States: Show/Hide Password & View Toggle
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  // 🏷️ Dynamic Document Title
  useDocumentTitle(showForgotPassword ? 'Forgot Password – AlertU' : 'Login – AlertU');

  // Audit Log hook instantiation
  const { logMovement } = useAuditLog();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleCheckboxChange = (checked) => {
    setFormData((prev) => ({
      ...prev,
      rememberMe: checked
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, formData.email, formData.password);
      const user = userCredential.user;

      const idToken = await user.getIdToken();

      const adminDocRef = doc(db, 'admins', user.uid);
      const adminDocSnap = await getDoc(adminDocRef);

      if (adminDocSnap.exists()) {
        const adminData = adminDocSnap.data();
        
        // Log Successful Login Audit Event
        await logMovement({
          action: 'LOGIN_SUCCESS',
          target: user.uid,
          actorId: adminData.adminId || user.uid,
          adminName: adminData.name || adminData.fullName || user.email,
          details: `Admin ${user.email} logged in successfully.`,
          metadata: {
            email: user.email,
            role: adminData.role || 'Admin',
            department: adminData.department || formData.department,
            rememberMe: formData.rememberMe,
            loggedInAt: new Date().toISOString()
          }
        });

        // Update admin last login timestamp in Firestore
        try {
          await updateDoc(adminDocRef, {
            lastLogin: serverTimestamp(),
            lastLoginAt: new Date().toISOString(),
          });
        } catch (updateErr) {
          console.warn('Could not update lastLogin on admin doc:', updateErr);
        }

        if (onLoginSuccess) {
          onLoginSuccess({ ...adminData, token: idToken });
        }
      } else {
        const errorMessage = 'Access denied. Administrator privileges were not detected for this account.';
        setError(errorMessage);

        // Log Failed Login Audit Event (Unauthorized / Missing Admin Privileges)
        await logMovement({
          action: 'LOGIN_FAILED',
          target: user.uid,
          actorId: user.uid,
          adminName: user.email,
          details: `Failed login attempt for ${user.email}: Lack of admin privileges.`,
          metadata: {
            email: user.email,
            reason: 'MISSING_ADMIN_ROLE',
            attemptedAt: new Date().toISOString()
          }
        });

        await auth.signOut();
      }
    } catch (err) {
      console.error(err);

      let failureReason = 'UNKNOWN_ERROR';
      if (
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/wrong-password' ||
        err.code === 'auth/invalid-credential'
      ) {
        failureReason = 'INVALID_CREDENTIALS';
        setError('Invalid email or password combination. Please check your credentials.');
      } else {
        setError('Unable to authenticate at this time. Please try again or contact support.');
      }

      // Log Failed Login Audit Event (Authentication Error)
      await logMovement({
        action: 'LOGIN_FAILED',
        target: formData.email || 'UNKNOWN_USER',
        actorId: 'UNAUTHENTICATED_USER',
        adminName: formData.email || 'Guest User',
        details: `Failed login attempt for email: ${formData.email}`,
        metadata: {
          email: formData.email,
          reason: failureReason,
          errorCode: err.code || 'UNKNOWN_CODE',
          attemptedAt: new Date().toISOString()
        }
      });
    } finally {
      setLoading(false);
    }
  };

  // Render ForgotPassword view if user clicks "Forgot password?"
  if (showForgotPassword) {
    return <ForgotPassword onBackToLogin={() => setShowForgotPassword(false)} />;
  }

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
          <div className="space-y-2 text-left mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Welcome back
            </h1>
            <p className="text-sm text-slate-500">
              Enter your credentials to access the administrative dashboard.
            </p>
          </div>

          {/* Feedback Alert */}
          {error && (
            <Alert variant="destructive" className="mb-6 rounded-xl border-red-200 bg-red-50/80 text-red-900">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-xs font-medium leading-relaxed">
                {error}
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
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
                name="email"
                required
                disabled={loading}
                placeholder="admin@alertu.gov"
                value={formData.email}
                onChange={handleChange}
                className="h-11 rounded-lg border-slate-200 bg-white px-3.5 text-sm transition-all focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1"
              />
            </div>

            <div className="space-y-2">
              <Label 
                htmlFor="password" 
                className="text-xs font-semibold text-slate-700 tracking-wide"
              >
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  required
                  disabled={loading}
                  placeholder="••••••••••••"
                  value={formData.password}
                  onChange={handleChange}
                  className="h-11 rounded-lg border-slate-200 bg-white pl-3.5 pr-10 text-sm transition-all focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  disabled={loading}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Aligned Row: Remember Me & Forgot Password */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="rememberMe"
                  checked={formData.rememberMe}
                  onCheckedChange={handleCheckboxChange}
                  disabled={loading}
                  className="rounded border-slate-300 data-[state=checked]:bg-blue-700 data-[state=checked]:border-blue-700"
                />
                <Label
                  htmlFor="rememberMe"
                  className="text-sm font-normal text-slate-600 select-none cursor-pointer"
                >
                  Remember this device for 30 days
                </Label>
              </div>

              <button 
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="text-xs font-semibold text-blue-700 hover:text-blue-800 hover:underline transition-colors whitespace-nowrap bg-transparent border-0 p-0 cursor-pointer"
              >
                Forgot password?
              </button>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold text-sm transition-all shadow-sm hover:shadow active:scale-[0.99]"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                  <span>Signing in...</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <span>Sign in</span>
                  <ArrowRight className="h-4 w-4" />
                </div>
              )}
            </Button>
          </form>
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