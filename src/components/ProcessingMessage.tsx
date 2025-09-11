'use client';

import React from 'react';

interface ProcessingMessageProps {
  status: string | null;
  warning: string | null;
  isProcessing: boolean;
}

export default function ProcessingMessage({ status, warning, isProcessing }: ProcessingMessageProps) {
  if (!status && !warning && !isProcessing) return null;

  return (
    <div className="mt-4">
      {isProcessing && !status && (
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-3"></div>
          <span>Processing...</span>
        </div>
      )}

      {status && (
        <div className="bg-blue-50 p-3 rounded-md text-blue-800 flex items-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-3"></div>
          <span>{status}</span>
        </div>
      )}

      {warning && (
        <div className="bg-amber-50 p-3 rounded-md text-amber-800 mt-2">
          <div className="flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>{warning}</span>
          </div>
          <div className="mt-2 text-sm">
            <p>Try one of these alternatives:</p>
            <ol className="list-decimal list-inside mt-1 ml-2">
              <li>Export/save just the first page as PNG/JPEG from your PDF viewer</li>
              <li>Take a screenshot of the floorplan</li>
              <li>Try a different PDF file</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
