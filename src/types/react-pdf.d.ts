"use strict";

declare module "react-pdf" {
  import { ComponentType } from "react";

  export const Document: ComponentType<{
    file: string | ArrayBuffer | Blob;
    onLoadSuccess?: (document: { numPages: number }) => void;
    onLoadError?: (error: Error) => void;
    children?: React.ReactNode;
  }>;

  export const Page: ComponentType<{
    pageNumber: number;
    scale?: number;
    renderTextLayer?: boolean;
    renderAnnotationLayer?: boolean;
    onRenderSuccess?: (page: any) => void;
    onRenderError?: (error: Error) => void;
  }>;

  export const pdfjs: {
    GlobalWorkerOptions: {
      workerSrc: string;
    };
    version: string;
  };
}
