import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { FloorNameAiResponse } from '@/types/ai';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const responseFormat = {
  type: 'json_schema' as const,
  name: 'FloorNameDetection',
  schema: {
    type: 'object',
    properties: {
      floorName: { type: 'string', description: 'Clean floor label extracted from the plan (e.g., "Level 3" or "Basement").' },
      confidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }], description: 'Confidence score between 0 and 1 (nullable).' },
      reasoning: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Brief reasoning describing markings or features used.' },
    },
    required: ['floorName', 'confidence', 'reasoning'],
    additionalProperties: false,
  },
} as const;

export async function POST(req: NextRequest) {
  if (!openai) {
    return NextResponse.json({ error: 'OpenAI API key is not configured. Set OPENAI_API_KEY in your environment.' }, { status: 500 });
  }

  try {
    const payload = await req.json();
    const imageUrl = typeof payload?.imageUrl === 'string' ? payload.imageUrl.trim() : '';
    const currentName = typeof payload?.currentName === 'string' ? payload.currentName.trim() : '';

    if (!imageUrl) {
      return NextResponse.json({ error: 'Missing imageUrl for floor plan analysis.' }, { status: 400 });
    }

    const userTextParts: string[] = [
      'Analyse this architectural floor plan image. Identify the floor name, level number, or similar textual label visible in the drawing.',
      'Return a short label that would make sense as a floor name.'
    ];

    if (currentName) {
      userTextParts.push(`Current app label: ${currentName}. Improve or confirm it if you spot a clearer designation.`);
    }

    userTextParts.push('If no label is visible, still respond with your best guess based on signage, title blocks, or annotations.');

    const response = await openai.responses.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_output_tokens: 400,
      text: { format: responseFormat },
      input: [
        {
          role: 'system',
          content: [
            { type: 'input_text', text: 'You are an assistant that inspects floor plan images to extract clear floor names. Prefer concise labels such as "Level 5" or "Ground Floor". Do not invent building names.' },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: userTextParts.join('\n') },
            {
              type: 'input_image',
              image_url: imageUrl,
              detail: 'auto',
            },
          ],
        },
      ],
    });

    let rawText = response.output_text?.trim() || '';
    if (!rawText) {
      const firstOutput = response.output?.[0];
      if (firstOutput && typeof (firstOutput as { type?: string }).type === 'string' && 'content' in firstOutput) {
        const message = firstOutput as { content?: Array<{ type?: string; text?: string }> };
        const textItem = message.content?.find?.(item => item?.type === 'output_text' && typeof item.text === 'string');
        if (textItem?.text) {
          rawText = textItem.text.trim();
        }
      }
    }
    let parsed: FloorNameAiResponse = { floorName: null, raw: rawText };

    if (rawText) {
      try {
        const json = JSON.parse(rawText);
        const floorName = typeof json.floorName === 'string' ? json.floorName.trim() : '';
        parsed = {
          floorName: floorName || null,
          confidence: typeof json.confidence === 'number' ? json.confidence : undefined,
          reasoning: typeof json.reasoning === 'string' ? json.reasoning : undefined,
          raw: rawText,
        };
      } catch (err) {
        parsed = { floorName: null, raw: rawText, reasoning: 'Failed to parse structured response.' };
      }
    }

    return NextResponse.json(parsed);
  } catch (error: unknown) {
    console.error('AI floor label detection failed', error);
    if (error instanceof OpenAI.APIError) {
      return NextResponse.json({ error: error.message, details: error.error }, { status: error.status || 500 });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to detect floor name.' }, { status: 500 });
  }
}
