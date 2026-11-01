window.onload = function() {
  //<editor-fold desc="Changeable Configuration Block">

  // Static offline docs: committed Beacon OpenAPI (regenerate with
  // python3 scripts/export_openapi.py). Live server also exposes /docs
  // and /openapi.json from FastAPI.
  window.ui = SwaggerUIBundle({
    url: "./rnaget-beacon-schema.yaml",
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [
      SwaggerUIBundle.presets.apis,
      SwaggerUIStandalonePreset
    ],
    plugins: [
      SwaggerUIBundle.plugins.DownloadUrl
    ],
    layout: "StandaloneLayout"
  });

  //</editor-fold>
};
