'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import FileUpload from '@/components/FileUpload';
import ScaleControl from '@/components/ScaleControl';
import FloorplanCanvas from '@/components/FloorplanCanvas';
import NameProjectModal from '@/components/NameProjectModal';
import { ProjectService } from '@/services/projectService';
import { CanvasState, ProjectSettings, ProjectSummary } from '@/types/project';
import { captureCanvasThumbnail } from '@/utils/thumbnail';
import { onAuthChange, signInWithGoogle, signOutUser, getCurrentUser } from '@/lib/firebaseAuth';

export default function Home() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [unit, setUnit] = useState<string>('meters');
  const [calibrateTick, setCalibrateTick] = useState<number>(0);
  const [showCanvas, setShowCanvas] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [justSaved, setJustSaved] = useState<boolean>(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentProjectName, setCurrentProjectName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadedCanvasState, setLoadedCanvasState] = useState<CanvasState | null>(null);
  const canvasStateRef = useRef<CanvasState | null>(null);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [showNameModal, setShowNameModal] = useState<boolean>(false);
  const [showProjectList, setShowProjectList] = useState<boolean>(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState<string>('');
  const [sortBy, setSortBy] = useState<'lastOpened'|'updated'|'name'|'antennas'>('lastOpened');
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const [logoPxWidth, setLogoPxWidth] = useState<number | null>(null);
  // persist search/sort
  useEffect(() => {
    try {
      const s = localStorage.getItem('projects.search');
      const sb = localStorage.getItem('projects.sortBy');
      if (s !== null) setSearch(s);
      if (sb === 'lastOpened' || sb === 'updated' || sb === 'name' || sb === 'antennas') setSortBy(sb);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('projects.search', search); } catch {}
  }, [search]);
  useEffect(() => {
    try { localStorage.setItem('projects.sortBy', sortBy); } catch {}
  }, [sortBy]);

  const handleFileUpload = useCallback((file: File, previewUrl?: string) => {
    setUploadedFile(file);
    setImageUrl(previewUrl || (file ? URL.createObjectURL(file) : ''));
    // New upload starts a new project draft
    setCurrentProjectId(null);
    setCurrentProjectName(null);
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
    setLoadedCanvasState(null); // Clear loaded state
    setCurrentProjectId(null);
    setCurrentProjectName(null);
    setIsDirty(false);
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const projectList = await ProjectService.getProjectList();
      setProjects(projectList);
    } catch (e) {
      console.error('Failed to load projects', e);
    }
  }, []);

  useEffect(() => {
    // initialize auth email and subscribe to changes
    const u = getCurrentUser();
    setAuthEmail(u?.email || null);
    const unsub = onAuthChange(user => {
      setAuthEmail(user?.email || null);
      // refresh projects after sign-in/out
      loadProjects();
    });
    return unsub;
  }, [loadProjects]);

  const toggleProjectSelection = useCallback((projectId: string) => {
    setSelectedProjectIds(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  }, []);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    const proj = projects.find(p => p.id === projectId);
    const name = proj?.name || projectId;
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;
    try {
      setIsLoading(true);
      await ProjectService.deleteProject(projectId);
      setSelectedProjectIds(prev => { const next = new Set(prev); next.delete(projectId); return next; });
      await loadProjects();
    } catch (e) {
      console.error('Delete failed', e);
      alert('Failed to delete project.');
    } finally {
      setIsLoading(false);
    }
  }, [projects, loadProjects]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedProjectIds.size === 0) return;
    if (!confirm(`Delete ${selectedProjectIds.size} selected project(s)? This cannot be undone.`)) return;
    try {
      setIsLoading(true);
      for (const id of Array.from(selectedProjectIds)) {
        try { await ProjectService.deleteProject(id); } catch {}
      }
      setSelectedProjectIds(new Set());
      await loadProjects();
    } catch (e) {
      console.error('Bulk delete failed', e);
      alert('Failed to delete selected projects.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedProjectIds, loadProjects]);

  const handleClearSelection = useCallback(() => {
    setSelectedProjectIds(new Set());
  }, []);

  

  // Hash canvas state for dirtiness detection
  const computeStateHash = useCallback((state: CanvasState | null): string => {
    if (!state) return '';
    try {
      // cheap stable-ish hash: JSON of selected fields
      const payload = JSON.stringify(state);
      let h = 0;
      for (let i = 0; i < payload.length; i++) {
        h = (h * 31 + payload.charCodeAt(i)) | 0;
      }
      return String(h);
    } catch {
      return String(Date.now());
    }
  }, []);

  const lastSavedHashRef = useRef<string>('');

  useEffect(() => {
    console.log('[Save] showNameModal state changed:', showNameModal);
  }, [showNameModal]);

  const handleSaveProject = useCallback(async (overrideName?: string) => {
    console.log('[Save] handler invoked');
    // If we don't have a project yet, ask for a name via modal (single path)
    let nameToUse = (overrideName ?? currentProjectName)?.trim() || null;
    if (!currentProjectId) {
      if (!nameToUse) {
        console.log('[Save] no currentProjectId and no name → opening name modal');
        setShowNameModal(true);
        setInfoMessage('Name your project to save');
        setTimeout(() => setInfoMessage(null), 2000);
        return; // Wait for modal confirm
      }
      if (!canvasStateRef.current) {
        console.log('[Save] aborted: no canvasStateRef.current');
        alert('Nothing to save yet.');
        return;
      }
      try {
        setIsSaving(true);
        let thumbnailBlob: Blob | undefined = undefined;
        try {
          const canvasEl = document.querySelector('canvas[data-main-canvas="1"]') as HTMLCanvasElement | null;
          if (canvasEl) {
            const blob = await captureCanvasThumbnail(canvasEl, 320, 0.85);
            if (blob) thumbnailBlob = blob;
          }
        } catch {}
        const savedId = await ProjectService.saveProject({
          name: nameToUse,
          description: '',
          canvasState: canvasStateRef.current,
          settings: { units: (unit as any) || 'meters', showRadiusBoundary: true },
          ...(uploadedFile ? { imageFile: uploadedFile } : {}),
          ...(thumbnailBlob ? { thumbnailBlob } : {}),
        }, undefined);
        setCurrentProjectId(savedId);
        lastSavedHashRef.current = computeStateHash(canvasStateRef.current);
        setIsDirty(false);
        setInfoMessage(`Project "${nameToUse}" saved`);
        setTimeout(() => setInfoMessage(null), 2500);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1500);
        loadProjects();
      } catch (e) {
        console.error('Save failed', e);
        alert('Failed to save project.');
      } finally {
        setIsSaving(false);
      }
      return;
    }
    if (!canvasStateRef.current) {
      console.log('[Save] aborted: no canvasStateRef.current');
      alert('Nothing to save yet.');
      return;
    }

    try {
      setIsSaving(true);
      console.log('[Save] updating existing project', { id: currentProjectId });
      let thumbnailBlob: Blob | undefined = undefined;
      try {
        const canvasEl = document.querySelector('canvas[data-main-canvas="1"]') as HTMLCanvasElement | null;
        if (canvasEl) {
          const blob = await captureCanvasThumbnail(canvasEl, 320, 0.85);
          if (blob) thumbnailBlob = blob;
        }
      } catch {}
      const savedId = await ProjectService.saveProject({
        name: (nameToUse || 'Untitled Project'),
        description: '',
        canvasState: canvasStateRef.current,
        settings: { units: (unit as any) || 'meters', showRadiusBoundary: true },
        ...(uploadedFile ? { imageFile: uploadedFile } : {}),
        ...(thumbnailBlob ? { thumbnailBlob } : {}),
      }, currentProjectId || undefined);
  if (!currentProjectId) setCurrentProjectId(savedId);
  // record last saved state hash
  lastSavedHashRef.current = computeStateHash(canvasStateRef.current);
  setIsDirty(false);
  console.log('[Save] update complete');
  setInfoMessage(`Project "${nameToUse}" saved`);
      setTimeout(() => setInfoMessage(null), 2500);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
      // Refresh project list
      loadProjects();
    } catch (e) {
      console.error('Save failed', e);
      alert('Failed to save project.');
    } finally {
      setIsSaving(false);
    }
  }, [uploadedFile, unit, currentProjectId, currentProjectName, loadProjects, computeStateHash]);

  const handleLoadProject = useCallback(async (projectId: string) => {
    try {
      setIsLoading(true);
      const projectData = await ProjectService.getProject(projectId);
      if (!projectData) {
        alert('Project not found');
        return;
      }

      // Load project data into state
      setUploadedFile(null); // We don't have the original file, just the image URL
      console.log('Loading project image URL:', projectData.metadata.imageUrl);
      
      // Ensure we have a valid image URL before proceeding
      if (!projectData.metadata.imageUrl) {
        alert('Project has no associated image');
        return;
      }
      
      setImageUrl(projectData.metadata.imageUrl);
      // Always set scale from loaded project, even if null
      if (typeof projectData.canvasState.scale === 'number') {
        setScale(projectData.canvasState.scale);
      } else {
        setScale(null);
      }
      setUnit(projectData.settings.units || 'meters');
      setLoadedCanvasState(projectData.canvasState); // Set the loaded state for restoration
      canvasStateRef.current = projectData.canvasState;
  setCurrentProjectId(projectData.id);
  setCurrentProjectName(projectData.name);
    // reset dirty tracking to clean baseline
    lastSavedHashRef.current = computeStateHash(projectData.canvasState);
    setIsDirty(false);
      
      setInfoMessage(`Loaded project "${projectData.name}"`);
      setTimeout(() => setInfoMessage(null), 2500);
      
      // Switch to canvas view
      setTimeout(() => {
        setShowCanvas(true);
      }, 500);
    } catch (e) {
      console.error('Failed to load project', e);
      alert('Failed to load project.');
    } finally {
      setIsLoading(false);
    }
  }, [computeStateHash]);

  // Load projects on component mount
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Keep the logo width in sync with the title width
  useEffect(() => {
    const update = () => {
      if (titleRef.current) {
        const w = titleRef.current.offsetWidth;
        if (w && Math.abs((logoPxWidth || 0) - w) > 2) setLogoPxWidth(w);
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [logoPxWidth]);

  // Track dirty state whenever canvas state changes
  useEffect(() => {
    const currentHash = computeStateHash(canvasStateRef.current);
    setIsDirty(currentHash !== lastSavedHashRef.current);
  }, [loadedCanvasState, computeStateHash]);

  // Global Ctrl+S to trigger save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        console.log('Ctrl+S pressed');
        handleSaveProject();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSaveProject]);

  // Fallback: listen for custom save events from canvas
  useEffect(() => {
    const onRequestSave = () => {
      console.log('[Save] custom event received');
      handleSaveProject();
    };
    // @ts-ignore - custom event type
    window.addEventListener('request-save', onRequestSave);
    return () => {
      // @ts-ignore
      window.removeEventListener('request-save', onRequestSave);
    };
  }, [handleSaveProject]);

  // Show upload screen if no canvas view
  if (!showCanvas) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div className="w-full">
          {/* Hero (narrow) */}
          <div className="w-full max-w-2xl mx-auto">
            <div className="text-center mb-6">
              <div className="mx-auto mb-4" style={{ width: logoPxWidth ? `${logoPxWidth}px` : undefined }}>
                <picture>
                  <source srcSet="/uctel-logo.png" type="image/png" />
                  <img
                    src="/uctel-logo.svg"
                    alt="UCtel"
                    className="h-16 w-full object-contain select-none mx-auto block"
                    onError={(e)=>{ (e.currentTarget as HTMLImageElement).style.display='none'; console.warn('UCtel logo missing'); }}
                  />
                </picture>
              </div>
              <h1 ref={titleRef} className="text-4xl font-bold text-gray-900 mb-4">Floorplan Analyser</h1>
              <p className="text-lg text-gray-600">Upload your floorplan to start analysing areas, measurements, and antenna coverage</p>
            </div>
          </div>

          {/* Large Upload Area (wide to match bar) */}
          <div className="w-full max-w-7xl mx-auto bg-white rounded-2xl shadow-xl p-8">
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
            
            {/* Tip removed per request */}
          </div>

          {/* Projects controls (wide) */}
          <div className="w-full max-w-7xl mx-auto mt-10 rounded-2xl shadow-xl p-4 bg-gradient-to-r from-[#2C5E78] to-[#16899A] bg-opacity-95 backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setShowProjectList(v => !v)}
                  className="px-4 py-2 rounded-full bg-white/10 text-white border border-white/20 hover:bg-white/20 transition"
                  disabled={isLoading}
                  title={showProjectList ? 'Hide Projects' : 'Load Existing Projects'}
                >
                  {showProjectList ? 'Hide Projects' : 'Load Projects'}
                </button>
                {showProjectList && (
                  <>
                    <input
                      value={search}
                      onChange={(e)=> setSearch(e.target.value)}
                      placeholder="Search by name…"
                      className="px-3 py-2 rounded-full bg-white/90 text-gray-800 placeholder-gray-500 text-sm focus:outline-none shadow-sm"
                    />
                    <select
                      value={sortBy}
                      onChange={(e)=> setSortBy(e.target.value as any)}
                      className="px-3 py-2 rounded-full bg-white/90 text-gray-800 text-sm focus:outline-none shadow-sm"
                    >
                      <option value="lastOpened">Last opened</option>
                      <option value="updated">Updated</option>
                      <option value="name">Name</option>
                      <option value="antennas">Antennas</option>
                    </select>
                    <span className="text-white/90 text-sm">{selectedProjectIds.size} selected</span>
                    <button
                      onClick={handleDeleteSelected}
                      className="px-3 py-2 rounded-full bg-[#E28743] text-white hover:brightness-110 text-sm transition"
                      disabled={isLoading || selectedProjectIds.size === 0}
                    >
                      Delete Selected
                    </button>
                    <button
                      onClick={handleClearSelection}
                      className="px-3 py-2 rounded-full bg-white/10 text-white border border-white/20 hover:bg-white/20 text-sm transition"
                      disabled={selectedProjectIds.size === 0}
                    >
                      Clear
                    </button>
                    <button
                      onClick={loadProjects}
                      className="px-3 py-2 rounded-full bg-white text-[#2C5E78] hover:bg-blue-50 text-sm transition"
                      disabled={isLoading}
                    >
                      Refresh
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 ml-auto basis-full sm:basis-auto justify-end">
                {authEmail ? (
                  <>
                    <span className="text-white/90 text-sm hidden sm:inline">{authEmail}</span>
                    <button
                      onClick={() => signOutUser()}
                      className="px-3 py-2 rounded-full bg-white/10 text-white border border-white/20 hover:bg-white/20 text-sm transition"
                    >
                      Logout
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => signInWithGoogle()}
                    className="px-4 py-2 rounded-full bg-white text-[#16899A] hover:bg-blue-50 text-sm transition"
                  >
                    Login with Google
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Project List (wide) */}
          {showProjectList && (
            <div className="w-full max-w-7xl mx-auto mt-4 bg-white rounded-2xl shadow-xl">
              {(() => {
                const filtered = projects
                  .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
                  .sort((a,b) => {
                    if (sortBy === 'name') return a.name.localeCompare(b.name);
                    if (sortBy === 'antennas') return b.antennaCount - a.antennaCount;
                    if (sortBy === 'updated') return b.updatedAt.getTime() - a.updatedAt.getTime();
                    const aT = a.lastOpenedAt?.getTime?.() || 0; const bT = b.lastOpenedAt?.getTime?.() || 0; return bT - aT;
                  });
                if (filtered.length === 0) {
                  return (
                    <div className="p-8 text-center text-gray-500">
                      <p>No projects found. Try refreshing or uploading a new project.</p>
                    </div>
                  );
                }
                return (
                  <ul className="divide-y divide-gray-200">
                    {filtered.map((project) => {
                  const selected = selectedProjectIds.has(project.id);
                  const last = project.lastOpenedAt || project.updatedAt;
                  const lastLabel = project.lastOpenedAt ? 'Last opened' : 'Updated';
                  return (
                    <li key={project.id} className={`group p-4 hover:bg-gray-50 cursor-pointer ${selected ? 'bg-blue-50' : ''}`} onClick={() => handleLoadProject(project.id)}>
                      <div className="flex items-start gap-3">
                        <div onClick={(e)=>e.stopPropagation()} className="pt-1">
                          <input
                            type="checkbox"
                            className="h-4 w-4 text-blue-600 rounded border-gray-300"
                            checked={selected}
                            onChange={() => toggleProjectSelection(project.id)}
                          />
                        </div>
                        {project.thumbnailUrl ? (
                          <img src={project.thumbnailUrl} alt="thumb" className="w-16 h-16 object-cover rounded border" onClick={(e)=>e.stopPropagation()} />
                        ) : (
                          <div className="w-16 h-16 rounded border bg-gray-50 text-gray-400 flex items-center justify-center text-xs" onClick={(e)=>e.stopPropagation()}>No preview</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h3 className="font-medium text-gray-900 pr-4 break-words">{project.name}</h3>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-500 whitespace-nowrap">{lastLabel}: {last.toLocaleString()}</span>
                              {isLoading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />}
                            </div>
                          </div>
                          <div className="mt-1 text-sm text-gray-600">
                            {project.antennaCount} antennas • {project.areaCount} areas
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-2" onClick={(e)=>e.stopPropagation()}>
                          <button
                            className="px-3 py-1.5 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 text-sm"
                            disabled={isLoading}
                            onClick={()=> handleLoadProject(project.id)}
                          >
                            Load
                          </button>
                          <InlineDeleteButton onConfirm={()=> handleDeleteProject(project.id)} disabled={isLoading} />
                        </div>
                      </div>
                    </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </div>
          )}
        </div>
      </main>
    );
  }

  // Show canvas view (fullscreen)
  return (
    <main className="h-screen w-screen bg-gray-900 overflow-hidden">
      {typeof window !== 'undefined' && createPortal(
        <div className="fixed top-4 right-4" data-keep style={{ zIndex: 2147483600, pointerEvents: 'auto' }} onClick={() => console.log('Save panel clicked')}>
          <div className="bg-white bg-opacity-90 rounded-lg shadow-lg p-4 space-y-3">
            <ScaleControl
              currentScale={scale}
              currentUnit={unit}
              onScaleSet={(s,u)=>{ setScale(s); setUnit(u); }}
              onRequestCalibrate={() => setCalibrateTick(t => t + 1)}
            />
            <button
              onClick={() => { console.log('Top-right Save clicked'); handleSaveProject(); }}
              disabled={isSaving || (!!currentProjectId && !isDirty)}
              className={`w-full px-4 py-2 rounded-md text-white font-medium ${
                isSaving ? 'bg-blue-400 cursor-not-allowed'
                : justSaved ? 'bg-green-600'
                : (!!currentProjectId && !isDirty) ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
              }`}
              title="Save current project"
            >
              {isSaving ? 'Saving…' : justSaved ? 'Saved ✓' : currentProjectId ? (isDirty ? 'Update Project' : 'Up to date') : 'Save Project'}
            </button>

            {/* Inline popover removed; NameProjectModal below handles naming */}
          </div>
        </div>,
        document.body
      )}

      {/* Save modal handled by NameProjectModal portal */}

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
          onStateChange={(state)=>{ canvasStateRef.current = state as CanvasState; const h = computeStateHash(canvasStateRef.current); setIsDirty(h !== lastSavedHashRef.current); }}
          onSaveProject={handleSaveProject}
          loadedCanvasState={loadedCanvasState}
          isSaving={isSaving}
          justSaved={justSaved}
          isUpdate={!!currentProjectId}
        />
      )}

      {/* Name modal for first save */}
      <NameProjectModal
        open={showNameModal}
        defaultName={uploadedFile?.name?.replace(/\.[^.]+$/, '') || currentProjectName || 'Untitled Project'}
        isSaving={isSaving}
        onCancel={() => setShowNameModal(false)}
        onConfirm={(name) => { setShowNameModal(false); setCurrentProjectName(name); handleSaveProject(name); }}
      />
    </main>
  );
}

function InlineDeleteButton({ onConfirm, disabled }: { onConfirm: ()=>void; disabled?: boolean }) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 2000);
    return () => clearTimeout(t);
  }, [arm]);
  return arm ? (
    <button
      className="px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 text-sm"
      onClick={onConfirm}
      disabled={disabled}
      title="Confirm delete"
    >
      Confirm
    </button>
  ) : (
    <button
      className="px-3 py-1.5 rounded-md bg-red-50 text-red-700 hover:bg-red-100 text-sm"
      onClick={() => setArm(true)}
      disabled={disabled}
      title="Delete project"
    >
      Delete
    </button>
  );
}
