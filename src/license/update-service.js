import ps from "photoshop";
import licenseV2Config, { licensingConfig, isUpdateChannelAllowed } from "./config";
import { getDeviceUniqueId } from "./utils";

const UPDATE_CACHE_KEY = "_uxp_keygen_starter_update_status_v1";
const UPDATE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_PLUGIN_NAME = String(process.env.DOR_UXP_PLUGIN_NAME || "UXP Vanilla Keygen Starter").trim();
const DEFAULT_UPDATE_URL = String(process.env.DOR_UPDATE_PORTAL_URL || "").trim();

function now() {
	return Date.now();
}

function readCachedUpdateStatus() {
	try {
		const raw = localStorage.getItem(UPDATE_CACHE_KEY);
		if (!raw) return null;
		const cached = JSON.parse(raw);
		if (!cached || typeof cached !== "object" || !cached.checked_at || !cached.result) return null;
		return cached;
	} catch {
		return null;
	}
}

function writeCachedUpdateStatus(result) {
	try {
		localStorage.setItem(
			UPDATE_CACHE_KEY,
			JSON.stringify({
				checked_at: now(),
				result
			})
		);
	} catch {
		// Local cache is only a throttle; failure should never affect plugin use.
	}
}

function cachedResultIfFresh() {
	const cached = readCachedUpdateStatus();
	if (!cached) return null;
	if (now() - Number(cached.checked_at) > UPDATE_CACHE_TTL_MS) return null;
	return { ...cached.result, from_cache: true };
}

function getPhotoshopVersion() {
	try {
		return String(ps.app?.version || ps.app?.hostVersion || "").trim();
	} catch {
		return "";
	}
}

function normalizeUpdateResponse(data) {
	const downloadUrl = data?.update_url || data?.download_url || data?.url || DEFAULT_UPDATE_URL;
	const message = data?.message || data?.notification_message || data?.update_message || "";

	return {
		update_available: data?.show_notification === true,
		required: data?.force_update === true,
		latest_version: String(data?.latest_version || ""),
		minimum_supported_version: String(data?.min_required_version || ""),
		download_url: String(downloadUrl || ""),
		message: String(message || ""),
		raw: data || {}
	};
}

async function readJsonResponse(resp) {
	const text = await resp.text();
	if (!text) return {};
	return JSON.parse(text);
}

export function clearUpdateCheckCache() {
	try {
		localStorage.removeItem(UPDATE_CACHE_KEY);
	} catch {
		// noop
	}
}

export async function checkForPluginUpdate({ bypassCache = false } = {}) {
	const endpoint = licenseV2Config.update_status_url;
	const channel = licenseV2Config.update_channel || licensingConfig.environment || "production";

	if (!endpoint) {
		console.debug("[Updates] Update status URL is not configured.");
		return { success: false, skipped: true, reason: "config" };
	}

	if (!isUpdateChannelAllowed(channel)) {
		console.warn("[Updates] Update channel is not allowed by plugin config.", {
			channel,
			allowed_update_channels: licenseV2Config.allowed_update_channels
		});
		return { success: false, skipped: true, reason: "channel_not_allowed" };
	}

	if (!bypassCache) {
		const cached = cachedResultIfFresh();
		if (cached) return { success: true, result: cached };
	}

	let clientId = "";
	try {
		clientId = await getDeviceUniqueId();
	} catch (err) {
		console.debug("[Updates] Could not resolve client id for update check.", err);
	}

	let resp;
	try {
		resp = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json"
			},
			body: JSON.stringify({
				plugin_id: licenseV2Config.plugin_id || "uxp-vanilla-keygen",
				plugin_name: DEFAULT_PLUGIN_NAME,
				plugin_version: licenseV2Config.plugin_version,
				manifest_version: licenseV2Config.plugin_version,
				host_app: "PS",
				host_version: getPhotoshopVersion(),
				channel,
				client_id: clientId
			})
		});
	} catch (err) {
		console.warn("[Updates] Update check failed.", err);
		return { success: false, reason: "network_error", error: err };
	}

	if (!resp.ok) {
		console.warn("[Updates] Update check returned an unsuccessful response.", {
			status: resp.status
		});
		return { success: false, reason: resp.status === 422 ? "invalid_request" : "server_error", status: resp.status };
	}

	try {
		const data = await readJsonResponse(resp);
		const result = normalizeUpdateResponse(data);
		writeCachedUpdateStatus(result);
		return { success: true, result };
	} catch (err) {
		console.warn("[Updates] Update check returned invalid JSON.", err);
		return { success: false, reason: "invalid_json_response", error: err };
	}
}
