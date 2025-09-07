/* global importScripts, postMessage, onmessage */

// Run OpenCV trim in a Web Worker to avoid blocking the UI.
// It loads OpenCV.js from CDN, decodes the input image, downsamples, detects the best quadrilateral, and warps the original.

let cvReady = false;
let cvLoading = null;

function ensureCV() {
  if (cvReady) return Promise.resolve();
  if (cvLoading) return cvLoading;
  cvLoading = new Promise((resolve, reject) => {
    try {
      importScripts('https://docs.opencv.org/4.x/opencv.js');
      if (typeof cv === 'undefined') {
        reject(new Error('cv undefined after importScripts'));
        return;
      }
      cv['onRuntimeInitialized'] = () => {
        cvReady = true;
        resolve();
      };
    } catch (e) {
      reject(e);
    }
  });
  return cvLoading;
}

async function dataUrlToBitmap(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  return bmp;
}

function bitmapToMat(bmp, downscaleMax) {
  const scale = Math.min(1, downscaleMax / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const mat = cv.matFromImageData(imgData);
  return { mat, scale, w, h };
}

function matToDataUrl(mat) {
  const canvas = new OffscreenCanvas(mat.cols, mat.rows);
  const dst = new ImageData(mat.cols, mat.rows);
  // Convert RGBA Mat to ImageData
  const rgba = new Uint8ClampedArray(mat.data);
  dst.data.set(rgba);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(dst, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' }).then(blob => new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  }));
}

function orderQuad(pts) {
  const sorted = pts.slice().sort((a,b)=>a.y-b.y);
  const top = sorted.slice(0,2).sort((a,b)=>a.x-b.x);
  const bottom = sorted.slice(2).sort((a,b)=>a.x-b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

function rectangleScore(pts) {
  const v = (a,b)=>({x:b.x-a.x,y:b.y-a.y});
  const dot=(u,w)=>u.x*w.x+u.y*w.y; const norm=(u)=>Math.hypot(u.x,u.y)+1e-6;
  const angles=[]; for(let i=0;i<4;i++){const p0=pts[i],p1=pts[(i+1)%4],p2=pts[(i+3)%4];const v1=v(p0,p1),v2=v(p0,p2);const cos=Math.abs(dot(v1,v2)/(norm(v1)*norm(v2)));angles.push(1-Math.min(1,Math.abs(cos)));}
  const side=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const s0=side(pts[0],pts[1]), s1=side(pts[1],pts[2]), s2=side(pts[2],pts[3]), s3=side(pts[3],pts[0]);
  const parallel=1- (Math.abs(s0-s2)/(Math.max(s0,s2)+1e-6) + Math.abs(s1-s3)/(Math.max(s1,s3)+1e-6))/2;
  const angle=angles.reduce((a,b)=>a+b,0)/angles.length;
  return Math.max(0, Math.min(1, 0.7*angle + 0.3*parallel));
}

function flatten(pts){const out=[]; pts.forEach(p=>{out.push(p.x,p.y);}); return out;}

onmessage = async (e) => {
  const { imageUrl, timeoutMs = 4000, mode = 'frame' } = e.data || {};
  const t0 = Date.now();
  try {
    await ensureCV();
    const bmp = await dataUrlToBitmap(imageUrl);
    const { mat: src, scale, w, h } = bitmapToMat(bmp, 1500);
    try {
      let ordered;
      let outW, outH;

  if (mode === 'content') {
        // Content-aware rectangular crop using binarization and column/row density
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        const bin = new cv.Mat();
        cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
        const imgArea = w*h;
        // Compute per-column and per-row nonzero counts
        const colCounts = new Array(w).fill(0);
        const rowCounts = new Array(h).fill(0);
        const data = bin.data;
        for (let y=0; y<h; y++) {
          for (let x=0; x<w; x++) {
            if (data[y*w + x] > 0) { colCounts[x]++; rowCounts[y]++; }
          }
        }
        // Smooth with small window
        const smooth = (arr, k=3) => {
          const out = new Array(arr.length).fill(0);
          const r = Math.max(1, Math.floor(k/2));
          for (let i=0;i<arr.length;i++){
            let s=0,c=0; for(let j=i-r;j<=i+r;j++){ if(j>=0 && j<arr.length){ s+=arr[j]; c++; } } out[i]=s/(c||1);
          }
          return out;
        };
        const sCols = smooth(colCounts, 9);
        const sRows = smooth(rowCounts, 9);
        const colThresh = Math.max(1, Math.floor(h * 0.003)); // 0.3% rows have content
        const rowThresh = Math.max(1, Math.floor(w * 0.003)); // 0.3% cols have content
        let left=0; while (left<w-1 && sCols[left] < colThresh) left++;
        let right=w-1; while (right>left && sCols[right] < colThresh) right--;
        let top=0; while (top<h-1 && sRows[top] < rowThresh) top++;
        let bottom=h-1; while (bottom>top && sRows[bottom] < rowThresh) bottom--;
        // If a large low-density strip remains on the right, cut it more aggressively
        const rightStripWidth = (w-1)-right;
        const rightStripRatio = rightStripWidth / w;
        if (rightStripRatio < 0.35) { // check if still content but sparse
          // Find new right boundary where density drops near zero for a run
          const run = Math.max(10, Math.floor(h*0.03));
          let r2 = right;
          for (let x=w-1; x>left; x--) {
            if (sCols[x] < colThresh*0.5) { r2 = x; }
            else break;
          }
          if (r2 < right) right = r2;
        }
        const margin = Math.round(Math.max(w, h) * 0.01);
        left = Math.max(0, left - margin);
        top = Math.max(0, top - margin);
        right = Math.min(w - 1, right + margin);
        bottom = Math.min(h - 1, bottom + margin);
        gray.delete(); bin.delete();

        if (right-left < Math.max(16, w*0.1) || bottom-top < Math.max(16, h*0.1)) {
          // not enough area, fall back to full
          ordered = [{x:0,y:0},{x:bmp.width,y:0},{x:bmp.width,y:bmp.height},{x:0,y:bmp.height}];
          outW = bmp.width; outH = bmp.height;
        } else {
          const bx0 = Math.round(left/scale), by0 = Math.round(top/scale);
          const bw = Math.max(1, Math.round((right-left+1)/scale));
          const bh = Math.max(1, Math.round((bottom-top+1)/scale));
          ordered = [{x:bx0,y:by0},{x:bx0+bw,y:by0},{x:bx0+bw,y:by0+bh},{x:bx0,y:by0+bh}];
          outW = bw; outH = bh;
        }
      } else if (mode === 'focus') {
        // Focus on densest content region (e.g., main plan), removing large empty margins
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        const blur = new cv.Mat();
        cv.GaussianBlur(gray, blur, new cv.Size(3,3), 0, 0, cv.BORDER_DEFAULT);
        const edges = new cv.Mat();
        cv.Canny(blur, edges, 60, 180);
        const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3,3));
        cv.dilate(edges, edges, kernel);

        // Block-wise density map
        const blocks = Math.max(24, Math.min(72, Math.round(Math.max(w, h) / 40))); // ~25-72 px blocks
        const bw = Math.max(8, Math.floor(w / blocks));
        const bh = Math.max(8, Math.floor(h / blocks));
        const xb = Math.floor(w / bw);
        const yb = Math.floor(h / bh);
        const densities = new Float32Array(xb * yb);
        const data = edges.data;
        for (let by=0; by<yb; by++) {
          for (let bx=0; bx<xb; bx++) {
            let sum = 0;
            const x0 = bx * bw;
            const y0 = by * bh;
            for (let y2=0; y2<bh; y2++) {
              const yy = y0 + y2;
              const rowOff = yy * w + x0;
              for (let x2=0; x2<bw; x2++) sum += data[rowOff + x2] ? 1 : 0;
            }
            densities[by*xb + bx] = sum / (bw*bh);
          }
        }
        // Threshold top quantile
        const densCopy = Array.from(densities);
        densCopy.sort((a,b)=>a-b);
        const qIdx = Math.max(0, Math.floor(densCopy.length * 0.7));
        const thr = densCopy[qIdx] || 0;
        // Create mask from dense blocks
        const maskSmall = new cv.Mat.zeros(yb, xb, cv.CV_8UC1);
        for (let by=0; by<yb; by++) {
          for (let bx=0; bx<xb; bx++) {
            if (densities[by*xb + bx] >= thr) {
              maskSmall.ucharPtr(by, bx)[0] = 255;
            }
          }
        }
        // Morphologically close to connect clusters
        const k2 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3,3));
        cv.morphologyEx(maskSmall, maskSmall, cv.MORPH_CLOSE, k2);
        // Upscale mask to image size
        const mask = new cv.Mat();
        cv.resize(maskSmall, mask, new cv.Size(w, h), 0, 0, cv.INTER_NEAREST);
        // Find bounding box of largest contour
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        let bestRect = null; let bestArea = 0;
        for (let i=0; i<contours.size(); i++) {
          const cnt = contours.get(i);
          const rect = cv.boundingRect(cnt);
          const area = rect.width * rect.height;
          if (area > bestArea) { bestArea = area; bestRect = rect; }
          cnt.delete();
        }
        contours.delete(); hierarchy.delete();
        gray.delete(); blur.delete(); edges.delete(); kernel.delete(); mask.delete(); maskSmall.delete(); k2.delete();

        if (!bestRect || bestArea < (w*h*0.05)) {
          // Not enough area
          ordered = [{x:0,y:0},{x:bmp.width,y:0},{x:bmp.width,y:bmp.height},{x:0,y:bmp.height}];
          outW = bmp.width; outH = bmp.height;
        } else {
          // Expand a bit and clamp
          const pad = Math.round(Math.max(bestRect.width, bestRect.height) * 0.04);
          const l = Math.max(0, bestRect.x - pad);
          const t = Math.max(0, bestRect.y - pad);
          const r = Math.min(w-1, bestRect.x + bestRect.width + pad);
          const b = Math.min(h-1, bestRect.y + bestRect.height + pad);
          const bx0 = Math.round(l/scale), by0 = Math.round(t/scale);
          const bw2 = Math.max(1, Math.round((r-l+1)/scale));
          const bh2 = Math.max(1, Math.round((b-t+1)/scale));
          ordered = [{x:bx0,y:by0},{x:bx0+bw2,y:by0},{x:bx0+bw2,y:by0+bh2},{x:bx0,y:by0+bh2}];
          outW = bw2; outH = bh2;
        }
      } else {
        // Frame/perspective mode (original implementation)
        const gray = new cv.Mat();
        const blur = new cv.Mat();
        const edges = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0, 0, cv.BORDER_DEFAULT);
        cv.Canny(blur, edges, 50, 150);
        const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5,5));
        cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);

        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let best=null; const imgArea = w*h; const start=Date.now();
        for(let i=0;i<contours.size();i++){
          if (i%100===0 && Date.now()-start>1500) break;
          const cnt=contours.get(i);
          const peri=cv.arcLength(cnt,true);
          const approx=new cv.Mat();
          cv.approxPolyDP(cnt, approx, 0.02*peri, true);
          if (approx.rows===4 && cv.isContourConvex(approx)){
            const pts=[]; for(let r=0;r<4;r++){const x=approx.data32S[r*2]||approx.intAt(r,0); const y=approx.data32S[r*2+1]||approx.intAt(r,1); pts.push({x, y});}
            const area=cv.contourArea(approx,false);
            if (area >= imgArea*0.2){
              const rect=rectangleScore(pts); const cov=Math.min(1,area/imgArea); const score=rect*0.6+cov*0.4;
              if (!best || score>best.score) best={pts, score};
            }
          }
          approx.delete(); cnt.delete();
        }
        contours.delete(); hierarchy.delete(); gray.delete(); blur.delete(); edges.delete(); kernel.delete();

        // Prepare warp
        ordered = best ? orderQuad(best.pts).map(p=>({x:p.x/scale,y:p.y/scale})) : [{x:0,y:0},{x:bmp.width,y:0},{x:bmp.width,y:bmp.height},{x:0,y:bmp.height}];
        const s0 = Math.max(Math.hypot(ordered[0].x-ordered[1].x, ordered[0].y-ordered[1].y), Math.hypot(ordered[3].x-ordered[2].x, ordered[3].y-ordered[2].y));
        const s1 = Math.max(Math.hypot(ordered[0].x-ordered[3].x, ordered[0].y-ordered[3].y), Math.hypot(ordered[1].x-ordered[2].x, ordered[1].y-ordered[2].y));
        const maxSide = 3000; const sideScale = Math.min(1, maxSide/Math.max(s0,s1));
        outW = Math.max(1, Math.round(s0*sideScale));
        outH = Math.max(1, Math.round(s1*sideScale));
      }

      // Crop/warp on original bitmap
      const fullCanvas = new OffscreenCanvas(bmp.width, bmp.height);
      const fctx = fullCanvas.getContext('2d');
      fctx.drawImage(bmp, 0, 0);
      const fullData = fctx.getImageData(0, 0, bmp.width, bmp.height);
      const fullMat = cv.matFromImageData(fullData);

      let dataUrl;
      if (mode === 'content' && ordered.length === 4 && ordered[0].y === ordered[1].y && ordered[1].x === ordered[2].x) {
        // Rectangular crop ROI
        const x0 = Math.max(0, Math.min(ordered[0].x, ordered[3].x));
        const y0 = Math.max(0, Math.min(ordered[0].y, ordered[1].y));
        const bw = Math.max(1, Math.round(Math.abs(ordered[1].x - ordered[0].x)));
        const bh = Math.max(1, Math.round(Math.abs(ordered[3].y - ordered[0].y)));
        const rect = new cv.Rect(x0, y0, bw, bh);
        const roi = fullMat.roi(rect);
        dataUrl = await matToDataUrl(roi);
        roi.delete();
      } else {
        const srcTri = cv.matFromArray(4,1,cv.CV_32FC2, flatten(ordered));
        const dstTri = cv.matFromArray(4,1,cv.CV_32FC2, flatten([{x:0,y:0},{x:outW,y:0},{x:outW,y:outH},{x:0,y:outH}]));
        const M = cv.getPerspectiveTransform(srcTri, dstTri);
        const dst = new cv.Mat();
        cv.warpPerspective(fullMat, dst, M, new cv.Size(outW,outH), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
        dataUrl = await matToDataUrl(dst);
        srcTri.delete(); dstTri.delete(); M.delete(); dst.delete();
      }
      fullMat.delete(); src.delete();

      // Confidence: basic coverage based on amount trimmed
      let confidence = 0.6;
      if (mode === 'content') {
        const trimmed = 1 - (outW*outH)/(bmp.width*bmp.height);
        confidence = Math.max(0.4, Math.min(0.95, 0.5 + trimmed*0.5));
      }
      postMessage({ ok: true, dataUrl, quad: ordered, confidence, elapsed: Date.now()-t0 });
    } catch (err) {
      try { src.delete(); } catch{}
      postMessage({ ok:false, error: String(err) });
    }
  } catch (err) {
    postMessage({ ok:false, error: String(err) });
  }
};
