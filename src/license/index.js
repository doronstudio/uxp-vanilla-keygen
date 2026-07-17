import { initialize, updateState } from "./ui";
import { entrypoints } from "uxp";
import ps from "photoshop";
import protection, { resetReusableData } from "./protected-service";
import { clearAll, getDeviceUniqueId } from "./utils";
import { emitLicenseEvent } from "./telemetry";
import { deactivateKeygenMachine, getStoredKeygenActivation } from "./keygen-service";
import { checkForPluginUpdate, clearUpdateCheckCache } from "./update-service";
import { renderUpdateStatus } from "./update-ui";
import { getAssignedItemId } from "./config";

function keygenDeactivationFailureMessage(result) {
	const detail = result?.message ? `\n\n${result.message}` : "";
	return [
		"Could not deactivate this device with the license server.",
		"Your local license data was not cleared, so this device should not be stranded against your activation limit.",
		"Please check your internet connection and try again.",
		detail
	].join("\n");
}

entrypoints.setup({
	commands: {
		async checkForUpdates() {
			const updateCheck = await checkForPluginUpdate({ bypassCache: true });
			if (updateCheck.success) {
				renderUpdateStatus(updateCheck.result);
				if (!updateCheck.result.update_available) {
					await ps.core.showAlert({ message: "UXP Vanilla Keygen Starter is up to date." });
				}
				return;
			}

			await ps.core.showAlert({
				message: "Could not check for updates right now. Please try again later."
			});
		},
		async clearLicense() {
			const deviceId = await getDeviceUniqueId();
			const keygenActivation = await getStoredKeygenActivation(deviceId);

			if (keygenActivation?.licenseKey && keygenActivation?.keygenMachineId) {
				const keygenDeactivation = await deactivateKeygenMachine(keygenActivation);
				if (!keygenDeactivation.success) {
					console.warn("[Licensing] Failed to deactivate Keygen machine =>", {
						reason: keygenDeactivation.reason,
						status: keygenDeactivation.status,
						keygen_license_id: keygenActivation.keygenLicenseId,
						keygen_machine_id: keygenActivation.keygenMachineId
					});
					await ps.core.showAlert({ message: keygenDeactivationFailureMessage(keygenDeactivation) });
					return;
				}
			}

			await clearAll();
			if (keygenActivation?.keygenLicenseId) {
				emitLicenseEvent("license.cleared", {
					provider: "keygen",
					device_id: deviceId,
					item_id: getAssignedItemId(),
					keygen_license_id: keygenActivation.keygenLicenseId,
					keygen_machine_id: keygenActivation.keygenMachineId,
					keygen_product_id: keygenActivation.keygenProductId,
					activation_expires_at: keygenActivation.expiresAt,
					offline: false
				});
			} else if (keygenActivation) {
				emitLicenseEvent("license.cleared", {
					provider: "keygen",
					device_id: deviceId,
					offline: false
				});
			}
			resetReusableData();
			await ps.core.showAlert({
				message: keygenActivation?.keygenLicenseId
					? "License deactivated on this device."
					: "License data cleared."
			});
			setTimeout(() => {
				updateState().catch((err) => {
					console.warn("[Licensing] Failed to refresh UI after clearing license =>", err);
				});
			}, 0);
		}
	}
});

initialize();
clearUpdateCheckCache();
checkForPluginUpdate({ bypassCache: true })
	.then((updateCheck) => {
		if (updateCheck.success) {
			renderUpdateStatus(updateCheck.result);
		}
	})
	.catch((err) => {
		console.warn("[Updates] Startup update check failed.", err);
	});

export default protection;
