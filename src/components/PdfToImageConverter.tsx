'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';

// Import document and page component without SSR
const Document = dynamic(() => import('react-pdf').then(mod => mod.Document), { ssr: false });
const Page = dynamic(() => import('react-pdf').then(mod => mod.Page), { ssr: false });

// Import pdfjs for worker configuration
let pdfjsPromise: Promise<any> | null = null;
if (typeof window !== 'undefined') {
  // Only load in browser
  pdfjsPromise = import('react-pdf').then(mod => {
    const { pdfjs } = mod;
    pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;
    return pdfjs;
  });
}

interface PdfToImageConverterProps {
  file: File;
  onImageReady: (dataUrl: string) => void;
  onError: (error: Error) => void;
}

const PdfToImageConverter: React.FC<PdfToImageConverterProps> = ({ file, onImageReady, onError }) => {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);

  // When component mounts, create an object URL for the PDF
  React.useEffect(() => {
    let mounted = true;
    
    const initialize = async () => {
      if (file) {
        const url = URL.createObjectURL(file);
        if (mounted) {
          setPdfUrl(url);
          
          // Wait for pdfjs to be ready
          if (pdfjsPromise) {
            await pdfjsPromise;
            setIsReady(true);
          }
        }
      }
    };
    
    initialize();
    
    return () => {
      mounted = false;
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [file]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const onRenderSuccess = (page: any) => {
    try {
      // Get the canvas after the page is rendered
      const canvas = page.canvasRef.current;
      if (!canvas) {
        onError(new Error('Canvas not available after PDF render'));
        return;
      }
      
      // Convert the canvas to a data URL
      const dataUrl = canvas.toDataURL('image/png');
      onImageReady(dataUrl);
    } catch (error) {
      console.error('Error converting PDF page to image:', error);
      onError(error instanceof Error ? error : new Error('Failed to convert PDF to image'));
    }
  };

  if (!pdfUrl || !isReady) {
    return <div>Loading PDF viewer...</div>;
  }

  return (
    <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
      <Document
        file={pdfUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={(error) => onError(error instanceof Error ? error : new Error('Failed to load PDF'))}
      >
        {numPages && (
          <Page 
            pageNumber={1} 
            scale={2}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            onRenderSuccess={onRenderSuccess}
            onRenderError={(error) => onError(error instanceof Error ? error : new Error('Failed to render PDF page'))}
          />
        )}
      </Document>
    </div>
  );
};

export default PdfToImageConverter;
