import licenseV2Config, { normalizeItemId } from "./config";
import { KJUR, KEYUTIL } from "jsrsasign";

function licenseResult(valid, extra = {}) {
	return { valid, ...extra };
}

function base64UrlToBase64(value) {
	let base64 = String(value || "")
		.replace(/-/g, "+")
		.replace(/_/g, "/");
	const padding = base64.length % 4;
	if (padding) base64 += "=".repeat(4 - padding);
	return base64;
}

function base64ToBytes(value) {
	if (typeof atob !== "function") {
		throw new Error("Base64 decoder is unavailable.");
	}

	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function base64UrlToBytes(value) {
	return base64ToBytes(base64UrlToBase64(value));
}

function base64UrlToJson(value) {
	const bytes = base64UrlToBytes(value);
	if (typeof TextDecoder !== "undefined") {
		return JSON.parse(new TextDecoder("utf-8").decode(bytes));
	}

	let text = "";
	for (let i = 0; i < bytes.length; i++) {
		text += String.fromCharCode(bytes[i]);
	}
	return JSON.parse(text);
}

function textToBytes(value) {
	if (typeof TextEncoder !== "undefined") {
		return new TextEncoder().encode(value);
	}

	const bytes = new Uint8Array(value.length);
	for (let i = 0; i < value.length; i++) {
		bytes[i] = value.charCodeAt(i);
	}
	return bytes;
}

function pemToBytes(pem) {
	const base64 = String(pem || "")
		.replace(/-----BEGIN PUBLIC KEY-----/g, "")
		.replace(/-----END PUBLIC KEY-----/g, "")
		.replace(/\s+/g, "");
	return base64ToBytes(base64);
}

function getSubtleCrypto() {
	return globalThis.crypto?.subtle || globalThis.window?.crypto?.subtle;
}

async function verifySignatureWithWebCrypto(encodedHeader, encodedPayload, encodedSignature) {
	const subtle = getSubtleCrypto();
	if (!subtle) {
		throw new Error("SubtleCrypto is unavailable.");
	}

	const key = await subtle.importKey(
		"spki",
		pemToBytes(licenseV2Config.public_verification_key),
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["verify"]
	);

	return await subtle.verify(
		{ name: "RSASSA-PKCS1-v1_5" },
		key,
		base64UrlToBytes(encodedSignature),
		textToBytes(`${encodedHeader}.${encodedPayload}`)
	);
}

function verifySignatureWithJsrsasign(token) {
	const key = KEYUTIL.getKey(licenseV2Config.public_verification_key);
	return KJUR.jws.JWS.verify(token, key, ["RS256"]);
}

function matchesAudience(actual, expected) {
	if (Array.isArray(actual)) {
		return actual.includes(expected);
	}
	return actual === expected;
}

function validatePayload(payload, deviceId, nowSeconds) {
	if (payload.iss !== licenseV2Config.token_issuer) {
		return licenseResult(false, { reason: "bad_issuer" });
	}
	if (!matchesAudience(payload.aud, licenseV2Config.token_audience)) {
		return licenseResult(false, { reason: "bad_audience" });
	}
	if (payload.flow !== "license_v2") {
		return licenseResult(false, { reason: "bad_flow" });
	}
	if (payload.plugin_id !== licenseV2Config.plugin_id) {
		return licenseResult(false, { reason: "bad_plugin_id" });
	}
	if (!licenseV2Config.allowed_item_ids.includes(normalizeItemId(payload.item_id))) {
		return licenseResult(false, { reason: "bad_item_id" });
	}
	if (payload.device_id !== deviceId) {
		return licenseResult(false, { reason: "bad_device_id" });
	}
	if (!payload.exp || Number(payload.exp) <= nowSeconds) {
		return licenseResult(false, { reason: "expired" });
	}

	return licenseResult(true);
}

export function decodeJwtPayload(token) {
	try {
		const parts = String(token || "").split(".");
		if (parts.length !== 3) return null;
		return base64UrlToJson(parts[1]);
	} catch (err) {
		console.error("[Licensing] Failed to decode JWT payload =>", err);
		return null;
	}
}

export async function verifyLicenseToken(token, deviceId, now = Date.now()) {
	try {
		if (!licenseV2Config.public_verification_key) {
			return licenseResult(false, { reason: "config", message: "License public verification key is missing." });
		}

		const parts = String(token || "").split(".");
		if (parts.length !== 3) {
			return licenseResult(false, { reason: "malformed_token" });
		}

		const [encodedHeader, encodedPayload, encodedSignature] = parts;
		const header = base64UrlToJson(encodedHeader);
		const payload = base64UrlToJson(encodedPayload);

		if (header.alg !== "RS256") {
			return licenseResult(false, { reason: "bad_algorithm" });
		}

		let isSignatureValid = false;
		try {
			isSignatureValid = await verifySignatureWithWebCrypto(encodedHeader, encodedPayload, encodedSignature);
		} catch (err) {
			console.warn("[Licensing] WebCrypto JWT verification unavailable, using JS fallback =>", err);
			isSignatureValid = verifySignatureWithJsrsasign(token);
		}

		if (!isSignatureValid) {
			return licenseResult(false, { reason: "bad_signature" });
		}

		const payloadValidation = validatePayload(payload, deviceId, Math.floor(now / 1000));
		if (!payloadValidation.valid) {
			return licenseResult(false, { ...payloadValidation, payload });
		}

		return licenseResult(true, { payload });
	} catch (err) {
		console.error("[Licensing] JWT verification failed =>", err);
		return licenseResult(false, {
			reason: "token_verification_failed",
			message: err && typeof err === "object" && "message" in err ? err.message : String(err)
		});
	}
}
