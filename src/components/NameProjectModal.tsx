"use client";
import React, { useEffect, useRef, useState } from 'react';
import Portal from './Portal';

type NameProjectModalProps = {
  open: boolean;
  defaultCustomerName: string;
  defaultBuildingName: string;
  onCancel: () => void;
  onConfirm: (customerName: string, buildingName: string) => void;
  isSaving?: boolean;
};

export default function NameProjectModal({ open, defaultCustomerName, defaultBuildingName, onCancel, onConfirm, isSaving }: NameProjectModalProps) {
  const [customerName, setCustomerName] = useState<string>(defaultCustomerName || '');
  const [buildingName, setBuildingName] = useState<string>(defaultBuildingName || '');
  const customerInputRef = useRef<HTMLInputElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [backdropArmed, setBackdropArmed] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (open) {
      setCustomerName(defaultCustomerName || '');
      setBuildingName(defaultBuildingName || '');
      setBackdropArmed(false);
      setTimeout(() => customerInputRef.current?.focus(), 50);
      // Arm backdrop after small delay to avoid instant close from previous click
      const t = setTimeout(() => setBackdropArmed(true), 300);
      return () => clearTimeout(t);
    }
  }, [open, defaultCustomerName, defaultBuildingName]);

  if (!open) return null;

  const modal = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483647, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={() => { if (backdropArmed) onCancel(); }} />
      <div className="relative w-full max-w-md rounded-lg bg-white shadow-xl p-5" style={{ zIndex: 2147483647 }} onClick={(e)=>e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Customer and Building</h2>
        <div className="space-y-3">
        <input
          ref={customerInputRef}
          type="text"
          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={customerName}
          placeholder="Customer name"
          onChange={(e) => setCustomerName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (customerName.trim() && buildingName.trim()) onConfirm(customerName.trim(), buildingName.trim());
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          disabled={isSaving}
        />
        <input
          type="text"
          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={buildingName}
          placeholder="Building name"
          onChange={(e) => setBuildingName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (customerName.trim() && buildingName.trim()) onConfirm(customerName.trim(), buildingName.trim());
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          disabled={isSaving}
        />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-800"
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            className={`px-4 py-2 rounded-md text-white ${isSaving ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'}`}
            onClick={() => customerName.trim() && buildingName.trim() && onConfirm(customerName.trim(), buildingName.trim())}
            disabled={isSaving || !customerName.trim() || !buildingName.trim()}
          >
            {isSaving ? 'Saving…' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );

  return mounted ? <Portal>{modal}</Portal> : null;
}
