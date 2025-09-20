export async function captureCanvasThumbnail(canvas: HTMLCanvasElement, maxSize = 256, quality = 0.85): Promise<Blob | null> {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return null;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const off = document.createElement('canvas');
  off.width = tw; off.height = th;
  const ctx = off.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, tw, th);
  return await new Promise<Blob | null>(resolve => off.toBlob(b => resolve(b), 'image/jpeg', quality));
}
