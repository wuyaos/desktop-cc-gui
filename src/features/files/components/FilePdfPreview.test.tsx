/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePdfPreview } from "./FilePdfPreview";

const pdfMocks = vi.hoisted(() => ({
  ensurePdfPreviewWorker: vi.fn(),
  getDocument: vi.fn(),
}));

vi.mock("../utils/pdfPreviewRuntime", () => ({
  ensurePdfPreviewWorker: pdfMocks.ensurePdfPreviewWorker,
}));

vi.mock("pdfjs-dist", () => ({
  getDocument: pdfMocks.getDocument,
}));

describe("FilePdfPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ setTransform: vi.fn() } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disposes the pdf runtime and cancels page rendering on unmount", async () => {
    const renderCancel = vi.fn();
    const loadingTaskDestroy = vi.fn();
    const documentDestroy = vi.fn();
    const pageCleanup = vi.fn();

    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        destroy: documentDestroy,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn(() => ({ width: 120, height: 180 })),
          render: vi.fn(() => ({
            promise: new Promise(() => {}),
            cancel: renderCancel,
          })),
          cleanup: pageCleanup,
        }),
      }),
      destroy: loadingTaskDestroy,
    });

    const { unmount } = render(
      <FilePdfPreview
        assetUrl="asset://preview.pdf"
        isLoading={false}
        error={null}
        t={(key) => key}
      />,
    );

    await waitFor(() => {
      expect(pdfMocks.getDocument).toHaveBeenCalledWith("asset://preview.pdf");
    });

    await waitFor(() => {
      expect(pdfMocks.ensurePdfPreviewWorker).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(loadingTaskDestroy).not.toHaveBeenCalled();
    expect(documentDestroy).toHaveBeenCalledTimes(1);
    expect(renderCancel).toHaveBeenCalledTimes(1);
    expect(pageCleanup).not.toHaveBeenCalled();
  });

  it("clears stale document content on asset changes and caps rendered page containers", async () => {
    pdfMocks.getDocument
      .mockReturnValueOnce({
        promise: Promise.resolve({
          numPages: 250,
          destroy: vi.fn(),
          getPage: vi.fn().mockResolvedValue({
            getViewport: vi.fn(() => ({ width: 120, height: 180 })),
            render: vi.fn(() => ({
              promise: Promise.resolve(),
              cancel: vi.fn(),
            })),
            cleanup: vi.fn(),
          }),
        }),
        destroy: vi.fn(),
      })
      .mockReturnValueOnce({
        promise: new Promise(() => {}),
        destroy: vi.fn(),
      });

    const { container, rerender } = render(
      <FilePdfPreview
        assetUrl="asset://first.pdf"
        isLoading={false}
        error={null}
        t={(key, options) =>
          key === "files.pdfPreviewPageLimitHint"
            ? `limit-${String(options?.visibleCount)}-${String(options?.totalCount)}`
            : key
        }
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("limit-200-250")).toBeTruthy();
    });
    expect(container.querySelectorAll(".fvp-pdf-page")).toHaveLength(200);

    rerender(
      <FilePdfPreview
        assetUrl="asset://second.pdf"
        isLoading={false}
        error={null}
        t={(key) => key}
      />,
    );

    await waitFor(() => {
      expect(pdfMocks.getDocument).toHaveBeenCalledWith("asset://second.pdf");
    });
    expect(container.querySelectorAll(".fvp-pdf-page")).toHaveLength(0);
    expect(screen.getByText("files.loadingFile")).toBeTruthy();
  });
});
