export type FloorNameAiStatus = {
  status: 'idle' | 'loading' | 'success' | 'error';
  suggestedName?: string;
  confidence?: number;
  reason?: string;
  error?: string;
};

export type FloorNameAiResponse = {
  floorName: string | null;
  confidence?: number;
  reasoning?: string;
  raw?: string;
  error?: string;
  details?: unknown;
};
