/* global importScripts, onmessage, postMessage */

let cvReady = false;
let cvLoading = null;
function ensureCV() {
  if (cvReady) return Promise.resolve();
  if (cvLoading) return cvLoading;
  cvLoading = new Promise((resolve, reject) => {
    try {
      importScripts('https://docs.opencv.org/4.x/opencv.js');
      cv.onRuntimeInitialized = () => { cvReady = true; resolve(); };
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

function offscreenFromBitmap(bmp) {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  return { canvas: c, ctx };
}

onmessage = async (e) => {
  const { imageUrl, roi, timeoutMs = 7000 } = e.data || {};
  try {
    await ensureCV();
    const bmp = await dataUrlToBitmap(imageUrl);
    const { canvas, ctx } = offscreenFromBitmap(bmp);
    // Compute ROI
    let x0 = 0, y0 = 0, w0 = bmp.width, h0 = bmp.height;
    if (roi && typeof roi.x === 'number') {
      x0 = Math.max(0, Math.min(bmp.width - 1, Math.round(roi.x)));
      y0 = Math.max(0, Math.min(bmp.height - 1, Math.round(roi.y)));
      w0 = Math.max(1, Math.min(bmp.width - x0, Math.round(roi.w))); 
      h0 = Math.max(1, Math.min(bmp.height - y0, Math.round(roi.h)));
    }

    // Extract ROI image data
    const imgData = ctx.getImageData(x0, y0, w0, h0);
    const srcFull = cv.matFromImageData(imgData);

    // Downscale for speed
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(w0, h0));
    const dw = Math.max(1, Math.round(w0 * scale));
    const dh = Math.max(1, Math.round(h0 * scale));
    let src = new cv.Mat();
    cv.resize(srcFull, src, new cv.Size(dw, dh), 0, 0, cv.INTER_AREA);
    srcFull.delete();

    // Preprocess: gray -> blur -> threshold (OTSU, inverted) -> close gaps
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const blur = new cv.Mat();
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0, 0, cv.BORDER_DEFAULT);
    const bin = new cv.Mat();
    cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
    const base = Math.max(dw, dh);
    const kSize = Math.max(3, (base * 0.006) | 1);
    const kC = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kSize, kSize));
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kC);

    // Find external contours (simple, pick largest)
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(bin, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let bestIdx = -1, bestArea = 0, bestCnt = null;
    for (let i=0; i<contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt, false);
      if (area > bestArea) { bestArea = area; bestIdx = i; bestCnt = cnt; }
    }
    let pts = [];
    let rawPts = [];
    if (bestCnt) {
      // Approximate polygon
      const peri = cv.arcLength(bestCnt, true);
      const approx = new cv.Mat();
      const eps = Math.max(1.5, 0.012 * peri);
      cv.approxPolyDP(bestCnt, approx, eps, true);
      for (let r=0; r<approx.rows; r++) {
        const x = approx.data32S[r*2] ?? approx.intAt(r,0);
        const y = approx.data32S[r*2+1] ?? approx.intAt(r,1);
        const xi = Math.round((x / scale) + x0);
        const yi = Math.round((y / scale) + y0);
        pts.push({ x: xi, y: yi });
      }
      // Collect raw contour points
      try {
        // bestCnt is Nx1x2 of CV_32SC2; iterate similarly
        const total = bestCnt.rows; // in OpenCV.js contours are Nx1
        for (let r = 0; r < total; r++) {
          const rx = bestCnt.data32S ? bestCnt.data32S[r*2] : bestCnt.intAt(r, 0);
          const ry = bestCnt.data32S ? bestCnt.data32S[r*2+1] : bestCnt.intAt(r, 1);
          const rxi = Math.round((rx / scale) + x0);
          const ryi = Math.round((ry / scale) + y0);
          rawPts.push({ x: rxi, y: ryi });
        }
      } catch {}
      approx.delete();
    }

    // Cleanup
    contours.delete(); hierarchy.delete(); gray.delete(); blur.delete(); bin.delete(); kC.delete(); src.delete();

  if (!pts.length) {
      postMessage({ ok: false, error: 'no-contour' });
      return;
    }
    // Simple confidence: coverage vs ROI area
    const cov = bestArea / (dw * dh);
  const confidence = Math.max(0.4, Math.min(0.95, 0.5 + cov * 0.5));
  postMessage({ ok: true, points: pts, rawPoints: rawPts && rawPts.length ? rawPts : undefined, confidence });
  } catch (e) {
    postMessage({ ok: false, error: String(e) });
  }
};
