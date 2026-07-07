const { encryptString } = require("./encrypt");

// Main transform function
const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

function transformProtectedDataArrays(ast, key) {
	traverse(ast, {
		ArrayExpression(path) {
			const { node } = path;

			const hasProtectedComment =
				node.leadingComments && node.leadingComments.some((c) => c.value.includes("@protected-data"));

			if (!hasProtectedComment) return;

			try {
				// Use code generation + eval to get actual JS object
				const code = require("@babel/generator").default(node).code;
				const arrayValue = eval(code); // WARNING: only for trusted input!
				const encrypted = encryptString(JSON.stringify(arrayValue), key);
				const decryptCall = t.callExpression(t.memberExpression(t.identifier("JSON"), t.identifier("parse")), [
					t.awaitExpression(
						t.callExpression(t.identifier("__decryptData"), [
							t.objectExpression([
								t.objectProperty(t.identifier("data"), t.stringLiteral(encrypted.data)),
								t.objectProperty(t.identifier("iv"), t.stringLiteral(encrypted.iv))
							])
						])
					)
				]);

				path.replaceWith(decryptCall);
			} catch (err) {
				console.error("Error encrypting @protected-data array:", err);
			}
		}
	});
}

module.exports = transformProtectedDataArrays;
