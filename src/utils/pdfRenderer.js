'use client';

/**
 * Direct PDF rendering utility using PDF.js
 * This approach avoids React components and uses direct browser APIs for better reliability
 */

let pdfjsLib;

const DEFAULT_RENDER_SCALE = 2;
const SAMPLE_TARGET_PIXELS = 400000;
const MAX_SAMPLE_STEP = 8;

// Load PDF.js library dynamically
const loadPdfJs = async () => {
  if (!pdfjsLib) {
    try {
      // Import the library
      pdfjsLib = await import('pdfjs-dist');

      // Set the worker source
      const pdfWorkerSrc = `//cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
    } catch (error) {
      console.error('Failed to load PDF.js:', error);
      throw new Error('Failed to initialize PDF library');
    }
  }
  return pdfjsLib;
};

const computeInkCoverage = (context, width, height) => {
  try {
    const totalPixels = width * height;
    if (!totalPixels) {
      return 0;
    }
    const sampleStep = Math.min(
      MAX_SAMPLE_STEP,
      Math.max(1, Math.floor(Math.sqrt(totalPixels / SAMPLE_TARGET_PIXELS)))
    );
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;
    let samples = 0;
    let inked = 0;
    for (let y = 0; y < height; y += sampleStep) {
      for (let x = 0; x < width; x += sampleStep) {
        const idx = (y * width + x) * 4;
        const alpha = data[idx + 3];
        if (alpha < 10) {
          continue;
        }
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const brightness = (r + g + b) / 3;
        if (brightness < 250) {
          inked += 1;
        }
        samples += 1;
      }
    }
    if (!samples) {
      return 0;
    }
    return inked / samples;
  } catch (error) {
    console.warn('Failed to compute ink coverage for PDF page', error);
    return null;
  }
};

const getPdfDocument = async (file) => {
  const pdfjs = await loadPdfJs();
  const fileURL = URL.createObjectURL(file);
  const loadingTask = pdfjs.getDocument(fileURL);
  const pdfDocument = await loadingTask.promise;
  const cleanup = () => {
    try {
      pdfDocument?.destroy?.();
    } catch (err) {
      console.warn('Error destroying PDF document', err);
    }
    URL.revokeObjectURL(fileURL);
  };
  return { pdfDocument, cleanup };
};

const renderPageFromDocument = async (pdfDocument, pageNumber, options = {}) => {
  const scale = options.scale || DEFAULT_RENDER_SCALE;
  console.log(`Rendering PDF page ${pageNumber} at scale ${scale}`);
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('Could not get canvas context');
  }
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const renderContext = {
    canvasContext: context,
    viewport,
    enableWebGL: true,
    renderInteractiveForms: false,
  };
  await page.render(renderContext).promise;
  const coverage = computeInkCoverage(context, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');
  page.cleanup?.();
  canvas.width = 0;
  canvas.height = 0;
  return {
    dataUrl,
    width: viewport.width,
    height: viewport.height,
    coverage,
  };
};

/**
 * Renders a PDF file to an image
 * @param {File} file - The PDF file to render
 * @param {number} pageNumber - Page number to render (default: 1)
 * @param {Object} options - Options for rendering
 * @param {number} options.scale - Scale factor for rendering (default: 2)
 * @returns {Promise<string>} - Promise that resolves with the data URL of the rendered page
 */
export async function renderPdfToImage(file, pageNumber = 1, options = {}) {
  const { pdfDocument, cleanup } = await getPdfDocument(file);
  try {
    const { dataUrl } = await renderPageFromDocument(pdfDocument, pageNumber, options);
    return dataUrl;
  } finally {
    cleanup();
  }
}

/**
 * Render every page in a PDF to image data with simple ink-density metrics.
 * @param {File} file
 * @param {Object} options
 * @param {number} options.scale
 * @param {number} options.maxPages - Optional safety limit for very large PDFs
 * @returns {Promise<{pages: Array, pageCount: number}>}
 */
export async function renderPdfToImages(file, options = {}) {
  const { pdfDocument, cleanup } = await getPdfDocument(file);
  try {
    const pageCount = pdfDocument.numPages;
    const maxPages = options.maxPages && Number.isFinite(options.maxPages)
      ? Math.min(options.maxPages, pageCount)
      : pageCount;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      try {
        const result = await renderPageFromDocument(pdfDocument, pageNumber, options);
        pages.push({
          pageNumber,
          dataUrl: result.dataUrl,
          width: result.width,
          height: result.height,
          coverage: result.coverage,
        });
      } catch (pageError) {
        console.warn(`Failed to render PDF page ${pageNumber}`, pageError);
        pages.push({
          pageNumber,
          error: pageError instanceof Error ? pageError.message : String(pageError),
        });
      }
    }
    return { pages, pageCount };
  } finally {
    cleanup();
  }
}

/**
 * Fallback method using PDF.js' more basic approach
 * @param {File} file - The PDF file to render
 * @returns {Promise<string>} - Promise that resolves with the data URL of the rendered page
 */
export async function renderPdfFallback(file, pageNumber = 1) {
  try {
    console.log('Using PDF fallback rendering method');
    
    // Load PDF.js
    const pdfjs = await loadPdfJs();
    
    // Get the PDF as an array buffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Load the PDF document directly from array buffer
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdfDocument = await loadingTask.promise;
    
    // Get the specified page
    const page = await pdfDocument.getPage(pageNumber);
    
    // Get the viewport at a scale of 2
    const viewport = page.getViewport({ scale: 2 });
    
    // Create a canvas and get its context
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not get canvas context');
    }
    
    // Set canvas dimensions to match the viewport
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    // Render the page with basic settings
    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;
    
    // Convert the canvas to a data URL
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('PDF fallback rendering failed:', error);
    throw error;
  }
}

/**
 * Alternative fallback method using a different approach for problematic PDFs
 * @param {File} file - The PDF file to render 
 * @returns {Promise<string>} - Promise that resolves with the data URL of the rendered page
 */
export async function renderPdfAlternative(file, _pageNumber = 1) {
  try {
    console.log('Using PDF alternative rendering method');
    
    // Load PDF.js
    await loadPdfJs();
    
    // Create a URL for the PDF file
    const fileURL = URL.createObjectURL(file);
    
    return new Promise((resolve, reject) => {
      // Create an iframe to load the PDF
      const iframe = document.createElement('iframe');
      iframe.style.visibility = 'hidden';
      iframe.style.position = 'absolute';
      iframe.style.left = '-9999px';
      iframe.style.top = '-9999px';
      iframe.width = '800';
      iframe.height = '1100';
      
      // Set source to PDF.js viewer with our PDF
      iframe.src = `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(fileURL)}`;
      
      // Add load event handler
      iframe.onload = () => {
        // Wait for PDF to render in the iframe
        setTimeout(() => {
          try {
            // Try to take a screenshot of the rendered PDF
            const canvas = document.createElement('canvas');
            canvas.width = 800;
            canvas.height = 1100;
            const ctx = canvas.getContext('2d');
            
            if (ctx) {
              // Draw the iframe content to the canvas
              ctx.drawWindow(
                iframe.contentWindow,
                0, 0, 800, 1100,
                'rgb(255, 255, 255)'
              );
              
              // Convert canvas to data URL and resolve
              resolve(canvas.toDataURL('image/png'));
            } else {
              reject(new Error('Could not get canvas context'));
            }
          } catch (error) {
            reject(error);
          } finally {
            // Clean up
            document.body.removeChild(iframe);
            URL.revokeObjectURL(fileURL);
          }
        }, 1500); // Wait 1.5 seconds for rendering
      };
      
      // Handle errors
      iframe.onerror = () => {
        document.body.removeChild(iframe);
        URL.revokeObjectURL(fileURL);
        reject(new Error('Failed to load PDF in iframe'));
      };
      
      // Add iframe to document to start loading
      document.body.appendChild(iframe);
    });
  } catch (error) {
    console.error('PDF alternative rendering failed:', error);
    throw error;
  }
}
