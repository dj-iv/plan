'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import ProcessingMessage from './ProcessingMessage';
import PdfConversionHelper from './PdfConversionHelper';
import { extractPdfPages, type PdfExtractionResult, type PdfPageClassification } from '../utils/pdfFloorExtractor';

export type ReadyFloorInfo = {
  file: File;
  previewUrl?: string;
  name: string;
  sourcePageWidthMm?: number | null;
  sourcePageHeightMm?: number | null;
  sourcePageWidthPoints?: number | null;
  sourcePageHeightPoints?: number | null;
  sourceRenderScale?: number | null;
  sourcePlanType?: 'pdf' | 'image' | 'bitmap';
};

interface FileUploadProps {
  onFilesReady: (files: ReadyFloorInfo[]) => void;
  disabled?: boolean;
}

type PendingStatus = 'processing' | 'ready' | 'error';

interface PdfDetectionMeta {
  coverage?: number | null;
  classification: PdfPageClassification;
  fallback?: boolean;
}

interface PendingFloor {
  id: string;
  originalFile: File;
  processedFile?: File;
  previewUrl?: string;
  name: string;
  status: PendingStatus;
  errorMessage?: string;
  objectUrl?: string;
  sourcePdfName?: string;
  sourcePdfPage?: number;
  sourcePdfPageCount?: number;
  detection?: PdfDetectionMeta;
  sourcePageWidthMm?: number | null;
  sourcePageHeightMm?: number | null;
  sourcePageWidthPoints?: number | null;
  sourcePageHeightPoints?: number | null;
  sourceRenderScale?: number | null;
  sourcePlanType?: 'pdf' | 'image' | 'bitmap';
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const PDF_TEXT_THRESHOLD = 0.015;
const PDF_FLOOR_THRESHOLD = 0.05;
const MAX_PDF_PAGES = 40;

const dataURLtoBlob = (dataURL: string): Blob => {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};

const getFileBaseName = (file: File) => file.name?.replace(/\.[^.]+$/, '') || 'Floor';

export default function FileUpload({ onFilesReady, disabled = false }: FileUploadProps) {
  const [pendingFloors, setPendingFloors] = useState<PendingFloor[]>([]);
  const pendingFloorsRef = useRef<PendingFloor[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [showPdfHelper, setShowPdfHelper] = useState<boolean>(false);
  const [manualTargetId, setManualTargetId] = useState<string | null>(null);

  const isProcessing = pendingFloors.some(floor => floor.status === 'processing');
  const hasReadyFloors = pendingFloors.some(floor => floor.status === 'ready');
  const hasErrors = pendingFloors.some(floor => floor.status === 'error');

  const generatePendingId = useCallback(() => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }, []);

  useEffect(() => {
    pendingFloorsRef.current = pendingFloors;
  }, [pendingFloors]);

  useEffect(() => () => {
    pendingFloorsRef.current.forEach(floor => {
      if (floor.objectUrl) {
        URL.revokeObjectURL(floor.objectUrl);
      }
    });
  }, []);

  const updatePendingFloor = useCallback((id: string, updater: (floor: PendingFloor) => PendingFloor) => {
    setPendingFloors(prev => prev.map(floor => (floor.id === id ? updater(floor) : floor)));
  }, []);

  const setPendingFloorError = useCallback((id: string, message: string) => {
    updatePendingFloor(id, floor => ({
      ...floor,
      status: 'error',
      errorMessage: message,
    }));
    setWarningMessage(message);
  }, [updatePendingFloor]);

  const applyExtractionResult = useCallback((id: string, file: File, extraction: PdfExtractionResult) => {
    const baseName = getFileBaseName(file);
    const messages: string[] = [];

    const floorCandidates = extraction.pages.filter(page => page.classification !== 'text');
    const finalPages = floorCandidates.length ? floorCandidates : extraction.pages;

    if (extraction.textPages.length) {
      const list = extraction.textPages.join(', ');
      if (floorCandidates.length) {
        messages.push(`Skipped ${extraction.textPages.length} PDF page${extraction.textPages.length > 1 ? 's' : ''}${list ? ` (${list})` : ''} that look text-heavy.`);
      } else {
        messages.push(`All ${extraction.textPages.length} PDF page${extraction.textPages.length > 1 ? 's' : ''} appear text-heavy. Keeping them for manual review.`);
      }
    }

    if (extraction.erroredPages.length) {
      const errorList = extraction.erroredPages.join(', ');
      messages.push(`Failed to render PDF page${extraction.erroredPages.length > 1 ? 's' : ''}${errorList ? ` (${errorList})` : ''}.`);
    }

    if (extraction.truncated) {
      messages.push(`Processed first ${Math.min(extraction.pages.length, MAX_PDF_PAGES)} of ${extraction.pageCount} PDF pages (limit ${MAX_PDF_PAGES}).`);
    }

    if (extraction.fallback) {
      const label = extraction.fallback === 'single' ? 'single-page renderer' : extraction.fallback === 'fallback' ? 'fallback renderer' : 'alternative renderer';
      messages.push(`Used ${label} due to primary PDF conversion issues.`);
    }

    const entrySeeds = finalPages.map(page => {
      const blob = dataURLtoBlob(page.dataUrl);
      const pngFile = new File([blob], `${baseName}-page-${page.pageNumber}.png`, { type: 'image/png' });
      return {
        originalFile: pngFile,
        processedFile: pngFile,
        previewUrl: page.dataUrl,
        name: `${baseName} - Page ${page.pageNumber}`,
        sourcePdfName: file.name,
        sourcePdfPage: page.pageNumber,
        sourcePdfPageCount: extraction.pageCount,
        detection: {
          coverage: page.coverage ?? null,
          classification: page.classification,
          fallback: Boolean(extraction.fallback),
        } satisfies PdfDetectionMeta,
        sourcePageWidthMm: page.pageWidthMillimeters ?? null,
        sourcePageHeightMm: page.pageHeightMillimeters ?? null,
        sourcePageWidthPoints: page.pageWidthPoints ?? null,
        sourcePageHeightPoints: page.pageHeightPoints ?? null,
        sourceRenderScale: page.renderScale ?? null,
        sourcePlanType: 'pdf' as const,
      };
    });

    setPendingFloors(prev => {
      const updated = prev.map(floor => {
        if (floor.id !== id) return floor;
        const primarySeed = entrySeeds[0];
        if (floor.objectUrl) {
          URL.revokeObjectURL(floor.objectUrl);
        }
        return {
          ...floor,
          ...primarySeed,
          id: floor.id,
          status: 'ready' as PendingStatus,
          errorMessage: undefined,
          objectUrl: undefined,
        };
      });

      if (entrySeeds.length === 1) {
        return updated;
      }

      const additions: PendingFloor[] = entrySeeds.slice(1).map(seed => ({
        id: generatePendingId(),
        originalFile: seed.originalFile,
        processedFile: seed.processedFile,
        previewUrl: seed.previewUrl,
        name: seed.name,
        status: 'ready' as PendingStatus,
        errorMessage: undefined,
        objectUrl: undefined,
        sourcePdfName: seed.sourcePdfName,
        sourcePdfPage: seed.sourcePdfPage,
        sourcePdfPageCount: seed.sourcePdfPageCount,
        detection: seed.detection,
        sourcePageWidthMm: seed.sourcePageWidthMm,
        sourcePageHeightMm: seed.sourcePageHeightMm,
        sourcePageWidthPoints: seed.sourcePageWidthPoints,
        sourcePageHeightPoints: seed.sourcePageHeightPoints,
        sourceRenderScale: seed.sourceRenderScale,
        sourcePlanType: seed.sourcePlanType,
      }));

      return [...updated, ...additions];
    });

    if (messages.length) {
      setWarningMessage(messages.join(' '));
    } else {
      setWarningMessage(null);
    }
  }, [generatePendingId, setWarningMessage]);

  const processPdf = useCallback(async (id: string, file: File) => {
    try {
      setStatusMessage('Processing PDF file...');
      const extraction = await extractPdfPages(file, {
        maxPages: MAX_PDF_PAGES,
        floorThreshold: PDF_FLOOR_THRESHOLD,
        textThreshold: PDF_TEXT_THRESHOLD,
        scale: 2,
      });
      applyExtractionResult(id, file, extraction);
      setStatusMessage(null);
    } catch (error) {
      console.error('PDF processing failed', error);
      setStatusMessage(null);
      setPendingFloorError(id, 'PDF processing failed. Try manual conversion.');
      setShowPdfHelper(true);
      setManualTargetId(id);
    }
  }, [applyExtractionResult, setPendingFloorError]);

  const processDwg = useCallback(async (id: string, file: File) => {
    try {
      setStatusMessage('Attempting DWG conversion...');
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/convert/dwg-to-image', { method: 'POST', body: form });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'DWG conversion backend is not configured. Please convert the DWG to PDF/PNG and upload that.');
      }
      const { dataUrl } = await res.json();
      if (!dataUrl) {
        throw new Error('DWG conversion did not produce an image.');
      }
      const blob = dataURLtoBlob(dataUrl);
      const pngFile = new File([blob], `${getFileBaseName(file)}.png`, { type: 'image/png' });
      updatePendingFloor(id, floor => ({
        ...floor,
        processedFile: pngFile,
        previewUrl: dataUrl,
        status: 'ready',
        errorMessage: undefined,
        sourcePlanType: 'bitmap',
      }));
    } catch (error) {
      console.warn('DWG conversion failed', error);
      const message = error instanceof Error ? error.message : 'DWG conversion unavailable. Please convert the DWG to PDF/PNG and upload that.';
      setPendingFloorError(id, message);
    } finally {
      setStatusMessage(null);
    }
  }, [setPendingFloorError, updatePendingFloor]);

  const processImage = useCallback((id: string, file: File) => {
    const objectUrl = URL.createObjectURL(file);
    updatePendingFloor(id, floor => ({
      ...floor,
      processedFile: file,
      previewUrl: objectUrl,
      objectUrl,
      status: 'ready',
      errorMessage: undefined,
      sourcePlanType: 'image',
    }));
  }, [updatePendingFloor]);

  const processFile = useCallback(async (id: string, file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      setPendingFloorError(id, 'File is too large. Please select a file smaller than 50MB.');
      return;
    }

    if (/\.dwg$/i.test(file.name) || file.type === 'application/acad' || file.type === 'image/vnd.dwg') {
      await processDwg(id, file);
      return;
    }

    if (file.type === 'application/pdf') {
      await processPdf(id, file);
      return;
    }

    if (file.type.startsWith('image/')) {
      processImage(id, file);
      return;
    }

    setPendingFloorError(id, 'Unsupported file type. Please upload PNG, JPG, or PDF files.');
  }, [processDwg, processImage, processPdf, setPendingFloorError]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (disabled || acceptedFiles.length === 0) {
      return;
    }

    setWarningMessage(null);

    const newFloors: PendingFloor[] = acceptedFiles.map((file, index) => {
      const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `pending-${Date.now()}-${index}`;
      return {
        id,
        originalFile: file,
        name: getFileBaseName(file),
        status: 'processing',
      };
    });

    setPendingFloors(prev => [...prev, ...newFloors]);

    newFloors.forEach(({ id, originalFile }) => {
      processFile(id, originalFile).catch(err => {
        console.error('Unhandled processing error', err);
        setPendingFloorError(id, 'Processing failed. Please try again.');
      });
    });
  }, [disabled, processFile, setPendingFloorError]);

  const handleRemoveFloor = useCallback((id: string) => {
    setPendingFloors(prev => {
      const target = prev.find(item => item.id === id);
      if (target?.objectUrl) {
        URL.revokeObjectURL(target.objectUrl);
      }
      return prev.filter(item => item.id !== id);
    });
    if (manualTargetId === id) {
      setManualTargetId(null);
      setShowPdfHelper(false);
    }
  }, [manualTargetId]);

  const handleClearAll = useCallback(() => {
    setPendingFloors(prev => {
      prev.forEach(item => {
        if (item.objectUrl) {
          URL.revokeObjectURL(item.objectUrl);
        }
      });
      return [];
    });
    setManualTargetId(null);
    setShowPdfHelper(false);
    setWarningMessage(null);
    setStatusMessage(null);
  }, []);

  const readyFloors = useMemo(() => pendingFloors.filter(floor => floor.status === 'ready' && floor.processedFile), [pendingFloors]);

  const handleConfirmUpload = useCallback(() => {
    if (readyFloors.length === 0) {
      setWarningMessage('Add at least one ready floor plan before continuing.');
      return;
    }

    onFilesReady(
      readyFloors.map(floor => ({
        file: floor.processedFile!,
        previewUrl: floor.previewUrl,
        name: floor.name,
        sourcePageWidthMm: floor.sourcePageWidthMm ?? null,
        sourcePageHeightMm: floor.sourcePageHeightMm ?? null,
        sourcePageWidthPoints: floor.sourcePageWidthPoints ?? null,
        sourcePageHeightPoints: floor.sourcePageHeightPoints ?? null,
        sourceRenderScale: floor.sourceRenderScale ?? null,
        sourcePlanType: floor.sourcePlanType ?? (floor.sourcePdfName ? 'pdf' : 'image'),
      }))
    );

    // Preserve files with errors so user can retry, but remove successful ones
    readyFloors.forEach(floor => {
      if (floor.objectUrl) {
        URL.revokeObjectURL(floor.objectUrl);
      }
    });

    setPendingFloors(prev => prev.filter(floor => floor.status !== 'ready'));
    setWarningMessage(null);
  }, [onFilesReady, readyFloors]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp'],
      'application/acad': ['.dwg'],
      'image/vnd.dwg': ['.dwg'],
    },
    multiple: true,
    disabled,
  });

  const handleManualPdfConversion = useCallback((dataUrl: string) => {
    if (!manualTargetId) {
      return;
    }

    const target = pendingFloors.find(floor => floor.id === manualTargetId);
    if (!target) {
      return;
    }

    const blob = dataURLtoBlob(dataUrl);
    const pngFile = new File([blob], `${target.name}.png`, { type: 'image/png' });

    updatePendingFloor(manualTargetId, floor => ({
      ...floor,
      processedFile: pngFile,
      previewUrl: dataUrl,
      status: 'ready',
      errorMessage: undefined,
      detection: {
        coverage: null,
        classification: 'unknown',
        fallback: true,
      },
      sourcePlanType: 'bitmap',
      sourcePageWidthMm: null,
      sourcePageHeightMm: null,
      sourcePageWidthPoints: null,
      sourcePageHeightPoints: null,
      sourceRenderScale: null,
    }));

    setManualTargetId(null);
    setShowPdfHelper(false);
    setWarningMessage(null);
  }, [manualTargetId, pendingFloors, updatePendingFloor]);

  return (
    <div className="flex flex-col gap-6">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-2xl p-14 text-center cursor-pointer transition-all duration-300 min-h-[360px] flex flex-col items-center justify-center
          ${isDragActive
            ? 'border-blue-400 bg-blue-50 transform scale-[1.02] shadow-lg'
            : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50 hover:shadow-md'}
          ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}
        `}
        aria-disabled={disabled}
      >
        <input {...getInputProps()} />

        <div className="space-y-6">
          <div className="relative">
            <div className={`w-20 h-20 bg-gradient-to-r from-blue-500 to-orange-500 rounded-2xl flex items-center justify-center mx-auto transition-transform duration-300 ${isDragActive ? 'scale-110' : ''}`}>
              <svg
                width="40"
                height="40"
                className="text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            {isDragActive && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-24 h-24 border-4 border-blue-400 border-dashed rounded-2xl animate-pulse"></div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xl font-semibold text-gray-900 mb-2">
                Drop multiple floorplans here or <span className="text-blue-600 underline decoration-2">browse files</span>
              </p>
              <p className="text-base text-gray-600 mb-1">
                Stage every floor before you begin. Supports PNG, JPG, PDF, and DWG (beta) up to 50MB each.
              </p>
              <p className="text-sm text-gray-500">
                We won’t start analysis until you confirm the upload.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Independent floor calibration</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Manual scale override</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>AI-assisted area insights</span>
              </div>
            </div>

            {disabled && (
              <div className="pt-4 text-sm text-gray-500">
                Please login with Google to upload files.
              </div>
            )}
          </div>
        </div>
      </div>

      {pendingFloors.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Staged floor plans</h3>
            <div className="flex gap-2">
              <button
                onClick={handleClearAll}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                Clear all
              </button>
              <button
                onClick={handleConfirmUpload}
                disabled={!hasReadyFloors || isProcessing}
                className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${
                  !hasReadyFloors || isProcessing
                    ? 'bg-blue-200 text-white cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:opacity-90'
                }`}
              >
                {isProcessing ? 'Processing…' : `Begin analysis${hasReadyFloors ? ` (${readyFloors.length})` : ''}`}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {pendingFloors.map(floor => (
              <div key={floor.id} className="flex items-center gap-4 border border-gray-100 rounded-xl px-4 py-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-500 font-semibold text-sm">
                  {floor.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{floor.name}</p>
                  <p className="text-xs text-gray-500 truncate">{floor.originalFile.name}</p>
                  {floor.sourcePdfName && (
                    <p className="text-xs text-gray-400 truncate">
                      From {floor.sourcePdfName}
                      {typeof floor.sourcePdfPage === 'number' ? ` • Page ${floor.sourcePdfPage}${floor.sourcePdfPageCount ? ` of ${floor.sourcePdfPageCount}` : ''}` : ''}
                    </p>
                  )}
                  {floor.detection && (
                    <p
                      className={`text-xs mt-1 ${
                        floor.detection.classification === 'floor'
                          ? 'text-green-600'
                          : floor.detection.classification === 'text'
                            ? 'text-amber-600'
                            : 'text-blue-500'
                      }`}
                    >
                      {floor.detection.classification === 'floor'
                        ? 'Likely floorplan'
                        : floor.detection.classification === 'text'
                          ? 'Likely text / cover page'
                          : 'Needs review'}
                      {typeof floor.detection.coverage === 'number'
                        ? ` • ${(floor.detection.coverage * 100).toFixed(1)}% ink`
                        : ''}
                      {floor.detection.fallback ? ' • Converted with fallback pipeline' : ''}
                    </p>
                  )}
                  {floor.errorMessage && (
                    <p className="text-xs text-red-600 mt-1">{floor.errorMessage}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {floor.status === 'processing' && (
                    <span className="flex items-center text-xs text-blue-500">
                      <svg className="w-4 h-4 mr-1 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                      </svg>
                      Processing
                    </span>
                  )}
                  {floor.status === 'ready' && (
                    <span className="flex items-center text-xs text-green-600">
                      <svg className="w-4 h-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Ready
                    </span>
                  )}
                  {floor.status === 'error' && (
                    <span className="flex items-center text-xs text-red-500">
                      <svg className="w-4 h-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-12.75a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0v-4.5zm0 6a.75.75 0 00-1.5 0v1a.75.75 0 001.5 0v-1z" clipRule="evenodd" />
                      </svg>
                      Needs attention
                    </span>
                  )}

                  <button
                    onClick={() => handleRemoveFloor(floor.id)}
                    className="text-xs text-gray-400 hover:text-red-500"
                    aria-label={`Remove ${floor.name}`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          {hasErrors && (
            <p className="text-xs text-red-500 mt-3">
              Fix issues or use manual conversion for any floors flagged above, then re-add them.
            </p>
          )}
        </div>
      )}

      <ProcessingMessage status={statusMessage} warning={warningMessage} isProcessing={isProcessing} />

      {showPdfHelper && manualTargetId && (
        <PdfConversionHelper onImageReady={handleManualPdfConversion} />
      )}
    </div>
  );
}
