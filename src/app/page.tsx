'use client';

import { useState, useCallback } from 'react';
import FileUpload from '@/components/FileUpload';
import FloorplanCanvas from '@/components/FloorplanCanvas';
import ScaleControl from '@/components/ScaleControl';

export default function Home() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [scale, setScale] = useState<number | null>(null);
  const [scaleUnit, setScaleUnit] = useState<string>('meters');

  const handleFileUpload = useCallback((file: File) => {
    setUploadedFile(file);
    const url = URL.createObjectURL(file);
    setImageUrl(url);
  }, []);

  const handleScaleSet = useCallback((newScale: number, unit: string) => {
    setScale(newScale);
    setScaleUnit(unit);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Floorplan Analyzer
          </h1>
          <p className="text-gray-600">
            Upload floorplans, detect scales, and calculate areas with AI assistance
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* File Upload */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="text-lg font-semibold mb-4">Upload Floorplan</h2>
              <FileUpload onFileUpload={handleFileUpload} />
              
              {uploadedFile && (
                <div className="mt-4 p-3 bg-green-50 rounded border border-green-200">
                  <p className="text-sm text-green-800">
                    ✓ {uploadedFile.name}
                  </p>
                  <p className="text-xs text-green-600">
                    {(uploadedFile.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
              )}
            </div>

            {/* Scale Control */}
            {imageUrl && (
              <div className="bg-white rounded-lg shadow-sm border p-6 mt-6">
                <h2 className="text-lg font-semibold mb-4">Scale Settings</h2>
                <ScaleControl 
                  onScaleSet={handleScaleSet}
                  currentScale={scale}
                  currentUnit={scaleUnit}
                />
              </div>
            )}
          </div>

          {/* Main Canvas Area */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-lg shadow-sm border">
              {imageUrl ? (
                <FloorplanCanvas 
                  imageUrl={imageUrl}
                  scale={scale}
                  scaleUnit={scaleUnit}
                />
              ) : (
                <div className="flex items-center justify-center h-96 text-gray-500">
                  <div className="text-center">
                    <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <p className="text-lg">Upload a floorplan to get started</p>
                    <p className="text-sm">Supports PDF, JPG, PNG files</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
