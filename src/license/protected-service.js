let protectedFunctions = {};
let _masterKey = null;
import CryptoJS from "crypto-js";
import { clearAll, getDecodedToken, getDeviceUniqueId } from "./utils.js";
import { updateState } from "./ui.js";
import ps from "photoshop";
import licenseV2Config, { allowsKeygen } from "./config.js";
import { checkStoredKeygenActivation } from "./keygen-service.js";

let encMasterKeyJson = null;
let userEmail = null;

export function resetReusableData() {
	_masterKey = null;
	encMasterKeyJson = null;
	userEmail = null;
}

function decryptMasterKey(userData, encJson) {
	const salt = CryptoJS.enc.Base64.parse(encJson.salt);
	const iv = CryptoJS.enc.Base64.parse(encJson.iv);
	const encryptedData = CryptoJS.enc.Base64.parse(encJson.data);

	const key = CryptoJS.PBKDF2(userData, salt, {
		keySize: 256 / 32,
		iterations: 10000,
		hasher: CryptoJS.algo.SHA256
	});

	const decrypted = CryptoJS.AES.decrypt({ ciphertext: encryptedData }, key, {
		iv: iv,
		mode: CryptoJS.mode.CBC,
		padding: CryptoJS.pad.Pkcs7
	});

	return decrypted;
}

function getConfiguredObfuscationKey() {
	if (!licenseV2Config.obfuscation_key) {
		return null;
	}

	return CryptoJS.SHA256(licenseV2Config.obfuscation_key);
}

async function __decryptData(enc) {
	const validToken = await getDecodedToken();
	let validKeygenActivation = false;

	if (!validToken && allowsKeygen()) {
		const fingerprint = await getDeviceUniqueId();
		validKeygenActivation = await checkStoredKeygenActivation(fingerprint);
	}

	if (validToken || validKeygenActivation) {
		if (!_masterKey) {
			_masterKey = getConfiguredObfuscationKey();

			if (!_masterKey && encMasterKeyJson) {
				const deviceid = await getDeviceUniqueId();
				_masterKey = decryptMasterKey([userEmail, deviceid].join(""), encMasterKeyJson);
			}
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

export function setReusableData(encJson, email) {
	encMasterKeyJson = encJson;
	userEmail = email;
}

export default function (data) {
	protectedFunctions = { ...protectedFunctions, ...data };
	getDecodedToken().then((token) => {
		const protectedPayload = token?.protected_payload || token?.key;
		if (token && protectedPayload) {
			setReusableData(protectedPayload, token.email || token.sub);
			return;
		}
	});

	return {
		__callProtectedFunction,
		__decryptData
	};
}
