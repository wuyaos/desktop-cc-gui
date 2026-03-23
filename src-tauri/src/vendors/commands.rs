use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::process::Command;
use tokio::time::timeout;

use crate::backend::app_server::build_codex_path_env;
use crate::types::{CodexProviderConfig, ProviderConfig};
use crate::utils::async_command;
#[cfg(windows)]
use crate::utils::async_command_with_console_visibility;

// ==================== Claude Settings Sync ====================

/// Fields in ~/.claude/settings.json that are managed by the system and should NOT be overwritten
const PROTECTED_SYSTEM_FIELDS: &[&str] = &[
    "mcpServers",
    "disabledMcpServers",
    "plugins",
    "trustedDirectories",
    "trustedFiles",
];

/// Fields that a provider's settingsConfig can manage (overwrite) in ~/.claude/settings.json
const PROVIDER_MANAGED_FIELDS: &[&str] = &[
    "env",
    "model",
    "alwaysThinkingEnabled",
    "codemossProviderId",
    "ccSwitchProviderId",
    "maxContextLengthTokens",
    "temperature",
    "topP",
    "topK",
];

const LOCAL_SETTINGS_PROVIDER_ID: &str = "__local_settings_json__";
const LOCAL_SETTINGS_PROVIDER_NAME: &str = "Local settings.json";
const LOCAL_SETTINGS_PROVIDER_REMARK: &str =
    "Use configuration directly from ~/.claude/settings.json";
const LOCAL_PROVIDER_MODEL_MAPPING_KEYS: &[&str] = &[
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
];
const GEMINI_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(8);
const GEMINI_DEFAULT_AUTH_MODE: &str = "login_google";

fn default_enabled_true() -> bool {
    true
}

fn default_gemini_auth_mode() -> String {
    GEMINI_DEFAULT_AUTH_MODE.to_string()
}

fn claude_settings_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    Ok(home.join(".claude").join("settings.json"))
}

fn read_claude_settings() -> Result<serde_json::Map<String, Value>, String> {
    let path = claude_settings_path()?;
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read claude settings: {}", e))?;
    if content.trim().is_empty() {
        return Ok(serde_json::Map::new());
    }
    let val: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse claude settings: {}", e))?;
    match val {
        Value::Object(map) => Ok(map),
        _ => Ok(serde_json::Map::new()),
    }
}

fn write_claude_settings(settings: &serde_json::Map<String, Value>) -> Result<(), String> {
    let path = claude_settings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create claude settings dir: {}", e))?;
    }

    // Ensure env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"
    let mut settings = settings.clone();
    let env = settings
        .entry("env")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    if let Value::Object(ref mut env_map) = env {
        env_map.insert(
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".into(),
            Value::String("1".into()),
        );
    }

    let content = serde_json::to_string_pretty(&Value::Object(settings))
        .map_err(|e| format!("Failed to serialize claude settings: {}", e))?;

    // Atomic write: write to temp file first, then rename
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &content)
        .map_err(|e| format!("Failed to write claude settings temp file: {}", e))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to rename claude settings temp file: {}", e))
}

fn ensure_local_claude_settings_ready() -> Result<(), String> {
    let path = claude_settings_path()?;
    if !path.exists() {
        return Err("~/.claude/settings.json does not exist. Please create it first.".to_string());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read ~/.claude/settings.json: {}", e))?;
    if content.trim().is_empty() {
        return Err("~/.claude/settings.json is empty. Please provide valid JSON.".to_string());
    }
    let value: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON in ~/.claude/settings.json: {}", e))?;
    if !value.is_object() {
        return Err("~/.claude/settings.json must contain a JSON object.".to_string());
    }
    Ok(())
}

fn extract_local_model_mapping_settings() -> Option<Value> {
    let settings = read_claude_settings().ok()?;
    let env = settings.get("env")?.as_object()?;

    let mut filtered_env = serde_json::Map::new();
    for key in LOCAL_PROVIDER_MODEL_MAPPING_KEYS {
        if let Some(value) = env.get(*key) {
            filtered_env.insert((*key).to_string(), value.clone());
        }
    }

    if filtered_env.is_empty() {
        return None;
    }

    let mut settings_config = serde_json::Map::new();
    settings_config.insert("env".into(), Value::Object(filtered_env));
    Some(Value::Object(settings_config))
}

fn build_local_provider(is_active: bool) -> ProviderConfig {
    ProviderConfig {
        id: LOCAL_SETTINGS_PROVIDER_ID.to_string(),
        name: LOCAL_SETTINGS_PROVIDER_NAME.to_string(),
        remark: Some(LOCAL_SETTINGS_PROVIDER_REMARK.to_string()),
        website_url: None,
        category: None,
        created_at: Some(0),
        is_active,
        source: None,
        is_local_provider: Some(true),
        settings_config: extract_local_model_mapping_settings(),
    }
}

/// Apply the active provider's settingsConfig to ~/.claude/settings.json
/// Uses incremental merge: provider-managed fields are overwritten, system fields are preserved
fn apply_provider_to_claude_settings(
    provider_value: &Value,
    provider_id: &str,
) -> Result<(), String> {
    let settings_config = match provider_value.get("settingsConfig") {
        Some(sc) if sc.is_object() => sc,
        _ => return Ok(()), // No settingsConfig, nothing to sync
    };

    let mut claude_settings = read_claude_settings()?;

    if let Value::Object(config_map) = settings_config {
        for (key, value) in config_map {
            if value.is_null() {
                continue;
            }
            if PROTECTED_SYSTEM_FIELDS.contains(&key.as_str()) {
                continue;
            }
            if PROVIDER_MANAGED_FIELDS.contains(&key.as_str()) {
                claude_settings.insert(key.clone(), value.clone());
            }
        }
    }

    // Tag with the provider ID for traceability
    claude_settings.insert(
        "codemossProviderId".into(),
        Value::String(provider_id.to_string()),
    );

    write_claude_settings(&claude_settings)
}

// ==================== Config File Types ====================

/// Represents the ~/.codemoss/config.json file structure shared with idea-claude-code-gui
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct CodemossConfig {
    #[serde(default)]
    version: Option<Value>,
    #[serde(default)]
    claude: ClaudeSection,
    #[serde(default)]
    codex: CodexSection,
    #[serde(default)]
    gemini: GeminiSection,
    /// Preserve all other top-level fields (mcpServers, agents, ui, etc.)
    #[serde(flatten)]
    extra: HashMap<String, Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct ClaudeSection {
    #[serde(default)]
    providers: HashMap<String, Value>,
    #[serde(default)]
    current: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct CodexSection {
    #[serde(default)]
    providers: HashMap<String, Value>,
    #[serde(default)]
    current: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct GeminiSection {
    #[serde(default = "default_enabled_true")]
    enabled: bool,
    #[serde(default)]
    env: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auth_mode: Option<String>,
}

impl Default for GeminiSection {
    fn default() -> Self {
        Self {
            enabled: true,
            env: HashMap::new(),
            auth_mode: Some(default_gemini_auth_mode()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeCurrentConfig {
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    auth_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provider_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeminiVendorSettings {
    #[serde(default = "default_enabled_true")]
    pub(crate) enabled: bool,
    #[serde(default)]
    pub(crate) env: BTreeMap<String, String>,
    #[serde(default = "default_gemini_auth_mode")]
    pub(crate) auth_mode: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeminiVendorPreflightCheck {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) status: String,
    pub(crate) message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeminiVendorPreflightResult {
    pub(crate) checks: Vec<GeminiVendorPreflightCheck>,
}

// ==================== Helpers ====================

fn config_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".codemoss").join("config.json")
}

fn read_config() -> Result<CodemossConfig, String> {
    let path = config_path();
    if !path.exists() {
        return Ok(CodemossConfig::default());
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))?;
    if content.trim().is_empty() {
        return Ok(CodemossConfig::default());
    }
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))
}

fn write_config(config: &CodemossConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Failed to write config: {}", e))
}

fn resolve_provider_name(config: &CodemossConfig, provider_id: &str) -> Option<String> {
    if provider_id == LOCAL_SETTINGS_PROVIDER_ID {
        return Some(LOCAL_SETTINGS_PROVIDER_NAME.to_string());
    }
    config
        .claude
        .providers
        .get(provider_id)
        .and_then(|provider| provider.get("name"))
        .and_then(|name| name.as_str())
        .map(String::from)
}

/// Convert a raw JSON Value from config.json providers map into ProviderConfig for frontend
fn value_to_claude_provider(
    id: &str,
    value: &Value,
    is_active: bool,
) -> Result<ProviderConfig, String> {
    let name = value
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let remark = value
        .get("remark")
        .and_then(|v| v.as_str())
        .map(String::from);
    let website_url = value
        .get("websiteUrl")
        .and_then(|v| v.as_str())
        .map(String::from);
    let category = value
        .get("category")
        .and_then(|v| v.as_str())
        .map(String::from);
    let created_at = value.get("createdAt").and_then(|v| v.as_i64());
    let source = value
        .get("source")
        .and_then(|v| v.as_str())
        .map(String::from);
    let is_local_provider = value.get("isLocalProvider").and_then(|v| v.as_bool());
    let settings_config = value.get("settingsConfig").cloned();

    Ok(ProviderConfig {
        id: id.to_string(),
        name,
        remark,
        website_url: website_url,
        category,
        created_at,
        is_active,
        source,
        is_local_provider,
        settings_config,
    })
}

/// Convert a ProviderConfig back to JSON Value for storage in config.json
fn claude_provider_to_value(provider: &ProviderConfig) -> Value {
    let mut map = serde_json::Map::new();
    map.insert("id".into(), Value::String(provider.id.clone()));
    map.insert("name".into(), Value::String(provider.name.clone()));
    if let Some(ref remark) = provider.remark {
        map.insert("remark".into(), Value::String(remark.clone()));
    }
    if let Some(ref url) = provider.website_url {
        map.insert("websiteUrl".into(), Value::String(url.clone()));
    }
    if let Some(ref cat) = provider.category {
        map.insert("category".into(), Value::String(cat.clone()));
    }
    if let Some(ts) = provider.created_at {
        map.insert("createdAt".into(), Value::Number(ts.into()));
    }
    if let Some(ref src) = provider.source {
        map.insert("source".into(), Value::String(src.clone()));
    }
    if let Some(local) = provider.is_local_provider {
        map.insert("isLocalProvider".into(), Value::Bool(local));
    }
    if let Some(ref sc) = provider.settings_config {
        map.insert("settingsConfig".into(), sc.clone());
    }
    Value::Object(map)
}

fn value_to_codex_provider(
    id: &str,
    value: &Value,
    is_active: bool,
) -> Result<CodexProviderConfig, String> {
    let name = value
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let remark = value
        .get("remark")
        .and_then(|v| v.as_str())
        .map(String::from);
    let created_at = value.get("createdAt").and_then(|v| v.as_i64());
    let config_toml = value
        .get("configToml")
        .and_then(|v| v.as_str())
        .map(String::from);
    let auth_json = value
        .get("authJson")
        .and_then(|v| v.as_str())
        .map(String::from);
    let custom_models = value
        .get("customModels")
        .and_then(|v| serde_json::from_value(v.clone()).ok());

    Ok(CodexProviderConfig {
        id: id.to_string(),
        name,
        remark,
        created_at,
        is_active,
        config_toml,
        auth_json,
        custom_models,
    })
}

fn codex_provider_to_value(provider: &CodexProviderConfig) -> Value {
    let mut map = serde_json::Map::new();
    map.insert("id".into(), Value::String(provider.id.clone()));
    map.insert("name".into(), Value::String(provider.name.clone()));
    if let Some(ref remark) = provider.remark {
        map.insert("remark".into(), Value::String(remark.clone()));
    }
    if let Some(ts) = provider.created_at {
        map.insert("createdAt".into(), Value::Number(ts.into()));
    }
    if let Some(ref toml) = provider.config_toml {
        map.insert("configToml".into(), Value::String(toml.clone()));
    }
    if let Some(ref auth) = provider.auth_json {
        map.insert("authJson".into(), Value::String(auth.clone()));
    }
    if let Some(ref models) = provider.custom_models {
        if let Ok(v) = serde_json::to_value(models) {
            map.insert("customModels".into(), v);
        }
    }
    Value::Object(map)
}

fn normalize_gemini_auth_mode(mode: &str) -> String {
    let normalized = mode.trim().to_lowercase();
    match normalized.as_str() {
        "custom"
        | "login_google"
        | "gemini_api_key"
        | "vertex_adc"
        | "vertex_service_account"
        | "vertex_api_key" => normalized,
        _ => GEMINI_DEFAULT_AUTH_MODE.to_string(),
    }
}

fn sanitize_env_map(input: BTreeMap<String, String>) -> HashMap<String, String> {
    let mut output = HashMap::new();
    for (key, value) in input {
        let normalized_key = key.trim();
        if normalized_key.is_empty() {
            continue;
        }
        output.insert(normalized_key.to_string(), value.trim().to_string());
    }
    output
}

fn build_preflight_command(candidate: &str) -> Command {
    #[cfg(windows)]
    {
        // Some .cmd/.bat wrappers can fail with hidden console + piped stdio.
        let lower = candidate.to_ascii_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            return async_command_with_console_visibility(candidate, false);
        }
        return async_command(candidate);
    }
    #[cfg(not(windows))]
    {
        async_command(candidate)
    }
}

async fn run_preflight_probe(
    command_candidates: &[&str],
    args: &[&str],
) -> Result<String, String> {
    let path_env = build_codex_path_env(None);
    let mut last_error: Option<String> = None;

    for candidate in command_candidates {
        let mut cmd: Command = build_preflight_command(candidate);
        if let Some(path) = &path_env {
            cmd.env("PATH", path);
        }
        cmd.args(args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let output = match timeout(GEMINI_PREFLIGHT_TIMEOUT, cmd.output()).await {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => {
                last_error = Some(format!("{} execution failed: {}", candidate, error));
                continue;
            }
            Err(_) => {
                last_error = Some(format!("{} timed out", candidate));
                continue;
            }
        };

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !stdout.is_empty() {
                return Ok(stdout);
            }
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Ok(if stderr.is_empty() {
                "ok".to_string()
            } else {
                stderr
            });
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        last_error = Some(if !stderr.is_empty() {
            format!("{} failed: {}", candidate, stderr)
        } else if !stdout.is_empty() {
            format!("{} failed: {}", candidate, stdout)
        } else {
            format!("{} exited with status {}", candidate, output.status)
        });
    }

    Err(last_error.unwrap_or_else(|| "command probe failed".to_string()))
}

fn build_preflight_check(
    id: &str,
    label: &str,
    result: Result<String, String>,
) -> GeminiVendorPreflightCheck {
    match result {
        Ok(message) => GeminiVendorPreflightCheck {
            id: id.to_string(),
            label: label.to_string(),
            status: "pass".to_string(),
            message,
        },
        Err(message) => GeminiVendorPreflightCheck {
            id: id.to_string(),
            label: label.to_string(),
            status: "fail".to_string(),
            message,
        },
    }
}

// ==================== Claude Provider Commands ====================

#[tauri::command]
pub(crate) async fn vendor_get_claude_providers() -> Result<Vec<ProviderConfig>, String> {
    let config = read_config()?;
    let current = config.claude.current.as_deref();
    let mut regular_providers: Vec<ProviderConfig> = config
        .claude
        .providers
        .iter()
        .filter_map(|(id, value)| {
            if id == LOCAL_SETTINGS_PROVIDER_ID {
                return None;
            }
            let is_active = current == Some(id.as_str());
            value_to_claude_provider(id, value, is_active).ok()
        })
        .collect();
    regular_providers.sort_by(|a, b| {
        let ta = a.created_at.unwrap_or(0);
        let tb = b.created_at.unwrap_or(0);
        ta.cmp(&tb)
    });

    let mut providers = Vec::with_capacity(regular_providers.len() + 1);
    providers.push(build_local_provider(
        current == Some(LOCAL_SETTINGS_PROVIDER_ID),
    ));
    providers.extend(regular_providers);

    Ok(providers)
}

#[tauri::command]
pub(crate) async fn vendor_get_current_claude_config() -> Result<ClaudeCurrentConfig, String> {
    let settings = read_claude_settings()?;

    let mut api_key = String::new();
    let mut auth_type = "none".to_string();
    let mut base_url = String::new();

    if let Some(env) = settings.get("env").and_then(|v| v.as_object()) {
        if let Some(token) = env.get("ANTHROPIC_AUTH_TOKEN").and_then(|v| v.as_str()) {
            if !token.is_empty() {
                api_key = token.to_string();
                auth_type = "auth_token".to_string();
            }
        }
        if api_key.is_empty() {
            if let Some(key) = env.get("ANTHROPIC_API_KEY").and_then(|v| v.as_str()) {
                if !key.is_empty() {
                    api_key = key.to_string();
                    auth_type = "api_key".to_string();
                }
            }
        }
        if let Some(url) = env.get("ANTHROPIC_BASE_URL").and_then(|v| v.as_str()) {
            base_url = url.to_string();
        }
    }

    let provider_id = settings
        .get("codemossProviderId")
        .and_then(|v| v.as_str())
        .map(String::from);
    let provider_name = provider_id.as_ref().and_then(|id| {
        read_config()
            .ok()
            .and_then(|config| resolve_provider_name(&config, id))
    });

    Ok(ClaudeCurrentConfig {
        api_key,
        base_url,
        auth_type,
        provider_id,
        provider_name,
    })
}

#[tauri::command]
pub(crate) async fn vendor_add_claude_provider(provider: ProviderConfig) -> Result<(), String> {
    if provider.id == LOCAL_SETTINGS_PROVIDER_ID {
        return Err("Reserved provider id".to_string());
    }
    let mut config = read_config()?;
    if config.claude.providers.contains_key(&provider.id) {
        return Err(format!("Provider with id {} already exists", provider.id));
    }
    config
        .claude
        .providers
        .insert(provider.id.clone(), claude_provider_to_value(&provider));
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_update_claude_provider(
    id: String,
    updates: ProviderConfig,
) -> Result<(), String> {
    if id == LOCAL_SETTINGS_PROVIDER_ID {
        return Err("Local settings provider cannot be updated".to_string());
    }
    let mut config = read_config()?;
    if !config.claude.providers.contains_key(&id) {
        return Err(format!("Provider {} not found", id));
    }
    config
        .claude
        .providers
        .insert(id, claude_provider_to_value(&updates));
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_delete_claude_provider(id: String) -> Result<(), String> {
    if id == LOCAL_SETTINGS_PROVIDER_ID {
        return Err("Local settings provider cannot be deleted".to_string());
    }
    let mut config = read_config()?;
    if config.claude.providers.remove(&id).is_none() {
        return Err(format!("Provider {} not found", id));
    }
    if config.claude.current.as_ref() == Some(&id) {
        config.claude.current = None;
    }
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_switch_claude_provider(id: String) -> Result<(), String> {
    let mut config = read_config()?;
    if id == LOCAL_SETTINGS_PROVIDER_ID {
        ensure_local_claude_settings_ready()?;
        config.claude.current = Some(id);
        write_config(&config)?;
        return Ok(());
    }
    let provider_value = config
        .claude
        .providers
        .get(&id)
        .ok_or_else(|| format!("Provider {} not found", id))?
        .clone();
    config.claude.current = Some(id.clone());
    write_config(&config)?;

    // Sync the provider's settingsConfig to ~/.claude/settings.json
    apply_provider_to_claude_settings(&provider_value, &id)?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn vendor_get_claude_always_thinking_enabled() -> Result<bool, String> {
    let settings = read_claude_settings()?;
    Ok(settings
        .get("alwaysThinkingEnabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

#[tauri::command]
pub(crate) async fn vendor_set_claude_always_thinking_enabled(enabled: bool) -> Result<(), String> {
    let mut settings = read_claude_settings()?;
    settings.insert("alwaysThinkingEnabled".into(), Value::Bool(enabled));
    write_claude_settings(&settings)
}

// ==================== Codex Provider Commands ====================

#[tauri::command]
pub(crate) async fn vendor_get_codex_providers() -> Result<Vec<CodexProviderConfig>, String> {
    let config = read_config()?;
    let current = config.codex.current.as_deref();
    let mut providers: Vec<CodexProviderConfig> = config
        .codex
        .providers
        .iter()
        .filter_map(|(id, value)| {
            let is_active = current == Some(id.as_str());
            value_to_codex_provider(id, value, is_active).ok()
        })
        .collect();
    providers.sort_by(|a, b| {
        let ta = a.created_at.unwrap_or(0);
        let tb = b.created_at.unwrap_or(0);
        ta.cmp(&tb)
    });
    Ok(providers)
}

#[tauri::command]
pub(crate) async fn vendor_add_codex_provider(provider: CodexProviderConfig) -> Result<(), String> {
    let mut config = read_config()?;
    if config.codex.providers.contains_key(&provider.id) {
        return Err(format!(
            "Codex provider with id {} already exists",
            provider.id
        ));
    }
    config
        .codex
        .providers
        .insert(provider.id.clone(), codex_provider_to_value(&provider));
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_update_codex_provider(
    id: String,
    updates: CodexProviderConfig,
) -> Result<(), String> {
    let mut config = read_config()?;
    if !config.codex.providers.contains_key(&id) {
        return Err(format!("Codex provider {} not found", id));
    }
    config
        .codex
        .providers
        .insert(id, codex_provider_to_value(&updates));
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_delete_codex_provider(id: String) -> Result<(), String> {
    let mut config = read_config()?;
    if config.codex.providers.remove(&id).is_none() {
        return Err(format!("Codex provider {} not found", id));
    }
    if config.codex.current.as_ref() == Some(&id) {
        config.codex.current = None;
    }
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_switch_codex_provider(id: String) -> Result<(), String> {
    let mut config = read_config()?;
    if !config.codex.providers.contains_key(&id) {
        return Err(format!("Codex provider {} not found", id));
    }
    config.codex.current = Some(id);
    write_config(&config)
}

// ==================== Gemini Vendor Commands ====================

#[tauri::command]
pub(crate) async fn vendor_get_gemini_settings() -> Result<GeminiVendorSettings, String> {
    let config = read_config()?;
    let mut env = BTreeMap::new();
    for (key, value) in config.gemini.env {
        let normalized_key = key.trim();
        if normalized_key.is_empty() {
            continue;
        }
        env.insert(normalized_key.to_string(), value);
    }
    Ok(GeminiVendorSettings {
        enabled: config.gemini.enabled,
        env,
        auth_mode: config
            .gemini
            .auth_mode
            .as_deref()
            .map(normalize_gemini_auth_mode)
            .unwrap_or_else(default_gemini_auth_mode),
    })
}

#[tauri::command]
pub(crate) async fn vendor_save_gemini_settings(
    settings: GeminiVendorSettings,
) -> Result<(), String> {
    let mut config = read_config()?;
    config.gemini = GeminiSection {
        enabled: settings.enabled,
        env: sanitize_env_map(settings.env),
        auth_mode: Some(normalize_gemini_auth_mode(&settings.auth_mode)),
    };
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_gemini_preflight() -> Result<GeminiVendorPreflightResult, String> {
    let gemini_result =
        run_preflight_probe(&["gemini", "gemini.cmd", "gemini.exe"], &["--version"]).await;
    let node_result = run_preflight_probe(&["node", "node.exe"], &["--version"]).await;
    let npm_result = run_preflight_probe(&["npm", "npm.cmd", "npm.exe"], &["--version"]).await;

    let checks = vec![
        build_preflight_check("gemini_version", "Gemini CLI", gemini_result),
        build_preflight_check("node", "Node.js", node_result),
        build_preflight_check("npm", "npm", npm_result),
    ];

    Ok(GeminiVendorPreflightResult { checks })
}
