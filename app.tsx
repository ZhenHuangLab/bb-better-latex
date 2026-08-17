import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountLatex } from "./src/mount";
import "./app.css";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "render",
    mount: mountLatex,
  });
});
