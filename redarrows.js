'use strict';
/* ════════════════════════════════════════════════════════════════
   RED ARROWS TEAM BOT
   Anti-nuke • Roblox verification • Game stats & update alerts • Welcomer
   DM applications • Modmail • Automod • Logs • Raid shield • Utilities
   Zero config: put DISCORD_TOKEN in the environment (or a .env file)
   and run /setup in your server. No script edits required.
   ════════════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), crypto = require('crypto');

// ── tiny .env loader (no dependency) ────────────────────────────
try {
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) { console.error('Missing DISCORD_TOKEN. Set it in your environment or in a .env file next to index.js.'); process.exit(1); }

const {
  Client, GatewayIntentBits: I, Partials: P, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, SlashCommandBuilder,
  ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits: PF, ChannelType: CT,
  AttachmentBuilder, Events, MessageFlags, ActivityType, AuditLogEvent,
} = require('discord.js');

const BRAND = process.env.BRAND_NAME || 'Red Arrows';
const COLOR = 0xd7263d;
const INITIALS = BRAND.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4) || 'RA';

// ── persistence ─────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
const LOG_FILE = path.join(DATA_DIR, 'bot.log');
try { if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 2e6) fs.renameSync(LOG_FILE, LOG_FILE + '.old'); } catch {}
for (const k of ['log', 'warn', 'error']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { orig(...a); try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${k}] ${a.map(x => x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}\n`); } catch {} };
}
let DJS = 'unknown'; try { DJS = require('discord.js/package.json').version; } catch {}
if (/^1[5-9]|^[2-9]\d/.test(DJS)) console.error(`⚠️ This bot is written for discord.js 14 but ${DJS} is installed. Run:  npm install discord.js@14`);
let db = { meta: {}, guilds: {}, reminders: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch {}
let dirty = false, saveTimer = null;
function save() { dirty = true; if (!saveTimer) saveTimer = setTimeout(flush, 2000); }
function flush() {
  saveTimer = null; if (!dirty) return; dirty = false;
  try { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); }
  catch (e) { console.error('save failed', e); dirty = true; }
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { flush(); process.exit(0); });
process.on('unhandledRejection', e => console.error('unhandledRejection', e));
process.on('uncaughtException', e => console.error('uncaughtException', e));

db.global = Object.assign({ bans: {}, flags: {}, operators: [], n: 0, links: {} }, db.global);
db.global.links ||= {};
db.global.tz ||= {};
const DEF = () => ({
  settings: { staffRole: null, autoCloseHours: 48, starThreshold: 3, leveling: true, transcriptDM: true, anonymous: false, modmail: true, globalBans: true, channels: {},
    logs: {}, logIgnore: [],
    automod: { enabled: true, spam: true, spamCount: 5, spamSeconds: 6, invites: true, links: false, caps: false, mentions: true, mentionLimit: 5, words: false, scam: true, dupes: true, newLinks: true, wordList: [], exemptRoles: [], timeoutMin: 10 },
    escalation: [{ warns: 3, action: 'timeout', ms: 36e5 }, { warns: 5, action: 'kick' }, { warns: 7, action: 'ban' }],
    warnExpiryDays: 30,
    raid: { active: false, until: 0, auto: true, blocked: 0 },
    antinuke: { enabled: true, whitelist: [], windowSec: 30, punish: 'ban', restore: true, limits: { channelDelete: 2, channelCreate: 4, roleDelete: 2, roleCreate: 4, ban: 3, kick: 3, webhook: 2, perm: 1, botAdd: 1 } },
    verify: { mode: 'roblox', role: null, unverified: null, channel: null, kickHours: 24, minAccountDays: 0, nick: true },
    welcome: { enabled: true, channel: null, message: 'Welcome to **{server}**, {user}! 🎉\nYou are member **#{count}**. Head to {verify} to verify your Roblox account and unlock the server.', dm: true, banner: null, leaveChannel: null },
    game: { placeId: null, universeId: null, name: null, group: null, updatesChannel: null, statusChannel: null, lastUpdated: null, reviewChannel: null, updatesRole: null },
    rankRoles: [], drops: { enabled: true }, briefing: { channel: null, hour: 8, lastKey: '' }, stickyRoles: true,
    training: { channel: null, role: null, info: '• Be in the game and the voice channel **5 minutes early**\n• Follow your host\'s instructions at all times\n• Use a microphone if you have one\n• Keep chat clear and be respectful\n• Your attendance is logged and counts toward your rank' } },
  counters: { sugg: 0, case: 0 },
  threads: {}, blocked: {}, snippets: {}, history: {}, cases: [],
  forms: {}, subs: {}, cooldowns: {},
  levels: {}, levelRoles: {},
  giveaways: {}, polls: {},
  suggestions: {}, starboard: {}, bookmarks: {}, birthdays: {},
  autoroles: [], tempvoice: {}, afk: {}, lastBday: '',
  pilots: {}, events: {}, trainings: {}, mapUpdates: {}, squads: {}, medals: {}, stats: {}, sticky: {}, panic: null,
});
/** lazy per-guild state; missing keys are filled in so old data files keep working */
function G(id) {
  const g = db.guilds[id] || (db.guilds[id] = {}), d = DEF();
  if (!('_id' in g)) Object.defineProperty(g, '_id', { value: id, enumerable: false });
  for (const k in d) {
    if (g[k] === undefined) g[k] = d[k];
    else if (k === 'settings') for (const s in d.settings) if (g.settings[s] === undefined) g.settings[s] = d.settings[s];
  }
  return g;
}

// ── helpers ─────────────────────────────────────────────────────
const now = () => Date.now();
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const ts = (ms, f = 'R') => `<t:${Math.floor(ms / 1000)}:${f}>`;
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = rnd(0, i);[a[i], a[j]] = [a[j], a[i]]; } return a; };
function parseDuration(s) {
  if (!s) return null; let ms = 0, found = false;
  for (const m of String(s).toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*(w|d|h|m|s)/g)) { found = true; ms += parseFloat(m[1]) * { w: 6048e5, d: 864e5, h: 36e5, m: 6e4, s: 1e3 }[m[2]]; }
  return found ? Math.round(ms) : null;
}
function fmtDur(ms) {
  const p = []; let s = Math.floor(ms / 1000);
  for (const [n, l] of [[86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']]) if (s >= n) { p.push(Math.floor(s / n) + l); s %= n; }
  return p.slice(0, 3).join(' ') || '0s';
}
const E = (title, desc) => {
  const e = new EmbedBuilder().setColor(COLOR).setFooter({ text: BRAND }).setTimestamp();
  if (title) e.setTitle(clip(title, 256)); if (desc) e.setDescription(clip(desc, 4000)); return e;
};
const good = t => E(null, '✅ ' + t).setColor(0x2ecc71);
const bad = t => E(null, '❌ ' + t).setColor(0xed4245);
function rep(i, x, eph = true) {
  const o = typeof x === 'string' ? { embeds: [E(null, x)] } : x instanceof EmbedBuilder ? { embeds: [x] } : { ...x };
  if (i.deferred && !i.replied) { delete o.flags; return i.editReply(o); }
  if (eph) o.flags = MessageFlags.Ephemeral;
  return (i.replied || i.deferred) ? i.followUp(o) : i.reply(o);
}
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const btn = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const bar = (f, n = 12) => { const k = Math.max(0, Math.min(n, Math.round(f * n))); return '█'.repeat(k) + '░'.repeat(n - k); };
const isStaff = (m, g) => !!m && (m.permissions.has(PF.ManageMessages) || (g.settings.staffRole && m.roles.cache.has(g.settings.staffRole)));

// levels (MEE6-style curve)
const xpNeed = l => 5 * l * l + 50 * l + 100;
function lvl(total) { let l = 0, r = total; while (r >= xpNeed(l)) { r -= xpNeed(l); l++; } return { level: l, cur: r, need: xpNeed(l) }; }

// live activity (memory only) + raid risk
const activity = new Map();
const A = id => { let a = activity.get(id); if (!a) activity.set(id, a = { msgs: [], joins: [] }); return a; };
const prune = (arr, ms) => { const c = now() - ms; while (arr.length && arr[0].t < c) arr.shift(); };
function raidRisk(a) {
  const t = now(), j = a.joins.filter(x => x.t > t - 6e5), young = j.filter(x => x.young).length;
  const score = Math.min(100, j.length * 7 + young * 8);
  return { score, joins: j.length, young, label: score < 25 ? '🟢 Low' : score < 60 ? '🟡 Elevated' : '🔴 High' };
}

// ── client ──────────────────────────────────────────────────────
const client = new Client({
  intents: [I.Guilds, I.GuildMembers, I.GuildMessages, I.MessageContent, I.GuildMessageReactions, I.GuildVoiceStates, I.DirectMessages, I.GuildModeration],
  partials: [P.Channel, P.Message, P.Reaction, P.User, P.GuildMember],
});

client.on(Events.Error, e => console.error('client error', e));
client.on(Events.Warn, m => console.warn('client warn', m));
client.on(Events.ShardError, e => console.error('shard error', e));
client.on(Events.ShardDisconnect, ev => console.warn('shard disconnected', ev?.code));

// ── command definitions ─────────────────────────────────────────
const staff = PF.ManageMessages, admin = PF.ManageGuild;
const S = (n, d, perm) => { const b = new SlashCommandBuilder().setName(n).setDescription(d).setDMPermission(false); if (perm) b.setDefaultMemberPermissions(perm); return b; };
const O = {
  s: (n, d, r = false, a = false) => ['s', o => o.setName(n).setDescription(d).setRequired(r).setAutocomplete(a)],
  sc: (n, d, r, ch) => ['s', o => o.setName(n).setDescription(d).setRequired(r).addChoices(...ch.map(c => ({ name: c, value: c })))],
  u: (n, d, r = false) => ['u', o => o.setName(n).setDescription(d).setRequired(r)],
  n: (n, d, r = false, min, max) => ['n', o => { o.setName(n).setDescription(d).setRequired(r); if (min !== undefined) o.setMinValue(min); if (max !== undefined) o.setMaxValue(max); return o; }],
  b: (n, d, r = false) => ['b', o => o.setName(n).setDescription(d).setRequired(r)],
  c: (n, d, r = false) => ['c', o => o.setName(n).setDescription(d).setRequired(r).addChannelTypes(CT.GuildText, CT.GuildAnnouncement)],
  a: (n, d, r = false) => ['a', o => o.setName(n).setDescription(d).setRequired(r)],
  v: (n, d, r = false) => ['c', o => o.setName(n).setDescription(d).setRequired(r).addChannelTypes(CT.GuildVoice, CT.GuildStageVoice)],
  r: (n, d, r = false) => ['r', o => o.setName(n).setDescription(d).setRequired(r)],
};
const KIND = { s: 'addStringOption', u: 'addUserOption', n: 'addIntegerOption', b: 'addBooleanOption', c: 'addChannelOption', r: 'addRoleOption', a: 'addAttachmentOption' };
const add = (b, ...opts) => { for (const [t, f] of opts) b[KIND[t]](f); return b; };
const sub = (n, d, ...opts) => s => add(s.setName(n).setDescription(d), ...opts);

const LOG_TYPES = {
  mod: 'Moderation actions (bans, warns, flags…)', network: 'Global / network actions', automod: 'Automod hits',
  messages: 'Message edits & deletions', members: 'Joins, leaves, nicknames, roles', voice: 'Voice activity',
  server: 'Channels, roles & bans', modmail: 'Modmail transcripts & ratings',
  antinuke: 'Anti-nuke alerts', verify: 'Verification & welcomer',
};
const LOG_KEYS = Object.keys(LOG_TYPES);
const ANK = ['channelDelete', 'channelCreate', 'roleDelete', 'roleCreate', 'ban', 'kick', 'webhook', 'perm', 'botAdd'];
const cmds = [
  add(S('setup', 'Auto-create modmail, logs and the temp-voice hub', admin), O.r('staff_role', 'Role that handles modmail'), O.s('game_url', 'Link to your Roblox game (roblox.com/games/…)')),
  S('config', `Configure ${BRAND} bot`, admin)
    .addSubcommand(sub('view', 'Show current settings'))
    .addSubcommand(sub('channel', 'Set a bot channel', O.sc('type', 'Which channel', true, ['logs', 'suggestions', 'starboard', 'birthdays', 'levelup', 'applications']), O.c('channel', 'Channel', true)))
    .addSubcommand(sub('staffrole', 'Set the staff role', O.r('role', 'Staff role', true)))
    .addSubcommand(sub('autoclose', 'Auto-close idle threads (0 = off)', O.n('hours', 'Idle hours', true, 0, 720)))
    .addSubcommand(sub('stars', 'Starboard star threshold', O.n('count', 'Stars needed', true, 1, 50)))
    .addSubcommand(sub('toggle', 'Toggle a feature', O.sc('feature', 'Feature', true, ['leveling', 'transcript_dm', 'anonymous', 'modmail', 'global_bans', 'sticky_roles']), O.b('enabled', 'On or off', true))),
  S('dashboard', 'Live server pulse, activity and raid risk', staff),

  // modmail
  add(S('close', 'Close this modmail thread', staff), O.s('reason', 'Reason'), O.s('after', 'Close after a delay, e.g. 10m')),
  S('claim', 'Claim this modmail thread', staff),
  S('unclaim', 'Release this modmail thread', staff),
  S('snippet', 'Saved replies', staff)
    .addSubcommand(sub('use', 'Send a snippet to the user', O.s('name', 'Snippet', true, true)))
    .addSubcommand(sub('add', 'Create/update a snippet', O.s('name', 'Name', true), O.s('content', 'Text ({user} = username)', true)))
    .addSubcommand(sub('remove', 'Delete a snippet', O.s('name', 'Snippet', true, true)))
    .addSubcommand(sub('list', 'List snippets')),
  add(S('history', 'Past modmail threads for a user', staff), O.u('user', 'User', true)),
  add(S('contact', 'Open a modmail thread with a user', staff), O.u('user', 'User', true), O.s('message', 'Opening message')),
  add(S('block', 'Block a user from modmail', staff), O.u('user', 'User', true), O.s('reason', 'Reason')),
  add(S('unblock', 'Unblock a user from modmail', staff), O.u('user', 'User', true)),
  S('transcript', 'Export the transcript so far', staff),

  // applications
  S('form', 'Manage application forms', admin)
    .addSubcommand(sub('create', 'Create a form', O.s('name', 'Form name', true), O.s('description', 'Description')))
    .addSubcommand(sub('question-add', 'Add a question (max 8)', O.s('form', 'Form', true, true), O.s('text', 'Question', true), O.b('required', 'Required? (default yes)'), O.s('hint', 'Hint shown under the question')))
    .addSubcommand(sub('question-remove', 'Remove a question', O.s('form', 'Form', true, true), O.n('number', 'Question number', true, 1, 8)))
    .addSubcommand(sub('set', 'Edit form settings', O.s('form', 'Form', true, true), O.c('review_channel', 'Where submissions go'), O.r('accept_role', 'Role given on accept'), O.b('enabled', 'Open for applications'), O.n('cooldown_hours', 'Cooldown after denial', false, 0, 720)))
    .addSubcommand(sub('list', 'List forms and questions'))
    .addSubcommand(sub('delete', 'Delete a form', O.s('form', 'Form', true, true))),
  S('forms', 'See which applications are open'),
  add(S('apply', 'Start an application (continues in DMs)'), O.s('form', 'Form', true, true)),

  // levels
  add(S('rank', 'Show your level'), O.u('user', 'Member')),
  S('leaderboard', 'Top members by XP'),
  S('levelrole', 'Role rewards for levels', admin)
    .addSubcommand(sub('add', 'Reward a role at a level', O.n('level', 'Level', true, 1, 200), O.r('role', 'Role', true)))
    .addSubcommand(sub('remove', 'Remove a reward', O.n('level', 'Level', true, 1, 200)))
    .addSubcommand(sub('list', 'List rewards')),

  // giveaways / polls / reminders
  S('giveaway', 'Giveaways', admin)
    .addSubcommand(sub('start', 'Start a giveaway', O.s('prize', 'Prize', true), O.s('duration', 'e.g. 1h, 2d', true), O.n('winners', 'Winners', false, 1, 20)))
    .addSubcommand(sub('end', 'End a giveaway now', O.s('message_id', 'Giveaway message ID', true)))
    .addSubcommand(sub('reroll', 'Reroll winners', O.s('message_id', 'Giveaway message ID', true)))
    .addSubcommand(sub('list', 'Active giveaways')),
  S('poll', 'Polls', staff)
    .addSubcommand(sub('create', 'Create a poll', O.s('question', 'Question', true), O.s('options', 'Options separated by | (2-10)', true), O.s('duration', 'e.g. 1h (optional)')))
    .addSubcommand(sub('end', 'End a poll', O.s('message_id', 'Poll message ID', true))),
  S('remind', 'Reminders')
    .addSubcommand(sub('add', 'Set a reminder', O.s('when', 'e.g. 30m, 2h, 1d', true), O.s('text', 'What to remind you', true)))
    .addSubcommand(sub('list', 'Your reminders'))
    .addSubcommand(sub('cancel', 'Cancel a reminder', O.s('id', 'Reminder ID', true))),

  // community
  add(S('suggest', 'Submit a suggestion'), O.s('text', 'Your suggestion', true)),
  add(S('suggestion', 'Decide on a suggestion', staff), O.n('id', 'Suggestion #', true, 1), O.sc('decision', 'Decision', true, ['approve', 'deny', 'consider']), O.s('reason', 'Reason')),
  add(S('bookmarks', 'Your saved messages'), O.b('clear', 'Clear all bookmarks')),
  new ContextMenuCommandBuilder().setName('Bookmark message').setType(ApplicationCommandType.Message).setDMPermission(false),
  S('birthday', 'Birthdays (announced in UTC)')
    .addSubcommand(sub('set', 'Set your birthday', O.n('day', 'Day', true, 1, 31), O.n('month', 'Month', true, 1, 12)))
    .addSubcommand(sub('remove', 'Remove your birthday'))
    .addSubcommand(sub('next', 'Upcoming birthdays')),
  S('autorole', 'Roles given to new members', admin)
    .addSubcommand(sub('add', 'Add an autorole', O.r('role', 'Role', true)))
    .addSubcommand(sub('remove', 'Remove an autorole', O.r('role', 'Role', true)))
    .addSubcommand(sub('list', 'List autoroles')),
  add(S('afk', 'Set yourself AFK'), O.s('reason', 'Reason')),
  S('voice', 'Control your temporary voice channel')
    .addSubcommand(sub('lock', 'Lock your channel'))
    .addSubcommand(sub('unlock', 'Unlock your channel'))
    .addSubcommand(sub('rename', 'Rename your channel', O.s('name', 'New name', true)))
    .addSubcommand(sub('limit', 'Set user limit (0 = none)', O.n('count', 'Limit', true, 0, 99)))
    .addSubcommand(sub('kick', 'Disconnect someone from your channel', O.u('user', 'User', true))),
  // moderation (local)
  add(S('flag', 'Flag a user in this server', staff), O.s('user', 'User mention or ID', true), O.s('reason', 'Reason', true)),
  add(S('flags', 'Show flags and past actions for a user', staff), O.s('user', 'User mention or ID', true)),
  add(S('unflag', 'Remove a flag by case number', staff), O.n('case', 'Case number', true, 1)),
  add(S('ban', 'Ban a user from this server', PF.BanMembers), O.s('user', 'User mention or ID', true), O.s('reason', 'Reason'), O.n('delete_days', 'Delete message history (days)', false, 0, 7)),
  add(S('unban', 'Unban a user', PF.BanMembers), O.s('user', 'User ID', true), O.s('reason', 'Reason')),
  add(S('kick', 'Kick a member', PF.KickMembers), O.s('user', 'User mention or ID', true), O.s('reason', 'Reason')),
  add(S('timeout', 'Timeout a member', PF.ModerateMembers), O.s('user', 'User mention or ID', true), O.s('duration', 'e.g. 10m, 2h, 1d (max 28d)', true), O.s('reason', 'Reason')),
  add(S('lookup', 'Full record for a user (local + network)', staff), O.s('user', 'User mention or ID', true)),
  // multi-server network (operators only at runtime)
  add(S('gflag', 'NETWORK: flag a user across all Red Arrows servers', PF.Administrator), O.s('user', 'User mention or ID', true), O.s('reason', 'Reason', true)),
  add(S('gflags', 'NETWORK: show global flags for a user', PF.Administrator), O.s('user', 'User mention or ID', true)),
  add(S('gunflag', 'NETWORK: remove a global flag', PF.Administrator), O.s('id', 'Flag ID, e.g. GF3', true)),
  add(S('gban', 'NETWORK: ban a user from every Red Arrows server', PF.Administrator), O.s('user', 'User mention or ID', true), O.s('reason', 'Reason', true), O.s('evidence', 'Evidence link / note')),
  add(S('gunban', 'NETWORK: lift a global ban everywhere', PF.Administrator), O.s('user', 'User mention or ID', true), O.s('reason', 'Reason')),
  S('network', `${BRAND} network tools`, admin)
    .addSubcommand(sub('status', 'Network and global-ban status'))
    .addSubcommand(sub('sync', 'Apply all global bans to this server now'))
    .addSubcommand(sub('bans', 'Recent global bans (operators)'))
    .addSubcommand(sub('op-add', 'Add a network operator (bot owner only)', O.s('user', 'User mention or ID', true)))
    .addSubcommand(sub('op-remove', 'Remove a network operator (bot owner only)', O.s('user', 'User mention or ID', true)))
    .addSubcommand(sub('op-list', 'List network operators')),
  // advanced moderation
  S('logs', 'Configure log channels (no IDs needed)', admin)
    .addSubcommand(sub('setup', 'Auto-create a private channel for every log type'))
    .addSubcommand(sub('set', 'Use an existing channel for a log type', O.sc('type', 'Log type', true, LOG_KEYS), O.c('channel', 'Pick a channel', true)))
    .addSubcommand(sub('toggle', 'Turn a log type on or off', O.sc('type', 'Log type', true, LOG_KEYS), O.b('enabled', 'On or off', true)))
    .addSubcommand(sub('ignore', 'Exclude or include a channel in message logs', O.c('channel', 'Pick a channel', true), O.b('ignored', 'Ignore it? (default yes)')))
    .addSubcommand(sub('view', 'Show the log setup')),
  add(S('warn', 'Warn a member (auto-escalates)', staff), O.s('user', 'User mention or ID', true), O.s('reason', 'Reason', true)),
  add(S('warnings', 'Show active warnings for a user', staff), O.s('user', 'User mention or ID', true)),
  add(S('clearwarns', 'Clear all warnings for a user', PF.ModerateMembers), O.s('user', 'User mention or ID', true)),
  add(S('case', 'View a moderation case', staff), O.n('id', 'Case number', true, 1)),
  add(S('purge', 'Bulk delete recent messages', PF.ManageMessages), O.n('amount', 'How many (1-100)', true, 1, 100), O.u('user', 'Only this user')),
  add(S('slowmode', 'Set slowmode for this channel', PF.ManageChannels), O.n('seconds', 'Seconds (0 = off)', true, 0, 21600)),
  S('lockdown', 'Lock or unlock this channel', PF.ManageChannels)
    .addSubcommand(sub('on', 'Lock this channel', O.s('reason', 'Reason')))
    .addSubcommand(sub('off', 'Unlock this channel')),
  S('raid', 'Raid shield: auto-remove new joins during an attack', admin)
    .addSubcommand(sub('status', 'Show raid shield status'))
    .addSubcommand(sub('on', 'Turn the shield on', O.n('minutes', 'Duration (default 30)', false, 1, 1440)))
    .addSubcommand(sub('off', 'Turn the shield off'))
    .addSubcommand(sub('auto', 'Auto-enable when raid risk gets high', O.b('enabled', 'On or off', true))),
  S('automod', 'Automatic message moderation', admin)
    .addSubcommand(sub('view', 'Show automod settings'))
    .addSubcommand(sub('toggle', 'Turn a rule on or off', O.sc('rule', 'Rule', true, ['enabled', 'spam', 'invites', 'links', 'caps', 'mentions', 'words', 'scam', 'dupes', 'newLinks']), O.b('on', 'On or off', true)))
    .addSubcommand(sub('mentions-limit', 'Max mentions per message', O.n('count', 'Count', true, 2, 50)))
    .addSubcommand(sub('spam', 'Spam threshold', O.n('messages', 'Messages', true, 3, 20), O.n('seconds', 'Within seconds', true, 2, 30)))
    .addSubcommand(sub('timeout', 'Timeout minutes applied for spam', O.n('minutes', 'Minutes', true, 1, 1440)))
    .addSubcommand(sub('word-add', 'Block a word', O.s('word', 'Word or phrase', true)))
    .addSubcommand(sub('word-remove', 'Unblock a word', O.s('word', 'Word or phrase', true)))
    .addSubcommand(sub('word-list', 'Show blocked words'))
    .addSubcommand(sub('exempt', 'Exempt a role from automod', O.r('role', 'Role', true), O.b('exempt', 'Exempt? (default yes)'))),
  S('escalation', 'Warning thresholds that trigger automatic punishments', admin)
    .addSubcommand(sub('add', 'Add/replace a threshold', O.n('warns', 'Active warnings', true, 1, 50), O.sc('action', 'Action', true, ['timeout', 'kick', 'ban']), O.s('duration', 'Timeout length, e.g. 1h')))
    .addSubcommand(sub('remove', 'Remove a threshold', O.n('warns', 'Active warnings', true, 1, 50)))
    .addSubcommand(sub('expiry', 'Days until warnings stop counting (0 = never)', O.n('days', 'Days', true, 0, 365)))
    .addSubcommand(sub('list', 'Show thresholds')),
  // red arrows: roblox, verification, welcomer, anti-nuke
  add(S('verify', 'Verify your Roblox account to unlock the server')),
  S('roblox', 'Roblox lookups')
    .addSubcommand(sub('user', 'Look up a Roblox user', O.s('username', 'Roblox username', true)))
    .addSubcommand(sub('whois', 'Find the Roblox account linked to a member', O.u('user', 'Member', true))),
  S('game', 'Our Roblox game')
    .addSubcommand(sub('info', 'Live stats for the game'))
    .addSubcommand(sub('play', 'Get the play link')),
  S('gamesetup', 'Connect the Roblox game and its automations', admin)
    .addSubcommand(sub('set', 'Link the game', O.s('url', 'roblox.com/games/… link', true), O.s('group', 'Roblox group/community link')))
    .addSubcommand(sub('updates', 'Public channel for approved development notices', O.c('channel', 'Channel', true), O.r('ping', 'Role to ping')))
    .addSubcommand(sub('review', 'Private channel where development notices wait for approval', O.c('channel', 'Channel', true)))
    .addSubcommand(sub('status', 'Live player-count voice channel', O.b('enabled', 'On or off', true))),
  S('verification', 'Verification settings', admin)
    .addSubcommand(sub('panel', 'Post the verification panel', O.c('channel', 'Where to post it')))
    .addSubcommand(sub('config', 'Change verification options', O.sc('mode', 'Mode', false, ['roblox', 'button']), O.r('role', 'Verified role'), O.r('unverified', 'Unverified role'), O.n('kick_hours', 'Kick unverified after N hours (0 = never)', false, 0, 720), O.n('min_age_days', 'Minimum Discord account age in days', false, 0, 365), O.b('nickname', 'Set nickname to Roblox name')))
    .addSubcommand(sub('manual', 'Verify someone manually', O.u('user', 'Member', true), O.s('roblox_name', 'Roblox username', true)))
    .addSubcommand(sub('unlink', 'Remove a member\'s Roblox link', O.u('user', 'Member', true)))
    .addSubcommand(sub('lock', 'Hide every channel from Unverified (except verify/welcome)'))
    .addSubcommand(sub('unlock', 'Undo the lock')),
  S('welcome', 'Welcome and leave messages', admin)
    .addSubcommand(sub('set', 'Configure the welcomer', O.c('channel', 'Welcome channel'), O.s('message', 'Text: {user} {username} {server} {count} {game} {verify}'), O.s('banner', 'Banner image URL'), O.b('dm', 'DM new members too'), O.c('leave_channel', 'Channel for leave messages')))
    .addSubcommand(sub('toggle', 'Turn the welcomer on or off', O.b('enabled', 'On or off', true)))
    .addSubcommand(sub('test', 'Preview the welcome message'))
    .addSubcommand(sub('view', 'Show welcomer settings')),
  S('antinuke', 'Anti-nuke protection (changes: server owner only)', admin)
    .addSubcommand(sub('status', 'Show protection status'))
    .addSubcommand(sub('toggle', 'Enable or disable', O.b('enabled', 'On or off', true)))
    .addSubcommand(sub('whitelist-add', 'Trust a user or bot', O.u('user', 'User or bot', true)))
    .addSubcommand(sub('whitelist-remove', 'Remove trust', O.u('user', 'User or bot', true)))
    .addSubcommand(sub('limit', 'Set an action limit', O.sc('action', 'Action', true, ANK), O.n('count', 'Allowed within the window', true, 0, 20)))
    .addSubcommand(sub('window', 'Detection window in seconds', O.n('seconds', 'Seconds', true, 5, 120)))
    .addSubcommand(sub('punish', 'What happens to a nuker', O.sc('type', 'Punishment', true, ['ban', 'kick', 'strip'])))
    .addSubcommand(sub('restore', 'Rebuild deleted channels and roles', O.b('enabled', 'On or off', true))),
  add(S('announce', 'Post an announcement embed', admin), O.s('title', 'Title', true), O.s('message', 'Message', true), O.c('channel', 'Channel (default: here)'), O.sc('ping', 'Ping', false, ['none', 'here', 'everyone']), O.b('game_button', 'Add a Play button')),
  // pilots, flights & progression
  add(S('profile', 'Pilot card: rank, flight time, medals, squadron'), O.u('user', 'Member')),
  add(S('callsign', 'Set your unique callsign'), O.s('name', '2-20 letters, numbers, spaces or -', true)),
  S('ranks', 'The rank ladder and your progress'),
  add(S('topgun', 'Pilot leaderboard'), O.sc('sort', 'Sort by', false, ['points', 'hours', 'events'])),
  S('daily', 'Claim daily XP and keep your streak alive'),
  S('schedule', 'Upcoming flights and events'),
  S('event', 'Schedule flights: trainings, shows, meetups', PF.ManageEvents)
    .addSubcommand(sub('create', 'Schedule an event', O.s('title', 'Title', true), O.s('when', 'Date and time: 25/12/2026 6:30pm, 25 Dec 18:30 EST, friday 8pm, in 2h', true), O.s('timezone', 'Timezone: EST, GMT+2, Europe/London, London (default: your saved one)', false, true), O.n('minutes', 'Length in minutes (default 60)', false, 5, 600), O.s('description', 'Details'), O.r('ping', 'Role to ping'), O.c('channel', 'Channel (default: here)')))
    .addSubcommand(sub('cancel', 'Cancel an event', O.s('id', 'Event message ID', true))),
  add(S('media', 'Send an image, video or file as the bot', staff), O.a('file', 'The file to send', true), O.s('message', 'Text to send with it'), O.c('channel', 'Channel (default: here)'), O.r('ping', 'Role to ping'), O.b('spoiler', 'Mark the file as a spoiler')),
  add(S('developmentnotice', 'Post a development notice with title, info boxes and media', staff), O.a('media', 'Photo or video to attach'), O.c('channel', 'Public channel (default: development-notices)'), O.r('ping', 'Role to ping')),
  S('training', 'Host a training session', PF.ManageEvents)
    .addSubcommand(sub('create', 'Schedule a training', O.s('when', 'Date and time: 25/12/2026 6:30pm, 25 Dec 18:30 EST, friday 8pm, in 2h', true), O.s('timezone', 'Timezone: EST, GMT+2, Europe/London, London (default: your saved one)', false, true), O.s('title', 'Title (default: Training Session)'), O.u('cohost', 'Co-host'), O.u('observer', 'Observer'), O.s('location', 'Where to meet (place, server, game spot)'), O.s('prerequisites', 'Requirements, separated by commas'), O.s('info', 'Extra notes from the host'), O.n('minutes', 'Length in minutes (default 60)', false, 10, 300), O.n('slots', 'Max signups (0 = unlimited)', false, 0, 100), O.v('voice', 'Training voice channel (attendance is tracked)'), O.r('ping', 'Role to ping'), O.c('channel', 'Channel (default: the training channel)')))
    .addSubcommand(sub('setup', 'Set the training channel, ping role and default info', O.c('channel', 'Training channel'), O.r('ping', 'Role pinged for trainings'), O.s('info', 'Default information shown on every training'))),
  S('timezone', 'Save your timezone for scheduling trainings and events')
    .addSubcommand(sub('set', 'Save your timezone', O.s('zone', 'EST, GMT+2, Europe/London, or a city like London', true, true)))
    .addSubcommand(sub('view', 'Show your saved timezone')),
  S('squadron', 'Squadrons')
    .addSubcommand(sub('list', 'All squadrons and their scores'))
    .addSubcommand(sub('join', 'Join a squadron', O.s('squad', 'Squadron', true, true)))
    .addSubcommand(sub('leave', 'Leave your squadron'))
    .addSubcommand(sub('info', 'Squadron details', O.s('squad', 'Squadron', true, true))),
  S('pilotadmin', 'Manage ranks, medals, squadrons and automation', admin)
    .addSubcommand(sub('ranks-setup', 'Create the rank roles (Cadet → Air Marshal)'))
    .addSubcommand(sub('set-rank', 'Instantly set someone to a specific rank', O.u('user', 'Member', true), O.sc('rank', 'Rank', true, ['Cadet', 'Pilot Officer', 'Flying Officer', 'Flight Lieutenant', 'Squadron Leader', 'Wing Commander', 'Group Captain', 'Air Commodore', 'Air Vice-Marshal', 'Air Marshal'])))
    .addSubcommand(sub('ranks-channel', 'Channel for promotion announcements', O.c('channel', 'Pick a channel', true)))
    .addSubcommand(sub('medals-channel', 'Channel for medal announcements', O.c('channel', 'Pick a channel', true)))
    .addSubcommand(sub('medal-create', 'Create a custom medal', O.s('key', 'Short id, e.g. best_pilot', true), O.s('name', 'Display name', true), O.s('emoji', 'Emoji', true), O.s('description', 'What it is for')))
    .addSubcommand(sub('medal-award', 'Award a medal', O.u('user', 'Member', true), O.s('medal', 'Medal', true, true)))
    .addSubcommand(sub('medal-revoke', 'Take a medal back', O.u('user', 'Member', true), O.s('medal', 'Medal', true, true)))
    .addSubcommand(sub('points', 'Give or remove bonus points', O.u('user', 'Member', true), O.n('amount', 'Points (negative to remove)', true, -5000, 5000)))
    .addSubcommand(sub('squad-create', 'Create a squadron (and its role)', O.s('name', 'Name, e.g. Red Flight', true), O.s('emoji', 'Emoji')))
    .addSubcommand(sub('squad-delete', 'Delete a squadron', O.s('squad', 'Squadron', true, true)))
    .addSubcommand(sub('drops', 'Random XP supply drops in busy chats', O.b('enabled', 'On or off', true)))
    .addSubcommand(sub('briefing', 'Daily briefing channel and time (UTC)', O.c('channel', 'Channel', true), O.n('hour', 'Hour 0-23 (UTC)', false, 0, 23)))
    .addSubcommand(sub('briefing-now', 'Post the briefing right now')),
  add(S('trust', 'Show a member\'s trust score', staff), O.u('user', 'Member', true)),
  S('panic', 'Emergency lockdown (server owner only)', admin)
    .addSubcommand(sub('on', 'Lock every channel, stop invites, raid shield on'))
    .addSubcommand(sub('off', 'Restore everything')),
  S('ping', 'Check that the bot is online'),
  S('help', `What ${BRAND} bot can do`),
];
{ // command-name collision check
  const seen = new Set();
  for (const c of cmds) { if (seen.has(c.name)) throw new Error('Duplicate command name: ' + c.name); seen.add(c.name); }
}
/** only talk to the Discord API when the definitions actually changed */
async function syncCommands() {
  const json = cmds.map(c => c.toJSON());
  const hash = crypto.createHash('sha1').update(JSON.stringify(json)).digest('hex');
  if (!db.meta.globalCleared) { await client.application.commands.set([]).catch(() => {}); db.meta.globalCleared = true; save(); } // remove old global copies so nothing shows twice
  for (const guild of client.guilds.cache.values()) await syncGuildCommands(guild, json, hash);
}
/** commands are registered per server, so they show up instantly (global ones can take a long time to appear) */
async function syncGuildCommands(guild, json, hash) {
  json ||= cmds.map(c => c.toJSON()); hash ||= crypto.createHash('sha1').update(JSON.stringify(json)).digest('hex');
  db.meta.guildHash ||= {}; if (db.meta.guildHash[guild.id] === hash) return console.log(`Commands already up to date in ${guild.name}.`);
  try { await guild.commands.set(json); db.meta.guildHash[guild.id] = hash; save(); console.log(`✅ Registered ${json.length} commands in ${guild.name}.`); }
  catch (e) {
    console.error(`❌ Could not register commands in ${guild.name}: ${e.message}`);
    if (e.rawError?.errors) console.error(JSON.stringify(e.rawError.errors).slice(0, 1500));
    if (e.code === 50001) console.error('→ The bot was invited without the "applications.commands" scope. Re-invite it with the link printed above.');
  }
}

const H = {};            // slash handlers
const sessions = new Map();   // DM application sessions
const dmPending = new Map();  // DMs waiting for a server choice

/* ═══════════════════════ MODMAIL ═══════════════════════ */
const addLog = (t, who, name, c) => { t.log.push({ t: now(), who, name, c: clip(c, 1500) }); if (t.log.length > 3000) t.log.shift(); };
const userThreads = uid => {
  const out = [];
  for (const gid in db.guilds) for (const id in (db.guilds[gid].threads || {})) if (db.guilds[gid].threads[id].userId === uid) out.push({ gid, id, t: db.guilds[gid].threads[id] });
  return out;
};
const logChannel = guild => { const g = G(guild.id); return guild.channels.cache.get(g.settings.channels.logs) || null; };
function attachBits(e, atts) {
  atts = [...atts.values()]; if (!atts.length) return;
  const img = atts.find(a => a.contentType?.startsWith('image/')); if (img) e.setImage(img.url);
  e.addFields({ name: 'Attachments', value: clip(atts.map(a => `[${a.name}](${a.url})`).join('\n'), 1000) });
}

async function openThread(guild, user, opener = null) {
  const g = G(guild.id), s = g.settings;
  const parent = guild.channels.cache.get(s.channels.category);
  const member = await guild.members.fetch(user.id).catch(() => null);
  const name = ('mm-' + user.username.toLowerCase().replace(/[^a-z0-9]/g, '')).slice(0, 40) || 'mm-user';
  const ch = await guild.channels.create({ name, type: CT.GuildText, parent: parent?.id, topic: `Modmail • ${user.username}`, reason: 'Modmail thread opened' });
  const t = g.threads[ch.id] = { userId: user.id, guildId: guild.id, opened: now(), last: now(), claimedBy: null, closeAt: null, count: 0, log: [] };
  const prev = (g.history[user.id] || []).length;
  const info = E('📬 New modmail thread').setThumbnail(user.displayAvatarURL()).addFields(
    { name: 'User', value: `${user} — ${user.username}`, inline: true },
    { name: 'Account created', value: ts(user.createdTimestamp), inline: true },
    { name: 'Joined server', value: member?.joinedTimestamp ? ts(member.joinedTimestamp) : 'Unknown', inline: true },
    { name: 'Previous threads', value: String(prev), inline: true },
    { name: 'Roles', value: clip(member ? member.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position).first(10).map(r => r.toString()).join(' ') || 'None' : 'Unknown', 1000) },
  ).setDescription(`Type here to reply to the user.\nStart a message with \`=\` for an internal note.\n\`/close\` • \`/claim\` • \`/snippet use\` • \`/history\``);
  { const rl = db.global.links[user.id]; if (rl) info.addFields({ name: 'Roblox', value: `[${rl.name}](https://www.roblox.com/users/${rl.rid}/profile)`, inline: true });
    const gf = activeGFlags(user.id), lf = activeLocal(g, user.id), gb = db.global.bans[user.id];
    if (gf.length || lf.length || gb) info.addFields({ name: '⚠️ Flags', value: clip([gb ? `🌐 **GLOBALLY BANNED:** ${gb.reason}` : '', ...gf.map(f => `🌐 ${f.id}: ${f.reason}`), ...lf.map(f => `🚩 #${f.id}: ${f.reason}`)].filter(Boolean).join('\n'), 1000) }); }
  await ch.send({ content: s.staffRole ? `<@&${s.staffRole}>` : undefined, embeds: [info], allowedMentions: { roles: s.staffRole ? [s.staffRole] : [] } });
  await user.send({ embeds: [E(`📬 ${BRAND} — thread opened`, `Your message has been sent to the staff of **${guild.name}**. We'll reply here as soon as we can.`).setColor(0x2ecc71)] }).catch(() => {});
  save();
  return { ch, t };
}
async function relayToStaff(ch, t, m) {
  const e = E().setColor(0x57f287).setAuthor({ name: m.author.username, iconURL: m.author.displayAvatarURL() }).setDescription(clip(m.content || '*(no text)*', 4000));
  attachBits(e, m.attachments);
  await ch.send({ embeds: [e] });
  t.last = now(); t.count++; t.closeAt = null; addLog(t, 'user', m.author.username, (m.content || '') + (m.attachments.size ? ' ' + [...m.attachments.values()].map(a => a.url).join(' ') : ''));
  save();
  m.react?.('📨').catch(() => {});
}
async function sendToUser(ch, t, staffMember, content, atts) {
  const g = G(t.guildId);
  const user = await client.users.fetch(t.userId).catch(() => null);
  if (!user) throw new Error('user not found');
  const name = g.settings.anonymous ? `${BRAND} Staff` : staffMember.displayName;
  const e = E().setColor(COLOR).setAuthor({ name, iconURL: g.settings.anonymous ? client.user.displayAvatarURL() : staffMember.displayAvatarURL() }).setDescription(clip(content || '*(no text)*', 4000));
  if (atts) attachBits(e, atts);
  await user.send({ embeds: [e] });
  t.last = now(); t.count++; t.closeAt = null; addLog(t, 'staff', staffMember.displayName, content);
  save();
  return e;
}
function transcriptText(t, user) {
  const head = `${BRAND} modmail transcript\nUser: ${user?.username ?? 'unknown'} (${t.userId})\nOpened: ${new Date(t.opened).toISOString()}\n${'─'.repeat(40)}\n`;
  return head + t.log.map(l => `[${new Date(l.t).toISOString().replace('T', ' ').slice(0, 19)}] ${l.who.toUpperCase()} ${l.name}: ${l.c}`).join('\n');
}
async function closeThread(ch, closer, reason) {
  const g = G(ch.guild.id), t = g.threads[ch.id]; if (!t) return;
  delete g.threads[ch.id];
  const user = await client.users.fetch(t.userId).catch(() => null);
  const rec = { id: ch.id, opened: t.opened, closed: now(), by: closer?.id || null, reason: reason || null, rating: null, count: t.count, claimedBy: t.claimedBy };
  (g.history[t.userId] ||= []).push(rec); if (g.history[t.userId].length > 50) g.history[t.userId].shift();
  const text = transcriptText(t, user);
  const log = logChannel(ch.guild);
  if (log) {
    await log.send({
      embeds: [E('📪 Thread closed').addFields(
        { name: 'User', value: `<@${t.userId}>`, inline: true },
        { name: 'Closed by', value: closer ? `<@${closer.id}>` : 'Automatically', inline: true },
        { name: 'Claimed by', value: t.claimedBy ? `<@${t.claimedBy}>` : 'Nobody', inline: true },
        { name: 'Duration', value: fmtDur(now() - t.opened), inline: true },
        { name: 'Messages', value: String(t.count), inline: true },
        { name: 'Reason', value: reason || 'None given' })],
      files: [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `transcript-${user?.username || t.userId}-${ch.id}.txt` })],
    }).catch(() => {});
  }
  if (user) {
    const stars = [1, 2, 3, 4, 5].map(n => btn(`mmr:${ch.guild.id}:${ch.id}:${n}`, '⭐'.repeat(n), ButtonStyle.Primary));
    await user.send({
      embeds: [E(`📪 Your ${BRAND} thread was closed`, `${reason ? `**Reason:** ${reason}\n\n` : ''}Thanks for contacting **${ch.guild.name}**. How was your experience? Send a new message any time to open another thread.`)],
      components: [row(...stars)],
      files: g.settings.transcriptDM ? [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: 'transcript.txt' })] : [],
    }).catch(() => {});
  }
  save();
  setTimeout(() => ch.delete('Modmail thread closed').catch(() => {}), 5000);
}

async function onDM(m) {
  if (sessions.has(m.author.id)) return onAppAnswer(m);
  const open = userThreads(m.author.id).sort((a, b) => b.t.last - a.t.last);
  if (open.length) {
    const ch = client.channels.cache.get(open[0].id);
    if (ch) return relayToStaff(ch, open[0].t, m);
    delete db.guilds[open[0].gid].threads[open[0].id]; save(); // channel was deleted by hand
  }
  const opts = [];
  for (const guild of client.guilds.cache.values()) {
    const g = G(guild.id);
    if (!g.settings.modmail || !g.settings.channels.category || g.blocked[m.author.id]) continue;
    if (await guild.members.fetch(m.author.id).catch(() => null)) opts.push(guild);
  }
  if (!opts.length) return void m.reply({ embeds: [E(null, `I couldn't find a server for you. You need to share a server with ${BRAND} bot that has modmail enabled (and not be blocked).`)] }).catch(() => {});
  if (opts.length === 1) { const { ch, t } = await openThread(opts[0], m.author); return relayToStaff(ch, t, m); }
  dmPending.set(m.author.id, { m, at: now() });
  const menu = new StringSelectMenuBuilder().setCustomId('mmpick').setPlaceholder('Choose a server').addOptions(opts.slice(0, 25).map(g => ({ label: clip(g.name, 100), value: g.id })));
  await m.reply({ embeds: [E('Which server is this for?', 'Pick where your message should go.')], components: [row(menu)] }).catch(() => {});
}
async function onThreadMessage(m) {
  const g = G(m.guild.id), t = g.threads[m.channel.id];
  if (!t || m.author.bot) return false;
  if (m.content.startsWith('=')) { addLog(t, 'note', m.member?.displayName || m.author.username, m.content.slice(1).trim()); save(); m.react('📝').catch(() => {}); return true; }
  if (!isStaff(m.member, g)) return true;
  try { await sendToUser(m.channel, t, m.member, m.content, m.attachments); m.react('✅').catch(() => {}); }
  catch { m.react('❌').catch(() => {}); m.reply({ embeds: [bad('Could not DM this user (DMs closed or they left).')] }).catch(() => {}); }
  return true;
}

const threadHere = i => G(i.guildId).threads[i.channelId];
const needThread = i => { const t = threadHere(i); if (!t) rep(i, bad('Use this inside a modmail thread.')); return t; };

H.close = async i => {
  const t = needThread(i); if (!t) return;
  const reason = i.options.getString('reason'), after = parseDuration(i.options.getString('after'));
  if (after) { t.closeAt = now() + after; t.closeReason = reason; save(); return rep(i, good(`Thread will close ${ts(t.closeAt)} unless the user replies.`), false); }
  await rep(i, good('Closing thread…'), false);
  return closeThread(i.channel, i.user, reason);
};
H.claim = async i => {
  const t = needThread(i); if (!t) return;
  if (t.claimedBy && t.claimedBy !== i.user.id) return rep(i, bad(`Already claimed by <@${t.claimedBy}>.`));
  t.claimedBy = i.user.id; save(); await i.channel.setTopic(`${i.channel.topic?.split(' • claimed')[0] || ''} • claimed by ${i.user.username}`).catch(() => {});
  return rep(i, good(`${i.user} claimed this thread.`), false);
};
H.unclaim = async i => {
  const t = needThread(i); if (!t) return;
  if (!t.claimedBy) return rep(i, bad('Not claimed.'));
  t.claimedBy = null; save(); return rep(i, good('Thread released.'), false);
};
H.snippet = async i => {
  const g = G(i.guildId), sc = i.options.getSubcommand(), name = (i.options.getString('name') || '').toLowerCase();
  if (sc === 'list') return rep(i, E('Snippets', Object.keys(g.snippets).map(n => `• \`${n}\``).join('\n') || 'No snippets yet.'));
  if (sc === 'add') { g.snippets[name] = clip(i.options.getString('content'), 1800); save(); return rep(i, good(`Snippet \`${name}\` saved.`)); }
  if (sc === 'remove') { if (!g.snippets[name]) return rep(i, bad('No such snippet.')); delete g.snippets[name]; save(); return rep(i, good('Snippet removed.')); }
  const t = needThread(i); if (!t) return;
  if (!g.snippets[name]) return rep(i, bad('No such snippet.'));
  const user = await client.users.fetch(t.userId).catch(() => null);
  const text = g.snippets[name].replaceAll('{user}', user?.username || 'there');
  try { const e = await sendToUser(i.channel, t, i.member, text); return rep(i, { embeds: [E().setColor(0x57f287).setAuthor({ name: `${i.member.displayName} (snippet: ${name})` }).setDescription(clip(text, 4000))] }, false); }
  catch { return rep(i, bad('Could not DM this user.')); }
};
H.history = async i => {
  const u = i.options.getUser('user'), h = G(i.guildId).history[u.id] || [];
  if (!h.length) return rep(i, E(null, `${u} has no past threads.`));
  return rep(i, E(`Modmail history — ${u.username}`, h.slice(-15).reverse().map((r, n) => `**${h.length - n}.** ${ts(r.opened, 'd')} → ${ts(r.closed, 'd')} • ${r.count} msgs • ${r.rating ? '⭐'.repeat(r.rating) : 'unrated'}${r.reason ? `\n└ ${clip(r.reason, 120)}` : ''}`).join('\n')));
};
H.contact = async i => {
  const u = i.options.getUser('user'), g = G(i.guildId);
  if (u.bot) return rep(i, bad('Bots cannot be contacted.'));
  if (!g.settings.channels.category) return rep(i, bad('Run `/setup` first.'));
  const ex = Object.entries(g.threads).find(([, t]) => t.userId === u.id);
  if (ex) return rep(i, bad(`Thread already open: <#${ex[0]}>`));
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const { ch, t } = await openThread(i.guild, u, i.user);
  const msg = i.options.getString('message');
  if (msg) await sendToUser(ch, t, i.member, msg).then(() => ch.send({ embeds: [E().setAuthor({ name: i.member.displayName }).setDescription(clip(msg, 4000))] })).catch(() => ch.send({ embeds: [bad('Could not DM the user.')] }));
  return rep(i, good(`Thread opened: ${ch}`));
};
H.block = async i => { const u = i.options.getUser('user'); G(i.guildId).blocked[u.id] = { by: i.user.id, reason: i.options.getString('reason') || null, at: now() }; save(); return rep(i, good(`${u} can no longer use modmail.`)); };
H.unblock = async i => { const u = i.options.getUser('user'), g = G(i.guildId); if (!g.blocked[u.id]) return rep(i, bad('Not blocked.')); delete g.blocked[u.id]; save(); return rep(i, good(`${u} unblocked.`)); };
H.transcript = async i => {
  const t = needThread(i); if (!t) return;
  const user = await client.users.fetch(t.userId).catch(() => null);
  return rep(i, { files: [new AttachmentBuilder(Buffer.from(transcriptText(t, user), 'utf8'), { name: `transcript-${i.channelId}.txt` })] });
};

/* ═══════════════════════ APPLICATIONS ═══════════════════════ */
const SESSION_MS = 15 * 60 * 1000, MAX_Q = 8, MAX_ANS = 450;
function endSession(uid) { const s = sessions.get(uid); if (s) { clearTimeout(s.timer); sessions.delete(uid); } }
function touch(uid) {
  const s = sessions.get(uid); if (!s) return; clearTimeout(s.timer);
  s.timer = setTimeout(async () => {
    sessions.delete(uid);
    const u = await client.users.fetch(uid).catch(() => null);
    u?.send({ embeds: [E(null, '⌛ Your application session timed out. Run `/apply` again to restart.')] }).catch(() => {});
  }, SESSION_MS);
}
function askQuestion(user, s) {
  const f = G(s.guildId).forms[s.form], q = f.questions[s.idx];
  const e = E(`${f.name} — Question ${s.idx + 1}/${f.questions.length}`, q.text + (q.hint ? `\n\n*${q.hint}*` : ''))
    .setFooter({ text: `${BRAND} • ${q.required ? 'Required' : 'Optional — type "skip" to skip'} • "cancel" to stop` });
  return user.send({ embeds: [e] });
}
function qaFields(f, answers) { return f.questions.map((q, n) => ({ name: clip(`${n + 1}. ${q.text}`, 256), value: clip(answers[n] || '*skipped*', 1024) })); }
async function showSummary(user, s) {
  const f = G(s.guildId).forms[s.form]; s.confirming = true;
  await user.send({
    embeds: [E(`${f.name} — review your answers`, 'Press **Submit** to send your application, or **Cancel** to discard it.').addFields(qaFields(f, s.answers))],
    components: [row(btn('app:submit', 'Submit', ButtonStyle.Success), btn('app:cancel', 'Cancel', ButtonStyle.Danger))],
  });
}
async function onAppAnswer(m) {
  const s = sessions.get(m.author.id), g = G(s.guildId), f = g.forms[s.form];
  if (!f) { endSession(m.author.id); return m.reply('That form no longer exists.').catch(() => {}); }
  const txt = m.content.trim();
  if (/^cancel$/i.test(txt)) { endSession(m.author.id); return m.reply({ embeds: [E(null, 'Application cancelled.')] }).catch(() => {}); }
  if (s.confirming) return m.reply({ embeds: [E(null, 'Use the **Submit / Cancel** buttons above, or type `cancel`.')] }).catch(() => {});
  const q = f.questions[s.idx]; let ans = null;
  if (/^skip$/i.test(txt)) { if (q.required) return m.reply({ embeds: [bad('That question is required.')] }).catch(() => {}); }
  else {
    ans = txt; const urls = [...m.attachments.values()].map(a => a.url);
    if (urls.length) ans += (ans ? '\n' : '') + urls.join('\n');
    if (!ans) return m.reply({ embeds: [bad('Please send a text answer.')] }).catch(() => {});
    if (ans.length > MAX_ANS) return m.reply({ embeds: [bad(`Too long (${ans.length}/${MAX_ANS}). Please shorten it.`)] }).catch(() => {});
  }
  s.answers.push(ans); s.idx++; touch(m.author.id);
  if (s.idx >= f.questions.length) return showSummary(m.author, s);
  return askQuestion(m.author, s);
}
const reviewEmbed = (sub, f, user, status, reviewer, reason) => {
  const col = status === 'accepted' ? 0x2ecc71 : status === 'denied' ? 0xed4245 : COLOR;
  const e = E(`📝 ${f?.name || sub.form} application`).setColor(col).setThumbnail(user?.displayAvatarURL() || null)
    .setDescription(`Applicant: <@${sub.userId}>\nSubmitted: ${ts(sub.at)}\nStatus: **${status.toUpperCase()}**${reviewer ? ` by <@${reviewer}>` : ''}${reason ? `\nReason: ${clip(reason, 400)}` : ''}`);
  const rl = db.global.links[sub.userId]; if (rl) e.addFields({ name: 'Roblox (verified)', value: `[${rl.name}](https://www.roblox.com/users/${rl.rid}/profile)` });
  if (f) e.addFields(qaFields(f, sub.answers));
  return e;
};
async function submitApp(i) {
  const s = sessions.get(i.user.id); if (!s) return i.update({ embeds: [bad('This session has expired.')], components: [] });
  const guild = client.guilds.cache.get(s.guildId), g = G(s.guildId), f = g.forms[s.form];
  const ch = guild && guild.channels.cache.get(f?.reviewChannel || g.settings.channels.applications || g.settings.channels.logs);
  if (!f || !ch) { endSession(i.user.id); return i.update({ embeds: [bad('This form is not accepting submissions right now.')], components: [] }); }
  const id = now().toString(36), sub = g.subs[id] = { id, userId: i.user.id, form: f.name, answers: s.answers, status: 'pending', at: now() };
  const msg = await ch.send({ embeds: [reviewEmbed(sub, f, i.user, 'pending')], components: [row(btn(`appr:a:${id}`, 'Accept', ButtonStyle.Success), btn(`appr:d:${id}`, 'Deny', ButtonStyle.Danger))] });
  sub.channelId = ch.id; sub.msgId = msg.id; endSession(i.user.id); save();
  return i.update({ embeds: [good(`Application submitted to **${guild.name}**. You'll be notified of the decision.`)], components: [] });
}
async function finalize(i, sub, status, reason) {
  const g = G(i.guildId), f = g.forms[sub.form];
  sub.status = status; sub.reviewer = i.user.id; sub.reason = reason || null; sub.decided = now();
  const user = await client.users.fetch(sub.userId).catch(() => null);
  if (status === 'accepted' && f?.role) { const mem = await i.guild.members.fetch(sub.userId).catch(() => null); await mem?.roles.add(f.role, 'Application accepted').catch(() => {}); }
  if (status === 'denied' && f?.cooldownHours) g.cooldowns[`${sub.userId}:${sub.form}`] = now() + f.cooldownHours * 36e5;
  await user?.send({ embeds: [E(`Your ${sub.form} application`, `Your application to **${i.guild.name}** was **${status}**.${reason ? `\n\n**Note from staff:** ${reason}` : ''}`).setColor(status === 'accepted' ? 0x2ecc71 : 0xed4245)] }).catch(() => {});
  const ch = i.guild.channels.cache.get(sub.channelId), msg = ch && await ch.messages.fetch(sub.msgId).catch(() => null);
  await msg?.edit({ embeds: [reviewEmbed(sub, f, user, status, i.user.id, reason)], components: [] }).catch(() => {});
  save();
}
H.form = async i => {
  const g = G(i.guildId), sc = i.options.getSubcommand();
  if (sc === 'create') {
    const name = i.options.getString('name').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30);
    if (g.forms[name]) return rep(i, bad('A form with that name exists.'));
    if (Object.keys(g.forms).length >= 15) return rep(i, bad('Max 15 forms.'));
    g.forms[name] = { name, description: clip(i.options.getString('description') || '', 300), questions: [], reviewChannel: null, role: null, enabled: false, cooldownHours: 24, created: now() };
    save(); return rep(i, good(`Form \`${name}\` created. Add questions with \`/form question-add\`, then \`/form set enabled:true\`.`));
  }
  if (sc === 'list') {
    const fs_ = Object.values(g.forms); if (!fs_.length) return rep(i, E(null, 'No forms yet. Create one with `/form create`.'));
    return rep(i, E('Application forms').addFields(fs_.slice(0, 25).map(f => ({ name: `${f.enabled ? '🟢' : '🔴'} ${f.name}`, value: clip(`${f.description || '*no description*'}\n${f.questions.map((q, n) => `${n + 1}. ${q.text}${q.required ? '' : ' *(optional)*'}`).join('\n') || '*no questions*'}\nReview: ${f.reviewChannel ? `<#${f.reviewChannel}>` : 'default'} • Role: ${f.role ? `<@&${f.role}>` : 'none'} • Cooldown: ${f.cooldownHours}h`, 1024) }))));
  }
  const f = g.forms[i.options.getString('form')]; if (!f) return rep(i, bad('Unknown form.'));
  if (sc === 'question-add') {
    if (f.questions.length >= MAX_Q) return rep(i, bad(`Max ${MAX_Q} questions per form.`));
    f.questions.push({ text: clip(i.options.getString('text'), 200), required: i.options.getBoolean('required') ?? true, hint: clip(i.options.getString('hint') || '', 150) });
    save(); return rep(i, good(`Question ${f.questions.length} added.`));
  }
  if (sc === 'question-remove') {
    const n = i.options.getInteger('number'); if (n > f.questions.length) return rep(i, bad('No such question.'));
    f.questions.splice(n - 1, 1); save(); return rep(i, good('Question removed.'));
  }
  if (sc === 'set') {
    const rc = i.options.getChannel('review_channel'), role = i.options.getRole('accept_role'), en = i.options.getBoolean('enabled'), cd = i.options.getInteger('cooldown_hours');
    if (rc) f.reviewChannel = rc.id; if (role) f.role = role.id; if (cd !== null) f.cooldownHours = cd;
    if (en !== null) { if (en && !f.questions.length) return rep(i, bad('Add at least one question first.')); f.enabled = en; }
    save(); return rep(i, good(`Form \`${f.name}\` updated (${f.enabled ? 'open' : 'closed'}).`));
  }
  if (sc === 'delete') { delete g.forms[f.name]; save(); return rep(i, good('Form deleted.')); }
};
H.forms = async i => {
  const open = Object.values(G(i.guildId).forms).filter(f => f.enabled);
  return rep(i, E('Open applications', open.length ? open.map(f => `**${f.name}** — ${f.description || 'Apply with `/apply`'} (${f.questions.length} questions)`).join('\n') : 'No applications are open right now.'));
};
H.apply = async i => {
  const g = G(i.guildId), f = g.forms[i.options.getString('form')];
  if (!f || !f.enabled) return rep(i, bad('That application is not open.'));
  if (sessions.has(i.user.id)) return rep(i, bad('You already have an application in progress — check your DMs (type `cancel` there to stop).'));
  const cd = g.cooldowns[`${i.user.id}:${f.name}`]; if (cd && cd > now()) return rep(i, bad(`You can re-apply ${ts(cd)}.`));
  if (Object.values(g.subs).some(x => x.userId === i.user.id && x.form === f.name && x.status === 'pending')) return rep(i, bad('You already have a pending application for this form.'));
  const s = { guildId: i.guildId, form: f.name, idx: 0, answers: [], confirming: false };
  try { await i.user.send({ embeds: [E(`${f.name} application — ${i.guild.name}`, `${f.description || ''}\n\nI'll ask ${f.questions.length} question(s). Reply to each in this chat. Type \`cancel\` at any time.`)] }); }
  catch { return rep(i, bad('I could not DM you. Enable DMs from server members and try again.')); }
  sessions.set(i.user.id, s); touch(i.user.id); await askQuestion(i.user, s);
  return rep(i, good('Check your DMs to continue your application.'));
};

/* ═══════════════════════ SETUP / CONFIG / DASHBOARD ═══════════════════════ */
H.setup = async i => {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const g = G(i.guildId), s = g.settings, guild = i.guild, made = [];
  const role = i.options.getRole('staff_role'); if (role) s.staffRole = role.id;
  const ow = [{ id: guild.roles.everyone.id, deny: [PF.ViewChannel] },
    { id: client.user.id, allow: [PF.ViewChannel, PF.SendMessages, PF.ManageChannels, PF.EmbedLinks, PF.AttachFiles, PF.ReadMessageHistory, PF.AddReactions] }];
  if (s.staffRole) ow.push({ id: s.staffRole, allow: [PF.ViewChannel, PF.SendMessages, PF.ReadMessageHistory, PF.AttachFiles, PF.EmbedLinks] });
  const has = id => id && guild.channels.cache.has(id);
  if (!has(s.channels.category)) { s.channels.category = (await guild.channels.create({ name: 'Modmail', type: CT.GuildCategory, permissionOverwrites: ow })).id; made.push('📁 Modmail category'); }
  else if (role) await guild.channels.cache.get(s.channels.category).permissionOverwrites.edit(role, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }).catch(() => {});
  if (!has(s.channels.logs)) { s.channels.logs = (await guild.channels.create({ name: 'modmail-logs', type: CT.GuildText, permissionOverwrites: ow })).id; made.push('📜 #modmail-logs'); }
  made.push(...(await createLogChannels(guild)));
  if (!has(s.channels.voiceHub)) {
    const cat = await guild.channels.create({ name: 'Temporary Voice', type: CT.GuildCategory });
    s.channels.voiceHub = (await guild.channels.create({ name: '➕ Create Voice', type: CT.GuildVoice, parent: cat.id })).id; made.push('🔊 Temp-voice hub');
  }
  await smartSetup(i, made);
  save();
  return rep(i, E(`${BRAND} bot is ready`, `${made.length ? 'Created:\n' + made.join('\n') : 'Everything already exists.'}\n\n${s.staffRole ? `Staff role: <@&${s.staffRole}>` : '⚠️ No staff role set — only Administrators can see modmail threads. Re-run `/setup staff_role:@role`.'}\n\nLog channels were created automatically — tune them with \`/logs\`, \`/automod\`, \`/escalation\`, \`/raid\`.\nOptional: \`/config channel\` for suggestions, starboard, birthdays, level-ups and application reviews. Users can DM me to open modmail.`));
};
H.config = async i => {
  const g = G(i.guildId), s = g.settings, sc = i.options.getSubcommand();
  if (sc === 'view') {
    const c = s.channels, ch = k => c[k] ? `<#${c[k]}>` : '*not set*';
    return rep(i, E(`${BRAND} settings`).addFields(
      { name: 'Channels', value: `Modmail logs: ${ch('logs')}\nSuggestions: ${ch('suggestions')}\nStarboard: ${ch('starboard')}\nBirthdays: ${ch('birthdays')}\nLevel-ups: ${ch('levelup')}\nApplications: ${ch('applications')}` },
      { name: 'Options', value: `Staff role: ${s.staffRole ? `<@&${s.staffRole}>` : '*not set*'}\nModmail: ${s.modmail ? 'on' : 'off'} • Anonymous replies: ${s.anonymous ? 'on' : 'off'} • Transcript DM: ${s.transcriptDM ? 'on' : 'off'}\nAuto-close: ${s.autoCloseHours ? s.autoCloseHours + 'h' : 'off'} • Stars: ${s.starThreshold} • Leveling: ${s.leveling ? 'on' : 'off'}\nEnforce global bans: ${s.globalBans ? 'on' : 'alert only'}` }));
  }
  if (sc === 'channel') { s.channels[i.options.getString('type')] = i.options.getChannel('channel').id; save(); return rep(i, good('Channel saved.')); }
  if (sc === 'staffrole') { s.staffRole = i.options.getRole('role').id; save(); return rep(i, good('Staff role saved. Re-run `/setup` to grant it access to the modmail category.')); }
  if (sc === 'autoclose') { s.autoCloseHours = i.options.getInteger('hours'); save(); return rep(i, good(s.autoCloseHours ? `Idle threads close after ${s.autoCloseHours}h.` : 'Auto-close disabled.')); }
  if (sc === 'stars') { s.starThreshold = i.options.getInteger('count'); save(); return rep(i, good(`Starboard threshold: ${s.starThreshold}.`)); }
  if (sc === 'toggle') {
    const k = { leveling: 'leveling', transcript_dm: 'transcriptDM', anonymous: 'anonymous', modmail: 'modmail', global_bans: 'globalBans', sticky_roles: 'stickyRoles' }[i.options.getString('feature')];
    s[k] = i.options.getBoolean('enabled'); save(); return rep(i, good(`${i.options.getString('feature')} is now ${s[k] ? 'on' : 'off'}.`));
  }
};
H.dashboard = async i => {
  const g = G(i.guildId), a = A(i.guildId), gd = i.guild, t = now();
  prune(a.msgs, 36e5); prune(a.joins, 36e5);
  const per = {}; for (const m of a.msgs) per[m.c] = (per[m.c] || 0) + 1;
  const top = Object.entries(per).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([c, n]) => `<#${c}> — ${n}`).join('\n') || 'Quiet';
  const risk = raidRisk(a), topXp = Object.entries(g.levels).sort((x, y) => y[1].xp - x[1].xp)[0];
  const pending = Object.values(g.subs).filter(x => x.status === 'pending').length;
  const e = E(`📊 ${gd.name} — server pulse`).setThumbnail(gd.iconURL()).addFields(
    { name: 'Members', value: `${gd.memberCount}`, inline: true },
    { name: 'Msgs / hour', value: `${a.msgs.length}`, inline: true },
    { name: 'Joins / hour', value: `${a.joins.length}`, inline: true },
    { name: 'Raid risk', value: `${risk.label} (${risk.score}/100)\n${risk.joins} joins & ${risk.young} new accounts in 10m`, inline: true },
    { name: 'Open modmail', value: `${Object.keys(g.threads).length}`, inline: true },
    { name: 'Pending applications', value: `${pending}`, inline: true },
    { name: 'Giveaways / polls live', value: `${Object.values(g.giveaways).filter(x => !x.ended).length} / ${Object.values(g.polls).filter(x => !x.ended).length}`, inline: true },
    { name: 'Boosts', value: `${gd.premiumSubscriptionCount || 0} (tier ${gd.premiumTier})`, inline: true },
    { name: 'Top XP', value: topXp ? `<@${topXp[0]}> — level ${lvl(topXp[1].xp).level}` : 'Nobody yet', inline: true },
    { name: 'Busiest channels (1h)', value: top });
  return rep(i, e, false);
};
H.ping = async i => rep(i, E('🏓 Pong!', `Online and answering.\nLatency: **${Math.round(client.ws.ping)} ms** • Uptime: **${fmtDur(process.uptime() * 1000)}**\nBuild: file saved ${fs.statSync(__filename).mtime.toISOString().slice(0, 16).replace('T', ' ')} UTC • Node ${process.version} • discord.js ${DJS}`));
H.help = async i => rep(i, E(`${BRAND} bot`, 'Everything you need to run the network.').addFields(
  { name: '📬 Modmail', value: 'DM the bot to contact staff.\nStaff: `/close` `/claim` `/snippet` `/history` `/contact` `/block` `/transcript`' },
  { name: '🎮 Roblox', value: '`/verify` `/game info` `/game play` `/roblox user` `/roblox whois`\nAdmins: `/gamesetup` `/verification` `/welcome` `/antinuke` `/announce`' },
  { name: '🎖 Pilots', value: '`/profile` `/ranks` `/topgun` `/daily` `/callsign` `/squadron` `/schedule` `/timezone`\nStaff: `/media` `/developmentnotice` `/training` `/event` `/pilotadmin` `/trust` • Owner: `/panic`' },
  { name: '📝 Applications', value: '`/forms` `/apply` • Admins: `/form`' },
  { name: '🎮 Community', value: '`/rank` `/leaderboard` `/suggest` `/remind` `/birthday` `/afk` `/bookmarks` `/voice` ⭐ starboard' },
  { name: '🛡 Moderation', value: '`/flag` `/flags` `/ban` `/unban` `/kick` `/timeout` `/warn` `/warnings` `/case` `/purge` `/slowmode` `/lockdown` `/lookup`\n⚙️ Admins: `/logs` `/automod` `/escalation` `/raid`\n🌐 Network operators: `/gflag` `/gban` `/gunban` `/gflags` `/network`' },
  { name: '🛠 Staff', value: '`/setup` `/config` `/dashboard` `/giveaway` `/poll` `/levelrole` `/autorole` `/suggestion`' }));

/* ═══════════════════════ LEVELS ═══════════════════════ */
const xpCd = new Map();
async function giveXp(m, g) {
  const k = m.guild.id + ':' + m.author.id; if ((xpCd.get(k) || 0) > now() - 60000) return; xpCd.set(k, now());
  const u = g.levels[m.author.id] ||= { xp: 0 }, before = lvl(u.xp).level;
  u.xp += rnd(15, 25); const after = lvl(u.xp).level; save(); checkPromotion(m.guild, m.author.id).catch(() => {});
  if (after > before) {
    const ch = m.guild.channels.cache.get(g.settings.channels.levelup) || m.channel;
    ch.send({ embeds: [E('🎉 Level up!', `${m.author} reached **level ${after}**!`)], allowedMentions: { users: [m.author.id] } }).catch(() => {});
    for (const [lv, rid] of Object.entries(g.levelRoles)) if (+lv <= after && m.member && !m.member.roles.cache.has(rid)) m.member.roles.add(rid, 'Level reward').catch(() => {});
  }
}
H.rank = async i => {
  const g = G(i.guildId), u = i.options.getUser('user') || i.user, xp = g.levels[u.id]?.xp || 0, l = lvl(xp);
  const rankPos = Object.entries(g.levels).sort((a, b) => b[1].xp - a[1].xp).findIndex(([id]) => id === u.id) + 1;
  return rep(i, E(`${u.username}'s rank`).setThumbnail(u.displayAvatarURL()).setDescription(`**Level ${l.level}** • Rank ${rankPos ? '#' + rankPos : 'unranked'}\n${bar(l.cur / l.need, 16)} ${l.cur}/${l.need} XP\nTotal XP: ${xp}`), false);
};
H.leaderboard = async i => {
  const top = Object.entries(G(i.guildId).levels).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);
  return rep(i, E('🏆 Leaderboard', top.map(([id, u], n) => `**${n + 1}.** <@${id}> — level ${lvl(u.xp).level} (${u.xp} XP)`).join('\n') || 'Nobody has earned XP yet.'), false);
};
H.levelrole = async i => {
  const g = G(i.guildId), sc = i.options.getSubcommand();
  if (sc === 'add') { g.levelRoles[i.options.getInteger('level')] = i.options.getRole('role').id; save(); return rep(i, good('Reward saved.')); }
  if (sc === 'remove') { delete g.levelRoles[i.options.getInteger('level')]; save(); return rep(i, good('Reward removed.')); }
  return rep(i, E('Level rewards', Object.entries(g.levelRoles).sort((a, b) => a[0] - b[0]).map(([l, r]) => `Level **${l}** → <@&${r}>`).join('\n') || 'None set.'));
};

/* ═══════════════════════ GIVEAWAYS ═══════════════════════ */
const gwEmbed = (gw, ended) => E(`🎉 ${gw.prize}`, ended
  ? `Winner(s): ${gw.winnerIds.map(w => `<@${w}>`).join(', ') || 'no valid entries'}\nEnded ${ts(gw.end)} • ${gw.entries.length} entries`
  : `Press the button to enter (press again to leave).\nEnds ${ts(gw.end)} (${ts(gw.end, 'F')})\nWinners: **${gw.winners}** • Hosted by <@${gw.host}>`).setColor(ended ? 0x95a5a6 : 0xf1c40f);
async function endGiveaway(gid, id, reroll = false) {
  const g = G(gid), gw = g.giveaways[id]; if (!gw || (gw.ended && !reroll)) return false;
  gw.ended = true; gw.winnerIds = shuffle(gw.entries).slice(0, gw.winners); save();
  const ch = client.channels.cache.get(gw.channelId), msg = ch && await ch.messages.fetch(id).catch(() => null);
  await msg?.edit({ embeds: [gwEmbed(gw, true)], components: [] }).catch(() => {});
  await ch?.send({ content: gw.winnerIds.length ? `🎉 Congratulations ${gw.winnerIds.map(w => `<@${w}>`).join(', ')}! You won **${gw.prize}**!` : `No valid entries for **${gw.prize}**.`, reply: msg ? { messageReference: msg.id, failIfNotExists: false } : undefined }).catch(() => {});
  return true;
}
H.giveaway = async i => {
  const g = G(i.guildId), sc = i.options.getSubcommand();
  if (sc === 'start') {
    const dur = parseDuration(i.options.getString('duration')); if (!dur || dur < 10000 || dur > 30 * 864e5) return rep(i, bad('Duration must be between 10s and 30d, e.g. `1h` or `2d`.'));
    const gw = { prize: clip(i.options.getString('prize'), 200), end: now() + dur, winners: i.options.getInteger('winners') || 1, host: i.user.id, channelId: i.channelId, entries: [], ended: false, winnerIds: [] };
    const msg = await i.channel.send({ embeds: [gwEmbed(gw, false)], components: [row(btn('gw:enter', '🎉 Enter', ButtonStyle.Primary))] });
    gw.id = msg.id; g.giveaways[msg.id] = gw; save(); return rep(i, good('Giveaway started.'));
  }
  if (sc === 'list') return rep(i, E('Active giveaways', Object.values(g.giveaways).filter(x => !x.ended).map(x => `\`${x.id}\` • **${x.prize}** • ends ${ts(x.end)} • ${x.entries.length} entries`).join('\n') || 'None.'));
  const id = i.options.getString('message_id');
  if (sc === 'end') return rep(i, (await endGiveaway(i.guildId, id)) ? good('Giveaway ended.') : bad('No active giveaway with that ID.'));
  if (sc === 'reroll') { if (!g.giveaways[id]?.ended) return rep(i, bad('That giveaway has not ended.')); await endGiveaway(i.guildId, id, true); return rep(i, good('Rerolled.')); }
};

/* ═══════════════════════ POLLS ═══════════════════════ */
function pollEmbed(p, ended) {
  const total = Object.keys(p.votes).length, counts = p.options.map((_, n) => Object.values(p.votes).filter(v => v === n).length);
  return E(`📊 ${p.q}`, p.options.map((o, n) => `**${n + 1}. ${o}**\n${bar(total ? counts[n] / total : 0, 14)} ${counts[n]} (${total ? Math.round(counts[n] / total * 100) : 0}%)`).join('\n\n'))
    .setFooter({ text: `${BRAND} • ${total} vote(s) • ${ended ? 'Poll ended' : p.end ? 'Ends ' + new Date(p.end).toUTCString() : 'Open'}` }).setColor(ended ? 0x95a5a6 : COLOR);
}
async function endPoll(gid, id) {
  const p = G(gid).polls[id]; if (!p || p.ended) return false;
  p.ended = true; save();
  const ch = client.channels.cache.get(p.channelId), msg = ch && await ch.messages.fetch(id).catch(() => null);
  await msg?.edit({ embeds: [pollEmbed(p, true)], components: [] }).catch(() => {});
  return true;
}
H.poll = async i => {
  const g = G(i.guildId), sc = i.options.getSubcommand();
  if (sc === 'end') return rep(i, (await endPoll(i.guildId, i.options.getString('message_id'))) ? good('Poll ended.') : bad('No active poll with that ID.'));
  const opts = i.options.getString('options').split('|').map(s => clip(s.trim(), 80)).filter(Boolean);
  if (opts.length < 2 || opts.length > 10) return rep(i, bad('Give 2–10 options separated by `|`.'));
  const dur = parseDuration(i.options.getString('duration'));
  const p = { q: clip(i.options.getString('question'), 250), options: opts, votes: {}, end: dur ? now() + dur : null, channelId: i.channelId, ended: false };
  const rows = []; for (let k = 0; k < opts.length; k += 5) rows.push(row(...opts.slice(k, k + 5).map((_, n) => btn(`poll:${k + n}`, String(k + n + 1), ButtonStyle.Primary))));
  const msg = await i.channel.send({ embeds: [pollEmbed(p, false)], components: rows });
  g.polls[msg.id] = p; save(); return rep(i, good('Poll created.'));
};

/* ═══════════════════════ REMINDERS ═══════════════════════ */
H.remind = async i => {
  const sc = i.options.getSubcommand(), mine = db.reminders.filter(r => r.userId === i.user.id);
  if (sc === 'add') {
    const d = parseDuration(i.options.getString('when')); if (!d || d < 10000 || d > 365 * 864e5) return rep(i, bad('Use a time between 10s and 365d, e.g. `30m`, `2h`, `1d`.'));
    if (mine.length >= 25) return rep(i, bad('Max 25 reminders.'));
    const r = { id: crypto.randomBytes(3).toString('hex'), userId: i.user.id, channelId: i.channelId, at: now() + d, text: clip(i.options.getString('text'), 500) };
    db.reminders.push(r); save(); return rep(i, good(`I'll remind you ${ts(r.at)} (ID \`${r.id}\`).`));
  }
  if (sc === 'list') return rep(i, E('Your reminders', mine.map(r => `\`${r.id}\` ${ts(r.at)} — ${clip(r.text, 100)}`).join('\n') || 'None.'));
  const id = i.options.getString('id').trim(), idx = db.reminders.findIndex(r => r.id === id && r.userId === i.user.id);
  if (idx < 0) return rep(i, bad('No reminder with that ID.')); db.reminders.splice(idx, 1); save(); return rep(i, good('Reminder cancelled.'));
};

/* ═══════════════════════ SUGGESTIONS ═══════════════════════ */
const suggEmbed = (s, status, by, reason) => E(`💡 Suggestion #${s.id}`, s.text).setAuthor({ name: s.name, iconURL: s.avatar }).setColor(status === 'approve' ? 0x2ecc71 : status === 'deny' ? 0xed4245 : status === 'consider' ? 0xf1c40f : COLOR)
  .addFields(status ? [{ name: `Status: ${status === 'approve' ? 'Approved ✅' : status === 'deny' ? 'Denied ❌' : 'Under consideration 🤔'}`, value: clip(`${by ? `By <@${by}>` : ''}${reason ? `\n${reason}` : ''}` || '\u200b', 1000) }] : []);
H.suggest = async i => {
  const g = G(i.guildId), ch = i.guild.channels.cache.get(g.settings.channels.suggestions);
  if (!ch) return rep(i, bad('No suggestions channel is configured (`/config channel`).'));
  const s = { id: ++g.counters.sugg, userId: i.user.id, name: i.user.username, avatar: i.user.displayAvatarURL(), text: clip(i.options.getString('text'), 1800), status: null };
  const msg = await ch.send({ embeds: [suggEmbed(s)] }); await msg.react('👍').catch(() => {}); await msg.react('👎').catch(() => {});
  s.msgId = msg.id; s.channelId = ch.id; g.suggestions[s.id] = s; save(); return rep(i, good(`Suggestion #${s.id} posted in ${ch}.`));
};
H.suggestion = async i => {
  const g = G(i.guildId), s = g.suggestions[i.options.getInteger('id')]; if (!s) return rep(i, bad('No such suggestion.'));
  const d = i.options.getString('decision'), reason = i.options.getString('reason');
  s.status = d; save();
  const ch = i.guild.channels.cache.get(s.channelId), msg = ch && await ch.messages.fetch(s.msgId).catch(() => null);
  await msg?.edit({ embeds: [suggEmbed(s, d, i.user.id, reason)] }).catch(() => {});
  client.users.fetch(s.userId).then(u => u.send({ embeds: [E(`Your suggestion #${s.id} was ${d === 'consider' ? 'marked under consideration' : d + 'd'}`, reason || null)] })).catch(() => {});
  return rep(i, good(`Suggestion #${s.id}: ${d}.`));
};

/* ═══════════════════════ STARBOARD ═══════════════════════ */
async function onStar(r, u) {
  if (u.bot) return; if (r.partial) await r.fetch(); if (r.message.partial) await r.message.fetch();
  const m = r.message; if (!m.guild || r.emoji.name !== '⭐') return;
  const g = G(m.guild.id), sc = g.settings.channels.starboard; if (!sc || m.channelId === sc || r.count < g.settings.starThreshold) return;
  const ch = m.guild.channels.cache.get(sc); if (!ch) return;
  const content = `⭐ **${r.count}** • <#${m.channelId}>`, ex = g.starboard[m.id];
  if (ex) { const sm = await ch.messages.fetch(ex).catch(() => null); return void sm?.edit({ content }).catch(() => {}); }
  const e = E().setColor(0xf1c40f).setAuthor({ name: m.author?.username || 'Unknown', iconURL: m.author?.displayAvatarURL() }).setDescription(clip(m.content || '', 3500) + `\n\n[Jump to message](${m.url})`);
  const img = [...m.attachments.values()].find(a => a.contentType?.startsWith('image/')); if (img) e.setImage(img.url);
  g.starboard[m.id] = 'pending';
  const sm = await ch.send({ content, embeds: [e] }).catch(() => null);
  if (sm) g.starboard[m.id] = sm.id; else delete g.starboard[m.id]; save();
}

/* ═══════════════════════ SMALL UTILITIES ═══════════════════════ */
H['Bookmark message'] = async i => {
  const g = G(i.guildId), m = i.targetMessage, list = g.bookmarks[i.user.id] ||= [];
  if (list.length >= 25) list.shift();
  list.push({ url: m.url, preview: clip(m.content || '(attachment/embed)', 120), author: m.author.username, at: now() }); save();
  return rep(i, good('Bookmarked. See your list with `/bookmarks`.'));
};
H.bookmarks = async i => {
  const g = G(i.guildId);
  if (i.options.getBoolean('clear')) { delete g.bookmarks[i.user.id]; save(); return rep(i, good('Bookmarks cleared.')); }
  const l = g.bookmarks[i.user.id] || [];
  return rep(i, E('🔖 Your bookmarks', l.slice().reverse().map(b => `[${b.author}](${b.url}) — ${b.preview}`).join('\n') || 'Nothing saved. Right-click a message → Apps → Bookmark message.'));
};
H.birthday = async i => {
  const g = G(i.guildId), sc = i.options.getSubcommand();
  if (sc === 'set') {
    const d = i.options.getInteger('day'), m = i.options.getInteger('month');
    if (d > new Date(2024, m, 0).getDate()) return rep(i, bad('That date does not exist.'));
    g.birthdays[i.user.id] = { d, m }; save(); return rep(i, good(`Birthday set to ${d}/${m}.`));
  }
  if (sc === 'remove') { delete g.birthdays[i.user.id]; save(); return rep(i, good('Birthday removed.')); }
  const t = new Date(), y = t.getUTCFullYear(), today = Date.UTC(y, t.getUTCMonth(), t.getUTCDate());
  const up = Object.entries(g.birthdays).map(([id, b]) => { let dt = Date.UTC(y, b.m - 1, b.d); if (dt < today) dt = Date.UTC(y + 1, b.m - 1, b.d); return { id, b, dt }; }).sort((a, b) => a.dt - b.dt).slice(0, 10);
  return rep(i, E('🎂 Upcoming birthdays', up.map(x => `<@${x.id}> — ${x.b.d}/${x.b.m}`).join('\n') || 'No birthdays set.'));
};
H.autorole = async i => {
  const g = G(i.guildId), sc = i.options.getSubcommand(), r = i.options.getRole('role');
  if (sc === 'add') { if (r.managed || r.position >= i.guild.members.me.roles.highest.position) return rep(i, bad('I cannot assign that role (managed or above my highest role).')); if (!g.autoroles.includes(r.id)) g.autoroles.push(r.id); save(); return rep(i, good(`${r} will be given to new members.`)); }
  if (sc === 'remove') { g.autoroles = g.autoroles.filter(x => x !== r.id); save(); return rep(i, good('Autorole removed.')); }
  return rep(i, E('Autoroles', g.autoroles.map(x => `<@&${x}>`).join('\n') || 'None.'));
};
H.afk = async i => { G(i.guildId).afk[i.user.id] = { reason: clip(i.options.getString('reason') || 'AFK', 150), since: now() }; save(); return rep(i, good('You are now AFK. I\'ll tell people who mention you.'), false); };
H.voice = async i => {
  const g = G(i.guildId), vc = i.member.voice.channel;
  if (!vc || !g.tempvoice[vc.id]) return rep(i, bad('Join one of your temporary voice channels first.'));
  if (g.tempvoice[vc.id] !== i.user.id) return rep(i, bad('Only the channel owner can do that.'));
  const sc = i.options.getSubcommand();
  if (sc === 'lock') await vc.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: false });
  else if (sc === 'unlock') await vc.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: null });
  else if (sc === 'rename') await vc.setName(clip(i.options.getString('name'), 100));
  else if (sc === 'limit') await vc.setUserLimit(i.options.getInteger('count'));
  else if (sc === 'kick') { const u = i.options.getUser('user'), m = vc.members.get(u.id); if (!m || u.id === i.user.id) return rep(i, bad('That user is not in your channel.')); await m.voice.disconnect(); }
  return rep(i, good('Done.'));
};


/* ═══════════════════ MODERATION & MULTI-SERVER NETWORK ═══════════════════ */
const GTAG = `[${BRAND.toUpperCase()} GLOBAL BAN]`;
const ownerIds = new Set();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const parseId = v => (String(v || '').match(/\d{15,20}/) || [])[0] || null;
const isOperator = uid => ownerIds.has(uid) || db.global.operators.includes(uid);
const protectedId = id => id === client.user.id || isOperator(id);
function activeGFlags(uid) { return (db.global.flags[uid] || []).filter(f => !f.removed); }
function activeLocal(g, uid) { return g.cases.filter(c => c.userId === uid && c.type === 'flag' && !c.removed); }
async function loadOwners() {
  try {
    const o = (await client.application.fetch()).owner; if (!o) return;
    if (o.members) for (const m of o.members.values()) ownerIds.add(m.user?.id || m.id); else ownerIds.add(o.id);
    if (o.ownerId) ownerIds.add(o.ownerId);
    console.log(`Network owner(s): ${[...ownerIds].join(', ')}`);
  } catch (e) { console.error('Could not load bot owner', e); }
}
function addCase(g, type, userId, by, reason, extra = {}) {
  g.counters.case = (g.counters.case || 0) + 1;
  const c = { id: g.counters.case, type, userId, by, reason: clip(reason || 'No reason given', 500), at: now(), ...extra };
  g.cases.push(c); if (g.cases.length > 3000) g.cases.shift(); save(); return c;
}
/** central log router: resolves the channel for a log type, honours on/off, never needs an ID from the user */
function logTo(guild, type, embed, opts = {}) {
  const s = G(guild.id).settings, c = s.logs[type];
  if (c && c.on === false) return;
  let id = type === 'modmail' ? s.channels.logs : c?.ch;
  if (!id && ['network', 'automod', 'antinuke', 'verify'].includes(type)) id = s.logs.mod?.ch;
  if (!id && ['mod', 'network', 'automod', 'antinuke', 'verify'].includes(type)) id = s.channels.logs;
  const ch = id && guild.channels.cache.get(id); if (!ch) return;
  return ch.send({ embeds: [embed], content: opts.content, allowedMentions: { roles: s.staffRole ? [s.staffRole] : [] } }).catch(() => {});
}
const modLog = (guild, e) => logTo(guild, 'mod', e);
async function target(i) {
  const id = parseId(i.options.getString('user'));
  if (!id) { await rep(i, bad('Give a valid user mention or ID.')); return null; }
  const user = await client.users.fetch(id).catch(() => null);
  if (!user) await rep(i, bad('User not found.'));
  return user;
}
function canAct(i, member) {
  if (!member) return true; if (member.id === i.guild.ownerId) return false;
  return i.user.id === i.guild.ownerId || i.member.roles.highest.position > member.roles.highest.position;
}
const actionEmbed = (title, user, by, reason, color) => E(title).setColor(color).addFields({ name: 'User', value: `${user} — ${user.username}`, inline: true }, { name: 'Moderator', value: `<@${by}>`, inline: true }, { name: 'Reason', value: clip(reason, 1000) });
const dmUser = (user, title, desc, color) => user.send({ embeds: [E(title, desc).setColor(color)] }).catch(() => {});

// ── local moderation ──
H.flag = async i => {
  const u = await target(i); if (!u) return; const g = G(i.guildId);
  if (protectedId(u.id) || u.id === i.user.id) return rep(i, bad('You cannot flag that user.'));
  const c = addCase(g, 'flag', u.id, i.user.id, i.options.getString('reason'));
  modLog(i.guild, actionEmbed(`🚩 Case #${c.id} — flag`, u, i.user.id, c.reason, 0xf1c40f));
  return rep(i, good(`Flagged ${u} (case #${c.id}). Staff are alerted if they open modmail.`));
};
H.flags = async i => {
  const u = await target(i); if (!u) return; const g = G(i.guildId);
  const fl = g.cases.filter(c => c.userId === u.id && c.type === 'flag');
  return rep(i, E(`🚩 Flags — ${u.username}`, fl.slice(-15).reverse().map(c => `${c.removed ? '~~' : ''}**#${c.id}** ${ts(c.at, 'd')} by <@${c.by}> — ${clip(c.reason, 150)}${c.removed ? '~~ *(removed)*' : ''}`).join('\n') || 'No flags in this server.'));
};
H.unflag = async i => {
  const g = G(i.guildId), c = g.cases.find(x => x.id === i.options.getInteger('case') && x.type === 'flag');
  if (!c || c.removed) return rep(i, bad('No active flag with that case number.'));
  c.removed = true; c.removedBy = i.user.id; save(); return rep(i, good(`Flag #${c.id} removed.`));
};
H.ban = async i => {
  const u = await target(i); if (!u) return; const g = G(i.guildId);
  if (protectedId(u.id) || u.id === i.user.id) return rep(i, bad('You cannot ban that user.'));
  const mem = await i.guild.members.fetch(u.id).catch(() => null);
  if (mem && (!mem.bannable || !canAct(i, mem))) return rep(i, bad('That member has a higher/equal role, or I cannot ban them.'));
  const reason = i.options.getString('reason') || 'No reason given';
  await dmUser(u, `You were banned from ${i.guild.name}`, `**Reason:** ${reason}`, 0xed4245);
  await i.guild.members.ban(u.id, { reason: `${i.user.username}: ${reason}`.slice(0, 512), deleteMessageSeconds: (i.options.getInteger('delete_days') || 0) * 86400 });
  const c = addCase(g, 'ban', u.id, i.user.id, reason);
  modLog(i.guild, actionEmbed(`🔨 Case #${c.id} — ban`, u, i.user.id, reason, 0xed4245));
  return rep(i, good(`Banned ${u.username} (case #${c.id}).`));
};
H.unban = async i => {
  const id = parseId(i.options.getString('user')); if (!id) return rep(i, bad('Give a valid user ID.'));
  const ban = await i.guild.bans.fetch(id).catch(() => null); if (!ban) return rep(i, bad('That user is not banned here.'));
  if (ban.reason?.startsWith(GTAG) && !isOperator(i.user.id)) return rep(i, bad('That is a **global ban**. Only network operators can lift it (`/gunban`).'));
  const reason = i.options.getString('reason') || 'No reason given';
  await i.guild.members.unban(id, `${i.user.username}: ${reason}`.slice(0, 512));
  const c = addCase(G(i.guildId), 'unban', id, i.user.id, reason);
  modLog(i.guild, actionEmbed(`♻️ Case #${c.id} — unban`, ban.user, i.user.id, reason, 0x2ecc71));
  return rep(i, good(`Unbanned ${ban.user.username}.`));
};
H.kick = async i => {
  const u = await target(i); if (!u) return; const mem = await i.guild.members.fetch(u.id).catch(() => null);
  if (!mem) return rep(i, bad('That user is not in this server.'));
  if (protectedId(u.id) || !mem.kickable || !canAct(i, mem)) return rep(i, bad('I cannot kick that member (hierarchy or protected).'));
  const reason = i.options.getString('reason') || 'No reason given';
  await dmUser(u, `You were kicked from ${i.guild.name}`, `**Reason:** ${reason}`, 0xe67e22);
  await mem.kick(`${i.user.username}: ${reason}`.slice(0, 512));
  const c = addCase(G(i.guildId), 'kick', u.id, i.user.id, reason);
  modLog(i.guild, actionEmbed(`👢 Case #${c.id} — kick`, u, i.user.id, reason, 0xe67e22));
  return rep(i, good(`Kicked ${u.username} (case #${c.id}).`));
};
H.timeout = async i => {
  const u = await target(i); if (!u) return; const mem = await i.guild.members.fetch(u.id).catch(() => null);
  const d = parseDuration(i.options.getString('duration'));
  if (!mem) return rep(i, bad('That user is not in this server.'));
  if (!d || d < 10000 || d > 28 * 864e5) return rep(i, bad('Duration must be between 10s and 28d.'));
  if (protectedId(u.id) || !mem.moderatable || !canAct(i, mem)) return rep(i, bad('I cannot timeout that member (hierarchy or protected).'));
  const reason = i.options.getString('reason') || 'No reason given';
  await mem.timeout(d, `${i.user.username}: ${reason}`.slice(0, 512));
  const c = addCase(G(i.guildId), 'timeout', u.id, i.user.id, `${fmtDur(d)} — ${reason}`);
  modLog(i.guild, actionEmbed(`⏳ Case #${c.id} — timeout (${fmtDur(d)})`, u, i.user.id, reason, 0x95a5a6));
  return rep(i, good(`Timed out ${u.username} for ${fmtDur(d)}.`));
};
H.lookup = async i => {
  const u = await target(i); if (!u) return; const g = G(i.guildId);
  const mem = await i.guild.members.fetch(u.id).catch(() => null), ban = await i.guild.bans.fetch(u.id).catch(() => null);
  const cases = g.cases.filter(c => c.userId === u.id), gb = db.global.bans[u.id], gf = activeGFlags(u.id);
  return rep(i, E(`🔎 ${u.username}`).setThumbnail(u.displayAvatarURL()).addFields(
    { name: 'ID', value: u.id, inline: true },
    { name: 'Created', value: ts(u.createdTimestamp), inline: true },
    { name: 'In this server', value: mem ? `Yes — joined ${ts(mem.joinedTimestamp)}` : ban ? `🔨 Banned: ${clip(ban.reason || 'no reason', 100)}` : 'No', inline: true },
    { name: 'Local cases', value: clip(cases.slice(-8).reverse().map(c => `${c.removed ? '~~' : ''}#${c.id} **${c.type}** ${ts(c.at, 'd')} — ${clip(c.reason, 70)}${c.removed ? '~~' : ''}`).join('\n') || 'None', 1000) },
    { name: '🌐 Network', value: clip([gb ? `🔴 **GLOBAL BAN** — ${gb.reason}` : '🟢 Not globally banned', ...gf.map(f => `🚩 ${f.id}: ${f.reason}`)].join('\n'), 1000) }), false);
};

// ── global (network) moderation ──
const needOp = i => { if (isOperator(i.user.id)) return true; rep(i, bad(`Only ${BRAND} network operators can use global actions.`)); return false; };
async function alertGuilds(uid, embed) { // alert servers where the user is currently a member
  for (const guild of client.guilds.cache.values()) { if (await guild.members.fetch(uid).catch(() => null)) logTo(guild, 'network', embed); await sleep(250); }
}
async function banInGuild(guild, uid, rec) {
  const g = G(guild.id); if (!g.settings.globalBans) return 'optout';
  if (await guild.bans.fetch(uid).catch(() => null)) return 'already';
  try {
    await guild.members.ban(uid, { reason: `${GTAG} ${rec.reason}`.slice(0, 512) });
    const c = addCase(g, 'gban', uid, rec.by, rec.reason);
    logTo(guild, 'network', E(`🌐 Case #${c.id} — global ban applied`).setColor(0xed4245).addFields({ name: 'User', value: `<@${uid}>`, inline: true }, { name: 'Issued by', value: `<@${rec.by}>`, inline: true }, { name: 'Reason', value: clip(rec.reason, 900) }, ...(rec.evidence ? [{ name: 'Evidence', value: clip(rec.evidence, 500) }] : [])));
    return 'banned';
  } catch { return 'failed'; }
}
async function syncGuild(guild) {
  const ids = Object.keys(db.global.bans); let n = 0;
  for (let k = 0; k < ids.length; k += 100) {
    const found = await guild.members.fetch({ user: ids.slice(k, k + 100) }).catch(() => null); if (!found) continue;
    for (const m of found.values()) { if (await banInGuild(guild, m.id, db.global.bans[m.id]) === 'banned') n++; await sleep(300); }
  }
  return n;
}
async function onGlobalJoin(mem) {
  const g = G(mem.guild.id), rec = db.global.bans[mem.id];
  if (rec) {
    if (!g.settings.globalBans) { logTo(mem.guild, 'network', E('🌐 Globally banned user joined').setColor(0xed4245).setDescription(`${mem} is globally banned but this server only alerts.\n**Reason:** ${clip(rec.reason, 500)}`)); return false; }
    await dmUser(mem.user, `You are banned from the ${BRAND}`, `You have been globally banned from all ${BRAND} servers.\n**Reason:** ${rec.reason}`, 0xed4245);
    const r = await banInGuild(mem.guild, mem.id, rec); return r === 'banned' || r === 'already';
  }
  const gf = activeGFlags(mem.id), lf = activeLocal(g, mem.id);
  if (gf.length || lf.length) logTo(mem.guild, 'network', E('🚩 Flagged user joined').setColor(0xf1c40f).setDescription(`${mem}\n${[...gf.map(f => `🌐 ${f.id}: ${f.reason}`), ...lf.map(f => `🚩 #${f.id}: ${f.reason}`)].join('\n')}`));
  return false;
}
client.on(Events.GuildCreate, guild => syncGuild(guild).catch(console.error));

H.gflag = async i => {
  if (!needOp(i)) return; const u = await target(i); if (!u) return;
  if (protectedId(u.id)) return rep(i, bad('You cannot flag that user.'));
  const f = { id: 'GF' + (++db.global.n), reason: clip(i.options.getString('reason'), 500), by: i.user.id, at: now(), guildId: i.guildId, removed: false };
  (db.global.flags[u.id] ||= []).push(f); save();
  alertGuilds(u.id, E('🌐 Globally flagged user is here').setColor(0xf1c40f).setDescription(`${u} was flagged network-wide.\n**${f.id}:** ${f.reason}`)).catch(console.error);
  return rep(i, good(`Global flag **${f.id}** added for ${u.username}. Servers where they are a member are being alerted.`));
};
H.gflags = async i => {
  if (!needOp(i)) return; const u = await target(i); if (!u) return; const fl = db.global.flags[u.id] || [], gb = db.global.bans[u.id];
  return rep(i, E(`🌐 Global record — ${u.username}`, [gb ? `🔴 **Globally banned** ${ts(gb.at, 'd')} by <@${gb.by}> — ${gb.reason}` : '🟢 Not globally banned', ...fl.map(f => `${f.removed ? '~~' : ''}**${f.id}** ${ts(f.at, 'd')} by <@${f.by}> — ${clip(f.reason, 150)}${f.removed ? '~~' : ''}`)].join('\n')));
};
H.gunflag = async i => {
  if (!needOp(i)) return; const id = i.options.getString('id').trim().toUpperCase();
  for (const list of Object.values(db.global.flags)) { const f = list.find(x => x.id === id && !x.removed); if (f) { f.removed = true; f.removedBy = i.user.id; save(); return rep(i, good(`Global flag ${id} removed.`)); } }
  return rep(i, bad('No active global flag with that ID.'));
};
H.gban = async i => {
  if (!needOp(i)) return; const u = await target(i); if (!u) return;
  if (protectedId(u.id)) return rep(i, bad('You cannot globally ban that user.'));
  if (db.global.bans[u.id]) return rep(i, bad('That user is already globally banned.'));
  const rec = { reason: clip(i.options.getString('reason'), 450), by: i.user.id, at: now(), evidence: i.options.getString('evidence') || null, origin: i.guildId };
  db.global.bans[u.id] = rec; save();
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  await dmUser(u, `You are banned from the ${BRAND}`, `You have been globally banned from all ${BRAND} servers.\n**Reason:** ${rec.reason}`, 0xed4245);
  const tally = { banned: 0, already: 0, optout: 0, failed: 0 };
  for (const guild of client.guilds.cache.values()) { tally[await banInGuild(guild, u.id, rec)]++; await sleep(300); }
  return rep(i, E(`🌐 Global ban — ${u.username}`).setColor(0xed4245).setDescription(`**Banned:** ${tally.banned} • **Already banned:** ${tally.already} • **Opted out:** ${tally.optout} • **Failed:** ${tally.failed}${tally.failed ? '\n*Failures are usually missing Ban Members permission or role hierarchy.*' : ''}\nThe ban is also enforced automatically whenever they join a network server.`));
};
H.gunban = async i => {
  if (!needOp(i)) return; const id = parseId(i.options.getString('user')); if (!id) return rep(i, bad('Give a valid user ID.'));
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const reason = i.options.getString('reason') || 'No reason given'; delete db.global.bans[id]; save();
  let lifted = 0;
  for (const guild of client.guilds.cache.values()) {
    const ban = await guild.bans.fetch(id).catch(() => null);
    if (ban?.reason?.startsWith(GTAG)) { if (await guild.members.unban(id, `Global unban by ${i.user.username}: ${reason}`.slice(0, 512)).then(() => true).catch(() => false)) { lifted++; addCase(G(guild.id), 'gunban', id, i.user.id, reason); } }
    await sleep(300);
  }
  return rep(i, good(`Global ban removed. Lifted in **${lifted}** server(s). Servers that banned them locally keep that ban.`));
};
H.network = async i => {
  const sc = i.options.getSubcommand(), g = G(i.guildId);
  if (sc === 'status') return rep(i, E(`🌐 ${BRAND} network`).addFields(
    { name: 'Servers', value: String(client.guilds.cache.size), inline: true },
    { name: 'Global bans', value: String(Object.keys(db.global.bans).length), inline: true },
    { name: 'Global flags', value: String(Object.values(db.global.flags).flat().filter(f => !f.removed).length), inline: true },
    { name: 'Operators', value: String(ownerIds.size + db.global.operators.length), inline: true },
    { name: 'This server', value: g.settings.globalBans ? '✅ Enforcing global bans' : '⚠️ Alert only (change with `/config toggle global_bans`)', inline: true }));
  if (sc === 'sync') { await i.deferReply({ flags: MessageFlags.Ephemeral }); const n = await syncGuild(i.guild); return rep(i, good(`Sync complete — banned ${n} globally banned member(s) currently in this server.`)); }
  if (sc === 'op-list') return rep(i, E('Network operators', [...new Set([...ownerIds, ...db.global.operators])].map(id => `<@${id}>${ownerIds.has(id) ? ' (owner)' : ''}`).join('\n') || 'None.'));
  if (sc === 'bans') {
    if (!needOp(i)) return;
    return rep(i, E('Recent global bans', Object.entries(db.global.bans).sort((a, b) => b[1].at - a[1].at).slice(0, 15).map(([id, b]) => `<@${id}> ${ts(b.at, 'd')} — ${clip(b.reason, 80)}`).join('\n') || 'None.'));
  }
  if (!ownerIds.has(i.user.id)) return rep(i, bad('Only the bot owner can manage operators.'));
  const id = parseId(i.options.getString('user')); if (!id) return rep(i, bad('Give a valid user mention or ID.'));
  if (sc === 'op-add') { if (!db.global.operators.includes(id)) db.global.operators.push(id); save(); return rep(i, good(`<@${id}> is now a network operator.`)); }
  db.global.operators = db.global.operators.filter(x => x !== id); save(); return rep(i, good('Operator removed.'));
};


/* ═══════════════════ LOGGING, WARNINGS, AUTOMOD, RAID SHIELD ═══════════════════ */
const staffOw = (guild, s) => {
  const ow = [{ id: guild.roles.everyone.id, deny: [PF.ViewChannel] },
    { id: client.user.id, allow: [PF.ViewChannel, PF.SendMessages, PF.EmbedLinks, PF.AttachFiles, PF.ReadMessageHistory, PF.ManageChannels] }];
  if (s.staffRole) ow.push({ id: s.staffRole, allow: [PF.ViewChannel, PF.ReadMessageHistory], deny: [PF.SendMessages] });
  return ow;
};
async function createLogChannels(guild) {
  const s = G(guild.id).settings, made = [], has = id => id && guild.channels.cache.has(id);
  const missing = LOG_KEYS.filter(t => t !== 'modmail' && !has(s.logs[t]?.ch));
  if (!missing.length) return made;
  if (!has(s.channels.logCategory)) { s.channels.logCategory = (await guild.channels.create({ name: `${BRAND} Logs`, type: CT.GuildCategory, permissionOverwrites: staffOw(guild, s) })).id; made.push('📋 Logs category'); }
  for (const t of missing) {
    const ch = await guild.channels.create({ name: `${t}-log`, type: CT.GuildText, parent: s.channels.logCategory, topic: LOG_TYPES[t] });
    s.logs[t] = { ch: ch.id, on: s.logs[t]?.on !== false }; made.push(`#${t}-log`);
  }
  save(); return made;
}
H.logs = async i => {
  const g = G(i.guildId), s = g.settings, sc = i.options.getSubcommand();
  if (sc === 'setup') { await i.deferReply({ flags: MessageFlags.Ephemeral }); const made = await createLogChannels(i.guild); return rep(i, good(made.length ? `Created: ${made.join(', ')}` : 'All log channels already exist. Use `/logs set` to point a type somewhere else.')); }
  if (sc === 'set') { const t = i.options.getString('type'); if (t === 'modmail') s.channels.logs = i.options.getChannel('channel').id; else s.logs[t] = { ch: i.options.getChannel('channel').id, on: s.logs[t]?.on !== false }; save(); return rep(i, good(`**${t}** logs now go to ${i.options.getChannel('channel')}.`)); }
  if (sc === 'toggle') { const t = i.options.getString('type'), on = i.options.getBoolean('enabled'); if (t === 'modmail') return rep(i, bad('Modmail logs are always on while a channel is set.')); s.logs[t] = { ch: s.logs[t]?.ch || null, on }; save(); return rep(i, good(`**${t}** logs ${on ? 'enabled' : 'disabled'}.`)); }
  if (sc === 'ignore') {
    const ch = i.options.getChannel('channel'), ig = i.options.getBoolean('ignored') ?? true;
    s.logIgnore = s.logIgnore.filter(x => x !== ch.id); if (ig) s.logIgnore.push(ch.id); save();
    return rep(i, good(`${ch} ${ig ? 'is now excluded from' : 'is included in'} message logs.`));
  }
  const line = t => { const ch = t === 'modmail' ? s.channels.logs : (s.logs[t]?.ch || (['network', 'automod'].includes(t) ? s.logs.mod?.ch : null)); return `${s.logs[t]?.on === false ? '🔴' : '🟢'} **${t}** — ${LOG_TYPES[t]}\n└ ${ch ? `<#${ch}>` : '*not set*'}`; };
  return rep(i, E('📋 Log setup', LOG_KEYS.map(line).join('\n') + (s.logIgnore.length ? `\n\nIgnored in message logs: ${s.logIgnore.map(x => `<#${x}>`).join(' ')}` : '') + '\n\nRun `/logs setup` to create any missing channels automatically.'));
};

// ── event logs ──
const ignoredCh = (g, ch) => !ch || g.settings.logIgnore.includes(ch.id) || (ch.parentId && g.settings.logIgnore.includes(ch.parentId));
client.on(Events.MessageDelete, m => {
  try {
    if (!m.guild || m.author?.bot) return; const g = G(m.guild.id); if (g.threads[m.channelId] || ignoredCh(g, m.channel)) return;
    const at = [...(m.attachments?.values() ?? [])];
    const e = E('🗑️ Message deleted').setColor(0xed4245).setDescription(`**Channel:** ${m.channel}\n**Author:** ${m.author || '*unknown*'}\n\n${clip(m.content || '*content not cached*', 1500)}`);
    if (at.length) e.addFields({ name: 'Attachments', value: clip(at.map(a => a.name).join(', '), 500) });
    logTo(m.guild, 'messages', e);
  } catch (e) { console.error(e); }
});
client.on(Events.MessageUpdate, (o, n) => {
  try {
    if (!n.guild || n.author?.bot || o.content == null || n.content == null || o.content === n.content) return;
    const g = G(n.guild.id); if (g.threads[n.channelId] || ignoredCh(g, n.channel)) return;
    logTo(n.guild, 'messages', E('✏️ Message edited').setColor(0xf1c40f).setDescription(`**Channel:** ${n.channel} • **Author:** ${n.author} • [Jump](${n.url})`).addFields({ name: 'Before', value: clip(o.content || '*empty*', 1000) }, { name: 'After', value: clip(n.content || '*empty*', 1000) }));
  } catch (e) { console.error(e); }
});
client.on(Events.MessageBulkDelete, (msgs, ch) => { try { if (ch.guild && !ignoredCh(G(ch.guild.id), ch)) logTo(ch.guild, 'messages', E('🧹 Bulk delete', `**${msgs.size}** messages were deleted in ${ch}.`).setColor(0xed4245)); } catch (e) { console.error(e); } });
client.on(Events.GuildMemberRemove, m => {
  try {
    const roles = m.roles?.cache?.filter(r => r.id !== m.guild.id).map(r => r.toString()).slice(0, 15).join(' ');
    logTo(m.guild, 'members', E('📤 Member left').setColor(0xe67e22).setDescription(`${m.user} — ${m.user.username}${m.joinedTimestamp ? `\nJoined ${ts(m.joinedTimestamp)}` : ''}${roles ? `\nRoles: ${roles}` : ''}`));
  } catch (e) { console.error(e); }
});
client.on(Events.GuildMemberUpdate, (o, n) => {
  try {
    if (o.partial) return; const ch = [];
    if (o.nickname !== n.nickname) ch.push(`**Nickname:** ${o.nickname || '*none*'} → ${n.nickname || '*none*'}`);
    const add = n.roles.cache.filter(r => !o.roles.cache.has(r.id)), rem = o.roles.cache.filter(r => !n.roles.cache.has(r.id));
    if (add.size) ch.push(`**Roles added:** ${add.map(r => r).join(' ')}`); if (rem.size) ch.push(`**Roles removed:** ${rem.map(r => r).join(' ')}`);
    if (o.communicationDisabledUntilTimestamp !== n.communicationDisabledUntilTimestamp) ch.push(n.communicationDisabledUntilTimestamp > now() ? `**Timed out** until ${ts(n.communicationDisabledUntilTimestamp)}` : '**Timeout removed**');
    if (ch.length) logTo(n.guild, 'members', E('👤 Member updated').setColor(COLOR).setDescription(`${n.user} — ${n.user.username}\n${ch.join('\n')}`));
  } catch (e) { console.error(e); }
});
client.on(Events.VoiceStateUpdate, (o, n) => {
  try {
    if (o.channelId === n.channelId || !n.member || n.member.user.bot) return;
    const d = !o.channelId ? `joined ${n.channel}` : !n.channelId ? `left ${o.channel}` : `moved ${o.channel} → ${n.channel}`;
    logTo(n.guild, 'voice', E(null, `🔊 ${n.member} ${d}`).setColor(0x3498db));
  } catch (e) { console.error(e); }
});
const srv = (guild, title, desc, color) => guild && logTo(guild, 'server', E(title, desc).setColor(color));
client.on(Events.ChannelCreate, c => { if (c.guild) srv(c.guild, '➕ Channel created', `${c} (${c.name})`, 0x2ecc71); });
client.on(Events.ChannelDelete, c => { if (c.guild && !G(c.guild.id).tempvoice[c.id]) srv(c.guild, '➖ Channel deleted', `**#${c.name}**`, 0xed4245); });
client.on(Events.GuildRoleCreate, r => srv(r.guild, '➕ Role created', `${r} (${r.name})`, 0x2ecc71));
client.on(Events.GuildRoleDelete, r => srv(r.guild, '➖ Role deleted', `**${r.name}**`, 0xed4245));
client.on(Events.GuildBanAdd, b => srv(b.guild, '🔨 Member banned', `${b.user} — ${b.user.username}${b.reason ? `\n${clip(b.reason, 300)}` : ''}`, 0xed4245));
client.on(Events.GuildBanRemove, b => srv(b.guild, '♻️ Member unbanned', `${b.user} — ${b.user.username}`, 0x2ecc71));

// ── warnings & escalation ──
function activeWarns(g, uid) {
  const d = g.settings.warnExpiryDays;
  return g.cases.filter(c => c.userId === uid && c.type === 'warn' && !c.removed && (!d || now() - c.at < d * 864e5));
}
async function escalate(guild, user) {
  const g = G(guild.id), n = activeWarns(g, user.id).length, rule = g.settings.escalation.find(r => r.warns === n);
  if (!rule) return null;
  const mem = await guild.members.fetch(user.id).catch(() => null);
  if (!mem || protectedId(user.id) || mem.id === guild.ownerId) return null;
  const reason = `Auto-escalation: ${n} active warnings`;
  try {
    if (rule.action === 'timeout') { if (!mem.moderatable) return null; await mem.timeout(rule.ms || 36e5, reason); }
    else {
      await dmUser(user, `You were ${rule.action === 'ban' ? 'banned from' : 'kicked from'} ${guild.name}`, `**Reason:** ${reason}`, 0xed4245);
      if (rule.action === 'kick') { if (!mem.kickable) return null; await mem.kick(reason); } else await guild.members.ban(user.id, { reason });
    }
  } catch { return null; }
  const c = addCase(g, rule.action, user.id, client.user.id, `${reason}${rule.action === 'timeout' ? ` (${fmtDur(rule.ms || 36e5)})` : ''}`);
  modLog(guild, actionEmbed(`⚖️ Case #${c.id} — auto ${rule.action}`, user, client.user.id, c.reason, 0xe74c3c));
  return rule;
}
H.warn = async i => {
  const u = await target(i); if (!u) return; const g = G(i.guildId), mem = await i.guild.members.fetch(u.id).catch(() => null);
  if (u.bot || protectedId(u.id) || u.id === i.user.id || (mem && !canAct(i, mem))) return rep(i, bad('You cannot warn that user.'));
  const c = addCase(g, 'warn', u.id, i.user.id, i.options.getString('reason')), n = activeWarns(g, u.id).length;
  await dmUser(u, `You were warned in ${i.guild.name}`, `**Reason:** ${c.reason}\nActive warnings: **${n}**`, 0xf1c40f);
  modLog(i.guild, actionEmbed(`⚠️ Case #${c.id} — warn (${n} active)`, u, i.user.id, c.reason, 0xf1c40f));
  const rule = await escalate(i.guild, u);
  return rep(i, good(`Warned ${u.username} (case #${c.id}, ${n} active).${rule ? ` **Auto-${rule.action} applied.**` : ''}`));
};
H.warnings = async i => {
  const u = await target(i); if (!u) return; const g = G(i.guildId), w = activeWarns(g, u.id);
  return rep(i, E(`⚠️ Warnings — ${u.username}`, `**${w.length}** active (expire after ${g.settings.warnExpiryDays || '∞'} days)\n\n` + (w.slice(-10).reverse().map(c => `**#${c.id}** ${ts(c.at, 'd')} by <@${c.by}> — ${clip(c.reason, 150)}`).join('\n') || 'None.')));
};
H.clearwarns = async i => {
  const u = await target(i); if (!u) return; const g = G(i.guildId); let n = 0;
  for (const c of g.cases) if (c.userId === u.id && c.type === 'warn' && !c.removed) { c.removed = true; c.removedBy = i.user.id; n++; }
  save(); modLog(i.guild, E(null, `🧽 ${i.user} cleared **${n}** warning(s) for ${u}.`).setColor(0x2ecc71)); return rep(i, good(`Cleared ${n} warning(s) for ${u.username}.`));
};
H.case = async i => {
  const g = G(i.guildId), c = g.cases.find(x => x.id === i.options.getInteger('id')); if (!c) return rep(i, bad('No such case.'));
  return rep(i, E(`Case #${c.id} — ${c.type}`).addFields({ name: 'User', value: `<@${c.userId}>`, inline: true }, { name: 'Moderator', value: `<@${c.by}>`, inline: true }, { name: 'When', value: ts(c.at, 'f'), inline: true }, { name: 'Reason', value: clip(c.reason, 1000) }, ...(c.removed ? [{ name: 'Status', value: `Removed${c.removedBy ? ` by <@${c.removedBy}>` : ''}` }] : [])));
};
H.escalation = async i => {
  const g = G(i.guildId), s = g.settings, sc = i.options.getSubcommand();
  if (sc === 'add') {
    const w = i.options.getInteger('warns'), a = i.options.getString('action'), ms = parseDuration(i.options.getString('duration')) || 36e5;
    if (a === 'timeout' && ms > 28 * 864e5) return rep(i, bad('Timeouts max out at 28 days.'));
    s.escalation = s.escalation.filter(r => r.warns !== w); s.escalation.push({ warns: w, action: a, ms: a === 'timeout' ? ms : undefined }); s.escalation.sort((x, y) => x.warns - y.warns); save();
    return rep(i, good(`At **${w}** active warnings → **${a}**${a === 'timeout' ? ` (${fmtDur(ms)})` : ''}.`));
  }
  if (sc === 'remove') { s.escalation = s.escalation.filter(r => r.warns !== i.options.getInteger('warns')); save(); return rep(i, good('Threshold removed.')); }
  if (sc === 'expiry') { s.warnExpiryDays = i.options.getInteger('days'); save(); return rep(i, good(s.warnExpiryDays ? `Warnings expire after ${s.warnExpiryDays} days.` : 'Warnings never expire.')); }
  return rep(i, E('⚖️ Escalation', s.escalation.map(r => `**${r.warns}** warnings → ${r.action}${r.ms ? ` (${fmtDur(r.ms)})` : ''}`).join('\n') + `\n\nWarnings expire: ${s.warnExpiryDays ? s.warnExpiryDays + ' days' : 'never'}`));
};

// ── automod ──
const INVITE_RE = /(discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i, URL_RE = /https?:\/\/\S+/i, esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const spamMap = new Map(), dupMap = new Map();
const SCAM_RE = /(free\s*nitro|nitro\s*gift|steamcommunity\.com\/gift|discord[-.]?(gift|nitro)\.|free\s*robux|robux\s*(generator|giveaway)|rbx[-.]?(gift|free)|claim\s+your\s+(nitro|robux)|bit\.ly\/|tinyurl\.com\/)/i;
async function automod(m, g) {
  const am = g.settings.automod; if (!am.enabled || !m.member || m.webhookId) return false;
  if (isStaff(m.member, g) || m.member.permissions.has(PF.Administrator) || m.member.roles.cache.some(r => am.exemptRoles.includes(r.id))) return false;
  const txt = m.content; let rule = null, harsh = false, _t;
  const isTrusted = () => (_t ??= trust(m.guild, m.member).score >= 70);
  if (am.scam && SCAM_RE.test(txt)) { rule = 'Scam / phishing link'; harsh = true; }
  else if (am.newLinks && (URL_RE.test(txt) || INVITE_RE.test(txt)) && now() - (m.member.joinedTimestamp || 0) < 10 * 60000) rule = 'Link from a brand-new member';
  else if (am.invites && INVITE_RE.test(txt)) rule = 'Invite link';
  else if (am.links && URL_RE.test(txt) && !isTrusted()) rule = 'Link';
  else if (am.mentions && m.mentions.users.size + m.mentions.roles.size >= am.mentionLimit) rule = 'Mass mention';
  else if (am.words && am.wordList.some(w => new RegExp(`(^|\\W)${esc(w)}(\\W|$)`, 'i').test(txt))) rule = 'Blocked word';
  else if (am.caps && !isTrusted()) { const L = txt.replace(/[^a-zA-Z]/g, ''); if (L.length >= 12 && L.replace(/[^A-Z]/g, '').length / L.length >= 0.7) rule = 'Excessive caps'; }
  if (!rule && am.dupes && txt.length > 3) {
    const k = m.guild.id + ':' + m.author.id, d = dupMap.get(k) || { t: '', n: 0, at: 0 }, low = txt.toLowerCase();
    if (d.t === low && now() - d.at < 30000) d.n++; else { d.t = low; d.n = 1; } d.at = now(); dupMap.set(k, d);
    if (d.n >= 3) { d.n = 0; if (!isTrusted()) rule = 'Repeated messages'; }
  }
  let spam = false;
  if (am.spam) {
    const k = m.guild.id + ':' + m.author.id, arr = (spamMap.get(k) || []).filter(t => t > now() - am.spamSeconds * 1000); arr.push(now()); spamMap.set(k, arr);
    if (arr.length >= am.spamCount) { spam = true; rule = rule || 'Spam'; spamMap.delete(k); }
  }
  if (!rule) return false;
  await m.delete().catch(() => {});
  m.channel.send({ content: `⚠️ ${m.author}, **${rule}** isn't allowed here.`, allowedMentions: { users: [m.author.id] } }).then(x => setTimeout(() => x.delete().catch(() => {}), 6000)).catch(() => {});
  const c = addCase(g, 'warn', m.author.id, client.user.id, `[Automod] ${rule}`);
  logTo(m.guild, 'automod', E(`🤖 Automod — ${rule}`).setColor(0xe67e22).setDescription(`**User:** ${m.author} • **Channel:** ${m.channel}\n**Warnings:** ${activeWarns(g, m.author.id).length} • Case #${c.id}\n\n${clip(txt || '*no text*', 800)}`));
  if ((spam || harsh) && m.member.moderatable) await m.member.timeout((harsh ? 60 : am.timeoutMin) * 60000, `[Automod] ${rule}`).catch(() => {});
  await escalate(m.guild, m.author);
  return true;
}
H.automod = async i => {
  const am = G(i.guildId).settings.automod, sc = i.options.getSubcommand(), on = b => b ? '🟢' : '🔴';
  if (sc === 'view') return rep(i, E('🤖 Automod', `${on(am.enabled)} **Master switch**\n${on(am.spam)} Spam — ${am.spamCount} msgs / ${am.spamSeconds}s → ${am.timeoutMin}m timeout\n${on(am.invites)} Invite links\n${on(am.links)} All links\n${on(am.mentions)} Mass mentions — ${am.mentionLimit}+\n${on(am.caps)} Excessive caps\n${on(am.words)} Blocked words (${am.wordList.length})\n\nEvery hit deletes the message, adds a warning (so \`/escalation\` applies) and is logged. Staff and exempt roles are ignored.\nExempt roles: ${am.exemptRoles.map(r => `<@&${r}>`).join(' ') || 'none'}`));
  if (sc === 'toggle') { am[i.options.getString('rule')] = i.options.getBoolean('on'); save(); return rep(i, good(`Updated. Automod master switch is **${am.enabled ? 'on' : 'off'}**.`)); }
  if (sc === 'mentions-limit') { am.mentionLimit = i.options.getInteger('count'); save(); return rep(i, good(`Limit set to ${am.mentionLimit}.`)); }
  if (sc === 'spam') { am.spamCount = i.options.getInteger('messages'); am.spamSeconds = i.options.getInteger('seconds'); save(); return rep(i, good(`Spam: ${am.spamCount} messages in ${am.spamSeconds}s.`)); }
  if (sc === 'timeout') { am.timeoutMin = i.options.getInteger('minutes'); save(); return rep(i, good(`Spam timeout: ${am.timeoutMin} minutes.`)); }
  if (sc === 'word-add') { const w = i.options.getString('word').toLowerCase().trim(); if (!am.wordList.includes(w)) am.wordList.push(w); if (am.wordList.length > 200) am.wordList.shift(); save(); return rep(i, good('Word added (the filter is on only if `/automod toggle rule:words` is enabled).')); }
  if (sc === 'word-remove') { am.wordList = am.wordList.filter(x => x !== i.options.getString('word').toLowerCase().trim()); save(); return rep(i, good('Word removed.')); }
  if (sc === 'word-list') return rep(i, E('Blocked words', am.wordList.map(w => `||${w}||`).join(', ') || 'None.'));
  const r = i.options.getRole('role'), ex = i.options.getBoolean('exempt') ?? true; am.exemptRoles = am.exemptRoles.filter(x => x !== r.id); if (ex) am.exemptRoles.push(r.id); save();
  return rep(i, good(`${r} is ${ex ? 'now exempt from' : 'no longer exempt from'} automod.`));
};

// ── raid shield, lockdown, purge, slowmode ──
const raidActive = g => g.settings.raid.active && g.settings.raid.until > now();
async function setRaid(guild, on, mins = 30) {
  const g = G(guild.id), r = g.settings.raid;
  if (on) { r.active = true; r.until = now() + mins * 60000; r.blocked = 0; save(); await logTo(guild, 'mod', E('🚨 Raid shield ON', `New members are being removed for **${mins} minutes** (until ${ts(r.until)}).\nTurn it off with \`/raid off\`.`).setColor(0xed4245), { content: g.settings.staffRole ? `<@&${g.settings.staffRole}>` : undefined }); }
  else { const n = r.blocked || 0; r.active = false; r.until = 0; r.blocked = 0; save(); await logTo(guild, 'mod', E('✅ Raid shield OFF', `Removed **${n}** new member(s) while it was active.`).setColor(0x2ecc71)); }
}
H.raid = async i => {
  const g = G(i.guildId), r = g.settings.raid, sc = i.options.getSubcommand();
  if (sc === 'on') { await setRaid(i.guild, true, i.options.getInteger('minutes') || 30); return rep(i, good('Raid shield enabled.')); }
  if (sc === 'off') { if (!r.active) return rep(i, bad('The raid shield is not active.')); await setRaid(i.guild, false); return rep(i, good('Raid shield disabled.')); }
  if (sc === 'auto') { r.auto = i.options.getBoolean('enabled'); save(); return rep(i, good(`Auto-enable is ${r.auto ? 'on' : 'off'}.`)); }
  const risk = raidRisk(A(i.guildId));
  return rep(i, E('🛡️ Raid shield').setDescription(`Status: ${raidActive(g) ? `🔴 **ACTIVE** until ${ts(r.until)} — ${r.blocked || 0} removed` : '🟢 Inactive'}\nAuto-enable: ${r.auto ? 'on (at risk 60+)' : 'off'}\nCurrent risk: ${risk.label} (${risk.score}/100)`));
};
H.lockdown = async i => {
  const on = i.options.getSubcommand() === 'on', ch = i.channel, ev = i.guild.roles.everyone;
  if (!ch.permissionOverwrites) return rep(i, bad('Cannot lock this channel type.'));
  await ch.permissionOverwrites.edit(ev, { SendMessages: on ? false : null }, { reason: `Lockdown by ${i.user.username}` });
  modLog(i.guild, E(`${on ? '🔒 Channel locked' : '🔓 Channel unlocked'}`, `${ch} by ${i.user}${on && i.options.getString('reason') ? `\n${i.options.getString('reason')}` : ''}`).setColor(on ? 0xed4245 : 0x2ecc71));
  return rep(i, E(null, on ? `🔒 This channel is locked.${i.options.getString('reason') ? `\n${i.options.getString('reason')}` : ''}` : '🔓 This channel is unlocked.').setColor(on ? 0xed4245 : 0x2ecc71), false);
};
H.slowmode = async i => { const s = i.options.getInteger('seconds'); await i.channel.setRateLimitPerUser(s, `By ${i.user.username}`); modLog(i.guild, E(null, `🐢 Slowmode in ${i.channel} set to **${s || 'off'}**${s ? 's' : ''} by ${i.user}.`)); return rep(i, good(`Slowmode ${s ? `set to ${s}s` : 'disabled'}.`)); };
H.purge = async i => {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const u = i.options.getUser('user'), amt = i.options.getInteger('amount');
  let msgs = await i.channel.messages.fetch({ limit: 100 }); msgs = msgs.filter(m => (!u || m.author.id === u.id) && now() - m.createdTimestamp < 13.5 * 864e5).first(amt);
  const del = await i.channel.bulkDelete(msgs, true).catch(() => null);
  modLog(i.guild, E(null, `🧹 ${i.user} purged **${del?.size || 0}** message(s) in ${i.channel}${u ? ` from ${u}` : ''}.`));
  return rep(i, good(`Deleted ${del?.size || 0} message(s). (Discord can't bulk-delete messages older than 14 days.)`));
};


/* ═══════════════════ ROBLOX: API, GAME, VERIFICATION, WELCOMER ═══════════════════ */
const rbx = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Roblox ${r.status}`);
  return r.json();
};
const rcache = new Map();
async function cached(key, ttl, fn) { const c = rcache.get(key); if (c && now() - c.t < ttl) return c.v; const v = await fn(); rcache.set(key, { t: now(), v }); return v; }
const rbxUserByName = async n => (await rbx('https://users.roblox.com/v1/usernames/users', { method: 'POST', body: JSON.stringify({ usernames: [n], excludeBannedUsers: true }) })).data?.[0] || null;
const rbxUser = id => rbx(`https://users.roblox.com/v1/users/${id}`);
const rbxHead = async id => (await rbx(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=150x150&format=Png`).catch(() => ({}))).data?.[0]?.imageUrl || null;
const profileUrl = id => `https://www.roblox.com/users/${id}/profile`;
const gameUrl = gm => gm.placeId ? `https://www.roblox.com/games/${gm.placeId}` : null;
const linkBtn = (label, url, emoji) => { const b = new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url); if (emoji) b.setEmoji(emoji); return b; };
const gameButtons = s => { const b = [], u = gameUrl(s.game); if (u) b.push(linkBtn('Play on Roblox', u, '▶️')); if (s.game.group) b.push(linkBtn('Join our group', s.game.group, '👥')); return b.length ? [row(...b)] : []; };

async function resolveGame(input) {
  const m = String(input).match(/(?:games|experiences)\/(\d+)/) || String(input).trim().match(/^(\d{5,})$/); if (!m) return null;
  const u = await rbx(`https://apis.roblox.com/universes/v1/places/${m[1]}/universe`);
  return u.universeId ? { placeId: m[1], universeId: String(u.universeId) } : null;
}
const gameInfo = gm => cached('game' + gm.universeId, 5 * 60000, async () => {
  const u = gm.universeId;
  const [info, votes, icon] = await Promise.all([
    rbx(`https://games.roblox.com/v1/games?universeIds=${u}`),
    rbx(`https://games.roblox.com/v1/games/votes?universeIds=${u}`).catch(() => ({})),
    rbx(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${u}&size=256x256&format=Png`).catch(() => ({})),
  ]);
  const d = info.data?.[0]; if (!d) throw new Error('game not found');
  const v = votes.data?.[0] || {}, tot = (v.upVotes || 0) + (v.downVotes || 0);
  return { name: d.name, description: d.description || '', playing: d.playing || 0, visits: d.visits || 0, favorites: d.favoritedCount || 0, maxPlayers: d.maxPlayers, updated: d.updated, creator: d.creator?.name, rating: tot ? Math.round(v.upVotes / tot * 100) : null, icon: icon.data?.[0]?.imageUrl || null };
});
const gameEmbed = (info, gm) => E(`🎮 ${info.name}`, clip(info.description, 350)).setURL(gameUrl(gm)).setThumbnail(info.icon).addFields(
  { name: '👥 Playing now', value: info.playing.toLocaleString(), inline: true },
  { name: '👁 Visits', value: info.visits.toLocaleString(), inline: true },
  { name: '⭐ Favorites', value: info.favorites.toLocaleString(), inline: true },
  { name: '👍 Rating', value: info.rating === null ? 'n/a' : info.rating + '%', inline: true },
  { name: '🔄 Last updated', value: info.updated ? ts(Date.parse(info.updated)) : 'n/a', inline: true },
  { name: '🛠 Creator', value: info.creator || 'n/a', inline: true });
H.game = async i => {
  const gm = G(i.guildId).settings.game; if (!gm.placeId) return rep(i, bad('The game has not been linked yet. An admin can use `/gamesetup set`.'));
  if (i.options.getSubcommand() === 'play') return rep(i, { embeds: [E(`▶️ Play ${gm.name || BRAND}`, 'Press the button to jump in!')], components: gameButtons(G(i.guildId).settings) }, false);
  await i.deferReply();
  try { const info = await gameInfo(gm); return rep(i, { embeds: [gameEmbed(info, gm)], components: gameButtons(G(i.guildId).settings) }, false); }
  catch { return rep(i, bad('Roblox did not respond. Try again in a moment.')); }
};
H.gamesetup = async i => {
  const s = G(i.guildId).settings, gm = s.game, sc = i.options.getSubcommand();
  if (sc === 'set') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const g = await resolveGame(i.options.getString('url')).catch(() => null);
    if (!g) return rep(i, bad('I could not read that link. Use the full game page URL, like `https://www.roblox.com/games/123456789/Name`.'));
    const grp = i.options.getString('group'); if (grp && !/^https?:\/\/(www\.)?roblox\.com\//i.test(grp)) return rep(i, bad('The group link must be a roblox.com URL.'));
    Object.assign(gm, { placeId: g.placeId, universeId: g.universeId, lastUpdated: null }); if (grp) gm.group = grp;
    const info = await gameInfo(gm).catch(() => null); gm.name = info?.name || null; gm.lastUpdated = info?.updated || null; save();
    return rep(i, info ? { embeds: [good(`Linked **${info.name}**. Game updates, live stats and the Play buttons are now automatic.`), gameEmbed(info, gm)] } : good('Game linked (stats unavailable right now).'));
  }
  if (sc === 'updates') { gm.updatesChannel = i.options.getChannel('channel').id; const r = i.options.getRole('ping'); if (r) gm.updatesRole = r.id; save(); return rep(i, good(`Approved development notices will be posted in ${i.options.getChannel('channel')}${r ? ` and ping ${r}` : ''}.`)); }
  if (sc === 'review') { gm.reviewChannel = i.options.getChannel('channel').id; save(); return rep(i, good(`Development notices will wait for approval in ${i.options.getChannel('channel')}.`)); }
  const on = i.options.getBoolean('enabled');
  if (!on) { const old = i.guild.channels.cache.get(gm.statusChannel); gm.statusChannel = null; save(); await old?.delete().catch(() => {}); return rep(i, good('Status channel removed.')); }
  if (!gm.universeId) return rep(i, bad('Link the game first with `/gamesetup set`.'));
  if (i.guild.channels.cache.has(gm.statusChannel)) return rep(i, bad('The status channel already exists.'));
  const ch = await i.guild.channels.create({ name: '🎮 Playing: …', type: CT.GuildVoice, permissionOverwrites: [{ id: i.guild.roles.everyone.id, deny: [PF.Connect] }] });
  gm.statusChannel = ch.id; save(); gameTick(i.guildId, G(i.guildId), true).catch(() => {});
  return rep(i, good(`Created ${ch} — it updates every 10 minutes.`));
};
async function gameTick(gid, g, force = false) {
  const gm = g.settings.game; if (!gm.universeId) return;
  const guild = client.guilds.cache.get(gid); if (!guild) return;
  let info; try { info = await gameInfo(gm); } catch { return; }
  gm.name = info.name;
  // no automatic posts: staff announce changes themselves with /developmentnotice
  if (info.updated) gm.lastUpdated = info.updated; save();
  if (gm.statusChannel && (force || tickN % 40 === 0)) { const ch = guild.channels.cache.get(gm.statusChannel), n = `🎮 Playing: ${info.playing.toLocaleString()}`; if (ch && ch.name !== n) ch.setName(n).catch(() => {}); }
  client.user.setPresence({ activities: [{ name: `${info.playing.toLocaleString()} playing ${info.name}`, type: ActivityType.Watching }], status: 'online' });
}
H.roblox = async i => {
  const sc = i.options.getSubcommand();
  if (sc === 'whois') {
    const u = i.options.getUser('user'), l = db.global.links[u.id];
    return rep(i, l ? E(`🔗 ${u.username}`, `Roblox: **[${l.name}](${profileUrl(l.rid)})**\nLinked ${ts(l.at, 'd')}`) : E(null, `${u} has not linked a Roblox account.`));
  }
  await i.deferReply();
  try {
    const found = await rbxUserByName(i.options.getString('username')); if (!found) return rep(i, bad('No Roblox user with that name.'));
    const [u, head] = await Promise.all([rbxUser(found.id), rbxHead(found.id)]);
    const linked = Object.entries(db.global.links).find(([, l]) => l.rid === found.id);
    return rep(i, { embeds: [E(`${u.displayName} (@${u.name})`, clip(u.description || '*No description*', 400)).setURL(profileUrl(u.id)).setThumbnail(head).addFields({ name: 'Created', value: ts(Date.parse(u.created)), inline: true }, { name: 'Discord', value: linked ? `<@${linked[0]}>` : 'Not linked', inline: true }, ...(u.isBanned ? [{ name: 'Status', value: '🚫 Banned' }] : []))], components: [row(linkBtn('Open profile', profileUrl(u.id)))] }, false);
  } catch { return rep(i, bad('Roblox did not respond. Try again in a moment.')); }
};

// ── verification ──
const vpending = new Map();
async function postVerifyPanel(guild, channel) {
  const v = G(guild.id).settings.verify, ch = channel || guild.channels.cache.get(v.channel); if (!ch) return null;
  const msg = await ch.send({
    embeds: [E(`🔐 Verify to join ${BRAND}`, v.mode === 'roblox' ? 'Press **Verify** and enter your Roblox username. You will get a short code to paste into your Roblox profile description — that proves the account is yours.\nYour server nickname is set to your Roblox name automatically.' : 'Press **Verify** to unlock the server.')],
    components: [row(btn('ver:start', 'Verify', ButtonStyle.Success))],
  });
  v.channel = ch.id; save(); return msg;
}
async function finishVerify(guild, member, rid, name, returning) {
  const v = G(guild.id).settings.verify;
  if (rid) db.global.links[member.id] = { rid, name, at: now() };
  bump(G(guild.id), 'verified');
  await member.roles.add(v.role, 'Verified').catch(() => {});
  { const cadet = G(guild.id).settings.rankRoles[0]; if (cadet) member.roles.add(cadet).catch(() => {}); }
  if (v.unverified) await member.roles.remove(v.unverified, 'Verified').catch(() => {});
  if (rid && v.nick && member.manageable) await member.setNickname(clip(name, 32), 'Roblox verification').catch(() => {});
  save();
  logTo(guild, 'verify', E('✅ Member verified').setColor(0x2ecc71).setDescription(`${member}${rid ? ` ↔ [${name}](${profileUrl(rid)})` : ''}${returning ? ' *(returning member)*' : ''}`));
}
async function startVerify(i) {
  const v = G(i.guildId).settings.verify;
  if (!v.role) return rep(i, bad('Verification is not set up yet — an admin needs to run `/setup`.'));
  if (i.member.roles.cache.has(v.role)) return rep(i, good('You are already verified.'));
  const link = db.global.links[i.user.id];
  if (link) { await finishVerify(i.guild, i.member, link.rid, link.name, true); return rep(i, good(`Welcome back! You are verified as **${link.name}**.`)); }
  if (v.minAccountDays && now() - i.user.createdTimestamp < v.minAccountDays * 864e5) return rep(i, bad(`Your Discord account must be at least ${v.minAccountDays} days old to verify.`));
  if (v.mode === 'button') { await finishVerify(i.guild, i.member, null, null); return rep(i, good('You are verified. Welcome!')); }
  return i.showModal(new ModalBuilder().setCustomId('verm').setTitle('Verify with Roblox').addComponents(row(new TextInputBuilder().setCustomId('rbxname').setLabel('Your Roblox username').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(3).setMaxLength(20))));
}
async function onVerifyModal(i) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  let u; try { u = await rbxUserByName(i.fields.getTextInputValue('rbxname').trim()); } catch { return rep(i, bad('Roblox did not respond. Try again in a minute.')); }
  if (!u) return rep(i, bad('No Roblox user with that name was found.'));
  if (Object.entries(db.global.links).some(([d, l]) => l.rid === u.id && d !== i.user.id)) return rep(i, bad('That Roblox account is already linked to another Discord account. Contact staff if it is yours.'));
  const code = `${INITIALS}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  vpending.set(i.user.id, { rid: u.id, name: u.name, code, guildId: i.guildId, at: now(), tries: 0 });
  return rep(i, { embeds: [E('Almost there!', `1. Open your Roblox profile: [${u.name}](${profileUrl(u.id)})\n2. Paste this code anywhere in your **About / description**:\n\`\`\`${code}\`\`\`\n3. Come back and press **I added the code**.\n\nThe code expires in 15 minutes.`)], components: [row(btn('ver:check', 'I added the code', ButtonStyle.Success), btn('ver:cancel', 'Cancel', ButtonStyle.Danger))] });
}
async function onVerifyButton(i) {
  if (i.customId === 'ver:start') return startVerify(i);
  if (i.customId === 'ver:cancel') { vpending.delete(i.user.id); return i.update({ embeds: [E(null, 'Verification cancelled.')], components: [] }); }
  const p = vpending.get(i.user.id);
  if (!p || now() - p.at > 15 * 60000 || ++p.tries > 12) { vpending.delete(i.user.id); return i.update({ embeds: [bad('This verification expired. Press **Verify** to start again.')], components: [] }); }
  let d; try { d = await rbxUser(p.rid); } catch { return rep(i, bad('Roblox did not respond. Try again in a moment.')); }
  if (!(d.description || '').includes(p.code)) return rep(i, bad(`I cannot see \`${p.code}\` in the description of **${p.name}** yet. Save your profile and try again (it can take a few seconds).`));
  vpending.delete(i.user.id);
  const guild = client.guilds.cache.get(p.guildId), mem = guild && await guild.members.fetch(i.user.id).catch(() => null);
  if (!mem) return i.update({ embeds: [bad('Could not find you in the server.')], components: [] });
  await finishVerify(guild, mem, p.rid, p.name);
  return i.update({ embeds: [good(`Verified as **${p.name}**! You can remove the code from your profile now.`)], components: [] });
}
H.verify = startVerify;
async function lockUnverified(guild, lock) {
  const s = G(guild.id).settings, v = s.verify, open = new Set([v.channel, s.welcome.channel]); let n = 0;
  for (const ch of guild.channels.cache.values()) {
    if (!ch.permissionOverwrites || ch.isThread()) continue;
    try {
      if (!lock) await ch.permissionOverwrites.delete(v.unverified);
      else if (open.has(ch.id)) await ch.permissionOverwrites.edit(v.unverified, { ViewChannel: true, SendMessages: false });
      else await ch.permissionOverwrites.edit(v.unverified, { ViewChannel: false });
      n++;
    } catch {}
    await sleep(350);
  }
  return n;
}
async function verifyTick(gid, g) { // kick members who never verified
  const v = g.settings.verify, guild = client.guilds.cache.get(gid); if (!guild || !v.unverified || !v.kickHours) return;
  await guild.members.fetch().catch(() => null);
  for (const m of guild.members.cache.values()) {
    if (m.user.bot || !m.roles.cache.has(v.unverified) || m.roles.cache.has(v.role) || now() - (m.joinedTimestamp || now()) < v.kickHours * 36e5 || !m.kickable) continue;
    await dmUser(m.user, `You were removed from ${guild.name}`, `You did not verify within ${v.kickHours} hours. You are welcome to rejoin and verify any time.`, 0xe67e22);
    await m.kick('Did not verify in time').catch(() => {}); logTo(guild, 'verify', E(null, `⏱️ ${m.user} was removed for not verifying in ${v.kickHours}h.`).setColor(0xe67e22)); await sleep(500);
  }
}
H.verification = async i => {
  const s = G(i.guildId).settings, v = s.verify, sc = i.options.getSubcommand();
  if (sc === 'panel') { const ch = i.options.getChannel('channel') || i.channel; await postVerifyPanel(i.guild, ch); return rep(i, good(`Panel posted in ${ch}.`)); }
  if (sc === 'config') {
    const mode = i.options.getString('mode'), role = i.options.getRole('role'), un = i.options.getRole('unverified'), kh = i.options.getInteger('kick_hours'), age = i.options.getInteger('min_age_days'), nick = i.options.getBoolean('nickname');
    if (mode) v.mode = mode; if (role) v.role = role.id; if (un) v.unverified = un.id; if (kh !== null) v.kickHours = kh; if (age !== null) v.minAccountDays = age; if (nick !== null) v.nick = nick; save();
    return rep(i, E('🔐 Verification', `Mode: **${v.mode}** • Verified role: ${v.role ? `<@&${v.role}>` : '*none*'} • Unverified role: ${v.unverified ? `<@&${v.unverified}>` : '*none*'}\nKick unverified after: ${v.kickHours ? v.kickHours + 'h' : 'never'} • Min account age: ${v.minAccountDays || 0}d • Roblox nickname: ${v.nick ? 'on' : 'off'}`));
  }
  if (sc === 'manual') {
    const u = i.options.getUser('user'), mem = await i.guild.members.fetch(u.id).catch(() => null); if (!mem) return rep(i, bad('That user is not in this server.'));
    if (!v.role) return rep(i, bad('Run `/setup` first.')); await i.deferReply({ flags: MessageFlags.Ephemeral });
    const ru = await rbxUserByName(i.options.getString('roblox_name')).catch(() => null); if (!ru) return rep(i, bad('Roblox user not found.'));
    await finishVerify(i.guild, mem, ru.id, ru.name); return rep(i, good(`${u} verified as **${ru.name}**.`));
  }
  if (sc === 'unlink') {
    const u = i.options.getUser('user'); if (!db.global.links[u.id]) return rep(i, bad('That member has no linked account.'));
    delete db.global.links[u.id]; save(); const mem = await i.guild.members.fetch(u.id).catch(() => null);
    if (mem && v.role) await mem.roles.remove(v.role).catch(() => {}); if (mem && v.unverified) await mem.roles.add(v.unverified).catch(() => {});
    return rep(i, good(`Unlinked ${u}. They will need to verify again.`));
  }
  if (!v.unverified) return rep(i, bad('Run `/setup` first so the Unverified role exists.'));
  await i.deferReply({ flags: MessageFlags.Ephemeral }); const n = await lockUnverified(i.guild, sc === 'lock');
  return rep(i, good(sc === 'lock' ? `Locked ${n} channels for Unverified members (only verify and welcome stay visible).` : `Removed the lock from ${n} channels.`));
};

// ── welcomer ──
const fillTpl = (t, mem, g) => t.replaceAll('{user}', `${mem}`).replaceAll('{username}', mem.user.username).replaceAll('{server}', mem.guild.name).replaceAll('{count}', String(mem.guild.memberCount)).replaceAll('{game}', g.settings.game.name || BRAND).replaceAll('{verify}', g.settings.verify.channel ? `<#${g.settings.verify.channel}>` : 'the verify channel');
async function sendWelcome(mem, g, forced = false) {
  const w = g.settings.welcome; if (!w.enabled && !forced) return false;
  const e = E(`👋 Welcome to ${mem.guild.name}!`, fillTpl(w.message, mem, g)).setThumbnail(mem.user.displayAvatarURL()).setFooter({ text: `${BRAND} • Member #${mem.guild.memberCount}` });
  if (w.banner) e.setImage(w.banner);
  const comps = gameButtons(g.settings);
  const ch = mem.guild.channels.cache.get(w.channel);
  if (ch) await ch.send({ content: `${mem}`, embeds: [e], components: comps, allowedMentions: { users: [mem.id] } }).catch(() => {});
  if (w.dm && !forced) await mem.send({ embeds: [e], components: comps }).catch(() => {});
  return !!ch;
}
async function onJoinFlow(mem, g) {
  if (mem.user.bot) { antiBotAdd(mem).catch(console.error); return; }
  const v = g.settings.verify, link = db.global.links[mem.id];
  if (v.role) {
    if (link) { await mem.roles.add(v.role, 'Previously verified').catch(() => {}); if (v.nick && mem.manageable) mem.setNickname(clip(link.name, 32)).catch(() => {}); logTo(mem.guild, 'verify', E(null, `🔁 ${mem} was auto-verified as **${link.name}** (returning member).`).setColor(0x2ecc71)); }
    else if (v.unverified) await mem.roles.add(v.unverified, 'Awaiting verification').catch(() => {});
  }
  await sendWelcome(mem, g);
}
client.on(Events.GuildMemberRemove, m => {
  try {
    const g = G(m.guild.id), w = g.settings.welcome, ch = m.guild.channels.cache.get(w.leaveChannel);
    bump(g, 'leaves');
    if (g.settings.stickyRoles && m.roles?.cache) { g.sticky[m.id] = m.roles.cache.filter(r => r.id !== m.guild.id && !r.managed && r.id !== g.settings.verify.unverified && !DANGER.some(p => r.permissions.has(p))).map(r => r.id).slice(0, 20); save(); }
    if (ch && !m.user.bot) ch.send({ embeds: [E(null, `👋 **${m.user.username}** left the server.`).setColor(0x95a5a6)] }).catch(() => {});
    if (g.settings.antinuke.enabled) auditScan(m.guild, AuditLogEvent.MemberKick, 'kick').catch(() => {});
  } catch (e) { console.error(e); }
});
H.welcome = async i => {
  const g = G(i.guildId), w = g.settings.welcome, sc = i.options.getSubcommand();
  if (sc === 'toggle') { w.enabled = i.options.getBoolean('enabled'); save(); return rep(i, good(`Welcomer ${w.enabled ? 'enabled' : 'disabled'}.`)); }
  if (sc === 'test') { const ok = await sendWelcome(i.member, g, true); return rep(i, ok ? good('Sent a preview to the welcome channel.') : bad('No welcome channel is set. Use `/welcome set channel:`.')); }
  if (sc === 'set') {
    const ch = i.options.getChannel('channel'), msg = i.options.getString('message'), ban = i.options.getString('banner'), dm = i.options.getBoolean('dm'), lv = i.options.getChannel('leave_channel');
    if (ban && !/^https:\/\//i.test(ban)) return rep(i, bad('The banner must be an https:// image link.'));
    if (ch) w.channel = ch.id; if (msg) w.message = clip(msg.replaceAll('\\n', '\n'), 1500); if (ban) w.banner = ban; if (dm !== null) w.dm = dm; if (lv) w.leaveChannel = lv.id; save();
  }
  return rep(i, E('👋 Welcomer', `${w.enabled ? '🟢 On' : '🔴 Off'} • Channel: ${w.channel ? `<#${w.channel}>` : '*not set*'} • DM: ${w.dm ? 'yes' : 'no'} • Leave messages: ${w.leaveChannel ? `<#${w.leaveChannel}>` : 'off'}\n\n**Message:**\n${w.message}\n\nPlaceholders: \`{user} {username} {server} {count} {game} {verify}\``));
};
H.announce = async i => {
  const ch = i.options.getChannel('channel') || i.channel, ping = i.options.getString('ping') || 'none';
  const g = G(i.guildId), e = E(i.options.getString('title'), i.options.getString('message').replaceAll('\\n', '\n')).setAuthor({ name: i.member.displayName, iconURL: i.member.displayAvatarURL() });
  await ch.send({ content: ping === 'none' ? undefined : `@${ping}`, embeds: [e], components: i.options.getBoolean('game_button') ? gameButtons(g.settings) : [], allowedMentions: { parse: ping === 'none' ? [] : [ping] } });
  return rep(i, good(`Announcement posted in ${ch}.`));
};

/* ═══════════════════ ANTI-NUKE ═══════════════════ */
const DANGER = [PF.Administrator, PF.ManageGuild, PF.ManageRoles, PF.ManageChannels, PF.BanMembers, PF.KickMembers, PF.ManageWebhooks];
const nukeHits = new Map(), nukeSnap = new Map(), nukeCreated = new Map(), nukeLocked = new Set(), seenAudit = new Set(), scanState = new Map();
const anTrusted = (guild, g, uid) => uid === guild.ownerId || uid === client.user.id || ownerIds.has(uid) || g.settings.antinuke.whitelist.includes(uid);
const remap = (v, map) => { if (typeof v === 'string') return map[v] || v; if (Array.isArray(v)) return v.map(x => remap(x, map)); if (v && typeof v === 'object') { for (const k in v) v[k] = remap(v[k], map); } return v; };
const pushCap = (m, gid, item) => { const l = m.get(gid) || []; l.push(item); if (l.length > 80) l.shift(); m.set(gid, l); };
async function auditExec(guild, type, targetId) {
  await sleep(800);
  try { const logs = await guild.fetchAuditLogs({ type, limit: 8 }); const e = [...logs.entries.values()].find(x => (!targetId || x.targetId === targetId) && now() - x.createdTimestamp < 10000); return e ? { uid: e.executorId, entry: e } : null; } catch { return null; }
}
async function auditScan(guild, type, action) { // for bursts (bans/kicks): scan the audit log once, count each entry once
  const k = guild.id + type, st = scanState.get(k) || {};
  if (st.busy) { st.again = true; scanState.set(k, st); return; }
  st.busy = true; scanState.set(k, st);
  do {
    st.again = false; await sleep(900);
    const logs = await guild.fetchAuditLogs({ type, limit: 10 }).catch(() => null);
    if (logs) for (const e of [...logs.entries.values()].reverse()) { if (seenAudit.has(e.id) || now() - e.createdTimestamp > 15000) continue; seenAudit.add(e.id); if (seenAudit.size > 3000) seenAudit.clear(); await nukeHit(guild, e.executorId, action); }
  } while (st.again);
  st.busy = false;
}
async function nukeAlert(guild, title, desc, ping) {
  const g = G(guild.id);
  await logTo(guild, 'antinuke', E(title, desc).setColor(0xed4245), { content: ping && g.settings.staffRole ? `<@&${g.settings.staffRole}>` : undefined });
  if (ping) guild.fetchOwner().then(o => o.send({ embeds: [E(`🛡️ ${guild.name}: ${title}`, desc).setColor(0xed4245)] })).catch(() => {});
}
async function nukeHit(guild, uid, action) {
  const g = G(guild.id), an = g.settings.antinuke; if (!an.enabled || !uid || anTrusted(guild, g, uid)) return;
  const k = `${guild.id}:${uid}:${action}`, arr = (nukeHits.get(k) || []).filter(t => t > now() - an.windowSec * 1000); arr.push(now()); nukeHits.set(k, arr);
  if (arr.length > (an.limits[action] ?? 3)) await nukeTrigger(guild, uid, action, arr.length);
}
async function nukeRestore(guild, uid) {
  const g = G(guild.id), list = (nukeSnap.get(guild.id) || []).filter(x => x.exec === uid && !x.done && now() - x.at < 10 * 60000);
  const map = {}; let rc = 0, cc = 0;
  for (const x of list.filter(x => x.kind === 'role').sort((a, b) => a.position - b.position)) {
    try { map[x.id] = (await guild.roles.create({ name: x.name, color: x.color, hoist: x.hoist, mentionable: x.mentionable, permissions: BigInt(x.permissions), reason: '[Anti-nuke] restore' })).id; x.done = true; rc++; } catch {}
  }
  for (const x of list.filter(x => x.kind === 'channel').sort((a, b) => (b.type === CT.GuildCategory) - (a.type === CT.GuildCategory) || a.position - b.position)) {
    try {
      const ow = x.overwrites.map(o => ({ id: map[o.id] || o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) })).filter(o => o.type !== 0 || guild.roles.cache.has(o.id));
      const pid = map[x.parentId] || x.parentId;
      map[x.id] = (await guild.channels.create({ name: x.name, type: x.type, parent: pid && guild.channels.cache.has(pid) ? pid : undefined, topic: x.topic, nsfw: x.nsfw, bitrate: x.bitrate, userLimit: x.userLimit, rateLimitPerUser: x.rateLimitPerUser, permissionOverwrites: ow, reason: '[Anti-nuke] restore' })).id; x.done = true; cc++;
    } catch {}
  }
  if (Object.keys(map).length) { remap(g.settings, map); remap(g.forms, map); save(); }
  return { channels: cc, roles: rc };
}
async function nukeTrigger(guild, uid, action, count) {
  const key = `${guild.id}:${uid}`; if (nukeLocked.has(key)) return; nukeLocked.add(key); setTimeout(() => nukeLocked.delete(key), 60000);
  const g = G(guild.id), an = g.settings.antinuke, out = [];
  const mem = await guild.members.fetch(uid).catch(() => null), reason = `[Anti-nuke] ${action} x${count} in ${an.windowSec}s`;
  try {
    if (an.punish === 'ban') { await guild.members.ban(uid, { reason }); out.push('🔨 Banned'); }
    else if (an.punish === 'kick' && mem) { await mem.kick(reason); out.push('👢 Kicked'); }
    else if (mem) { await mem.roles.set(mem.roles.cache.filter(r => r.managed).map(r => r.id), reason); out.push('🧹 Roles stripped'); }
  } catch {
    out.push('⚠️ Could not punish directly (my role is probably below theirs) — trying to strip roles');
    try { if (mem) { await mem.roles.set(mem.roles.cache.filter(r => r.managed).map(r => r.id), reason); out.push('🧹 Roles stripped'); } } catch { out.push('❌ Failed — move my role to the very top!'); }
  }
  for (const c of (nukeCreated.get(guild.id) || []).filter(x => x.exec === uid && now() - x.at < 10 * 60000)) {
    if (c.kind === 'channel') await guild.channels.cache.get(c.id)?.delete('[Anti-nuke] cleanup').catch(() => {}); else await guild.roles.cache.get(c.id)?.delete('[Anti-nuke] cleanup').catch(() => {});
  }
  if (an.restore) { const r = await nukeRestore(guild, uid); if (r.channels || r.roles) out.push(`♻️ Restored ${r.channels} channel(s) and ${r.roles} role(s) — reorder roles if needed`); }
  if (!raidActive(g)) { await setRaid(guild, true, 15); out.push('🚨 Raid shield enabled for 15 minutes'); }
  await nukeAlert(guild, '🛡️ NUKE ATTEMPT BLOCKED', `**Culprit:** <@${uid}>\n**Trigger:** ${action} ×${count} within ${an.windowSec}s\n\n${out.join('\n')}`, true);
}
async function antiBotAdd(mem) {
  const guild = mem.guild, g = G(guild.id), an = g.settings.antinuke; if (!an.enabled || mem.id === client.user.id || an.whitelist.includes(mem.id)) return;
  const a = await auditExec(guild, AuditLogEvent.BotAdd, mem.id); if (!a || anTrusted(guild, g, a.uid)) return;
  await mem.kick('[Anti-nuke] Bot added by an untrusted user').catch(() => {});
  await nukeAlert(guild, '🤖 Unauthorised bot removed', `${mem.user} was added by <@${a.uid}>. Only the owner and whitelisted users can add bots (\`/antinuke whitelist-add\`).`, true);
  await nukeHit(guild, a.uid, 'botAdd');
}
const snapChannel = c => ({ kind: 'channel', id: c.id, type: c.type, name: c.name, parentId: c.parentId, topic: c.topic ?? undefined, nsfw: c.nsfw, position: c.rawPosition, bitrate: c.bitrate, userLimit: c.userLimit, rateLimitPerUser: c.rateLimitPerUser, overwrites: [...(c.permissionOverwrites?.cache.values() ?? [])].map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })), at: now() });
const RESTORABLE = [CT.GuildText, CT.GuildVoice, CT.GuildCategory, CT.GuildAnnouncement, CT.GuildStageVoice];
client.on(Events.ChannelDelete, async c => {
  try {
    if (!c.guild || !G(c.guild.id).settings.antinuke.enabled || !RESTORABLE.includes(c.type)) return;
    const snap = snapChannel(c); pushCap(nukeSnap, c.guild.id, snap);
    const a = await auditExec(c.guild, AuditLogEvent.ChannelDelete, c.id); if (!a) return;
    snap.exec = a.uid; await nukeHit(c.guild, a.uid, 'channelDelete');
  } catch (e) { console.error('antinuke', e); }
});
client.on(Events.GuildRoleDelete, async r => {
  try {
    if (!G(r.guild.id).settings.antinuke.enabled || r.managed) return;
    const snap = { kind: 'role', id: r.id, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions.bitfield.toString(), position: r.position, at: now() };
    pushCap(nukeSnap, r.guild.id, snap); const a = await auditExec(r.guild, AuditLogEvent.RoleDelete, r.id); if (!a) return;
    snap.exec = a.uid; await nukeHit(r.guild, a.uid, 'roleDelete');
  } catch (e) { console.error('antinuke', e); }
});
client.on(Events.ChannelCreate, async c => {
  try { if (!c.guild || !G(c.guild.id).settings.antinuke.enabled) return; const a = await auditExec(c.guild, AuditLogEvent.ChannelCreate, c.id); if (!a) return; pushCap(nukeCreated, c.guild.id, { kind: 'channel', id: c.id, exec: a.uid, at: now() }); await nukeHit(c.guild, a.uid, 'channelCreate'); } catch (e) { console.error('antinuke', e); }
});
client.on(Events.GuildRoleCreate, async r => {
  try { if (!G(r.guild.id).settings.antinuke.enabled || r.managed) return; const a = await auditExec(r.guild, AuditLogEvent.RoleCreate, r.id); if (!a) return; pushCap(nukeCreated, r.guild.id, { kind: 'role', id: r.id, exec: a.uid, at: now() }); await nukeHit(r.guild, a.uid, 'roleCreate'); } catch (e) { console.error('antinuke', e); }
});
client.on(Events.GuildBanAdd, b => { try { if (G(b.guild.id).settings.antinuke.enabled) auditScan(b.guild, AuditLogEvent.MemberBanAdd, 'ban').catch(() => {}); } catch (e) { console.error(e); } });
client.on(Events.WebhooksUpdate, async ch => {
  try { const guild = ch.guild; if (!guild || !G(guild.id).settings.antinuke.enabled) return; const a = await auditExec(guild, AuditLogEvent.WebhookCreate, null); if (a) await nukeHit(guild, a.uid, 'webhook'); } catch (e) { console.error('antinuke', e); }
});
client.on(Events.GuildRoleUpdate, async (o, n) => {
  try {
    const g = G(n.guild.id); if (!g.settings.antinuke.enabled || n.managed) return;
    if (!DANGER.some(p => !o.permissions.has(p) && n.permissions.has(p))) return;
    const a = await auditExec(n.guild, AuditLogEvent.RoleUpdate, n.id); if (!a || anTrusted(n.guild, g, a.uid)) return;
    await n.setPermissions(o.permissions, '[Anti-nuke] reverted dangerous permission change').catch(() => {});
    await nukeAlert(n.guild, '⚠️ Dangerous role change reverted', `<@${a.uid}> tried to grant dangerous permissions to **${n.name}**.`, false);
    await nukeHit(n.guild, a.uid, 'perm');
  } catch (e) { console.error('antinuke', e); }
});
client.on(Events.GuildMemberUpdate, async (o, n) => {
  try {
    if (o.partial) return; const g = G(n.guild.id); if (!g.settings.antinuke.enabled) return;
    const added = n.roles.cache.filter(r => !o.roles.cache.has(r.id) && !r.managed && DANGER.some(p => r.permissions.has(p))); if (!added.size) return;
    const a = await auditExec(n.guild, AuditLogEvent.MemberRoleUpdate, n.id); if (!a || anTrusted(n.guild, g, a.uid)) return;
    await n.roles.remove(added.map(r => r.id), '[Anti-nuke] dangerous role given by an untrusted user').catch(() => {});
    await nukeAlert(n.guild, '⚠️ Dangerous role removed', `<@${a.uid}> gave ${added.map(r => r).join(' ')} to ${n.user}. I took it back.`, false);
    await nukeHit(n.guild, a.uid, 'perm');
  } catch (e) { console.error('antinuke', e); }
});
H.antinuke = async i => {
  const g = G(i.guildId), an = g.settings.antinuke, sc = i.options.getSubcommand();
  if (sc === 'status') {
    const me = i.guild.members.me, top = me.roles.highest.id === i.guild.roles.highest.id;
    return rep(i, E('🛡️ Anti-nuke', `${an.enabled ? '🟢 **Active**' : '🔴 **Disabled**'} • Punishment: **${an.punish}** • Restore: **${an.restore ? 'on' : 'off'}** • Window: **${an.windowSec}s**\n\n**Allowed per window**\n${ANK.map(k => `\`${k}\` ${an.limits[k]}`).join(' • ')}\n\n**Trusted:** ${[...new Set([i.guild.ownerId, ...an.whitelist])].map(id => `<@${id}>`).join(' ')}\n\n${top ? '✅ My role is the highest in the server.' : '⚠️ **Move my role to the very top** of the role list — otherwise I cannot punish people above me.'}\nI also revert dangerous permission grants, remove unauthorised bots and delete anything a nuker created.`));
  }
  if (i.user.id !== i.guild.ownerId && !ownerIds.has(i.user.id)) return rep(i, bad('Only the **server owner** can change anti-nuke settings (so a compromised admin cannot switch it off).'));
  if (sc === 'toggle') { an.enabled = i.options.getBoolean('enabled'); save(); return rep(i, good(`Anti-nuke ${an.enabled ? 'enabled' : 'disabled'}.`)); }
  if (sc === 'whitelist-add') { const u = i.options.getUser('user'); if (!an.whitelist.includes(u.id)) an.whitelist.push(u.id); save(); return rep(i, good(`${u} is now trusted by anti-nuke.`)); }
  if (sc === 'whitelist-remove') { const u = i.options.getUser('user'); an.whitelist = an.whitelist.filter(x => x !== u.id); save(); return rep(i, good(`${u} is no longer trusted.`)); }
  if (sc === 'limit') { an.limits[i.options.getString('action')] = i.options.getInteger('count'); save(); return rep(i, good(`\`${i.options.getString('action')}\` limit set to ${i.options.getInteger('count')}.`)); }
  if (sc === 'window') { an.windowSec = i.options.getInteger('seconds'); save(); return rep(i, good(`Detection window: ${an.windowSec}s.`)); }
  if (sc === 'punish') { an.punish = i.options.getString('type'); save(); return rep(i, good(`Nukers will be: **${an.punish}**.`)); }
  an.restore = i.options.getBoolean('enabled'); save(); return rep(i, good(`Auto-restore ${an.restore ? 'on' : 'off'}.`));
};

/* ═══════════════════ SMART SETUP ═══════════════════ */
const NEEDED = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'ManageChannels', 'ManageRoles', 'ManageMessages', 'BanMembers', 'KickMembers', 'ModerateMembers', 'ViewAuditLog', 'ManageNicknames', 'MoveMembers'];
async function smartSetup(i, made) {
  const guild = i.guild, g = G(guild.id), s = g.settings, v = s.verify, w = s.welcome;
  const has = id => id && guild.channels.cache.has(id), hasR = id => id && guild.roles.cache.has(id);
  if (!hasR(v.role)) { v.role = (await guild.roles.create({ name: 'Verified', color: 0x2ecc71, reason: 'Setup' })).id; made.push('✅ Verified role'); }
  if (!hasR(v.unverified)) { v.unverified = (await guild.roles.create({ name: 'Unverified', color: 0x95a5a6, reason: 'Setup' })).id; made.push('⬜ Unverified role'); }
  const readOnly = roOw(guild);
  if (!has(w.channel)) { w.channel = (await guild.channels.create({ name: 'welcome', type: CT.GuildText, permissionOverwrites: readOnly })).id; made.push('👋 #welcome'); }
  if (!has(v.channel)) { v.channel = (await guild.channels.create({ name: 'verify', type: CT.GuildText, permissionOverwrites: readOnly })).id; made.push('🔐 #verify (panel posted)'); await postVerifyPanel(guild); }
  if (!has(s.channels.applications)) { s.channels.applications = (await guild.channels.create({ name: 'applications', type: CT.GuildText, permissionOverwrites: staffOw(guild, s) })).id; made.push('📝 #applications (staff only)'); }
  if (!g.forms.team) {
    g.forms.team = { name: 'team', description: `Apply to join the ${BRAND} team. I'll ask a few questions here in DMs.`, reviewChannel: s.channels.applications, role: null, enabled: true, cooldownHours: 24, created: now(),
      questions: [{ text: 'What is your Roblox username?', required: true, hint: '' }, { text: 'How old are you?', required: true, hint: '' }, { text: 'What is your timezone?', required: true, hint: 'e.g. GMT, EST' }, { text: 'Why do you want to join the team?', required: true, hint: 'A few sentences is plenty.' }, { text: 'Any previous experience or teams?', required: false, hint: 'Type skip if none.' }] };
    made.push('🗂 Default `team` application form (edit with `/form`)');
  }
  const gu = i.options.getString('game_url');
  if (gu) {
    const r = await resolveGame(gu).catch(() => null);
    if (r) { Object.assign(s.game, r); const info = await gameInfo(s.game).catch(() => null); s.game.name = info?.name || null; s.game.lastUpdated = info?.updated || null; made.push(`🎮 Game linked: ${info?.name || r.placeId}`); }
    else made.push('⚠️ Could not read the game link — use `/gamesetup set` with the roblox.com/games/… URL');
  }
  if (await ensureRankRoles(guild)) made.push('🎖 Rank roles (Cadet → Air Marshal)');
  made.push(...(await ensureAwardChannels(guild)).map(n => `🏅 ${n} (rank & medal announcements)`));
  if (!has(s.game.updatesChannel)) { s.game.updatesChannel = (await guild.channels.create({ name: 'development-notices', type: CT.GuildText, permissionOverwrites: roOw(guild) })).id; made.push('🛠 #development-notices (public)'); }
  if (!has(s.game.reviewChannel)) { s.game.reviewChannel = (await guild.channels.create({ name: 'update-approvals', type: CT.GuildText, permissionOverwrites: staffOw(guild, s) })).id; made.push('🛡 #update-approvals (staff approval)'); }
  if (!s.game.placeId) made.push('ℹ️ Link your Roblox game with `/gamesetup set`');
  const missing = guild.members.me.permissions.missing(NEEDED); if (missing.length) made.push(`⚠️ Missing permissions: ${missing.join(', ')}`);
  if (guild.members.me.roles.highest.id !== guild.roles.highest.id) made.push('⚠️ Drag my role to the TOP of the role list for anti-nuke to work');
  made.push('🛡️ Anti-nuke, automod and raid shield are on by default');
}


/* ═══════════════ PILOT PROGRESSION, FLIGHT SCHEDULE & SMART AUTOMATION ═══════════════ */
const RANKS = [['Cadet', 0], ['Pilot Officer', 100], ['Flying Officer', 300], ['Flight Lieutenant', 700], ['Squadron Leader', 1500], ['Wing Commander', 3000], ['Group Captain', 6000], ['Air Commodore', 10000], ['Air Vice-Marshal', 16000], ['Air Marshal', 25000]];
const MEDAL_DEFAULTS = {
  first_flight: { name: 'First Flight', emoji: '🛫', desc: 'Attended your first flight event' },
  ace: { name: 'Ace', emoji: '🏅', desc: 'Logged 10 hours of flight time' },
  streak7: { name: 'Iron Pilot', emoji: '🔥', desc: '7-day daily streak' },
  century: { name: 'Centurion', emoji: '💯', desc: 'Attended 25 flights' },
};
const medalQueue = [];
async function flushMedals() {
  while (medalQueue.length) {
    const { gid, uid, key } = medalQueue.shift(), guild = client.guilds.cache.get(gid); if (!guild) continue;
    const g = G(gid), m = g.medals[key], ch = guild.channels.cache.get(g.settings.channels.medals); if (!ch || !m) continue;
    await ch.send({ content: `<@${uid}>`, embeds: [E('🏅 Medal awarded!', `<@${uid}> earned **${m.emoji} ${m.name}**${m.desc ? `\n*${m.desc}*` : ''}`).setColor(0xf1c40f)], allowedMentions: { users: [uid] } }).catch(() => {});
  }
}
const pil = (g, uid) => g.pilots[uid] ||= { callsign: null, vcMs: 0, events: 0, medals: [], streak: 0, lastDaily: 0, squad: null, bonus: 0, rank: 0 };
function points(g, uid) { const p = g.pilots[uid] || {}, xp = g.levels[uid]?.xp || 0; return Math.floor(xp / 10) + Math.floor((p.vcMs || 0) / 36e5 * 5) + (p.events || 0) * 30 + (p.medals?.length || 0) * 40 + (p.bonus || 0); }
const rankIdx = pts => { let k = 0; RANKS.forEach(([, t], n) => { if (pts >= t) k = n; }); return k; };
const hours = p => ((p?.vcMs || 0) / 36e5).toFixed(1);
function bump(g, f) {
  const k = new Date().toISOString().slice(0, 10);
  if (!g.stats[k]) { g.stats[k] = { msgs: 0, joins: 0, leaves: 0, verified: 0 }; const keys = Object.keys(g.stats).sort(); while (keys.length > 60) delete g.stats[keys.shift()]; }
  g.stats[k][f]++; save();
}
function awardMedal(g, uid, key) {
  if (!g.medals[key] && MEDAL_DEFAULTS[key]) g.medals[key] = { ...MEDAL_DEFAULTS[key] };
  if (!g.medals[key]) return false; const p = pil(g, uid); if (p.medals.includes(key)) return false; p.medals.push(key); save(); medalQueue.push({ gid: g._id, uid, key }); return true;
}
function autoMedals(g, uid) { const p = pil(g, uid); if (p.events >= 1) awardMedal(g, uid, 'first_flight'); if (p.vcMs >= 36e6) awardMedal(g, uid, 'ace'); if (p.streak >= 7) awardMedal(g, uid, 'streak7'); if (p.events >= 25) awardMedal(g, uid, 'century'); }
function roOw(guild) { // read-only for everyone, but the bot itself can always post
  return [{ id: guild.roles.everyone.id, allow: [PF.ViewChannel, PF.ReadMessageHistory], deny: [PF.SendMessages] },
    { id: client.user.id, allow: [PF.ViewChannel, PF.SendMessages, PF.EmbedLinks, PF.ReadMessageHistory, PF.AddReactions] }];
}
async function ensureAwardChannels(guild) {
  const s = G(guild.id).settings, made = [];
  for (const [key, name] of [['ranks', 'promotions'], ['medals', 'medals']]) {
    if (s.channels[key] && guild.channels.cache.has(s.channels[key])) continue;
    s.channels[key] = (await guild.channels.create({ name, type: CT.GuildText, permissionOverwrites: roOw(guild) })).id; made.push(`#${name}`);
  }
  if (made.length) save(); return made;
}
async function ensureRankRoles(guild) {
  const s = G(guild.id).settings; let n = 0;
  for (let k = 0; k < RANKS.length; k++) {
    if (s.rankRoles[k] && guild.roles.cache.has(s.rankRoles[k])) continue;
    s.rankRoles[k] = (await guild.roles.create({ name: RANKS[k][0], color: ((0x60 + k * 14) << 16) | (0x10 << 8) | 0x20, reason: 'Rank ladder' })).id; n++;
  }
  if (n) save(); return n;
}
const promoAt = new Map();
async function checkPromotion(guild, uid) {
  const g = G(guild.id), k = guild.id + uid; if (now() - (promoAt.get(k) || 0) < 30000) return; promoAt.set(k, now());
  const p = pil(g, uid), idx = rankIdx(points(g, uid)); if (idx <= (p.rank || 0)) return;
  p.rank = idx; save();
  const mem = await guild.members.fetch(uid).catch(() => null); if (!mem) return;
  const rr = g.settings.rankRoles;
  if (rr[idx]) { await mem.roles.add(rr[idx]).catch(() => {}); const old = rr.filter((r, n) => n !== idx && mem.roles.cache.has(r)); if (old.length) await mem.roles.remove(old).catch(() => {}); }
  const ch = guild.channels.cache.get(g.settings.channels.ranks) || guild.channels.cache.get(g.settings.channels.levelup);
  ch?.send({ content: `${mem}`, embeds: [E('🎖️ Promotion!', `${mem} has been promoted to **${RANKS[idx][0]}**!${rr[idx] ? '' : '\n*(Run `/pilotadmin ranks-setup` to give ranks their own roles.)*'}`).setColor(0xf1c40f)], allowedMentions: { users: [uid] } }).catch(() => {});
}
function trust(guild, member) {
  const g = G(guild.id), u = member.user, age = (now() - u.createdTimestamp) / 864e5, tin = member.joinedTimestamp ? (now() - member.joinedTimestamp) / 864e5 : 0;
  const parts = [['Account age', Math.min(25, Math.round(age / 12))], ['Time in server', Math.min(25, Math.round(tin * 2))], ['Roblox verified', db.global.links[member.id] ? 25 : 0],
    ['Rank', Math.min(15, (g.pilots[member.id]?.rank || 0) * 3)], ['Warnings', -15 * activeWarns(g, member.id).length], ['Flags', -15 * activeLocal(g, member.id).length - 30 * activeGFlags(member.id).length]];
  return { score: Math.max(0, Math.min(100, parts.reduce((a, [, v]) => a + v, 0))), parts };
}
H.trust = async i => {
  const u = i.options.getUser('user'), mem = await i.guild.members.fetch(u.id).catch(() => null); if (!mem) return rep(i, bad('That user is not in this server.'));
  const t = trust(i.guild, mem);
  return rep(i, E(`🧭 Trust score — ${u.username}`, `${bar(t.score / 100, 16)} **${t.score}/100**\n\n${t.parts.map(([n, v]) => `${v >= 0 ? '🟢' : '🔴'} ${n}: **${v > 0 ? '+' : ''}${v}**`).join('\n')}\n\nMembers at **70+** are exempt from the links, caps and repeated-message automod rules.`));
};

// ── profile, ranks, leaderboard, daily, callsign ──
H.profile = async i => {
  const u = i.options.getUser('user') || i.user, g = G(i.guildId), p = g.pilots[u.id] || { medals: [], events: 0, streak: 0 }, pts = points(g, u.id), idx = rankIdx(pts), nxt = RANKS[idx + 1];
  const rl = db.global.links[u.id], sq = p.squad && g.squads[p.squad];
  return rep(i, E(`✈️ ${p.callsign ? `"${p.callsign}" — ` : ''}${u.username}`).setThumbnail(u.displayAvatarURL()).addFields(
    { name: '🎖 Rank', value: `**${RANKS[idx][0]}**\n${nxt ? `${bar((pts - RANKS[idx][1]) / (nxt[1] - RANKS[idx][1]), 12)} ${pts}/${nxt[1]} → ${nxt[0]}` : `${pts} pts — highest rank!`}` },
    { name: 'Flight time', value: `${hours(p)} h`, inline: true }, { name: 'Flights', value: String(p.events || 0), inline: true }, { name: 'Streak', value: `${p.streak || 0} 🔥`, inline: true },
    { name: 'Level', value: `${lvl(g.levels[u.id]?.xp || 0).level}`, inline: true }, { name: 'Squadron', value: sq ? `${sq.emoji || ''} ${sq.name}` : 'None', inline: true }, { name: 'Roblox', value: rl ? `[${rl.name}](${profileUrl(rl.rid)})` : 'Not linked', inline: true },
    { name: '🏅 Medals', value: clip(p.medals.map(k => `${g.medals[k]?.emoji || '🎖'} ${g.medals[k]?.name || k}`).join('\n') || 'None yet — attend flights and keep your streak!', 1000) }), false);
};
H.ranks = async i => {
  const g = G(i.guildId), pts = points(g, i.user.id), me = rankIdx(pts);
  return rep(i, E('🎖 Rank ladder', RANKS.map(([n, t], k) => `${k < me ? '✅' : k === me ? '➡️' : '⬜'} **${n}** — ${t} pts`).join('\n') + `\n\nYou have **${pts} points**.\n*Points = XP÷10 + 5 per flight hour + 30 per flight + 40 per medal.*`));
};
H.topgun = async i => {
  const g = G(i.guildId), sort = i.options.getString('sort') || 'points', ids = new Set([...Object.keys(g.pilots), ...Object.keys(g.levels)]);
  const val = u => sort === 'hours' ? (g.pilots[u]?.vcMs || 0) : sort === 'events' ? (g.pilots[u]?.events || 0) : points(g, u);
  const top = [...ids].map(u => [u, val(u)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return rep(i, E(`🏆 Top Gun — ${sort}`, top.map(([u, v], n) => `**${n + 1}.** <@${u}> — ${sort === 'hours' ? (v / 36e5).toFixed(1) + ' h' : sort === 'events' ? v + ' flights' : v + ' pts (' + RANKS[rankIdx(v)][0] + ')'}`).join('\n') || 'Nobody yet.'), false);
};
H.daily = async i => {
  const g = G(i.guildId), p = pil(g, i.user.id), t = now();
  if (t - p.lastDaily < 20 * 36e5) return rep(i, bad(`You already checked in. Come back ${ts(p.lastDaily + 20 * 36e5)}.`));
  p.streak = p.lastDaily && t - p.lastDaily < 48 * 36e5 ? p.streak + 1 : 1; p.lastDaily = t;
  const xp = 50 + Math.min(p.streak, 14) * 10; (g.levels[i.user.id] ||= { xp: 0 }).xp += xp; autoMedals(g, i.user.id); save(); checkPromotion(i.guild, i.user.id).catch(() => {});
  return rep(i, E('📅 Daily check-in', `+**${xp} XP**\nStreak: **${p.streak}** day(s) ${'🔥'.repeat(Math.min(p.streak, 7))}\nCheck in again within 48 hours to keep it going.`), false);
};
H.callsign = async i => {
  const name = i.options.getString('name').trim(), g = G(i.guildId);
  if (!/^[A-Za-z0-9][A-Za-z0-9 -]{1,19}$/.test(name)) return rep(i, bad('Use 2–20 letters, numbers, spaces or dashes.'));
  if (Object.entries(g.pilots).some(([u, p]) => u !== i.user.id && p.callsign?.toLowerCase() === name.toLowerCase())) return rep(i, bad('That callsign is taken.'));
  pil(g, i.user.id).callsign = name; save(); return rep(i, good(`Callsign set: **${name}**. It shows on your \`/profile\`.`));
};
H.squadron = async i => {
  const g = G(i.guildId), sc = i.options.getSubcommand(), key = (i.options.getString('squad') || '').toLowerCase();
  const members = k => Object.entries(g.pilots).filter(([, p]) => p.squad === k).map(([u]) => u), score = k => members(k).reduce((a, u) => a + points(g, u), 0);
  if (sc === 'list') return rep(i, E('🛩 Squadrons', Object.entries(g.squads).sort((a, b) => score(b[0]) - score(a[0])).map(([k, q], n) => `**${n + 1}.** ${q.emoji || ''} **${q.name}** — ${members(k).length} pilots • ${score(k)} pts`).join('\n') || 'No squadrons yet. Admins: `/pilotadmin squad-create`.'));
  if (sc === 'leave') { const p = pil(g, i.user.id); if (!p.squad) return rep(i, bad('You are not in a squadron.')); const q = g.squads[p.squad]; if (q) await i.member.roles.remove(q.role).catch(() => {}); p.squad = null; save(); return rep(i, good('You left your squadron.')); }
  const q = g.squads[key]; if (!q) return rep(i, bad('No such squadron.'));
  if (sc === 'info') { const top = members(key).sort((a, b) => points(g, b) - points(g, a)).slice(0, 5); return rep(i, E(`${q.emoji || '🛩'} ${q.name}`, `**${members(key).length}** pilots • **${score(key)}** points\n\n**Top pilots**\n${top.map(u => `<@${u}> — ${points(g, u)} pts`).join('\n') || 'No members yet.'}`)); }
  const p = pil(g, i.user.id); if (p.squad === key) return rep(i, bad('You are already in that squadron.'));
  if (p.squad && g.squads[p.squad]) await i.member.roles.remove(g.squads[p.squad].role).catch(() => {});
  await i.member.roles.add(q.role).catch(() => {}); p.squad = key; save(); return rep(i, good(`Welcome to **${q.name}**!`));
};
H.pilotadmin = async i => {
  const g = G(i.guildId), s = g.settings, sc = i.options.getSubcommand();
  if (sc === 'ranks-setup') { await i.deferReply({ flags: MessageFlags.Ephemeral }); const n = await ensureRankRoles(i.guild), ch = await ensureAwardChannels(i.guild); return rep(i, good((n ? `Created ${n} rank roles. ` : 'Rank roles already exist. ') + (ch.length ? `Created ${ch.join(' and ')} for announcements. ` : '') + 'Pilots are promoted automatically as they earn points.')); }
  if (sc === 'set-rank') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const u = i.options.getUser('user'), idx = RANKS.findIndex(r => r[0] === i.options.getString('rank')), p = pil(g, u.id), old = p.rank || 0;
    p.bonus += RANKS[idx][1] - points(g, u.id); save(); await ensureRankRoles(i.guild);
    if (idx > old) { p.rank = -1; promoAt.delete(i.guild.id + u.id); await checkPromotion(i.guild, u.id); }
    else { p.rank = idx; save(); const mem = await i.guild.members.fetch(u.id).catch(() => null), rr = s.rankRoles; if (mem) { await mem.roles.add(rr[idx]).catch(() => {}); const others = rr.filter((r, n) => n !== idx && mem.roles.cache.has(r)); if (others.length) await mem.roles.remove(others).catch(() => {}); } }
    return rep(i, good(`${u} is now **${RANKS[idx][0]}** (points set to ${RANKS[idx][1]}).`));
  }
  if (sc === 'medals-channel') { s.channels.medals = i.options.getChannel('channel').id; save(); return rep(i, good(`Medal announcements will be posted in ${i.options.getChannel('channel')}.`)); }
  if (sc === 'ranks-channel') { s.channels.ranks = i.options.getChannel('channel').id; save(); return rep(i, good(`Promotion announcements will be posted in ${i.options.getChannel('channel')}.`)); }
  if (sc === 'medal-create') { const k = i.options.getString('key').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30); g.medals[k] = { name: clip(i.options.getString('name'), 40), emoji: clip(i.options.getString('emoji'), 8), desc: clip(i.options.getString('description') || '', 100) }; save(); return rep(i, good(`Medal \`${k}\` created.`)); }
  if (sc === 'medal-award' || sc === 'medal-revoke') {
    const u = i.options.getUser('user'), k = i.options.getString('medal'); if (!g.medals[k]) return rep(i, bad('Unknown medal.')); const p = pil(g, u.id);
    if (sc === 'medal-award') { if (!awardMedal(g, u.id, k)) return rep(i, bad('They already have it.')); checkPromotion(i.guild, u.id).catch(() => {}); await dmUser(u, `🏅 You earned a medal in ${i.guild.name}!`, `${g.medals[k].emoji} **${g.medals[k].name}**${g.medals[k].desc ? `\n${g.medals[k].desc}` : ''}`, 0xf1c40f); return rep(i, good(`Awarded ${g.medals[k].emoji} **${g.medals[k].name}** to ${u}.`)); }
    p.medals = p.medals.filter(x => x !== k); save(); return rep(i, good('Medal revoked.'));
  }
  if (sc === 'points') { const u = i.options.getUser('user'); pil(g, u.id).bonus += i.options.getInteger('amount'); save(); checkPromotion(i.guild, u.id).catch(() => {}); return rep(i, good(`${u} now has **${points(g, u.id)}** points.`)); }
  if (sc === 'squad-create') {
    const name = clip(i.options.getString('name'), 30), key = name.toLowerCase(); if (g.squads[key]) return rep(i, bad('That squadron exists.'));
    const role = await i.guild.roles.create({ name, color: 0xd7263d, reason: 'Squadron' }); g.squads[key] = { name, emoji: clip(i.options.getString('emoji') || '', 8), role: role.id, created: now() }; save(); return rep(i, good(`Squadron **${name}** created. Pilots join with \`/squadron join\`.`));
  }
  if (sc === 'squad-delete') { const k = i.options.getString('squad').toLowerCase(), q = g.squads[k]; if (!q) return rep(i, bad('No such squadron.')); await i.guild.roles.cache.get(q.role)?.delete().catch(() => {}); for (const p of Object.values(g.pilots)) if (p.squad === k) p.squad = null; delete g.squads[k]; save(); return rep(i, good('Squadron deleted.')); }
  if (sc === 'drops') { s.drops.enabled = i.options.getBoolean('enabled'); save(); return rep(i, good(`Supply drops ${s.drops.enabled ? 'enabled' : 'disabled'}.`)); }
  if (sc === 'briefing') { s.briefing.channel = i.options.getChannel('channel').id; const h = i.options.getInteger('hour'); if (h !== null) s.briefing.hour = h; save(); return rep(i, good(`Daily briefing: ${i.options.getChannel('channel')} at **${String(s.briefing.hour).padStart(2, '0')}:00 UTC** (plus a weekly report every Monday).`)); }
  const ch = i.guild.channels.cache.get(s.briefing.channel) || i.channel; await i.deferReply({ flags: MessageFlags.Ephemeral });
  await ch.send({ embeds: [await buildBriefing(i.guild, g)] }); return rep(i, good(`Briefing posted in ${ch}.`));
};

// ── flight schedule (events) ──
function evEmbed(ev) {
  const by = k => Object.entries(ev.rsvp).filter(([, v]) => v === k).map(([u]) => `<@${u}>`);
  const y = by('y'), m = by('m'), n = by('n'), st = { scheduled: '🕒 Scheduled', live: '🟢 **LIVE — check in!**', done: '✅ Completed', cancelled: '❌ Cancelled' }[ev.status];
  const e = E(`✈️ ${ev.title}`, `${ev.desc ? ev.desc + '\n\n' : ''}**Starts:** ${ts(ev.start, 'F')} (${ts(ev.start)})\n**Length:** ${ev.lenMin} min • **Host:** <@${ev.host}>\n**Status:** ${st}\n*Times show in your own timezone.*`)
    .setColor(ev.status === 'cancelled' ? 0x95a5a6 : ev.status === 'live' ? 0x2ecc71 : COLOR)
    .addFields({ name: `✅ Attending (${y.length})`, value: clip(y.join(' ') || '—', 1000) }, { name: `🤔 Maybe (${m.length})`, value: clip(m.join(' ') || '—', 1000) }, { name: `❌ Can't make it (${n.length})`, value: clip(n.join(' ') || '—', 1000) });
  if (ev.status === 'live' || ev.status === 'done') e.addFields({ name: '✋ Checked in', value: String(ev.attended.length) });
  return e;
}
const evRows = ev => ev.status === 'cancelled' || ev.status === 'done' ? [] : [row(btn('ev:y', 'Attending', ButtonStyle.Success), btn('ev:m', 'Maybe'), btn('ev:n', "Can't make it", ButtonStyle.Danger), ...(ev.status === 'live' ? [btn('ev:in', '✋ Check in', ButtonStyle.Primary)] : []))];
async function refreshEvent(guild, ev) {
  const ch = guild.channels.cache.get(ev.channelId), msg = ch && await ch.messages.fetch(ev.id).catch(() => null);
  await msg?.edit({ embeds: [evEmbed(ev)], components: evRows(ev) }).catch(() => {});
}
H.event = async i => {
  const g = G(i.guildId), sc = i.options.getSubcommand();
  if (sc === 'cancel') { const ev = g.events[i.options.getString('id')]; if (!ev || !['scheduled', 'live'].includes(ev.status)) return rep(i, bad('No active event with that ID.')); ev.status = 'cancelled'; save(); await refreshEvent(i.guild, ev); return rep(i, good('Event cancelled.')); }
  const pk = pickTz(i); if (pk.error) return rep(i, bad(pk.error));
  const pw = parseWhenTz(i.options.getString('when'), pk.tz); if (!pw) return rep(i, bad(WHEN_HELP));
  const start = pw.ts; if (start < now() + 60000 || start > now() + 3 * 365 * 864e5) return rep(i, bad(`That time (${ts(start, 'F')}) is in the past or more than 3 years away.`));
  const ch = i.options.getChannel('channel') || i.channel, role = i.options.getRole('ping');
  const ev = { id: null, title: clip(i.options.getString('title'), 100), desc: clip(i.options.getString('description') || '', 600), start, lenMin: i.options.getInteger('minutes') || 60, host: i.user.id, channelId: ch.id, rsvp: {}, attended: [], status: 'scheduled' };
  const msg = await ch.send({ content: role ? `${role}` : undefined, embeds: [evEmbed(ev)], components: evRows(ev), allowedMentions: { roles: role ? [role.id] : [] } });
  ev.id = msg.id; g.events[msg.id] = ev; save(); return rep(i, good(`Event scheduled in ${ch} for ${ts(start, 'F')} (${ts(start)}). ${whenNote(pw)} Reminders go out 1 hour and 10 minutes before, and flight time is credited to everyone who checks in.`));
};
H.schedule = async i => {
  const g = G(i.guildId), evs = Object.values(g.events).filter(e => ['scheduled', 'live'].includes(e.status)).sort((a, b) => a.start - b.start).slice(0, 10);
  return rep(i, E('🗓 Flight schedule', evs.map(e => `${e.status === 'live' ? '🟢' : '🕒'} **${e.title}** — ${ts(e.start, 'f')} (${ts(e.start)}) • [open](https://discord.com/channels/${i.guildId}/${e.channelId}/${e.id})`).join('\n') || 'Nothing scheduled right now.'), false);
};
async function onEventButton(i) {
  const g = G(i.guildId), ev = g.events[i.message.id], k = i.customId.split(':')[1];
  if (!ev || ev.status === 'cancelled' || ev.status === 'done') return rep(i, bad('This event is over.'));
  if (k === 'in') {
    if (ev.status !== 'live') return rep(i, bad('Check-in opens when the flight starts.'));
    if (ev.attended.includes(i.user.id)) return rep(i, good('You are already checked in.'));
    ev.attended.push(i.user.id); save(); await i.update({ embeds: [evEmbed(ev)], components: evRows(ev) }); return;
  }
  if (ev.rsvp[i.user.id] === k) delete ev.rsvp[i.user.id]; else ev.rsvp[i.user.id] = k; save();
  return i.update({ embeds: [evEmbed(ev)], components: evRows(ev) });
}
async function eventTick(gid, g, t) {
  const guild = client.guilds.cache.get(gid); if (!guild) return;
  for (const ev of Object.values(g.events)) {
    const ch = guild.channels.cache.get(ev.channelId), ids = Object.entries(ev.rsvp).filter(([, v]) => v === 'y' || v === 'm').map(([u]) => u).slice(0, 40);
    const ping = txt => ch?.send({ content: ids.map(u => `<@${u}>`).join(' ') || undefined, embeds: [E(`✈️ ${ev.title}`, txt)], allowedMentions: { users: ids } }).catch(() => {});
    if (ev.status === 'scheduled') {
      if (ev.start - t <= 36e5 && !ev.r1) { ev.r1 = true; save(); if (ev.start - t > 6e5) ping(`⏰ Takes off ${ts(ev.start)}!`); }
      if (ev.start - t <= 6e5 && !ev.r10) { ev.r10 = true; save(); if (ev.start > t) ping(`🛫 Starting ${ts(ev.start)} — get ready!`); }
      if (t >= ev.start) { ev.status = 'live'; save(); await refreshEvent(guild, ev); ping('🟢 **Cleared for takeoff!** Press **✋ Check in** on the event post to log your flight time.'); }
    } else if (ev.status === 'live' && t >= ev.start + ev.lenMin * 60000) {
      ev.status = 'done'; const yes = Object.values(ev.rsvp).filter(v => v === 'y').length;
      for (const uid of ev.attended) { const p = pil(g, uid); p.events++; p.vcMs += ev.lenMin * 60000; autoMedals(g, uid); checkPromotion(guild, uid).catch(() => {}); }
      save(); await refreshEvent(guild, ev);
      ch?.send({ embeds: [E(`🏁 ${ev.title} — complete`, `**${ev.attended.length}** pilots checked in${yes ? ` (${yes} had RSVP'd)` : ''}. Flight time and points have been credited. Great flying!`).setColor(0x2ecc71)] }).catch(() => {});
    } else if ((ev.status === 'done' || ev.status === 'cancelled') && t - ev.start > 14 * 864e5) delete g.events[ev.id];
  }
}

// ── voice flight time, supply drops, daily briefing ──
async function vcTick(gid, g) {
  const guild = client.guilds.cache.get(gid); if (!guild) return; const credited = new Set();
  for (const ch of guild.channels.cache.values()) {
    if (![CT.GuildVoice, CT.GuildStageVoice].includes(ch.type) || ch.id === guild.afkChannelId || ch.id === g.settings.game.statusChannel) continue;
    const hum = ch.members.filter(m => !m.user.bot && !m.voice.deaf); if (hum.size < 2) continue; // no solo farming
    for (const m of hum.values()) { pil(g, m.id).vcMs += 60000; credited.add(m.id); }
  }
  if (credited.size) { save(); for (const uid of credited) { autoMedals(g, uid); await checkPromotion(guild, uid); } }
}
const dropAct = new Map(), dropNext = new Map(), drops = new Map();
function noteActivity(m) { let a = dropAct.get(m.guild.id); if (!a) dropAct.set(m.guild.id, a = []); a.push({ t: now(), c: m.channel.id }); if (a.length > 200) a.shift(); }
async function dropTick(gid, g, t) {
  for (const [id, d] of drops) if (d.exp < t) { drops.delete(id); d.msg.edit({ embeds: [E(null, '📦 The supply drop expired unclaimed.')], components: [] }).catch(() => {}); }
  if (!g.settings.drops.enabled) return; const guild = client.guilds.cache.get(gid); if (!guild) return;
  const a = (dropAct.get(gid) || []).filter(x => x.t > t - 10 * 60000); dropAct.set(gid, a); if (a.length < 10) return;
  if (!dropNext.get(gid)) { dropNext.set(gid, t + rnd(20, 50) * 60000); return; } if (t < dropNext.get(gid)) return;
  const cnt = {}; for (const x of a) cnt[x.c] = (cnt[x.c] || 0) + 1;
  const cid = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0][0], ch = guild.channels.cache.get(cid); if (!ch || g.threads[cid] || g.settings.logIgnore.includes(cid)) return;
  const xp = rnd(100, 250), msg = await ch.send({ embeds: [E('📦 Supply Drop!', `First pilot to press the button wins **${xp} XP**!`).setColor(0xf1c40f)], components: [row(btn('drop:claim', 'Grab it!', ButtonStyle.Success))] }).catch(() => null);
  if (msg) drops.set(msg.id, { xp, exp: t + 120000, msg }); dropNext.set(gid, t + rnd(45, 90) * 60000);
}
async function onDropClaim(i) {
  const d = drops.get(i.message.id); if (!d || d.exp < now()) return rep(i, bad('Too late — that drop is gone.'));
  drops.delete(i.message.id); const g = G(i.guildId); (g.levels[i.user.id] ||= { xp: 0 }).xp += d.xp; save(); checkPromotion(i.guild, i.user.id).catch(() => {});
  return i.update({ embeds: [E('📦 Supply drop claimed!', `${i.user} grabbed **${d.xp} XP**! 🎉`).setColor(0x2ecc71)], components: [] });
}
async function buildBriefing(guild, g) {
  const e = E(`☀️ ${BRAND} daily briefing`, `Good morning, pilots! Here is today's picture — ${new Date().toUTCString().slice(0, 16)}.`);
  const gm = g.settings.game; if (gm.universeId) { const info = await gameInfo(gm).catch(() => null); if (info) e.addFields({ name: `🎮 ${info.name}`, value: `${info.playing.toLocaleString()} playing • ${info.visits.toLocaleString()} visits • ${info.rating ?? '?'}% 👍` }); }
  const evs = Object.values(g.events).filter(x => ['scheduled', 'live'].includes(x.status)).sort((a, b) => a.start - b.start).slice(0, 3);
  e.addFields({ name: '🗓 Upcoming flights', value: evs.map(x => `**${x.title}** — ${ts(x.start)} ([open](https://discord.com/channels/${guild.id}/${x.channelId}/${x.id}))`).join('\n') || 'Nothing scheduled — staff can use `/event create`.' });
  const y = g.stats[new Date(now() - 864e5).toISOString().slice(0, 10)];
  if (y) e.addFields({ name: '📈 Yesterday', value: `${y.msgs} messages • ${y.joins} joins • ${y.leaves} leaves • ${y.verified} verified` });
  if (new Date().getUTCDay() === 1) {
    const sum = { msgs: 0, joins: 0, leaves: 0, verified: 0 }; for (let k = 1; k <= 7; k++) { const d = g.stats[new Date(now() - k * 864e5).toISOString().slice(0, 10)]; if (d) for (const f in sum) sum[f] += d[f]; }
    const top = [...new Set([...Object.keys(g.pilots), ...Object.keys(g.levels)])].map(u => [u, points(g, u)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    e.addFields({ name: '📊 Last 7 days', value: `${sum.msgs} messages • ${sum.joins} joins • ${sum.leaves} leaves • ${sum.verified} verified` }, { name: '🏆 Top pilots', value: top.map(([u, v], n) => `${['🥇', '🥈', '🥉'][n]} <@${u}> — ${v} pts`).join('\n') || '—' });
  }
  return e;
}
async function briefingTick(gid, g) {
  const b = g.settings.briefing, d = new Date(), key = d.toISOString().slice(0, 10); if (!b.channel || b.lastKey === key || d.getUTCHours() < b.hour) return;
  const guild = client.guilds.cache.get(gid), ch = guild?.channels.cache.get(b.channel); if (!ch) return;
  b.lastKey = key; save(); await ch.send({ embeds: [await buildBriefing(guild, g)] }).catch(() => {});
}

// ── sticky roles & panic button ──
async function restoreSticky(mem, g) {
  const ids = g.sticky[mem.id]; if (!g.settings.stickyRoles || !ids?.length) return; delete g.sticky[mem.id]; save();
  const ok = ids.filter(id => { const r = mem.guild.roles.cache.get(id); return r && r.editable && !r.managed; });
  if (ok.length) await mem.roles.add(ok, 'Sticky roles restored').catch(() => {});
}
H.panic = async i => {
  if (i.user.id !== i.guild.ownerId && !ownerIds.has(i.user.id)) return rep(i, bad('Only the **server owner** can use the panic button.'));
  const g = G(i.guildId), everyone = i.guild.roles.everyone, on = i.options.getSubcommand() === 'on';
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  if (on) {
    if (g.panic) return rep(i, bad('Panic mode is already on. Use `/panic off` to restore.'));
    const saved = [];
    for (const ch of i.guild.channels.cache.values()) {
      if (![CT.GuildText, CT.GuildAnnouncement].includes(ch.type)) continue;
      const ow = ch.permissionOverwrites.cache.get(everyone.id); if (ow?.deny.has(PF.SendMessages)) continue;
      try { await ch.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason: 'PANIC MODE' }); saved.push([ch.id, ow?.allow.has(PF.SendMessages) ? 1 : 0]); } catch {}
      await sleep(250);
    }
    g.panic = { at: now(), channels: saved }; save(); await setRaid(i.guild, true, 180);
    try { await i.guild.disableInvites(true); } catch {}
    await nukeAlert(i.guild, '🚨 PANIC MODE ON', `${i.user} locked **${saved.length}** channels, paused invites and enabled the raid shield.\nUndo with \`/panic off\`.`, true);
    return rep(i, good(`Panic mode ON — ${saved.length} channels locked, invites paused, new joins blocked.`));
  }
  if (!g.panic) return rep(i, bad('Panic mode is not active.'));
  for (const [id, was] of g.panic.channels) { try { await i.guild.channels.cache.get(id)?.permissionOverwrites.edit(everyone, { SendMessages: was ? true : null }, { reason: 'PANIC MODE OFF' }); } catch {} await sleep(250); }
  g.panic = null; save(); try { await i.guild.disableInvites(false); } catch {}
  if (raidActive(g)) await setRaid(i.guild, false);
  await nukeAlert(i.guild, '✅ Panic mode off', `${i.user} restored the server.`, false);
  return rep(i, good('Everything restored.'));
};


/* ═══════════════════ TRAINING SYSTEM ═══════════════════ */
function trEmbed(tr, g) {
  const s = g.settings, gu = gameUrl(s.game), su = tr.signups || [], n = su.length;
  const col = { scheduled: COLOR, live: 0x2ecc71, done: 0x3498db, cancelled: 0x95a5a6 }[tr.status];
  const desc = { scheduled: tr.slots ? 'Click **Sign Up** to reserve a place. Places are limited — once the session is full, sign-ups close.' : 'Click **Sign Up** to reserve a place.', live: '🟢 **This training is in progress.**', done: '✅ This training has ended.', cancelled: '❌ This training was cancelled.' }[tr.status];
  const e = E(tr.title, desc).setColor(col).setFooter({ text: `${BRAND} • Training Sign-Up` });
  e.addFields({ name: 'When', value: `${ts(tr.start, 'F')} (${ts(tr.start)})` });
  if (tr.location) e.addFields({ name: 'Location to Meet', value: clip(tr.location, 300) });
  e.addFields({ name: 'Trainer(s)', value: [`<@${tr.host}>`, tr.cohost ? `<@${tr.cohost}>` : null].filter(Boolean).join('\n'), inline: true }, { name: 'Observer(s)', value: tr.observer ? `<@${tr.observer}>` : '—', inline: true });
  if (tr.prereq?.length) e.addFields({ name: 'Prerequisites', value: clip(tr.prereq.join('\n'), 1000) });
  e.addFields({ name: 'Places', value: tr.slots ? `${n} / ${tr.slots}` : `${n} signed up (no limit)` });
  if (n) e.addFields({ name: 'Signed up', value: clip(su.map(u => `<@${u}>`).join(' '), 1000) });
  e.addFields({ name: 'Details', value: [`**Length:** ${tr.lenMin} min`, tr.voice ? `**Voice:** <#${tr.voice}>` : null, gu ? `[Play on Roblox](${gu})` : null].filter(Boolean).join(' • ') });
  e.addFields({ name: '📋 Information', value: clip(s.training.info, 1000) });
  if (tr.notes) e.addFields({ name: '📝 Host notes', value: clip(tr.notes, 1000) });
  if (tr.startedAt) e.addFields({ name: '▶️ Started', value: ts(tr.startedAt), inline: true });
  if (tr.endedAt && tr.status === 'done') e.addFields({ name: '🏁 Ended', value: ts(tr.endedAt), inline: true }, { name: '✋ Attended', value: String(tr.final ?? 0), inline: true });
  return e;
}
const trRows = tr => {
  if (tr.status === 'done' || tr.status === 'cancelled') return [];
  const full = !!(tr.slots && (tr.signups || []).length >= tr.slots), rows = [];
  if (tr.status === 'scheduled') rows.push(row(btn('tr:signup', full ? 'Full' : 'Sign Up', ButtonStyle.Success).setDisabled(full), btn('tr:withdraw', 'Withdraw')));
  rows.push(row(btn('tr:start', 'Start training', ButtonStyle.Success).setDisabled(tr.status !== 'scheduled'), btn('tr:cancel', 'Cancel', ButtonStyle.Danger), btn('tr:end', 'End training', ButtonStyle.Primary).setDisabled(tr.status !== 'live')));
  return rows;
};
async function refreshTraining(guild, tr) {
  const ch = guild.channels.cache.get(tr.channelId), msg = ch && await ch.messages.fetch(tr.id).catch(() => null);
  await msg?.edit({ embeds: [trEmbed(tr, G(guild.id))], components: trRows(tr) }).catch(() => {});
}
async function endTraining(guild, g, tr, auto) {
  tr.status = 'done'; tr.endedAt = now();
  const att = Object.entries(tr.attended).filter(([, ms]) => ms >= 5 * 60000).map(([u]) => u); tr.final = att.length;
  for (const uid of att) { pil(g, uid).events++; autoMedals(g, uid); checkPromotion(guild, uid).catch(() => {}); }
  pil(g, tr.host).bonus += 25; checkPromotion(guild, tr.host).catch(() => {});
  if (tr.cohost) { pil(g, tr.cohost).bonus += 15; checkPromotion(guild, tr.cohost).catch(() => {}); }
  save(); await refreshTraining(guild, tr);
  const ch = guild.channels.cache.get(tr.channelId);
  ch?.send({ embeds: [E(`🏁 ${tr.title} — finished`, `Hosted by <@${tr.host}>${tr.cohost ? ` with <@${tr.cohost}>` : ''}${auto ? '\n*(Ended automatically after 6 hours.)*' : ''}\nLength: **${fmtDur(tr.endedAt - tr.startedAt)}**\n\n${tr.voice ? `**Attended (${att.length}):** ${clip(att.map(u => `<@${u}>`).join(' ') || 'nobody stayed 5+ minutes', 1500)}\nEveryone listed has had the training counted toward their rank.` : '*No voice channel was set, so attendance was not tracked.*'}\n\nThanks for hosting! (+25 points for the host)`).setColor(0x3498db)], allowedMentions: { parse: [] } }).catch(() => {});
}
async function onTrainingSignup(i, g, trMsg) {
  const [, act, tid] = i.customId.split(':'), tr = tid ? g.trainings[tid] : trMsg;
  if (!tr || tr.status === 'done' || tr.status === 'cancelled') return rep(i, bad('This training is no longer open.'));
  tr.signups ||= []; const has = tr.signups.includes(i.user.id), full = !!(tr.slots && tr.signups.length >= tr.slots), open = tr.status === 'scheduled';
  const onlyWithdraw = [row(btn(`tr:withdraw:${tr.id}`, 'Withdraw', ButtonStyle.Danger))];
  const onlySignUp = () => open && !(tr.slots && tr.signups.length >= tr.slots) ? [row(btn(`tr:join:${tr.id}`, 'Sign Up', ButtonStyle.Success))] : []; // evaluated *after* the change, so a freed place re-opens it
  const add = () => { if (!has) tr.signups.push(i.user.id); save(); }, drop = () => { tr.signups = tr.signups.filter(u => u !== i.user.id); save(); };
  if (act === 'signup') { // Sign Up pressed on the public card
    if (has) return rep(i, { embeds: [E(null, `✅ You are already signed up for **${tr.title}** (${ts(tr.start, 'f')}).`)], components: onlyWithdraw });
    if (!open) return rep(i, bad('This training already started — just join the voice channel!'));
    if (full) return rep(i, bad('This training is full.'));
    add(); await i.update({ embeds: [trEmbed(tr, g)], components: trRows(tr) });
    return i.followUp({ flags: MessageFlags.Ephemeral, embeds: [good(`You are signed up for **${tr.title}** — ${ts(tr.start, 'F')}. I will ping you before it starts.`)], components: onlyWithdraw });
  }
  if (act === 'withdraw' && !tid) { // Withdraw pressed on the public card
    if (!has) return rep(i, { embeds: [E(null, `You are not signed up for **${tr.title}**.`)], components: onlySignUp() });
    drop(); await i.update({ embeds: [trEmbed(tr, g)], components: trRows(tr) });
    return i.followUp({ flags: MessageFlags.Ephemeral, embeds: [E(null, `↩️ You withdrew from **${tr.title}**. Changed your mind?`)], components: onlySignUp() });
  }
  if (act === 'withdraw') { // Withdraw pressed in your private message -> it turns into Sign Up
    drop(); await i.update({ embeds: [E(null, `↩️ You withdrew from **${tr.title}**. Changed your mind?`)], components: onlySignUp() });
    return refreshTraining(i.guild, tr);
  }
  if (!open) return i.update({ embeds: [bad('This training already started — just join the voice channel!')], components: [] }); // 'join' (private Sign Up)
  if (!has && full) return i.update({ embeds: [bad('The training is full now.')], components: [] });
  add(); await i.update({ embeds: [good(`You are signed up again for **${tr.title}**.`)], components: onlyWithdraw });
  return refreshTraining(i.guild, tr);
}
async function onTrainingButton(i) {
  const g = G(i.guildId), tr = g.trainings[i.message.id], act = i.customId.split(':')[1];
  if (['signup', 'withdraw', 'join'].includes(act)) return onTrainingSignup(i, g, tr);
  if (!tr || tr.status === 'done' || tr.status === 'cancelled') return rep(i, bad('This training is already over.'));
  if (![tr.host, tr.cohost].includes(i.user.id) && !isStaff(i.member, g)) return rep(i, bad('Only the host, co-host or staff can use these buttons.'));
  if (act === 'start') {
    if (tr.status !== 'scheduled') return rep(i, bad('It already started.'));
    tr.status = 'live'; tr.startedAt = now(); tr.last = now(); save();
    await i.update({ embeds: [trEmbed(tr, g)], components: trRows(tr) });
    const gu = gameUrl(g.settings.game);
    i.channel.send({ content: [tr.role ? `<@&${tr.role}>` : '', ...(tr.signups || []).slice(0, 40).map(u => `<@${u}>`)].join(' ').trim() || undefined, embeds: [E('🟢 Training has started!', `${i.user} is now running **${tr.title}**.${tr.voice ? `\nJoin <#${tr.voice}> now!` : ''}${gu ? `\n[Play on Roblox](${gu})` : ''}`).setColor(0x2ecc71)], allowedMentions: { roles: tr.role ? [tr.role] : [], users: (tr.signups || []).slice(0, 40) } }).catch(() => {});
    return;
  }
  if (act === 'cancel') {
    tr.status = 'cancelled'; tr.endedAt = now(); save();
    await i.update({ embeds: [trEmbed(tr, g)], components: [] });
    i.channel.send({ content: (tr.signups || []).slice(0, 40).map(u => `<@${u}>`).join(' ') || undefined, embeds: [E(null, `❌ **${tr.title}** was cancelled by ${i.user}.`).setColor(0x95a5a6)], allowedMentions: { users: (tr.signups || []).slice(0, 40) } }).catch(() => {});
    return;
  }
  if (tr.status !== 'live') return rep(i, bad('Press **Start training** first — or cancel it.'));
  await i.deferUpdate(); await endTraining(i.guild, g, tr, false);
}
async function trainingTick(gid, g, t) {
  const guild = client.guilds.cache.get(gid); if (!guild) return;
  for (const tr of Object.values(g.trainings)) {
    const ch = guild.channels.cache.get(tr.channelId);
    const su = (tr.signups || []).slice(0, 40);
    const ping = txt => ch?.send({ content: `${tr.role ? `<@&${tr.role}> ` : ''}<@${tr.host}> ${su.map(u => `<@${u}>`).join(' ')}`.trim(), embeds: [E(`🎓 ${tr.title}`, txt)], allowedMentions: { roles: tr.role ? [tr.role] : [], users: [tr.host, ...su] } }).catch(() => {});
    if (tr.status === 'scheduled') {
      if (tr.start - t <= 36e5 && !tr.r1) { tr.r1 = true; save(); if (tr.start - t > 6e5) ping(`⏰ Training starts ${ts(tr.start)}!`); }
      if (tr.start - t <= 6e5 && !tr.r10) { tr.r10 = true; save(); if (tr.start > t) ping(`🎓 Starting ${ts(tr.start)} — get ready!`); }
      if (t > tr.start + 30 * 60000) { tr.status = 'cancelled'; tr.endedAt = t; save(); await refreshTraining(guild, tr); ch?.send({ embeds: [E(null, `⌛ **${tr.title}** was cancelled automatically — the host never pressed Start.`).setColor(0x95a5a6)] }).catch(() => {}); }
    } else if (tr.status === 'live') {
      const dt = Math.min(t - (tr.last || t), 60000); tr.last = t;
      const vc = tr.voice && guild.channels.cache.get(tr.voice);
      if (vc && dt > 0) for (const m of vc.members.values()) if (!m.user.bot) tr.attended[m.id] = (tr.attended[m.id] || 0) + dt;
      if (t - tr.startedAt > 6 * 36e5) await endTraining(guild, g, tr, true);
    } else if (t - (tr.endedAt || tr.start) > 30 * 864e5) delete g.trainings[tr.id];
  }
}
H.training = async i => {
  const g = G(i.guildId), s = g.settings, sc = i.options.getSubcommand();
  if (sc === 'setup') {
    const ch = i.options.getChannel('channel'), role = i.options.getRole('ping'), info = i.options.getString('info');
    if (ch) s.training.channel = ch.id; if (role) s.training.role = role.id; if (info) s.training.info = clip(info.replaceAll('\\n', '\n'), 1000); save();
    return rep(i, E('🎓 Training settings', `Channel: ${s.training.channel ? `<#${s.training.channel}>` : '*the channel you run the command in*'}\nPing role: ${s.training.role ? `<@&${s.training.role}>` : '*none*'}\n\n**Default information (shown on every training):**\n${s.training.info}`));
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const pk = pickTz(i); if (pk.error) return rep(i, bad(pk.error));
  const pw = parseWhenTz(i.options.getString('when'), pk.tz); if (!pw) return rep(i, bad(WHEN_HELP));
  const start = pw.ts; if (start < now() + 60000 || start > now() + 3 * 365 * 864e5) return rep(i, bad(`That time (${ts(start, 'F')}) is in the past or more than 3 years away.`));
  const co = i.options.getUser('cohost'); if (co && (co.bot || co.id === i.user.id)) return rep(i, bad('Pick a different member as co-host.'));
  const ch = i.options.getChannel('channel') || i.guild.channels.cache.get(s.training.channel) || i.channel, role = i.options.getRole('ping') || (s.training.role && i.guild.roles.cache.get(s.training.role));
  const tr = { id: null, title: clip(i.options.getString('title') || 'Training Session', 80), host: i.user.id, cohost: co?.id || null, observer: i.options.getUser('observer')?.id || null, location: clip(i.options.getString('location') || '', 300), prereq: (i.options.getString('prerequisites') || '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean).slice(0, 8).map(x => clip(x, 100)), start, lenMin: i.options.getInteger('minutes') || 60, notes: clip(i.options.getString('info') || '', 800), voice: i.options.getChannel('voice')?.id || null, role: role?.id || null, channelId: ch.id, status: 'scheduled', attended: {}, signups: [], slots: i.options.getInteger('slots') || 0 };
  const msg = await ch.send({ content: role ? `${role}` : undefined, embeds: [trEmbed(tr, g)], components: trRows(tr), allowedMentions: { roles: role ? [role.id] : [] } });
  tr.id = msg.id; g.trainings[msg.id] = tr; save();
  return rep(i, good(`Training posted in ${ch} for ${ts(start, 'F')} (${ts(start)}). ${whenNote(pw)} Press **Start training** when you begin — reminders go out 1 hour and 10 minutes before.`));
};


/* ═══════════════════ DEVELOPMENT NOTICES (title + info boxes + media, with approval) ═══════════════════ */
const muPending = new Map();
setInterval(() => { for (const [k, v] of muPending) if (now() - v.at > 15 * 60000) muPending.delete(k); }, 60000).unref();
async function fetchBuf(url) { const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(r.status); return Buffer.from(await r.arrayBuffer()); }
function muModal(cid, u = {}) {
  const f = (id, label, style, req, max, ph, val) => { const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(req).setMaxLength(max); if (ph) t.setPlaceholder(ph); if (val) t.setValue(val.slice(0, max)); return row(t); };
  return new ModalBuilder().setCustomId(cid).setTitle('Development notice').addComponents(
    f('title', 'Title', TextInputStyle.Short, true, 100, 'e.g. New runway map is live', u.title),
    f('info', '📋 Information', TextInputStyle.Paragraph, true, 1000, 'Everything players need to know', u.info),
    f('extra', '➕ Additional information (optional)', TextInputStyle.Paragraph, false, 1000, 'Extra details, known issues, credits', u.extra));
}
function muEmbed(u, mode, g) {
  const e = E(`🛠️ ${u.title}`).setColor(mode === 'public' || u.status === 'approved' ? 0x2ecc71 : u.status === 'rejected' ? 0xed4245 : 0xf1c40f);
  if (mode === 'public') e.setFooter({ text: `${BRAND} • Approved by ${u.approverName || 'staff'}` });
  else e.setDescription(`Submitted by <@${u.author}> • ${ts(u.created)}\n${u.status === 'pending' ? '🕒 **Waiting for approval** — nothing is public yet.' : u.status === 'approved' ? `✅ Approved by <@${u.by}> — posted in <#${u.target || g.settings.game.updatesChannel}>` : `❌ Rejected by <@${u.by}>${u.reason ? `: ${u.reason}` : ''}`}`);
  e.addFields({ name: '📋 Information', value: clip(u.info, 1024) });
  if (u.extra) e.addFields({ name: '➕ Additional information', value: clip(u.extra, 1024) });
  if (u.media?.image) e.setImage(`attachment://${u.media.name}`);
  else if (u.media && mode === 'review') e.addFields({ name: '📎 Attachment', value: u.media.name });
  return e;
}
const muRows = u => u.status !== 'pending' ? [] : [row(btn(`mu:ok:${u.id}`, 'Approve & post', ButtonStyle.Success), btn(`mu:edit:${u.id}`, 'Edit'), btn(`mu:no:${u.id}`, 'Reject', ButtonStyle.Danger))];
async function refreshMapCard(guild, g, u) {
  const ch = guild.channels.cache.get(u.channelId), msg = ch && await ch.messages.fetch(u.msgId).catch(() => null);
  await msg?.edit({ embeds: [muEmbed(u, 'review', g)], components: muRows(u) }).catch(() => {});
}
H.developmentnotice = async i => {
  const att = i.options.getAttachment('media');
  if (att) {
    if (BLOCKED_EXT.test(att.name)) return rep(i, bad('For safety I will not post executable or script files.'));
    const limit = i.guild.maximumUploadLimit || 10 * 1024 * 1024;
    if (att.size > limit) return rep(i, bad(`That file is ${(att.size / 1048576).toFixed(1)} MB — this server's upload limit is ${(limit / 1048576).toFixed(0)} MB.`));
  }
  muPending.set(i.id, { at: now(), user: i.user.id, att: att ? { url: att.url, name: att.name, type: att.contentType || '', size: att.size } : null, target: i.options.getChannel('channel')?.id || null, ping: i.options.getRole('ping')?.id || null });
  return i.showModal(muModal(`mu:new:${i.id}`));
};
async function onMapButton(i) {
  const g = G(i.guildId), gm = g.settings.game, [, act, id] = i.customId.split(':');
  if (!isStaff(i.member, g) && !i.member.permissions.has(PF.ManageGuild)) return rep(i, bad('Only staff can handle development notices.'));
  const u = g.mapUpdates[id]; if (!u || u.status !== 'pending') return rep(i, bad('That notice was already handled.'));
  if (act === 'edit') return i.showModal(muModal(`mu:edit:${id}`, u));
  if (act === 'no') return i.showModal(new ModalBuilder().setCustomId(`mu:rej:${id}`).setTitle('Reject notice').addComponents(row(new TextInputBuilder().setCustomId('reason').setLabel('Reason (sent to the author)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300))));
  if (u.author === i.user.id && !i.member.permissions.has(PF.ManageGuild)) return rep(i, bad('You cannot approve your own notice — ask another staff member.'));
  const pub = i.guild.channels.cache.get(u.target || gm.updatesChannel); if (!pub) return rep(i, bad('No public channel is set. Use `/gamesetup updates`.'));
  await i.deferUpdate();
  const fail = t => i.followUp({ embeds: [bad(t)], flags: MessageFlags.Ephemeral });
  let files = [];
  if (u.media) { // re-read the file from the review card (its link is always fresh there)
    const rm = await i.guild.channels.cache.get(u.channelId)?.messages.fetch(u.msgId).catch(() => null), a = rm?.attachments.first();
    if (!a) return fail('The attached file is missing from this card.');
    try { files = [new AttachmentBuilder(await fetchBuf(a.url), { name: u.media.name })]; } catch { return fail('I could not copy the attached file. Try approving again.'); }
  }
  const roleId = u.ping || gm.updatesRole;
  u.status = 'approved'; u.by = i.user.id; u.approverName = i.member.displayName; u.approvedAt = now();
  const msg = await pub.send({ content: roleId ? `<@&${roleId}>` : undefined, embeds: [muEmbed(u, 'public', g)], files, allowedMentions: { roles: roleId ? [roleId] : [] } }).catch(() => null);
  if (!msg) { u.status = 'pending'; return fail('I could not post in the public channel — check my permissions there.'); }
  u.published = msg.id; save(); await refreshMapCard(i.guild, g, u);
  client.users.fetch(u.author).then(a => a.send({ embeds: [E(`✅ "${u.title}" was approved`, `Your development notice is now live in ${i.guild.name}.`).setColor(0x2ecc71)] })).catch(() => {});
}
async function onMapModal(i) {
  const g = G(i.guildId), id = i.customId;
  if (!isStaff(i.member, g) && !i.member.permissions.has(PF.ManageGuild)) return rep(i, bad('Only staff can handle development notices.'));
  if (id.startsWith('mu:rej:')) {
    const u = g.mapUpdates[id.split(':')[2]]; if (!u || u.status !== 'pending') return rep(i, bad('That notice was already handled.'));
    u.status = 'rejected'; u.by = i.user.id; u.reason = clip(i.fields.getTextInputValue('reason') || '', 300); save(); await refreshMapCard(i.guild, g, u);
    client.users.fetch(u.author).then(a => a.send({ embeds: [E(`❌ "${u.title}" was not approved`, u.reason ? `**Reason:** ${u.reason}` : 'No reason was given.').setColor(0xed4245)] })).catch(() => {});
    return rep(i, good('Rejected. The author has been notified.'));
  }
  const title = clip(i.fields.getTextInputValue('title').trim(), 100), info = clip(i.fields.getTextInputValue('info').trim(), 1000), extra = clip((i.fields.getTextInputValue('extra') || '').trim(), 1000);
  if (!title || !info) return rep(i, bad('The title and the information box cannot be empty.'));
  if (id.startsWith('mu:edit:')) {
    const u = g.mapUpdates[id.split(':')[2]]; if (!u || u.status !== 'pending') return rep(i, bad('That notice was already handled.'));
    Object.assign(u, { title, info, extra }); save(); await refreshMapCard(i.guild, g, u); return rep(i, good('Notice updated.'));
  }
  const pend = muPending.get(id.split(':')[2]);
  if (!pend || pend.user !== i.user.id) return rep(i, bad('That form timed out. Run `/developmentnotice` again.'));
  muPending.delete(id.split(':')[2]);
  const ch = i.guild.channels.cache.get(g.settings.game.reviewChannel) || i.guild.channels.cache.get(g.settings.channels.logs);
  if (!ch) return rep(i, bad('No approval channel yet — run `/setup` or `/gamesetup review`.'));
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  let media = null, files = [];
  if (pend.att) {
    const name = pend.att.name.replace(/[^\w.\-]/g, '_').slice(-80) || 'media';
    try { files = [new AttachmentBuilder(await fetchBuf(pend.att.url), { name })]; media = { name, size: pend.att.size, image: /^image\/(png|jpe?g|gif|webp)/.test(pend.att.type) || /\.(png|jpe?g|gif|webp)$/i.test(name) }; }
    catch { return rep(i, bad('I could not download your attachment. Run the command again.')); }
  }
  const u = { id: now().toString(36), title, info, extra, media, target: pend.target, ping: pend.ping, author: i.user.id, status: 'pending', created: now() };
  const msg = await ch.send({ embeds: [muEmbed(u, 'review', g)], components: muRows(u), files }).catch(() => null);
  if (!msg) return rep(i, bad(`I cannot post in ${ch}. Check my permissions there.`));
  u.channelId = ch.id; u.msgId = msg.id; g.mapUpdates[u.id] = u; save();
  return rep(i, good(`Sent for approval in ${ch}. It is only posted publicly once staff approve it.`));
}

/* ═══════════════════ MEDIA ═══════════════════ */
const BLOCKED_EXT = /\.(exe|bat|cmd|com|scr|msi|dll|js|jar|vbs|ps1|sh|apk|lnk|hta|cpl)$/i;
H.media = async i => {
  const att = i.options.getAttachment('file'), ch = i.options.getChannel('channel') || i.channel, role = i.options.getRole('ping'), g = G(i.guildId);
  if (BLOCKED_EXT.test(att.name)) return rep(i, bad('For safety I will not send executable or script files.'));
  const limit = i.guild.maximumUploadLimit || 10 * 1024 * 1024;
  if (att.size > limit) return rep(i, bad(`That file is ${(att.size / 1048576).toFixed(1)} MB — this server's upload limit is ${(limit / 1048576).toFixed(0)} MB.`));
  const perms = ch.permissionsFor(i.member);
  if (!perms?.has(PF.SendMessages) || !perms.has(PF.AttachFiles)) return rep(i, bad(`You cannot send files in ${ch}.`));
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  let buf; try { const r = await fetch(att.url, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(r.status); buf = Buffer.from(await r.arrayBuffer()); }
  catch { return rep(i, bad('I could not download that file. Try uploading it again.')); }
  const file = new AttachmentBuilder(buf, { name: att.name, description: att.description || undefined }); if (i.options.getBoolean('spoiler')) file.setSpoiler(true);
  const text = [role ? `${role}` : '', clip(i.options.getString('message') || '', 1800)].join(' ').trim();
  const msg = await ch.send({ content: text || undefined, files: [file], allowedMentions: { roles: role ? [role.id] : [] } }).catch(() => null);
  if (!msg) return rep(i, bad(`I could not post in ${ch}. Check that I can send messages and attach files there.`));
  logTo(i.guild, 'mod', E('📎 Media posted', `${i.user} sent **${att.name}** in ${ch} • [jump](${msg.url})`));
  return rep(i, good(`Sent **${att.name}** to ${ch}.`));
};

/* ═══════════════════ FLEXIBLE DATE/TIME + TIMEZONES ═══════════════════ */
const TZLIST = [...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []), 'UTC'];
const TZ_ABBR = { utc: 0, gmt: 0, ut: 0, z: 0, bst: 'Europe/London', wet: 'Europe/Lisbon', west: 'Europe/Lisbon', cet: 'Europe/Paris', cest: 'Europe/Paris', eet: 'Europe/Athens', eest: 'Europe/Athens', msk: 'Europe/Moscow', est: 'America/New_York', edt: 'America/New_York', et: 'America/New_York', cst: 'America/Chicago', cdt: 'America/Chicago', ct: 'America/Chicago', mst: 'America/Denver', mdt: 'America/Denver', mt: 'America/Denver', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pt: 'America/Los_Angeles', akst: 'America/Anchorage', akdt: 'America/Anchorage', hst: 'Pacific/Honolulu', ast: 'America/Halifax', adt: 'America/Halifax', nst: 'America/St_Johns', ndt: 'America/St_Johns', brt: 'America/Sao_Paulo', art: 'America/Argentina/Buenos_Aires', ist: 'Asia/Kolkata', pkt: 'Asia/Karachi', gst: 'Asia/Dubai', sgt: 'Asia/Singapore', hkt: 'Asia/Hong_Kong', wib: 'Asia/Jakarta', jst: 'Asia/Tokyo', kst: 'Asia/Seoul', awst: 'Australia/Perth', acst: 'Australia/Adelaide', acdt: 'Australia/Adelaide', aest: 'Australia/Sydney', aedt: 'Australia/Sydney', nzst: 'Pacific/Auckland', nzdt: 'Pacific/Auckland', sast: 'Africa/Johannesburg', wat: 'Africa/Lagos', cat: 'Africa/Maputo', eat: 'Africa/Nairobi' };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], WDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const WHEN_HELP = 'I could not read that time. Examples: `25/12/2026 6:30pm`, `25 Dec 2026 18:30 EST`, `friday 8pm`, `tomorrow 19:00 GMT+2`, `2026-12-25 18:30 Europe/London`, or `in 2h30m`. Save your timezone once with `/timezone set`.';
function resolveTz(raw) {
  if (!raw) return null; const t = String(raw).trim(), low = t.toLowerCase().replace(/\s+/g, ' '); if (!t) return null;
  let m = low.match(/^(?:utc|gmt)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/);
  if (m) { const mins = (+m[2] * 60 + +(m[3] || 0)) * (m[1] === '-' ? -1 : 1); return Math.abs(mins) <= 14 * 60 ? { kind: 'fixed', min: mins, label: `UTC${m[1]}${m[2]}${m[3] ? ':' + m[3] : ''}` } : null; }
  if (TZ_ABBR[low] !== undefined) { const v = TZ_ABBR[low]; return typeof v === 'number' ? { kind: 'fixed', min: v, label: t.toUpperCase() } : { kind: 'iana', zone: v, label: t.toUpperCase() }; }
  const key = low.replace(/ /g, '_'), z = TZLIST.find(x => x.toLowerCase() === key); if (z) return { kind: 'iana', zone: z, label: z };
  try { new Intl.DateTimeFormat('en-US', { timeZone: t }); return { kind: 'iana', zone: t, label: t }; } catch {} // any valid IANA name (e.g. Asia/Kolkata)
  const hits = TZLIST.filter(x => x.toLowerCase().endsWith('/' + key)); return hits.length === 1 ? { kind: 'iana', zone: hits[0], label: hits[0] } : null;
}
function zoneOffset(ts, zone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts)).filter(x => x.type !== 'literal').map(x => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}
function wallToEpoch(y, mo, d, h, mi, T) {
  const dt = new Date(Date.UTC(y, mo - 1, d)); if (mo < 1 || mo > 12 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi); if (T.kind === 'fixed') return guess - T.min * 60000;
  const off = zoneOffset(guess, T.zone); let t = guess - off; const off2 = zoneOffset(t, T.zone); if (off2 !== off) t = guess - off2; return t;
}
function localToday(T) { const off = T.kind === 'fixed' ? T.min * 60000 : zoneOffset(now(), T.zone), t = new Date(now() + off); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() }; }
/** Understands: 25/12/2026 6:30pm • 25 Dec 2026 18:30 EST • December 25th at 8pm PST • 2026-12-25T18:30-05:00 • friday 8pm • tomorrow 19:00 GMT+2 • in 2h30m … in any timezone */
function parseWhenTz(input, defTz) {
  let str = String(input || '').trim(); if (!str) return null; let m;
  const dur = /^(?:in\s+)?((?:\d+(?:\.\d+)?\s*[wdhms]\s*)+)$/i.exec(str);
  if (dur) { const ms = parseDuration(dur[1]); return ms ? { ts: now() + ms, label: 'relative', assumed: false } : null; }
  let tz = null;
  if ((m = str.match(/\d{1,2}:\d{2}(?::\d{2})?\s*([+-]\d{2}):?(\d{2})$/)) && (tz = resolveTz(`utc${m[1]}:${m[2]}`))) str = str.replace(/([+-]\d{2}):?(\d{2})$/, '').trim();
  if (!tz && (m = str.match(/(?:^|\s)((?:utc|gmt)\s*)?([+-])\s*(\d{1,2})(?::?(\d{2}))?\s*$/i)) && (tz = resolveTz(`${m[1] ? 'utc' : ''}${m[2]}${m[3]}${m[4] ? ':' + m[4] : ''}`))) str = str.slice(0, m.index).trim();
  if (!tz && (m = str.match(/[A-Za-z]+\/[A-Za-z0-9_+\-\/]+/)) && (tz = resolveTz(m[0]))) str = str.replace(m[0], ' ').trim();
  if (!tz && (m = str.match(/(\d)\s*z$/i))) { tz = resolveTz('utc'); str = str.slice(0, m.index + 1).trim(); }
  if (!tz && (m = str.match(/(?:^|\s)([A-Za-z]{1,5})\s*$/)) && TZ_ABBR[m[1].toLowerCase()] !== undefined) { tz = resolveTz(m[1]); str = str.slice(0, m.index).trim(); }
  const T = tz || defTz || resolveTz('utc'), assumed = !tz && !defTz;
  let s = ' ' + str.toLowerCase().replace(/,/g, ' ') + ' ';
  s = s.replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, '$1').replace(/\b(at|on|the|of|from|starting)\b/g, ' ');
  let h = null, mi = 0;
  if ((m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.m\.|p\.m\.|am|pm)?/))) { h = +m[1]; mi = +m[2]; const ap = m[3] && m[3][0]; if (ap) { if (h < 1 || h > 12) return null; h = h % 12 + (ap === 'p' ? 12 : 0); } s = s.replace(m[0], ' '); }
  else if ((m = s.match(/(\d{1,2})\s*(am|pm)\b/))) { h = +m[1]; if (h < 1 || h > 12) return null; h = h % 12 + (m[2] === 'pm' ? 12 : 0); s = s.replace(m[0], ' '); }
  else if ((m = s.match(/\b(noon|midnight)\b/))) { h = m[1] === 'noon' ? 12 : 0; s = s.replace(m[0], ' '); }
  if (h === null || h > 23 || mi > 59) return null;
  const n0 = localToday(T); let y = null, mo, d, roll = 0, ok = true;
  if ((m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/))) { const a = +m[1], b = +m[2]; y = +m[3]; if (y < 100) y += 2000; if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else { d = a; mo = b; } }
  else if ((m = s.match(new RegExp(`(\\d{1,2})\\s*${MON}\\.?\\s*(\\d{4})?`)))) { d = +m[1]; mo = MONTHS.indexOf(m[2]) + 1; if (m[3]) y = +m[3]; }
  else if ((m = s.match(new RegExp(`${MON}\\.?\\s*(\\d{1,2})(?!\\d)\\s*(\\d{4})?`)))) { mo = MONTHS.indexOf(m[1]) + 1; d = +m[2]; if (m[3]) y = +m[3]; }
  else if ((m = s.match(/(\d{1,2})[\/.](\d{1,2})(?![\d\/.])/))) { const a = +m[1], b = +m[2]; if (b > 12) { mo = a; d = b; } else { d = a; mo = b; } }
  else {
    let add = 0; ok = false;
    if (/\b(today|tonight)\b/.test(s)) ok = true;
    else if (/\btomorrow\b/.test(s)) { add = 1; ok = true; }
    else if ((m = s.match(new RegExp(`\\b(next\\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\\b`)))) { add = (WDAYS.indexOf(m[2]) - n0.wd + 7) % 7; if (m[1] && add === 0) add = 7; roll = 7; ok = true; }
    else { roll = 1; ok = true; } // time only: next occurrence
    if (!ok) return null;
    const t = new Date(Date.UTC(n0.y, n0.m - 1, n0.d + add)); y = t.getUTCFullYear(); mo = t.getUTCMonth() + 1; d = t.getUTCDate();
  }
  let out;
  if (y === null) { y = n0.y; out = wallToEpoch(y, mo, d, h, mi, T); if (out !== null && out <= now()) out = wallToEpoch(y + 1, mo, d, h, mi, T); }
  else { out = wallToEpoch(y, mo, d, h, mi, T); if (out !== null && roll && out <= now()) { const t = new Date(Date.UTC(y, mo - 1, d + roll)); out = wallToEpoch(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), h, mi, T); } }
  return out === null ? null : { ts: out, label: T.label, assumed };
}
const parseWhen = str => parseWhenTz(str, null)?.ts ?? null;
const userTz = uid => resolveTz(db.global.tz[uid]);
function fmtLocal(T) { const zone = T.kind === 'iana' ? T.zone : 'UTC'; return new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(T.kind === 'iana' ? now() : now() + T.min * 60000); }
function tzSuggest(q) {
  q = q.toLowerCase().replace(/ /g, '_');
  if (!q) return ['UTC', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/Paris', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'];
  return [...new Set([...Object.keys(TZ_ABBR).filter(k => k.startsWith(q)).map(k => k.toUpperCase()), ...TZLIST.filter(z => z.toLowerCase().includes(q))])].slice(0, 25);
}
/** resolves the `timezone` option (or the user's saved zone). Returns { tz } or { error } */
function pickTz(i) {
  const raw = i.options.getString('timezone'); if (!raw) return { tz: userTz(i.user.id) };
  const tz = resolveTz(raw); return tz ? { tz } : { error: `I do not know the timezone \`${raw}\`. Try \`EST\`, \`GMT+2\`, \`Europe/London\` or a city like \`London\`.` };
}
const whenNote = pw => `Read as **${pw.label}**${pw.assumed ? ' *(assumed — save yours with `/timezone set`, or add one like `EST` to the time)*' : ''}.`;
H.timezone = async i => {
  if (i.options.getSubcommand() === 'view') { const tz = userTz(i.user.id); return rep(i, tz ? E('🕐 Your timezone', `**${tz.label}** — it is **${fmtLocal(tz)}** for you right now.`) : E(null, 'You have no saved timezone, so times are read as UTC. Set it with `/timezone set`.')); }
  const raw = i.options.getString('zone'), tz = resolveTz(raw);
  if (!tz) return rep(i, bad('I do not know that timezone. Try `EST`, `GMT+2`, `Europe/London` or a city like `London`.'));
  db.global.tz[i.user.id] = raw.trim(); save();
  return rep(i, good(`Saved **${tz.label}** (it is ${fmtLocal(tz)} there). Trainings and events you schedule are now read in this timezone unless you add another.`));
};

/* ═══════════════════════ SCHEDULER ═══════════════════════ */
let tickN = 0;
async function tick() {
  const t = now(); tickN++;
  await flushMedals().catch(() => {});
  for (const gid of Object.keys(db.guilds)) {
    const g = G(gid);
    if (g.settings.raid.active && g.settings.raid.until <= t) { const gg = client.guilds.cache.get(gid); if (gg) await setRaid(gg, false).catch(console.error); }
    for (const gw of Object.values(g.giveaways)) { if (!gw.ended && gw.end <= t) await endGiveaway(gid, gw.id).catch(console.error); else if (gw.ended && t - gw.end > 30 * 864e5) delete g.giveaways[gw.id]; }
    for (const [id, p] of Object.entries(g.polls)) { if (!p.ended && p.end && p.end <= t) await endPoll(gid, id).catch(console.error); else if (p.ended && t - (p.end || 0) > 30 * 864e5) delete g.polls[id]; }
    await eventTick(gid, g, t).catch(console.error); await trainingTick(gid, g, t).catch(console.error); await dropTick(gid, g, t).catch(() => {}); await briefingTick(gid, g).catch(console.error);
    if (tickN % 4 === 0) await vcTick(gid, g).catch(() => {});
    if (tickN % 20 === 0) await gameTick(gid, g).catch(() => {});
    if (tickN % 240 === 0) await verifyTick(gid, g).catch(console.error);
    if (tickN % 4 === 0) await sweepThreads(gid, g, t);
    // birthdays (UTC, once per day)
    const d = new Date(), key = d.toISOString().slice(0, 10);
    if (g.lastBday !== key && g.settings.channels.birthdays) {
      g.lastBday = key; save();
      const ids = Object.entries(g.birthdays).filter(([, b]) => b.d === d.getUTCDate() && b.m === d.getUTCMonth() + 1).map(([id]) => id);
      const ch = client.channels.cache.get(g.settings.channels.birthdays);
      if (ch && ids.length) ch.send({ embeds: [E('🎂 Happy birthday!', ids.map(id => `<@${id}>`).join(', ') + ' — have a great day!')], allowedMentions: { users: ids } }).catch(() => {});
    }
  }
  const due = db.reminders.filter(r => r.at <= t);
  if (due.length) {
    db.reminders = db.reminders.filter(r => r.at > t); save();
    for (const r of due) {
      const e = E('⏰ Reminder', r.text), u = await client.users.fetch(r.userId).catch(() => null);
      if (!(u && await u.send({ embeds: [e] }).then(() => true).catch(() => false))) client.channels.cache.get(r.channelId)?.send({ content: `<@${r.userId}>`, embeds: [e] }).catch(() => {});
    }
  }
}
async function sweepThreads(gid, g, t) {
  for (const [id, th] of Object.entries(g.threads)) {
    const ch = client.channels.cache.get(id);
    if (!ch) { delete g.threads[id]; save(); continue; }
    if (th.closeAt && th.closeAt <= t) await closeThread(ch, null, th.closeReason || 'Scheduled close').catch(console.error);
    else if (g.settings.autoCloseHours && t - th.last > g.settings.autoCloseHours * 36e5) await closeThread(ch, null, `Inactive for ${g.settings.autoCloseHours}h`).catch(console.error);
  }
}

/* ═══════════════════════ EVENTS ═══════════════════════ */
client.on(Events.MessageCreate, async m => {
  try {
    if (m.author.bot) return;
    if (!m.guild) return await onDM(m);
    const g = G(m.guild.id);
    if (await onThreadMessage(m)) return;
    if (await automod(m, g)) return;
    const a = A(m.guild.id); a.msgs.push({ t: now(), c: m.channel.id }); prune(a.msgs, 36e5);
    bump(g, 'msgs'); noteActivity(m);
    if (g.afk[m.author.id]) {
      delete g.afk[m.author.id]; save();
      m.reply({ embeds: [E(null, '👋 Welcome back, I removed your AFK.')], allowedMentions: { repliedUser: false } }).then(x => setTimeout(() => x.delete().catch(() => {}), 8000)).catch(() => {});
    }
    for (const u of [...m.mentions.users.values()].slice(0, 3)) {
      const af = g.afk[u.id]; if (af && u.id !== m.author.id) m.reply({ embeds: [E(null, `💤 **${u.username}** is AFK: ${af.reason} (${ts(af.since)})`)], allowedMentions: { repliedUser: false } }).catch(() => {});
    }
    if (g.settings.leveling) await giveXp(m, g);
  } catch (e) { console.error('messageCreate', e); }
});
client.on(Events.GuildMemberAdd, async mem => {
  try {
    if (await onGlobalJoin(mem)) return;
    const a = A(mem.guild.id); a.joins.push({ t: now(), young: now() - mem.user.createdTimestamp < 7 * 864e5 }); prune(a.joins, 36e5);
    const g = G(mem.guild.id);
    if (g.settings.raid.auto && !raidActive(g) && !mem.user.bot && raidRisk(a).score >= 60) await setRaid(mem.guild, true, 30);
    if (raidActive(g) && !mem.user.bot) {
      await dmUser(mem.user, `${mem.guild.name} is under raid protection`, 'New members are being removed temporarily. Please try joining again later.', 0xe67e22);
      await mem.kick('Raid shield').catch(() => {}); g.settings.raid.blocked = (g.settings.raid.blocked || 0) + 1; save(); return;
    }
    bump(g, 'joins'); await onJoinFlow(mem, g); await restoreSticky(mem, g);
    for (const r of g.autoroles) await mem.roles.add(r, 'Autorole').catch(() => {});
    logTo(mem.guild, 'members', E('📥 Member joined').setColor(0x2ecc71).setThumbnail(mem.user.displayAvatarURL()).setDescription(`${mem} — ${mem.user.username}\nAccount created ${ts(mem.user.createdTimestamp)}${now() - mem.user.createdTimestamp < 7 * 864e5 ? ' ⚠️ **new account**' : ''}`));
  } catch (e) { console.error(e); }
});
client.on(Events.MessageReactionAdd, (r, u) => onStar(r, u).catch(e => console.error('star', e)));
client.on(Events.VoiceStateUpdate, async (o, n) => {
  try {
    const g = G(n.guild.id), hub = g.settings.channels.voiceHub;
    if (n.channelId && n.channelId === hub && n.member) {
      const ch = await n.guild.channels.create({ name: clip(`🔊 ${n.member.displayName}'s room`, 100), type: CT.GuildVoice, parent: n.channel.parentId });
      g.tempvoice[ch.id] = n.member.id; save();
      await n.member.voice.setChannel(ch).catch(async () => { delete g.tempvoice[ch.id]; await ch.delete().catch(() => {}); });
    }
    if (o.channelId && o.channelId !== n.channelId && g.tempvoice[o.channelId] && o.channel && o.channel.members.size === 0) {
      delete g.tempvoice[o.channelId]; save(); await o.channel.delete('Temp voice empty').catch(() => {});
    }
  } catch (e) { console.error('voice', e); }
});

/* ── interactions ── */
async function onButton(i) {
  const id = i.customId;
  if (id.startsWith('ver:')) return onVerifyButton(i);
  if (id.startsWith('ev:')) return onEventButton(i);
  if (id.startsWith('tr:')) return onTrainingButton(i);
  if (id.startsWith('mu:')) return onMapButton(i);
  if (id === 'drop:claim') return onDropClaim(i);
  if (id.startsWith('mmr:')) {
    const [, gid, cid, n] = id.split(':'), g = db.guilds[gid];
    const rec = g && Object.values(g.history || {}).flat().find(r => r.id === cid);
    if (!rec) return i.update({ components: [] });
    if (rec.rating) return rep(i, E(null, 'You already rated this thread.'));
    rec.rating = +n; save();
    await i.update({ embeds: [E(null, `Thanks for rating us ${'⭐'.repeat(+n)}!`)], components: [] });
    const guild = client.guilds.cache.get(gid), log = guild && logChannel(guild);
    return void log?.send({ embeds: [E('⭐ Thread rated', `<@${i.user.id}> rated their thread **${'⭐'.repeat(+n)}** (${n}/5).`)] }).catch(() => {});
  }
  if (id === 'app:submit') return submitApp(i);
  if (id === 'app:cancel') { endSession(i.user.id); return i.update({ embeds: [E(null, 'Application cancelled.')], components: [] }); }
  if (!i.guild) return;
  const g = G(i.guildId);
  if (id.startsWith('appr:')) {
    if (!isStaff(i.member, g)) return rep(i, bad('Staff only.'));
    const [, act, sid] = id.split(':'), sub = g.subs[sid];
    if (!sub || sub.status !== 'pending') return rep(i, bad('This application was already handled.'));
    if (act === 'd') return i.showModal(new ModalBuilder().setCustomId(`appd:${sid}`).setTitle('Deny application').addComponents(row(new TextInputBuilder().setCustomId('reason').setLabel('Reason (sent to the applicant)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(400))));
    await i.deferReply({ flags: MessageFlags.Ephemeral }); await finalize(i, sub, 'accepted'); return rep(i, good('Application accepted.'));
  }
  if (id === 'gw:enter') {
    const gw = g.giveaways[i.message.id]; if (!gw || gw.ended) return rep(i, bad('This giveaway has ended.'));
    const k = gw.entries.indexOf(i.user.id); if (k >= 0) gw.entries.splice(k, 1); else gw.entries.push(i.user.id); save();
    return rep(i, good(k >= 0 ? 'You left the giveaway.' : `You're in! (${gw.entries.length} entries)`));
  }
  if (id.startsWith('poll:')) {
    const p = g.polls[i.message.id]; if (!p || p.ended) return rep(i, bad('This poll has ended.'));
    const n = +id.split(':')[1]; if (p.votes[i.user.id] === n) delete p.votes[i.user.id]; else p.votes[i.user.id] = n; save();
    return i.update({ embeds: [pollEmbed(p, false)] });
  }
}
async function onModal(i) {
  if (i.customId === 'verm') return onVerifyModal(i);
  if (i.customId.startsWith('mu:')) return onMapModal(i);
  if (!i.customId.startsWith('appd:') || !i.guild) return;
  const g = G(i.guildId); if (!isStaff(i.member, g)) return rep(i, bad('Staff only.'));
  const sub = g.subs[i.customId.split(':')[1]]; if (!sub || sub.status !== 'pending') return rep(i, bad('This application was already handled.'));
  await i.deferReply({ flags: MessageFlags.Ephemeral }); await finalize(i, sub, 'denied', i.fields.getTextInputValue('reason') || null);
  return rep(i, good('Application denied.'));
}
async function onSelect(i) {
  if (i.customId !== 'mmpick') return;
  const p = dmPending.get(i.user.id); if (!p) return i.update({ embeds: [bad('That request expired. Send your message again.')], components: [] });
  dmPending.delete(i.user.id);
  const guild = client.guilds.cache.get(i.values[0]); if (!guild) return i.update({ embeds: [bad('Server not found.')], components: [] });
  await i.update({ embeds: [E(null, `Sending to **${guild.name}**…`)], components: [] });
  const { ch, t } = await openThread(guild, i.user); await relayToStaff(ch, t, p.m);
}
async function onAuto(i) {
  const f = i.options.getFocused(true), v = String(f.value).toLowerCase(), g = G(i.guildId); let list = [];
  if (f.name === 'form') list = Object.values(g.forms).filter(x => i.commandName !== 'apply' || x.enabled).map(x => x.name);
  else if (f.name === 'name' && i.commandName === 'snippet') list = Object.keys(g.snippets);
  else if (f.name === 'squad') list = Object.keys(g.squads);
  else if (f.name === 'medal') list = Object.keys(g.medals);
  else if (f.name === 'zone' || f.name === 'timezone') return i.respond(tzSuggest(v).map(x => ({ name: x, value: x })));
  return i.respond(list.filter(x => x.includes(v)).slice(0, 25).map(x => ({ name: x, value: x })));
}
client.on(Events.InteractionCreate, async i => {
  try {
    if (i.isChatInputCommand() || i.isMessageContextMenuCommand()) {
      const h = H[i.commandName];
      if (!h) return void rep(i, bad('That command is not part of the version of the bot that is running. Stop the bot and start it again with the latest `redarrows.js`.')).catch(() => {});
      const wd = setTimeout(() => { if (!i.replied && !i.deferred) i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {}); }, 1800); // Discord gives us 3s
      let sub = null; try { sub = i.options.getSubcommand(false); } catch {}
      const name = `/${i.commandName}${sub ? ' ' + sub : ''}`, t0 = now(), lag = t0 - (i.createdTimestamp || t0);
      console.log(`▶ ${name} from ${i.user?.username} in ${i.guild?.name} (reached the bot after ${lag} ms)`);
      if (lag > 2000) console.warn(`⚠️ ${name} arrived ${lag} ms after it was sent — Discord only waits 3000 ms. The host/internet is too slow or the PC clock is wrong.`);
      try { await h(i); console.log(`✔ ${name} finished in ${now() - t0} ms`); } finally { clearTimeout(wd); }
    }
    else if (i.isAutocomplete()) await onAuto(i);
    else if (i.isButton()) await onButton(i);
    else if (i.isModalSubmit()) await onModal(i);
    else if (i.isStringSelectMenu()) await onSelect(i);
  } catch (e) {
    console.error('interaction', i.commandName || i.customId, e);
    if (i.isAutocomplete?.()) return;
    rep(i, bad(`Something went wrong${e.code === 50013 ? ' — I am missing permissions.' : '.'}`)).catch(() => {});
  }
});

/* ── startup ── */
client.once(Events.ClientReady, async () => {
  console.log(`${BRAND} bot online as ${client.user.tag} in ${client.guilds.cache.size} server(s) • ${cmds.length} commands • file saved ${fs.statSync(__filename).mtime.toISOString()} • Node ${process.version} • discord.js ${DJS}`);
  for (const gd of client.guilds.cache.values()) { const miss = gd.members.me?.permissions.missing(NEEDED) || []; console.log(`  server "${gd.name}": ${miss.length ? 'MISSING permissions → ' + miss.join(', ') : 'all needed permissions OK'}`); }
  client.user.setPresence({ activities: [{ name: `${BRAND} • /help • DM for modmail`, type: ActivityType.Watching }], status: 'online' });
  console.log(`Invite link (use this one!): https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot%20applications.commands&permissions=8`);
  await loadOwners();
  await syncCommands().catch(e => console.error('Command sync failed', e));
  for (const guild of client.guilds.cache.values()) { // clean up temp channels left over from downtime
    const g = G(guild.id);
    for (const id of Object.keys(g.tempvoice)) { const ch = guild.channels.cache.get(id); if (!ch) delete g.tempvoice[id]; else if (!ch.members.size) { delete g.tempvoice[id]; await ch.delete().catch(() => {}); } }
  }
  save(); for (const gid of Object.keys(db.guilds)) gameTick(gid, G(gid)).catch(() => {});
  setInterval(() => tick().catch(console.error), 15000);
});
client.on(Events.GuildCreate, guild => syncGuildCommands(guild).catch(console.error));
client.login(TOKEN).catch(e => {
  console.error('❌ Login failed:', e.message);
  if (/disallowed intents/i.test(e.message)) console.error('→ Turn ON "Server Members Intent" and "Message Content Intent" in the Developer Portal → Bot, save, then restart.');
  else console.error('→ The token is probably wrong. Reset it in the Developer Portal → Bot and paste the new one.');
  process.exit(1);
});
