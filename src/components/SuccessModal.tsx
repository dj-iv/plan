"use client";

import React, { useEffect, useState } from 'react';
import Portal from './Portal';

type SuccessModalProps = {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
};

export default function SuccessModal({ open, title, message, onClose }: SuccessModalProps) {
  const [mounted, setMounted] = useState(false);
  const [backdropArmed, setBackdropArmed] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setBackdropArmed(false);
      return;
    }

    const armTimer = window.setTimeout(() => setBackdropArmed(true), 150);
    return () => window.clearTimeout(armTimer);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const modal = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483647, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.48)' }} onClick={() => { if (backdropArmed) onClose(); }} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl" style={{ zIndex: 2147483647 }} onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-emerald-100 px-6 py-5">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6" aria-hidden="true">
              <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.414l-7.02 7.02a1 1 0 01-1.414 0L5.296 10.75a1 1 0 011.414-1.414l2.267 2.266 6.313-6.312a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
          <h2 className="mt-4 text-xl font-semibold text-slate-900">{title}</h2>
          <p className="mt-2 text-sm text-slate-600">{message}</p>
        </div>

        <div className="flex items-center justify-end px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );

  return mounted ? <Portal>{modal}</Portal> : null;
}