// Enhanced OpenCV.js worker for multiple perimeter detection methods
importScripts('https://docs.opencv.org/4.x/opencv.js');

let cv;

function onRuntimeInitialized() {
  cv.ready = true;
}

self.onmessage = async function(e) {
  const { imageUrl, roi, timeoutMs = 12000 } = e.data;
  
  try {
    if (!cv || !cv.ready) {
      cv.onRuntimeInitialized = onRuntimeInitialized;
      // Wait for OpenCV to be ready
      let attempts = 0;
      while (!cv?.ready && attempts < 100) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      
      if (!cv?.ready) {
        throw new Error('OpenCV failed to initialize');
      }
    }

    const results = await detectMultiplePerimeters(imageUrl, roi);
    self.postMessage({ ok: true, results });
    
  } catch (error) {
    self.postMessage({ ok: false, error: error.message });
  }
};

async function detectMultiplePerimeters(imageUrl, roi) {
  const img = await loadImage(imageUrl);
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  
  // Apply ROI if specified
  let processCanvas = canvas;
  if (roi) {
    processCanvas = new OffscreenCanvas(roi.w, roi.h);
    const processCtx = processCanvas.getContext('2d');
    processCtx.drawImage(canvas, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h);
  }
  
  const src = cv.imread(processCanvas);
  const results = [];
  
  try {
    // Method 1: Advanced contour detection
    const contourResults = detectContoursAdvanced(src);
    results.push(...contourResults);
    
    // Method 2: Hough line detection + connection
    const houghResults = detectHoughPerimeters(src);
    results.push(...houghResults);
    
    // Method 3: Edge linking
    const edgeResults = detectEdgeLinkedPerimeters(src);
    results.push(...edgeResults);
    
    // Remove duplicates and sort by confidence
    const uniqueResults = removeDuplicatePerimeters(results);
    return uniqueResults.sort((a, b) => b.confidence - a.confidence);
    
  } finally {
    src.delete();
  }
}

function detectContoursAdvanced(src) {
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const edges = new cv.Mat();
  const results = [];
  
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    
    // Multiple preprocessing approaches
    const approaches = [
      // Standard approach
      () => {
        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
        cv.Canny(blur, edges, 50, 150);
      },
      // High contrast approach
      () => {
        cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0);
        cv.Canny(blur, edges, 100, 200);
      },
      // Morphology approach
      () => {
        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
        cv.Canny(blur, edges, 30, 100);
        const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
        cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
        kernel.delete();
      }
    ];
    
    approaches.forEach((approach, index) => {
      approach();
      
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      
      const imgArea = src.cols * src.rows;
      
      for (let i = 0; i < contours.size() && i < 20; i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt, false);
        
        if (area < imgArea * 0.1 || area > imgArea * 0.9) {
          cnt.delete();
          continue;
        }
        
        // Approximate contour
        const peri = cv.arcLength(cnt, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.015 * peri, true);
        
        if (approx.rows >= 4) {
          const points = matToPoints(approx);
          const confidence = calculateContourConfidence(points, area, imgArea);
          
          results.push({
            perimeter: points,
            confidence: confidence + (index * 0.05), // Slight preference for different methods
            method: 'contour',
            area: area
          });
        }
        
        approx.delete();
        cnt.delete();
      }
      
      contours.delete();
      hierarchy.delete();
    });
    
  } finally {
    gray.delete();
    blur.delete();
    edges.delete();
  }
  
  return results;
}

function detectHoughPerimeters(src) {
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const lines = new cv.Mat();
  const results = [];
  
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 80, 160);
    
    // Detect lines using HoughLinesP
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 80, 50, 10);
    
    // Group lines into potential rectangles
    const lineSegments = [];
    for (let i = 0; i < lines.rows; i++) {
      const line = lines.data32S.slice(i * 4, (i + 1) * 4);
      lineSegments.push({
        start: { x: line[0], y: line[1] },
        end: { x: line[2], y: line[3] },
        length: Math.hypot(line[2] - line[0], line[3] - line[1]),
        angle: Math.atan2(line[3] - line[1], line[2] - line[0])
      });
    }
    
    // Find rectangular combinations
    const rectangles = findRectangularCombinations(lineSegments, src.cols, src.rows);
    
    rectangles.forEach(rect => {
      results.push({
        perimeter: rect.points,
        confidence: rect.confidence,
        method: 'hough',
        area: calculatePolygonArea(rect.points)
      });
    });
    
  } finally {
    gray.delete();
    edges.delete();
    lines.delete();
  }
  
  return results;
}

function detectEdgeLinkedPerimeters(src) {
  // Simplified edge linking - connect nearby edge points
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const results = [];
  
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.Canny(gray, edges, 60, 120);
    
    // Find edge points
    const edgePoints = [];
    for (let y = 0; y < edges.rows; y += 2) {
      for (let x = 0; x < edges.cols; x += 2) {
        if (edges.ucharPtr(y, x)[0] > 0) {
          edgePoints.push({ x, y });
        }
      }
    }
    
    // Simple polygon formation from edge points
    if (edgePoints.length > 100) {
      const hull = findConvexHull(edgePoints);
      if (hull.length >= 4) {
        results.push({
          perimeter: hull,
          confidence: 0.6,
          method: 'edge-linking',
          area: calculatePolygonArea(hull)
        });
      }
    }
    
  } finally {
    gray.delete();
    edges.delete();
  }
  
  return results;
}

function findRectangularCombinations(lines, width, height) {
  const rectangles = [];
  const threshold = 30; // Distance threshold
  const angleThreshold = Math.PI / 8; // 22.5 degrees
  
  // Group lines by angle
  const horizontal = lines.filter(l => Math.abs(l.angle) < angleThreshold || Math.abs(Math.abs(l.angle) - Math.PI) < angleThreshold);
  const vertical = lines.filter(l => Math.abs(Math.abs(l.angle) - Math.PI/2) < angleThreshold);
  
  // Try to form rectangles
  for (let i = 0; i < Math.min(horizontal.length, 10); i++) {
    for (let j = i + 1; j < Math.min(horizontal.length, 10); j++) {
      for (let k = 0; k < Math.min(vertical.length, 10); k++) {
        for (let l = k + 1; l < Math.min(vertical.length, 10); l++) {
          const rect = tryFormRectangle(horizontal[i], horizontal[j], vertical[k], vertical[l]);
          if (rect) {
            rectangles.push(rect);
          }
        }
      }
    }
  }
  
  return rectangles;
}

function tryFormRectangle(h1, h2, v1, v2) {
  // Simplified rectangle formation - would need more sophisticated intersection logic
  const points = [
    { x: Math.min(h1.start.x, h1.end.x, h2.start.x, h2.end.x), y: Math.min(h1.start.y, h1.end.y) },
    { x: Math.max(h1.start.x, h1.end.x, h2.start.x, h2.end.x), y: Math.min(h1.start.y, h1.end.y) },
    { x: Math.max(h1.start.x, h1.end.x, h2.start.x, h2.end.x), y: Math.max(h2.start.y, h2.end.y) },
    { x: Math.min(h1.start.x, h1.end.x, h2.start.x, h2.end.x), y: Math.max(h2.start.y, h2.end.y) }
  ];
  
  const area = calculatePolygonArea(points);
  if (area > 1000) { // Minimum area threshold
    return {
      points,
      confidence: 0.7
    };
  }
  
  return null;
}

function findConvexHull(points) {
  // Simple Graham scan for convex hull
  if (points.length < 3) return points;
  
  // Find bottom-most point
  let start = points.reduce((min, p) => p.y < min.y || (p.y === min.y && p.x < min.x) ? p : min);
  
  // Sort by polar angle
  const sorted = points
    .filter(p => p !== start)
    .sort((a, b) => {
      const angleA = Math.atan2(a.y - start.y, a.x - start.x);
      const angleB = Math.atan2(b.y - start.y, b.x - start.x);
      return angleA - angleB;
    });
  
  // Build hull
  const hull = [start];
  for (const point of sorted) {
    while (hull.length >= 2) {
      const [p1, p2] = hull.slice(-2);
      const cross = (p2.x - p1.x) * (point.y - p1.y) - (p2.y - p1.y) * (point.x - p1.x);
      if (cross <= 0) {
        hull.pop();
      } else {
        break;
      }
    }
    hull.push(point);
  }
  
  return hull;
}

function removeDuplicatePerimeters(results) {
  const unique = [];
  const threshold = 50; // Distance threshold for considering two perimeters as duplicates
  
  for (const result of results) {
    let isDuplicate = false;
    
    for (const existing of unique) {
      const distance = calculatePerimeterDistance(result.perimeter, existing.perimeter);
      if (distance < threshold) {
        // Keep the one with higher confidence
        if (result.confidence > existing.confidence) {
          const index = unique.indexOf(existing);
          unique[index] = result;
        }
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      unique.push(result);
    }
  }
  
  return unique;
}

function calculatePerimeterDistance(p1, p2) {
  if (p1.length !== p2.length) return Infinity;
  
  let totalDistance = 0;
  for (let i = 0; i < p1.length; i++) {
    const dx = p1[i].x - p2[i].x;
    const dy = p1[i].y - p2[i].y;
    totalDistance += Math.sqrt(dx * dx + dy * dy);
  }
  
  return totalDistance / p1.length;
}

function calculateContourConfidence(points, area, imgArea) {
  const areaRatio = area / imgArea;
  const aspectRatio = calculateAspectRatio(points);
  const regularityScore = calculateRegularityScore(points);
  
  return Math.min(1, areaRatio * 2 + aspectRatio * 0.3 + regularityScore * 0.7);
}

function calculateAspectRatio(points) {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const ratio = Math.min(width, height) / Math.max(width, height);
  return ratio; // Higher is better (closer to square)
}

function calculateRegularityScore(points) {
  if (points.length < 4) return 0;
  
  // Calculate angles between consecutive sides
  const angles = [];
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p3 = points[(i + 2) % points.length];
    
    const v1 = { x: p2.x - p1.x, y: p2.y - p1.y };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
    
    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    
    if (mag1 > 0 && mag2 > 0) {
      const angle = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
      angles.push(angle);
    }
  }
  
  // Score based on how close angles are to 90 degrees
  const rightAngle = Math.PI / 2;
  const avgDeviation = angles.reduce((sum, angle) => sum + Math.abs(angle - rightAngle), 0) / angles.length;
  return Math.max(0, 1 - avgDeviation / rightAngle);
}

function matToPoints(mat) {
  const points = [];
  for (let i = 0; i < mat.rows; i++) {
    const point = mat.data32S.slice(i * 2, (i + 1) * 2);
    points.push({ x: point[0], y: point[1] });
  }
  return points;
}

function calculatePolygonArea(points) {
  if (points.length < 3) return 0;
  
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
