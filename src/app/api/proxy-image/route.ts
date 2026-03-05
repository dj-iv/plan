import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy for Firebase Storage images.
 * Browsers block cross-origin <img> loads that set crossOrigin="anonymous"
 * when the storage bucket's CORS policy doesn't include the requesting origin.
 * By fetching on the server we bypass CORS entirely and return the bytes
 * with permissive headers so the browser can use them in <canvas> without
 * tainting it.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // Only proxy Firebase Storage URLs for security
  if (
    !url.includes('firebasestorage.googleapis.com') &&
    !url.includes('.firebasestorage.app')
  ) {
    return NextResponse.json({ error: 'Only Firebase Storage URLs are allowed' }, { status: 403 });
  }

  try {
    const upstream = await fetch(url, {
      headers: { Accept: 'image/*' },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${upstream.status}` },
        { status: upstream.statusText ? upstream.status : 502 },
      );
    }

    const contentType = upstream.headers.get('Content-Type') || 'image/png';
    const buffer = await upstream.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: any) {
    console.error('proxy-image error:', err);
    return NextResponse.json({ error: err.message || 'Proxy fetch failed' }, { status: 502 });
  }
}
