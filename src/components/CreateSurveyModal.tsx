"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Portal from './Portal';

export type PortalCustomerOption = {
  id: string;
  name: string;
};

export type CreateSurveyFloorDraft = {
  id: string;
  name: string;
};

export type CreateSurveyModalSubmitPayload = {
  customerId: string | null;
  customerName: string;
  buildingName: string;
  address: string;
  floors: CreateSurveyFloorDraft[];
};

type CreateSurveyModalProps = {
  open: boolean;
  isSubmitting?: boolean;
  isLoadingCustomers?: boolean;
  customers: PortalCustomerOption[];
  defaultCustomerName: string;
  defaultBuildingName: string;
  floors: CreateSurveyFloorDraft[];
  onCancel: () => void;
  onSubmit: (payload: CreateSurveyModalSubmitPayload) => Promise<void> | void;
};

export default function CreateSurveyModal({
  open,
  isSubmitting = false,
  isLoadingCustomers = false,
  customers,
  defaultCustomerName,
  defaultBuildingName,
  floors,
  onCancel,
  onSubmit,
}: CreateSurveyModalProps) {
  const [mounted, setMounted] = useState(false);
  const [backdropArmed, setBackdropArmed] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState('');
  const [buildingName, setBuildingName] = useState('');
  const [address, setAddress] = useState('');
  const [floorDrafts, setFloorDrafts] = useState<CreateSurveyFloorDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const customerInputRef = useRef<HTMLInputElement | null>(null);
  const wasOpenRef = useRef(false);
  const autoMatchedCustomerRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) {
      return;
    }

    wasOpenRef.current = true;
    setSelectedCustomerId('');
    setCustomerName(defaultCustomerName || '');
    setBuildingName(defaultBuildingName || '');
    setAddress('');
    setFloorDrafts(floors.map((floor) => ({ ...floor })));
    setError(null);
    setBackdropArmed(false);
    autoMatchedCustomerRef.current = false;

    const armTimer = window.setTimeout(() => setBackdropArmed(true), 250);
    const focusTimer = window.setTimeout(() => customerInputRef.current?.focus(), 40);

    return () => {
      window.clearTimeout(armTimer);
      window.clearTimeout(focusTimer);
    };
  }, [open, defaultCustomerName, defaultBuildingName, floors]);

  const creatingNewCustomer = selectedCustomerId.length === 0;
  const sortedCustomers = useMemo(
    () => [...customers].sort((left, right) => left.name.localeCompare(right.name)),
    [customers],
  );

  useEffect(() => {
    if (!open || selectedCustomerId.length === 0) {
      return;
    }
    const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);
    if (selectedCustomer) {
      setCustomerName(selectedCustomer.name);
    }
  }, [customers, open, selectedCustomerId]);

  useEffect(() => {
    if (!open || autoMatchedCustomerRef.current || selectedCustomerId.length > 0 || customers.length === 0) {
      return;
    }

    const normalizedCustomerName = customerName.trim().toLocaleLowerCase();
    if (!normalizedCustomerName) {
      autoMatchedCustomerRef.current = true;
      return;
    }

    const matchedCustomer = customers.find(
      (customer) => customer.name.trim().toLocaleLowerCase() === normalizedCustomerName,
    );

    if (matchedCustomer) {
      setSelectedCustomerId(matchedCustomer.id);
      setCustomerName(matchedCustomer.name);
    }

    autoMatchedCustomerRef.current = true;
  }, [customerName, customers, open, selectedCustomerId]);

  const handleFloorNameChange = (floorId: string, nextName: string) => {
    setFloorDrafts((prev) => prev.map((floor) => (
      floor.id === floorId ? { ...floor, name: nextName } : floor
    )));
  };

  const handleSubmit = async () => {
    setError(null);

    const trimmedCustomerName = customerName.trim();
    const trimmedBuildingName = buildingName.trim();
    const trimmedAddress = address.trim();
    const trimmedFloors = floorDrafts.map((floor) => ({
      ...floor,
      name: floor.name.trim(),
    }));

    if (creatingNewCustomer && !trimmedCustomerName) {
      setError('Customer name is required when no existing customer is selected.');
      return;
    }
    if (!trimmedBuildingName) {
      setError('Building name is required.');
      return;
    }
    if (!trimmedAddress) {
      setError('Building address is required.');
      return;
    }
    if (trimmedFloors.some((floor) => floor.name.length === 0)) {
      setError('Every floor needs a name before creating the building in the Survey Portal.');
      return;
    }

    try {
      await onSubmit({
        customerId: creatingNewCustomer ? null : selectedCustomerId,
        customerName: trimmedCustomerName,
        buildingName: trimmedBuildingName,
        address: trimmedAddress,
        floors: trimmedFloors,
      });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to create the Survey Portal building.';
      setError(message);
    }
  };

  if (!open) {
    return null;
  }

  const modal = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483647, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.48)' }} onClick={() => { if (backdropArmed && !isSubmitting) onCancel(); }} />
      <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-2xl" style={{ zIndex: 2147483647 }} onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-xl font-semibold text-slate-900">Create Survey Portal Building</h2>
          <p className="mt-1 text-sm text-slate-600">
            This creates the customer, building, floors, and uploaded floorplans in the Survey Portal. Surveys are added later from the app.
          </p>
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-6 py-5 space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Existing customer
              <select
                value={selectedCustomerId}
                onChange={(event) => setSelectedCustomerId(event.target.value)}
                disabled={isSubmitting || isLoadingCustomers}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Create new customer</option>
                {sortedCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name}</option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-slate-500">
                {isLoadingCustomers ? 'Loading portal customers…' : 'Choose an existing customer or leave this on "Create new customer".'}
              </span>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Customer name
              <input
                ref={customerInputRef}
                type="text"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                disabled={isSubmitting || !creatingNewCustomer}
                placeholder="e.g. Acme Corporation"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
              />
              <span className="mt-1 block text-xs text-slate-500">
                {creatingNewCustomer ? 'This will create a new customer in the Survey Portal.' : 'Customer name comes from the selected existing customer.'}
              </span>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Building name
              <input
                type="text"
                value={buildingName}
                onChange={(event) => setBuildingName(event.target.value)}
                disabled={isSubmitting}
                placeholder="e.g. HQ Building"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className="block text-sm font-medium text-slate-700 md:col-span-2">
              Building address
              <textarea
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                disabled={isSubmitting}
                rows={3}
                placeholder="Enter the building address"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Floors</h3>
              <span className="text-xs text-slate-500">Adjust any floor names before export.</span>
            </div>
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              {floorDrafts.map((floor, index) => (
                <label key={floor.id} className="block text-sm font-medium text-slate-700">
                  Floor {index + 1}
                  <input
                    type="text"
                    value={floor.name}
                    onChange={(event) => handleFloorNameChange(floor.id, event.target.value)}
                    disabled={isSubmitting}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void handleSubmit(); }}
            disabled={isSubmitting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
          >
            {isSubmitting ? 'Creating…' : 'Create In Survey Portal'}
          </button>
        </div>
      </div>
    </div>
  );

  return mounted ? <Portal>{modal}</Portal> : null;
}