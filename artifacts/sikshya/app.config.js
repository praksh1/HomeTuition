// The operator desk is a separate web bundle, not a hidden route in the public app.
// Keep the ordinary iOS/Android and student/teacher web config unchanged by default.
module.exports = ({ config }) => {
  if (process.env.OPERATOR_BUILD !== "1") return config;
  return {
    ...config,
    name: "Fadko Desk",
    web: { ...config.web, name: "Fadko Desk", shortName: "Fadko Desk" },
    extra: { ...config.extra, router: { ...config.extra?.router, root: "./app-operator" } },
    plugins: (config.plugins ?? []).map((plugin) =>
      plugin === "expo-router" ? ["expo-router", { root: "./app-operator" }] : plugin,
    ),
  };
};
