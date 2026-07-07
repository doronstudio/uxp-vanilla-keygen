const crypto = require("crypto");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const { transformInjectFakeFunctions } = require("./noise");
const { encryptString } = require("./encrypt");
const transformProtectedDataArrays = require("./protected-data.js");

function sourceUsesProtectedPayloads(source) {
	return source.includes("@protected-call") || source.includes("@protected-data");
}

function getProtectedPayloadKey(source) {
	if (!sourceUsesProtectedPayloads(source)) {
		return null;
	}

	if (process.env.DOR_LICENSE_V2_OBFUSCATION_KEY) {
		return crypto.createHash("sha256").update(process.env.DOR_LICENSE_V2_OBFUSCATION_KEY, "utf8").digest();
	}

	throw new Error("Protected payloads require per-plugin DOR_LICENSE_V2_OBFUSCATION_KEY.");
}

module.exports = async function (source) {
	const masterKey = getProtectedPayloadKey(source);

	const ast = parser.parse(source, {
		sourceType: "module",
		attachComment: true
	});

	const protectedMap = {};

	function getFunctionName(callee) {
		if (t.isIdentifier(callee)) {
			return callee.name;
		} else if (t.isMemberExpression(callee)) {
			const objectName = t.isIdentifier(callee.object) ? callee.object.name : generate(callee.object).code;
			const propertyName = t.isIdentifier(callee.property)
				? callee.property.name
				: `[${generate(callee.property).code}]`;
			return `${objectName}.${propertyName}`;
		} else {
			return "anonymous";
		}
	}

	traverse(ast, {
		ExpressionStatement(path) {
			const { node } = path;

			const comments = node.leadingComments;
			if (!comments) return;

			const hasProtected = comments.some((comment) => comment.value.trim() === "@protected-call");

			if (!hasProtected) return;

			let callExpr = null;

			if (t.isAwaitExpression(node.expression) && t.isCallExpression(node.expression.argument)) {
				callExpr = node.expression.argument;
			} else if (t.isCallExpression(node.expression)) {
				callExpr = node.expression;
			}

			if (callExpr) {
				const funcName = getFunctionName(callExpr.callee);
				if (!funcName) return;

				const id = crypto.randomUUID();
				const encrypted = encryptString(id, masterKey);
				protectedMap[id] = funcName;

				const newCall = t.callExpression(t.identifier("__callProtectedFunction"), [
					t.objectExpression([
						t.objectProperty(t.identifier("data"), t.stringLiteral(encrypted.data)),
						t.objectProperty(t.identifier("iv"), t.stringLiteral(encrypted.iv))
					]),
					t.arrayExpression(callExpr.arguments)
				]);

				const finalExpr = t.isAwaitExpression(node.expression) ? t.awaitExpression(newCall) : newCall;
				path.get("expression").replaceWith(finalExpr);
			}
		}
	});

	const globalFunctionNames = transformInjectFakeFunctions(ast, 100);

	traverse(ast, {
		VariableDeclarator(path) {
			const init = path.node.init;

			if (
				t.isCallExpression(init) &&
				(init.leadingComments || []).some((comment) => comment.value.trim() === "@entry-function")
			) {
				const props = Object.keys(protectedMap).map((key) =>
					t.objectProperty(t.stringLiteral(key), t.identifier(protectedMap[key]))
				);

				globalFunctionNames.forEach((name) => {
					props.push(t.objectProperty(t.stringLiteral(crypto.randomUUID()), t.identifier(name), false, true));
				});

				init.arguments = [t.objectExpression(props)];
				init.leadingComments = init.leadingComments.filter((comment) => comment.value.trim() !== "@entry-function");
			}
		}
	});

	transformProtectedDataArrays(ast, masterKey);

	const output = generate(ast, {}, source);
	return output.code;
};
