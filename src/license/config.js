function envString(value) {
	return String(value || "").trim();
}

function envPem(value) {
	return envString(value).replace(/\\n/g, "\n");
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

const VALID_LICENSING_MODES = ["legacy", "dual", "keygen_only"];
const VALID_LICENSING_ENVS = ["staging", "production"];

function normalizeLicensingMode(value) {
	const mode = clean(value || "dual").toLowerCase();
	return VALID_LICENSING_MODES.includes(mode) ? mode : "dual";
}

function normalizeLicensingEnv(value) {
	const env = clean(value || "production").toLowerCase();
	return VALID_LICENSING_ENVS.includes(env) ? env : "production";
}

export function normalizeItemId(value) {
	return envString(value);
}

function parseItemIds(value) {
	const raw = envString(value);
	if (!raw) return [];

	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.map((item) => normalizeItemId(item)).filter(Boolean);
		}
	} catch {
		// Comma-separated env value.
	}

	return raw
		.split(",")
		.map((item) => normalizeItemId(item))
		.filter(Boolean);
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

const allowedItemIds = parseItemIds(process.env.DOR_LICENSE_V2_ALLOWED_ITEM_IDS);
const pluginVersion = envString(process.env.PLUGIN_VERSION || "2.0") || "2.0";
const updateChannel =
	envString(process.env.DOR_LICENSE_V2_UPDATE_CHANNEL) || envString(process.env.DOR_UPDATE_CHANNEL) || "production";
const allowedUpdateChannels = parseStringList(process.env.DOR_LICENSE_V2_ALLOWED_UPDATE_CHANNELS);

const licenseV2Config = Object.freeze({
	enabled: envFlag(process.env.DOR_LICENSE_ENABLED, true),
	plugin_id: envString(process.env.DOR_LICENSE_V2_PLUGIN_ID) || "uxp-vanilla-keygen",
	plugin_name: envString(process.env.DOR_UXP_PLUGIN_NAME),
	plugin_version: pluginVersion,
	allowed_item_ids: allowedItemIds,
	license_verify_url: envString(process.env.DOR_LICENSE_V2_VERIFY_URL),
	event_url: envString(process.env.DOR_LICENSE_EVENT_URL || process.env.DOR_LICENSE_V2_EVENT_URL),
	update_status_url:
		envString(process.env.DOR_LICENSE_V2_UPDATE_STATUS_URL) || envString(process.env.DOR_UPDATE_STATUS_URL),
	update_channel: updateChannel,
	allowed_update_channels: allowedUpdateChannels,
	token_issuer: envString(process.env.DOR_LICENSE_V2_TOKEN_ISSUER) || "DoronSupply",
	token_audience: envString(process.env.DOR_LICENSE_V2_TOKEN_AUDIENCE) || "uxp-plugin",
	public_verification_key: envPem(process.env.DOR_LICENSE_V2_PUBLIC_VERIFICATION_KEY),
	obfuscation_key: envString(process.env.DOR_LICENSE_V2_OBFUSCATION_KEY) || undefined
});

const licensingEnvironment = normalizeLicensingEnv(process.env.DOR_LICENSING_ENV || licenseV2Config.update_channel);
const defaultKeygenBaseUrl = "https://api.keygen.sh";

export const licensingConfig = Object.freeze({
	mode: normalizeLicensingMode(process.env.DOR_LICENSING_MODE),
	environment: licensingEnvironment,
	portal: {
		pluginId: licenseV2Config.plugin_id,
		verifyUrl: licenseV2Config.license_verify_url
	},
	keygen: {
		baseUrl: trimTrailingSlash(process.env.DOR_KEYGEN_BASE_URL || defaultKeygenBaseUrl),
		accountId: clean(process.env.DOR_KEYGEN_ACCOUNT_ID || "<KEYGEN_ACCOUNT_ID>"),
		productId: clean(process.env.DOR_KEYGEN_PRODUCT_ID || "")
	}
});

export function getAssignedItemId() {
	return licenseV2Config.allowed_item_ids[0] || "";
}

export function isUpdateChannelAllowed(channel = licenseV2Config.update_channel) {
	return (
		!licenseV2Config.allowed_update_channels.length ||
		licenseV2Config.allowed_update_channels.includes(envString(channel))
	);
}

export function allowsPortal() {
	return licensingConfig.mode === "legacy" || licensingConfig.mode === "dual";
}

export function allowsKeygen() {
	return licensingConfig.mode === "dual" || licensingConfig.mode === "keygen_only";
}

export function isKeygenConfigured() {
	const accountId = licensingConfig.keygen.accountId;
	return !!accountId && !accountId.includes("<") && !accountId.includes(">");
}

export default licenseV2Config;
