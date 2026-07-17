import {
	checkLocalToken,
	checkServerLicense,
	getLastLocalLicenseFailure,
	isNetworkFailureReason
} from "./utils";
import licenseV2Config from "./config";
import ps from "photoshop";

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

let isInitialized = false;

function bindUI() {
	if (isInitialized) {
		return;
	}

	const serialElem = document.querySelector(".Serial");
	const verifyButton = document.querySelector("#VerifyButton");

	if (!serialElem || !verifyButton) {
		console.warn("[Licensing] UI not ready yet. Delaying license UI binding.");
		return;
	}

	isInitialized = true;
	serialElem.addEventListener("input", handleSerialInput);
	verifyButton.addEventListener("click", handleSubmit);
	setStatus("", "info");
	loop();
}

async function handleSubmit(evt) {
	evt?.preventDefault?.();

	const serialElem = document.querySelector(".Serial");
	const verifyButton = document.querySelector("#VerifyButton");

	const serial = getInputValue(serialElem);

	if (!serial) {
		await ps.app.showAlert("Please enter your new license key.");
		return;
	}

	setStatus("Validating license...", "validating");
	verifyButton?.classList?.add("is-validating");

	let result;
	try {
		result = await checkServerLicense(serial);
	} finally {
		verifyButton?.classList?.remove("is-validating");
	}

	if (result.success) {
		setStatus("Activated.", "success");
		await ps.app.showAlert("Activation successful.");
		clearInput(serialElem);
	} else {
		const backendMessage = normalizeUserMessage(result.message);
		const httpStatusSuffix = result.status ? ` (HTTP ${result.status})` : "";
		let message = "Could not contact the license server. Please check your internet/VPN/firewall and try again.";

		if (["suspended", "expired", "machine_limit", "product_mismatch"].includes(result.reason)) {
			message = backendMessage || message;
		} else if (result.reason === "invalid") {
			message = backendMessage || "Invalid license key.";
		} else if (
			[
				"server_error",
				"invalid_json_response",
				"response_read_error"
			].includes(result.reason)
		) {
			message =
				backendMessage || `The license server returned an unexpected response. Please try again shortly or contact support.${httpStatusSuffix}`;
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
