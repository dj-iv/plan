'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';

// We'll import PDF.js and Tesseract only when needed to keep bundle lean

interface FileUploadProps {
  onFileUpload: (file: File, previewUrl?: string) => void;
  onPdfImageReady?: (dataUrl: string) => void;
  onOcrScaleGuess?: (guess: { rawText: string; extractedScale?: number; unit?: string }) => void;
}

export default function FileUpload({ onFileUpload, onPdfImageReady, onOcrScaleGuess }: FileUploadProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  const extractScaleFromText = (text: string) => {
    // Very naive regex extraction for patterns like 1:100 or 1 = 50 mm, 1cm = 1m etc.
    const ratioMatch = text.match(/1\s*[:=]\s*(\d{1,5})/i);
    if (ratioMatch) {
      return { rawText: text, extractedScale: 1 / parseFloat(ratioMatch[1]), unit: 'ratio' };
    }
    const pxMatch = text.match(/1\s*(cm|m|mm|ft|meter|metre)\s*=\s*(\d{1,6})\s*(cm|m|mm|ft)/i);
    if (pxMatch) {
      // This is just a placeholder parse
      return { rawText: text, extractedScale: 1, unit: pxMatch[1] };
    }
    return { rawText: text };
  };

  const handlePdf = async (file: File) => {
    try {
      setStatusMessage('Reading PDF...');
  // Import pdfjs and configure worker hosted on a CDN (avoids bundler worker issues)
  // pdfjs-dist v3 UMD build
  // @ts-ignore - UMD entry lacks types in v3
  const pdfjsLib: any = await import('pdfjs-dist/build/pdf');
  const { GlobalWorkerOptions, getDocument } = pdfjsLib;
  GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.10.111/build/pdf.worker.min.js';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/png');
  onPdfImageReady && onPdfImageReady(dataUrl);

      try {
        setStatusMessage('Performing OCR to detect scale...');
        const tesseract = await import('tesseract.js');
        const { createWorker } = tesseract as any;
        const worker = await createWorker('eng');
        const { data } = await worker.recognize(dataUrl);
        await worker.terminate();
        const guess = extractScaleFromText(data.text || '');
        onOcrScaleGuess && onOcrScaleGuess(guess);
        setStatusMessage(null);
  } catch (err) {
        console.warn('OCR failed (non-fatal):', err);
        setStatusMessage(null);
      }
  return dataUrl as string;
    } catch (error: any) {
      console.error('PDF processing failed:', error);
      setStatusMessage(null);
      alert('PDF processing failed. Please try saving/exporting the first page as an image and upload that for now.\n\nDetails: ' + (error?.message || String(error)));
  throw error;
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setIsProcessing(true);
    setStatusMessage(null);
    setWarningMessage(null);
    try {
      const maxSize = 50 * 1024 * 1024; // 50MB
      if (file.size > maxSize) {
        alert('File is too large. Please select a file smaller than 50MB.');
        return;
      }

      // DWG (beta) — requires server converter to be configured
      if (/\.dwg$/i.test(file.name) || file.type === 'application/acad' || file.type === 'image/vnd.dwg') {
        setStatusMessage('Attempting DWG conversion...');
        try {
          const form = new FormData();
          form.append('file', file);
          const res = await fetch('/api/convert/dwg-to-image', { method: 'POST', body: form });
          if (!res.ok) {
            const text = await res.text();
            setWarningMessage(text || 'DWG conversion backend is not configured. Please convert the DWG to PDF/PNG and upload that.');
            return;
          }
          const { dataUrl } = await res.json();
          if (dataUrl) {
            onFileUpload(file, dataUrl);
            return;
          }
          setWarningMessage('DWG conversion did not produce an image. Please convert the DWG to PDF/PNG and upload that.');
          return;
        } catch (err: any) {
          console.warn('DWG convert failed:', err);
          setWarningMessage('DWG conversion unavailable. Please convert the DWG to PDF/PNG and upload that.');
          return;
        } finally {
          setStatusMessage(null);
        }
      }

      if (file.type === 'application/pdf') {
        const preview = await handlePdf(file);
        onFileUpload(file, preview);
        return;
      }

      // Image file
      const url = URL.createObjectURL(file);
      onFileUpload(file, url);
    } catch (error) {
      console.error('Error processing file:', error);
      alert('Error processing file. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [onFileUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
  'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp'],
  'application/acad': ['.dwg'],
  'image/vnd.dwg': ['.dwg']
    },
    maxFiles: 1,
    disabled: isProcessing
  });

  return (
    <div
      {...getRootProps()}
      className={`
        border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all
        ${isDragActive 
          ? 'border-blue-400 bg-blue-50 transform scale-105' 
          : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
        }
        ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input {...getInputProps()} />
      
      {isProcessing ? (
        <div className="space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
          <p className="text-sm text-gray-600">{statusMessage || 'Processing file...'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-orange-500 rounded-full flex items-center justify-center mx-auto" style={{width:48,height:48}}>
            <svg
              width="24"
              height="24"
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
          
          {isDragActive ? (
            <div>
              <p className="text-sm font-medium text-blue-600">Drop your file here</p>
              <p className="text-xs text-blue-500">Release to upload</p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium text-gray-900 mb-1">
                Drop file or <span className="text-blue-600">browse files</span>
              </p>
              <p className="text-xs text-gray-500">
                PNG, JPG, PDF up to 50MB; DWG (beta)
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Automatic scale detection (beta)
              </p>
              {statusMessage && <p className="text-xs text-amber-600 mt-2">{statusMessage}</p>}
              {warningMessage && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded mt-2">{warningMessage}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
