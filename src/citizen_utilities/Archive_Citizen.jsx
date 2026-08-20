import React, { useState } from 'react';
import { fetchFromBackend } from '../api';
import { socket } from '../socket';
import { useCitizenStore } from '../citizen_utilities/useCitizenStore';
import { FolderArchive, RotateCcw, Trash2, Loader2, AlertTriangle } from 'lucide-react';

const Archive_Citizen = ({ isOpen, onClose, citizen, onRefresh }) => {
  const [loading, setLoading] = useState(false);
  const [actionType, setActionType] = useState(null); // 'archive' | 'restore' | 'delete'
  const [error, setError] = useState(null);

  // Zustand Store Hook for state tracking
  const setAccountDisabledState = useCitizenStore((state) => state.setAccountDisabledState);

  if (!isOpen || !citizen) return null;

  // Resolve consistent citizen ID key and archived status
  const citizenId = citizen.id || citizen.citizenID || citizen.cid || citizen._id;
  const isCurrentlyArchived = Boolean(citizen.isArchived || citizen.archivedAt || citizen.originalCollection);

  // Shared completion helper
  const handleArchiveSuccess = () => {
    if (onRefresh) onRefresh();
    onClose();
  };

  // Helper function to emit socket audit events to backend safely
  const logAdminActionToSocket = (action, details) => {
    try {
      if (socket?.connected) {
        socket.emit('admin_citizen_audit_log', {
          action,
          targetCitizenId: citizenId,
          targetName: citizen.fullName || 'Unnamed Record',
          timestamp: new Date().toISOString(),
          ...details,
        });
      }
    } catch (err) {
      console.warn('Socket audit logging skipped:', err.message);
    }
  };

  // 1. ARCHIVE ACTION
  const handleArchive = async () => {
    setLoading(true);
    setActionType('archive');
    setError(null);

    try {
      await fetchFromBackend(`/citizens/${citizenId}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionTag: `ADMIN_ARCHIVE_${citizenId}`,
          archivedAt: new Date().toISOString(),
        }),
      });

      if (citizen.authUid) {
        setAccountDisabledState(citizen.authUid, true);
      }

      logAdminActionToSocket('ARCHIVE_CITIZEN', {
        destinationCollection: 'archived_citizens',
        status: 'SUCCESS',
      });

      handleArchiveSuccess();
    } catch (err) {
      console.error('Archive failed:', err);
      setError(err.message || 'Failed to archive citizen record.');
    } finally {
      setLoading(false);
      setActionType(null);
    }
  };

  // 2. RESTORE ACTION
  const handleRestore = async () => {
    setLoading(true);
    setActionType('restore');
    setError(null);

    try {
      const response = await fetchFromBackend(`/citizens/${citizenId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionTag: `ADMIN_RESTORE_${citizenId}`,
        }),
      });

      if (citizen.authUid) {
        setAccountDisabledState(citizen.authUid, response?.isDisabled ?? false);
      }

      logAdminActionToSocket('RESTORE_CITIZEN', {
        targetCollection: response?.targetCollection || 'admin_citizens',
        status: 'SUCCESS',
      });

      handleArchiveSuccess();
    } catch (err) {
      console.error('Restore failed:', err);
      setError(err.message || 'Failed to restore citizen record.');
    } finally {
      setLoading(false);
      setActionType(null);
    }
  };

  // 3. PERMANENT DELETE ACTION
  const handleDelete = async () => {
    const targetName = citizen.fullName || 'this citizen';
    if (!window.confirm(`Are you absolutely sure you want to permanently delete ${targetName}? This action cannot be undone.`)) {
      return;
    }

    setLoading(true);
    setActionType('delete');
    setError(null);

    try {
      await fetchFromBackend(`/citizens/${citizenId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionTag: `ADMIN_DELETE_PERMANENT_${citizenId}`,
        }),
      });

      logAdminActionToSocket('PERMANENT_DELETE_CITIZEN', {
        deletedFromAuth: Boolean(citizen.authUid),
        status: 'SUCCESS',
      });

      handleArchiveSuccess();
    } catch (err) {
      console.error('Delete failed:', err);
      setError(err.message || 'Failed to delete citizen record.');
    } finally {
      setLoading(false);
      setActionType(null);
    }
  };

  return (
    <div 
      style={styles.overlay} 
      onClick={onClose} 
      role="dialog" 
      aria-modal="true"
      aria-labelledby="archive-modal-title"
    >
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <header style={styles.header}>
          <div style={styles.warningIcon}>
            {isCurrentlyArchived ? (
              <FolderArchive className="h-12 w-12 text-amber-500 inline-block" />
            ) : (
              <AlertTriangle className="h-12 w-12 text-amber-500 inline-block" />
            )}
          </div>
          <h3 id="archive-modal-title" style={styles.title}>
            {isCurrentlyArchived ? 'Archived Citizen Record' : 'Archive Citizen Record'}
          </h3>
        </header>

        <main style={styles.body}>
          <p style={styles.text}>
            Target Record: <strong>{citizen.fullName || citizen.email || citizenId}</strong>
          </p>
          <p style={styles.subtext}>
            {isCurrentlyArchived
              ? 'This citizen record is stored in the Archive Vault. You can restore access to the active directory or permanently delete it from Firestore and Firebase Authentication.'
              : 'The record will be moved to the Archive Vault and its active session will be disabled. All underlying data will be preserved for potential restoration.'}
          </p>
          {error && <div style={styles.error}>{error}</div>}
        </main>

        <footer style={styles.footer}>
          <button 
            onClick={onClose} 
            style={{ ...styles.cancelBtn, ...(loading ? styles.disabledBtn : {}) }} 
            disabled={loading}
          >
            Cancel
          </button>

          {isCurrentlyArchived ? (
            <>
              {/* RESTORE BUTTON */}
              <button 
                onClick={handleRestore} 
                style={{ ...styles.restoreBtn, ...(loading ? styles.disabledBtn : {}) }} 
                disabled={loading}
              >
                {loading && actionType === 'restore' ? (
                  <Loader2 className="h-4 w-4 animate-spin inline-block" />
                ) : (
                  <RotateCcw className="h-4 w-4 inline-block" />
                )}
                Restore
              </button>

              {/* PERMANENT DELETE BUTTON */}
              <button 
                onClick={handleDelete} 
                style={{ ...styles.deleteBtn, ...(loading ? styles.disabledBtn : {}) }} 
                disabled={loading}
              >
                {loading && actionType === 'delete' ? (
                  <Loader2 className="h-4 w-4 animate-spin inline-block" />
                ) : (
                  <Trash2 className="h-4 w-4 inline-block" />
                )}
                Delete Permanently
              </button>
            </>
          ) : (
            /* CONFIRM ARCHIVE BUTTON */
            <button 
              onClick={handleArchive} 
              style={{ ...styles.archiveBtn, ...(loading ? styles.disabledBtn : {}) }} 
              disabled={loading}
            >
              {loading && actionType === 'archive' ? (
                <Loader2 className="h-4 w-4 animate-spin inline-block" />
              ) : (
                <FolderArchive className="h-4 w-4 inline-block" />
              )}
              {loading && actionType === 'archive' ? 'Archiving...' : 'Confirm Archive'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1100,
    padding: '20px',
  },
  dialog: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '460px',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    overflow: 'hidden',
    textAlign: 'center',
  },
  header: { padding: '24px 24px 0 24px' },
  warningIcon: { marginBottom: '12px' },
  title: { margin: 0, fontSize: '1.25rem', color: '#0f172a', fontWeight: '700' },
  body: { padding: '16px 24px' },
  text: { margin: '0 0 8px 0', color: '#334155', fontSize: '0.95rem' },
  subtext: { margin: 0, color: '#64748b', fontSize: '0.875rem', lineHeight: '1.5' },
  error: {
    marginTop: '12px',
    padding: '8px',
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: '500',
  },
  footer: {
    padding: '16px 24px',
    display: 'flex',
    gap: '8px',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderTop: '1px solid #e2e8f0',
  },
  cancelBtn: {
    padding: '10px 16px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#fff',
    cursor: 'pointer',
    fontWeight: '600',
    color: '#475569',
    flex: 1,
    fontSize: '0.875rem',
  },
  restoreBtn: {
    padding: '10px 14px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#10b981',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: '600',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    flex: 1,
    fontSize: '0.875rem',
  },
  deleteBtn: {
    padding: '10px 14px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#ef4444',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: '600',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    flex: 1,
    fontSize: '0.875rem',
  },
  archiveBtn: {
    padding: '10px 16px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#3b82f6',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: '600',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    flex: 1,
    fontSize: '0.875rem',
  },
  disabledBtn: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
};

export default Archive_Citizen;