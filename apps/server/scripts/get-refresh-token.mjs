// One-time helper to get a Google OAuth2 **refresh token** for the Drive queue
// backend (blueprint §4 — a user token, NOT a service account).
//
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/get-refresh-token.mjs
//
// Uses a loopback redirect, so create an OAuth client of type "Desktop app" in
// Google Cloud (see docs/google-drive-setup.md). Prints the refresh token to
// paste into your env / .env.
import http from "node:http";
import { google } from "googleapis";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = Number(process.env.OAUTH_PORT ?? 4300);
const REDIRECT = `http://localhost:${PORT}`;
// Full Drive scope: the server must see folders the user + Colab created, not
// just files it made itself (drive.file is too narrow for a shared queue).
const SCOPES = ["https://www.googleapis.com/auth/drive"];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the environment first.");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: "offline", // ask for a refresh token
  prompt: "consent", // force it even if previously granted
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("No ?code in redirect.");
    return;
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<h2>Done — you can close this tab and return to the terminal.</h2>");
    console.log("\n=== SUCCESS ===");
    if (tokens.refresh_token) {
      console.log("\nGOOGLE_REFRESH_TOKEN=" + tokens.refresh_token + "\n");
      console.log("Paste that into apps/server/.env (or your environment).");
    } else {
      console.log("No refresh_token returned. Revoke prior access at");
      console.log("https://myaccount.google.com/permissions and run this again.");
    }
  } catch (e) {
    res.writeHead(500).end("Token exchange failed: " + (e?.message ?? e));
    console.error(e);
  } finally {
    setTimeout(() => server.close(() => process.exit(0)), 500);
  }
});

server.listen(PORT, () => {
  console.log(`Listening on ${REDIRECT}`);
  console.log("\n1) Open this URL in your browser and grant access:\n");
  console.log(authUrl + "\n");
  console.log("2) After approving, the token prints here.\n");
});
