// This file is a placeholder to prevent imports from breaking
// The AI scale detection functionality has been removed
import { ScaleResult } from '../types';

export class AIScaleDetector {
  private static instance: AIScaleDetector;
  
  static getInstance(): AIScaleDetector {
    if (!this.instance) {
      this.instance = new AIScaleDetector();
    }
    return this.instance;
  }

  async detectScale(_imageUrl: string): Promise<ScaleResult[]> {
    console.log('AI scale detection has been disabled');
    return [];
  }
}
