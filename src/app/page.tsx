'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { getDownloadURL, ref } from 'firebase/storage';
import FileUpload from '@/components/FileUpload';
import FloorUpload from '@/components/FloorUpload';
import ScaleControl from '@/components/ScaleControl';
import FloorplanCanvas from '@/components/FloorplanCanvas';
import NameProjectModal from '@/components/NameProjectModal';
import { ProjectService } from '@/services/projectService';
import { FloorService } from '@/services/floorService';
import { CanvasState, ProjectSummary, FloorSummary, FloorData, FloorEntry, Units, ProjectEngineer } from '@/types/project';
import { FloorNameAiStatus, FloorNameAiResponse } from '@/types/ai';
import { captureCanvasThumbnail } from '@/utils/thumbnail';
import { computeFloorStatistics, normaliseUnit } from '@/utils/floorStats';
import { onAuthChange, signInWithGoogle, signOutUser, getCurrentUser, ensureAnonymousAuth } from '@/lib/firebaseAuth';
import { storage } from '@/lib/firebase';

declare global {
  interface WindowEventMap {
    'request-save': CustomEvent<void>;
  }
}
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
  const [sortBy, setSortBy] = useState<'lastOpened'|'name'|'antennas'>('lastOpened');
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [, setCurrentEngineer] = useState<ProjectEngineer | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const [logoPxWidth, setLogoPxWidth] = useState<number | null>(null);
  const logoSource = '/uctel-logo.png';
  const [showLogo, setShowLogo] = useState<boolean>(true);
  const [floorNameAiStatuses, setFloorNameAiStatuses] = useState<Record<string, FloorNameAiStatus>>({});
  const autoFloorNameAttemptsRef = useRef<Set<string>>(new Set());

  const deriveEngineer = useCallback((input?: { displayName?: string | null; email?: string | null; uid?: string | null }): ProjectEngineer | null => {
    if (!input) return null;
    const email = input.email || undefined;
    const displayNameSrc = input.displayName || undefined;
    let displayName = displayNameSrc && displayNameSrc.trim().length > 0 ? displayNameSrc.trim() : undefined;
    if (!displayName && email) {
      const local = email.split('@')[0] || '';
      if (local) {
        displayName = local
          .replace(/[._-]+/g, ' ')
          .split(' ')
          .filter(Boolean)
          .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
          .join(' ');
      }
    }
    if (!displayName && !email) return input.uid ? { uid: input.uid || undefined } : null;
    return {
      uid: input.uid || undefined,
      email,
      displayName,
    };
  }, []);

  const resolveOwnerName = useCallback((engineer?: ProjectEngineer | null): string => {
    if (!engineer) return 'Unknown owner';
    if (engineer.displayName && engineer.displayName.trim().length > 0) {
      return engineer.displayName.trim();
    }
    if (engineer.email && engineer.email.trim().length > 0) {
      const local = engineer.email.split('@')[0] || '';
      if (local) {
        return local
          .replace(/[._-]+/g, ' ')
          .split(' ')
          .filter(Boolean)
          .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
          .join(' ');
      }
    }
    return 'Unknown owner';
  }, []);
  
  // Multi-floor state
  const [floors, setFloors] = useState<FloorEntry[]>([]);
  const [currentFloorId, setCurrentFloorId] = useState<string | null>(null);
  const [floorsLoading, setFloorsLoading] = useState<boolean>(false);
  const [showFloorUpload, setShowFloorUpload] = useState<boolean>(false);
  const [floorUploadTargetProjectId, setFloorUploadTargetProjectId] = useState<string | null>(null);
  const [canvasInstanceKey, setCanvasInstanceKey] = useState<number>(0);

  const floorStateHashesRef = useRef<Map<string, string>>(new Map());

  const resolveImageUrl = useCallback(async (metadata?: { imageUrl?: string; storagePath?: string; thumbnailUrl?: string }): Promise<string | null> => {
    if (!metadata) {
      return null;
    }

    const directUrl = typeof metadata.imageUrl === 'string' && metadata.imageUrl.trim().length > 0
      ? metadata.imageUrl
      : null;
    if (directUrl) {
      return directUrl;
    }

    if (metadata.storagePath) {
      try {
        const downloadUrl = await getDownloadURL(ref(storage, metadata.storagePath));
        return downloadUrl;
      } catch (err) {
        console.warn('Failed to resolve image URL from storage path', metadata.storagePath, err);
      }
    }

    const fallbackThumb = typeof metadata.thumbnailUrl === 'string' && metadata.thumbnailUrl.trim().length > 0
      ? metadata.thumbnailUrl
      : null;
    return fallbackThumb;
  }, []);

  const fileToDataUrl = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  const handleLogoLoadError = useCallback(() => {
    console.warn('UCtel logo missing, hiding image');
    setShowLogo(false);
  }, [setShowLogo]);

  const computeStateHash = useCallback((state: CanvasState | null): string => {
    if (!state) return '';
    try {
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

  const toFloorEntry = useCallback((floor: FloorData): FloorEntry => {
    const canvasState = floor.canvasState || ({} as CanvasState);
    const statsUnits = floor.stats && floor.units
      ? { stats: floor.stats, units: floor.units }
      : computeFloorStatistics(canvasState);
    const stateHash = computeStateHash(canvasState);
    floorStateHashesRef.current.set(floor.id, stateHash);
    return {
      id: floor.id,
      name: floor.name,
      orderIndex: floor.orderIndex ?? 0,
      createdAt: floor.createdAt,
      updatedAt: floor.updatedAt,
      thumbnailUrl: floor.metadata?.thumbnailUrl,
      imageUrl: floor.metadata?.imageUrl,
      imageFile: undefined,
      canvasState,
      stats: statsUnits.stats,
      units: statsUnits.units,
      scale: typeof canvasState.scale === 'number' ? canvasState.scale : null,
      dirty: false,
      persisted: true,
      loaded: true,
      stateHash,
    };
  }, [computeStateHash]);

  const updateFloorEntry = useCallback((floorId: string, updater: (entry: FloorEntry) => FloorEntry) => {
    setFloors(prev => prev.map(entry => (entry.id === floorId ? updater(entry) : entry)));
  }, []);

  const previousFloorIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentFloorId && previousFloorIdRef.current !== currentFloorId) {
      setCanvasInstanceKey(key => key + 1);
    }
    previousFloorIdRef.current = currentFloorId;
  }, [currentFloorId]);

  const floorSummaries = useMemo<FloorSummary[]>(() =>
    floors.map(entry => ({
      id: entry.id,
      name: entry.name,
      orderIndex: entry.orderIndex,
      updatedAt: entry.updatedAt,
      thumbnailUrl: entry.thumbnailUrl,
      antennaCount: entry.stats.antennaCount,
      areaCount: entry.stats.areaCount,
      totalArea: entry.stats.totalArea,
      units: entry.units,
      areaSummaries: entry.stats.areaSummaries,
      antennaRange: entry.stats.antennaRange,
    })),
  [floors]);
  // persist search/sort
  useEffect(() => {
    try {
      const s = localStorage.getItem('projects.search');
  const sb = localStorage.getItem('projects.sortBy');
  if (s !== null) setSearch(s);
  if (sb === 'lastOpened' || sb === 'name' || sb === 'antennas') setSortBy(sb as any);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('projects.search', search); } catch {}
  }, [search]);
  useEffect(() => {
    try { localStorage.setItem('projects.sortBy', sortBy); } catch {}
  }, [sortBy]);

  const handleInitialFloorUpload = useCallback((uploadedFloors: Array<{ file: File; previewUrl?: string; name: string }>) => {
    if (uploadedFloors.length === 0) {
      return;
    }

  floorStateHashesRef.current.clear();

  const now = new Date();
    const additions: FloorEntry[] = uploadedFloors.map((item, index) => {
      const floorId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `local-${Date.now()}-${index}`;
      const isDataUrlPreview = !!item.previewUrl && item.previewUrl.startsWith('data:');
      const preview = isDataUrlPreview ? item.previewUrl : URL.createObjectURL(item.file);
      const blankState = {} as CanvasState;
      const stateHash = computeStateHash(blankState);
      floorStateHashesRef.current.set(floorId, stateHash);
      return {
        id: floorId,
        name: item.name || `Floor ${index + 1}`,
        orderIndex: index,
        createdAt: now,
        updatedAt: now,
        thumbnailUrl: isDataUrlPreview ? item.previewUrl : preview,
        imageUrl: preview,
        imageFile: item.file,
        canvasState: blankState,
  stats: { antennaCount: 0, areaCount: 0, totalArea: 0, areaSummaries: [], antennaRange: null },
        units: normaliseUnit(unit as Units),
        scale: null,
        dirty: true,
        persisted: false,
        loaded: false,
        stateHash,
      };
    });

    setFloors(additions);
    const nextStatuses: Record<string, FloorNameAiStatus> = {};
    additions.forEach(item => {
      nextStatuses[item.id] = { status: 'idle' };
    });
    setFloorNameAiStatuses(nextStatuses);
    autoFloorNameAttemptsRef.current.clear();

    const first = additions[0];
    setCurrentFloorId(first.id);
    setUploadedFile(first.imageFile || null);
    setImageUrl(first.imageUrl || '');
    setLoadedCanvasState(null);
    canvasStateRef.current = null;

    setCurrentProjectId(null);
    setCurrentProjectName(null);
    setScale(null);
    setInfoMessage(additions.length === 1 ? '1 floor staged for analysis' : `${additions.length} floors staged for analysis`);
    setTimeout(() => setInfoMessage(null), 3000);

    setTimeout(() => {
      setShowCanvas(true);
    }, 250);
  }, [computeStateHash, unit]);

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
    // Reset floor-related state
    setFloors([]);
    setCurrentFloorId(null);
    setShowFloorUpload(false);
    floorStateHashesRef.current.clear();
    setCanvasInstanceKey(0);
    setFloorNameAiStatuses({});
    autoFloorNameAttemptsRef.current.clear();
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
    // Initialize auth state AFTER Firebase restores session; then subscribe to changes
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        await ensureAnonymousAuth();
      } catch (e) {
        console.warn('Auth init warning:', e);
      }
      const u = getCurrentUser();
      setAuthEmail(u?.email || null);
      setCurrentEngineer(deriveEngineer({ displayName: u?.displayName, email: u?.email, uid: u?.uid }));
      unsub = onAuthChange(user => {
        const email = user?.email || null;
        setAuthEmail(email);
        setCurrentEngineer(deriveEngineer({ displayName: user?.displayName, email: user?.email, uid: user?.uid }));
        if (email) {
          loadProjects();
        } else {
          // Signed out: clear loaded state/UI selections
          setProjects([]);
          setSelectedProjectIds(new Set());
          setShowProjectList(false);
          setCurrentProjectId(null);
          setCurrentProjectName(null);
        }
      });
    })();
    return () => { if (unsub) unsub(); };
  }, [loadProjects, deriveEngineer]);

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

  // Floor management functions
  const loadFloors = useCallback(async (projectId: string) => {
    if (!projectId) {
      setFloors([]);
      return;
    }
    try {
      setFloorsLoading(true);
      floorStateHashesRef.current.clear();
      const summaries = await FloorService.listFloors(projectId);
      const entries: FloorEntry[] = [];
      for (const summary of summaries) {
        try {
          const data = await FloorService.getFloor(projectId, summary.id);
          if (data) {
            let resolvedMetadata = data.metadata;
            const resolvedImageUrl = await resolveImageUrl(data.metadata);
            if (resolvedImageUrl && resolvedImageUrl !== data.metadata?.imageUrl) {
              resolvedMetadata = { ...data.metadata, imageUrl: resolvedImageUrl };
            }

            const entry = toFloorEntry({ ...data, metadata: resolvedMetadata });
            entries.push({
              ...entry,
              imageUrl: resolvedImageUrl || entry.imageUrl,
              thumbnailUrl: entry.thumbnailUrl || resolvedImageUrl || entry.imageUrl,
            });
          }
        } catch (err) {
          console.warn('Failed to load floor', summary.id, err);
        }
      }
      entries.sort((a, b) => a.orderIndex - b.orderIndex);
      setFloors(entries);
      const statusMap: Record<string, FloorNameAiStatus> = {};
      entries.forEach(entry => {
        statusMap[entry.id] = { status: 'idle' };
      });
      setFloorNameAiStatuses(statusMap);
      entries.forEach(entry => {
        autoFloorNameAttemptsRef.current.add(entry.id);
      });

      if (!currentFloorId && entries.length > 0) {
        setCurrentFloorId(entries[0].id);
      }
    } catch (e) {
      console.error('Failed to load floors', e);
      setFloors([]);
    } finally {
      setFloorsLoading(false);
    }
  }, [currentFloorId, toFloorEntry, resolveImageUrl]);

  const handleSelectFloor = useCallback(async (floorId: string) => {
    if (floorId === currentFloorId) {
      return;
    }

    let entry = floors.find(f => f.id === floorId);
    if (!entry) return;

    if (!entry.loaded && currentProjectId) {
      try {
        const floorData = await FloorService.getFloor(currentProjectId, floorId);
        if (floorData) {
          const resolvedImageUrl = await resolveImageUrl(floorData.metadata);
          const hydratedEntry = toFloorEntry({
            ...floorData,
            metadata: resolvedImageUrl && resolvedImageUrl !== floorData.metadata?.imageUrl
              ? { ...floorData.metadata, imageUrl: resolvedImageUrl }
              : floorData.metadata,
          });
          entry = {
            ...hydratedEntry,
            imageUrl: resolvedImageUrl || hydratedEntry.imageUrl,
            thumbnailUrl: hydratedEntry.thumbnailUrl || resolvedImageUrl || hydratedEntry.imageUrl,
          };
          setFloors(prev => prev.map(f => (f.id === floorId ? entry! : f)));
        }
      } catch (e) {
        console.error('Failed to load floor data', e);
      }
    }

    const resolvedImageUrl = (entry.imageUrl && entry.imageUrl.trim().length > 0)
      ? entry.imageUrl
      : (entry.imageFile ? URL.createObjectURL(entry.imageFile) : imageUrl);

    setCurrentFloorId(entry.id);
    setScale(typeof entry.scale === 'number' ? entry.scale : null);
    setUnit(entry.units || 'meters');
    setImageUrl(resolvedImageUrl || '');
    setLoadedCanvasState(entry.canvasState);
    canvasStateRef.current = entry.canvasState;

    setShowCanvas(true);
  }, [currentFloorId, floors, currentProjectId, toFloorEntry, imageUrl, resolveImageUrl]);

  const handleAddFloor = useCallback(async () => {
    setFloorUploadTargetProjectId(currentProjectId ?? null);
    setShowFloorUpload(true);
  }, [currentProjectId]);

  const handleFloorUpload = useCallback(async (uploadedFloors: Array<{ file: File; previewUrl?: string; name: string }>) => {
    const targetProjectId = floorUploadTargetProjectId;
    setShowFloorUpload(false);
    setFloorUploadTargetProjectId(null);

    const effectiveProjectId = targetProjectId ?? currentProjectId;

    const now = new Date();

    if (!effectiveProjectId) {
      const highestOrder = floors.reduce((max, entry) => (
        typeof entry.orderIndex === 'number' ? Math.max(max, entry.orderIndex) : max
      ), -1);
      const nextOrderStart = highestOrder + 1;

      const additions: FloorEntry[] = uploadedFloors.map((item, index) => {
        const localId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `local-${Date.now()}-${index}`;
        const preview = item.previewUrl || URL.createObjectURL(item.file);
        const blankState = {} as CanvasState;
        const stateHash = computeStateHash(blankState);
        floorStateHashesRef.current.set(localId, stateHash);
        return {
          id: localId,
          name: item.name,
          orderIndex: nextOrderStart + index,
          createdAt: now,
          updatedAt: now,
          thumbnailUrl: item.previewUrl,
          imageUrl: preview,
          imageFile: item.file,
          canvasState: blankState,
          stats: { antennaCount: 0, areaCount: 0, totalArea: 0, areaSummaries: [], antennaRange: null },
          units: normaliseUnit(unit as Units),
          scale: null,
          dirty: true,
          persisted: false,
          loaded: false,
          stateHash,
        };
      });

      setFloors(prev => [...prev, ...additions]);
      setFloorNameAiStatuses(prev => {
        const next = { ...prev } as Record<string, FloorNameAiStatus>;
        additions.forEach(item => {
          next[item.id] = { status: 'idle' };
          autoFloorNameAttemptsRef.current.delete(item.id);
        });
        return next;
      });

      if (!currentFloorId && additions.length > 0) {
        const first = additions[0];
        setCurrentFloorId(first.id);
        setImageUrl(first.imageUrl || '');
        setUploadedFile(first.imageFile || null);
        setShowCanvas(true);
      }

      const floorWord = additions.length === 1 ? 'floor added locally' : 'floors added locally';
      setInfoMessage(`${additions.length} ${floorWord}`);
      setTimeout(() => setInfoMessage(null), 2500);
      return;
    }

    if (effectiveProjectId !== currentProjectId) {
      try {
        setIsLoading(true);
        let nextOrderStart = -1;
        try {
          const existingFloors = await FloorService.listFloors(effectiveProjectId);
          nextOrderStart = existingFloors.reduce((max, summary) => (
            typeof summary.orderIndex === 'number' ? Math.max(max, summary.orderIndex) : max
          ), -1) + 1;
        } catch (err) {
          console.warn('Could not load existing floors for project', effectiveProjectId, err);
          nextOrderStart = 0;
        }

        for (let i = 0; i < uploadedFloors.length; i++) {
          const { file, previewUrl, name } = uploadedFloors[i];
          let thumbnailBlob: Blob | undefined;
          if (previewUrl) {
            try {
              const response = await fetch(previewUrl);
              thumbnailBlob = await response.blob();
            } catch (err) {
              console.warn('Failed to generate thumbnail blob', err);
            }
          }

          await FloorService.addFloor(effectiveProjectId, {
            name,
            canvasState: {} as CanvasState,
            imageFile: file,
            thumbnailBlob,
          }, nextOrderStart + i);
        }

        const floorWord = uploadedFloors.length === 1 ? 'floor' : 'floors';
        setInfoMessage(`${uploadedFloors.length} ${floorWord} added to project`);
        setTimeout(() => setInfoMessage(null), 2500);
        await loadProjects();
      } catch (e) {
        console.error('Failed to add floors to project', e);
        alert('Failed to add floors to selected project.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    try {
      setFloorsLoading(true);
      const highestOrder = floors.reduce((max, entry) => (
        typeof entry.orderIndex === 'number' ? Math.max(max, entry.orderIndex) : max
      ), -1);
      const nextOrderStart = highestOrder + 1;
      const hadExistingFloors = floors.length > 0;
      for (let i = 0; i < uploadedFloors.length; i++) {
        const { file, previewUrl, name } = uploadedFloors[i];
        let thumbnailBlob: Blob | undefined;
        if (previewUrl) {
          try {
            const response = await fetch(previewUrl);
            thumbnailBlob = await response.blob();
          } catch (err) {
            console.warn('Failed to generate thumbnail blob', err);
          }
        }

        const newFloorId = await FloorService.addFloor(effectiveProjectId, {
          name,
          canvasState: {} as CanvasState,
          imageFile: file,
          thumbnailBlob,
        }, nextOrderStart + i);

        const floorData = await FloorService.getFloor(effectiveProjectId, newFloorId);
        if (floorData) {
          setFloors(prev => {
            const updated = [...prev, toFloorEntry(floorData)];
            return updated.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
          });
          setFloorNameAiStatuses(prev => ({
            ...prev,
            [floorData.id]: { status: 'idle' },
          }));
          autoFloorNameAttemptsRef.current.delete(floorData.id);
        }

        if (!hadExistingFloors && i === 0) {
          const preview = previewUrl || URL.createObjectURL(file);
          setCurrentFloorId(newFloorId);
          setImageUrl(preview);
          setUploadedFile(file);
          setLoadedCanvasState(null);
          canvasStateRef.current = null;
          setScale(null);
          setShowCanvas(true);
        }
      }

      const floorWord = uploadedFloors.length === 1 ? 'floor' : 'floors';
      setInfoMessage(`${uploadedFloors.length} ${floorWord} added successfully`);
      setTimeout(() => setInfoMessage(null), 2500);
    } catch (e) {
      console.error('Failed to add floors', e);
      alert('Failed to add floors.');
    } finally {
      setFloorsLoading(false);
    }
  }, [currentProjectId, currentFloorId, floors, floorUploadTargetProjectId, toFloorEntry, unit, computeStateHash, loadProjects]);

  const handleCancelFloorUpload = useCallback(() => {
    setShowFloorUpload(false);
    setFloorUploadTargetProjectId(null);
  }, []);

  const handleRenameFloor = useCallback(async (floorId: string, name: string) => {
    if (!currentProjectId) {
      // For unsaved projects, just update local state
      updateFloorEntry(floorId, floor => ({
        ...floor,
        name,
        dirty: true,
        updatedAt: new Date(),
      }));
      setInfoMessage(`Floor renamed to "${name}"`);
      setTimeout(() => setInfoMessage(null), 2000);
      return;
    }
    
    try {
      await FloorService.renameFloor(currentProjectId, floorId, name);
      await loadFloors(currentProjectId);
      setInfoMessage(`Floor renamed to "${name}"`);
      setTimeout(() => setInfoMessage(null), 2000);
    } catch (e) {
      console.error('Failed to rename floor', e);
      alert('Failed to rename floor.');
    }
  }, [currentProjectId, loadFloors, updateFloorEntry]);

  const handleDetectFloorName = useCallback(async (floorId: string) => {
    const entry = floors.find(f => f.id === floorId);
    if (!entry) {
      return;
    }

    setFloorNameAiStatuses(prev => ({
      ...prev,
      [floorId]: { status: 'loading' },
    }));

    try {
      let imageReference: string | null = null;
      if (entry.imageUrl && !entry.imageUrl.startsWith('blob:')) {
        imageReference = entry.imageUrl;
      }

      if (!imageReference && entry.imageFile) {
        imageReference = await fileToDataUrl(entry.imageFile);
      }

      if (!imageReference && currentFloorId === floorId && imageUrl && !imageUrl.startsWith('blob:')) {
        imageReference = imageUrl;
      }

      if (!imageReference && entry.imageFile) {
        imageReference = await fileToDataUrl(entry.imageFile);
      }

      if (!imageReference) {
        throw new Error('Floor image is not available for AI analysis.');
      }

      const response = await fetch('/api/ai/floor-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: imageReference,
          currentName: entry.name,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = typeof body.error === 'string' ? body.error : `AI request failed with status ${response.status}`;
        throw new Error(message);
      }

      const result = await response.json() as FloorNameAiResponse;
      if (result.error) {
        throw new Error(result.error);
      }

      const suggestedNameRaw = typeof result.floorName === 'string' ? result.floorName.trim() : '';
      const confidence = typeof result.confidence === 'number' ? result.confidence : undefined;
      const reason = typeof result.reasoning === 'string' ? result.reasoning : undefined;
      const fallbackMessage = result.raw || reason || 'No label identified.';

      if (!suggestedNameRaw) {
        setFloorNameAiStatuses(prev => ({
          ...prev,
          [floorId]: { status: 'error', error: fallbackMessage },
        }));
        return;
      }

      const isDifferent = suggestedNameRaw.localeCompare(entry.name, undefined, { sensitivity: 'base' }) !== 0;
      if (isDifferent) {
        await handleRenameFloor(floorId, suggestedNameRaw);
      } else {
        setInfoMessage(`AI confirmed "${suggestedNameRaw}"`);
        setTimeout(() => setInfoMessage(null), 2000);
      }

      setFloorNameAiStatuses(prev => ({
        ...prev,
        [floorId]: {
          status: 'success',
          suggestedName: suggestedNameRaw,
          confidence,
          reason,
        },
      }));
    } catch (error) {
      console.error('Failed to detect floor name', error);
      const message = error instanceof Error ? error.message : 'Unknown AI error.';
      setFloorNameAiStatuses(prev => ({
        ...prev,
        [floorId]: { status: 'error', error: message },
      }));
      setInfoMessage(message);
      setTimeout(() => setInfoMessage(null), 2000);
    }
  }, [floors, fileToDataUrl, currentFloorId, imageUrl, handleRenameFloor]);

  const handleDetectFloorNameManual = useCallback((floorId: string) => {
    autoFloorNameAttemptsRef.current.delete(floorId);
    void handleDetectFloorName(floorId);
  }, [handleDetectFloorName]);

  useEffect(() => {
    const statuses = floorNameAiStatuses;
    const anyLoading = Object.values(statuses).some(status => status?.status === 'loading');
    if (anyLoading) {
      return;
    }

    const nextFloor = floors.find(floor => {
      const status = statuses[floor.id];
      const isIdle = !status || status.status === 'idle';
      if (!isIdle) {
        return false;
      }
      if (autoFloorNameAttemptsRef.current.has(floor.id)) {
        return false;
      }
      return true;
    });

    if (nextFloor) {
      autoFloorNameAttemptsRef.current.add(nextFloor.id);
      void handleDetectFloorName(nextFloor.id);
    }
  }, [floors, floorNameAiStatuses, handleDetectFloorName]);

  const handleDeleteFloor = useCallback(async (floorId: string) => {
    if (!currentProjectId) {
      setFloors(prev => prev.filter(f => f.id !== floorId));
      floorStateHashesRef.current.delete(floorId);
      setFloorNameAiStatuses(prev => {
        const next = { ...prev };
        delete next[floorId];
        return next;
      });
      autoFloorNameAttemptsRef.current.delete(floorId);
      if (floorId === currentFloorId) {
        const remaining = floors.filter(f => f.id !== floorId);
        if (remaining.length > 0) {
          setCurrentFloorId(remaining[0].id);
          setLoadedCanvasState(remaining[0].canvasState);
          setScale(remaining[0].scale ?? null);
          setUnit(remaining[0].units ?? 'meters');
          setImageUrl(remaining[0].imageUrl || '');
        } else {
          handleReset();
        }
      }
      return;
    }

    try {
      await FloorService.deleteFloor(currentProjectId, floorId);

      const remainingFloors = floors.filter(f => f.id !== floorId);
      setFloors(remainingFloors);
      floorStateHashesRef.current.delete(floorId);
      setFloorNameAiStatuses(prev => {
        const next = { ...prev };
        delete next[floorId];
        return next;
      });
      autoFloorNameAttemptsRef.current.delete(floorId);

      if (floorId === currentFloorId) {
        if (remainingFloors.length > 0) {
          await handleSelectFloor(remainingFloors[0].id);
        } else {
          handleReset();
          return;
        }
      }

      setInfoMessage('Floor deleted');
      setTimeout(() => setInfoMessage(null), 2000);
    } catch (e) {
      console.error('Failed to delete floor', e);
      alert('Failed to delete floor.');
    }
  }, [currentProjectId, currentFloorId, floors, handleSelectFloor, handleReset]);

  const lastSavedHashRef = useRef<string>('');

  useEffect(() => {
    console.log('[Save] showNameModal state changed:', showNameModal);
  }, [showNameModal]);

  const handleSaveProject = useCallback(async (overrideName?: string) => {
    if (isSaving) {
      console.log('[Save] already saving, skipping');
      return;
    }

    const trimmedName = overrideName?.trim?.() || currentProjectName?.trim?.() || '';
    if (!currentProjectId && !trimmedName) {
      setShowNameModal(true);
      setInfoMessage('Name your project to save');
      setTimeout(() => setInfoMessage(null), 2000);
      return;
    }

    if (floors.length === 0) {
      alert('Please add at least one floor before saving.');
      return;
    }

    const projectName = trimmedName || currentProjectName || floors[0]?.name || 'Untitled Project';
    const unitSetting = normaliseUnit(unit as Units);

    const latestCanvasState = canvasStateRef.current;
    const captureThumbnail = async (entry: FloorEntry): Promise<Blob | undefined> => {
      if (entry.id !== currentFloorId) return undefined;
      try {
        const canvasEl = document.querySelector('canvas[data-main-canvas="1"]') as HTMLCanvasElement | null;
        if (canvasEl) {
          const blob = await captureCanvasThumbnail(canvasEl, 320, 0.85);
          return blob ?? undefined;
        }
      } catch (err) {
        console.warn('Thumbnail capture failed', err);
      }
      return undefined;
    };

    if (!currentProjectId) {
      setIsSaving(true);
      try {
        const savedProjectId = await ProjectService.saveProject({
          name: projectName,
          description: '',
          canvasState: {},
          settings: { units: unitSetting, showRadiusBoundary: true },
        });
        setCurrentProjectId(savedProjectId);
        setCurrentProjectName(projectName);

        const newEntries: FloorEntry[] = [];
        const idMap: Record<string, string> = {};
        for (let i = 0; i < floors.length; i++) {
          const entry = floors[i];
          const thumbnailBlob = await captureThumbnail(entry);
          const payload = {
            name: entry.name,
            canvasState: entry.canvasState || ({} as CanvasState),
            ...(entry.imageFile ? { imageFile: entry.imageFile } : {}),
            ...(thumbnailBlob ? { thumbnailBlob } : {}),
          };
          const entryHash = computeStateHash(entry.canvasState || ({} as CanvasState));
          const newFloorId = await FloorService.addFloor(savedProjectId, payload, i);
          idMap[entry.id] = newFloorId;
          floorStateHashesRef.current.set(newFloorId, entryHash);
          newEntries.push({
            ...entry,
            id: newFloorId,
            persisted: true,
            dirty: false,
            updatedAt: new Date(),
            loaded: true,
            stateHash: entryHash,
          });
        }
        setFloors(newEntries);
        if (latestCanvasState) {
          setLoadedCanvasState(latestCanvasState);
        }
        if (currentFloorId && idMap[currentFloorId]) {
          setCurrentFloorId(idMap[currentFloorId]);
        }

        const savedHash = computeStateHash(latestCanvasState);
        lastSavedHashRef.current = savedHash;
        setIsDirty(false);
        setInfoMessage(`Project "${projectName}" saved`);
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

    setIsSaving(true);
    try {
      await ProjectService.saveProject({
        name: projectName,
        description: '',
        canvasState: {},
        settings: { units: unitSetting, showRadiusBoundary: true },
      }, currentProjectId);

      const updatedEntries: FloorEntry[] = [];
      const idMap: Record<string, string> = {};

      for (let i = 0; i < floors.length; i++) {
        const entry = floors[i];
        const thumbnailBlob = await captureThumbnail(entry);
        const payload = {
          name: entry.name,
          canvasState: entry.canvasState || ({} as CanvasState),
          ...(entry.imageFile ? { imageFile: entry.imageFile } : {}),
          ...(thumbnailBlob ? { thumbnailBlob } : {}),
        };
        const entryHash = computeStateHash(entry.canvasState || ({} as CanvasState));

        if (entry.persisted) {
          await FloorService.saveFloor(currentProjectId, entry.id, payload);
          floorStateHashesRef.current.set(entry.id, entryHash);
          updatedEntries.push({
            ...entry,
            dirty: false,
            updatedAt: new Date(),
            loaded: true,
            stateHash: entryHash,
          });
        } else {
          const newFloorId = await FloorService.addFloor(currentProjectId, payload, i);
          idMap[entry.id] = newFloorId;
          floorStateHashesRef.current.set(newFloorId, entryHash);
          updatedEntries.push({
            ...entry,
            id: newFloorId,
            persisted: true,
            dirty: false,
            updatedAt: new Date(),
            loaded: true,
            stateHash: entryHash,
          });
        }
      }

      setFloors(updatedEntries);
      if (latestCanvasState) {
        setLoadedCanvasState(latestCanvasState);
      }
      if (currentFloorId && idMap[currentFloorId]) {
        setCurrentFloorId(idMap[currentFloorId]);
      }

      const savedHash = computeStateHash(latestCanvasState);
      lastSavedHashRef.current = savedHash;
      setIsDirty(false);
      setInfoMessage(`Project "${projectName}" saved`);
      setTimeout(() => setInfoMessage(null), 2500);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
      loadProjects();
      await loadFloors(currentProjectId);
      if (latestCanvasState) {
        setLoadedCanvasState(latestCanvasState);
      }
    } catch (e) {
      console.error('Save failed', e);
      alert('Failed to save project.');
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, currentProjectId, currentProjectName, floors, currentFloorId, unit, computeStateHash, loadProjects, loadFloors]);

  const handleLoadProject = useCallback(async (projectId: string) => {
    const currentEmail = getCurrentUser()?.email || authEmail;
    if (!currentEmail) {
      alert('Please login to load projects.');
      return;
    }
    try {
      setIsLoading(true);
      const projectData = await ProjectService.getProject(projectId);
      if (!projectData) {
        alert('Project not found');
        return;
      }

      // Load floors for this project
      await loadFloors(projectId);
      
      // Load project data into state
      setUploadedFile(null); // We don't have the original file, just the image URL
      console.log('Loading project image URL:', projectData.metadata.imageUrl);
      
      // Check if project has floors
      const floorsList = await FloorService.listFloors(projectId);
      
      if (floorsList.length > 0) {
        // Multi-floor project: load the first floor with an image
        let floorToLoad = floorsList[0]; // Default to first floor
        let floorData = await FloorService.getFloor(projectId, floorToLoad.id);
        let resolvedFloorImageUrl = floorData ? await resolveImageUrl(floorData.metadata) : null;

        if (!resolvedFloorImageUrl) {
          for (const floor of floorsList) {
            const tempFloorData = await FloorService.getFloor(projectId, floor.id);
            if (!tempFloorData) continue;
            const tempUrl = await resolveImageUrl(tempFloorData.metadata);
            if (tempUrl) {
              floorToLoad = floor;
              floorData = tempFloorData;
              resolvedFloorImageUrl = tempUrl;
              break;
            }
          }
        }

        if (floorData && resolvedFloorImageUrl) {
          setImageUrl(resolvedFloorImageUrl);
          setLoadedCanvasState(floorData.canvasState);
          canvasStateRef.current = floorData.canvasState;
          setCurrentFloorId(floorToLoad.id);
          
          // Load scale from floor's canvas state or default
          if (typeof floorData.canvasState.scale === 'number') {
            setScale(floorData.canvasState.scale);
          } else {
            setScale(null);
          }
        } else {
          const fallbackUrl = await resolveImageUrl(projectData.metadata);
          if (fallbackUrl) {
            setImageUrl(fallbackUrl);
            setLoadedCanvasState(projectData.canvasState);
            canvasStateRef.current = projectData.canvasState;
            setCurrentFloorId(floorData ? floorToLoad.id : null);
            if (typeof projectData.canvasState.scale === 'number') {
              setScale(projectData.canvasState.scale);
            } else {
              setScale(null);
            }
          } else {
            alert('Project has no floors with associated images');
            return;
          }
        }
      } else {
        // Single-floor (legacy) project: load directly from project
        const projectImageUrl = await resolveImageUrl(projectData.metadata);
        if (!projectImageUrl) {
          alert('Project has no associated image');
          return;
        }

        setImageUrl(projectImageUrl);
        setLoadedCanvasState(projectData.canvasState);
        canvasStateRef.current = projectData.canvasState;
        
        // Always set scale from loaded project, even if null
        if (typeof projectData.canvasState.scale === 'number') {
          setScale(projectData.canvasState.scale);
        } else {
          setScale(null);
        }
      }
      
  setUnit(projectData.settings.units || 'meters');
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
  }, [computeStateHash, authEmail, loadFloors, resolveImageUrl]);

  // Load projects on component mount
  useEffect(() => {
    if (authEmail) {
      loadProjects();
    } else {
      setProjects([]);
      setSelectedProjectIds(new Set());
      // keep the toggle state; UI controls are disabled when logged out
    }
  }, [authEmail, loadProjects]);

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

  // Track dirty state whenever canvas state changes - REMOVED to prevent infinite loops
  // Dirty state is now only managed through onStateChange callback

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
    window.addEventListener('request-save', onRequestSave);
    return () => {
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
                {showLogo && (
                  <Image
                    src={logoSource}
                    alt="UCtel"
                    width={logoPxWidth && logoPxWidth > 0 ? logoPxWidth : 320}
                    height={64}
                    sizes="(max-width: 640px) 80vw, 320px"
                    className="h-16 w-full object-contain select-none mx-auto block"
                    onError={handleLogoLoadError}
                    priority
                  />
                )}
              </div>
              <h1 ref={titleRef} className="text-4xl font-bold text-gray-900 mb-4">Floorplan Analyser</h1>
              <p className="text-lg text-gray-600">Upload your floorplan to start analysing areas, measurements, and antenna coverage</p>
            </div>
          </div>

          {/* Large Upload Area (wide to match bar) */}
          <div className="w-full max-w-7xl mx-auto bg-white rounded-2xl shadow-xl p-8">
            <FileUpload 
              onFilesReady={handleInitialFloorUpload} 
              disabled={!authEmail}
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
                  disabled={!authEmail || isLoading}
                  title={authEmail ? (showProjectList ? 'Hide Projects' : 'Load Existing Projects') : 'Login to manage projects'}
                >
                  {showProjectList ? 'Hide Projects' : 'Load Projects'}
                </button>
                {showProjectList && authEmail && (
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
                    onClick={async () => {
                      try {
                        await signInWithGoogle();
                      } catch (e: any) {
                        alert(e?.message || 'Login failed. Please use your corporate Google account.');
                      }
                    }}
                    className="px-4 py-2 rounded-full bg-white text-[#16899A] hover:bg-blue-50 text-sm transition"
                  >
                    Login with Google
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Project List (wide) */}
          {showProjectList && authEmail && (
            <div className="w-full max-w-7xl mx-auto mt-4 bg-white rounded-2xl shadow-xl">
              {(() => {
                    const filtered = projects
                  .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
                  .sort((a,b) => {
                    if (sortBy === 'name') return a.name.localeCompare(b.name);
                    if (sortBy === 'antennas') return b.antennaCount - a.antennaCount;
                        const aT = a.lastOpenedAt?.getTime?.() || a.updatedAt?.getTime?.() || a.createdAt?.getTime?.() || 0;
                        const bT = b.lastOpenedAt?.getTime?.() || b.updatedAt?.getTime?.() || b.createdAt?.getTime?.() || 0;
                        return bT - aT;
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
                  const last = project.lastOpenedAt || project.updatedAt || project.createdAt;
                  const lastLabel = 'Last opened';
                  const ownerName = resolveOwnerName(project.engineer);
                  return (
                    <li
                      key={project.id}
                      className={`group p-4 hover:bg-gray-50 cursor-pointer ${selected ? 'bg-blue-50' : ''}`}
                      onClick={() => { if (!authEmail) return; handleLoadProject(project.id); }}
                    >
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
                          <Image
                            src={project.thumbnailUrl}
                            alt={`${project.name} thumbnail`}
                            width={64}
                            height={64}
                            className="w-16 h-16 object-cover rounded border"
                            onClick={(e)=>e.stopPropagation()}
                            unoptimized
                          />
                        ) : (
                          <div className="w-16 h-16 rounded border bg-gray-50 text-gray-400 flex items-center justify-center text-xs" onClick={(e)=>e.stopPropagation()}>No preview</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h3 className="font-medium text-gray-900 pr-4 break-words">{project.name}</h3>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-500 whitespace-nowrap">Owner: {ownerName}</span>
                              <span className="text-xs text-gray-500 whitespace-nowrap">{lastLabel}: {last.toLocaleString()}</span>
                              {isLoading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />}
                            </div>
                          </div>
                          <div className="mt-1 text-sm text-gray-600">
                            {(project.floorCount ?? 0)} floors • {project.antennaCount} antennas • {project.areaCount} areas
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
          key={canvasInstanceKey}
          imageUrl={imageUrl} 
          scale={scale} 
          scaleUnit={unit}
          onCalibrate={(s,u)=>{ 
            setScale(s); 
            setUnit(u); 
            if (currentFloorId) {
              updateFloorEntry(currentFloorId, floor => ({
                ...floor,
                scale: s,
                units: normaliseUnit(u as Units),
                dirty: true,
                updatedAt: new Date(),
              }));
            }
          }}
          requestCalibrateToken={calibrateTick}
          onTrimmedImage={(cropped, _quad, conf)=>{ setImageUrl(cropped); setInfoMessage(`Trimmed frame (confidence ${Math.round((conf||0)*100)}%)`); }}
          onScaleDetected={(s,u,_m,_c)=>{ 
            setScale(s); 
            setUnit(u); 
            if (currentFloorId) {
              updateFloorEntry(currentFloorId, floor => ({
                ...floor,
                scale: s,
                units: normaliseUnit(u as Units),
                dirty: true,
                updatedAt: new Date(),
              }));
            }
          }}
          onReset={handleReset}
          onStateChange={(state)=>{ 
            const canvasState = state as CanvasState;
            canvasStateRef.current = canvasState; 
            const stateHash = computeStateHash(canvasState);
            const isDirtyNow = stateHash !== lastSavedHashRef.current;

            if (currentFloorId) {
              const currentEntry = floors.find(f => f.id === currentFloorId);
              const previousHash = floorStateHashesRef.current.get(currentFloorId) ?? currentEntry?.stateHash ?? '';
              floorStateHashesRef.current.set(currentFloorId, stateHash);

              const nextScale = typeof canvasState.scale === 'number'
                ? canvasState.scale
                : currentEntry?.scale ?? null;
              const { stats, units: inferredUnits } = computeFloorStatistics(canvasState);
              const nextUnits = canvasState.scaleUnit
                ? normaliseUnit(canvasState.scaleUnit as Units)
                : inferredUnits || currentEntry?.units || normaliseUnit(unit as Units);

              const shouldUpdate =
                previousHash !== stateHash ||
                (currentEntry && (
                  currentEntry.dirty !== isDirtyNow ||
                  currentEntry.scale !== nextScale ||
                  currentEntry.units !== nextUnits
                ));

              if (shouldUpdate) {
                updateFloorEntry(currentFloorId, floor => ({
                  ...floor,
                  canvasState,
                  stats,
                  scale: nextScale,
                  units: nextUnits,
                  dirty: isDirtyNow,
                  loaded: true,
                  updatedAt: previousHash === stateHash ? floor.updatedAt : new Date(),
                  stateHash,
                }));
              }
            }

            setIsDirty(isDirtyNow); 
          }}
          onSaveProject={handleSaveProject}
          loadedCanvasState={loadedCanvasState}
          isSaving={isSaving}
          justSaved={justSaved}
          isUpdate={!!currentProjectId}
          // Multi-floor props
          floors={floorSummaries}
          currentFloorId={currentFloorId}
          onSelectFloor={handleSelectFloor}
          onRenameFloor={handleRenameFloor}
          onDeleteFloor={handleDeleteFloor}
          onAddFloor={handleAddFloor}
          floorsLoading={floorsLoading}
          onDetectFloorName={handleDetectFloorNameManual}
          floorNameAiStatus={floorNameAiStatuses}
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

      {/* Floor Upload Modal */}
      {showFloorUpload && (
        <FloorUpload
          onFilesUpload={handleFloorUpload}
          onCancel={handleCancelFloorUpload}
          multiple={true}
        />
      )}
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
