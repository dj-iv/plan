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
    } catch (e) { reject(e); }
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
  const { imageUrl, perimeterPoints, timeoutMs = 8000 } = e.data || {};
  try {
    if (!perimeterPoints || !perimeterPoints.length) {
      postMessage({ ok: false, error: 'no-perimeter' });
      return;
    }
    await ensureCV();
    const bmp = await dataUrlToBitmap(imageUrl);
    const { canvas, ctx } = offscreenFromBitmap(bmp);

    // Compute a tight ROI around perimeter with a small padding
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of perimeterPoints) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    const pad = Math.round(Math.max(bmp.width, bmp.height) * 0.01);
    const x0 = Math.max(0, Math.floor(minX - pad));
    const y0 = Math.max(0, Math.floor(minY - pad));
    const w0 = Math.max(1, Math.min(bmp.width - x0, Math.ceil((maxX - minX) + 2*pad)));
    const h0 = Math.max(1, Math.min(bmp.height - y0, Math.ceil((maxY - minY) + 2*pad)));

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

    // Preprocess: gray -> blur -> OTSU (inv) -> small close
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const blur = new cv.Mat();
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0, 0, cv.BORDER_DEFAULT);
    const bin = new cv.Mat();
    cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
    const base = Math.max(dw, dh);
    const kSize = Math.max(3, (base * 0.004) | 1);
    const kC = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kSize, kSize));
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kC);

    // Create mask from perimeter polygon (scaled to ROI and downscaled)
    const mask = new cv.Mat.zeros(dh, dw, cv.CV_8UC1);
    const pts = new cv.Mat(perimeterPoints.length, 1, cv.CV_32SC2);
    for (let i=0;i<perimeterPoints.length;i++) {
      const xi = Math.round((perimeterPoints[i].x - x0) * scale);
      const yi = Math.round((perimeterPoints[i].y - y0) * scale);
      pts.intPtr(i,0)[0] = xi;
      pts.intPtr(i,0)[1] = yi;
    }
    const contoursVec = new cv.MatVector();
    contoursVec.push_back(pts);
    cv.fillPoly(mask, contoursVec, new cv.Scalar(255));
    // Erode mask slightly to avoid touching border noise
    const kE = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(1,(base*0.003)|1), Math.max(1,(base*0.003)|1)));
    cv.erode(mask, mask, kE);

    // Invert bin so background becomes white; then mask inside perimeter
    const inv = new cv.Mat();
    cv.bitwise_not(bin, inv);
    const inside = new cv.Mat();
    cv.bitwise_and(inv, mask, inside);
    // Remove small speckles
    const kO = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(Math.max(1,(base*0.003)|1), Math.max(1,(base*0.003)|1)));
    cv.morphologyEx(inside, inside, cv.MORPH_OPEN, kO);

    // Find connected components (holes) as external contours in 'inside'
    const holesContours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(inside, holesContours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const holes = [];
    // area thresholds
    const minArea = (dw * dh) * 0.0008; // ignore very small
    for (let i=0;i<holesContours.size();i++) {
      const cnt = holesContours.get(i);
      const area = cv.contourArea(cnt, false);
      if (area < minArea) { cnt.delete(); continue; }
      // Approximate polygon
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      const eps = Math.max(1.5, peri * 0.01);
      cv.approxPolyDP(cnt, approx, eps, true);
      const ptsOut = [];
      for (let r=0; r<approx.rows; r++) {
        const x = approx.data32S[r*2] ?? approx.intAt(r,0);
        const y = approx.data32S[r*2+1] ?? approx.intAt(r,1);
        const xi = Math.round(x / scale) + x0;
        const yi = Math.round(y / scale) + y0;
        ptsOut.push({ x: xi, y: yi });
      }
      approx.delete(); cnt.delete();
      if (ptsOut.length >= 3) holes.push(ptsOut);
    }

    // Cleanup
    holesContours.delete(); hierarchy.delete();
    kC.delete(); kE.delete(); kO.delete();
    gray.delete(); blur.delete(); bin.delete(); inv.delete(); inside.delete(); mask.delete(); pts.delete(); contoursVec.delete(); src.delete();

    postMessage({ ok: true, holes });
  } catch (err) {
    postMessage({ ok: false, error: String(err) });
  }
};
