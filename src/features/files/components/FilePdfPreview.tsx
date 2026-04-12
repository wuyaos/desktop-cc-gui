import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import { ensurePdfPreviewWorker } from "../utils/pdfPreviewRuntime";

type FilePdfPreviewProps = {
  assetUrl: string | null;
  isLoading: boolean;
  error: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
};

type PdfPageCanvasProps = {
  pdfDocument: PDFDocumentProxy;
  pageNumber: number;
  t: (key: string, options?: Record<string, unknown>) => string;
};

const MAX_PDF_PREVIEW_PAGES = 200;

function PdfPageCanvas({ pdfDocument, pageNumber, t }: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageRootRef = useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = useState(pageNumber <= 2);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    const node = pageRootRef.current;
    if (!node || shouldRender || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldRender(true);
      }
    }, { rootMargin: "240px 0px" });

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldRender]);

  useEffect(() => {
    if (!shouldRender || !canvasRef.current) {
      return;
    }

    let disposed = false;
    let renderTask: RenderTask | null = null;

    void (async () => {
      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (disposed || !canvasRef.current) {
          return;
        }
        const viewport = page.getViewport({ scale: 1.15 });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas context unavailable.");
        }
        const devicePixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * devicePixelRatio);
        canvas.height = Math.floor(viewport.height * devicePixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
        });
        await renderTask.promise;
        if (!disposed) {
          page.cleanup();
        }
      } catch (error) {
        if (!disposed) {
          setPageError(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [pageNumber, pdfDocument, shouldRender]);

  return (
    <div ref={pageRootRef} className="fvp-pdf-page">
      <header className="fvp-pdf-page-header">
        <span>{t("files.pdfPreviewPageLabel", { page: pageNumber })}</span>
      </header>
      {pageError ? (
        <div className="fvp-pdf-page-error">{pageError}</div>
      ) : shouldRender ? (
        <canvas ref={canvasRef} className="fvp-pdf-canvas" />
      ) : (
        <div className="fvp-pdf-page-placeholder">{t("files.pdfPreviewPagePlaceholder")}</div>
      )}
    </div>
  );
}

export function FilePdfPreview({
  assetUrl,
  isLoading,
  error,
  t,
}: FilePdfPreviewProps) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [isRuntimeLoading, setIsRuntimeLoading] = useState(false);

  useEffect(() => {
    if (!assetUrl) {
      setPdfDocument(null);
      setNumPages(0);
      setRuntimeError(null);
      setIsRuntimeLoading(false);
      return;
    }

    ensurePdfPreviewWorker();
    setPdfDocument(null);
    setNumPages(0);
    setRuntimeError(null);
    setIsRuntimeLoading(true);
    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let loadedDocument: PDFDocumentProxy | null = null;

    void (async () => {
      try {
        loadingTask = getDocument(assetUrl);
        const nextDocument = await loadingTask.promise;
        loadedDocument = nextDocument;
        if (disposed) {
          await nextDocument.destroy();
          return;
        }
        setPdfDocument(nextDocument);
        setNumPages(nextDocument.numPages);
        setRuntimeError(null);
        setIsRuntimeLoading(false);
      } catch (loadError) {
        if (!disposed) {
          setPdfDocument(null);
          setNumPages(0);
          setRuntimeError(loadError instanceof Error ? loadError.message : String(loadError));
          setIsRuntimeLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      if (loadedDocument) {
        void loadedDocument.destroy();
      } else {
        void loadingTask?.destroy();
      }
    };
  }, [assetUrl]);

  if (isLoading || isRuntimeLoading) {
    return <div className="fvp-status">{t("files.loadingFile")}</div>;
  }

  if (error || runtimeError) {
    return <div className="fvp-status fvp-error">{error ?? runtimeError}</div>;
  }

  if (!assetUrl || !pdfDocument) {
    return <div className="fvp-status">{t("files.pdfPreviewUnavailable")}</div>;
  }

  const visiblePageCount = Math.min(numPages, MAX_PDF_PREVIEW_PAGES);
  const isPageCountTruncated = numPages > MAX_PDF_PREVIEW_PAGES;

  return (
    <div className="fvp-preview-scroll">
      <div className="fvp-pdf-preview">
        <header className="fvp-preview-section-header">
          <strong>{t("files.pdfPreviewTitle")}</strong>
          <span>{t("files.pdfPreviewPageCount", { count: numPages })}</span>
        </header>
        {isPageCountTruncated ? (
          <div className="fvp-preview-budget-hint">
            {t("files.pdfPreviewPageLimitHint", {
              visibleCount: visiblePageCount,
              totalCount: numPages,
            })}
          </div>
        ) : null}
        <div className="fvp-pdf-pages">
          {Array.from({ length: visiblePageCount }, (_, index) => (
            <PdfPageCanvas
              key={`pdf-page-${index + 1}`}
              pdfDocument={pdfDocument}
              pageNumber={index + 1}
              t={t}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
