// Enhanced perimeter detection using multiple computer vision techniques
import { Point, PerimeterResult } from '../types';

export class AIPerimeterDetector {
  private static instance: AIPerimeterDetector;
  
  static getInstance(): AIPerimeterDetector {
    if (!this.instance) {
      this.instance = new AIPerimeterDetector();
    }
    return this.instance;
  }

  async detectPerimeters(
    imageUrl: string, 
    roi?: { x: number; y: number; w: number; h: number }
  ): Promise<PerimeterResult[]> {
    return new Promise((resolve, reject) => {
      const worker = new Worker('/workers/enhanced-perimeter-opencv.js');
      
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('Perimeter detection timeout'));
      }, 15000);
      
      worker.onmessage = (e) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve(e.data.results || []);
      };
      
      worker.onerror = (error) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(error);
      };
      
      worker.postMessage({ imageUrl, roi });
    });
  }

  async detectBestPerimeter(
    imageUrl: string, 
    roi?: { x: number; y: number; w: number; h: number },
    preferences?: {
      minArea?: number;
      maxHoles?: number;
      preferLargest?: boolean;
    }
  ): Promise<PerimeterResult | null> {
    const results = await this.detectPerimeters(imageUrl, roi);
    
    if (results.length === 0) return null;
    
    // Filter based on preferences
    let filtered = results;
    
    if (preferences?.minArea) {
      filtered = filtered.filter(r => r.area >= preferences.minArea!);
    }
    
    if (preferences?.maxHoles !== undefined) {
      filtered = filtered.filter(r => (r.holes?.length || 0) <= preferences.maxHoles!);
    }
    
    if (filtered.length === 0) return results[0]; // Fallback to best overall
    
    // Sort by preference
    if (preferences?.preferLargest) {
      filtered.sort((a, b) => b.area - a.area);
    } else {
      filtered.sort((a, b) => b.confidence - a.confidence);
    }
    
    return filtered[0];
  }

  // Helper method for interactive region selection
  async detectPerimeterInRegion(
    canvas: HTMLCanvasElement,
    region: { x: number; y: number; w: number; h: number }
  ): Promise<PerimeterResult[]> {
    // Extract region and convert to data URL
    const regionCanvas = document.createElement('canvas');
    regionCanvas.width = region.w;
    regionCanvas.height = region.h;
    const ctx = regionCanvas.getContext('2d')!;
    
    ctx.drawImage(
      canvas,
      region.x, region.y, region.w, region.h,
      0, 0, region.w, region.h
    );
    
    const dataUrl = regionCanvas.toDataURL();
    const results = await this.detectPerimeters(dataUrl);
    
    // Transform coordinates back to full canvas space
    return results.map(result => ({
      ...result,
      points: result.points.map(p => ({
        x: p.x + region.x,
        y: p.y + region.y
      })),
      holes: result.holes?.map(hole =>
        hole.map(p => ({
          x: p.x + region.x,
          y: p.y + region.y
        }))
      )
    }));
  }

  // Smart area calculation with hole subtraction
  calculateNetArea(result: PerimeterResult): number {
    const mainArea = this.calculatePolygonArea(result.points);
    const holeArea = result.holes?.reduce(
      (sum, hole) => sum + this.calculatePolygonArea(hole),
      0
    ) || 0;
    
    return Math.max(0, mainArea - holeArea);
  }

  private calculatePolygonArea(points: Point[]): number {
    if (points.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
  }
}
