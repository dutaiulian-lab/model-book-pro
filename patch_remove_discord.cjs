const fs = require('fs');
let code = fs.readFileSync('scripts/screener-cron.mjs', 'utf8');

// Remove sendDiscordAlert definition
const regex = /async function sendDiscordAlert\(matches\) \{[\s\S]*?\}\n\n/m;
code = code.replace(regex, '');

// Remove sendDiscordAlert usage
const usageRegex = /    if \(finalMatches\.length > 0\) \{\n        await sendDiscordAlert\(finalMatches\);\n    \}\n/m;
code = code.replace(usageRegex, '');

fs.writeFileSync('scripts/screener-cron.mjs', code);
