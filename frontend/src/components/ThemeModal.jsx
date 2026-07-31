import React from 'react';
import { AlertCircle, CheckCircle2, HelpCircle, X } from 'lucide-react';

export default function ThemeModal({ modalState, onClose }) {
  if (!modalState || !modalState.isOpen) return null;

  const { title, message, type, onConfirm, onCancel, confirmText, cancelText } = modalState;

  const isConfirm = type === 'confirm';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.4)',
        backdropFilter: 'blur(3px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        animation: 'fadeIn 0.2s ease-out'
      }}
      onClick={isConfirm ? onCancel : onClose}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          border: '1px solid #BAE6FD',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 20px 40px rgba(2, 132, 199, 0.18)',
          width: '100%',
          maxWidth: '460px',
          padding: '1.75rem',
          position: 'relative',
          animation: 'slideUp 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem', marginBottom: '1rem' }}>
          <div style={{
            padding: '0.5rem',
            borderRadius: '50%',
            backgroundColor: isConfirm ? '#FEF2F2' : '#F0F9FF',
            color: isConfirm ? '#B91C1C' : '#0284C7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {isConfirm ? <HelpCircle size={24} /> : <CheckCircle2 size={24} />}
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontFamily: 'Crete Round', fontSize: '1.15rem', color: '#0F172A', fontWeight: 600 }}>
              {title || (isConfirm ? 'Confirmation Required' : 'Notification')}
            </h3>
          </div>
          <button
            onClick={isConfirm ? onCancel : onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '0.25rem',
              borderRadius: '4px'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Message */}
        <div style={{
          fontSize: '0.9rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          marginBottom: '1.75rem',
          whiteSpace: 'pre-wrap'
        }}>
          {message}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          {isConfirm && (
            <button
              className="btn btn-secondary"
              onClick={onCancel}
              style={{ padding: '0.55rem 1.1rem', fontSize: '0.85rem' }}
            >
              {cancelText || 'Cancel'}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={isConfirm ? onConfirm : onClose}
            style={{ padding: '0.55rem 1.25rem', fontSize: '0.85rem' }}
          >
            {confirmText || (isConfirm ? 'Confirm Action' : 'OK')}
          </button>
        </div>
      </div>
    </div>
  );
}
