'use client';

import React, { useState } from 'react';
import PdfDirectConverter from './PdfDirectConverter';

interface PdfConversionHelperProps {
  onImageReady?: (dataUrl: string) => void;
}

const PdfConversionHelper: React.FC<PdfConversionHelperProps> = ({ onImageReady }) => {
  const [showConverter, setShowConverter] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handleImageConverted = (dataUrl: string) => {
    if (onImageReady) {
      onImageReady(dataUrl);
    }
  };
  
  return (
    <div className="bg-amber-50 border-l-4 border-amber-500 p-4 my-4">
      <div className="flex">
        <div className="flex-shrink-0">
          <svg className="h-5 w-5 text-amber-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-amber-800">PDF Processing Failed</h3>
          <div className="mt-2 text-sm text-amber-700">
            <p>Our system is having trouble processing this PDF. Please try one of these alternatives:</p>
            <ol className="list-decimal list-inside mt-2 ml-2 space-y-1">
              <li>Export/save just the first page as PNG/JPEG from your PDF viewer</li>
              <li>Take a screenshot of the floorplan</li>
              <li>Try a different PDF file</li>
            </ol>
          </div>
        </div>
      </div>
      
      {/* Add direct PDF converter option */}
      <div className="mt-4">
        {!showConverter ? (
          <button
            onClick={() => setShowConverter(true)}
            className="bg-amber-500 hover:bg-amber-600 text-white font-medium py-2 px-4 rounded transition-colors"
          >
            Try Our Direct Converter
          </button>
        ) : (
          <div className="mt-4 bg-white p-3 rounded-md border border-amber-200">
            <h4 className="text-sm font-medium text-amber-800 mb-2">Direct PDF Converter</h4>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}
            <PdfDirectConverter onImageConverted={handleImageConverted} onError={setError} />
          </div>
        )}
      </div>
      
      <div className="mt-4 bg-white p-3 rounded-md border border-amber-200">
        <h4 className="text-sm font-medium text-amber-800 mb-2">Common PDF Export Methods:</h4>
        
        <details className="mb-2">
          <summary className="text-sm cursor-pointer hover:text-amber-800">Adobe Acrobat/Reader</summary>
          <div className="pl-4 mt-1 text-xs text-gray-600">
            <p>1. Open the PDF and navigate to the floorplan page</p>
            <p>2. Click on <span className="font-mono bg-gray-100 px-1">File &gt; Export To &gt; Image &gt; PNG</span></p>
            <p>3. Select just the current page and save</p>
          </div>
        </details>
        
        <details className="mb-2">
          <summary className="text-sm cursor-pointer hover:text-amber-800">Preview (Mac)</summary>
          <div className="pl-4 mt-1 text-xs text-gray-600">
            <p>1. Open the PDF and navigate to the floorplan page</p>
            <p>2. Click on <span className="font-mono bg-gray-100 px-1">File &gt; Export</span></p>
            <p>3. Select PNG or JPEG format and save</p>
          </div>
        </details>
        
        <details>
          <summary className="text-sm cursor-pointer hover:text-amber-800">Screenshot Method (Any System)</summary>
          <div className="pl-4 mt-1 text-xs text-gray-600">
            <p>1. Open the PDF and navigate to the floorplan page</p>
            <p>2. Maximize the window and zoom to fit the floorplan</p>
            <p>3. Take a screenshot:</p>
            <p className="pl-2">• Windows: <span className="font-mono bg-gray-100 px-1">Windows+Shift+S</span> or <span className="font-mono bg-gray-100 px-1">PrtScn</span></p>
            <p className="pl-2">• Mac: <span className="font-mono bg-gray-100 px-1">Cmd+Shift+3</span> (full) or <span className="font-mono bg-gray-100 px-1">Cmd+Shift+4</span> (area)</p>
            <p className="pl-2">• Then paste into an image editor or directly upload the saved screenshot</p>
          </div>
        </details>
      </div>
    </div>
  );
};

export default PdfConversionHelper;
