'use client';

/**
 * Alternative approach to render a PDF page to an image
 * This can help when the regular PDF.js approach fails
 * @param {File} file - The PDF file to process
 * @returns {Promise<string>} - A data URL of the first page as an image
 */
export async function renderPdfAsFallback(file) {
  try {
    console.log("Using fallback PDF rendering method");
    
    // Create a temporary URL for the file
    const fileUrl = URL.createObjectURL(file);
    
    // Create an iframe to load the PDF
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.top = '-9999px';
    iframe.style.left = '-9999px';
    iframe.style.width = '800px';
    iframe.style.height = '600px';
    document.body.appendChild(iframe);
    
    // Wait for the PDF to load in the iframe
    return new Promise((resolve, reject) => {
      iframe.onload = async () => {
        try {
          // Give it a moment to render
          await new Promise(r => setTimeout(r, 1000));
          
          // Create a canvas to capture the iframe content
          const canvas = document.createElement('canvas');
          canvas.width = 800;
          canvas.height = 600;
          const ctx = canvas.getContext('2d');
          
          if (!ctx) {
            reject(new Error("Could not get canvas context"));
            return;
          }
          
          // Draw the iframe contents to canvas
          ctx.drawWindow(
            iframe.contentWindow,
            0, 0, 800, 600,
            "rgb(255,255,255)"
          );
          
          // Get data URL and clean up
          const dataUrl = canvas.toDataURL('image/png');
          document.body.removeChild(iframe);
          URL.revokeObjectURL(fileUrl);
          
          resolve(dataUrl);
        } catch (err) {
          document.body.removeChild(iframe);
          URL.revokeObjectURL(fileUrl);
          reject(err);
        }
      };
      
      iframe.onerror = (err) => {
        document.body.removeChild(iframe);
        URL.revokeObjectURL(fileUrl);
        reject(err);
      };
      
      // Set the source to the PDF file
      iframe.src = fileUrl;
    });
  } catch (error) {
    console.error("Fallback PDF rendering failed:", error);
    throw error;
  }
}

/**
 * Use browser's native PDF viewer capabilities when available
 * @param {File} file - The PDF file to process
 * @returns {Promise<string|null>} - A data URL of the rendered PDF or null if not supported
 */
export async function useNativePdfViewer(file) {
  try {
    // Check if browser supports PDF embedding
    const isPdfSupported = navigator?.pdfViewerEnabled || 
                          (navigator.mimeTypes && navigator.mimeTypes['application/pdf']);
                          
    if (!isPdfSupported) {
      return null;
    }
    
    // Create a blob URL for the PDF
    const fileUrl = URL.createObjectURL(file);
    
    // Create an object element for the PDF
    const obj = document.createElement('object');
    obj.style.position = 'absolute';
    obj.style.top = '-9999px';
    obj.style.left = '-9999px';
    obj.style.width = '800px';
    obj.style.height = '1000px';
    obj.type = 'application/pdf';
    obj.data = fileUrl;
    
    document.body.appendChild(obj);
    
    // Wait for the PDF to load
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          // Create a canvas to capture the rendered PDF
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          if (!ctx) {
            document.body.removeChild(obj);
            URL.revokeObjectURL(fileUrl);
            resolve(null);
            return;
          }
          
          // Set dimensions
          canvas.width = 800;
          canvas.height = 1000;
          
          // Try to render the PDF to canvas
          ctx.drawImage(obj, 0, 0, 800, 1000);
          
          // Get the data URL
          const dataUrl = canvas.toDataURL('image/png');
          
          // Clean up
          document.body.removeChild(obj);
          URL.revokeObjectURL(fileUrl);
          
          resolve(dataUrl);
        } catch (err) {
          document.body.removeChild(obj);
          URL.revokeObjectURL(fileUrl);
          resolve(null);
        }
      }, 1500); // Give it time to render
    });
  } catch (error) {
    console.error("Native PDF viewer approach failed:", error);
    return null;
  }
}
