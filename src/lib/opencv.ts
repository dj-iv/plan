// Lightweight OpenCV.js loader and a trim function to crop the plan frame.
// Uses global `cv` from OpenCV.js; we load it lazily from CDN.


declare const cv: any;

let opencvLoading: Promise<any> | null = null;

export async function loadOpenCV(): Promise<any> {
  if (typeof window === 'undefined') throw new Error('OpenCV can only load in browser');
  if ((window as any).cv && (window as any).cv.ready) return (window as any).cv;
  if (opencvLoading) return opencvLoading;

  opencvLoading = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-opencv]') as HTMLScriptElement | null;
    if (existing) {
      const check = () => {
        const gcv = (window as any).cv;
        if (gcv && gcv.ready) resolve(gcv);
        else setTimeout(check, 50);
      };
      check();
      return;
    }
    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.setAttribute('data-opencv', 'true');
    // Official CDN build
    script.src = 'https://docs.opencv.org/4.x/opencv.js';
    script.onload = () => {
      const gcv = (window as any).cv;
      if (!gcv) {
        reject(new Error('cv not found after script load'));
        return;
      }
      // Wait for wasm runtime ready
      gcv['onRuntimeInitialized'] = () => {
        gcv.ready = true;
        resolve(gcv);
      };
    };
    script.onerror = () => reject(new Error('Failed to load OpenCV.js'));
    document.head.appendChild(script);
  });
  return opencvLoading;
}

export async function trimFrameWithOpenCV(imageDataUrl: string): Promise<{ dataUrl: string; quad: {x:number;y:number}[]; confidence: number } | null> {
  const gcv = await loadOpenCV();
  const imgEl = await loadImage(imageDataUrl);

  // Downscale for detection to keep it fast
  const maxProcSide = 1500;
  const procCanvas = document.createElement('canvas');
  const scale = Math.min(1, maxProcSide / Math.max(imgEl.width, imgEl.height));
  procCanvas.width = Math.max(1, Math.round(imgEl.width * scale));
  procCanvas.height = Math.max(1, Math.round(imgEl.height * scale));
  const pctx = procCanvas.getContext('2d')!;
  pctx.drawImage(imgEl, 0, 0, procCanvas.width, procCanvas.height);

  const src = gcv.imread(procCanvas);
  try {
    // Preprocess
    const gray = new gcv.Mat();
    const blur = new gcv.Mat();
    const edges = new gcv.Mat();
    gcv.cvtColor(src, gray, gcv.COLOR_RGBA2GRAY);
    gcv.GaussianBlur(gray, blur, new gcv.Size(5,5), 0, 0, gcv.BORDER_DEFAULT);
    gcv.Canny(blur, edges, 50, 150);

    // Morph close to connect edges
    const kernel = gcv.getStructuringElement(gcv.MORPH_RECT, new gcv.Size(5,5));
    gcv.morphologyEx(edges, edges, gcv.MORPH_CLOSE, kernel);

    // Find contours
    const contours = new gcv.MatVector();
    const hierarchy = new gcv.Mat();
    const start = Date.now();
    gcv.findContours(edges, contours, hierarchy, gcv.RETR_EXTERNAL, gcv.CHAIN_APPROX_SIMPLE);

    // Evaluate quads
    let best: { quad: {x:number;y:number}[]; score: number } | null = null;
    const imgArea = src.cols * src.rows;
    const n = contours.size();
    for (let i = 0; i < n; i++) {
      if (i % 100 === 0 && Date.now() - start > 1500) break; // guard: ~1.5s budget
      const cnt = contours.get(i);
      const peri = gcv.arcLength(cnt, true);
      const approx = new gcv.Mat();
      gcv.approxPolyDP(cnt, approx, 0.02 * peri, true);
      if (approx.rows === 4 && gcv.isContourConvex(approx)) {
        // area
        const area = gcv.contourArea(approx, false);
        if (area < imgArea * 0.2) { approx.delete(); continue; } // ignore small quads
        // rectangle score from angles
        const pts = matToPoints(approx);
        const rectScore = rectangleScore(pts);
        const coverage = Math.min(1, area / imgArea);
        const score = rectScore * 0.6 + coverage * 0.4;
        if (!best || score > best.score) best = { quad: pts, score };
      }
      approx.delete();
      cnt.delete();
    }

    contours.delete();
    hierarchy.delete();
    gray.delete(); blur.delete(); edges.delete(); kernel.delete();

  if (!best) {
      // Nothing reliable found
      return { dataUrl: imageDataUrl, quad: [
    {x:0,y:0},{x:imgEl.width,y:0},{x:imgEl.width,y:imgEl.height},{x:0,y:imgEl.height}
      ], confidence: 0.2 };
    }

  // Map quad back to original coordinates
  const ordered = orderQuad(best.quad).map(p => ({ x: p.x / scale, y: p.y / scale }));
  const dstSize = estimateWarpSize(ordered);
  const srcTri = gcv.matFromArray(4, 1, gcv.CV_32FC2, flattenPoints(ordered));
  const dstTri = gcv.matFromArray(4, 1, gcv.CV_32FC2, flattenPoints([
      {x:0,y:0}, {x:dstSize.w,y:0}, {x:dstSize.w,y:dstSize.h}, {x:0,y:dstSize.h}
    ]));
    const M = gcv.getPerspectiveTransform(srcTri, dstTri);
  // Warp from original image but cap output size for performance
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = imgEl.width; fullCanvas.height = imgEl.height;
  const fullMat = gcv.imread(imgEl);
  const dst = new gcv.Mat();
  gcv.warpPerspective(fullMat, dst, M, new gcv.Size(dstSize.w, dstSize.h), gcv.INTER_LINEAR, gcv.BORDER_REPLICATE);

    const dataUrl = matToDataUrl(gcv, dst);
  srcTri.delete(); dstTri.delete(); M.delete(); dst.delete(); fullMat.delete();

    const confidence = Math.max(0, Math.min(1, best.score));
    return { dataUrl, quad: ordered, confidence };
  } finally {
    src.delete();
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

function matToPoints(mat: any): {x:number;y:number}[] {
  const pts: {x:number;y:number}[] = [];
  for (let i = 0; i < mat.rows; i++) {
    // Try to read as float if present; fallback to int
    let x = 0, y = 0;
    try {
      x = mat.data32F ? mat.floatAt(i, 0) : mat.intAt(i, 0);
      y = mat.data32F ? mat.floatAt(i, 1) : mat.intAt(i, 1);
    } catch {
      const p = mat.intPtr(i, 0);
      x = p[0]; y = p[1];
    }
    pts.push({ x, y });
  }
  return pts;
}

function flattenPoints(pts: {x:number;y:number}[]): number[] {
  const out: number[] = [];
  pts.forEach(p => { out.push(p.x, p.y); });
  return out;
}

function rectangleScore(pts: {x:number;y:number}[]): number {
  if (pts.length !== 4) return 0;
  // Compute vectors and cosines of angles
  const v = (a:{x:number;y:number}, b:{x:number;y:number}) => ({x:b.x-a.x, y:b.y-a.y});
  const dot = (u:{x:number;y:number}, w:{x:number;y:number}) => u.x*w.x + u.y*w.y;
  const norm = (u:{x:number;y:number}) => Math.hypot(u.x,u.y) + 1e-6;
  const angles = [] as number[];
  for (let i=0;i<4;i++){
    const p0 = pts[i], p1 = pts[(i+1)%4], p2 = pts[(i+3)%4];
    const v1 = v(p0,p1), v2 = v(p0,p2);
    const cos = Math.abs(dot(v1,v2)/(norm(v1)*norm(v2)));
    angles.push(1 - Math.min(1, Math.abs(cos))); // 1 when 90deg, 0 when 0/180
  }
  // Average angle score; also check opposite side lengths similarity
  const side = (a:{x:number;y:number}, b:{x:number;y:number}) => Math.hypot(a.x-b.x,a.y-b.y);
  const s0 = side(pts[0],pts[1]);
  const s1 = side(pts[1],pts[2]);
  const s2 = side(pts[2],pts[3]);
  const s3 = side(pts[3],pts[0]);
  const parallelScore = 1 - (Math.abs(s0 - s2)/(Math.max(s0,s2)+1e-6) + Math.abs(s1 - s3)/(Math.max(s1,s3)+1e-6))/2;
  const angleScore = angles.reduce((a,b)=>a+b,0)/angles.length;
  return Math.max(0, Math.min(1, 0.7*angleScore + 0.3*parallelScore));
}

function orderQuad(pts: {x:number;y:number}[]): {x:number;y:number}[] {
  // Order as TL, TR, BR, BL
  const sorted = [...pts].sort((a,b)=>a.y-b.y);
  const top = sorted.slice(0,2).sort((a,b)=>a.x-b.x);
  const bottom = sorted.slice(2).sort((a,b)=>a.x-b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

function estimateWarpSize(quad: {x:number;y:number}[]): {w:number;h:number} {
  const d = (a:{x:number;y:number}, b:{x:number;y:number}) => Math.hypot(a.x-b.x,a.y-b.y);
  const w = Math.max(d(quad[0],quad[1]), d(quad[3],quad[2]));
  const h = Math.max(d(quad[0],quad[3]), d(quad[1],quad[2]));
  // Clamp for safety
  const maxSide = 3000;
  const scale = Math.min(1, maxSide/Math.max(w,h));
  return { w: Math.max(1, Math.round(w*scale)), h: Math.max(1, Math.round(h*scale)) };
}

function matToDataUrl(gcv:any, mat:any): string {
  const canvas = document.createElement('canvas');
  gcv.imshow(canvas, mat);
  return canvas.toDataURL('image/png');
}
