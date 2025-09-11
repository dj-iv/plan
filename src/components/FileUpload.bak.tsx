'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import ProcessingMessage from './ProcessingMessage';
import PdfConversionHelper from './PdfConversionHelper';
import { renderPdfToImage, renderPdfFallback, renderPdfAlternative } from '../utils/pdfRenderer';

// We'll import PDF.js only when needed to keep bundle lean

interface FileUploadProps {
  onFileUpload: (file: File, previewUrl?: string) => void;
  onPdfImageReady?: (dataUrl: string) => void;
}

export default function FileUpload({ onFileUpload, onPdfImageReady }: FileUploadProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  // For PDF files, we'll try multiple rendering methods
  const [showPdfHelper, setShowPdfHelper] = useState<boolean>(false);
  
  const handleManualPdfConversion = (dataUrl: string) => {
    setShowPdfHelper(false);
    setWarningMessage(null);
    setIsProcessing(false);
    
    // Create a synthetic file from the dataURL
    const fileName = "converted-pdf.png";
    const blob = dataURLtoBlob(dataUrl);
    const file = new File([blob], fileName, { type: 'image/png' });
    
    // Process the manually converted PDF image
    if (onPdfImageReady) {
      onPdfImageReady(dataUrl);
    }
    
    // Also pass to the main handler
    onFileUpload(file, dataUrl);
  };
  
  // Helper function to convert dataURL to Blob
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
  
  const handlePdf = async (file: File) => {
    console.log("PDF file detected, attempting to process");
    setStatusMessage("Processing PDF file...");
    
    try {
      // Try the primary rendering method first
      console.log("Attempting primary PDF rendering method");
      const dataUrl = await renderPdfToImage(file, 1);
      console.log("PDF rendered successfully");
      setStatusMessage(null);
      return dataUrl;
    } catch (primaryError) {
      console.error("Primary PDF rendering failed, trying fallback", primaryError);
      setStatusMessage("Primary PDF method failed, trying alternative approach...");
      
      try {
        // Try the fallback method if the primary fails
        console.log("Attempting fallback PDF rendering method");
        const dataUrl = await renderPdfFallback(file, 1);
        console.log("PDF fallback rendering successful");
        setStatusMessage(null);
        return dataUrl;
      } catch (fallbackError) {
        console.error("Fallback rendering failed, trying alternative method", fallbackError);
        setStatusMessage("Trying final conversion method...");
        
        try {
          // Try the alternative method as a last resort
          console.log("Attempting alternative PDF rendering method");
          const dataUrl = await renderPdfAlternative(file, 1);
          console.log("PDF alternative rendering successful");
          setStatusMessage(null);
          return dataUrl;
        } catch (alternativeError) {
          console.error("All PDF rendering methods failed", alternativeError);
          setStatusMessage(null);
          setWarningMessage("PDF processing failed. Please try using a different PDF or convert it to an image first.");
          setShowPdfHelper(true);
          throw new Error("PDF processing failed with all available methods");
        }
      }
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
        try {
          // Try to render the PDF
          const preview = await handlePdf(file);
          
          // Send the preview to the parent component
          onFileUpload(file, preview);
        } catch (pdfError) {
          console.error("PDF processing failed:", pdfError);
          // The error message and helper are already shown by handlePdf
        } finally {
          setIsProcessing(false);
        }
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
    <div className="flex flex-col">
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
                  Manual scale setting available
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Processing message and warnings displayed outside the dropzone */}
      <ProcessingMessage 
        status={statusMessage}
        warning={warningMessage}
        isProcessing={isProcessing}
      />
      
      {/* PDF Helper component */}
      {showPdfHelper && (
        <PdfConversionHelper onImageReady={handleManualPdfConversion} />
      )}
    </div>
  );
}
