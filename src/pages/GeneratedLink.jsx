import React, { useState, useEffect } from 'react';
import { 
  X, 
  Copy, 
  Check, 
  Link2, 
  Loader2, 
  Radio, 
  Globe, 
  ShieldCheck, 
  ExternalLink 
} from 'lucide-react';
import { getAuth } from 'firebase/auth';
import { useAuditLog } from '../useAuditLog'; // Adjust import path if needed

/**
 * GeneratedLink Modal Component
 * Shows the created link, lets the user copy it, and logs audit movements 
 * for link generation and copying.
 */
export default function GeneratedLink({ 
  isOpen, 
  onClose, 
  report, 
  target, 
  adminId = 'ADMIN-004', 
  adminName = 'System Admin' 
}) {
  const [shortLink, setShortLink] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Initialize Audit Logging Hook
  const { logGenerateSharedLink, logCopySharedLink } = useAuditLog({
    adminId,
    adminName,
  });

  useEffect(() => {
    if (isOpen && report && target) {
      generateSecureLink();
    }
  }, [isOpen, report, target]);

  // Close the popup when pressing the Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const generateSecureLink = async () => {
    setIsLoading(true);
    try {
      const incidentId = report.firestoreDocId || report.id || report.incidentId || report.reportID || report.reportId || report.verifiedReportId || report.verifiedreportID;
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (!user) {
        throw new Error("Your login session expired. Please log in again.");
      }
      
      const token = await user.getIdToken(true); 
  
      // Use the same-origin Vercel path in production. Vercel rewrites
      // /api/* to Railway, while Vite proxies /api/* during local development.
      const response = await fetch('/api/links/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          incidentId,
          target,
          incidentType: report.incidentType || report.type
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Could not create the link.');
      }

      if (!result.linkKey) {
        throw new Error('The server did not return a link key.');
      }

      // Vite config controls development proxying; it does not provide the
      // public production URL. Keep the deployed Vercel origin explicit.
      const frontendOrigin = (
        import.meta.env.VITE_PUBLIC_APP_URL ||
        'https://alert-u-admin.vercel.app'
      ).replace(/\/+$/, '');
      const pathSegment = target === 'citizen' ? 'report/public' : 'report';
      const customizedSecureLink = `${frontendOrigin}/${pathSegment}/${encodeURIComponent(result.linkKey)}`;

      setShortLink(customizedSecureLink);

      // 🚨 Audit Log Movement: Record link generation
      await logGenerateSharedLink(report, {
        target: target,
        secureLink: customizedSecureLink,
        linkKey: result.linkKey || result.key || 'N/A',
        expiresAt: result.expiresAt || null,
      });
      
    } catch (err) {
      console.error(err);
      alert(err.message || "Something went wrong while creating the link.");
      setShortLink("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!shortLink) return;
    navigator.clipboard.writeText(shortLink);
    setIsCopied(true);

    // 🚨 Audit Log Movement: Record copying link to clipboard
    const incidentId = report.firestoreDocId || report.id || report.incidentId || report.reportID || report.reportId || report.verifiedReportId || report.verifiedreportID;
    logCopySharedLink(shortLink, target, incidentId);

    setTimeout(() => setIsCopied(false), 2000);
  };

  if (!isOpen || !report) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm font-sans text-slate-800 antialiased transition-opacity duration-300"
      onClick={onClose}
    >
      {/* Modal Container */}
      <div 
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden transform transition-all duration-300 scale-100 animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Decorative Top Color Bar */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500" />

        {/* Header Section */}
        <header className="px-6 py-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg border ${
              target === 'citizen' 
                ? 'bg-blue-50 border-blue-100 text-blue-600' 
                : 'bg-emerald-50 border-emerald-100 text-emerald-600'
            }`}>
              {target === 'citizen' ? <Globe className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
            </div>
            <div>
              <span className={`block text-[11px] font-bold uppercase tracking-wider ${
                target === 'citizen' ? 'text-blue-600' : 'text-emerald-600'
              }`}>
                {target === 'citizen' ? 'Public View Link' : 'Internal Team Link'}
              </span>
              <h3 className="text-base font-bold text-slate-900 tracking-tight mt-0.5">
                Link is Ready
              </h3>
            </div>
          </div>

          <button 
            onClick={onClose} 
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all shadow-sm active:scale-95"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Main Body Content */}
        <div className="p-6 space-y-5 bg-white">
          <p className="text-xs text-slate-500 font-medium leading-relaxed">
            {target === 'citizen' 
              ? 'This link is safe for the public. All private team notes, secret locations, and personal staff details have been hidden.' 
              : 'This link is for internal team members only. It includes full map coordinates, private logs, and agency files.'}
          </p>

          {/* Link Input and Buttons */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide block">
              Shareable Web Link
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 flex items-center">
                <div className="absolute left-3.5 text-slate-400 pointer-events-none">
                  <Link2 className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  readOnly
                  value={isLoading ? 'Creating your link now...' : shortLink}
                  className="w-full bg-slate-50 border border-slate-200 text-xs font-mono text-slate-600 pl-10 pr-4 py-2.5 rounded-lg select-all focus:outline-none focus:border-slate-300"
                />
              </div>

              {/* Utility Buttons */}
              <div className="flex items-center gap-1 shrink-0">
                <button 
                  onClick={handleCopy}
                  disabled={isLoading || !shortLink}
                  title="Copy link"
                  className="h-9 px-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 rounded-lg transition-all shadow-sm active:scale-95 disabled:opacity-40 flex items-center justify-center"
                >
                  {isCopied ? (
                    <Check className="w-4 h-4 text-emerald-600 stroke-[3]" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                
                {shortLink && (
                  <a
                    href={shortLink}
                    target="_blank"
                    rel="noreferrer"
                    title="Open link preview"
                    className="h-9 px-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 rounded-lg transition-all shadow-sm active:scale-95 flex items-center justify-center"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Status Box */}
          <div className={`p-3.5 rounded-xl border flex items-center gap-3 transition-colors duration-300 ${
            isLoading 
              ? 'bg-amber-50/60 border-amber-100 text-amber-800' 
              : 'bg-emerald-50/50 border-emerald-100 text-emerald-800'
          }`}>
            <div className="relative flex items-center justify-center">
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
              ) : (
                <>
                  <Radio className="w-4 h-4 text-emerald-600 animate-pulse relative z-10" />
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-30 animate-ping" />
                </>
              )}
            </div>
            <p className="text-[11px] font-semibold leading-normal">
              {isLoading 
                ? 'Connecting to the database...' 
                : `The link is active and properly restricted for ${target === 'citizen' ? 'citizens' : 'department staff'}.`}
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <footer className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button 
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg shadow-md hover:shadow-lg transition-all active:scale-95"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
