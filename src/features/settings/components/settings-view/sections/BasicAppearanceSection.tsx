import type React from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Monitor, Moon, Palette, RotateCcw, Sun, Type, MessageCircle, Info, PanelsLeftRight } from "lucide-react";
import type { AppSettings } from "../../../../../types";
import { clampUiScale } from "../../../../../utils/uiScale";
import {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "../../../../../utils/fonts";
import { LanguageSelector } from "../../LanguageSelector";

type BasicAppearanceSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  uiScaleDraft: number;
  clampedUiScale: number;
  uiScaleDraftPercentLabel: string;
  setUiScaleDraft: (next: number) => void;
  handleResetUiScaleDraft: () => void;
  handleSaveUiScale: () => void;
  scaleShortcutTitle: string;
  scaleShortcutText: string;
  userMsgPresets: ReadonlyArray<{ color: string; label: string }>;
  isUserMsgPresetActive: (presetColor: string) => boolean;
  handleUserMsgPresetClick: (presetColor: string) => void;
  normalizedUserMsgColor: string | null;
  defaultUserMsgColor: string;
  handleUserMsgColorPickerChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  userMsgHexDraft: string;
  handleUserMsgHexInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleResetUserMsgColor: () => void;
  uiFontDraft: string;
  handleUiFontSelectChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  uiFontSelectOptions: string[];
  defaultUiPrimaryFont: string;
  setUiFontDraft: (next: string) => void;
  codeFontDraft: string;
  codeFontSelectOptions: string[];
  handleCodeFontSelectChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  defaultCodePrimaryFont: string;
  setCodeFontDraft: (next: string) => void;
  codeFontSizeDraft: number;
  setCodeFontSizeDraft: (next: number) => void;
  handleCommitCodeFontSize: (nextSize: number) => Promise<void>;
};

export function BasicAppearanceSection({
  appSettings,
  onUpdateAppSettings,
  uiScaleDraft,
  clampedUiScale,
  uiScaleDraftPercentLabel,
  setUiScaleDraft,
  handleResetUiScaleDraft,
  handleSaveUiScale,
  scaleShortcutTitle,
  scaleShortcutText,
  userMsgPresets,
  isUserMsgPresetActive,
  handleUserMsgPresetClick,
  normalizedUserMsgColor,
  defaultUserMsgColor,
  handleUserMsgColorPickerChange,
  userMsgHexDraft,
  handleUserMsgHexInputChange,
  handleResetUserMsgColor,
  uiFontDraft,
  handleUiFontSelectChange,
  uiFontSelectOptions,
  defaultUiPrimaryFont,
  setUiFontDraft,
  codeFontDraft,
  codeFontSelectOptions,
  handleCodeFontSelectChange,
  defaultCodePrimaryFont,
  setCodeFontDraft,
  codeFontSizeDraft,
  setCodeFontSizeDraft,
  handleCommitCodeFontSize,
}: BasicAppearanceSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="settings-basic-appearance settings-basic-surface">
      <div className="settings-basic-group-card settings-basic-group-card--list">
        <div className="settings-subsection-title">{t("settings.displaySubtitle")}</div>
        <div className="settings-subsection-subtitle">
          {t("settings.displaySubDescription")}
        </div>
        <div className="settings-field settings-basic-theme-field settings-basic-item">
          <div className="settings-basic-field-header">
            <Palette className="settings-basic-field-icon" aria-hidden />
            <span className="settings-basic-field-label">{t("settings.theme")}</span>
          </div>
          <div className="settings-basic-theme-selector" role="radiogroup" aria-label={t("settings.theme")}>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "system"}
              className={`settings-basic-theme-option ${
                appSettings.theme === "system" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "system",
                })
              }
            >
              <span className="settings-basic-theme-icon settings-basic-theme-icon-system">
                <Monitor size={14} />
              </span>
              <span>{t("settings.themeSystem")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "light"}
              className={`settings-basic-theme-option ${
                appSettings.theme === "light" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "light",
                })
              }
            >
              <span className="settings-basic-theme-icon settings-basic-theme-icon-light">
                <Sun size={14} />
              </span>
              <span>{t("settings.themeLight")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "dark"}
              className={`settings-basic-theme-option ${
                appSettings.theme === "dark" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "dark",
                })
              }
            >
              <span className="settings-basic-theme-icon settings-basic-theme-icon-dark">
                <Moon size={14} />
              </span>
              <span>{t("settings.themeDark")}</span>
            </button>
          </div>
        </div>
        <LanguageSelector rowClassName="settings-basic-item" />
        <div className="settings-field settings-basic-item">
          <div className="settings-basic-field-header">
            <ArrowLeftRight className="settings-basic-field-icon" aria-hidden />
            <span className="settings-basic-field-label">{t("settings.canvasWidth")}</span>
          </div>
          <div className="settings-basic-theme-selector" role="radiogroup" aria-label={t("settings.canvasWidth")}>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.canvasWidthMode !== "wide"}
              className={`settings-basic-theme-option ${
                appSettings.canvasWidthMode !== "wide" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  canvasWidthMode: "narrow",
                })
              }
            >
              <span>{t("settings.canvasWidthNarrow")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.canvasWidthMode === "wide"}
              className={`settings-basic-theme-option ${
                appSettings.canvasWidthMode === "wide" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  canvasWidthMode: "wide",
                })
              }
            >
              <span>{t("settings.canvasWidthWide")}</span>
            </button>
          </div>
          <div className="settings-help">{t("settings.canvasWidthDesc")}</div>
        </div>
        <div className="settings-field settings-basic-item">
          <div className="settings-basic-field-header">
            <PanelsLeftRight className="settings-basic-field-icon" aria-hidden />
            <span className="settings-basic-field-label">{t("settings.layoutMode")}</span>
          </div>
          <div className="settings-basic-theme-selector" role="radiogroup" aria-label={t("settings.layoutMode")}>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.layoutMode !== "swapped"}
              className={`settings-basic-theme-option ${
                appSettings.layoutMode !== "swapped" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  layoutMode: "default",
                })
              }
            >
              <span>{t("settings.layoutModeDefault")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.layoutMode === "swapped"}
              className={`settings-basic-theme-option ${
                appSettings.layoutMode === "swapped" ? "active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  layoutMode: "swapped",
                })
              }
            >
              <span>{t("settings.layoutModeSwapped")}</span>
            </button>
          </div>
          <div className="settings-help">{t("settings.layoutModeDesc")}</div>
        </div>
        <div className="settings-field settings-basic-item settings-scale-item">
          <div className="settings-basic-field-header">
            <Type className="settings-basic-field-icon" aria-hidden />
            <span className="settings-basic-field-label">{t("settings.interfaceScale")}</span>
          </div>
          <div className="settings-control settings-scale-control">
            <input
              type="range"
              min={0.8}
              max={2.6}
              step={0.01}
              className="settings-input settings-input--range"
              aria-label={t("settings.interfaceScaleAriaLabel")}
              value={uiScaleDraft}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (!Number.isFinite(parsed)) {
                  return;
                }
                setUiScaleDraft(clampUiScale(parsed));
              }}
            />
            <span className="settings-scale-value">{uiScaleDraftPercentLabel}</span>
            <button
              type="button"
              className="primary settings-button-compact settings-scale-save"
              onClick={handleSaveUiScale}
              disabled={uiScaleDraft === clampedUiScale}
              data-testid="settings-ui-scale-save"
            >
              {t("common.save")}
            </button>
            <button
              type="button"
              className="ghost settings-button-compact settings-scale-reset"
              onClick={handleResetUiScaleDraft}
              data-testid="settings-ui-scale-reset"
            >
              {t("settings.uiScaleReset")}
            </button>
          </div>
          <div className="settings-help" title={scaleShortcutTitle}>
            {scaleShortcutText}
          </div>
        </div>
      </div>
      <div className="settings-color-config-card settings-basic-group-card">
        <div className="settings-color-config-head">
          <MessageCircle className="settings-color-config-icon" aria-hidden />
          <span className="settings-color-config-title">
            {t("settings.userMsgColorLabel")}
          </span>
        </div>
        <div className="settings-color-preset-grid" role="list">
          {userMsgPresets.map((preset) => (
            <button
              key={preset.color}
              type="button"
              role="listitem"
              className={`settings-color-swatch${isUserMsgPresetActive(preset.color) ? " is-active" : ""}`}
              onClick={() => handleUserMsgPresetClick(preset.color)}
              title={preset.label}
              aria-label={`${t("settings.userMsgColorLabel")} ${preset.color}`}
              data-testid={`settings-user-msg-color-preset-${preset.color.slice(1)}`}
            >
              <span
                className="settings-color-swatch-inner"
                style={{ backgroundColor: preset.color }}
              />
            </button>
          ))}
        </div>
        <div className="settings-color-custom-row">
          <span className="settings-color-custom-label">
            {t("settings.userMsgColorCustom")}
          </span>
          <label className="settings-color-picker" aria-label={t("settings.userMsgColorLabel")}>
            <span
              className="settings-color-picker-preview"
              style={{
                backgroundColor: normalizedUserMsgColor || defaultUserMsgColor,
              }}
            />
            <input
              type="color"
              className="settings-color-picker-input"
              value={normalizedUserMsgColor || defaultUserMsgColor}
              onChange={handleUserMsgColorPickerChange}
              aria-label={t("settings.userMsgColorLabel")}
            />
          </label>
          <input
            type="text"
            className="settings-input settings-color-hex-input"
            value={userMsgHexDraft}
            onChange={handleUserMsgHexInputChange}
            placeholder="#6e40c9"
            maxLength={7}
            spellCheck={false}
            aria-label={t("settings.userMsgColorLabel")}
            data-testid="settings-user-msg-color-hex-input"
          />
          {normalizedUserMsgColor ? (
            <button
              type="button"
              className="ghost settings-color-reset"
              onClick={handleResetUserMsgColor}
              data-testid="settings-user-msg-color-reset"
            >
              <RotateCcw size={14} aria-hidden />
              {t("settings.userMsgColorReset")}
            </button>
          ) : null}
        </div>
        <div className="settings-help settings-color-hint">
          <Info size={14} aria-hidden />
          <span>{t("settings.userMsgColorHint")}</span>
        </div>
      </div>
      <div className="settings-basic-group-card settings-basic-group-card--list">
        <div className="settings-field settings-basic-item settings-basic-font-field">
          <label className="settings-field-label" htmlFor="ui-font-family">
            {t("settings.uiFontFamily")}
          </label>
          <div className="settings-field-row settings-field-row--font">
            <div className="settings-select-wrap settings-select-wrap--font">
              <select
                id="ui-font-family"
                className="settings-select"
                value={uiFontDraft}
                onChange={handleUiFontSelectChange}
                data-testid="settings-ui-font-select"
              >
                {uiFontSelectOptions.map((fontName) => (
                  <option key={fontName} value={fontName}>
                    {fontName}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="ghost settings-button-compact settings-ui-font-reset settings-font-reset"
              onClick={() => {
                setUiFontDraft(defaultUiPrimaryFont);
                void onUpdateAppSettings({
                  ...appSettings,
                  uiFontFamily: DEFAULT_UI_FONT_FAMILY,
                });
              }}
            >
              {t("settings.reset")}
            </button>
          </div>
          <div className="settings-help">
            {t("settings.uiFontFamilyDesc")}
          </div>
        </div>
        <div className="settings-field settings-basic-item settings-basic-font-field">
          <label className="settings-field-label" htmlFor="code-font-family">
            {t("settings.codeFontFamily")}
          </label>
          <div className="settings-field-row settings-field-row--font">
            <div className="settings-select-wrap settings-select-wrap--font">
              <select
                id="code-font-family"
                className="settings-select"
                value={codeFontDraft}
                onChange={handleCodeFontSelectChange}
                data-testid="settings-code-font-select"
              >
                {codeFontSelectOptions.map((fontName) => (
                  <option key={fontName} value={fontName}>
                    {fontName}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="ghost settings-button-compact settings-font-reset"
              onClick={() => {
                setCodeFontDraft(defaultCodePrimaryFont);
                void onUpdateAppSettings({
                  ...appSettings,
                  codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
                });
              }}
            >
              {t("settings.reset")}
            </button>
          </div>
          <div className="settings-help">
            {t("settings.codeFontFamilyDesc")}
          </div>
        </div>
        <div className="settings-field settings-basic-item">
          <label className="settings-field-label" htmlFor="code-font-size">
            {t("settings.codeFontSize")}
          </label>
          <div className="settings-field-row">
            <input
              id="code-font-size"
              type="range"
              min={CODE_FONT_SIZE_MIN}
              max={CODE_FONT_SIZE_MAX}
              step={1}
              className="settings-input settings-input--range"
              value={codeFontSizeDraft}
              onChange={(event) => {
                const nextValue = Number(event.target.value);
                setCodeFontSizeDraft(nextValue);
                void handleCommitCodeFontSize(nextValue);
              }}
            />
            <div className="settings-scale-value">{codeFontSizeDraft}px</div>
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={() => {
                setCodeFontSizeDraft(CODE_FONT_SIZE_DEFAULT);
                void handleCommitCodeFontSize(CODE_FONT_SIZE_DEFAULT);
              }}
            >
              {t("settings.reset")}
            </button>
          </div>
          <div className="settings-help">
            {t("settings.codeFontSizeDesc")}
          </div>
        </div>
      </div>
    </div>
  );
}
