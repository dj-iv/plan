'use client';

import { useState, useCallback } from 'react';
import FileUpload from '@/components/FileUpload';
import ScaleControl from '@/components/ScaleControl';
import FloorplanCanvas from '@/components/FloorplanCanvas';

export default function Home() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [ocrMessage, setOcrMessage] = useState<string | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [unit, setUnit] = useState<string>('meters');
  const [calibrateTick, setCalibrateTick] = useState<number>(0);
  const [fullscreenTick, setFullscreenTick] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const handleFileUpload = useCallback((file: File, previewUrl?: string) => {
    setUploadedFile(file);
    setImageUrl(previewUrl || (file ? URL.createObjectURL(file) : ''));
    setOcrMessage(null);
    // Nudge fullscreen after upload
    setFullscreenTick(t => t + 1);
  }, []);

  const handleOcrScaleGuess = useCallback((guess: { rawText: string; extractedScale?: number; unit?: string }) => {
    if (guess.extractedScale) {
      setOcrMessage(`Possible scale detected (beta): 1px ≈ ${guess.extractedScale.toFixed(4)} ${guess.unit || ''}`);
    } else {
      setOcrMessage('No clear scale detected automatically. You can set it manually.');
    }
  }, []);

  return (
    <main style={{ position:'relative', minHeight:'100vh', background:'#ffffff' }}>
      <div style={{ maxWidth:960, margin:'0 auto', padding:'32px 16px', fontFamily:'ui-sans-serif, system-ui, -apple-system' }}>
        <header style={{ marginBottom:24 }}>
          <h1 style={{ fontSize:28, fontWeight:700, color:'#111827', margin:0 }}>Floorplan Analyzer</h1>
          <p style={{ color:'#6b7280', marginTop:8 }}>Step 1: Upload a floorplan (image or PDF). Then set scale and measure areas.</p>
        </header>

        {/* Upload */}
        <section style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
          <div style={{ background:'linear-gradient(90deg,#3b82f6,#f97316)', color:'#fff', padding:'10px 14px', fontWeight:600 }}>Upload</div>
          <div style={{ padding:16 }}>
            <FileUpload onFileUpload={handleFileUpload} onPdfImageReady={(d)=> setImageUrl(d)} onOcrScaleGuess={handleOcrScaleGuess} />
            {uploadedFile && (
              <div style={{ marginTop:12, fontSize:12, color:'#065f46', background:'#ecfdf5', border:'1px solid #a7f3d0', padding:'8px 10px', borderRadius:8 }}>
                {uploadedFile.name} • {(uploadedFile.size/1024/1024).toFixed(1)} MB
              </div>
            )}
            {/* Info note for PDFs if processing fails */}
            <div style={{ marginTop:8, fontSize:12, color:'#92400e', background:'#fffbeb', border:'1px solid #fcd34d', padding:'8px 10px', borderRadius:8 }}>
              Tip: If a PDF fails to render, export the first page as an image (PNG/JPG) and upload it.
            </div>
            {ocrMessage && (
              <div style={{ marginTop:12, fontSize:12, color:'#1e40af', background:'#eff6ff', border:'1px solid #bfdbfe', padding:'8px 10px', borderRadius:8 }}>
                {ocrMessage}
              </div>
            )}
          </div>
        </section>

        {/* Scale */}
        <section style={{ marginTop:24, background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
          <div style={{ background:'#f3f4f6', padding:'10px 14px', fontWeight:600, color:'#111827' }}>Scale</div>
          <div style={{ padding:16 }}>
            <ScaleControl
              currentScale={scale}
              currentUnit={unit}
              onScaleSet={(s,u)=>{ setScale(s); setUnit(u); }}
              onRequestCalibrate={() => setCalibrateTick(t => t + 1)}
            />
          </div>
        </section>

        {/* Preview / Canvas */}
        {imageUrl && (
          <section style={{ marginTop:24, background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
            <div style={{ background:'#f3f4f6', padding:'10px 14px', fontWeight:600, color:'#111827' }}>Measure</div>
            <div style={{ padding:16 }}>
              <FloorplanCanvas 
                imageUrl={imageUrl} 
                scale={scale} 
                scaleUnit={unit}
                onCalibrate={(s,u)=>{ setScale(s); setUnit(u); }}
                requestCalibrateToken={calibrateTick}
                requestFullscreenToken={fullscreenTick}
                onFullscreenChange={(fs)=> setIsFullscreen(fs)}
              />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
