import * as fs from "fs";
import archiver from "archiver";

export async function zipFolder(
  sourceDir: string,
  outPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(`Created zip file: ${outPath} (${archive.pointer()} bytes)`);
      resolve();
    });

    archive.on("error", (err: unknown) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}
