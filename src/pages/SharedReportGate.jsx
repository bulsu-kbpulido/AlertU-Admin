import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PublicReportPage from './publicreportspage';
import PublicReportPage2 from './publicreportspage2';

export default function SharedReportGate() {
  const { id } = useParams();
  const [target, setTarget] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadTarget() {
      if (!id) {
        setError('Missing public link key.');
        return;
      }

      try {
        const response = await fetch(`/api/links/verify/${encodeURIComponent(id)}`, {
          headers: { Accept: 'application/json' },
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.message || 'This link is invalid or expired.');
        }

        if (!cancelled) setTarget(result.decoded?.target || 'citizen');
      } catch (err) {
        if (!cancelled) setError(err.message || 'Unable to verify this shared link.');
      }
    }

    loadTarget();
    return () => { cancelled = true; };
  }, [id]);

  if (error) return <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white p-6"><p>{error}</p></div>;
  if (!target) return <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">Loading report...</div>;

  // Separate pages remain separate; this only chooses the correct one.
  return target === 'citizen' ? <PublicReportPage /> : <PublicReportPage2 />;
}
