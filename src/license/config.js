function envString(value) {
	return String(value || "").trim();
}

function envFlag(value, defaultValue) {
	const raw = envString(value);
	if (!raw) return defaultValue;
	return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function clean(value) {
	return envString(value).replace(/^["']|["']$/g, "");
}

function trimTrailingSlash(value) {
	return clean(value).replace(/\/+$/, "");
}

const VALID_LICENSING_ENVS = ["staging", "production"];

function normalizeLicensingEnv(value) {
	const env = clean(value || "production").toLowerCase();
	return VALID_LICENSING_ENVS.includes(env) ? env : "production";
}

function parseStringList(value) {
	const raw = envString(value);
	if (!raw) return [];

	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.map((item) => envString(item)).filter(Boolean);
		}
	} catch {
		// Comma-separated env value.
	}

	return raw
		.split(",")
		.map((item) => envString(item))
		.filter(Boolean);
}

// Version is injected by webpack (single-sourced from package.json). "0.0.0" is
// deliberately below normal releases if injection ever fails.
const pluginVersion = envString(process.env.PLUGIN_VERSION) || "0.0.0";
const updateChannel =
	envString(process.env.DOR_LICENSE_V2_UPDATE_CHANNEL) || envString(process.env.DOR_UPDATE_CHANNEL) || "production";
const allowedUpdateChannels = parseStringList(process.env.DOR_LICENSE_V2_ALLOWED_UPDATE_CHANNELS);

const licenseV2Config = Object.freeze({
	enabled: envFlag(process.env.DOR_LICENSE_ENABLED, true),
	plugin_id: envString(process.env.DOR_LICENSE_V2_PLUGIN_ID) || "uxp-vanilla-keygen",
	plugin_name: envString(process.env.DOR_UXP_PLUGIN_NAME),
	plugin_version: pluginVersion,
	event_url: envString(process.env.DOR_LICENSE_EVENT_URL || process.env.DOR_LICENSE_V2_EVENT_URL),
	update_status_url:
		envString(process.env.DOR_LICENSE_V2_UPDATE_STATUS_URL) || envString(process.env.DOR_UPDATE_STATUS_URL),
	update_channel: updateChannel,
	allowed_update_channels: allowedUpdateChannels,
	obfuscation_key: envString(process.env.DOR_LICENSE_V2_OBFUSCATION_KEY) || undefined
});

const licensingEnvironment = normalizeLicensingEnv(process.env.DOR_LICENSING_ENV || licenseV2Config.update_channel);
const defaultKeygenBaseUrl = "https://api.keygen.sh";

export const licensingConfig = Object.freeze({
	mode: "keygen",
	environment: licensingEnvironment,
	keygen: {
		baseUrl: trimTrailingSlash(process.env.DOR_KEYGEN_BASE_URL || defaultKeygenBaseUrl),
		accountId: clean(process.env.DOR_KEYGEN_ACCOUNT_ID || "<KEYGEN_ACCOUNT_ID>"),
		productId: clean(process.env.DOR_KEYGEN_PRODUCT_ID || "")
	}
});

export function getAssignedItemId() {
	return licensingConfig.keygen.productId || "";
}

export function isUpdateChannelAllowed(channel = licenseV2Config.update_channel) {
	return (
		!licenseV2Config.allowed_update_channels.length ||
		licenseV2Config.allowed_update_channels.includes(envString(channel))
	);
}

export function isKeygenConfigured() {
	const accountId = licensingConfig.keygen.accountId;
	return !!accountId && !accountId.includes("<") && !accountId.includes(">");
}

export default licenseV2Config;
