#!/usr/bin/env node
// One-time interactive OAuth2 setup: run `node src/tools/googleAuth.js`,
// open the printed URL, approve access, then paste the `code` query
// param from the redirected (even if unreachable) URL back here.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { google } = require('googleapis');
const config = require('../config');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

async function main() {
  if (!config.googleClientId || !config.googleClientSecret) {
    console.error(
      'Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env. Create an OAuth2 ' +
        '"Desktop app" credential in Google Cloud Console with the Calendar API enabled first.'
    );
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('\n1. Open this URL in a browser and approve access:\n');
  console.log(authUrl);
  console.log(
    '\n2. You will land on a page that may fail to load (that\'s expected) - copy the ' +
      '"code" value from that page\'s URL.\n'
  );

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise((resolve) => rl.question('Paste the code here: ', resolve));
  rl.close();

  const { tokens } = await oauth2Client.getToken(code.trim());

  const tokenPath = config.googleTokenPath;
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));

  console.log(`\nSaved token to ${tokenPath}. Google Calendar is now linked.`);
}

main().catch((err) => {
  console.error('Google auth failed:', err.message);
  process.exit(1);
});
