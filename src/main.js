const licensePluginInit = require("./license/index").default;
const fs = require("uxp").storage.localFileSystem;

const { __callProtectedFunction, __decryptData } = /*@entry-function*/ licensePluginInit();

if (process.env.DOR_LOCAL_VERSION !== localStorage.getItem("DOR_LOCAL_VERSION")) {
	localStorage.clear();
	localStorage.setItem("DOR_LOCAL_VERSION", process.env.DOR_LOCAL_VERSION);
}

const pluginVersion = String(process.env.PLUGIN_VERSION || "1.0.0").trim() || "1.0.0";

async function readFontAsBase64(pluginFolder, formats, relPath) {
	const fontFile = await pluginFolder.getEntry(relPath);
	const buffer = await fontFile.read({ format: formats.binary });
	const bytes = new Uint8Array(buffer);
	let binary = "";
	const chunk = 8192;

	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}

	return btoa(binary);
}

async function loadBundledFonts() {
	const { formats } = require("uxp").storage;
	const pluginFolder = await fs.getPluginFolder();
	const rules = [];

	try {
		const b64 = await readFontAsBase64(pluginFolder, formats, "fonts/JetBrainsMono-Regular.ttf");
		rules.push(
			`@font-face{font-family:'JetBrains Mono';src:url("data:font/truetype;base64,${b64}")format('truetype');font-weight:normal;font-style:normal;font-display:block;}`
		);
	} catch (err) {
		console.log("[UXP Starter] JetBrains Mono load failed:", err?.message || err);
	}

	try {
		const b64 = await readFontAsBase64(pluginFolder, formats, "fonts/SpaceMono-Regular.woff");
		rules.push(
			`@font-face{font-family:'Space Mono';src:url("data:font/woff;base64,${b64}")format('woff');font-weight:normal;font-style:normal;font-display:block;}`
		);
	} catch (err) {
		console.log("[UXP Starter] Space Mono load failed:", err?.message || err);
	}

	if (!rules.length) return;

	const style = document.createElement("style");
	style.textContent = rules.join("");
	document.head.appendChild(style);
}

function renderPluginVersion() {
	document.querySelectorAll("[data-plugin-version]").forEach((el) => {
		el.textContent = pluginVersion;
	});
}

function bindStarterUI() {
	document.querySelector("#PrimaryAction")?.addEventListener("click", () => {
		document.querySelector("#PlayAreaStatus").textContent = "Build your first feature here.";
	});
}

function initializeStarterApp() {
	renderPluginVersion();
	bindStarterUI();
	loadBundledFonts().catch((err) => {
		console.warn("[UXP Starter] Font loading skipped.", err);
	});
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initializeStarterApp, { once: true });
} else {
	initializeStarterApp();
}
