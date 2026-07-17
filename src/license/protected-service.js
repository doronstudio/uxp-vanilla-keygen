let protectedFunctions = {};
let _masterKey = null;
import CryptoJS from "crypto-js";
import { clearAll, getDeviceUniqueId } from "./utils.js";
import { updateState } from "./ui.js";
import ps from "photoshop";
import licenseV2Config from "./config.js";
import { checkStoredKeygenActivation } from "./keygen-service.js";

export function resetReusableData() {
	_masterKey = null;
}

function getConfiguredObfuscationKey() {
	if (!licenseV2Config.obfuscation_key) {
		return null;
	}

	return CryptoJS.SHA256(licenseV2Config.obfuscation_key);
}

async function __decryptData(enc) {
	const fingerprint = await getDeviceUniqueId();
	const validKeygenActivation = await checkStoredKeygenActivation(fingerprint);

	if (validKeygenActivation) {
		if (!_masterKey) {
			_masterKey = getConfiguredObfuscationKey();
		}

		if (!_masterKey) {
			return "";
		}

		const encryptedData = CryptoJS.enc.Base64.parse(enc.data);
		const iv = CryptoJS.enc.Base64.parse(enc.iv);

		const decrypted = CryptoJS.AES.decrypt({ ciphertext: encryptedData }, _masterKey, {
			iv: iv,
			mode: CryptoJS.mode.CBC,
			padding: CryptoJS.pad.Pkcs7
		});

		return decrypted.toString(CryptoJS.enc.Utf8);
	}

	return "";
}

async function __call(enc, args) {
	args = args || [];

	const functionName = await __decryptData(enc);

	if (!functionName) {
		await clearAll();
		await updateState();
		await ps.app.showAlert("Please enter valid licence info.");
		return;
	}

	const fn = protectedFunctions[functionName];
	if (!fn) throw new Error(`Function "${functionName}" not found`);

	const result = fn(...args);

	return result;
}

function __callProtectedFunction(enc, args) {
	return __call(enc, args);
}

export default function (data = {}) {
	protectedFunctions = { ...protectedFunctions, ...data };

	return {
		__callProtectedFunction,
		__decryptData
	};
}
