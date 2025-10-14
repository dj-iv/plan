import { collection, doc, setDoc, getDoc, getDocs, query, orderBy, deleteDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { ensureAnonymousAuth } from '@/lib/firebaseAuth';
import { CanvasState, FloorData, FloorSummary, SaveFloorRequest } from '@/types/project';
import { computeFloorStatistics } from '@/utils/floorStats';
import { getAuth } from 'firebase/auth';

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

export class FloorService {
  static floorsCol(projectId: string) {
    return collection(db, PROJECTS_COLLECTION, projectId, 'floors');
  }

  static floorDoc(projectId: string, floorId: string) {
    return doc(db, PROJECTS_COLLECTION, projectId, 'floors', floorId);
  }

  static async addFloor(projectId: string, payload: SaveFloorRequest, orderIndex: number): Promise<string> {
    await ensureAnonymousAuth();
    const uid = getAuth().currentUser?.uid;
    if (!uid) throw new Error('Authentication required to save floors.');

    const floorId = doc(this.floorsCol(projectId)).id;

    let imageUrl: string | undefined;
    let storagePath: string | undefined;
    let originalFileName = 'original-image';
    let fileSize = 0;
    if (payload.imageFile) {
      const raster = payload.imageFile;
      originalFileName = raster.name || originalFileName;
      fileSize = raster.size || 0;
      const ext = (()=>{
        const lower = (raster.name||'').toLowerCase();
        if (/\.png$/.test(lower)) return '.png';
        if (/\.jpe?g$/.test(lower)) return lower.match(/\.jpe?g$/)![0];
        if (/\.webp$/.test(lower)) return '.webp';
        return '.png';
      })();
      storagePath = `projects/${projectId}/floors/${floorId}/original-image${ext}`;
      const imgRef = ref(storage, storagePath);
      await uploadBytes(imgRef, raster, { contentType: raster.type || 'image/png' });
      imageUrl = await getDownloadURL(imgRef);
    }

    // Thumbnail
    let thumbnailUrl: string | undefined;
    if (payload.thumbnailBlob) {
      try {
        const thumbPath = `projects/${projectId}/floors/${floorId}/thumb.jpg`;
        const thumbRef = ref(storage, thumbPath);
        await uploadBytes(thumbRef, payload.thumbnailBlob, { contentType: 'image/jpeg' });
        thumbnailUrl = await getDownloadURL(thumbRef);
      } catch {}
    }

    const now = new Date();
    const docData = removeUndefinedValues({
      id: floorId,
      name: payload.name,
      orderIndex,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
      metadata: {
        originalFileName,
        fileSize,
        imageUrl: imageUrl || '',
        storagePath,
        imageWidth: payload.canvasState?.originalImageWidth,
        imageHeight: payload.canvasState?.originalImageHeight,
        thumbnailUrl,
      },
      canvasState: flattenNestedPointArrays(payload.canvasState),
    });

    await setDoc(this.floorDoc(projectId, floorId), docData, { merge: true });
    // Optionally bump project.updatedAt
    try {
      await updateDoc(doc(db, PROJECTS_COLLECTION, projectId), { updatedAt: Timestamp.fromDate(now) });
    } catch {}
    return floorId;
  }

  static async listFloors(projectId: string): Promise<FloorSummary[]> {
    const qs = await getDocs(query(this.floorsCol(projectId), orderBy('orderIndex', 'asc')));
    const list: FloorSummary[] = [];
    qs.forEach(d => {
      const data = d.data() as any;
      const updatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date();
  const canvasState = reconstructNestedPointArrays(data.canvasState || {});
  const { stats, units } = computeFloorStatistics(canvasState);
      list.push({
        id: d.id,
        name: data.name,
        orderIndex: data.orderIndex || 0,
        updatedAt,
        thumbnailUrl: data.metadata?.thumbnailUrl,
        antennaCount: stats.antennaCount,
        areaCount: stats.areaCount,
        totalArea: stats.totalArea,
        units,
        areaSummaries: stats.areaSummaries,
        antennaRange: stats.antennaRange,
        pulsingAntennaCount: stats.pulsingAntennaCount,
        pulsingAntennas: stats.pulsingAntennas,
      });
    });
    return list.sort((a,b)=> a.orderIndex - b.orderIndex);
  }

  static async getFloor(projectId: string, floorId: string): Promise<FloorData | null> {
    const snap = await getDoc(this.floorDoc(projectId, floorId));
    if (!snap.exists()) return null;
    const data = snap.data() as any;
    const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date();
    const updatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date();
  const canvasState = reconstructNestedPointArrays(data.canvasState || {});
  const { stats, units } = computeFloorStatistics(canvasState);

    return {
      id: floorId,
      projectId,
      name: data.name,
      orderIndex: data.orderIndex || 0,
      createdAt,
      updatedAt,
      metadata: data.metadata || {},
      canvasState,
      stats,
      units,
    } as FloorData;
  }

  static async saveFloor(projectId: string, floorId: string, payload: SaveFloorRequest): Promise<void> {
    await ensureAnonymousAuth();
    const uid = getAuth().currentUser?.uid;
    if (!uid) throw new Error('Authentication required to save floors.');

    let imageUrl: string | undefined;
    let storagePath: string | undefined;
    let originalFileName: string | undefined;
    let fileSize: number | undefined;
    if (payload.imageFile) {
      const raster = payload.imageFile;
      originalFileName = raster.name || 'original-image';
      fileSize = raster.size || 0;
      const ext = (()=>{
        const lower = (raster.name||'').toLowerCase();
        if (/\.png$/.test(lower)) return '.png';
        if (/\.jpe?g$/.test(lower)) return lower.match(/\.jpe?g$/)![0];
        if (/\.webp$/.test(lower)) return '.webp';
        return '.png';
      })();
      storagePath = `projects/${projectId}/floors/${floorId}/original-image${ext}`;
      const imgRef = ref(storage, storagePath);
      await uploadBytes(imgRef, raster, { contentType: raster.type || 'image/png' });
      imageUrl = await getDownloadURL(imgRef);
    }

    let thumbnailUrl: string | undefined;
    if (payload.thumbnailBlob) {
      try {
        const thumbPath = `projects/${projectId}/floors/${floorId}/thumb.jpg`;
        const thumbRef = ref(storage, thumbPath);
        await uploadBytes(thumbRef, payload.thumbnailBlob, { contentType: 'image/jpeg' });
        thumbnailUrl = await getDownloadURL(thumbRef);
      } catch {}
    }

    const now = new Date();
    const patch: any = {
      updatedAt: Timestamp.fromDate(now),
      canvasState: flattenNestedPointArrays(payload.canvasState),
    };
    if (payload.canvasState?.originalImageWidth) {
      patch.metadata = { ...(patch.metadata || {}), imageWidth: payload.canvasState.originalImageWidth };
    }
    if (payload.canvasState?.originalImageHeight) {
      patch.metadata = { ...(patch.metadata || {}), imageHeight: payload.canvasState.originalImageHeight };
    }
    if (payload.name) {
      patch.name = payload.name;
    }
    if (originalFileName) {
      patch.metadata = { ...(patch.metadata||{}), originalFileName };
    }
    if (typeof fileSize === 'number') {
      patch.metadata = { ...(patch.metadata||{}), fileSize };
    }
    if (imageUrl) {
      patch.metadata = { ...(patch.metadata||{}), imageUrl };
    }
    if (storagePath) {
      patch.metadata = { ...(patch.metadata||{}), storagePath };
    }
    if (thumbnailUrl) {
      patch.metadata = { ...(patch.metadata||{}), thumbnailUrl };
    }
    await setDoc(this.floorDoc(projectId, floorId), removeUndefinedValues(patch), { merge: true });
    try { await updateDoc(doc(db, PROJECTS_COLLECTION, projectId), { updatedAt: Timestamp.fromDate(now) }); } catch {}
  }

  static async deleteFloor(projectId: string, floorId: string): Promise<void> {
    await deleteDoc(this.floorDoc(projectId, floorId));
    // Best-effort delete assets
    try {
      const anyExt = ['.png','.jpg','.jpeg','.webp'];
      for (const ext of anyExt) {
        try { await deleteObject(ref(storage, `projects/${projectId}/floors/${floorId}/original-image${ext}`)); } catch {}
      }
      try { await deleteObject(ref(storage, `projects/${projectId}/floors/${floorId}/thumb.jpg`)); } catch {}
    } catch {}
  }

  static async renameFloor(projectId: string, floorId: string, name: string): Promise<void> {
    await updateDoc(this.floorDoc(projectId, floorId), { name });
  }

  static async moveFloor(projectId: string, floorId: string, newOrderIndex: number): Promise<void> {
    await updateDoc(this.floorDoc(projectId, floorId), { orderIndex: newOrderIndex });
  }
}