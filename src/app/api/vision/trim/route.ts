import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const data = await req.json().catch(() => null) as any;
    const image: string | undefined = data?.image;
    if (!image) return new NextResponse('Missing image', { status: 400 });

    // Stub: return the image unchanged with a plausible quadrilateral and medium confidence
    const quad = [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 90 },
      { x: 10, y: 90 },
    ];
    return NextResponse.json({ croppedImage: image, quad, confidence: 0.6 });
  } catch (e) {
    console.error(e);
    return new NextResponse('Trim failed', { status: 500 });
  }
}
