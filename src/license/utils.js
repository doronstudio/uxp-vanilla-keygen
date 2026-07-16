import { storage, host } from "uxp";
import sha256 from "js-sha256";
import ps from "photoshop";
import os from "os";
import { setReusableData } from "./protected-service";
import licenseV2Config, {
	allowsKeygen,
	allowsPortal,
	getAssignedItemId,
	licensingConfig,
	normalizeItemId
} from "./config";
import { verifyLicenseToken } from "./jwt";
import {
	activateKeygenLicense,
	checkStoredKeygenActivationStatus,
	clearKeygenActivation,
	getStoredKeygenActivation
} from "./keygen-service";
import { emitLicenseEvent } from "./telemetry";

const secureStorage = storage.secureStorage;
const pluginVersion = String(process.env.PLUGIN_VERSION || "0.0.0").trim() || "0.0.0";
let lastLocalLicenseFailure = null;
const NETWORK_FAILURE_REASONS = new Set([
	"network_error",
	"network_timeout",
	"network_unreachable",
	"dns_error",
	"tls_error",
	"keygen_unavailable",
	"portal_unavailable"
]);

export function getLastLocalLicenseFailure() {
	return lastLocalLicenseFailure;
}

export function isNetworkFailureReason(reason) {
	return NETWORK_FAILURE_REASONS.has(reason);
}

export async function getDecodedToken() {
	const token = await loadToken();
	const device_id = await getDeviceUniqueId();
	if (token) {
		const result = await verifyLicenseToken(token, device_id);
		if (result.valid) {
			return result.payload;
		}
	}
	return null;
}

function licenseResult(success, extra = {}) {
	return { success, ...extra };
}

function keygenTelemetryDetails(details = {}) {
	return {
		provider: "keygen",
		device_id: details.device_id,
		item_id: getAssignedItemId(),
		keygen_license_id: details.keygen_license_id,
		keygen_machine_id: details.keygen_machine_id,
		keygen_product_id: details.keygen_product_id || licensingConfig.keygen.productId,
		status: details.status,
		reason: details.reason,
		activation_expires_at: details.activation_expires_at,
		offline: details.offline
	};
}

function extractBackendMessage(rawText) {
	if (!rawText) return "";
	let text = String(rawText).trim();
	if (!text) return "";

	try {
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === "object") {
			if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
			if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();

			if (parsed.errors && typeof parsed.errors === "object") {
				for (const key of Object.keys(parsed.errors)) {
					const value = parsed.errors[key];
					if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") return value[0].trim();
					if (typeof value === "string" && value.trim()) return value.trim();
				}
			}

			if (
				typeof parsed.exception === "string" &&
				parsed.exception.trim() &&
				typeof parsed.message === "string" &&
				parsed.message.trim()
			) {
				return `${parsed.exception.trim()}: ${parsed.message.trim()}`;
			}
		}
	} catch {
		// non-JSON body
	}

	text = text
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const stackTraceMarker = text.indexOf("Stack trace");
	if (stackTraceMarker > 0) {
		text = text.slice(0, stackTraceMarker).trim();
	}

	if (text.length > 260) {
		text = `${text.slice(0, 257).trim()}...`;
	}

	return text;
}

export async function checkLocalToken() {
	console.log("[Local Licensing] checkLicense started...");
	lastLocalLicenseFailure = null;
	const token = allowsPortal() ? await getDecodedToken() : null;
	if (token) {
		console.log("[Licensing] Token valid => license valid offline.");
		lastLocalLicenseFailure = null;
		emitLicenseEvent("license.local_valid", {
			provider: "portal",
			device_id: token.device_id,
			item_id: token.item_id,
			expires_at: token.expires_at || token.exp,
			offline: true
		});
		return true;
	}

	if (allowsKeygen()) {
		const fingerprint = await getDeviceUniqueId();
		const keygenStatus = await checkStoredKeygenActivationStatus(fingerprint);
		if (keygenStatus.valid) {
			const activation = keygenStatus.state;
			console.log("[Licensing] Keygen activation valid.");
			lastLocalLicenseFailure = null;
			if (activation?.licenseId) {
				emitLicenseEvent("license.local_valid", {
					...keygenTelemetryDetails({
						device_id: fingerprint,
						keygen_license_id: activation.keygenLicenseId,
						keygen_machine_id: activation.keygenMachineId,
						keygen_product_id: activation.keygenProductId,
						activation_expires_at: activation.expiresAt,
						offline: true
					})
				});
			}
			return true;
		}

		if (keygenStatus.state?.licenseId && keygenStatus.result) {
			lastLocalLicenseFailure = {
				provider: "keygen",
				reason: keygenStatus.result.reason,
				message: keygenStatus.result.message,
				status: keygenStatus.result.status
			};
			emitLicenseEvent("license.activation_failed", {
				...keygenTelemetryDetails({
					device_id: fingerprint,
					reason: keygenStatus.result.reason,
					status: keygenStatus.result.status,
					keygen_license_id: keygenStatus.state.keygenLicenseId,
					keygen_machine_id: keygenStatus.state.keygenMachineId,
					keygen_product_id: keygenStatus.state.keygenProductId,
					activation_expires_at: keygenStatus.state.expiresAt,
					offline: false
				})
			});
		}
	}

	console.log("[Licensing] No valid local license found.");
	return false;
}

function shouldUseKeygen(provider, email, serial) {
	if (licensingConfig.mode === "keygen_only") return true;
	if (licensingConfig.mode === "legacy") return false;
	if (provider === "keygen") return true;
	if (provider === "portal") return false;

	const normalizedEmail = String(email || "").trim();
	const normalizedSerial = String(serial || "").trim();
	return !normalizedEmail && normalizedSerial.length > 0;
}

export async function checkServerLicense(email, serial, providerOrItemId = "portal") {
	const useKeygen = shouldUseKeygen(providerOrItemId, email, serial);

	if (useKeygen) {
		if (!allowsKeygen()) {
			return licenseResult(false, { reason: "keygen_disabled", message: "Keygen activation is not enabled." });
		}

		const fingerprint = await getDeviceUniqueId();
		const existingActivation = await getStoredKeygenActivation(fingerprint);
		let activationAttemptSent = false;
		const sendActivationAttempt = ({ licenseId, productId } = {}) => {
			if (!licenseId || activationAttemptSent) return;
			activationAttemptSent = true;
			emitLicenseEvent("license.activation_attempt", {
				...keygenTelemetryDetails({
					device_id: fingerprint,
					keygen_license_id: licenseId,
					keygen_machine_id: existingActivation?.keygenMachineId,
					keygen_product_id: productId || existingActivation?.keygenProductId,
					offline: false
				})
			});
		};
		const result = await activateKeygenLicense(serial, fingerprint, { onActivationAttempt: sendActivationAttempt });
		const keygenLicenseId = result.licenseId || existingActivation?.keygenLicenseId;
		if (!activationAttemptSent && keygenLicenseId) {
			sendActivationAttempt({ licenseId: keygenLicenseId, productId: result.productId || existingActivation?.keygenProductId });
		}
		if (keygenLicenseId) {
			emitLicenseEvent(result.success ? "license.activation_success" : "license.activation_failed", {
				...keygenTelemetryDetails({
					device_id: fingerprint,
					reason: result.reason,
					status: result.status,
					keygen_license_id: keygenLicenseId,
					keygen_machine_id: result.machineId || existingActivation?.keygenMachineId,
					keygen_product_id: result.productId || existingActivation?.keygenProductId,
					offline: false
				})
			});
		}
		return result;
	}

	if (!allowsPortal()) {
		return licenseResult(false, {
			reason: "migration_required",
			message: "This license must be upgraded or migrated before it can be used in this version."
		});
	}

	const itemId = providerOrItemId && !["portal", "keygen"].includes(providerOrItemId) ? providerOrItemId : getAssignedItemId();
	const deviceId = await getDeviceUniqueId();
	emitLicenseEvent("license.activation_attempt", {
		provider: "portal",
		device_id: deviceId,
		item_id: itemId,
		offline: false
	});
	const result = await checkPortalLicense(email, serial, itemId);
	emitLicenseEvent(result.success ? "license.activation_success" : "license.activation_failed", {
		provider: "portal",
		device_id: deviceId,
		item_id: itemId,
		reason: result.reason === "network_error" ? "portal_unavailable" : result.reason,
		status: result.status,
		offline: false
	});
	return result;
}

export async function checkPortalLicense(email, serial, itemId = getAssignedItemId()) {
	const normalizedEmail = (email || "").trim();
	const normalizedSerial = (serial || "").trim();
	const selectedItemId = normalizeItemId(itemId);

	if (!normalizedEmail || !normalizedSerial) {
		console.log("[Licensing] Incomplete license info => need user input.");
		return licenseResult(false, { reason: "missing_input" });
	}

	if (!selectedItemId || !licenseV2Config.allowed_item_ids.includes(selectedItemId)) {
		return licenseResult(false, { reason: "config", message: "Licensed product is not configured." });
	}

	const result = await verifyLicense(normalizedEmail, normalizedSerial, selectedItemId);

	if (!result.success) {
		return result;
	}

	const data = result.data;
	if (data) {
		const jwt = data.token || data.entitlement_token || data.jwt;
		if (!jwt) {
			return licenseResult(false, {
				reason: "token_missing",
				message: "License server did not return an entitlement token."
			});
		}

		const deviceId = await getDeviceUniqueId();
		const tokenResult = await verifyLicenseToken(jwt, deviceId);
		if (tokenResult.valid) {
			await saveToken(jwt);
			await saveUserData({
				email: normalizedEmail,
				item_id: tokenResult.payload.item_id,
				expires_at: data.expires_at || tokenResult.payload.expires_at || tokenResult.payload.exp
			});
			setReusableData(tokenResult.payload.protected_payload || tokenResult.payload.key, normalizedEmail);
			console.log("[Licensing] License verified => token saved => offline next time.");
			return licenseResult(true);
		}

		return licenseResult(false, {
			reason: tokenResult.reason || "token_verification_failed",
			message:
				tokenResult.message || `License token could not be verified locally (${tokenResult.reason || "unknown"}).`
		});
	}

	return licenseResult(false, { reason: "unknown" });
}

export async function clearAll() {
	try {
		const keys = [];

		for (let i = 0; i < secureStorage.length; i++) {
			keys.push(secureStorage.key(i));
		}

		keys.forEach((key) => {
			if (key !== "_deviceId") {
				try {
					secureStorage.removeItem(key);
				} catch {}
			}
		});
		await clearKeygenActivation();
	} catch {
		//noop
	}
}

async function verifyLicense(email, license_code, item_id) {
	if (!licenseV2Config.license_verify_url) {
		console.error("[Licensing] DOR_LICENSE_V2_VERIFY_URL is not configured.");
		return licenseResult(false, { reason: "config", message: "Verification URL is missing." });
	}

	let resp;
	try {
		const device_id = await getDeviceUniqueId();

		resp = await fetch(licenseV2Config.license_verify_url, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({
				plugin_id: licenseV2Config.plugin_id,
				item_id,
				email,
				license_code,
				device_id,
				plugin_version: pluginVersion,
				environment: licensingConfig.environment,
				update_channel: licenseV2Config.update_channel
			})
		});
	} catch (err) {
		console.error("[Licensing] Fetch error =>", err);
		return licenseResult(false, {
			reason: "network_error",
			message: err && typeof err === "object" && "message" in err ? err.message : String(err)
		});
	}

	let responseText = "";
	try {
		responseText = await resp.text();
	} catch (err) {
		console.error("[Licensing] Failed to read server response body =>", err);
		return licenseResult(false, {
			reason: "response_read_error",
			status: resp.status,
			message: err && typeof err === "object" && "message" in err ? err.message : String(err)
		});
	}

	if (!resp.ok) {
		console.error("[Licensing] Server error =>", resp.status, responseText);
		const message = extractBackendMessage(responseText) || `Server error (${resp.status}).`;
		const isValidationFailure = [400, 401, 403, 404, 409, 422].includes(resp.status);
		return licenseResult(false, {
			reason: isValidationFailure ? "invalid" : "server_error",
			status: resp.status,
			message
		});
	}

	let data;
	try {
		data = JSON.parse(responseText);
	} catch {
		console.error("[Licensing] Invalid JSON response =>", {
			status: resp.status,
			contentType: resp.headers?.get?.("content-type"),
			responseText
		});
		const message = extractBackendMessage(responseText) || "Server response was not valid JSON.";
		return licenseResult(false, {
			reason: "invalid_json_response",
			status: resp.status,
			message
		});
	}

	console.log("[Licensing] Server response =>", {
		success: data?.success,
		message: data?.message,
		token_type: data?.token_type,
		expires_at: data?.expires_at
	});

	if (data.success === false) {
		console.warn("[Licensing] License invalid =>", data.message);
		return licenseResult(false, { reason: "invalid", message: data.message });
	}

	return licenseResult(true, { data });
}

async function saveUserData(obj) {
	const deviceId = await getDeviceUniqueId();
	return await secureStorage.setItem(`_userdata_${deviceId}`, JSON.stringify(obj));
}

export async function getUserData() {
	try {
		const deviceId = await getDeviceUniqueId();
		const raw = await secureStorage.getItem(`_userdata_${deviceId}`);
		const data = JSON.parse(utf8Array2String(raw));

		if (data && typeof data === "object" && "email" in data) {
			return data;
		}
	} catch {}
}

async function getUserAdobeCloudId() {
	try {
		return await require("uxp").userInfo.userId();
	} catch {}
	return;
}

async function saveToken(token) {
	try {
		const device_id = await getDeviceUniqueId();
		await secureStorage.setItem(`_usertoken_${device_id}`, token);
	} catch {}
}

export async function loadToken() {
	try {
		const device_id = await getDeviceUniqueId();
		const bytes = await secureStorage.getItem(`_usertoken_${device_id}`);
		return utf8Array2String(bytes);
	} catch {}
}

export function generateString(length, list) {
	const characters = list || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	const charactersLength = characters.length;
	let result = "";

	for (var i = 0; i < length; i++) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}

	return result;
}

function isValidDeviceId(value) {
	return /^[A-Za-z0-9._:-]{1,150}$/.test(value);
}

export async function getDeviceUniqueId() {
	try {
		const bytes = await secureStorage.getItem("_deviceId");
		if (bytes) {
			const deviceId = utf8Array2String(bytes);
			if (isValidDeviceId(deviceId)) {
				return deviceId;
			}
		}
	} catch {}

	const device_id = await generateDeviceUniqueId();

	await secureStorage.setItem("_deviceId", device_id);

	return device_id;
}

export async function generateDeviceUniqueId() {
	try {
		const uniq = [
			os.platform(),
			os.arch(),
			host.uiLocale,
			ps.core.getCPUInfo(),
			ps.core.getGPUInfo().clgpuInfoList?.map(({ name, vendor, isIntegrated }) => ({
				name,
				vendor,
				isIntegrated
			})),
			os.homedir(),
			os.totalmem()
		];

		const cloudId = await getUserAdobeCloudId();
		if (cloudId) {
			uniq.push(cloudId);
		} else if ("crypto" in window) {
			uniq.push(window.crypto.randomUUID());
		} else {
			uniq.push(generateString(32));
		}

		return sha256(JSON.stringify(uniq));
	} catch (error) {
		console.error("Error fetching encodedSerialNumber:", error);
		return "DEV-" + Date.now();
	}
}

function utf8Array2String(array) {
	if (!array) return "";
	if (typeof array === "string") return array;
	if (array instanceof ArrayBuffer) array = new Uint8Array(array);

	var out, i, len, c;
	var char2, char3;

	out = "";
	len = array.length;
	i = 0;

	while (i < len) {
		c = array[i++];
		switch (c >> 4) {
			case 0:
			case 1:
			case 2:
			case 3:
			case 4:
			case 5:
			case 6:
			case 7:
				// 0xxxxxxx
				out += String.fromCharCode(c);
				break;
			case 12:
			case 13:
				// 110x xxxx   10xx XXXX
				char2 = array[i++];
				out += String.fromCharCode(((c & 0x1f) << 6) | (char2 & 0x3f));
				break;
			case 14:
				// 1110 xxxx  10xx xxxx  10xx xxxx
				char2 = array[i++];
				char3 = array[i++];
				out += String.fromCharCode(((c & 0x0f) << 12) | ((char2 & 0x3f) << 6) | ((char3 & 0x3f) << 0));
				break;
		}
	}

	return out;
}
