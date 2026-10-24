# Red Arrows Team Bot

## Install
1. `npm install`
2. Copy `.env.example` to `.env`, paste your bot token (or set `DISCORD_TOKEN` on your host). Node 18.17+.
3. Developer Portal → Bot → enable **Server Members Intent** and **Message Content Intent**.
4. Invite with `bot` + `applications.commands` and **Administrator** (simplest) — or at least: Manage Channels/Roles/Messages/Nicknames, Ban/Kick/Moderate Members, View Audit Log, Move Members.
5. `npm start`, then in your server run:
   **`/setup staff_role:@Staff game_url:https://www.roblox.com/games/<id>/<name>`**
6. **Drag the bot's role to the very top** of Server Settings → Roles (needed for anti-nuke to punish people).

`/setup` automatically creates: Verified + Unverified roles, #welcome, #verify (with the panel), #applications (staff only), a ready-made `team` application form, modmail category + logs, a private Logs category (mod, automod, messages, members, voice, server, antinuke, verify…), and a temp-voice hub. Finally run `/verification lock` once to hide the server from Unverified members.

## What it does (automatically)
- **Anti-nuke** — watches the audit log. Mass channel/role delete or create, mass bans/kicks, webhook spam, dangerous permission grants and unauthorised bot adds are blocked. The culprit is banned (or kicked / stripped), things they created are deleted, deleted channels & roles are rebuilt, the raid shield turns on and the owner is DMed. Only the **server owner** can change settings or whitelist (`/antinuke`).
- **Roblox verification** — members enter their Roblox username and paste a one-time code into their profile description; the bot checks it via Roblox's public API, gives the Verified role and sets their nickname to their Roblox name. Returning members are re-verified instantly. Unverified members are kicked after 24h (configurable).
- **Game integration** — `/game info` live stats, `/game play` link, Play buttons on welcome messages, auto-announced game updates, live "Playing: N" voice channel, and the bot's status shows the player count. (`/gamesetup`)
- **Welcomer** — embed + optional DM + leave messages, with placeholders (`/welcome`).
- **Applications in DMs** — `/apply team`; answers are collected in DMs, staff accept/deny with buttons, applicant's verified Roblox profile is shown on the review card. Edit forms with `/form`.
- **Modmail** — members DM the bot; staff reply in a private thread; transcripts, ratings, snippets, claim, auto-close.
- **Automod** — spam, invites, scam/free-Robux phishing, repeated messages, links from brand-new members, mass mentions, caps, blocked words. Hits become warnings that escalate automatically (`/escalation`).
- **Raid shield, logs, warnings, bans, global bans across your servers, levels, giveaways, polls, reminders, suggestions, starboard, birthdays, temp voice** — see `/help`.

Data lives in `data/db.json` (back it up). Commands re-register only when their definitions change.

## Pilot progression & team systems
- **Rank ladder** — Cadet → Pilot Officer → … → Air Marshal. Points = XP÷10 + 5 per flight hour + 30 per flight + 40 per medal. Rank roles are created by `/setup`, and members are promoted automatically with an announcement.
- **Flight time** — time spent in voice with at least one other person (not deafened, not AFK) is logged as flight hours. No solo farming.
- **Flight schedule** — `/event create` posts an RSVP card (Attending / Maybe / Can't) with times shown in each member's own timezone. Reminders go out 1 hour and 10 minutes before, a check-in button opens when it starts, and checked-in pilots get flight time, points and medals when it ends. `/schedule` lists upcoming flights.
- **Pilot card** — `/profile` shows rank progress, hours, flights, streak, squadron, medals and linked Roblox account. `/callsign` sets a unique callsign. `/topgun` is the leaderboard.
- **Medals** — auto-awarded (First Flight, Ace, Iron Pilot, Centurion) or custom with `/pilotadmin medal-create` / `medal-award`.
- **Squadrons** — `/pilotadmin squad-create` makes a squadron with its own role; pilots `/squadron join`; squadrons are ranked by total points.
- **Daily streaks** — `/daily` for XP that grows with your streak.
- **Supply drops** — in busy chats a random XP drop appears; first click wins.
- **Daily briefing + weekly report** — game stats, upcoming flights and yesterday's activity posted every morning; Mondays add a 7-day summary and top pilots (`/pilotadmin briefing`).
- **Trust score** — `/trust` rates members 0–100 (account age, time here, Roblox-verified, rank, warnings). Trusted members are exempt from the link, caps and repeat-message automod rules.
- **Sticky roles** — roles are restored when someone leaves and rejoins.
- **Panic button** — `/panic on` (server owner only) locks every channel, pauses invites and turns on the raid shield; `/panic off` restores exactly what was changed.

## Training system
`/training create when:… [title] [cohost] [info] [minutes] [voice] [ping] [channel]` posts a training card with **host, co-host, day, time (shown in each member's own timezone), length, game link and information**. The bot fills in default info (editable with `/training setup`); the host can add their own **Host notes**. The card has three buttons — **Start training**, **Cancel**, **End training** — usable only by the host, co-host or staff.
- If you set a `voice` channel, attendance is tracked automatically; anyone who stays 5+ minutes is counted toward their rank when you press End. Hosts get +25 points (+15 for the co-host).
- Reminders go out 1 hour and 10 minutes before; a training nobody starts is auto-cancelled after 30 minutes.
- Control who can host: Server Settings → Integrations → Red Arrows → `/training`.

## Development notices
The bot no longer posts anything by itself when the game changes. Instead staff run **`/developmentnotice`** (optionally attaching a **media** photo/video, a target `channel` and a `ping` role). A form opens with:
- **Title** — shown as the bold heading
- **📋 Information** box — the main info
- **➕ Additional information** box (optional)

The notice (with the photo) lands in the private **#update-approvals** channel with **Approve & post**, **Edit** and **Reject** buttons. When someone approves (not the author, unless they have Manage Server) it is posted in **#development-notices** with the media attached. Rejections can include a reason and the author is DMed. `/setup` creates both channels; use `/gamesetup review` and `/gamesetup updates` to change them.

### Training sign-ups
Every training card has a **Sign up** button. When someone presses it they are added to the *Signed up* list on the card, and they get a private message with a **Withdraw** button (and after withdrawing, a **Sign up again** button) — so the switch is personal to them. Optional `slots:` caps the number of sign-ups (the button turns into **Full**). Everyone signed up is pinged at the 1-hour and 10-minute reminders, when the training starts, and if it is cancelled.

## Media
`/media file:<upload> [message] [channel] [ping] [spoiler]` re-posts any image, video or file as the bot (staff only). The bot downloads your upload and sends it as a real file attachment in the chosen channel, optionally with text, a role ping or a spoiler tag. It respects the server's upload limit, checks you are allowed to send files in that channel, refuses executable/script files, and logs the post to the mod log.

## Dates, times and timezones
Trainings and flights accept any date and time in any timezone — type it the way you would say it:
`25/12/2026 6:30pm` • `25 Dec 2026 18:30 EST` • `December 25th at 8pm PST` • `2026-12-25 18:30 Europe/London` • `friday 8pm` • `tomorrow 19:00 GMT+2` • `in 2h30m`.
Timezones can be abbreviations (EST, BST, CET, JST, AEST…), offsets (`GMT+2`, `UTC-5:30`), region names (`Europe/London`) or a city (`London`). Add one to the time, use the `timezone:` option (it autocompletes), or save yours once with `/timezone set` so you never type it again. `03/04/2026` is read day-first unless the numbers only make sense month-first. The confirmation shows exactly how the time was read, and every member sees it in their own local time.

### Training card layout
Trainings are posted as a sign-up card: **When** (with a live countdown), **Location to Meet**, **Trainer(s)**, **Observer(s)**, **Prerequisites**, **Places** (e.g. `3 / 4`) and who has signed up, followed by the default info and host notes. Options: `location`, `observer`, `prerequisites` (comma-separated), `slots`, `cohost`, `voice`, `ping`.
The card has **Sign Up** and **Withdraw** buttons (plus the host's Start / Cancel / End row). Discord shows one shared message to everybody, so a button cannot disappear for just one person — instead each person gets a private message that only ever shows the button that makes sense: after **Sign Up** it shows only **Withdraw**, after **Withdraw** it shows only **Sign Up**. Pressing Sign Up twice (or Withdraw when you never signed up) just tells you so. When the session is full the card's Sign Up button turns into a disabled **Full**, and re-opens if someone withdraws.

`/ping` replies with latency, uptime and the build date — use it to check the bot is online and running the file you think it is.

## Troubleshooting ("The application did not respond")
That message means Discord got **no answer from the bot within 3 seconds** — the bot is offline, an old copy is running, or it is too slow.
1. **Start the bot with `start.bat`** (double-click). It installs packages, runs the bot, keeps the window open if it stops, and restarts on a key press.
2. **Run `check.bat`.** It logs in and tells you if the token is wrong, intents are off, the bot is not in the server, permissions are missing, or `/training` is an old registered version. It saves the report to `check-result.txt`.
3. Run `/ping` in Discord. If it answers, the bot is online.
4. Everything the bot prints is also saved in `data/bot.log` (every command is logged: when it arrived, how late, how long it took, and any error).
Make sure only **one** copy of the bot runs per token, and that you restarted it after replacing `redarrows.js`.
