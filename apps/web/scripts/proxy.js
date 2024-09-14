const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const path = require("path");
const openNextOutput = require("../.open-next/open-next.output.json");

const publicFolderAssets = openNextOutput.behaviors.filter(
  (behavior) =>
    behavior.origin === "s3" && !behavior.pattern.startsWith("_next")
);

const STATIC_ASSETS_PATH = path.join(__dirname, "../.open-next/assets");

const app = express();

const options = {
  target: "http://localhost:3000",
  changeOrigin: true,
};

const proxy = createProxyMiddleware(options);
publicFolderAssets.forEach((behavior) => {
  app.use(
    `/${behavior.pattern}`,
    express.static(STATIC_ASSETS_PATH + behavior.pattern)
  );
});
app.use("/_next/static", express.static(STATIC_ASSETS_PATH + "/_next/static"));
app.use("/", proxy);

// Start the server
const PORT = 8080;
app.listen(PORT, () => {
  console.log(`preview server is running on http://localhost:${PORT}`);
});
