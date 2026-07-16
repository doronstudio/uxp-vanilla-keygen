import {
	checkLocalToken,
	checkServerLicense,
	getLastLocalLicenseFailure,
	getUserData,
	isNetworkFailureReason
} from "./utils";
import licenseV2Config, { allowsKeygen, licensingConfig } from "./config";
import ps from "photoshop";

let selectedProvider = licensingConfig.mode === "legacy" ? "portal" : "keygen";

function showSlidersSection() {
	document.body.classList.remove("auth-page");
	document.getElementById("LicSection").style.display = "none";
	document.querySelector(".container").style.display = "";
}

function showLicSection() {
	document.body.classList.add("auth-page");
	document.getElementById("LicSection").style.display = "";
	document.querySelector(".container").style.display = "none";
}

function handleEmailInput(evt) {
	evt.target.setAttribute("data-value", evt.target.value);
	console.log("[Licensing] Email changed.");
}

function handleSerialInput(evt) {
	evt.target.setAttribute("data-value", evt.target.value);
	console.log("[Licensing] License code changed.");
}

function handleWindowLoad() {
	updateState();
}

function normalizeUserMessage(message) {
	if (!message) return "";
	return String(message).replace(/\s+/g, " ").trim();
}

function getInputValue(elem) {
	return (elem?.getAttribute("data-value") || elem?.value || "").trim();
}

function clearInput(elem) {
	if (!elem) return;
	elem.value = "";
	elem.setAttribute("value", "");
	elem.setAttribute("data-value", "");
}

function setStatus(message, type = "info") {
	const statusElem = document.querySelector("#LicenseStatus");
	if (!statusElem) return;

	statusElem.textContent = message || "";
	statusElem.setAttribute("data-state", type);
	statusElem.style.display = message ? "" : "none";
}

function configureLicensingModeUI() {
	selectedProvider = allowsKeygen() ? "keygen" : "portal";

	const emailElem = document.querySelector(".Email");
	if (emailElem && selectedProvider === "keygen") {
		clearInput(emailElem);
	}

	setStatus("", "info");
}

let isInitialized = false;

function bindUI() {
	if (isInitialized) {
		return;
	}

	const emailElem = document.querySelector(".Email");
	const serialElem = document.querySelector(".Serial");
	const verifyButton = document.querySelector("#VerifyButton");

	if (!emailElem || !serialElem || !verifyButton) {
		console.warn("[Licensing] UI not ready yet. Delaying license UI binding.");
		return;
	}

	isInitialized = true;
	emailElem.addEventListener("input", handleEmailInput);
	serialElem.addEventListener("input", handleSerialInput);
	verifyButton.addEventListener("click", handleSubmit);
	configureLicensingModeUI();
	restoreActivationMetadata();
	loop();
}

async function restoreActivationMetadata() {
	const emailElem = document.querySelector(".Email");
	const data = await getUserData();
	if (!emailElem || !data?.email) return;

	emailElem.setAttribute("data-value", data.email);
	emailElem.value = data.email;
}

async function handleSubmit(evt) {
	evt?.preventDefault?.();

	const emailElem = document.querySelector(".Email");
	const serialElem = document.querySelector(".Serial");
	const verifyButton = document.querySelector("#VerifyButton");

	const email = getInputValue(emailElem);
	const serial = getInputValue(serialElem);

	if (selectedProvider === "portal" && (!email || !serial)) {
		await ps.app.showAlert("Please enter your customer email and license code.");
		return;
	}

	if (selectedProvider === "keygen" && !serial) {
		await ps.app.showAlert("Please enter your new license key.");
		return;
	}

	setStatus("Validating license...", "validating");
	verifyButton?.classList?.add("is-validating");

	let result;
	try {
		result = await checkServerLicense(email, serial, selectedProvider);
	} finally {
		verifyButton?.classList?.remove("is-validating");
	}

	if (result.success) {
		setStatus("Activated.", "success");
		await ps.app.showAlert(selectedProvider === "keygen" ? "Activation successful." : "Verification successful.");
		clearInput(emailElem);
		clearInput(serialElem);
	} else {
		const backendMessage = normalizeUserMessage(result.message);
		const httpStatusSuffix = result.status ? ` (HTTP ${result.status})` : "";
		let message = "Could not contact the license server. Please check your internet/VPN/firewall and try again.";

		if (["suspended", "expired", "machine_limit", "migration_required", "product_mismatch"].includes(result.reason)) {
			message = backendMessage || message;
		} else if (selectedProvider === "keygen" && result.reason === "invalid") {
			message = backendMessage || "Invalid license key.";
		} else if (result.reason === "invalid") {
			message =
				backendMessage ||
				`Verification failed. Incorrect data or you have exceeded the allowed number of devices.${httpStatusSuffix}`;
		} else if (
			[
				"token_missing",
				"bad_signature",
				"bad_issuer",
				"bad_audience",
				"bad_flow",
				"bad_plugin_id",
				"bad_item_id",
				"bad_device_id",
				"bad_algorithm",
				"malformed_token",
				"expired",
				"token_verification_failed"
			].includes(result.reason)
		) {
			message =
				backendMessage || "The license server response could not be verified. Please try again or contact support.";
		} else if (["server_error", "invalid_json_response", "response_read_error"].includes(result.reason)) {
			message =
				backendMessage ||
				`The license server returned an unexpected response. Please try again shortly or contact support.${httpStatusSuffix}`;
		} else if (result.reason === "config") {
			message = "License verification is temporarily unavailable due to plugin configuration. Please contact support.";
		} else if (isNetworkFailureReason(result.reason)) {
			message = backendMessage || message;
		}
		setStatus(message, result.reason || "error");
		await ps.app.showAlert(message);
	}

	await updateState();
}

export async function updateState() {
	if (!licenseV2Config.enabled) {
		showSlidersSection();
		return true;
	}

	const token = await checkLocalToken();
	if (token) {
		setStatus("Activated.", "success");
		showSlidersSection();
	} else {
		const localFailure = getLastLocalLicenseFailure();
		if (localFailure && isNetworkFailureReason(localFailure.reason)) {
			setStatus(
				localFailure.message || "Could not reach the licensing server. Please check your connection and try again.",
				"network_error"
			);
		}
		showLicSection();
	}
	return !!token;
}

async function loop() {
	if (!licenseV2Config.enabled) {
		await updateState();
		console.log("[Licensing] License gate disabled by DOR_LICENSE_ENABLED=false.");
		return;
	}

	console.log("[Plugin] loop started... checking license...");
	const isValid = await updateState();
	console.log(`Result of checkLocalToken: ${JSON.stringify({ isValid })}`);
	setTimeout(loop, 1000 * (process.env.NODE_ENV === "development" ? 10 : 60 * 5));
}

export function initialize() {
	addEventListener("load", handleWindowLoad);

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", bindUI, { once: true });
		return;
	}

	bindUI();
}
