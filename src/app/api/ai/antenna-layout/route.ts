import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const layoutSchema = {
  name: 'AntennaPlacementPlan',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      notes: { type: 'string', default: '' },
      tuning: {
        type: 'object',
        additionalProperties: false,
        properties: {
          overlapPercent: { type: 'number' },
          targetCoveragePercent: { type: 'number' },
          edgeBufferMultiplier: { type: 'number' },
        },
        default: {},
      },
      adjustments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            dxMeters: { type: 'number' },
            dyMeters: { type: 'number' },
          },
          required: ['id'],
        },
        default: [],
      },
      removals: {
        type: 'array',
        items: { type: 'string' },
        default: [],
      },
      newAntennas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            xMeters: { type: 'number' },
            yMeters: { type: 'number' },
            rangeMeters: { type: 'number' },
          },
          required: ['xMeters', 'yMeters'],
        },
        default: [],
      },
    },
    required: ['notes', 'tuning', 'adjustments', 'removals', 'newAntennas'],
  },
};

type ChatMessage = { role: 'system' | 'user'; content: string };

async function requestPlanFromAi(messages: ChatMessage[]): Promise<string | null> {
  if (!openai) {
    throw new Error('OpenAI API key is not configured.');
  }

  const responseFormat = { type: 'json_schema', json_schema: layoutSchema } as const;

  const extractText = (payload: unknown): string | null => {
    if (!payload) return null;
    if (typeof payload === 'string') return payload.trim() || null;
    if (Array.isArray(payload)) {
      for (const part of payload) {
        const text = extractText(part);
        if (text) return text;
      }
      return null;
    }
    if (typeof payload === 'object') {
      const maybeText = (payload as { text?: unknown }).text;
      if (typeof maybeText === 'string' && maybeText.trim()) {
        return maybeText.trim();
      }
      const content = (payload as { content?: unknown }).content;
      return extractText(content ?? null);
    }
    return null;
  };

  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      temperature: 0.25,
      response_format: responseFormat,
      input: messages,
    } as any);

    const primary = response.output_text?.trim();
    if (primary) return primary;
    const fallback = extractText(response.output ?? null);
    if (fallback) return fallback;
  } catch (primaryError) {
    console.error('OpenAI responses API call failed, attempting chat.completions fallback', primaryError);
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.25,
        response_format: responseFormat as any,
        messages,
      } as any);
      const choice = completion.choices?.[0]?.message;
      const text = extractText(choice?.content ?? null);
      if (text) return text;
    } catch (fallbackError) {
      console.error('OpenAI chat completion fallback failed', fallbackError);
      throw fallbackError;
    }
  }

  return null;
}

function formatNumber(value: unknown, fallback = '0'): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : fallback;
}

export async function POST(req: NextRequest) {
  if (!openai) {
    return NextResponse.json({ error: 'OpenAI API key is not configured. Set OPENAI_API_KEY to enable AI placement.' }, { status: 503 });
  }

  try {
    const payload = await req.json();
    const {
      scene,
      report,
      baselineAntennas,
      uncoveredSamples,
      overlapPercent,
      targetCoveragePercent,
      rangeMeters,
      edgeBufferMeters,
      areaCount,
      exclusionCount,
    } = payload ?? {};

    if (!scene?.boundsMeters || !scene?.scaleMetersPerPixel) {
      return NextResponse.json({ error: 'Missing scene bounds in request.' }, { status: 400 });
    }
    if (!report) {
      return NextResponse.json({ error: 'Missing coverage report payload.' }, { status: 400 });
    }
    if (!Array.isArray(baselineAntennas) || baselineAntennas.length === 0) {
      return NextResponse.json({ error: 'Baseline antennas are required for AI refinement.' }, { status: 400 });
    }

    const boundsMeters = scene.boundsMeters;
    const sceneSummary = [
      `Scene size: ${formatNumber(boundsMeters.width)}m × ${formatNumber(boundsMeters.height)}m`,
      `Scale: ${formatNumber(scene.scaleMetersPerPixel)} meters per pixel`,
      `Active areas: ${areaCount ?? 0}, exclusions: ${exclusionCount ?? 0}`,
      `Antenna radius: ${formatNumber(rangeMeters)} m`,
      `Baseline coverage: ${formatNumber(report.coveragePercent)}% (target ${formatNumber(report.targetPercent)}%)`,
      `Antenna count: ${report.antennaCount} (theoretical minimum ${formatNumber(report.theoreticalMin)}, suggested ${report.baselineCount ?? 0})`,
      `Overlap setting: ${formatNumber(overlapPercent)}%`,
      `Edge buffer: ${formatNumber(edgeBufferMeters)} m`,
      `Target coverage: ${formatNumber(targetCoveragePercent)}%`,
    ].join('\n');

    const antennaLines = baselineAntennas
      .slice(0, 48)
      .map((ant: any, idx: number) => {
        const x = formatNumber(ant.xMeters);
        const y = formatNumber(ant.yMeters);
        const edge = formatNumber(ant.edgeDistanceMeters);
        const seed = ant.seed ? 'seed' : 'solver';
        return `${idx + 1}. ${ant.id ?? `auto-${idx}`} → (${x}m, ${y}m) edge=${edge}m area=${ant.areaIdx ?? -1} [${seed}]`;
      })
      .join('\n');

    const hotspotLines = Array.isArray(uncoveredSamples) && uncoveredSamples.length
      ? uncoveredSamples
          .slice(0, 40)
          .map((pt: any, idx: number) => {
            const x = formatNumber(pt.xMeters);
            const y = formatNumber(pt.yMeters);
            return `${idx + 1}. hotspot @ (${x}m, ${y}m) area=${pt.areaIdx ?? -1}`;
          })
          .join('\n')
      : 'None detected';

    const prompt = `You are an RF optimisation co-pilot. Given antenna positions in meters relative to the floorplan bounds, suggest micro-adjustments (<=0.85 × range per axis), optional removals, and at most 3 new antennas to improve coverage. Keep coordinates within the scene bounds. Prefer tuning overlap/target instead of adding many antennas. All antennas share the same radius.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          sceneSummary,
          '\nBaseline antennas:\n',
          antennaLines,
          '\nUncovered hotspots:\n',
          hotspotLines,
        ].join('\n'),
      },
    ];

    let jsonText: string | null = null;
    try {
      jsonText = await requestPlanFromAi(messages);
    } catch (error) {
      console.error('AI layout invocation failed', error);
      return NextResponse.json({ error: 'Failed to generate AI-guided placement.', detail: error instanceof Error ? error.message : String(error) }, { status: 502 });
    }

    if (!jsonText) {
      return NextResponse.json({ error: 'AI response was empty.' }, { status: 502 });
    }

    let plan;
    try {
      plan = JSON.parse(jsonText);
    } catch (error) {
      console.error('AI layout parse error', error, jsonText);
      return NextResponse.json({ error: 'Failed to parse AI response.', detail: jsonText }, { status: 502 });
    }

    return NextResponse.json({ plan });
  } catch (error) {
    console.error('AI antenna layout error', error);
    return NextResponse.json({ error: 'Failed to generate AI-guided placement.' }, { status: 500 });
  }
}
