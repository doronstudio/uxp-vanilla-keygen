const path = require("path");
const fs = require("fs");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const DotenvPlugin = require("dotenv-webpack");
const WebpackObfuscator = require("webpack-obfuscator");
const IS_PROD = process.env.NODE_ENV === "production";
const dotenvNode = require("dotenv");
const dotenvOpts = { path: IS_PROD ? "./.env.production" : "./.env.development" };

dotenvNode.config(dotenvOpts);

function envFlag(value, defaultValue) {
	if (value === undefined || value === null || String(value).trim() === "") return defaultValue;
	return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function normalizeVersion(value) {
	return String(value || "")
		.trim()
		.replace(/^[vV]/, "");
}

const manifestPath = path.join(__dirname, "public", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const envPluginVersion = normalizeVersion(process.env.PLUGIN_VERSION || "2.0");
const envPluginId = String(
	process.env.DOR_UXP_PLUGIN_ID || process.env.DOR_LICENSE_V2_PLUGIN_ID || manifest.id || ""
).trim();
const envPluginName = String(process.env.DOR_UXP_PLUGIN_NAME || manifest.name || "").trim();
const envPanelLabel = String(process.env.DOR_UXP_PANEL_LABEL || envPluginName || manifest.name || "").trim();
const obfuscateBuild = envFlag(process.env.DOR_BUILD_OBFUSCATE, true);

function buildManifest() {
	const nextManifest = JSON.parse(JSON.stringify(manifest));
	nextManifest.id = envPluginId || nextManifest.id;
	nextManifest.name = envPluginName || nextManifest.name;
	nextManifest.version = envPluginVersion || nextManifest.version;

	if (Array.isArray(nextManifest.entrypoints)) {
		nextManifest.entrypoints = nextManifest.entrypoints.map((entrypoint) => {
			if (entrypoint.type !== "panel") return entrypoint;
			return {
				...entrypoint,
				id: envPluginId || entrypoint.id,
				label: {
					...(entrypoint.label || {}),
					default: envPanelLabel || entrypoint.label?.default || envPluginName || nextManifest.name
				}
			};
		});
	}

	return JSON.stringify(nextManifest, null, 2);
}

module.exports = {
	mode: IS_PROD ? "production" : "development",
	entry: {
		app: path.join(__dirname, "src", "main.js")
	},
	target: "web",
	resolve: {
		extensions: [".js"],
		alias: {
			"@": path.resolve(__dirname, "src/")
		},
		fallback: {
			fs: false,
			tls: false,
			net: false,
			zlib: false,
			http: false,
			https: false,
			crypto: false
		}
	},
	devtool: IS_PROD || obfuscateBuild ? false : "source-map",
	externals: {
		uxp: "commonjs2 uxp",
		photoshop: "commonjs2 photoshop",
		os: "commonjs2 os",
		locales: "commonjs2 locales"
	},
	module: {
		rules: [
			{
				test: /\.js?$/,
				loader: path.resolve(__dirname, "licence-webpack-plugin", "loader.js")
			},
			{
				test: /\.(png|svg|jpg|gif|woff|woff2|eot|ttf|webp)$/,
				use: [
					{
						loader: "file-loader",
						options: {
							name: "[hash].[ext]",
							outputPath: "assets"
						}
					}
				]
			}
		]
	},
	output: {
		publicPath: "./",
		path: path.resolve(__dirname, "dist"),
		filename: "[name].[chunkhash].js",
		clean: true
	},
	optimization: {
		// splitChunks: {
		// 	cacheGroups: {
		// 		vendor: {
		// 			test: /[\\/]node_modules[\\/]/,
		// 			name: "vendors",
		// 			chunks: "all"
		// 		}
		// 	}
		// },
		minimize: IS_PROD,

		minimizer: [
			new TerserPlugin({
				terserOptions: {
					compress: {
						drop_console: IS_PROD,
						inline: 0,
						reduce_funcs: false
					}
				}
			})
		]
	},
	performance: {
		hints: false
	},
	plugins: [
		new DotenvPlugin({ ...dotenvOpts, systemvars: true }),
		new HtmlWebpackPlugin({
			template: path.join(__dirname, "public", "index.html")
		}),
		new CopyWebpackPlugin({
			patterns: [
				path.resolve(__dirname, "public", "index.css"),
				path.resolve(__dirname, "public", "license.css"),
				{
					from: path.resolve(__dirname, "public", "manifest.json"),
					to: "manifest.json",
					transform() {
						return buildManifest();
					}
				},
				{ from: path.resolve(__dirname, "public", "icons"), to: "icons" },
				{ from: path.resolve(__dirname, "public", "fonts"), to: "fonts" }
			]
		}),
		obfuscateBuild
			? new WebpackObfuscator(
					{
						compact: IS_PROD,
						debugProtection: IS_PROD,
						disableConsoleOutput: IS_PROD,
						rotateStringArray: true
					},
					["**/vendors.*.js"]
				)
			: null
	].filter(Boolean)
};
