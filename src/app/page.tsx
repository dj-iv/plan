'use client';

import { useState, useCallback } from 'react';
import FileUpload from '@/components/FileUpload';
import ScaleControl from '@/components/ScaleControl';
import FloorplanCanvas from '@/components/FloorplanCanvas';

export default function Home() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [unit, setUnit] = useState<string>('meters');
  const [calibrateTick, setCalibrateTick] = useState<number>(0);
  const [showCanvas, setShowCanvas] = useState<boolean>(false);

  const handleFileUpload = useCallback((file: File, previewUrl?: string) => {
    setUploadedFile(file);
    setImageUrl(previewUrl || (file ? URL.createObjectURL(file) : ''));
    // Automatically switch to canvas view
    setTimeout(() => {
      setShowCanvas(true);
    }, 500); // Small delay for smooth transition
  }, []);

  const handleReset = useCallback(() => {
    setUploadedFile(null);
    setImageUrl("");
    setScale(null);
    setUnit('meters');
    setInfoMessage(null);
    setShowCanvas(false);
  }, []);

  // Show upload screen if no canvas view
  if (!showCanvas) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">Floorplan Analyser</h1>
            <p className="text-lg text-gray-600">Upload your floorplan to start analysing areas, measurements, and antenna coverage</p>
          </div>
          
          {/* Large Upload Area */}
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <FileUpload 
              onFileUpload={handleFileUpload} 
              onPdfImageReady={(d) => setImageUrl(d)} 
            />
            
            {uploadedFile && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium text-green-800">File uploaded successfully</p>
                    <p className="text-sm text-green-600">{uploadedFile.name} • {(uploadedFile.size/1024/1024).toFixed(1)} MB</p>
                  </div>
                </div>
              </div>
            )}
            
            <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-800">
                <strong>Tip:</strong> Supports images (PNG, JPG) and PDF files. For best results with PDFs, export the first page as an image if automatic conversion fails.
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Show canvas view (fullscreen)
  return (
    <main className="h-screen w-screen bg-gray-900 overflow-hidden">
      {/* Scale control in top-right corner */}
      <div className="absolute top-4 right-4 z-50 bg-white bg-opacity-90 rounded-lg shadow-lg p-4">
        <ScaleControl
          currentScale={scale}
          currentUnit={unit}
          onScaleSet={(s,u)=>{ setScale(s); setUnit(u); }}
          onRequestCalibrate={() => setCalibrateTick(t => t + 1)}
        />
      </div>

      {/* Info message */}
      {infoMessage && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg">
          {infoMessage}
        </div>
      )}

      {/* Fullscreen Canvas */}
      {imageUrl && (
        <FloorplanCanvas 
          imageUrl={imageUrl} 
          scale={scale} 
          scaleUnit={unit}
          onCalibrate={(s,u)=>{ setScale(s); setUnit(u); }}
          requestCalibrateToken={calibrateTick}
          onTrimmedImage={(cropped, _quad, conf)=>{ setImageUrl(cropped); setInfoMessage(`Trimmed frame (confidence ${Math.round((conf||0)*100)}%)`); }}
          onScaleDetected={(s,u,_m,_c)=>{ setScale(s); setUnit(u); }}
          onReset={handleReset}
        />
      )}
    </main>
  );
}
