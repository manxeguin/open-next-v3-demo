import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as fsExtra from "fs-extra";

const relativeFolderPath = path.join(__dirname, "../config");

export const prepareCustomServerFolder = async (appDir: string) => {
  const customServerPath = path.join(appDir, ".custom-server");

  // Create the .custom-server folder if it doesn't exist
  if (!fs.existsSync(customServerPath)) {
    fs.mkdirSync(customServerPath);
  }

  // Copy the contents of the relative folder to the .custom-server folder
  await fsExtra.copy(relativeFolderPath, customServerPath);
};
export const openNextBuild = async (appDir: string, debug = false) => {
  await prepareCustomServerFolder(appDir);

  return new Promise<void>((resolve, reject) => {
    const debugOptions = debug ? { OPEN_NEXT_DEBUG: "true" } : {};
    console.log("Building app in", appDir);
    const build = spawn(
      "npx",
      [
        "open-next@3.1.2",
        "build",
        "--config-path",
        ".custom-server/open-next.config.ts",
      ],
      {
        cwd: appDir,
        env: { ...process.env, ...debugOptions },
      }
    );

    build.stdout.on("data", (data) => {
      console.log(`${data}`);
    });

    build.stderr.on("data", (data) => {
      console.error(`${data}`);
    });

    build.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`build process exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
};
