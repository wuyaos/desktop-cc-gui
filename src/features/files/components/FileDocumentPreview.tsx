import type { FilePreviewPayload } from "../hooks/useFilePreviewPayload";

type FileDocumentPreviewProps = {
  payload: FilePreviewPayload | null;
  isLoading: boolean;
  error: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
};

export function FileDocumentPreview({
  payload,
  isLoading,
  error,
  t,
}: FileDocumentPreviewProps) {
  if (isLoading) {
    return <div className="fvp-status">{t("files.loadingFile")}</div>;
  }

  if (error) {
    return <div className="fvp-status fvp-error">{error}</div>;
  }

  if (!payload) {
    return <div className="fvp-status">{t("files.documentPreviewUnavailable")}</div>;
  }

  if (payload.kind === "unsupported") {
    const message = payload.reason === "legacy-doc"
      ? t("files.documentPreviewLegacyDocFallback")
      : payload.reason === "budget-exceeded"
        ? t("files.documentPreviewTooLarge", {
          maxMb: payload.budgetMegabytes ?? 2,
        })
      : payload.detail ?? t("files.documentPreviewUnavailable");
    return (
      <div className="fvp-preview-scroll">
        <div className="fvp-document-preview fvp-document-preview--fallback">
          <header className="fvp-preview-section-header">
            <strong>{t("files.documentPreviewTitle")}</strong>
          </header>
          <p>{message}</p>
          <p className="fvp-preview-budget-hint">{t("files.documentPreviewFallbackHint")}</p>
        </div>
      </div>
    );
  }

  if (payload.kind !== "extracted-structure") {
    return <div className="fvp-status">{t("files.documentPreviewUnavailable")}</div>;
  }

  return (
    <div className="fvp-preview-scroll">
      <div className="fvp-document-preview">
        <header className="fvp-preview-section-header">
          <strong>{t("files.documentPreviewTitle")}</strong>
          {payload.byteLength > 0 ? (
            <span>{t("files.documentPreviewByteLength", { bytes: payload.byteLength })}</span>
          ) : null}
        </header>
        {payload.warnings.length > 0 ? (
          <div className="fvp-preview-budget-hint">
            {payload.warnings[0]}
          </div>
        ) : null}
        <article
          className="fvp-document-preview-article"
          dangerouslySetInnerHTML={{ __html: payload.html }}
        />
      </div>
    </div>
  );
}
