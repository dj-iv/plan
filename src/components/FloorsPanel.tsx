import React, { useState, useCallback, useMemo, useEffect } from 'react';
import Image from 'next/image';
import { FloorSummary, Units } from '@/types/project';
import { FloorNameAiStatus } from '@/types/ai';

interface FloorsPanelProps {
  floors: FloorSummary[];
  currentFloorId: string | null;
  onSelectFloor: (floorId: string) => void;
  onRenameFloor: (floorId: string, name: string, isManual?: boolean) => void;
  onDeleteFloor: (floorId: string) => void;
  onAddFloor: () => void;
  isLoading?: boolean;
  formatAreaValue?: (areaSqMeters: number, preferredUnit?: Units) => string;
  formatRadiusValue?: (radiusMeters?: number | null, preferredUnit?: Units) => string;
  className?: string;
  onDetectFloorName?: (floorId: string) => void;
  aiNameStatus?: Record<string, FloorNameAiStatus>;
}

export default function FloorsPanel({
  floors,
  currentFloorId,
  onSelectFloor,
  onRenameFloor,
  onDeleteFloor,
  onAddFloor,
  isLoading = false,
  formatAreaValue,
  formatRadiusValue,
  className = '',
  onDetectFloorName,
  aiNameStatus,
}: FloorsPanelProps) {
  const [expandedFloorId, setExpandedFloorId] = useState<string | null>(null);
  const [editingFloor, setEditingFloor] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const formatArea = useCallback((areaSqMeters: number, units?: Units) => {
    if (typeof areaSqMeters !== 'number' || Number.isNaN(areaSqMeters)) {
      return '—';
    }
    if (formatAreaValue) {
      return formatAreaValue(areaSqMeters, units);
    }

    const unitKey = (units || 'meters') as Units;
    const { value, label } = (() => {
      switch (unitKey) {
        case 'feet':
          return { value: areaSqMeters * 10.7639104167, label: 'ft²' };
        case 'cm':
          return { value: areaSqMeters * 10000, label: 'cm²' };
        case 'mm':
          return { value: areaSqMeters * 1_000_000, label: 'mm²' };
        default:
          return { value: areaSqMeters, label: 'm²' };
      }
    })();
    const magnitude = Math.abs(value);
    const precision = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2;
    return `${value.toFixed(precision)} ${label}`;
  }, [formatAreaValue]);

  const formatRadius = useCallback((radiusMeters?: number | null, units?: Units) => {
    if (typeof radiusMeters !== 'number' || Number.isNaN(radiusMeters) || radiusMeters <= 0) {
      return '—';
    }

    if (formatRadiusValue) {
      return formatRadiusValue(radiusMeters, units);
    }

    const unitKey = (units || 'meters') as Units;
    const { value, label } = (() => {
      switch (unitKey) {
        case 'feet':
          return { value: radiusMeters * 3.28084, label: 'ft' };
        case 'cm':
          return { value: radiusMeters * 100, label: 'cm' };
        case 'mm':
          return { value: radiusMeters * 1000, label: 'mm' };
        default:
          return { value: radiusMeters, label: 'm' };
      }
    })();
    const magnitude = Math.abs(value);
    const precision = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2;
    return `${value.toFixed(precision)} ${label}`;
  }, [formatRadiusValue]);

  useEffect(() => {
    if (currentFloorId) {
      setExpandedFloorId(currentFloorId);
    } else if (floors.length > 0) {
      setExpandedFloorId(floors[0].id);
    }
  }, [currentFloorId, floors]);

  const startEditing = useCallback((floor: FloorSummary) => {
    setEditingFloor(floor.id);
    setEditValue(floor.name);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingFloor(null);
    setEditValue('');
  }, []);

  const saveEdit = useCallback(() => {
    if (editingFloor && editValue.trim()) {
      onRenameFloor(editingFloor, editValue.trim(), true);
    }
    setEditingFloor(null);
    setEditValue('');
  }, [editingFloor, editValue, onRenameFloor]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  }, [saveEdit, cancelEditing]);

  const totals = useMemo(() => {
    return floors.reduce(
      (acc, floor) => {
        const area = typeof floor.totalArea === 'number' ? floor.totalArea : 0;
        return {
          totalArea: acc.totalArea + area,
          totalAntennas: acc.totalAntennas + (floor.antennaCount || 0),
        };
      },
      { totalArea: 0, totalAntennas: 0 }
    );
  }, [floors]);

  if (isLoading) {
    return (
      <div className={`${className}`}>
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded mb-2"></div>
          <div className="space-y-2">
            <div className="h-16 bg-gray-100 rounded"></div>
            <div className="h-16 bg-gray-100 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${className}`}>
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Floors</h3>
          <button
            onClick={onAddFloor}
            className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded-md transition-colors"
            type="button"
          >
            + Add Floor
          </button>
        </div>
        
        {floors.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-sm">Upload an image to start creating floors</p>
          </div>
        ) : (
          <div className="space-y-3">
            {floors.map((floor) => {
              const isExpanded = expandedFloorId === floor.id;
              const isCurrent = floor.id === currentFloorId;
              const isEditing = editingFloor === floor.id;
              const aiStatus = aiNameStatus?.[floor.id];
              const aiLoading = aiStatus?.status === 'loading';
              const aiError = aiStatus?.status === 'error' ? aiStatus.error || aiStatus.reason : null;
              const aiSuccess = aiStatus?.status === 'success';

              const areaLabel = formatArea(floor.totalArea || 0, floor.units);
              const areaSummaries = floor.areaSummaries || [];
              const radiusLabel = formatRadius(floor.antennaRange, floor.units);

              const handleCardClick = () => {
                onSelectFloor(floor.id);
                setExpandedFloorId(floor.id);
              };

              return (
                <div
                  key={floor.id}
                  className={`border rounded-lg transition-all cursor-pointer ${
                    isCurrent ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-gray-200 bg-white hover:border-blue-300'
                  }`}
                  onClick={handleCardClick}
                >
                  {/* Floor Header */}
                  <div className="p-3">
                    <div className="flex items-center gap-3">
                      {/* Thumbnail */}
                      <div className="relative w-12 h-12 bg-gray-100 rounded border overflow-hidden flex-shrink-0">
                        {floor.thumbnailUrl ? (
                          <Image
                            fill
                            src={floor.thumbnailUrl}
                            alt={floor.name}
                            sizes="48px"
                            className="object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                            No Image
                          </div>
                        )}
                      </div>

                      {/* Floor Info */}
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={saveEdit}
                            onKeyDown={handleKeyDown}
                            className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            autoFocus
                          />
                        ) : (
                          <div className="text-left w-full">
                            <div className={`font-medium truncate ${isCurrent ? 'text-blue-700' : 'text-gray-900'}`}>
                              {floor.name}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              Updated {floor.updatedAt.toLocaleDateString()}
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-600">
                          <span className="font-medium text-gray-900">{areaLabel}</span>
                          <span>{floor.areaCount || 0} areas</span>
                          <span>{floor.antennaCount || 0} antennas</span>
                          <span>Radius {radiusLabel}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {onDetectFloorName && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDetectFloorName(floor.id);
                            }}
                            className={`p-1 rounded text-indigo-500 hover:text-indigo-600 hover:bg-indigo-50 ${aiLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
                            title={aiLoading ? 'Detecting floor name...' : 'Retry AI floor naming'}
                            disabled={aiLoading}
                          >
                            <span className="text-[10px] font-semibold tracking-wide">AI</span>
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditing(floor);
                          }}
                          className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
                          title="Rename floor"
                        >
                          <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
                          </svg>
                        </button>
                        
                        {floors.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Delete floor "${floor.name}"?`)) {
                                onDeleteFloor(floor.id);
                              }
                            }}
                            className="p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-600"
                            title="Delete floor"
                          >
                            <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        {aiStatus && (
                          <div className="mb-2 text-xs">
                            {aiLoading && (
                              <span className="text-indigo-600">Detecting floor name...</span>
                            )}
                            {aiSuccess && aiStatus.suggestedName && (
                              <span className="text-emerald-600">AI suggestion: <span className="font-semibold">{aiStatus.suggestedName}</span>{typeof aiStatus.confidence === 'number' ? ` (${Math.round(aiStatus.confidence * 100)}% sure)` : ''}</span>
                            )}
                            {aiError && (
                              <span className="text-rose-600">AI hint: {aiError}</span>
                            )}
                          </div>
                        )}
                        <div className="text-xs text-gray-600 space-y-2">
                          <div className="font-semibold text-gray-700">Areas</div>
                          {areaSummaries.length === 0 ? (
                            <div className="text-gray-400">No saved areas yet</div>
                          ) : (
                            <ul className="space-y-1">
                              {areaSummaries.map((entry) => (
                                <li key={entry.id} className="flex items-center justify-between gap-3">
                                  <span className={`truncate ${entry.area < 0 ? 'text-red-600' : ''}`}>
                                    {entry.label || (entry.area < 0 ? 'Exclusion' : 'Area')}
                                  </span>
                                  <span className={`font-medium ${entry.area < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                                    {formatArea(entry.area, floor.units)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}

                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Totals */}
        {floors.length > 0 && (
          <div className="mt-4 p-3 bg-gradient-to-r from-blue-500 to-orange-500 rounded-lg text-white shadow">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">Total ({floors.length} floors)</h4>
              <div className="text-right">
                <div className="text-sm opacity-90">{totals.totalAntennas} antennas overall</div>
                <div className="text-lg font-bold">{formatArea(totals.totalArea)}</div>
                {!formatAreaValue && (
                  <div className="text-xs opacity-90">(aggregated in square metres)</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}