// Dynamic config layered on top of app.json.
// On EAS, the `GOOGLE_SERVICES_JSON` file env var is materialized to a path on
// the build server and exposed via process.env — we point googleServicesFile at it.
// Locally (env var unset) it falls back to the committed-out ./google-services.json.
export default ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ?? config.android.googleServicesFile,
  },
});
