'use client';

import React, { useState } from 'react';
import { renderPdfToImage, renderPdfFallback, renderPdfAlternative } from '../utils/pdfRenderer';

interface PdfDirectConverterProps {
  onImageConverted?: (dataUrl: string) => void;
  onError?: (error: string) => void;
  onClose?: () => void;
}

const PdfDirectConverter: React.FC<PdfDirectConverterProps> = ({ 
  onImageConverted, 
  onError,
  onClose 
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [convertedImage, setConvertedImage] = useState<string | null>(null);
  const [renderingMethod, setRenderingMethod] = useState<'primary' | 'fallback' | 'alternative'>('primary');
  const [pageNumber, setPageNumber] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setSelectedFile(file);
      setError(null);
      getPageCount(file);
    } else if (file) {
      const errorMessage = 'Please select a PDF file';
      setError(errorMessage);
      if (onError) onError(errorMessage);
      setSelectedFile(null);
    }
  };
  
  // Get the total number of pages in the PDF
  const getPageCount = async (file: File) => {
    try {
      // Load PDF.js dynamically
      const pdfjs = await import('pdfjs-dist');
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      setTotalPages(pdf.numPages);
      
      // Clean up
      pdf.destroy();
    } catch (error) {
      console.error('Failed to get page count:', error);
      setTotalPages(1);
    }
  };
  
  const handleConvertClick = async () => {
    if (!selectedFile) {
      const errorMessage = 'Please select a PDF file first';
      setError(errorMessage);
      if (onError) onError(errorMessage);
      return;
    }
    
    setIsConverting(true);
    setError(null);
    
    try {
      let dataUrl;
      
      if (renderingMethod === 'primary') {
        try {
          dataUrl = await renderPdfToImage(selectedFile, pageNumber);
        } catch (primaryError) {
          console.error('Primary rendering method failed:', primaryError);
          dataUrl = await renderPdfFallback(selectedFile, pageNumber);
        }
      } else if (renderingMethod === 'fallback') {
        dataUrl = await renderPdfFallback(selectedFile, pageNumber);
      } else if (renderingMethod === 'alternative') {
        dataUrl = await renderPdfAlternative(selectedFile, pageNumber);
      }
      
      if (!dataUrl) {
        throw new Error('Failed to generate image from PDF');
      }

      setConvertedImage(dataUrl);

      if (onImageConverted) {
        onImageConverted(dataUrl);
      }
    } catch (err) {
      console.error('PDF conversion failed:', err);
      const errorMessage = 'Failed to convert PDF. Try a different PDF or a different method.';
      setError(errorMessage);
      if (onError) onError(errorMessage);
    } finally {
      setIsConverting(false);
    }
  };
  
  const handleDownload = () => {
    if (convertedImage) {
      const link = document.createElement('a');
      link.href = convertedImage;
      link.download = `${selectedFile?.name || 'converted'}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };
  
  const handleUseImage = () => {
    if (convertedImage && onImageConverted) {
      onImageConverted(convertedImage);
      onClose && onClose();
    }
  };
  
  return onClose ? (
    // Modal version (when onClose is provided)
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">PDF Converter Tool</h2>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  ) : (
    // Inline version (when onClose is not provided)
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Select PDF File
        </label>
        <input
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Rendering Method
        </label>
        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center">
            <input
              type="radio"
              className="form-radio"
              name="rendering-method"
              value="primary"
              checked={renderingMethod === 'primary'}
              onChange={() => setRenderingMethod('primary')}
            />
            <span className="ml-2">Primary Method (Recommended)</span>
          </label>
          <label className="inline-flex items-center">
            <input
              type="radio"
              className="form-radio"
              name="rendering-method"
              value="fallback"
              checked={renderingMethod === 'fallback'}
              onChange={() => setRenderingMethod('fallback')}
            />
            <span className="ml-2">Fallback Method</span>
          </label>
          <label className="inline-flex items-center">
            <input
              type="radio"
              className="form-radio"
              name="rendering-method"
              value="alternative"
              checked={renderingMethod === 'alternative'}
              onChange={() => setRenderingMethod('alternative')}
            />
            <span className="ml-2">Alternative Method</span>
          </label>
        </div>
      </div>
      
      {totalPages > 1 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Page Number (1-{totalPages})
          </label>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={pageNumber}
            onChange={(e) => setPageNumber(Math.min(Math.max(1, parseInt(e.target.value) || 1), totalPages))}
            className="w-20 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      )}
          
      <div className="flex space-x-2">
        <button
          onClick={handleConvertClick}
          disabled={!selectedFile || isConverting}
          className={`px-4 py-2 rounded-md ${
            !selectedFile || isConverting
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-blue-500 hover:bg-blue-600 text-white'
          }`}
        >
          {isConverting ? 'Converting...' : 'Convert PDF'}
        </button>
      </div>
      
      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 text-red-700">
          <p>{error}</p>
        </div>
      )}
      
      {convertedImage && (
        <div className="space-y-4">
          <div className="border rounded-md p-2">
            <img 
              src={convertedImage} 
              alt="Converted PDF" 
              className="max-h-64 mx-auto"
            />
          </div>
          
          <div className="flex space-x-2">
            <button
              onClick={handleDownload}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-md"
            >
              Download Image
            </button>
            {onClose ? (
              <button
                onClick={handleUseImage}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md"
              >
                Use This Image
              </button>
            ) : null}
          </div>
        </div>
      )}
      
      <div className="mt-4 text-xs text-gray-500">
        <p>Tips:</p>
        <ul className="list-disc pl-5 space-y-1 mt-1">
          <li><strong>Primary Method:</strong> Best for most PDFs - high quality with good performance</li>
          <li><strong>Fallback Method:</strong> Try this if the primary method fails - uses a different rendering approach</li>
          <li><strong>Alternative Method:</strong> For complex PDFs that fail with other methods - may be slower</li>
          <li>Simple PDFs work best - complex PDFs with many elements may not render correctly</li>
          <li>Try different pages if the first page doesn&apos;t contain the floorplan</li>
        </ul>
      </div>
    </div>
  );
};export default PdfDirectConverter;
