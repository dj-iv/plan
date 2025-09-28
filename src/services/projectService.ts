import { 
  collection, doc, setDoc, getDoc, getDocs, query, orderBy, deleteDoc, Timestamp, updateDoc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { ensureAnonymousAuth } from '@/lib/firebaseAuth';
import { db, storage } from '@/lib/firebase';
import { ProjectData, ProjectSummary, SaveProjectRequest, CanvasState } from '@/types/project';
import { getAuth } from 'firebase/auth';
import { computeFloorStatistics } from '@/utils/floorStats';

const PROJECTS_COLLECTION = 'projects';

function removeUndefinedValues(obj: any): any {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) return obj.map(removeUndefinedValues).filter(v => v !== null && v !== undefined);
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) cleaned[k] = removeUndefinedValues(v);
    }
    return cleaned;
  }
  return obj;
}

function flattenNestedPointArrays(canvasState: CanvasState): any {
  return removeUndefinedValues({
    ...canvasState,
    holes: (canvasState.holes || []).map((h, index) => ({ index, points: h || [] })),
    autoHolesPreview: (canvasState.autoHolesPreview || []).map((h, index) => ({ index, points: h || [] })),
    manualRegions: (canvasState.manualRegions || []).map((r, index) => ({ index, points: r || [] })),
    manualHoles: (canvasState.manualHoles || []).map((h, index) => ({ index, points: h || [] })),
    savedAreas: (canvasState.savedAreas || []).map((a, index) => ({ index, points: a || [] })),
    savedExclusions: (canvasState.savedExclusions || []).map((e, index) => ({ index, points: e || [] })),
  });
}

function reconstructNestedPointArrays(flat: any): CanvasState {
  return {
    ...flat,
    holes: (flat.holes || []).sort((a: any,b: any)=>a.index-b.index).map((i:any)=>i.points||[]),
    autoHolesPreview: (flat.autoHolesPreview || []).sort((a: any,b: any)=>a.index-b.index).map((i:any)=>i.points||[]),
    manualRegions: (flat.manualRegions || []).sort((a: any,b: any)=>a.index-b.index).map((i:any)=>i.points||[]),
    manualHoles: (flat.manualHoles || []).sort((a: any,b: any)=>a.index-b.index).map((i:any)=>i.points||[]),
    savedAreas: (flat.savedAreas || []).sort((a: any,b: any)=>a.index-b.index).map((i:any)=>i.points||[]),
    savedExclusions: (flat.savedExclusions || []).sort((a: any,b: any)=>a.index-b.index).map((i:any)=>i.points||[]),
  };
}

export class ProjectService {
  static async saveProject(projectData: SaveProjectRequest, existingProjectId?: string): Promise<string> {
    const projectId = existingProjectId || doc(collection(db, PROJECTS_COLLECTION)).id;
  await ensureAnonymousAuth();
  const uid = getAuth().currentUser?.uid;
  if (!uid) throw new Error('Authentication required to save projects.');
    // Owner scoping removed; access is controlled via Google domain auth + rules

    let imageUrl: string | null = null;
    let storagePath: string | undefined = undefined;
    let originalFileName = 'original-image';
    let fileSize = 0;

  if (projectData.imageFile) {
      const raster = projectData.imageFile;
      originalFileName = raster.name || originalFileName;
      fileSize = raster.size || 0;
      console.log('ProjectService: Uploading file:', { 
        name: raster.name, 
        type: raster.type, 
        size: raster.size 
      });
      const ext = (()=>{
        const lower = (raster.name||'').toLowerCase();
        if (/\.png$/.test(lower)) return '.png';
        if (/\.jpe?g$/.test(lower)) return lower.match(/\.jpe?g$/)![0];
        if (/\.webp$/.test(lower)) return '.webp';
        return '.png';
    })();
    // Store in a project-scoped path (no per-user scoping)
    storagePath = `projects/${projectId}/original-image${ext}`;
      const imgRef = ref(storage, storagePath);
      console.log('ProjectService: Storage path:', storagePath, 'Content type:', raster.type || 'image/png');
      await uploadBytes(imgRef, raster, { contentType: raster.type || 'image/png' });
      imageUrl = await getDownloadURL(imgRef);
      console.log('ProjectService: Saved image to Firebase Storage:', { storagePath, imageUrl });
    } else if (existingProjectId) {
      const existing = await this.getProject(existingProjectId);
      imageUrl = existing?.metadata?.imageUrl || null;
      storagePath = existing?.metadata?.storagePath;
      originalFileName = existing?.metadata?.originalFileName || originalFileName;
      fileSize = existing?.metadata?.fileSize || fileSize;
    }

    // Upload optional thumbnail
    let thumbnailUrl: string | undefined = undefined;
    if (projectData.thumbnailBlob) {
      try {
        const thumbPath = `projects/${projectId}/thumb.jpg`;
        const thumbRef = ref(storage, thumbPath);
        await uploadBytes(thumbRef, projectData.thumbnailBlob, { contentType: 'image/jpeg' });
        thumbnailUrl = await getDownloadURL(thumbRef);
      } catch (e) {
        console.warn('ProjectService: Failed to upload thumbnail', e);
      }
    }

    const now = new Date();
    const project = removeUndefinedValues({
      id: projectId,
      name: projectData.name,
      description: projectData.description || '',
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
       lastOpenedAt: Timestamp.fromDate(now),
      version: 1,
      metadata: {
        originalFileName,
        fileSize,
        imageUrl: imageUrl || '',
        storagePath,
        thumbnailUrl,
      },
      canvasState: flattenNestedPointArrays(projectData.canvasState),
      settings: projectData.settings,
    });

    await setDoc(doc(db, PROJECTS_COLLECTION, projectId), project, { merge: true });
    return projectId;
  }

  static async getProject(projectId: string): Promise<ProjectData | null> {
    const docRef = doc(db, PROJECTS_COLLECTION, projectId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    const data = snap.data() as any;
    const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date();
    const updatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date();
    const lastOpenedAt = data.lastOpenedAt instanceof Timestamp ? data.lastOpenedAt.toDate() : undefined;
    const result = {
      ...data,
      id: projectId,
      createdAt,
      updatedAt,
      lastOpenedAt,
      canvasState: reconstructNestedPointArrays(data.canvasState || {}),
    } as ProjectData;
    
    console.log('ProjectService: Loaded project:', { id: projectId, imageUrl: result.metadata?.imageUrl });
    // Update lastOpenedAt (fire and forget)
    try {
      await updateDoc(docRef, { lastOpenedAt: Timestamp.fromDate(new Date()) });
    } catch (e) {
      console.warn('Failed to update lastOpenedAt', e);
    }
    return result;
  }

  static async getProjectList(): Promise<ProjectSummary[]> {
  await ensureAnonymousAuth();
  const uid = getAuth().currentUser?.uid;
  if (!uid) throw new Error('Authentication required to list projects.');
    const base = collection(db, PROJECTS_COLLECTION);
  const qs = await getDocs(query(base, orderBy('updatedAt', 'desc')));
  const baseSummaries: ProjectSummary[] = [];
    qs.forEach((d) => {
      const data = d.data() as any;
      const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date();
      const updatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date();
      const lastOpenedAt = data.lastOpenedAt instanceof Timestamp ? data.lastOpenedAt.toDate() : undefined;
      baseSummaries.push({
        id: d.id,
        name: data.name,
        description: data.description,
        createdAt,
        updatedAt,
        lastOpenedAt,
        thumbnailUrl: data.metadata?.thumbnailUrl || data.metadata?.imageUrl,
        antennaCount: data.canvasState?.antennas?.length || 0,
        areaCount: data.canvasState?.areas?.length || 0,
        floorCount: data.floorCount || 0,
      });
    });
    const enriched = await Promise.all(baseSummaries.map(async (summary) => {
      try {
        const floorsSnap = await getDocs(query(collection(db, PROJECTS_COLLECTION, summary.id, 'floors'), orderBy('orderIndex', 'asc')));
        if (!floorsSnap.empty) {
          let totalAntennas = 0;
          let totalAreas = 0;
          let firstPreview: string | undefined = summary.thumbnailUrl;
          floorsSnap.forEach(floorDoc => {
            const floorData = floorDoc.data() as any;
            const canvasState = reconstructNestedPointArrays(floorData.canvasState || {});
            const { stats } = computeFloorStatistics(canvasState);
            totalAntennas += stats.antennaCount;
            totalAreas += stats.areaCount;
            if (!firstPreview) {
              firstPreview = floorData.metadata?.thumbnailUrl || floorData.metadata?.imageUrl || firstPreview;
            }
          });
          return {
            ...summary,
            antennaCount: totalAntennas,
            areaCount: totalAreas,
            floorCount: floorsSnap.size,
            thumbnailUrl: firstPreview,
          };
        }
      } catch (e) {
        console.warn('ProjectService: Failed to enrich project summary', summary.id, e);
      }

      return {
        ...summary,
        thumbnailUrl: summary.thumbnailUrl,
      };
    }));

    // Sort primarily by lastOpenedAt desc if present, else fallback to updatedAt desc
    return enriched.sort((a, b) => {
      const aT = (a.lastOpenedAt?.getTime?.() || 0);
      const bT = (b.lastOpenedAt?.getTime?.() || 0);
      if (aT !== bT) return bT - aT;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
  }

  static async deleteProject(projectId: string): Promise<void> {
    await deleteDoc(doc(db, PROJECTS_COLLECTION, projectId));
    try {
      const legacyRef = ref(storage, `projects/${projectId}/original-image`);
      await deleteObject(legacyRef);
    } catch {}
    // Delete in project-scoped path with possible extensions
    try {
      const anyExt = ['.png','.jpg','.jpeg','.webp'];
      for (const ext of anyExt) {
        try {
          const refNew = ref(storage, `projects/${projectId}/original-image${ext}`);
          await deleteObject(refNew);
        } catch {}
      }
    } catch {}
    try {
      const thumbRef = ref(storage, `projects/${projectId}/thumb.jpg`);
      await deleteObject(thumbRef);
    } catch {}
    // Also attempt delete in new user-scoped paths
    try {
      const uid = getAuth().currentUser?.uid;
      if (uid) {
        const anyExt = ['.png','.jpg','.jpeg','.webp'];
        for (const ext of anyExt) {
          try {
            const refNew = ref(storage, `projects/${uid}/${projectId}/original-image${ext}`);
            await deleteObject(refNew);
          } catch {}
        }
        try {
          const refThumbNew = ref(storage, `projects/${uid}/${projectId}/thumb.jpg`);
          await deleteObject(refThumbNew);
        } catch {}
      }
    } catch {}
  }
}
