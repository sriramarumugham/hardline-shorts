// Bundle the shared Remotion composition into a static serve-url folder, zip it,
// and upload render-bundle.zip to the Drive queue root. The Colab worker unzips
// it and renders jobs with `remotion render <bundle> Reel ...` on Linux — no
// local ffmpeg, so it works while Smart App Control blocks the laptop's encoder.
//
//   node --env-file-if-exists=.env scripts/build-render-bundle.mjs
//
// Re-run whenever the composition (packages/composition) changes.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { google } from "googleapis";

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, DRIVE_ROOT_FOLDER_ID } = process.env;
for (const [k, v] of Object.entries({ GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, DRIVE_ROOT_FOLDER_ID })) {
  if (!v) throw new Error(`missing env ${k} (put it in apps/server/.env)`);
}

const require = createRequire(import.meta.url);
const entry = require.resolve("@factory/composition/remotion-entry");
console.log("bundling", entry, "...");
const outDir = await bundle({ entryPoint: entry });
console.log("bundled ->", outDir);

const zip = join(process.cwd(), "render-bundle.zip");
if (existsSync(zip)) rmSync(zip);
// Zip with PowerShell's Compress-Archive (reliable zip writer on Windows; the
// bundled bsdtar can't always write zip). Contents land at the archive root.
execFileSync(
  "powershell",
  ["-NoProfile", "-Command", `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zip}' -Force`],
  { stdio: "inherit" }
);
console.log("zipped ->", zip);

const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: "v3", auth });
const NAME = "render-bundle.zip";
const esc = (s) => s.replace(/'/g, "\\'");
const found = await drive.files.list({
  q: `'${DRIVE_ROOT_FOLDER_ID}' in parents and name = '${esc(NAME)}' and trashed = false`,
  fields: "files(id)",
});
const media = { mimeType: "application/zip", body: createReadStream(zip) };
if (found.data.files?.[0]?.id) {
  await drive.files.update({ fileId: found.data.files[0].id, media });
  console.log("updated", NAME, "in Drive");
} else {
  const r = await drive.files.create({
    requestBody: { name: NAME, parents: [DRIVE_ROOT_FOLDER_ID] },
    media,
    fields: "id",
  });
  console.log("created", NAME, r.data.id);
}
console.log("done.");
