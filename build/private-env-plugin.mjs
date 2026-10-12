// Local configuration belongs only to the Worker runtime. Cloudflare can emit a
// .dev.vars preview snapshot during builds; never include it in deployable output.
export function privateEnvironment() {
  return {
    name: "private-server-environment",
    enforce: "post",
    config() { return { envPrefix: [] }; },
    generateBundle(_options, bundle) {
      for (const file of Object.keys(bundle)) {
        const basename = file.split(/[\\/]/).at(-1);
        if (/^\.(?:env|dev\.vars)(?:\.|$)/.test(basename)) delete bundle[file];
      }
    },
  };
}
