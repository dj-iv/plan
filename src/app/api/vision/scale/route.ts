import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const data = await req.json().catch(() => null) as any;
    const image: string | undefined = data?.image;
    if (!image) return new NextResponse('Missing image', { status: 400 });

    // Stub: simulate a text-based scale detection
    const unitsPerPixel = 0.005; // 1 px = 0.005 meters (dummy)
    const unit = 'meters';
    const method = 'text';
    const confidence = 0.65;
    return NextResponse.json({ unitsPerPixel, unit, method, confidence, details: { regex: '1:200', ocr: 0.72 } });
  } catch (e) {
    console.error(e);
    return new NextResponse('Scale detection failed', { status: 500 });
  }
}
