export interface ScaleResult {
  scale: number;
  unit: string;
  confidence: number;
  method?: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface PerimeterResult {
  points: Point[];
  area: number;
  perimeter: number;
  confidence: number;
  holes?: Point[][];
}