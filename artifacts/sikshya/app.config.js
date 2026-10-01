// A separate route tree and export keep the private desk out of the public app's bundle.
// Native and participant builds remain unchanged unless explicitly building the desk.
module.exports = ({ config }) => {
  if (process.env.OPERATOR_BUILD !== "1") return config;
  return {
    ...config,
    name: "Fadko Desk",
    web: { ...config.web, name: "Fadko Desk", shortName: "Fadko Desk" },
    extra: { ...config.extra, router: { ...config.extra?.router, root: "./app-operator" } },
    plugins: (config.plugins ?? []).map((plugin) => {
      if (plugin === "expo-router") return ["expo-router", { root: "./app-operator" }];
      if (Array.isArray(plugin) && plugin[0] === "expo-router") {
        return ["expo-router", { ...plugin[1], root: "./app-operator" }];
      }
      return plugin;
    }),
  };
};
