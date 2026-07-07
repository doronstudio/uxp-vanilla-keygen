import { storage, host } from "uxp";
import os from "os";
import { licensingConfig, isKeygenConfigured } from "./config";

const secureStorage = storage.secureStorage;
const KEYGEN_STORAGE_PREFIX = "_keygen_activation_";
const KEYGEN_FINGERPRINT_KEY = "_keygen_fingerprint";
const JSON_API_CONTENT_TYPE = "application/vnd.api+json";
const OFFLINE_TTL_MS = Number(process.env.DOR_EXPIRE_LICENSE_SECONDS || 172800) * 1000;

const USER_MESSAGES = {
	invalid: "Invalid license key.",
	suspended: "This license is currently suspended. Please contact support.",
	expired: "This license has expired.",
	machine_limit: "Device limit reached. Please deactivate another device or contact support.",
	network_error: "Could not reach the licensing server. Please check your connection and try again.",
	config: "License verification is temporarily unavailable due to plugin configuration. Please contact support."
};

const ACTIVATION_REQUIRED_CODES = new Set(["NO_MACHINE", "NO_MACHINES", "FINGERPRINT_SCOPE_MISMATCH"]);

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

function keygenUrl(path) {
	return `${licensingConfig.keygen.baseUrl}/v1/accounts/${licensingConfig.keygen.accountId}${path}`;
}

function storageKey(fingerprint) {
	return `${KEYGEN_STORAGE_PREFIX}${fingerprint}`;
}

function licenseHeaders(licenseKey) {
	const headers = {
		Accept: JSON_API_CONTENT_TYPE,
		"Content-Type": JSON_API_CONTENT_TYPE
	};

	if (licenseKey) {
		headers.Authorization = `License ${licenseKey}`;
	}

	return headers;
}

function jsonApiErrorText(payload) {
	const errors = Array.isArray(payload?.errors) ? payload.errors : [];
	return errors.map((error) => [error.code, error.title, error.detail].filter(Boolean).join(": ")).join(" ");
}

function mapFailure({ status, code, detail }) {
	const normalizedCode = String(code || "").toUpperCase();
	const normalizedDetail = String(detail || "").toLowerCase();

	if (normalizedCode === "SUSPENDED" || normalizedDetail.includes("suspended")) {
		return { reason: "suspended", message: USER_MESSAGES.suspended };
	}

	if (normalizedCode === "EXPIRED" || normalizedDetail.includes("expired")) {
		return { reason: "expired", message: USER_MESSAGES.expired };
	}

	if (
		normalizedCode.includes("TOO_MANY_MACHINES") ||
		normalizedCode.includes("MACHINE_LIMIT") ||
		normalizedDetail.includes("machine limit") ||
		normalizedDetail.includes("max machines") ||
		normalizedDetail.includes("too many machines")
	) {
		return { reason: "machine_limit", message: USER_MESSAGES.machine_limit };
	}

	if (status === 401 || status === 404 || normalizedCode.includes("NOT_FOUND") || normalizedCode.includes("INVALID")) {
		return { reason: "invalid", message: USER_MESSAGES.invalid };
	}

	return { reason: "invalid", message: USER_MESSAGES.invalid };
}

async function readJsonResponse(resp) {
	const text = await resp.text();
	if (!text) return {};

	try {
		return JSON.parse(text);
	} catch {
		return {
			errors: [
				{
					code: "INVALID_JSON",
					detail: text
						.replace(/<[^>]+>/g, " ")
						.replace(/\s+/g, " ")
						.trim()
				}
			]
		};
	}
}

function getValidationCode(payload) {
	return payload?.meta?.code || payload?.meta?.constant || "";
}

function isActivationRequired(payload) {
	return ACTIVATION_REQUIRED_CODES.has(String(getValidationCode(payload)).toUpperCase());
}

function isProductAllowed(payload) {
	const productId = licensingConfig.keygen.productId;
	if (!productId) return true;

	const productRelationship = payload?.data?.relationships?.product?.data;
	return productRelationship?.id === productId;
}

function firstMachineId(payload) {
	return payload?.data?.relationships?.machines?.data?.[0]?.id;
}

function normalizeStoredActivation(state) {
	if (!state || typeof state !== "object") return null;

	const keygenLicenseId = state.keygenLicenseId || state.licenseId;
	if (!state.licenseKey || !keygenLicenseId || state.fingerprint === undefined) return null;

	return {
		...state,
		keygenLicenseId,
		keygenMachineId: state.keygenMachineId || state.machineId,
		keygenProductId: state.keygenProductId || state.productId || licensingConfig.keygen.productId,
		licenseId: keygenLicenseId,
		machineId: state.keygenMachineId || state.machineId,
		productId: state.keygenProductId || state.productId || licensingConfig.keygen.productId
	};
}

function networkFailureReason(error) {
	const message = String(error?.message || error || "").toLowerCase();
	if (message.includes("timed out") || message.includes("timeout") || message.includes("abort")) return "network_timeout";
	if (message.includes("dns") || message.includes("name") || message.includes("resolve")) return "dns_error";
	if (message.includes("tls") || message.includes("ssl") || message.includes("certificate")) return "tls_error";
	if (message.includes("network") || message.includes("fetch")) return "network_unreachable";
	return "keygen_unavailable";
}

async function keygenFetch(path, { method = "POST", licenseKey, body } = {}) {
	let resp;
	try {
		resp = await fetch(keygenUrl(path), {
			method,
			headers: licenseHeaders(licenseKey),
			body: body ? JSON.stringify(body) : undefined
		});
	} catch (err) {
		console.error("[Keygen] Network error =>", err);
		return { success: false, reason: networkFailureReason(err), message: USER_MESSAGES.network_error };
	}

	const payload = await readJsonResponse(resp);
	if (!resp.ok) {
		const firstError = Array.isArray(payload?.errors) ? payload.errors[0] : null;
		const mapped = mapFailure({
			status: resp.status,
			code: firstError?.code,
			detail: firstError?.detail || firstError?.title || jsonApiErrorText(payload)
		});
		return { success: false, status: resp.status, payload, ...mapped };
	}

	return { success: true, status: resp.status, payload };
}

async function validateKey(licenseKey, fingerprint) {
	const result = await keygenFetch("/licenses/actions/validate-key", {
		licenseKey,
		body: {
			meta: {
				key: licenseKey,
				scope: { fingerprint }
			}
		}
	});

	if (!result.success) return result;

	const payload = result.payload;
	const licenseId = payload?.data?.id;
	if (!licenseId) {
		return { success: false, reason: "invalid", message: USER_MESSAGES.invalid, payload };
	}

	if (!isProductAllowed(payload)) {
		return { success: false, reason: "invalid", message: USER_MESSAGES.invalid, payload };
	}

	if (payload?.meta?.valid === true) {
		return { success: true, licenseId, payload };
	}

	if (isActivationRequired(payload)) {
		return { success: false, reason: "activation_required", licenseId, payload };
	}

	const mapped = mapFailure({
		code: getValidationCode(payload),
		detail: payload?.meta?.detail
	});
	return { success: false, licenseId, payload, ...mapped };
}

async function activateMachine(licenseKey, licenseId, fingerprint) {
	const pluginName = String(process.env.DOR_UXP_PLUGIN_NAME || "UXP Vanilla Keygen Starter").trim();
	const machineName = [pluginName, os.hostname?.() || os.platform?.() || "UXP", host.applicationName || "Photoshop"]
		.filter(Boolean)
		.join(" - ");

	return await keygenFetch("/machines", {
		licenseKey,
		body: {
			data: {
				type: "machines",
				attributes: {
					fingerprint,
					name: machineName,
					platform: "uxp-photoshop"
				},
				relationships: {
					license: {
						data: {
							type: "licenses",
							id: licenseId
						}
					}
				}
			}
		}
	});
}

async function saveActivation(state) {
	await secureStorage.setItem(KEYGEN_FINGERPRINT_KEY, state.fingerprint);
	await secureStorage.setItem(storageKey(state.fingerprint), JSON.stringify(state));
}

export async function getStoredKeygenActivation(fingerprint) {
	try {
		const bytes = await secureStorage.getItem(storageKey(fingerprint));
		const state = JSON.parse(utf8Array2String(bytes));
		const normalized = normalizeStoredActivation(state);
		if (normalized && normalized.fingerprint === fingerprint) {
			return normalized;
		}
	} catch {}
}

export async function clearKeygenActivation(fingerprint) {
	try {
		if (fingerprint) {
			await secureStorage.removeItem(storageKey(fingerprint));
			return;
		}

		const bytes = await secureStorage.getItem(KEYGEN_FINGERPRINT_KEY);
		const storedFingerprint = utf8Array2String(bytes);
		if (storedFingerprint) {
			await secureStorage.removeItem(storageKey(storedFingerprint));
		}
		await secureStorage.removeItem(KEYGEN_FINGERPRINT_KEY);
	} catch {}
}

export async function deactivateKeygenMachine(activation) {
	const licenseKey = String(activation?.licenseKey || "").trim();
	const machineId = String(activation?.keygenMachineId || activation?.machineId || "").trim();

	if (!licenseKey || !machineId) {
		return { success: false, reason: "missing_deactivation_data", message: USER_MESSAGES.config };
	}

	const result = await keygenFetch(`/machines/${encodeURIComponent(machineId)}`, {
		method: "DELETE",
		licenseKey
	});

	if (result.success) {
		return { ...result, machineId };
	}

	if (result.status === 404) {
		return {
			success: true,
			status: result.status,
			reason: "already_deleted",
			message: "This device was already deactivated.",
			machineId,
			payload: result.payload
		};
	}

	return { ...result, machineId };
}

export async function checkStoredKeygenActivationStatus(fingerprint) {
	const state = await getStoredKeygenActivation(fingerprint);
	if (!state) return { valid: false, state: null };

	if (state.expiresAt && state.expiresAt > Date.now()) {
		return { valid: true, state, source: "cache" };
	}

	const result = await activateKeygenLicense(state.licenseKey, fingerprint);
	if (result.success) {
		return {
			valid: true,
			state: (await getStoredKeygenActivation(fingerprint)) || state,
			result,
			source: "refresh"
		};
	}

	if (["invalid", "suspended", "expired", "machine_limit"].includes(result.reason)) {
		await clearKeygenActivation(fingerprint);
	}

	return { valid: false, state, result };
}

export async function checkStoredKeygenActivation(fingerprint) {
	const status = await checkStoredKeygenActivationStatus(fingerprint);
	return status.valid;
}

export async function activateKeygenLicense(licenseKey, fingerprint, options = {}) {
	const normalizedKey = String(licenseKey || "").trim();
	const onActivationAttempt = typeof options.onActivationAttempt === "function" ? options.onActivationAttempt : null;
	if (!isKeygenConfigured()) {
		return { success: false, reason: "config", message: USER_MESSAGES.config };
	}

	if (!normalizedKey) {
		return { success: false, reason: "missing_input", message: USER_MESSAGES.invalid };
	}

	const validation = await validateKey(normalizedKey, fingerprint);
	if (validation.success) {
		onActivationAttempt?.({ licenseId: validation.licenseId, productId: licensingConfig.keygen.productId });
		const activation = await activateMachine(normalizedKey, validation.licenseId, fingerprint);
		if (!activation.success && activation.reason === "machine_limit") {
			return {
				...activation,
				licenseId: validation.licenseId,
				machineId: activation.payload?.data?.id || firstMachineId(validation.payload),
				productId: licensingConfig.keygen.productId
			};
		}
		const machineId = activation.success ? activation.payload?.data?.id : firstMachineId(validation.payload);

		await saveActivation({
			provider: "keygen",
			licenseKey: normalizedKey,
			keygenLicenseId: validation.licenseId,
			keygenMachineId: machineId,
			keygenProductId: licensingConfig.keygen.productId,
			fingerprint,
			validatedAt: Date.now(),
			expiresAt: Date.now() + OFFLINE_TTL_MS
		});
		return {
			success: true,
			provider: "keygen",
			licenseId: validation.licenseId,
			machineId,
			productId: licensingConfig.keygen.productId,
			data: validation.payload
		};
	}

	if (validation.reason !== "activation_required") {
		return validation;
	}

	onActivationAttempt?.({ licenseId: validation.licenseId, productId: licensingConfig.keygen.productId });
	const activation = await activateMachine(normalizedKey, validation.licenseId, fingerprint);
	if (!activation.success) {
		if (activation.reason === "invalid" && activation.status === 422) {
			const retry = await validateKey(normalizedKey, fingerprint);
			if (retry.success) {
				const machineId = firstMachineId(retry.payload);
				await saveActivation({
					provider: "keygen",
					licenseKey: normalizedKey,
					keygenLicenseId: retry.licenseId,
					keygenMachineId: machineId,
					keygenProductId: licensingConfig.keygen.productId,
					fingerprint,
					validatedAt: Date.now(),
					expiresAt: Date.now() + OFFLINE_TTL_MS
				});
				return {
					success: true,
					provider: "keygen",
					licenseId: retry.licenseId,
					machineId,
					productId: licensingConfig.keygen.productId,
					data: retry.payload
				};
			}
		}
		return {
			...activation,
			licenseId: validation.licenseId,
			machineId: activation.payload?.data?.id,
			productId: licensingConfig.keygen.productId
		};
	}

	const finalValidation = await validateKey(normalizedKey, fingerprint);
	if (!finalValidation.success && finalValidation.reason !== "activation_required") {
		return {
			...finalValidation,
			licenseId: finalValidation.licenseId || validation.licenseId,
			machineId: activation.payload?.data?.id,
			productId: licensingConfig.keygen.productId
		};
	}

	const machineId = activation.payload?.data?.id;

	await saveActivation({
		provider: "keygen",
		licenseKey: normalizedKey,
		keygenLicenseId: validation.licenseId,
		keygenMachineId: machineId,
		keygenProductId: licensingConfig.keygen.productId,
		fingerprint,
		validatedAt: Date.now(),
		expiresAt: Date.now() + OFFLINE_TTL_MS
	});

	return {
		success: true,
		provider: "keygen",
		licenseId: validation.licenseId,
		machineId,
		productId: licensingConfig.keygen.productId,
		data: finalValidation.payload || activation.payload
	};
}
