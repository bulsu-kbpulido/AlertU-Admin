import { db } from '@/firebase';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';

/**
 * Generates an incremental VRID (e.g. VRID00000001) and updates verified data in Firestore.
 */
export async function finalizeAndSaveVerifiedReport(reportDocId, verificationData) {
  if (!reportDocId) throw new Error("Document ID is required.");

  // 1. Point to the correct counter document used across your app
  const counterRef = doc(db, 'counters', 'verified_reports_counter');
  
  // 2. Fix collection name from 'incident_reports' -> 'reports'
  const reportRef = doc(db, 'reports', reportDocId);

  return await runTransaction(db, async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    let currentCount = 0;

    if (counterDoc.exists()) {
      currentCount = counterDoc.data().current || counterDoc.data().currentCount || 0;
    }

    const nextCount = currentCount + 1;
    const formattedVRID = `VRID${String(nextCount).padStart(8, '0')}`;

    // Update counter
    transaction.set(counterRef, { current: nextCount, currentCount: nextCount }, { merge: true });

    // Update report in 'reports' collection
    transaction.update(reportRef, {
      verifiedReportId: formattedVRID,
      verifiedreportID: formattedVRID,
      status: 'verified',
      reportTitle: verificationData.title || verificationData.reportTitle,
      selectedAgencies: verificationData.agencies || verificationData.selectedAgencies || [],
      adminNotes: verificationData.adminNotes || '',
      spatialData: verificationData.spatialData || {},
      verifiedAt: serverTimestamp(),
      verifiedBy: verificationData.adminName || 'Admin'
    });

    return formattedVRID;
  });
}