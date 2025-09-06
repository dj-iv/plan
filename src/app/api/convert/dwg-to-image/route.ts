import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// DWG → PNG via ConvertAPI (https://www.convertapi.com/)
// Set env var CONVERT_API_SECRET

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return new NextResponse('No file provided', { status: 400 });
    }

    const secret = process.env.CONVERT_API_SECRET;
    if (!secret) {
      return new NextResponse(
        'DWG conversion backend is not configured. Set CONVERT_API_SECRET or upload a PDF/PNG.',
        { status: 501 }
      );
    }

    // Build upstream form-data to ConvertAPI
    const upstream = new FormData();
    // ConvertAPI expects the field name 'File'
    upstream.append('File', file as any, (file as File).name || 'upload.dwg');

    // Optional tuning: e.g., image size, background color, etc. (uncomment as needed)
    // upstream.append('ScaleImage', 'true');
    // upstream.append('ImageResize', '2000x2000');

    const url = `https://v2.convertapi.com/convert/dwg/to/png?Secret=${encodeURIComponent(secret)}`;
    const r = await fetch(url, { method: 'POST', body: upstream });
    if (!r.ok) {
      const text = await r.text();
      return new NextResponse(`ConvertAPI error: ${text || r.statusText}`, { status: 502 });
    }
    const json = await r.json().catch(() => null) as any;
    const fileInfo = json?.Files?.[0];
    const fileUrl: string | undefined = fileInfo?.Url || fileInfo?.UrlShort;
    if (!fileUrl) {
      return new NextResponse('Conversion succeeded but no file URL returned', { status: 502 });
    }

    // Download the converted PNG and return as data URL
    const pngResp = await fetch(fileUrl);
    if (!pngResp.ok) {
      return new NextResponse('Failed to fetch converted image', { status: 502 });
    }
    const buf = Buffer.from(await pngResp.arrayBuffer());
    const base64 = buf.toString('base64');
    const dataUrl = `data:image/png;base64,${base64}`;
    return NextResponse.json({ dataUrl });
  } catch (err: any) {
    console.error('DWG convert error', err);
    return new NextResponse('DWG conversion failed', { status: 500 });
  }
}
