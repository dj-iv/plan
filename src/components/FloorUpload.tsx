'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import ProcessingMessage from './ProcessingMessage';
import { extractPdfPages, type PdfPageClassification } from '../utils/pdfFloorExtractor';

interface FloorUploadProps {
  onFilesUpload: (files: Array<{ file: File; previewUrl?: string; name: string }>) => void;
  onCancel: () => void;
  disabled?: boolean;
  multiple?: boolean;
}

interface ProcessingFile {
  file: File;
  name: string;
  status: 'processing' | 'done' | 'error';
  previewUrl?: string;
  errorMessage?: string;
  infoMessage?: string;
  sourcePdfName?: string;
  sourcePdfPage?: number;
  sourcePdfPageCount?: number;
  detection?: {
    coverage?: number | null;
    classification: PdfPageClassification;
    fallback?: boolean;
  };
}

interface ProcessedOutput {
  file: File;
  previewUrl?: string;
  name: string;
  sourcePdfName?: string;
  sourcePdfPage?: number;
  sourcePdfPageCount?: number;
  detection?: ProcessingFile['detection'];
}

const MAX_PDF_PAGES = 40;
const PDF_TEXT_THRESHOLD = 0.015;
const PDF_FLOOR_THRESHOLD = 0.05;

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

const describeClassification = (classification: PdfPageClassification) => {
  switch (classification) {
    case 'floor':
      return 'Likely floor plan';
    case 'text':
      return 'Text-heavy page';
    default:
      return 'Page type uncertain';
  }
};

const formatCoverage = (coverage?: number | null) => {
  if (typeof coverage !== 'number' || Number.isNaN(coverage)) {
    return undefined;
  }
  return `${(coverage * 100).toFixed(1)}% ink coverage`;
};

export default function FloorUpload({ onFilesUpload, onCancel, disabled = false, multiple = true }: FloorUploadProps) {
  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([]);
  const [hasUploaded, setHasUploaded] = useState(false);

  const emitUploads = useCallback((files: Array<{ file: File; previewUrl?: string; name: string }>) => {
    if (files.length === 0 || hasUploaded) {
      return;
    }
    setHasUploaded(true);
    onFilesUpload(files);
  }, [hasUploaded, onFilesUpload]);

  const processFile = useCallback(async (file: File): Promise<{ outputs: ProcessedOutput[]; warnings: string[] }> => {
    const baseName = getFileBaseName(file);

    if (file.type === 'application/pdf') {
      try {
        const extraction = await extractPdfPages(file, {
          maxPages: MAX_PDF_PAGES,
          floorThreshold: PDF_FLOOR_THRESHOLD,
          textThreshold: PDF_TEXT_THRESHOLD,
          scale: 2,
        });

        const floorCandidates = extraction.pages.filter(page => page.classification !== 'text');
        const finalPages = floorCandidates.length ? floorCandidates : extraction.pages;

        if (!finalPages.length) {
          throw new Error('No renderable PDF pages detected.');
        }

        const messages: string[] = [];

        if (extraction.textPages.length) {
          const list = extraction.textPages.join(', ');
          if (floorCandidates.length) {
            messages.push(`Skipped ${extraction.textPages.length} text-heavy page${extraction.textPages.length > 1 ? 's' : ''}${list ? ` (${list})` : ''}.`);
          } else {
            messages.push(`All ${extraction.textPages.length} page${extraction.textPages.length > 1 ? 's' : ''} look text-heavy. Keeping them for manual review.`);
          }
        }

        if (extraction.erroredPages.length) {
          const errorList = extraction.erroredPages.join(', ');
          messages.push(`Failed to render page${extraction.erroredPages.length > 1 ? 's' : ''}${errorList ? ` (${errorList})` : ''}.`);
        }

        if (extraction.truncated) {
          messages.push(`Processed first ${Math.min(extraction.pages.length, MAX_PDF_PAGES)} of ${extraction.pageCount} pages (limit ${MAX_PDF_PAGES}).`);
        }

        if (extraction.fallback) {
          const label = extraction.fallback === 'single' ? 'single-page renderer' : extraction.fallback === 'fallback' ? 'fallback renderer' : 'alternative renderer';
          messages.push(`Used ${label} because the primary PDF conversion failed.`);
        }

        const outputs: ProcessedOutput[] = finalPages.map(page => {
          const blob = dataURLtoBlob(page.dataUrl);
          const pngFile = new File([blob], `${baseName}-page-${page.pageNumber}.png`, { type: 'image/png' });
          return {
            file: pngFile,
            previewUrl: page.dataUrl,
            name: `${baseName} - Page ${page.pageNumber}`,
            sourcePdfName: file.name,
            sourcePdfPage: page.pageNumber,
            sourcePdfPageCount: extraction.pageCount,
            detection: {
              coverage: page.coverage ?? null,
              classification: page.classification,
              fallback: Boolean(extraction.fallback),
            },
          };
        });

        return { outputs, warnings: messages };
      } catch (error) {
        console.error('PDF processing failed', error);
        throw new Error('PDF conversion failed - please try converting the PDF to an image manually');
      }
    }

    if (file.type.startsWith('image/')) {
      const previewUrl = URL.createObjectURL(file);
      return {
        outputs: [{ file, previewUrl, name: baseName }],
        warnings: [],
      };
    }

    throw new Error('Unsupported file type');
  }, []);

  const handleFiles = useCallback(async (files: File[]) => {
    if (disabled) return;

    setHasUploaded(false);
    const initialProcessingFiles: ProcessingFile[] = files.map(file => ({
      file,
      name: file.name.replace(/\.[^.]+$/, '') || 'Floor',
      status: 'processing'
    }));
    
    setProcessingFiles(initialProcessingFiles);

    // Process files one by one
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const { outputs, warnings } = await processFile(file);
        if (!outputs.length) {
          throw new Error('No usable pages were produced.');
        }

        const [primary, ...rest] = outputs;
        const infoMessage = warnings.length ? warnings.join(' ') : undefined;

        setProcessingFiles(prev => {
          const updated = prev.map(pf => {
            if (pf.file !== file) {
              return pf;
            }

            return {
              ...pf,
              file: primary.file,
              name: primary.name,
              status: 'done' as const,
              previewUrl: primary.previewUrl,
              infoMessage,
              sourcePdfName: primary.sourcePdfName,
              sourcePdfPage: primary.sourcePdfPage,
              sourcePdfPageCount: primary.sourcePdfPageCount,
              detection: primary.detection,
              errorMessage: undefined,
            };
          });

          if (rest.length === 0) {
            return updated;
          }

          const additions: ProcessingFile[] = rest.map(output => ({
            file: output.file,
            name: output.name,
            status: 'done' as const,
            previewUrl: output.previewUrl,
            infoMessage,
            sourcePdfName: output.sourcePdfName,
            sourcePdfPage: output.sourcePdfPage,
            sourcePdfPageCount: output.sourcePdfPageCount,
            detection: output.detection,
          }));

          return [...updated, ...additions];
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Processing failed';
        setProcessingFiles(prev => prev.map(pf =>
          pf.file === file
            ? { ...pf, status: 'error', errorMessage }
            : pf
        ));
      }
    }
    
  }, [disabled, processFile]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    handleFiles(acceptedFiles);
  }, [handleFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'],
      'application/pdf': ['.pdf']
    },
    multiple,
    disabled
  });

  const handleContinue = () => {
    const successfulFiles = processingFiles.filter(pf => pf.status === 'done');
    if (successfulFiles.length > 0) {
      emitUploads(successfulFiles.map(pf => ({
        file: pf.file,
        previewUrl: pf.previewUrl,
        name: pf.name
      })));
    }
  };

  // Show processing or results
  if (processingFiles.length > 0) {
    const allDone = processingFiles.every(pf => pf.status === 'done' || pf.status === 'error');
    const successfulFiles = processingFiles.filter(pf => pf.status === 'done');

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center" style={{zIndex: 2147483648}}>
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h3 className="text-lg font-semibold mb-4">Processing Floor Plans</h3>
          
          <div className="space-y-3 mb-6">
            {processingFiles.map((pf, index) => {
              const metadataParts: string[] = [];
              if (pf.sourcePdfPage) {
                metadataParts.push(`PDF page ${pf.sourcePdfPage}${pf.sourcePdfPageCount ? ` of ${pf.sourcePdfPageCount}` : ''}`);
              }
              if (pf.detection?.classification) {
                metadataParts.push(describeClassification(pf.detection.classification));
              }
              if (pf.detection?.coverage !== undefined) {
                const coverageText = formatCoverage(pf.detection.coverage);
                if (coverageText) {
                  metadataParts.push(coverageText);
                }
              }
              if (pf.detection?.fallback) {
                metadataParts.push('Fallback renderer used');
              }

              return (
                <div key={index} className="flex gap-3">
                  <div className={`w-3 h-3 mt-1 rounded-full ${
                    pf.status === 'done' ? 'bg-green-500' :
                    pf.status === 'error' ? 'bg-red-500' : 'bg-blue-500 animate-pulse'
                  }`} />
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900">{pf.name}</span>
                      {pf.previewUrl && (
                        <span className="text-xs text-gray-400">{Math.round(pf.file.size / 1024)} KB</span>
                      )}
                    </div>
                    {metadataParts.length > 0 && (
                      <div className="text-xs text-gray-500 mt-1">{metadataParts.join(' · ')}</div>
                    )}
                    {pf.infoMessage && (
                      <div className="text-xs text-amber-600 mt-1">{pf.infoMessage}</div>
                    )}
                    {pf.status === 'error' && (
                      <div className="text-xs text-red-600 mt-1">{pf.errorMessage}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {allDone && (
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              {successfulFiles.length > 0 && (
                <button
                  onClick={handleContinue}
                  disabled={hasUploaded}
                  className={`flex-1 px-4 py-2 rounded-lg text-white transition-colors ${
                    hasUploaded
                      ? 'bg-blue-300 cursor-not-allowed'
                      : 'bg-blue-500 hover:bg-blue-600'
                  }`}
                >
                  {hasUploaded ? 'Added' : `Add ${successfulFiles.length} Floor${successfulFiles.length !== 1 ? 's' : ''}`}
                </button>
              )}
            </div>
          )}

          {!allDone && (
            <div className="flex justify-center">
              <ProcessingMessage status="Processing files..." warning={null} isProcessing={true} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show upload interface
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center" style={{zIndex: 2147483648}}>
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold mb-4">Add Floor Plans</h3>
        
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <input {...getInputProps()} />
          <div className="space-y-2">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              stroke="currentColor"
              fill="none"
              viewBox="0 0 48 48"
            >
              <path
                d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-gray-900">
                {isDragActive ? 'Drop files here' : 'Drop files or click to upload'}
              </p>
              <p className="text-xs text-gray-500">
                {multiple ? 'Multiple floor plans supported' : 'One floor plan at a time'}
              </p>
              <p className="text-xs text-gray-500">PNG, JPG, PDF files</p>
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}