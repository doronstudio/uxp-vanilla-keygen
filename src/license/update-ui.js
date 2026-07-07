import { shell } from "uxp";

let currentUpdateStatus = null;

function ensureUpdateNotice() {
	let notice = document.getElementById("UpdateNotice");
	if (notice) return notice;

	notice = document.createElement("section");
	notice.id = "UpdateNotice";
	notice.className = "update-notice";
	notice.setAttribute("aria-live", "polite");
	notice.innerHTML = `
		<div class="update-notice__inner">
			<div class="update-notice__copy">
				<strong class="update-notice__title">Update available</strong>
				<p class="update-notice__message"></p>
				<p class="update-notice__version"></p>
			</div>
			<div class="update-notice__actions">
				<a class="update-notice__button" href="#">Download update</a>
				<button class="update-notice__dismiss" type="button" aria-label="Dismiss update notice">Dismiss</button>
			</div>
		</div>
	`;

	const container = document.getElementById("MainContainer") || document.body;
	container.appendChild(notice);

	notice.querySelector(".update-notice__button")?.addEventListener("click", (evt) => {
		evt.preventDefault();
		openUpdateUrl(currentUpdateStatus?.download_url);
	});
	notice.querySelector(".update-notice__dismiss")?.addEventListener("click", () => {
		if (currentUpdateStatus?.required) return;
		hideUpdateNotice();
	});

	return notice;
}

function openUpdateUrl(url) {
	const safeUrl = String(url || "").trim();
	if (!/^https?:\/\//i.test(safeUrl)) return;

	try {
		shell.openExternal(safeUrl);
	} catch (err) {
		console.warn("[Updates] Could not open update URL.", err);
	}
}

function hideUpdateNotice() {
	document.body.classList.remove("update-blocked");
	const notice = document.getElementById("UpdateNotice");
	if (notice) notice.style.display = "none";
}

function versionText(status) {
	const latest = status.latest_version ? `Latest: ${status.latest_version}` : "";
	const minimum = status.minimum_supported_version ? `Minimum supported: ${status.minimum_supported_version}` : "";
	return [latest, minimum].filter(Boolean).join(" / ");
}

export function renderUpdateStatus(status) {
	if (!status?.update_available) {
		currentUpdateStatus = null;
		hideUpdateNotice();
		return;
	}

	currentUpdateStatus = status;
	const notice = ensureUpdateNotice();
	const title = notice.querySelector(".update-notice__title");
	const message = notice.querySelector(".update-notice__message");
	const version = notice.querySelector(".update-notice__version");
	const dismiss = notice.querySelector(".update-notice__dismiss");
	const button = notice.querySelector(".update-notice__button");

	notice.style.display = "";
	notice.setAttribute("data-required", status.required ? "true" : "false");
	if (title) title.textContent = status.required ? "Update required" : "Update available";
	if (message) message.textContent = status.message || "A new version of this plugin is available.";
	if (version) version.textContent = versionText(status);
	if (dismiss) dismiss.style.display = status.required ? "none" : "";
	if (button) {
		button.style.display = status.download_url ? "" : "none";
		button.textContent = status.required ? "Update now" : "Download update";
	}

	document.body.classList.toggle("update-blocked", !!status.required);
}
