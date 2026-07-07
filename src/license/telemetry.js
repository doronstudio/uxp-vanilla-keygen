import licenseV2Config, { licensingConfig } from "./config";

const pluginVersion = String(process.env.PLUGIN_VERSION || "2.0").trim() || "2.0";
const localValidIntervalMs = Number(process.env.DOR_LICENSE_LOCAL_VALID_EVENT_INTERVAL_SECONDS || 86400) * 1000;
const telemetryTimeoutMs = Number(process.env.DOR_LICENSE_EVENT_TIMEOUT_SECONDS || 3) * 1000;
const lastEventAtByKey = new Map();
const TELEMETRY_QUEUE_KEY = "_uxp_keygen_starter_license_event_queue_v1";
const MAX_QUEUED_EVENTS = 20;
let isFlushingQueue = false;
const ALLOWED_EVENT_TYPES = new Set([
	"license.activation_attempt",
	"license.activation_success",
	"license.activation_failed",
	"license.local_valid",
	"license.cleared"
]);
const ALLOWED_PROVIDERS = new Set(["portal", "keygen", "local"]);
const ALLOWED_DETAIL_KEYS = new Set([
	"provider",
	"device_id",
	"device_fingerprint",
	"item_id",
	"reason",
	"status",
	"keygen_license_id",
	"keygen_machine_id",
	"keygen_product_id",
	"expires_at",
	"activation_expires_at",
	"offline"
]);

const REASON_ALIASES = {
	bad_device_id: "device_mismatch",
	config: "config_error",
	network_error: "network_unreachable",
	token_verification_failed: "unknown"
};

function normalizeValue(value) {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value === "number" || typeof value === "boolean") return value;
	return String(value).slice(0, 500);
}

function normalizeReason(value) {
	const normalized = String(value || "").trim();
	return REASON_ALIASES[normalized] || normalized || undefined;
}

function sanitizeDetails(value) {
	if (!value || typeof value !== "object") return value;

	const result = {};
	for (const [key, item] of Object.entries(value)) {
		if (!ALLOWED_DETAIL_KEYS.has(key)) {
			continue;
		}

		if (key === "provider" && !ALLOWED_PROVIDERS.has(item)) {
			continue;
		}

		const normalized = key === "reason" ? normalizeReason(item) : normalizeValue(item);
		if (normalized !== undefined) {
			result[key] = normalized;
		}
	}
	return result;
}

function readQueuedEvents() {
	try {
		const raw = localStorage.getItem(TELEMETRY_QUEUE_KEY);
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeQueuedEvents(events) {
	try {
		localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(events.slice(-MAX_QUEUED_EVENTS)));
	} catch {
		// Telemetry must never affect plugin behavior.
	}
}

function enqueueEvent(payload) {
	writeQueuedEvents([...readQueuedEvents(), payload]);
}

async function postTelemetryPayload(payload) {
	const controller = typeof AbortController === "function" ? new AbortController() : null;
	const timeoutId = controller ? setTimeout(() => controller.abort(), telemetryTimeoutMs) : null;

	try {
		const resp = await fetch(licenseV2Config.event_url, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify(payload),
			signal: controller?.signal
		});
		return resp.ok;
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
}

async function flushQueuedEvents() {
	if (isFlushingQueue) return;

	const queued = readQueuedEvents();
	if (!queued.length) return;

	isFlushingQueue = true;
	const remaining = [];
	try {
		for (const payload of queued) {
			try {
				const sent = await postTelemetryPayload(payload);
				if (!sent) {
					remaining.push(payload);
				}
			} catch {
				remaining.push(payload);
			}
		}
		writeQueuedEvents(remaining);
	} finally {
		isFlushingQueue = false;
	}
}

function sendTelemetryPayload(payload) {
	flushQueuedEvents().catch((err) => {
		console.warn("[Licensing] Failed to flush queued telemetry events =>", err);
	});

	postTelemetryPayload(payload).then((sent) => {
		if (!sent) {
			enqueueEvent(payload);
			console.warn("[Licensing] Telemetry endpoint rejected event.");
		}
	}).catch((err) => {
		enqueueEvent(payload);
		console.warn("[Licensing] Failed to send telemetry event =>", err);
	});
}

export function emitLicenseEvent(type, details = {}) {
	if (!licenseV2Config.event_url) return;
	if (!ALLOWED_EVENT_TYPES.has(type)) return;

	if (type === "license.local_valid" && details.provider !== "keygen") {
		const key = [type, details.provider, details.device_id, details.keygen_license_id, pluginVersion]
			.filter(Boolean)
			.join(":");
		const lastEventAt = lastEventAtByKey.get(key) || 0;
		if (Date.now() - lastEventAt < localValidIntervalMs) return;
		lastEventAtByKey.set(key, Date.now());
	}

	const payload = {
		type,
		plugin_id: licenseV2Config.plugin_id,
		plugin_version: pluginVersion,
		licensing_mode: details.provider === "keygen" ? "keygen" : licensingConfig.mode,
		environment: licensingConfig.environment,
		update_channel: licenseV2Config.update_channel,
		timestamp: new Date().toISOString(),
		details: sanitizeDetails(details)
	};

	sendTelemetryPayload(payload);
}
