const { parse } = require("@babel/parser");
const t = require("@babel/types");

const FAKE_NAMES = [
	"decryptToken",
	"verifyHash",
	"checkSignature",
	"syncLicense",
	"collectMetrics",
	"logToAudit",
	"updateCache",
	"obfuscatePointer"
];

const FAKE_BODIES = [
	`try { const token = JSON.parse(atob(input)); return token?.payload ?? null; } catch (e) { console.warn("Invalid token", e); return null; }`,
	`let attempts = 0; while (attempts++ < 3) { const result = Math.random() > 0.5; if (result) return true; } return false;`,
	`const logs = []; for (let i = 0; i < 5; i++) { logs.push("log_" + i + "_" + input); } return logs;`,
	`try { const token = JSON.parse(atob(input)); return token?.payload ?? null; } catch (e) { console.warn("Invalid token", e); return null; }`,
	`try { const token = JSON.parse(atob(input)); return token?.payload ?? null; } catch (e) { console.warn("Invalid token", e); return null; }`,
	`if (!input) return false; const hash = crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)); return hash;`,
	`return input.split("").reverse().join("") + "::obfuscated";`,
	`const logs = []; for (let i = 0; i < 5; i++) { logs.push("log_" + i + "_" + input); } return logs;`,
	`const logs = []; for (let i = 0; i < 5; i++) { logs.push("log_" + i + "_" + input); } return logs;`,
	`return input.split("").reverse().join("") + "::obfuscated";`,
	`const logs = []; for (let i = 0; i < 5; i++) { logs.push("log_" + i + "_" + input); } return logs;`,
	`if (!input) return false; const hash = crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)); return hash;`,
	`const cacheKey = "__cache_" + input; localStorage.setItem(cacheKey, "cached_" + Date.now()); return true;`,
	`const parts = input.split("."); return parts.length > 1 ? parts.pop() : "";`,
	`return input.split("").reverse().join("") + "::obfuscated";`,
	`const value = parseFloat(input); if (isNaN(value)) return 0; return Math.round(value * 100) / 100;`,
	`const parts = input.split("."); return parts.length > 1 ? parts.pop() : "";`,
	`let attempts = 0; while (attempts++ < 3) { const result = Math.random() > 0.5; if (result) return true; } return false;`,
	`const logs = []; for (let i = 0; i < 5; i++) { logs.push("log_" + i + "_" + input); } return logs;`,
	`if (!input) return false; const hash = crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)); return hash;`,
	`try { const token = JSON.parse(atob(input)); return token?.payload ?? null; } catch (e) { console.warn("Invalid token", e); return null; }`,
	`return input.split("").reverse().join("") + "::obfuscated";`,
	`const logs = []; for (let i = 0; i < 5; i++) { logs.push("log_" + i + "_" + input); } return logs;`,
	`if (typeof input !== "string") { throw new TypeError("Expected string"); } return btoa(input);`,
	`let attempts = 0; while (attempts++ < 3) { const result = Math.random() > 0.5; if (result) return true; } return false;`,
	`const value = parseFloat(input); if (isNaN(value)) return 0; return Math.round(value * 100) / 100;`,
	`const parts = input.split("."); return parts.length > 1 ? parts.pop() : "";`,
	`try { const token = JSON.parse(atob(input)); return token?.payload ?? null; } catch (e) { console.warn("Invalid token", e); return null; }`,
	`if (typeof input !== "string") { throw new TypeError("Expected string"); } return btoa(input);`,
	`const logs = []; for (let i = 0; i < 5; i++) { logs.push("log_" + i + "_" + input); } return logs;`,
	`const logs = []; for (let i = 0; i < 5; i++) { logs.push("log_" + i + "_" + input); } return logs;`,
	`const value = parseFloat(input); if (isNaN(value)) return 0; return Math.round(value * 100) / 100;`,
	`const logs = []; for (let i = 0; i < 5; i++) { logs.push("log_" + i + "_" + input); } return logs;`,
	`return input.split("").reverse().join("") + "::obfuscated";`,
	`const parts = input.split("."); return parts.length > 1 ? parts.pop() : "";`,
	`const logs = []; for (let i = 0; i < 5; i++) { logs.push("log_" + i + "_" + input); } return logs;`,
	`const cacheKey = "__cache_" + input; localStorage.setItem(cacheKey, "cached_" + Date.now()); return true;`,
	`if (!input) return false; const hash = crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)); return hash;`,
	`return input.split("").reverse().join("") + "::obfuscated";`,
	`const logs = []; for (let i = 0; i < 5; i++) { logs.push("log_" + i + "_" + input); } return logs;`,
	`const parts = input.split("."); return parts.length > 1 ? parts.pop() : "";`,
	`const cacheKey = "__cache_" + input; localStorage.setItem(cacheKey, "cached_" + Date.now()); return true;`,
	`try { const token = JSON.parse(atob(input)); return token?.payload ?? null; } catch (e) { console.warn("Invalid token", e); return null; }`,
	`if (!input) return false; const hash = crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)); return hash;`,
	`const logs = []; for (let i = 0; i < 5; i++) { logs.push("log_" + i + "_" + input); } return logs;`,
	`const value = parseFloat(input); if (isNaN(value)) return 0; return Math.round(value * 100) / 100;`,
	`let attempts = 0; while (attempts++ < 3) { const result = Math.random() > 0.5; if (result) return true; } return false;`,
	`return input.split("").reverse().join("") + "::obfuscated";`,
	`if (typeof input !== "string") { throw new TypeError("Expected string"); } return btoa(input);`,
	`const value = parseFloat(input); if (isNaN(value)) return 0; return Math.round(value * 100) / 100;`,
	`return input.split("").reverse().join("") + "::obfuscated";`,
	`const parts = input.split("."); return parts.length > 1 ? parts.pop() : "";`
];

function getRandomInt(max) {
	return Math.floor(Math.random() * max);
}

function createFakeFunction(name) {
	const bodyCode = FAKE_BODIES[getRandomInt(FAKE_BODIES.length)];
	const wrapped = parse(`function temp(input) { ${bodyCode} }`, {
		sourceType: "module"
	});

	const body = wrapped.program.body[0].body.body;

	const func = t.functionDeclaration(t.identifier(name), [t.identifier("input")], t.blockStatement(body));
	return func;
}

function insertFakeFunctions(ast, count = 2) {
	const body = ast.program.body;
	const insertedNames = [];

	for (let i = 0; i < count; i++) {
		const name = FAKE_NAMES[getRandomInt(FAKE_NAMES.length)] + "_" + Math.random().toString(36).slice(2, 6);
		const funcNode = createFakeFunction(name);

		const insertIndex = getRandomInt(body.length + 1);
		body.splice(insertIndex, 0, funcNode);
		insertedNames.push(name);
	}

	return insertedNames;
}

function transformInjectFakeFunctions(ast, fakeCount = 3) {
	const insertedNames = insertFakeFunctions(ast, fakeCount);
	return insertedNames;
}

module.exports = {
	transformInjectFakeFunctions
};
