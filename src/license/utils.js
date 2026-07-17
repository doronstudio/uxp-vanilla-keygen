import { storage, host } from "uxp";
import sha256 from "js-sha256";
import ps from "photoshop";
import os from "os";
import { getAssignedItemId, licensingConfig } from "./config";
import {
	activateKeygenLicense,
	checkStoredKeygenActivationStatus,
	clearKeygenActivation,
	getStoredKeygenActivation
} from "./keygen-service";
import { emitLicenseEvent } from "./telemetry";

const secureStorage = storage.secureStorage;
let lastLocalLicenseFailure = null;
const NETWORK_FAILURE_REASONS = new Set([
	"network_error",
	"network_timeout",
	"network_unreachable",
	"dns_error",
	"tls_error",
	"keygen_unavailable"
]);

export function getLastLocalLicenseFailure() {
	return lastLocalLicenseFailure;
}

export function isNetworkFailureReason(reason) {
	return NETWORK_FAILURE_REASONS.has(reason);
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

export async function checkLocalToken() {
	console.log("[Local Licensing] checkLicense started...");
	lastLocalLicenseFailure = null;

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

	console.log("[Licensing] No valid local license found.");
	return false;
}

export async function checkServerLicense(serial) {
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

async function getUserAdobeCloudId() {
	try {
		return await require("uxp").userInfo.userId();
	} catch {}
	return;
}

export function generateString(length, list) {
	const characters = list || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	const charactersLength = characters.length;
	let result = "";

	for (let i = 0; i < length; i++) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}

	return result;
}

function utf8Array2String(array) {
	if (!array) return "";
	if (typeof array === "string") return array;
	if (array instanceof ArrayBuffer) array = new Uint8Array(array);

	let out = "";
	let i = 0;

	while (i < array.length) {
		const c = array[i++];
		switch (c >> 4) {
			case 0:
			case 1:
			case 2:
			case 3:
			case 4:
			case 5:
			case 6:
			case 7:
				out += String.fromCharCode(c);
				break;
			case 12:
			case 13: {
				const char2 = array[i++];
				out += String.fromCharCode(((c & 0x1f) << 6) | (char2 & 0x3f));
				break;
			}
			case 14: {
				const char2 = array[i++];
				const char3 = array[i++];
				out += String.fromCharCode(((c & 0x0f) << 12) | ((char2 & 0x3f) << 6) | (char3 & 0x3f));
				break;
			}
		}
	}

	return out;
}
