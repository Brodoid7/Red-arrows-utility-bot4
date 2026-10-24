// Run with:  node check.js      (or double-click check.bat)
// Logs in, then reports everything that can stop slash commands from working.
const fs = require('fs'), path = require('path');
try { for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch {}
const out = []; const say = (...a) => { const t = a.join(' '); out.push(t); console.log(t); };
say('Node', process.version);
let djs; try { djs = require('discord.js'); say('discord.js', require('discord.js/package.json').version); } catch (e) { say('❌ discord.js is not installed. Run:  npm install'); process.exit(1); }
if (!process.env.DISCORD_TOKEN) { say('❌ No DISCORD_TOKEN found. Put it in a file named .env next to this script:  DISCORD_TOKEN=your-token'); process.exit(1); }
const { Client, GatewayIntentBits: I, Events } = djs;
const client = new Client({ intents: [I.Guilds, I.GuildMembers, I.GuildMessages, I.MessageContent, I.GuildVoiceStates, I.DirectMessages, I.GuildMessageReactions, I.GuildModeration] });
const NEEDED = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'ManageChannels', 'ManageRoles', 'ManageMessages', 'BanMembers', 'KickMembers', 'ModerateMembers', 'ViewAuditLog', 'ManageNicknames', 'MoveMembers'];
client.once(Events.ClientReady, async () => {
  say(`✅ Logged in as ${client.user.tag} (the bot is able to connect)`);
  say(`The bot is in ${client.guilds.cache.size} server(s).`);
  if (!client.guilds.cache.size) say('❌ The bot is not in any server. Re-invite it with the link printed when the bot starts (scope: bot + applications.commands).');
  try { const g = await client.application.commands.fetch(); say(`Global commands registered: ${g.size} (should be 0 — they are registered per server)`); } catch (e) { say('Could not read global commands:', e.message); }
  for (const guild of client.guilds.cache.values()) {
    say(`\n── ${guild.name} ──`);
    const me = guild.members.me; const miss = me.permissions.missing(NEEDED);
    say(miss.length ? `⚠️ Missing permissions: ${miss.join(', ')}` : '✅ Has every permission the bot needs');
    say(me.roles.highest.id === guild.roles.highest.id ? '✅ Bot role is the highest role' : '⚠️ Bot role is NOT the highest role (drag it to the top)');
    try {
      const cmds = await guild.commands.fetch(); say(`Slash commands registered here: ${cmds.size}`);
      const tr = cmds.find(c => c.name === 'training');
      if (!tr) say('❌ /training is NOT registered in this server (start the bot once and wait for "Registered … commands")');
      else { const create = tr.options.find(o => o.name === 'create'); say('/training create options:', (create?.options || []).map(o => o.name).join(', ')); say((create?.options || []).some(o => o.name === 'location') ? '✅ /training is the latest version' : '⚠️ /training is an OLD version — restart the bot with the newest redarrows.js so it re-registers'); }
    } catch (e) { say('❌ Could not read the commands in this server:', e.message, e.code === 50001 ? '→ re-invite the bot with the applications.commands scope' : ''); }
  }
  say('\nDone. Copy everything above and send it to whoever is helping you.');
  try { fs.writeFileSync(path.join(__dirname, 'check-result.txt'), out.join('\n')); console.log('(also saved to check-result.txt)'); } catch {}
  process.exit(0);
});
client.login(process.env.DISCORD_TOKEN).catch(e => {
  say('❌ LOGIN FAILED:', e.message);
  if (/disallowed intents/i.test(e.message)) say('→ Developer Portal → Bot → turn ON "Server Members Intent" and "Message Content Intent", Save, then run this again.');
  else say('→ The token is wrong or was reset. Developer Portal → Bot → Reset Token, then put the new one in .env');
  try { fs.writeFileSync(path.join(__dirname, 'check-result.txt'), out.join('\n')); } catch {}
  process.exit(1);
});
