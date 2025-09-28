import { renderPdfToImages, renderPdfToImage, renderPdfFallback, renderPdfAlternative } from './pdfRenderer';

export type PdfPageClassification = 'floor' | 'text' | 'unknown';

export interface PdfPageCandidate {
  pageNumber: number;
  dataUrl: string;
  coverage?: number | null;
  classification: PdfPageClassification;
}

export interface PdfExtractionOptions {
  maxPages?: number;
  scale?: number;
  floorThreshold?: number;
  textThreshold?: number;
}

export interface PdfExtractionResult {
  pages: PdfPageCandidate[];
  pageCount: number;
  textPages: number[];
  erroredPages: number[];
  truncated: boolean;
  fallback?: 'single' | 'fallback' | 'alternative';
}

const DEFAULT_SCALE = 2;
const DEFAULT_MAX_PAGES = 40;
const DEFAULT_FLOOR_THRESHOLD = 0.05;
const DEFAULT_TEXT_THRESHOLD = 0.015;

const classifyCoverage = (coverage: number | null | undefined, floorThreshold: number, textThreshold: number): PdfPageClassification => {
  if (typeof coverage !== 'number' || Number.isNaN(coverage)) {
    return 'unknown';
  }
  if (coverage >= floorThreshold) {
    return 'floor';
  }
  if (coverage <= textThreshold) {
    return 'text';
  }
  return 'unknown';
};

const normalisePageNumber = (pageNumber: number | undefined, fallback: number) => {
  if (typeof pageNumber === 'number' && Number.isFinite(pageNumber) && pageNumber > 0) {
    return pageNumber;
  }
  return fallback;
};

const normaliseDataUrl = (dataUrl: string | undefined | null) => {
  if (!dataUrl || dataUrl === 'data:,') {
    throw new Error('PDF conversion produced empty result');
  }
  return dataUrl;
};

export async function extractPdfPages(
  file: File,
  options: PdfExtractionOptions = {}
): Promise<PdfExtractionResult> {
  const scale = options.scale ?? DEFAULT_SCALE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const floorThreshold = options.floorThreshold ?? DEFAULT_FLOOR_THRESHOLD;
  const textThreshold = options.textThreshold ?? DEFAULT_TEXT_THRESHOLD;

  try {
    const result = await renderPdfToImages(file, { scale, maxPages });
    const usablePages = result.pages
      .filter(page => page && !page.error && page.dataUrl)
      .map((page, index) => {
        const coverage = typeof page.coverage === 'number' ? page.coverage : null;
        const pageNumber = normalisePageNumber(page.pageNumber, index + 1);
        return {
          pageNumber,
          dataUrl: normaliseDataUrl(page.dataUrl),
          coverage,
          classification: classifyCoverage(coverage, floorThreshold, textThreshold),
        } as PdfPageCandidate;
      });

    if (!usablePages.length) {
      throw new Error('PDF conversion did not produce any renderable pages');
    }

    const textPages = usablePages
      .filter(page => page.classification === 'text')
      .map(page => page.pageNumber);

    const erroredPages = result.pages
      .filter(page => page?.error)
      .map(page => normalisePageNumber(page?.pageNumber, 0))
      .filter(pageNumber => pageNumber > 0);

    const truncated = result.pages.length < result.pageCount;

    return {
      pages: usablePages,
      pageCount: result.pageCount,
      textPages,
      erroredPages,
      truncated,
    };
  } catch (primaryError) {
    console.warn('Primary multi-page PDF rendering failed', primaryError);
  }

  const singlePageAttempt = async (renderer: () => Promise<string>, fallback: 'single' | 'fallback' | 'alternative') => {
    const dataUrl = normaliseDataUrl(await renderer());
    return {
      pages: [{
        pageNumber: 1,
        dataUrl,
        coverage: null,
        classification: 'unknown',
      }],
      pageCount: 1,
      textPages: [],
      erroredPages: [],
      truncated: false,
      fallback,
    } as PdfExtractionResult;
  };

  try {
    return await singlePageAttempt(() => renderPdfToImage(file, 1, { scale }), 'single');
  } catch (singleError) {
    console.warn('Single-page PDF renderer failed', singleError);
  }

  try {
    return await singlePageAttempt(() => renderPdfFallback(file, 1), 'fallback');
  } catch (fallbackError) {
    console.warn('PDF fallback renderer failed', fallbackError);
  }

  try {
    return await singlePageAttempt(() => renderPdfAlternative(file, 1), 'alternative');
  } catch (alternativeError) {
    console.error('All PDF rendering methods failed', alternativeError);
    throw alternativeError;
  }
}
