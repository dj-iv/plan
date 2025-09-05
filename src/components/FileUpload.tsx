'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';

interface FileUploadProps {
  onFileUpload: (file: File) => void;
}

export default function FileUpload({ onFileUpload }: FileUploadProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      // Basic file validation
      const maxSize = 50 * 1024 * 1024; // 50MB
      if (file.size > maxSize) {
        alert('File is too large. Please select a file smaller than 50MB.');
        return;
      }

      onFileUpload(file);
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
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp']
    },
    maxFiles: 1,
    disabled: isProcessing
  });

  return (
    <div
      {...getRootProps()}
      className={`
        border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
        ${isDragActive 
          ? 'border-blue-400 bg-blue-50' 
          : 'border-gray-300 hover:border-gray-400'
        }
        ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input {...getInputProps()} />
      
      <div className="space-y-2">
        <div className="flex justify-center">
          {isProcessing ? (
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          ) : (
            <svg 
              className="w-8 h-8 text-gray-400" 
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
          )}
        </div>
        
        {isProcessing ? (
          <p className="text-sm text-gray-600">Processing file...</p>
        ) : isDragActive ? (
          <p className="text-sm text-blue-600">Drop the file here...</p>
        ) : (
          <>
            <p className="text-sm text-gray-600">
              <span className="font-medium">Click to upload</span> or drag and drop
            </p>
            <p className="text-xs text-gray-500">
              PDF, PNG, JPG up to 50MB
            </p>
          </>
        )}
      </div>
    </div>
  );
}
