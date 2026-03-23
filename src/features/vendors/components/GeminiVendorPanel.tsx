import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Save from "lucide-react/dist/esm/icons/save";
import { Button } from "@/components/ui/button";
import { GEMINI_AUTH_MODES, type GeminiAuthMode } from "../types";
import { useGeminiVendorManagement } from "../hooks/useGeminiVendorManagement";

function modeLabel(t: (key: string) => string, mode: GeminiAuthMode): string {
  if (mode === "custom") return t("settings.vendor.gemini.mode.custom");
  if (mode === "login_google") return t("settings.vendor.gemini.mode.loginGoogle");
  if (mode === "gemini_api_key") return "Gemini API Key";
  if (mode === "vertex_adc") return "Vertex AI (ADC)";
  if (mode === "vertex_service_account") {
    return t("settings.vendor.gemini.mode.vertexServiceAccount");
  }
  return "Vertex AI API Key";
}

function modeHint(t: (key: string) => string, mode: GeminiAuthMode): string {
  if (mode === "custom") return t("settings.vendor.gemini.hint.custom");
  if (mode === "login_google") return t("settings.vendor.gemini.hint.loginGoogle");
  if (mode === "gemini_api_key") return t("settings.vendor.gemini.hint.geminiApiKey");
  if (mode === "vertex_adc") return t("settings.vendor.gemini.hint.vertexAdc");
  if (mode === "vertex_service_account") {
    return t("settings.vendor.gemini.hint.vertexServiceAccount");
  }
  return t("settings.vendor.gemini.hint.vertexApiKey");
}

export function GeminiVendorPanel() {
  const { t } = useTranslation();
  const {
    draft,
    preflightChecks,
    preflightLoading,
    savingEnv,
    savingConfig,
    showKey,
    error,
    savedAt,
    setShowKey,
    refreshPreflight,
    handleDraftEnvTextChange,
    handleSaveEnv,
    handleGeminiAuthModeChange,
    handleGeminiFieldChange,
    handleSaveConfig,
  } = useGeminiVendorManagement();

  const isVertexMode =
    draft.authMode === "vertex_adc" ||
    draft.authMode === "vertex_service_account" ||
    draft.authMode === "vertex_api_key";
  const shouldShowApiBaseUrl = draft.authMode === "custom";
  const shouldShowApiKey =
    draft.authMode === "custom" ||
    draft.authMode === "gemini_api_key" ||
    draft.authMode === "vertex_api_key";
  const keyLabel =
    draft.authMode === "vertex_api_key" ? "GOOGLE_API_KEY" : "GEMINI_API_KEY";
  const keyValue =
    draft.authMode === "vertex_api_key" ? draft.googleApiKey : draft.geminiApiKey;

  return (
    <div className="vendor-tab-content vendor-gemini-shell">
      <div className="vendor-gemini-grid">
        <section className="vendor-gemini-card vendor-gemini-card-checks">
          <div className="vendor-gemini-section-head">
            <span className="vendor-gemini-section-title">
              {t("settings.vendor.gemini.preflightCount", {
                count: preflightChecks.length,
              })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={preflightLoading}
              onClick={() => {
                void refreshPreflight();
              }}
            >
              <RefreshCw className={`h-3.5 w-3.5${preflightLoading ? " vendor-spin" : ""}`} />
              {t("common.refresh")}
            </Button>
          </div>
          <div className="vendor-gemini-check-list">
            {preflightChecks.map((check) => (
              <div key={check.id} className="vendor-gemini-check-row" title={check.message}>
                <div className="vendor-gemini-check-copy">
                  <span className="vendor-gemini-check-label">{check.label}</span>
                  <span className="vendor-gemini-check-message">{check.message}</span>
                </div>
                <span
                  className={`vendor-gemini-check-status ${
                    check.status === "pass" ? "is-pass" : "is-fail"
                  }`}
                >
                  {check.status.toUpperCase()}
                </span>
              </div>
            ))}
            {preflightChecks.length === 0 && (
              <div className="vendor-gemini-empty-checks">
                {preflightLoading
                  ? t("settings.vendor.gemini.preflightLoading")
                  : t("settings.vendor.gemini.preflightEmpty")}
              </div>
            )}
          </div>
        </section>

        <section className="vendor-gemini-card vendor-gemini-card-env">
          <label className="vendor-gemini-section-title">{t("settings.vendor.gemini.envVars")}</label>
          <textarea
            className="vendor-code-editor vendor-gemini-env-editor"
            value={draft.envText}
            onChange={(event) => {
              handleDraftEnvTextChange(event.target.value);
            }}
            placeholder={"GEMINI_API_KEY=...\nGEMINI_MODEL=gemini-3-pro-preview"}
          />
          <div className="vendor-gemini-actions-row">
            <Button
              size="sm"
              onClick={() => {
                void handleSaveEnv();
              }}
              disabled={savingEnv}
            >
              <Save className="h-3.5 w-3.5" />
              {savingEnv
                ? t("settings.vendor.gemini.saving")
                : t("settings.vendor.gemini.saveEnv")}
            </Button>
          </div>
        </section>
      </div>

      <section className="vendor-gemini-card vendor-gemini-card-auth">
        <div className="vendor-gemini-auth-header">
          <div>
            <label className="vendor-gemini-section-title">
              {t("settings.vendor.gemini.authConfig")}
            </label>
            <p className="vendor-gemini-help">
              {t("settings.vendor.gemini.authConfigDescription")}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              openUrl("https://geminicli.com/docs/get-started/authentication/").catch(
                () => {},
              );
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("settings.vendor.gemini.viewAuthDoc")}
          </Button>
        </div>

        <div className="vendor-form-group">
          <label htmlFor="gemini-auth-mode">{t("settings.vendor.gemini.authMode")}</label>
          <select
            id="gemini-auth-mode"
            className="vendor-input"
            value={draft.authMode}
            onChange={(event) => {
              const nextMode = event.target.value as GeminiAuthMode;
              if (GEMINI_AUTH_MODES.includes(nextMode)) {
                handleGeminiAuthModeChange(nextMode);
              }
            }}
          >
            {GEMINI_AUTH_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {modeLabel(t, mode)}
              </option>
            ))}
          </select>
          <div className="vendor-hint">{modeHint(t, draft.authMode)}</div>
        </div>

        <div className="vendor-form-group">
          <label htmlFor="gemini-model">Model</label>
          <input
            id="gemini-model"
            className="vendor-input"
            value={draft.model}
            placeholder="gemini-3-pro-preview"
            onChange={(event) => {
              handleGeminiFieldChange("model", event.target.value);
            }}
          />
          <div className="vendor-hint">{t("settings.vendor.gemini.modelHintDefault")}</div>
        </div>

        {shouldShowApiBaseUrl && (
          <div className="vendor-form-group">
            <label htmlFor="gemini-api-base-url">GOOGLE_GEMINI_BASE_URL</label>
            <input
              id="gemini-api-base-url"
              className="vendor-input"
              value={draft.apiBaseUrl}
              placeholder="https://your-gemini-endpoint.example.com"
              onChange={(event) => {
                handleGeminiFieldChange("apiBaseUrl", event.target.value);
              }}
            />
          </div>
        )}

        {shouldShowApiKey && (
          <div className="vendor-form-group">
            <label htmlFor="gemini-api-key">{keyLabel}</label>
            <div className="vendor-input-row">
              <input
                id="gemini-api-key"
                className="vendor-input"
                type={showKey ? "text" : "password"}
                value={keyValue}
                placeholder="AIza..."
                onChange={(event) => {
                  if (draft.authMode === "vertex_api_key") {
                    handleGeminiFieldChange("googleApiKey", event.target.value);
                  } else {
                    handleGeminiFieldChange("geminiApiKey", event.target.value);
                  }
                }}
              />
              <button
                type="button"
                className="vendor-btn-icon"
                onClick={() => setShowKey((current) => !current)}
                title={
                  showKey
                    ? t("settings.vendor.gemini.hideKey")
                    : t("settings.vendor.gemini.showKey")
                }
              >
                {showKey ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </div>
        )}

        {isVertexMode && (
          <div className="vendor-model-grid">
            <div>
              <label htmlFor="gemini-cloud-project">GOOGLE_CLOUD_PROJECT</label>
              <input
                id="gemini-cloud-project"
                className="vendor-input"
                value={draft.googleCloudProject}
                placeholder="my-gcp-project-id"
                onChange={(event) => {
                  handleGeminiFieldChange("googleCloudProject", event.target.value);
                }}
              />
            </div>
            <div>
              <label htmlFor="gemini-cloud-location">GOOGLE_CLOUD_LOCATION</label>
              <input
                id="gemini-cloud-location"
                className="vendor-input"
                value={draft.googleCloudLocation}
                placeholder="global / us-central1"
                onChange={(event) => {
                  handleGeminiFieldChange("googleCloudLocation", event.target.value);
                }}
              />
            </div>
          </div>
        )}

        {draft.authMode === "vertex_service_account" && (
          <div className="vendor-form-group">
            <label htmlFor="gemini-google-application-credentials">
              GOOGLE_APPLICATION_CREDENTIALS
            </label>
            <input
              id="gemini-google-application-credentials"
              className="vendor-input"
              value={draft.googleApplicationCredentials}
              placeholder="<service-account-json-path>"
              onChange={(event) => {
                handleGeminiFieldChange(
                  "googleApplicationCredentials",
                  event.target.value,
                );
              }}
            />
          </div>
        )}

        <div className="vendor-gemini-actions-row">
          <Button
            size="sm"
            onClick={() => {
              void handleSaveConfig();
            }}
            disabled={savingConfig}
          >
            <Save className="h-3.5 w-3.5" />
            {savingConfig
              ? t("settings.vendor.gemini.saving")
              : t("settings.vendor.gemini.saveConfig")}
          </Button>
        </div>
      </section>

      {error && <div className="vendor-json-error">{error}</div>}
      {savedAt && (
        <div className="vendor-gemini-saved-hint">
          {t("settings.vendor.gemini.savedAt", {
            time: new Date(savedAt).toLocaleTimeString(),
          })}
        </div>
      )}
    </div>
  );
}
