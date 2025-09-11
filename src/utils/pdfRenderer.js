'use client';

/**
 * Direct PDF rendering utility using PDF.js
 * This approach avoids React components and uses direct browser APIs for better reliability
 */

let pdfjsLib;

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

/**
 * Renders a PDF file to an image
 * @param {File} file - The PDF file to render
 * @param {number} pageNumber - Page number to render (default: 1)
 * @param {Object} options - Options for rendering
 * @param {number} options.scale - Scale factor for rendering (default: 2)
 * @returns {Promise<string>} - Promise that resolves with the data URL of the rendered page
 */
export async function renderPdfToImage(file, pageNumber = 1, options = {}) {
  try {
    console.log(`Starting PDF rendering for page ${pageNumber}`);
    
    // Default options
    const scale = options.scale || 2;
    
    // Load PDF.js
    const pdfjs = await loadPdfJs();
    console.log(`PDF.js loaded, version ${pdfjs.version}`);
    
    // Create a URL for the PDF file
    const fileURL = URL.createObjectURL(file);
    
    // Load the PDF document
    console.log('Loading PDF document');
    const loadingTask = pdfjs.getDocument(fileURL);
    const pdfDocument = await loadingTask.promise;
    console.log(`PDF document loaded with ${pdfDocument.numPages} pages`);
    
    // Get the specified page
    const page = await pdfDocument.getPage(pageNumber);
    console.log('PDF page loaded');
    
    // Get the viewport at the specified scale
    const viewport = page.getViewport({ scale });
    
    // Create a canvas and get its context
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Could not get canvas context');
    }
    
    // Set canvas dimensions to match the viewport
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    console.log(`Canvas created with dimensions: ${canvas.width} x ${canvas.height}`);
    
    // Render the page
    console.log('Rendering PDF page to canvas');
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
      enableWebGL: true,
      renderInteractiveForms: false
    };
    
    try {
      await page.render(renderContext).promise;
      console.log('PDF page rendered successfully');
    } catch (renderError) {
      console.error('Error rendering PDF page:', renderError);
      throw new Error(`Error rendering PDF: ${renderError.message}`);
    }
    
    // Convert the canvas to a data URL
    try {
      const dataURL = canvas.toDataURL('image/png');
      console.log('Canvas converted to PNG data URL');
      
      // Clean up
      URL.revokeObjectURL(fileURL);
      return dataURL;
    } catch (dataUrlError) {
      console.error('Error creating data URL:', dataUrlError);
      throw new Error('Could not create image from rendered PDF page');
    }
  } catch (error) {
    console.error('PDF rendering failed:', error);
    throw error;
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
export async function renderPdfAlternative(file, pageNumber = 1) {
  try {
    console.log('Using PDF alternative rendering method');
    
    // Load PDF.js
    const pdfjs = await loadPdfJs();
    
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
          } catch (e) {
            reject(e);
          } finally {
            // Clean up
            document.body.removeChild(iframe);
            URL.revokeObjectURL(fileURL);
          }
        }, 1500); // Wait 1.5 seconds for rendering
      };
      
      // Handle errors
      iframe.onerror = (e) => {
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
