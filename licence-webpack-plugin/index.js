const loader = require("./loader");
// const { sources } = require("webpack");

module.exports = class DoronLicenceWebpackPlugin {
	constructor(options) {
		this.options = options;
	}
	apply(compiler) {
		const pluginName = DoronLicenceWebpackPlugin.name;
		const { webpack } = compiler;
		const { Compilation } = webpack;
		const { RawSource } = webpack.sources;
		compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
			compilation.hooks.processAssets.tapPromise(
				{
					name: pluginName,
					stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
				},
				async (assets) => {
					for (let name in assets) {
						if (/\.js$/.test(name)) {
							const patched = await loader(assets[name].source());
							compilation.updateAsset(name, new RawSource(patched));
						}
					}
				}
			);
		});
	}
};
