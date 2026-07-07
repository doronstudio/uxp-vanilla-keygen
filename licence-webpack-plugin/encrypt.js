const crypto = require("crypto");

const IV_LENGTH = 16;

function encryptString(payload, key) {
	const iv = crypto.randomBytes(IV_LENGTH);
	const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
	let encrypted = cipher.update(payload, "utf8");
	encrypted = Buffer.concat([encrypted, cipher.final()]);

	console.log(`🔒 [loader] Encrypted "${payload}" →`, {
		iv: iv.toString("base64"),
		data: encrypted.toString("base64")
	});

	return {
		iv: iv.toString("base64"),
		data: encrypted.toString("base64")
	};
}

module.exports = {
	encryptString
};
