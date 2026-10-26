// ============================================================
// IMPORTS
// ============================================================
const { 
    Client, GatewayIntentBits, Events, REST, Routes, 
    SlashCommandBuilder, ModalBuilder, TextInputBuilder, 
    TextInputStyle, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, ActivityType, AttachmentBuilder 
} = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const WebSocket = require('ws');
const axios = require('axios');
const chalk = require('chalk');
const fs = require('node:fs');
const crypto = require('crypto');

// ============================================================
// TOKEN & CONFIG
// ============================================================
let BOT_TOKEN = process.env.DISCORD_TOKEN || process.env.Dxt; 

if (!BOT_TOKEN) {
    if (fs.existsSync('bot_token.txt')) {
        BOT_TOKEN = fs.readFileSync('bot_token.txt', 'utf8').trim();
    }
}
if (!BOT_TOKEN) {
    console.error(chalk.red('❌ Không tìm thấy token bot. Hãy đặt biến môi trường DISCORD_TOKEN!'));
    process.exit(1);
}

// ============================================================
// CONSTANTS & SHARED HELPERS
// ============================================================
const GATEWAY_URL = 'wss://gateway.discord.gg/?v=9&encoding=json';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function escapeMarkdown(text) { if (!text) return ''; return text.replace(/\*/g, '∗').replace(/_/g, '＿'); }
function truncate(str, maxLen = 1000) { if (!str) return ''; return str.length <= maxLen ? str : str.substring(0, maxLen - 3) + '...'; }
function truncateLinesSafe(str, maxLen = 1000) {
    if (!str) return ''; if (str.length <= maxLen) return str;
    const cut = str.substring(0, maxLen); const lastNewline = cut.lastIndexOf('\n');
    return lastNewline > 0 ? cut.substring(0, lastNewline) : cut;
}
async function checkUserToken(token, isBot = false) {
    try {
        const headers = { Authorization: isBot ? `Bot ${token}` : token, 'User-Agent': 'Mozilla/5.0' };
        const res = await axios.get('https://discord.com/api/v9/users/@me', { headers, timeout: 5000 });
        if (res.status === 200) return res.data.global_name || res.data.username || 'Unknown';
        return null;
    } catch { return null; }
}

// ============================================================
// SWORD FEATURE CONSTANTS & HELPERS
// ============================================================
const CUSTOM_APP_ID = "1535223041074667533"; const GAME_ROTATE_SECONDS = 3 * 60 * 60;
const USER_AGENTS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"];
const SPOTIFY_TRACKS = [
  { song: "bé bo", artist: "bé bo", album: "bé bo", track_id: "7GX5flRQZVHqQUqnSh9HJK", album_id: "l1XYcKePx7dqKAsOxDOBHw", artist_id: "1HY2Jd0NmupamShAr6KMms", duration_ms: 251667 },
  { song: "bé bo", artist: "bé bo", album: "dixia29", track_id: "0VjIjW4GlUZAMYd2vXMi3b", album_id: "4yP0hdKOZPNshxUOjY0cZj", artist_id: "1Xyo4u8uXC1ZmMpatF05PJ", duration_ms: 200040 },
  { song: "Chuyện Chúng Ta Sau Này", artist: "bé bo", album: "Chuyện Chúng Ta Sau Này", track_id: "1kHBzBLFOoGHSMCe6w0bqM", album_id: "0IFbAAoRc65CIg4DNGTpX", artist_id: "4MzJMcHQBl9SIYSjwWn8QW", duration_ms: 256000 },
];
const GAME_LIST = [{ name: "Garena Free Fire" }, { name: "PUBG: BATTLEGROUNDS" }, { name: "League of Legends" }, { name: "Valorant" }, { name: "Genshin Impact" }, { name: "Honkai: Star Rail" }];
function randomUserAgent() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }
function randomHex(length) { return crypto.randomBytes(length).toString('hex'); }
function shuffleArray(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function generateSessionId() { return randomHex(16); }
function logInfo(msg) { console.log(chalk.greenBright(`  ${msg}`)); }
function logError(msg) { console.log(chalk.redBright(`  ${msg}`)); }

function makeGameActivity(game, startTime) { return { type: 0, id: `game:${CUSTOM_APP_ID}`, name: game.name, application_id: CUSTOM_APP_ID, timestamps: { start: Math.floor(startTime * 1000) }, flags: 0 }; }
function makeSpotifyPresence(track, startMs, game = null, gameStartTime = null) {
    const endMs = startMs + track.duration_ms;
    const partyId = `spotify:${Math.floor(Math.random() * 1e17)}`;
    const spotifyActivity = { type: 2, id: 'spotify:1', name: 'Spotify', state: track.artist, details: track.song, flags: 48, session_id: generateSessionId(), sync_id: track.track_id, timestamps: { start: startMs, end: endMs }, assets: { large_image: `spotify:${track.album_id}`, large_text: track.album }, party: { id: partyId } };
    const activities = [spotifyActivity];
    if (game && gameStartTime) activities.unshift(makeGameActivity(game, gameStartTime));
    return { op: 3, d: { since: null, status: 'online', afk: false, activities: activities } };
}
async function spotifyLoop(ws, displayName) {
    let playlist = shuffleArray([...SPOTIFY_TRACKS]); let idx = 0; let gamePool = shuffleArray([...GAME_LIST]); let gameIdx = 0; let game = gamePool[gameIdx % gamePool.length]; let gameStartTime = Date.now() / 1000;
    while (true) {
        try {
            if (ws.readyState !== WebSocket.OPEN) break;
            if (Date.now() / 1000 - gameStartTime >= GAME_ROTATE_SECONDS) {
                gameIdx++; let nextGame = gamePool[gameIdx % gamePool.length];
                if (nextGame.name === game.name && gamePool.length > 1) gameIdx++;
                game = gamePool[gameIdx % gamePool.length]; gameStartTime = Date.now() / 1000; logInfo(`${displayName} > Đổi game > ${game.name}`);
            }
            const track = playlist[idx % playlist.length]; const startMs = Date.now();
            const presence = makeSpotifyPresence(track, startMs, game, gameStartTime);
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(presence));
            logInfo(`${displayName} > ${game.name} | ${track.song} — ${track.artist}`);
            await new Promise(resolve => setTimeout(resolve, track.duration_ms + 1000)); idx++;
            if (idx % playlist.length === 0) playlist = shuffleArray(playlist);
        } catch (e) { logError(`Spotify loop error: ${e.message}`); break; }
    }
}
function heartbeat(ws, intervalMs) { const timer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 1, d: null })); else clearInterval(timer); }, intervalMs); return timer; }
function runVoiceConnection(token, displayName, guildId, channelId, voiceName) {
    let ws = null; let heartbeatTimer = null; let spotifyTask = null; let sessionId = null; let seq = null; let resumeGateway = null; let isCancelled = false;
    const connect = () => {
        if (isCancelled) return;
        let gateway = resumeGateway ? `${resumeGateway}?v=9&encoding=json` : GATEWAY_URL;
        ws = new WebSocket(gateway);
        ws.on('open', () => logInfo(`${displayName} > WebSocket opened`));
        ws.on('message', async (data) => {
            try {
                const payload = JSON.parse(data); const { op, t, d, s } = payload; if (s) seq = s;
                if (op === 10) {
                    const interval = d.heartbeat_interval; if (heartbeatTimer) clearInterval(heartbeatTimer);
                    heartbeatTimer = heartbeat(ws, interval);
                    if (sessionId && resumeGateway) ws.send(JSON.stringify({ op: 6, d: { token, session_id: sessionId, seq: seq } }));
                    else ws.send(JSON.stringify({ op: 2, d: { token, properties: { os: 'Windows', browser: 'Discord Client', device: '' }, intents: 0 } }));
                } else if (t === 'READY') {
                    sessionId = d.session_id; resumeGateway = d.resume_gateway_url; logInfo(`${displayName} > ${voiceName}`);
                    ws.send(JSON.stringify({ op: 4, d: { guild_id: guildId, channel_id: channelId, self_mute: true, self_deaf: true, self_video: false, self_stream: true } }));
                    if (!spotifyTask) spotifyTask = spotifyLoop(ws, displayName);
                } else if (t === 'RESUMED') {
                    ws.send(JSON.stringify({ op: 4, d: { guild_id: guildId, channel_id: channelId, self_mute: true, self_deaf: true, self_video: false, self_stream: true } }));
                    if (!spotifyTask) spotifyTask = spotifyLoop(ws, displayName);
                } else if (t === 'VOICE_SERVER_UPDATE') {
                    setTimeout(() => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ op: 4, d: { guild_id: guildId, channel_id: channelId, self_mute: true, self_deaf: true, self_video: false, self_stream: true } }));
                            setTimeout(() => {
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 18, d: { type: 'guild', guild_id: guildId, channel_id: channelId, preferred_region: 'vietnam', quality: 0, framerate: 15, width: 854, height: 480 } }));
                            }, 1000);
                        }
                    }, 1000);
                } else if (op === 7) { ws.close(); } else if (op === 9) { if (!d) { sessionId = null; resumeGateway = null; seq = null; } setTimeout(() => ws.close(), 5000); }
            } catch (e) { logError(`${displayName} > Parse error: ${e.message}`); }
        });
        ws.on('close', () => { logError(`${displayName} > Connection closed`); if (heartbeatTimer) clearInterval(heartbeatTimer); spotifyTask = null; if (!isCancelled) setTimeout(() => connect(), 3000); });
        ws.on('error', (err) => { logError(`${displayName} > WS error: ${err.message}`); ws.close(); });
    };
    connect();
    return { cancel: () => { isCancelled = true; if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000); if (heartbeatTimer) clearInterval(heartbeatTimer); } };
}

// ============================================================
// ORB QUEST FARMER CONSTANTS & HELPERS
// ============================================================
const apiBase = "https://discord.com/api/v9"; const PROGRESS_INTERVAL = 2000; const autoAccept = true;
const CONCURRENT_QUESTS = true; const REQUEST_TIMEOUT = 30000;
const DASHBOARD_UPDATE_INTERVAL = 5000; 
const GIF_URL = "https://cdn.discordapp.com/attachments/1497462771271336051/1533829815029862450/copy_7E2D8EB1-6ED1-4764-8F31-AAE3C5FAE32A.gif";
const supportedTasks = [ "WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE" ];

async function fetchLatestBuildNumber() {
    const fallback = 504649; const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36";
        const res = await fetch("https://discord.com/app", { headers: { "User-Agent": ua }, signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return fallback;
        const text = await res.text();
        const envMatch = text.match(/GLOBAL_ENV\s*=\s*({.*?});/);
        if (envMatch) { try { const env = JSON.parse(envMatch[1]); if (env.buildNumber) return parseInt(env.buildNumber); } catch {} }
        const scripts = [...text.matchAll(/src="\/assets\/([^"]+\.js)"/g)].map(m => m[1]);
        for (const asset of scripts.slice(-10).reverse()) {
            try {
                const url = `https://discord.com/assets/${asset}`;
                const assetRes = await fetch(url, { headers: { "User-Agent": ua } });
                const body = await assetRes.text();
                const m = body.match(/buildNumber["\s:]+["\s]*(\d{5,7})/);
                if (m) return parseInt(m[1]);
            } catch {}
        }
        return fallback;
    } catch (err) { clearTimeout(timeout); return fallback; }
}
function makeSuperProperties(buildNumber) {
    const obj = { "os": "Windows", "browser": "Discord Client", "release_channel": "stable", "client_version": "1.0.9175", "os_version": "10.0.26100", "os_arch": "x64", "app_arch": "x64", "system_locale": "en-US", "browser_user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36", "browser_version": "32.2.7", "client_build_number": buildNumber, "native_build_number": 59498, "client_event_source": null };
    return Buffer.from(JSON.stringify(obj)).toString("base64");
}
class DiscordApi {
    constructor(token, buildNumber) {
        this.token = token; const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36";
        const sp = makeSuperProperties(buildNumber);
        this.headers = { "Authorization": token, "Content-Type": "application/json", "Accept": "*/*", "Accept-Language": "en-US", "User-Agent": ua, "X-Super-Properties": sp, "X-Discord-Locale": "en-US", "Origin": "https://discord.com", "Referer": "https://discord.com/channels/@me" };
    }
    async get(path) { const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT); try { return await fetch(`${apiBase}${path}`, { headers: this.headers, signal: controller.signal }); } finally { clearTimeout(timeout); } }
    async post(path, payload = null) { const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT); try { return await fetch(`${apiBase}${path}`, { method: "POST", headers: this.headers, body: payload ? JSON.stringify(payload) : null, signal: controller.signal }); } finally { clearTimeout(timeout); } }
    async validateToken() { try { const res = await this.get("/users/@me"); if (res.status === 200) { const user = await res.json(); return user; } return null; } catch { return null; } }
}
function getVal(d, ...keys) { if (!d) return null; for (const k of keys) if (k in d) return d[k]; return null; }
function getTaskConfig(quest) { const cfg = quest["config"] || {}; return getVal(cfg, "taskConfig", "task_config", "taskConfigV2", "task_config_v2"); }
function getQuestName(quest) {
    const cfg = quest["config"] || {}; const msgs = cfg["messages"] || {};
    const name = getVal(msgs, "questName", "quest_name"); if (name) return name.trim();
    const game = getVal(msgs, "gameTitle", "game_title"); if (game) return game.trim();
    const appName = cfg["application"]?.name; if (appName) return appName;
    return `Quest#${quest["id"] || "?"}`;
}
function getQuestReward(quest) {
    const cfg = quest["config"] || {}; const msgs = cfg["messages"] || {};
    const rewardName = getVal(msgs, "rewardName", "reward_name"); if (rewardName) return rewardName.trim();
    const rewardsConfig = getVal(cfg, "rewards_config", "rewardsConfig") || {};
    const rewards = rewardsConfig["rewards"] || cfg["rewards"] || [];
    const names = rewards.map(r => { const rMsgs = r["messages"] || {}; return getVal(rMsgs, "name", "name_with_article", "nameWithArticle") || getVal(r, "name", "title") || ""; }).filter(Boolean);
    return names.length ? names.join(" + ") : "Vật phẩm trong game";
}
function getExpiresAt(quest) { return getVal(quest["config"] || {}, "expiresAt", "expires_at"); }
function getUserStatus(quest) { const us = getVal(quest, "userStatus", "user_status"); return (us && typeof us === "object") ? us : {}; }
function isCompletable(quest) { const expires = getExpiresAt(quest); if (expires && new Date(expires) <= new Date()) return false; const tc = getTaskConfig(quest); if (!tc || !tc["tasks"]) return false; return supportedTasks.some(t => tc["tasks"][t] !== undefined); }
function isEnrolled(quest) { return !!getVal(getUserStatus(quest), "enrolledAt", "enrolled_at"); }
function isCompleted(quest) { return !!getVal(getUserStatus(quest), "completedAt", "completed_at"); }
function getTaskType(quest) { const tc = getTaskConfig(quest); if (!tc || !tc["tasks"]) return null; for (const t of supportedTasks) if (tc["tasks"][t] !== undefined) return t; return null; }
function getSecondsNeeded(quest) { const tc = getTaskConfig(quest); const type = getTaskType(quest); return (tc && type) ? (tc["tasks"][type]["target"] || 0) : 0; }
function getSecondsDone(quest) { const type = getTaskType(quest); if (!type) return 0; const progress = getUserStatus(quest)["progress"] || {}; return progress[type] ? (progress[type]["value"] || 0) : 0; }

class QuestAutocompleter {
    constructor(api, userId, client, sessionId, parentSessionId = null) {
        this.api = api; this.userId = userId; this.client = client; this.sessionId = sessionId; this.parentSessionId = parentSessionId || sessionId;
        this.completedQuestIds = new Set(); this.sessionCompleted = 0; this.stopRequested = false; this.quests = []; this.onUpdate = null; this._isActive = true;
    }
    isStopped() { return !this._isActive || stopFlagsSession.get(this.parentSessionId) === true || stopFlagsSession.get(this.sessionId) === true || this.stopRequested; }
    async fetchQuests() { if (this.isStopped()) return []; try { const res = await this.api.get("/quests/@me"); if (res.status === 200) { const data = await res.json(); return data?.quests || (Array.isArray(data) ? data : []); } else if (res.status === 429) { const body = await res.json(); const retryAfter = body["retry_after"] || 10; await sleep(retryAfter * 1000); return this.fetchQuests(); } return []; } catch (e) { return []; } }
    async enrollQuest(quest) { const qid = quest["id"]; const maxRetries = 3; let backoff = 3000; for (let attempt = 1; attempt <= maxRetries; attempt++) { if (this.isStopped()) return false; try { const payload = { location: 11, is_targeted: false, metadata_raw: null, metadata_sealed: null, traffic_metadata_raw: quest["traffic_metadata_raw"] || null, traffic_metadata_sealed: quest["traffic_metadata_sealed"] || null }; const res = await this.api.post(`/quests/${qid}/enroll`, payload); if ([200, 201, 204].includes(res.status)) return true; if (res.status === 429) { const body = await res.json(); const wait = (body["retry_after"] || 5) * 1000 + 1000; await sleep(wait); continue; } if (attempt === maxRetries) return false; await sleep(backoff); backoff *= 1.5; } catch (e) { if (attempt === maxRetries) return false; await sleep(backoff); backoff *= 1.5; } } return false; }
    async autoAcceptQuests(quests) { if (!autoAccept || this.isStopped()) return quests; let unaccepted = quests.filter(q => !isEnrolled(q) && !isCompleted(q) && isCompletable(q)); if (unaccepted.length === 0) return quests; const acceptedIds = new Set(); for (const q of unaccepted) { if (this.isStopped()) break; const success = await this.enrollQuest(q); if (success) acceptedIds.add(q["id"]); await sleep(2000 + Math.random() * 2000); } const updatedQuests = await this.fetchQuests(); const stillPending = updatedQuests.filter(q => acceptedIds.has(q["id"]) && !isEnrolled(q) && !isCompleted(q)); if (stillPending.length > 0) { for (const q of stillPending) { if (this.isStopped()) break; await this.enrollQuest(q); await sleep(3000); } return this.fetchQuests(); } return updatedQuests; }
    async claimReward(quest) { const qid = quest["id"]; await sleep(10000); for (let attempt = 1; attempt <= 5; attempt++) { try { const checkRes = await this.api.get(`/quests/${qid}`); if (checkRes.status === 200) { const questData = await checkRes.json(); if (!isCompleted(questData)) { await sleep(5000); continue; } } const res = await this.api.post(`/quests/${qid}/claim-reward`, {}); if (res.status === 200) return true; else if (res.status === 429) { const body = await res.json(); const retryAfter = body["retry_after"] || 5; await sleep(retryAfter * 1000); continue; } else { if ((res.status === 400 || res.status === 403) && attempt < 5) { await sleep(5000); continue; } return false; } } catch (e) { if (attempt < 5) { await sleep(5000); continue; } return false; } } return false; }
    updateQuestProgress(qid, done) { const quest = this.quests.find(q => q.id === qid); if (quest) quest.done = Math.min(quest.needed || 0, done); }
    markQuestDone(qid) { const quest = this.quests.find(q => q.id === qid); if (quest) quest.done = quest.needed || 0; }
    async completeVideo(quest) { const qid = quest["id"]; const secNeeded = Math.max(0, getSecondsNeeded(quest) || 0); let secDone = Math.min(secNeeded, getSecondsDone(quest) || 0); while (secDone < secNeeded) { if (this.isStopped()) return; try { const res = await this.api.post(`/quests/${qid}/video-progress`, { "timestamp": secDone + (PROGRESS_INTERVAL/1000) + Math.random() * 0.5 }); if (res.status === 200) { const body = await res.json(); const prog = body["progress"] || {}; const taskType = getTaskType(quest); if (prog[taskType] && typeof prog[taskType]["value"] === "number") secDone = Math.min(secNeeded, prog[taskType]["value"]); this.updateQuestProgress(qid, secDone); if (body["completed_at"] || secDone >= secNeeded) { await this.claimReward(quest); this.sessionCompleted++; this.markQuestDone(qid); if (this.onUpdate) this.onUpdate(); return; } } else if (res.status === 429) { const body = await res.json(); const wait = (body["retry_after"] || 5) * 1000 + 1000; await sleep(wait); continue; } else { const checkRes = await this.api.get(`/quests/${qid}`); if (checkRes.status === 200) { const questData = await checkRes.json(); if (isCompleted(questData)) { await this.claimReward(quest); this.sessionCompleted++; this.markQuestDone(qid); if (this.onUpdate) this.onUpdate(); return; } } await sleep(5000); continue; } } catch (e) { await sleep(5000); } await sleep(PROGRESS_INTERVAL); if (this.onUpdate) this.onUpdate(); } try { await this.api.post(`/quests/${qid}/video-progress`, { "timestamp": secNeeded }); } catch {} await this.claimReward(quest); this.sessionCompleted++; this.markQuestDone(qid); if (this.onUpdate) this.onUpdate(); }
    async completeHeartbeat(quest) { const qid = quest["id"]; const taskType = getTaskType(quest); const secNeeded = Math.max(0, getSecondsNeeded(quest) || 0); let secDone = Math.min(secNeeded, getSecondsDone(quest) || 0); const pid = Math.floor(Math.random() * 29000) + 1000; const streamKey = taskType.includes("STREAM") ? `call:0:${pid}` : "call:0:1"; while (secDone < secNeeded) { if (this.isStopped()) return; try { const res = await this.api.post(`/quests/${qid}/heartbeat`, { "stream_key": streamKey, "terminal": false }); if (res.status === 200) { const body = await res.json(); const prog = body["progress"] || {}; if (prog[taskType]) secDone = Math.min(secNeeded, prog[taskType]["value"] || 0); this.updateQuestProgress(qid, secDone); if (body["completed_at"] || secDone >= secNeeded) { await this.claimReward(quest); this.sessionCompleted++; this.markQuestDone(qid); if (this.onUpdate) this.onUpdate(); return; } } else if (res.status === 429) { const body = await res.json(); const wait = (body["retry_after"] || 10) * 1000 + 1000; await sleep(wait); continue; } else { const checkRes = await this.api.get(`/quests/${qid}`); if (checkRes.status === 200) { const questData = await checkRes.json(); if (isCompleted(questData)) { await this.claimReward(quest); this.sessionCompleted++; this.markQuestDone(qid); if (this.onUpdate) this.onUpdate(); return; } } await sleep(10000); continue; } } catch (e) { await sleep(10000); } await sleep(PROGRESS_INTERVAL); if (this.onUpdate) this.onUpdate(); } try { await this.api.post(`/quests/${qid}/heartbeat`, { "stream_key": streamKey, "terminal": true }); } catch {} await this.claimReward(quest); this.sessionCompleted++; this.markQuestDone(qid); if (this.onUpdate) this.onUpdate(); }
    async processQuest(quest) { const qid = quest["id"]; const taskType = getTaskType(quest); if (!taskType || this.completedQuestIds.has(qid) || this.isStopped()) return; if (["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE"].includes(taskType)) await this.completeVideo(quest); else await this.completeHeartbeat(quest); this.completedQuestIds.add(qid); }
    async processAllQuests() { if (this.isStopped()) return; let quests = await this.fetchQuests(); if (quests.length === 0) { this.quests = []; if (this.onUpdate) this.onUpdate(); this._isActive = false; return; } quests = await this.autoAcceptQuests(quests); const actionable = quests.filter(q => isEnrolled(q) && !isCompleted(q) && isCompletable(q) && !this.completedQuestIds.has(q["id"])); if (actionable.length === 0) { this.quests = []; if (this.onUpdate) this.onUpdate(); this._isActive = false; return; } this.quests = actionable.map(q => ({ id: q["id"], name: escapeMarkdown(getQuestName(q)), reward: escapeMarkdown(getQuestReward(q)), type: getTaskType(q), needed: getSecondsNeeded(q) || 0, done: getSecondsDone(q) || 0, status: 'running' })); if (this.onUpdate) this.onUpdate(); if (CONCURRENT_QUESTS) await Promise.all(actionable.map(q => this.processQuest(q))); else for (const q of actionable) { if (this.isStopped()) break; await this.processQuest(q); await sleep(2000); } this._isActive = false; if (this.onUpdate) this.onUpdate(); }
}

// ============================================================
// SPAM FEATURE VARIABLES & HELPERS (ĐÃ SỬA ĐỂ CHỈ DỪNG ĐÚNG TOKEN CỦA MÌNH, TAG NHIỀU ID)
// ============================================================
const spamSessions = new Map(); // Map<sessionId, sessionData> (sessionData chứa userId)

const SPAM_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function buildSpamHeaders(token, channelId = null) {
  const ua = SPAM_USER_AGENTS[Math.floor(Math.random() * SPAM_USER_AGENTS.length)];
  const locale = Math.random() < 0.5 ? "en-US" : "en-GB";
  const isMac = ua.includes("Macintosh");
  const osName = isMac ? "Mac OS X" : "Windows";
  const osVersion = isMac ? "10.15.7" : "10";
  const browserVersion = ua.match(/Chrome\/([\d.]+)/)[1];
  const dev = {
    os: osName, browser: "Chrome", device: "",
    system_locale: locale, browser_user_agent: ua,
    browser_version: browserVersion, os_version: osVersion,
    referrer: "https://discord.com/", referring_domain: "discord.com",
    release_channel: "stable",
    client_build_number: Math.floor(Math.random() * (300000 - 290000 + 1)) + 290000,
    client_event_source: null,
  };
  const superProps = Buffer.from(JSON.stringify(dev)).toString('base64');
  return {
    "Accept": "*/*",
    "Accept-Language": `${locale},${locale.split('-')[0]};q=0.9`,
    "Authorization": token,
    "Content-Type": "application/json",
    "User-Agent": ua,
    "X-Super-Properties": superProps,
    "Origin": "https://discord.com",
    "Referer": channelId ? `https://discord.com/channels/@me/${channelId}` : "https://discord.com/channels/@me",
    "X-Discord-Locale": locale,
  };
}

async function checkSpamToken(token) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      method: 'GET', headers: buildSpamHeaders(token), signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.status === 200) {
      const data = await response.json();
      const display = data.global_name || data.username || 'Unknown';
      return { ok: true, display, data };
    } else if (response.status === 401) return { ok: false, display: "Token không hợp lệ", data: {} };
    else if (response.status === 403) return { ok: false, display: "Token bị cấm", data: {} };
    else if (response.status === 429) {
      const data = await response.json();
      return { ok: false, display: `Rate limit (${data.retry_after || 5}s)`, data: {} };
    } else return { ok: false, display: `Lỗi ${response.status}`, data: {} };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, display: "Timeout", data: {} };
    return { ok: false, display: `Lỗi: ${e.message.slice(0, 20)}`, data: {} };
  }
}

async function getSpamTokenName(token) {
  const res = await checkSpamToken(token);
  return res.ok ? res.display : "ErrorToken";
}

async function getSpamChannelName(token, channelId) {
  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
      headers: buildSpamHeaders(token, channelId),
    });
    if (response.status === 200) {
      const data = await response.json();
      if (data.name) return data.name;
      if (data.recipients && data.recipients.length > 0) return data.recipients[0].username || `Channel-${channelId}`;
      return `Channel-${channelId}`;
    }
  } catch (e) {}
  return `Channel-${channelId}`;
}

async function sendSpamTyping(token, channelId) {
  try {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/typing`, {
      method: 'POST', headers: buildSpamHeaders(token, channelId),
    });
  } catch (e) {}
}

function addInvisible(content) {
  if (Math.floor(Math.random() * 3) === 0) {
    const invisibleChars = ['\u200B', '\u200C', '\u200D', '\u2060', '\u180E', '\uFEFF'];
    return content + invisibleChars[Math.floor(Math.random() * invisibleChars.length)];
  }
  return content;
}

// Hàm Spam Loop: ĐÃ SỬA TAG NHIỀU ID CÙNG LÚC
async function spamLoop(token, channelId, messages, tags, delayMin, delayMax, stopFlag, msgIndex) {
  const tokenDisplay = await getSpamTokenName(token);
  const channelName = await getSpamChannelName(token, channelId);
  let sendCount = 0;
  const totalMsgs = messages.length;

  while (!stopFlag.stop) {
    await sendSpamTyping(token, channelId);

    let idx = msgIndex.value;
    msgIndex.value = (msgIndex.value + 1) % totalMsgs;

    let message = messages[idx];

    // Gộp tất cả các tag lại với nhau (hỗ trợ tag 2 người trở lên)
    if (tags && tags.length > 0) {
      message = `# ${tags.join(' ')} ${message}`;
    }

    message = addInvisible(message);

    const DISCORD_EPOCH = 1420070400000;
    const nonce = String(((Date.now() - DISCORD_EPOCH) << 22) + Math.floor(Math.random() * 0x3FFFFF));
    const body = JSON.stringify({ content: message, nonce: nonce, tts: false });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST', headers: buildSpamHeaders(token, channelId), body: body, signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.status === 200) {
        sendCount++;
        console.log(chalk.green(`[${tokenDisplay}] Đã gửi #${sendCount} -> ${channelName}`));
        const delay = delayMin + Math.random() * (delayMax - delayMin);
        await new Promise(r => setTimeout(r, delay * 1000));
      } else if (response.status === 429) {
        const data = await response.json();
        const retry = data.retry_after || delayMin;
        await new Promise(r => setTimeout(r, retry * 1000));
      } else if (response.status === 401) {
        console.log(chalk.red(`[${tokenDisplay}] Token không hợp lệ, dừng spam.`));
        stopFlag.stop = true;
      } else if (response.status === 403) {
        console.log(chalk.yellow(`[${tokenDisplay}] Không có quyền, thử lại sau 5s.`));
        await new Promise(r => setTimeout(r, 5000));
      } else if (response.status === 404) {
        console.log(chalk.red(`[${tokenDisplay}] Kênh không tồn tại, dừng spam.`));
        stopFlag.stop = true;
      } else {
        console.log(chalk.yellow(`[${tokenDisplay}] Lỗi ${response.status}, thử lại sau 5s.`));
        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (e) {
      console.log(chalk.red(`[${tokenDisplay}] Lỗi: ${e.message.slice(0, 30)}`));
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// Hàm StartSpam: ĐÃ SỬA LƯU SESSION THEO USERID ĐỂ CHỈ MÌNH DỪNG ĐƯỢC
async function startSpam(userId, guildId, channelId, messages, userTokens, delayMin, delayMax, tags = []) {
  const msgIndex = { value: 0 };

  const validTokens = [];
  for (const token of userTokens) {
    const check = await checkSpamToken(token);
    if (check.ok) {
      if (guildId) {
        try {
          const guildRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
            headers: buildSpamHeaders(token),
          });
          if (guildRes.status === 200) {
            const guilds = await guildRes.json();
            const inGuild = guilds.find(g => g.id === guildId);
            if (!inGuild) {
              console.log(chalk.red(`Token ${token.slice(0,10)}... không có trong server!`));
              continue;
            }
          } else {
            console.log(chalk.yellow(`Không kiểm tra được server cho token ${token.slice(0,10)}...`));
          }
        } catch (e) {
          console.log(chalk.yellow(`Lỗi kiểm tra server: ${e.message}`));
        }
      }
      validTokens.push(token);
    } else {
      console.log(chalk.red(`Token không hợp lệ: ${token.slice(0,10)}... (${check.display})`));
    }
  }

  if (validTokens.length === 0) {
    return { success: false, message: 'Không có token user nào hợp lệ!' };
  }

  const channelCheck = await getSpamChannelName(validTokens[0], channelId);
  if (channelCheck.startsWith('Channel-') || channelCheck.includes('Error')) {
    const channelRes = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
      headers: buildSpamHeaders(validTokens[0], channelId),
    });
    if (channelRes.status !== 200) {
      return { success: false, message: 'Kênh không tồn tại hoặc token không có quyền xem!' };
    }
  }

  const stopFlag = { stop: false };
  // Tạo session ID riêng và lưu userId vào session để chỉ người đó dừng được
  const sessionId = `${userId}_${channelId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  spamSessions.set(sessionId, { userId, channelId, stopFlag, tokens: validTokens });

  for (const token of validTokens) {
    spamLoop(token, channelId, messages, tags, delayMin, delayMax, stopFlag, msgIndex).catch(err => console.error(err));
  }

  console.log(chalk.cyan(`Bắt đầu spam vào kênh ${channelId} với ${validTokens.length} token. (User: ${userId})`));
  return { success: true, message: `Spam đang chạy với ${validTokens.length} token user.` };
}

// Dừng đúng phiên của user trong kênh
function stopSpam(userId, channelId) {
  let stopped = false;
  for (const [sessionId, session] of spamSessions.entries()) {
    if (session.userId === userId && (!channelId || session.channelId === channelId)) {
      session.stopFlag.stop = true;
      spamSessions.delete(sessionId);
      stopped = true;
    }
  }
  return stopped;
}

// Dừng tất cả phiên của user
function stopAllSpam(userId) {
  let count = 0;
  for (const [sessionId, session] of spamSessions.entries()) {
    if (session.userId === userId) {
      session.stopFlag.stop = true;
      spamSessions.delete(sessionId);
      count++;
    }
  }
  return count;
}

// ============================================================
// CLIENT DISCORD
// ============================================================
const client = new Client({ intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent ] });
const stopFlags = new Map(); const stopFlagsSession = new Map(); const hypeHouseMap = new Map(); const sessions = new Map();
const userConnections = new Map(); const userHistory = new Map(); const activeHistoryMessages = new Map(); const userGroupMessages = new Map();
const pendingNhayData = new Map(); // Lưu dữ liệu tạm cho modal /nhay
let botVoiceConnection = null;

// ============================================================
// AFK VOICE HELPER FUNCTIONS
// ============================================================
function createUserConnection(token, name, guildId, channelId, userId) {
    const connId = `${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    let ws = null, heartbeatInterval = null, sessionId = null, sequence = null, resumeGatewayUrl = null, reconnectTimeout = null, isCancelled = false;
    const connect = () => {
        if (isCancelled) return;
        const gateway = resumeGatewayUrl ? `${resumeGatewayUrl}?v=9&encoding=json` : GATEWAY_URL;
        ws = new WebSocket(gateway);
        ws.on('open', () => console.log(chalk.cyan(`🔌 WebSocket mở cho ${name}`)));
        ws.on('message', (data) => {
            try {
                const payload = JSON.parse(data); const { op, t, s, d } = payload; if (s) sequence = s;
                if (op === 10) {
                    const hb = d.heartbeat_interval;
                    if (heartbeatInterval) clearInterval(heartbeatInterval);
                    heartbeatInterval = setInterval(() => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 1, d: null })); }, hb);
                    if (sessionId && resumeGatewayUrl) ws.send(JSON.stringify({ op: 6, d: { token, session_id: sessionId, seq: sequence } }));
                    else ws.send(JSON.stringify({ op: 2, d: { token, properties: { os: 'Windows', browser: 'Discord Client', device: '' }, intents: 0 } }));
                }
                if (t === 'READY' || t === 'RESUMED') { sessionId = d.session_id; resumeGatewayUrl = d.resume_gateway_url; if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 4, d: { guild_id: guildId, channel_id: channelId, self_mute: true, self_deaf: true, self_video: false, self_stream: false } })); }
                if (op === 7 || op === 9) ws.close();
            } catch (err) {}
        });
        ws.on('close', (code) => { console.log(chalk.yellow(`⚠️ WebSocket đóng cho ${name} (code ${code})`)); if (heartbeatInterval) clearInterval(heartbeatInterval); heartbeatInterval = null; if (!isCancelled && code !== 1000) reconnectTimeout = setTimeout(connect, 3000); });
        ws.on('error', (err) => console.error(chalk.red(`❌ Lỗi WebSocket cho ${name}: ${err.message}`)));
    };
    connect();
    return { id: connId, cancel: () => { isCancelled = true; if (reconnectTimeout) clearTimeout(reconnectTimeout); if (heartbeatInterval) clearInterval(heartbeatInterval); if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000); }, token, name, guildId, channelId, userId, message: null, type: 'afk' };
}
async function sendTokenEmbed(interaction, conn, isActive = true) {
    const embed = new EmbedBuilder().setTitle(`Token: ${escapeMarkdown(conn.name)}`).setDescription(`Phòng: <#${conn.channelId}> (Guild: ${conn.guildId})`).setColor(isActive ? 0x00FF00 : 0xED4245).addFields({ name: 'Trạng thái', value: isActive ? '🟢 Đang treo' : '🔴 Đã dừng', inline: true }, { name: 'Token', value: `\`${conn.token.substring(0, 20)}...\``, inline: true }).setFooter({ text: `ID: ${conn.id}` });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`stop_token_${conn.id}`).setLabel(`🛑 Dừng ${conn.name}`).setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('history_view').setLabel('📜 Lịch sử').setStyle(ButtonStyle.Secondary));
    if (!isActive) row.components[0].setDisabled(true);
    return await interaction.followUp({ embeds: [embed], components: isActive ? [row] : [] });
}
function generateGroupedEmbed(conns) {
    let desc = ''; const rows = []; let currentRow = new ActionRowBuilder(); let count = 0;
    conns.forEach((conn, index) => { desc += `**${index + 1}.** ${escapeMarkdown(conn.name)} - <#${conn.channelId}> 🟢 Đang treo\n`; const btn = new ButtonBuilder().setCustomId(`stop_token_${conn.id}`).setLabel(`🛑 Dừng ${conn.name}`).setStyle(ButtonStyle.Danger); currentRow.addComponents(btn); count++; if (count === 5) { rows.push(currentRow); currentRow = new ActionRowBuilder(); count = 0; } });
    if (count > 0 && count < 5) { currentRow.addComponents(new ButtonBuilder().setCustomId('history_view').setLabel('📜 Lịch sử').setStyle(ButtonStyle.Secondary)); rows.push(currentRow); } else { if (count === 5) rows.push(currentRow); const historyRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('history_view').setLabel('📜 Lịch sử').setStyle(ButtonStyle.Secondary)); rows.push(historyRow); }
    const embed = new EmbedBuilder().setTitle(`🚀 Đã thêm ${conns.length} tokens thành công!`).setDescription(desc || 'Không có token nào.').setColor(0x00FF00);
    return { embed, rows };
}
function buildHistoryComponents(filteredHistory) { if (filteredHistory.length === 0) return []; const rows = []; if (filteredHistory.length >= 2) { const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('stop_all_tokens').setLabel(`🛑 Dừng tất cả (${filteredHistory.length} token)`).setStyle(ButtonStyle.Danger)); rows.push(row); return rows; } else { const item = filteredHistory[0]; const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`stop_token_${item.id}`).setLabel(`🛑 Dừng ${item.name}`).setStyle(ButtonStyle.Danger)); rows.push(row); return rows; } }
async function renderHistoryMessage(userId, interaction) {
    const history = userHistory.get(userId) || []; const filteredHistory = history.filter(h => h.isActive === true);
    if (filteredHistory.length === 0) { const msg = await interaction.editReply({ content: '📭 Bạn không có token nào đang treo.' }); activeHistoryMessages.set(userId, msg); return; }
    let desc = ''; const reversed = [...filteredHistory].reverse().slice(0, 20); let index = 1; for (const item of reversed) { desc += `**${index}.** ${escapeMarkdown(item.name)} - <#${item.channelId}> 🟢 Đang treo\n`; index++; } if (filteredHistory.length > 20) desc += `\n... và ${filteredHistory.length - 20} token nữa.`; const embed = new EmbedBuilder().setTitle('📜 Lịch sử Treo Token').setDescription(desc).setColor(0x5865F2).setFooter({ text: `Có ${filteredHistory.length} token đang treo` }); const components = buildHistoryComponents(filteredHistory); const msg = await interaction.editReply({ embeds: [embed], components: components }); activeHistoryMessages.set(userId, msg);
}

// ============================================================
// BOT COMMANDS REGISTRY
// ============================================================
const commands = [
    new SlashCommandBuilder().setName('afk').setDescription('Hiển thị bảng điều khiển treo voice'),
    new SlashCommandBuilder().setName('getorb').setDescription('Menu farm nhiệm vụ Orb Quest'),
    new SlashCommandBuilder().setName('tokeninfo').setDescription('Xem thông tin tài khoản từ token'),
    new SlashCommandBuilder().setName('status').setDescription('Xem trạng thái quest của token'),
    new SlashCommandBuilder().setName('hyper').setDescription('Lên HypeSquad - chọn 1 trong 3 house'),
    new SlashCommandBuilder().setName('sword').setDescription('Treo voice với Spotify + Game (dùng user token)'),
    new SlashCommandBuilder().setName('help').setDescription('Hướng dẫn sử dụng bot'),
    new SlashCommandBuilder().setName('imagelink').setDescription('Đăng tin rao bán acc kèm hình ảnh')
        .addStringOption(option => option.setName('link').setDescription('Link hình ảnh của acc (URL ảnh)').setRequired(true))
        .addStringOption(option => option.setName('noi_dung').setDescription('Lời nhắn bạn muốn gửi kèm (VD: Bán acc giá rẻ...)').setRequired(true))
        .addStringOption(option => option.setName('id_kênh').setDescription('ID của kênh muốn đăng tin').setRequired(true)),
    // ----- LỆNH SPAM DÙNG MODAL -----
    new SlashCommandBuilder().setName('spam').setDescription('Bắt đầu spam bằng user token (dùng modal)'),
    // ----- LỆNH NHAY: NHẬP CẤU HÌNH NGOÀI, NỘI DUNG TRONG MODAL -----
    new SlashCommandBuilder().setName('nhay').setDescription('Bắt đầu spam nhiều tin nhắn + tag (nhập cấu hình ngoài, nội dung trong modal)')
        .addStringOption(option => option.setName('tokens').setDescription('Danh sách token (mỗi dòng hoặc cách nhau bằng dấu phẩy)').setRequired(true))
        .addStringOption(option => option.setName('channel_id').setDescription('ID kênh cần spam').setRequired(true))
        .addNumberOption(option => option.setName('delay_min').setDescription('Delay tối thiểu (giây)').setMinValue(1).setRequired(true))
        .addNumberOption(option => option.setName('delay_max').setDescription('Delay tối đa (giây)').setMinValue(1).setRequired(true))
        .addStringOption(option => option.setName('tags').setDescription('ID người dùng cần tag (mỗi dòng hoặc cách nhau bằng dấu phẩy)').setRequired(false)),
    // ----- LỆNH STOP -----
    new SlashCommandBuilder().setName('stop').setDescription('Dừng spam của bạn (có thể truyền channel_id để dừng kênh cụ thể, bỏ trống để dừng tất cả)')
        .addStringOption(option => option.setName('channel_id').setDescription('ID kênh cần dừng').setRequired(false)),
    new SlashCommandBuilder().setName('dung').setDescription('Dừng spam của bạn (alias của /stop)')
        .addStringOption(option => option.setName('channel_id').setDescription('ID kênh cần dừng').setRequired(false)),
];

// ============================================================
// CLIENT READY EVENT
// ============================================================
client.once(Events.ClientReady, async () => {
    console.log(chalk.green(`✅ Bot logged in as: ${client.user.tag}`));
    // Đã sửa: Bỏ kí tự thánh giá, chuyển status sang idle (mặt trăng)
    client.user.setPresence({ activities: [{ name: 'owner : <@1331884673718288413>', type: ActivityType.Playing }], status: 'idle' });
    try {
        const appRes = await fetch('https://discord.com/api/v9/applications/@me', { method: 'PATCH', headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ description: 'owner : <@1331884673718288413>' }) });
        if (appRes.ok) console.log('✅ Đã cập nhật tiểu sử bot.');
    } catch (e) { console.error('❌ Lỗi cập nhật tiểu sử:', e.message); }
    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try { await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); console.log('Slash commands registered.'); } catch (error) { console.error('Error registering commands:', error); }
});

// ============================================================
// INTERACTION HANDLER
// ============================================================
client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const cmd = interaction.commandName;
            
            if (cmd === 'help') {
                const embed = new EmbedBuilder()
                    .setTitle('Hướng dẫn sử dụng bot')
                    .setColor(0x5865F2)
                    .setDescription(
                        '<a:yh3_muiten:1535302764823842907> **`/afk`** – Bảng điều khiển treo voice\n' +
                        '<a:yh3_muiten:1535302764823842907> **`/getorb`** – Farm nhiệm vụ Orb Quest\n' +
                        '<a:yh3_muiten:1535302764823842907> **`/tokeninfo`** – Xem thông tin tài khoản từ token\n' +
                        '<a:yh3_muiten:1535302764823842907> **`/status`** – Xem trạng thái quest của token\n' +
                        '<a:yh3_muiten:1535302764823842907> **`/hyper`** – Lên HypeSquad\n' +
                        '<a:yh3_muiten:1535302764823842907> **`/sword`** – Treo voice + Spotify + Game tự động đổi (dùng user token)\n' +
                        '<a:yh3_muiten:1535302764823842907> **`/imagelink`** – Đăng tin bán acc kèm ảnh\n' +
                        '<a:yh3_muiten:1535302764823842907> **`/spam`** – Spam bằng user token (dùng modal)\n' +
                        '<a:yh3_muiten:1535302764823842907> **`/nhay`** – Nhập cấu hình ngoài, nội dung trong modal\n' +
                        '<a:yh3_muiten:1535302764823842907> **`/stop`** – Dừng spam của bạn (theo kênh hoặc tất cả)\n' +
                        '<a:yh3_muiten:1535302764823842907> **`/dung`** – Dừng spam của bạn (alias của `/stop`)\n' +
                        '<a:yh3_muiten:1535302764823842907> **`/help`** – Hiển thị hướng dẫn này\n\n' +
                        'Token được nhập qua Modal – không bao giờ hiển thị ra kênh chat.'
                    );
                const replyMessage = await interaction.reply({ embeds: [embed] });
                setTimeout(() => replyMessage.delete().catch(() => {}), 180000);
                return;
            }

            if (cmd === 'imagelink') {
                const imageUrl = interaction.options.getString('link');
                const messageContent = interaction.options.getString('noi_dung');
                const channelId = interaction.options.getString('id_kênh');
                const targetChannel = interaction.guild.channels.cache.get(channelId);
                
                if (!targetChannel) return interaction.reply({ content: `❌ Không tìm thấy kênh ID: ${channelId}.`, ephemeral: true });
                if (!targetChannel.permissionsFor(client.user).has('SendMessages')) return interaction.reply({ content: `❌ Bot không có quyền gửi tin nhắn vào kênh <#${channelId}>.`, ephemeral: true });

                const canMention = targetChannel.permissionsFor(client.user).has('MentionEveryone');
                if ((messageContent.includes('@everyone') || messageContent.includes('@here')) && !canMention) {
                    return interaction.reply({ content: `❌ Bot không có quyền **Mention @everyone** tại kênh <#${channelId}>. Vui lòng bật quyền này trong Server Settings > Roles > Tên Bot.`, ephemeral: true });
                }

                try {
                    await interaction.deferReply({ ephemeral: true });
                    const attachment = new AttachmentBuilder(imageUrl);
                    await targetChannel.send({ 
                        content: messageContent, 
                        files: [attachment],
                        allowedMentions: { parse: ['everyone', 'roles'] } 
                    });
                    await interaction.editReply({ content: `✅ Đã đăng tin thành công tại <#${channelId}>!` });
                } catch (error) {
                    try { 
                        await targetChannel.send({ 
                            content: `${messageContent}\n${imageUrl}`,
                            allowedMentions: { parse: ['everyone', 'roles'] } 
                        }); 
                        await interaction.editReply({ content: `✅ Đã gửi tin (Ảnh dạng link do lỗi tải).` }); 
                    } catch (e) { 
                        await interaction.editReply({ content: `❌ Lỗi gửi tin: ${e.message}` }); 
                    }
                }
                return;
            }

            if (cmd === 'spam') {
                const modal = new ModalBuilder()
                    .setCustomId('spamModal')
                    .setTitle('Spam một tin nhắn');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tokens').setLabel('Tokens (mỗi dòng một token)').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('delay_min').setLabel('Delay min (giây)').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('delay_max').setLabel('Delay max (giây)').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('message').setLabel('Nội dung tin nhắn').setStyle(TextInputStyle.Paragraph).setRequired(true))
                );
                await interaction.showModal(modal);
                return;
            }

            if (cmd === 'nhay') {
                const tokenRaw = interaction.options.getString('tokens');
                const channelId = interaction.options.getString('channel_id');
                const delayMin = interaction.options.getNumber('delay_min');
                const delayMax = interaction.options.getNumber('delay_max');
                const tagsRaw = interaction.options.getString('tags') || '';

                if (isNaN(delayMin) || isNaN(delayMax) || delayMin <= 0 || delayMax < delayMin) {
                    return interaction.reply({ content: '⚠️ Delay không hợp lệ (min phải > 0 và max >= min).', ephemeral: true });
                }
                if (!/^\d+$/.test(channelId)) {
                    return interaction.reply({ content: 'Channel ID không hợp lệ!', ephemeral: true });
                }

                const tokens = tokenRaw.split(/[\n,]+/).map(t => t.trim()).filter(t => t.length > 0);
                if (tokens.length === 0) {
                    return interaction.reply({ content: '❌ Bạn chưa nhập token nào!', ephemeral: true });
                }

                const tags = tagsRaw.split(/[\n,]+/).map(t => t.trim()).filter(t => t.length > 0).map(id => `<@${id}>`);

                pendingNhayData.set(interaction.user.id, {
                    tokens: tokens, channelId: channelId, delayMin: delayMin, delayMax: delayMax, tags: tags, guildId: interaction.guild?.id || null
                });

                const modal = new ModalBuilder()
                    .setCustomId('nhayModal')
                    .setTitle('Nhập nội dung spam');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('messages').setLabel('Nội dung (mỗi dòng một tin)').setStyle(TextInputStyle.Paragraph).setRequired(true))
                );
                await interaction.showModal(modal);
                return;
            }

            if (cmd === 'stop' || cmd === 'dung') {
                const channelIdInput = interaction.options.getString('channel_id');
                const userId = interaction.user.id;
                if (channelIdInput && channelIdInput.trim()) {
                    const stopped = stopSpam(userId, channelIdInput.trim());
                    await interaction.reply({ content: stopped ? `⏹ Đã dừng phiên spam của bạn ở kênh ${channelIdInput}` : 'Bạn không có phiên spam nào cho kênh này.', ephemeral: true });
                } else {
                    const count = stopAllSpam(userId);
                    await interaction.reply({ content: count > 0 ? `⏹ Đã dừng tất cả ${count} phiên spam của bạn.` : 'Hiện bạn không có phiên spam nào đang chạy.', ephemeral: true });
                }
                return;
            }

            if (cmd === 'afk') {
                const embed = new EmbedBuilder().setTitle('⚡ BẢNG ĐIỀU KHIỂN CÁ NHÂN ⚡').setDescription('*(Dành cho tất cả mọi người)*').setColor(0x5865F2).addFields({ name: '🔑 Quản Lý Treo Voice:', value: '• **🤖 Treo Bằng Bot**: Treo bot chính vào voice.\n• **🛑 Dừng Treo Bot**: Dừng bot chính.\n• **➕ Add Tokens User**: Thêm token user để treo nhiều acc.\n• **🤖 Thêm Bot Token**: Thêm token bot khác để treo.\n• **📜 Lịch sử Treo Token**: Xem lại lịch sử và dừng token.\n• **🛑 Dừng Tokens Của Tôi**: Dừng các token bạn đã thêm.', inline: false });
                const row1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('treo_bot').setLabel('🤖 Treo Bằng Bot').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('stop_bot').setLabel('🛑 Dừng Treo Bot').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('add_user_tokens').setLabel('➕ Add Tokens User').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('add_bot_token').setLabel('🤖 Thêm Bot Token').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('history_view').setLabel('📜 Lịch sử Treo Token').setStyle(ButtonStyle.Secondary));
                const row2 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('stop_my_tokens').setLabel('🛑 Dừng Tokens Của Tôi').setStyle(ButtonStyle.Secondary));
                await interaction.reply({ embeds: [embed], components: [row1, row2] });
                return;
            }
            if (cmd === 'getorb') {
                const modal = new ModalBuilder().setCustomId('getorbModal').setTitle('Nhập Token Discord');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tokenInput').setLabel('Token (chỉ 1 dòng)').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(120)));
                await interaction.showModal(modal); return;
            }
            if (cmd === 'tokeninfo') {
                const modal = new ModalBuilder().setCustomId('tokeninfoModal').setTitle('Kiểm tra Token');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tokenInput').setLabel('Token').setStyle(TextInputStyle.Short).setRequired(true)));
                await interaction.showModal(modal); return;
            }
            if (cmd === 'status') {
                const modal = new ModalBuilder().setCustomId('statusModal').setTitle('Xem Quest của Token');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tokenInput').setLabel('Token').setStyle(TextInputStyle.Short).setRequired(true)));
                await interaction.showModal(modal); return;
            }
            if (cmd === 'hyper') {
                const embed = new EmbedBuilder().setTitle('Chọn Huy Hiệu HypeSquad').setDescription('Nhấn nút và dán User Token của bạn để đổi huy hiệu').setColor(0x5865F2);
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('hype_1').setEmoji({ id: '1498562775931293789' }).setLabel('Bravery').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('hype_2').setEmoji({ id: '1498562891916378252' }).setLabel('Brilliance').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('hype_3').setEmoji({ id: '1511360925771239544' }).setLabel('Balance').setStyle(ButtonStyle.Success));
                await interaction.reply({ embeds: [embed], components: [row] }); return;
            }
            if (cmd === 'sword') {
                const modal = new ModalBuilder().setCustomId('sword_modal').setTitle('Nhập thông tin treo voice + Spotify');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('token').setLabel('User Token').setStyle(TextInputStyle.Paragraph).setRequired(true)));
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_id').setLabel('Guild ID').setStyle(TextInputStyle.Short).setRequired(true)));
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID (Voice)').setStyle(TextInputStyle.Short).setRequired(true)));
                await interaction.showModal(modal); return;
            }
        }

        if (interaction.isButton()) {
            const { customId, user } = interaction;

            if (customId === 'treo_bot') {
                const modal = new ModalBuilder().setCustomId('treo_bot_modal').setTitle('Treo Room Bằng Bot');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_id').setLabel('Guild ID').setStyle(TextInputStyle.Short).setRequired(true)));
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)));
                await interaction.showModal(modal); return;
            }
            if (customId === 'stop_bot') {
                if (botVoiceConnection) { botVoiceConnection.destroy(); botVoiceConnection = null; await interaction.reply({ content: '🛑 Đã dừng Bot chính!' }); }
                else { await interaction.reply({ content: '⚠️ Bot không treo room nào.' }); }
                return;
            }
            if (customId === 'add_user_tokens') {
                const modal = new ModalBuilder().setCustomId('add_tokens_modal').setTitle('Add Tokens User Treo Room');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tokens').setLabel('Danh sách Tokens User (mỗi token 1 dòng)').setStyle(TextInputStyle.Paragraph).setRequired(true)));
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_id').setLabel('Guild ID').setStyle(TextInputStyle.Short).setRequired(true)));
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)));
                await interaction.showModal(modal); return;
            }
            if (customId === 'add_bot_token') {
                const modal = new ModalBuilder().setCustomId('add_bot_modal').setTitle('Thêm Bot Token Treo Room');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bot_token').setLabel('Token Bot').setStyle(TextInputStyle.Paragraph).setRequired(true)));
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_id').setLabel('Guild ID').setStyle(TextInputStyle.Short).setRequired(true)));
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)));
                await interaction.showModal(modal); return;
            }
            if (customId === 'history_view') { await interaction.deferReply(); const userId = user.id; await renderHistoryMessage(userId, interaction); return; }
            if (customId === 'stop_my_tokens') {
                const userId = user.id; const conns = userConnections.get(userId) || [];
                if (conns.length === 0) { await interaction.reply({ content: '⚠️ Bạn không có Tokens nào đang treo.' }); return; }
                await interaction.deferReply();
                for (const conn of conns) { conn.cancel(); const history = userHistory.get(userId) || []; const histItem = history.find(h => h.id === conn.id); if (histItem) histItem.isActive = false; userHistory.set(userId, history); }
                userConnections.delete(userId); if (userGroupMessages.has(userId)) { try { const data = userGroupMessages.get(userId); await data.message.delete().catch(() => {}); } catch (e) {} userGroupMessages.delete(userId); }
                await interaction.editReply({ content: `🛑 Đã dừng toàn bộ ${conns.length} User Tokens!` }); return;
            }
            if (customId.startsWith('stop_token_')) {
                const connId = customId.replace('stop_token_', ''); const userId = user.id; const conns = userConnections.get(userId) || [];
                const connIndex = conns.findIndex(c => c.id === connId);
                if (connIndex === -1) { await interaction.reply({ content: '⚠️ Token này đã dừng hoặc không tồn tại.' }); return; }
                const conn = conns[connIndex]; conn.cancel(); conns.splice(connIndex, 1);
                if (conns.length === 0) userConnections.delete(userId); else userConnections.set(userId, conns);
                const history = userHistory.get(userId) || []; const histItem = history.find(h => h.id === conn.id); if (histItem) histItem.isActive = false; userHistory.set(userId, history);
                await interaction.reply({ content: `🛑 Đã dừng token của **${conn.name}**` }); return;
            }
            if (customId.startsWith('hype_')) {
                const houseId = parseInt(customId.split('_')[1]); hypeHouseMap.set(user.id, houseId);
                const houseNames = { 1: 'Bravery (Đỏ)', 2: 'Brilliance (Tím)', 3: 'Balance (Xanh)' };
                const modal = new ModalBuilder().setCustomId('hypeModal').setTitle(`Đổi sang ${houseNames[houseId]}`);
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('userToken').setLabel('User Token').setStyle(TextInputStyle.Paragraph).setRequired(true)));
                await interaction.showModal(modal); return;
            }

            if (customId.startsWith('start_dashboard_')) {
                const sessionId = customId.replace('start_dashboard_', '');
                const session = sessions.get(sessionId);
                if (!session) { try { await interaction.reply({ content: '❌ Phiên farm đã hết hạn.', ephemeral: true }); } catch (e) {} return; }

                let lastDashboardState = '';

                try {
                    await interaction.deferUpdate();
                    stopFlagsSession.delete(sessionId);
                    for (const completer of session.completers) { completer.stopRequested = false; stopFlagsSession.delete(completer.sessionId); }
                    session.isDeleted = false;

                    const stopButton = new ButtonBuilder().setCustomId(`stop_dashboard_${sessionId}`).setLabel('Dừng farm').setStyle(ButtonStyle.Danger);
                    const row = new ActionRowBuilder().addComponents(stopButton);

                    const buildDashboardData = () => {
                        const embeds = []; let stateCheckStr = '';
                        for (let i = 0; i < session.completers.length; i++) {
                            const completer = session.completers[i];
                            const username = session.usernames[i]; const avatarUrl = session.avatars[i];
                            let fieldValue = '';
                            if (!completer.quests || completer.quests.length === 0) fieldValue = 'Đang chờ phân tích quest...';
                            else {
                                const limit = 3;
                                for (let j = 0; j < Math.min(completer.quests.length, limit); j++) {
                                    const q = completer.quests[j];
                                    const needed = Math.max(0, q.needed || 0);
                                    const done = Math.min(needed, Math.max(0, q.done || 0));
                                    const progress = needed > 0 ? Math.min(done / needed, 1) : 1;
                                    const barLength = 8; const filled = Math.round(progress * barLength); const empty = barLength - filled;
                                    const bar = '█'.repeat(filled) + '░'.repeat(empty);
                                    const left = Math.max(0, needed - done); const mins = Math.floor(left / 60); const secs = Math.floor(left % 60);
                                    fieldValue += `${progress >= 1 ? '<a:0295_whitetick:1511346285330960444>' : '<a:zc:1522828760158834728>'} **${truncate(q.name, 20)}** ${bar} ${Math.round(progress*100)}% - ${mins}:${secs.toString().padStart(2, '0')}\n`;
                                }
                                if (completer.quests.length > limit) fieldValue += `... và ${completer.quests.length - limit} quest khác\n`;
                            }
                            stateCheckStr += `${i}:${fieldValue}`;
                            const embed = new EmbedBuilder().setTitle(`Token ${i+1}: ${escapeMarkdown(username)}`).setThumbnail(avatarUrl).setColor(0x2F3136).setDescription('Đang chạy...').addFields({ name: 'Tiến trình', value: truncateLinesSafe(fieldValue || 'Đang chờ...', 1024), inline: false }).setImage(GIF_URL);
                            embeds.push(embed);
                        }
                        return { embeds, stateCheckStr };
                    };

                    const initialData = buildDashboardData();
                    lastDashboardState = initialData.stateCheckStr;
                    const updatedMessage = await interaction.editReply({ embeds: initialData.embeds, components: [row] });
                    session.dashMsg = updatedMessage;

                    const updateDashboard = async () => {
                        if (!session || !session.dashMsg || session.isDeleted) {
                            if (session && session.interval) { clearInterval(session.interval); session.interval = null; }
                            return;
                        }
                        const { embeds, stateCheckStr } = buildDashboardData();
                        if (stateCheckStr === lastDashboardState) return;
                        lastDashboardState = stateCheckStr;

                        try {
                            embeds.forEach(embed => embed.setImage(null));
                            await session.dashMsg.edit({ embeds: embeds, components: [row] });
                        } catch (e) {
                            if (e.code === 429) { const retryAfter = e.retryAfter || 5; console.warn(`⚠️ Rate Limit, chờ ${retryAfter}s...`); await sleep(retryAfter * 1000); }
                            else if (e.code === 10008 || e.message.includes("Unknown Message")) { session.isDeleted = true; session.dashMsg = null; if (session.interval) { clearInterval(session.interval); session.interval = null; } }
                        }
                    };

                    session.interval = setInterval(updateDashboard, DASHBOARD_UPDATE_INTERVAL);
                    for (const completer of session.completers) completer.onUpdate = () => updateDashboard();

                    (async () => {
                        try { await Promise.all(session.completers.map(completer => completer.processAllQuests())); } catch (e) {}
                        finally {
                            await sleep(2500); if (session.interval) { clearInterval(session.interval); session.interval = null; } setTimeout(() => sessions.delete(sessionId), 5000);
                            const finalEmbeds = [];
                            for (let i = 0; i < session.completers.length; i++) {
                                const completer = session.completers[i]; const username = session.usernames[i]; const avatarUrl = session.avatars[i];
                                let desc = `**${escapeMarkdown(username)}** - Đã hoàn thành ${completer.sessionCompleted} quest.\n`;
                                if (completer.quests) completer.quests.forEach((q) => { desc += `<a:0295_whitetick:1511346285330960444> **${q.name}** - **${q.reward}**\n`; });
                                const embed = new EmbedBuilder().setTitle(`Token ${i+1}: ${escapeMarkdown(username)}`).setThumbnail(avatarUrl).setColor(0x2F3136).setDescription(truncateLinesSafe(desc || 'Không có quest nào.', 1024));
                                finalEmbeds.push(embed);
                            }
                            if (session.dashMsg && !session.isDeleted) {
                                try { await session.dashMsg.edit({ embeds: finalEmbeds, components: [] }).catch(() => {}); } catch (e) {}
                            }
                        }
                    })();

                } catch (e) { console.error('❌ Lỗi start_dashboard:', e); try { if (interaction.deferred) await interaction.editReply({ content: '❌ Đã xảy ra lỗi khi bắt đầu farm. Vui lòng thử lại.', components: [] }); else await interaction.reply({ content: '❌ Đã xảy ra lỗi.', ephemeral: true }); } catch (err) {} }
                return;
            }
        }

        if (interaction.isModalSubmit()) {
            const modalId = interaction.customId;

            if (modalId === 'spamModal') {
                try {
                    const tokensRaw = interaction.fields.getTextInputValue('tokens');
                    const channelId = interaction.fields.getTextInputValue('channel_id');
                    const delayMin = parseFloat(interaction.fields.getTextInputValue('delay_min'));
                    const delayMax = parseFloat(interaction.fields.getTextInputValue('delay_max'));
                    const message = interaction.fields.getTextInputValue('message');

                    if (isNaN(delayMin) || isNaN(delayMax) || delayMin <= 0 || delayMax < delayMin) {
                        return interaction.reply({ content: '⚠️ Delay không hợp lệ (min phải > 0 và max >= min).', ephemeral: true });
                    }
                    if (!/^\d+$/.test(channelId)) {
                        return interaction.reply({ content: 'Channel ID không hợp lệ!', ephemeral: true });
                    }

                    const tokens = tokensRaw.split(/[\n,]+/).map(t => t.trim()).filter(t => t.length > 0);
                    if (tokens.length === 0) {
                        return interaction.reply({ content: '❌ Bạn chưa nhập token nào!', ephemeral: true });
                    }
                    if (!message || message.trim().length === 0) {
                        return interaction.reply({ content: '❌ Bạn chưa nhập nội dung tin nhắn!', ephemeral: true });
                    }

                    await interaction.deferReply({ ephemeral: false });
                    const guildId = interaction.guild?.id || null;
                    const result = await startSpam(interaction.user.id, guildId, channelId, [message.trim()], tokens, delayMin, delayMax);

                    if (result.success) {
                        await interaction.editReply({ content: `✅ ${result.message} Kênh: <#${channelId}>` });
                    } else {
                        await interaction.editReply({ content: `❌ ${result.message}` });
                    }
                } catch (e) {
                    console.error('❌ Lỗi xử lý modal spam:', e);
                    try {
                        if (interaction.deferred) await interaction.editReply({ content: `❌ Lỗi xử lý: ${e.message}` });
                        else await interaction.reply({ content: `❌ Lỗi xử lý: ${e.message}`, ephemeral: true });
                    } catch (err) {}
                }
                return;
            }

            if (modalId === 'nhayModal') {
                try {
                    const messagesRaw = interaction.fields.getTextInputValue('messages');
                    const pendingData = pendingNhayData.get(interaction.user.id);

                    if (!pendingData) {
                        return interaction.reply({ content: '❌ Phiên nhập liệu đã hết hạn hoặc không hợp lệ. Vui lòng thử lại lệnh /nhay.', ephemeral: true });
                    }

                    const messages = messagesRaw.split(/[\n,]+/).map(m => m.trim()).filter(m => m.length > 0);
                    if (messages.length === 0) {
                        return interaction.reply({ content: '❌ Bạn chưa nhập nội dung tin nhắn!', ephemeral: true });
                    }

                    const { tokens, channelId, delayMin, delayMax, tags, guildId } = pendingData;

                    await interaction.deferReply({ ephemeral: false });
                    const result = await startSpam(interaction.user.id, guildId, channelId, messages, tokens, delayMin, delayMax, tags);
                    pendingNhayData.delete(interaction.user.id);

                    if (result.success) {
                        await interaction.editReply({ content: `✅ ${result.message} Kênh: <#${channelId}>` });
                    } else {
                        await interaction.editReply({ content: `❌ ${result.message}` });
                    }
                } catch (e) {
                    console.error('❌ Lỗi xử lý modal nhay:', e);
                    try {
                        if (interaction.deferred) await interaction.editReply({ content: `❌ Lỗi xử lý: ${e.message}` });
                        else await interaction.reply({ content: `❌ Lỗi xử lý: ${e.message}`, ephemeral: true });
                    } catch (err) {}
                }
                return;
            }

            if (modalId === 'getorbModal') {
                const rawTokens = interaction.fields.getTextInputValue('tokenInput').split(/\r?\n/).map(t => t.trim()).filter(t => t.length > 0);
                if (rawTokens.length === 0) return interaction.reply({ content: '❌ Bạn chưa nhập token nào.', ephemeral: true });
                if (rawTokens.length > 1 || rawTokens[0].length > 200) return interaction.reply({ content: '❌ Chỉ được nhập 1 token duy nhất, không xuống dòng, độ dài hợp lệ!', ephemeral: true });
                const token = rawTokens[0]; await interaction.deferReply();
                try {
                    const buildNumber = await fetchLatestBuildNumber(); const api = new DiscordApi(token, buildNumber); const user = await api.validateToken();
                    if (!user) { await interaction.editReply('❌ Token không hợp lệ.'); return; }
                    const avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png';
                    const sessionId = `${interaction.id}_${Date.now()}`; const completer = new QuestAutocompleter(api, interaction.user.id, client, sessionId, sessionId);
                    let quests = await completer.fetchQuests(); quests = await completer.autoAcceptQuests(quests);
                    const actionable = quests.filter(q => isEnrolled(q) && !isCompleted(q) && isCompletable(q));
                    if (actionable.length === 0) { let msg = `❌ Token của **${escapeMarkdown(user.username)}** không có quest nào khả dụng.`; await interaction.editReply(msg); return; }
                    completer.quests = actionable.map(q => ({ id: q["id"], name: escapeMarkdown(getQuestName(q)), reward: escapeMarkdown(getQuestReward(q)), type: getTaskType(q), needed: getSecondsNeeded(q) || 0, done: getSecondsDone(q) || 0, status: 'pending' }));
                    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`start_dashboard_${sessionId}`).setLabel('Bắt đầu farm').setStyle(ButtonStyle.Success));
                    let desc = ''; completer.quests.forEach(q => { desc += `<a:tim:1512996787072270336> **${q.name}** - **${q.reward}**\n`; });
                    const embed = new EmbedBuilder().setTitle('Orb Quest Dashboard').setColor(0x2F3136).setDescription(`Tài khoản: **${escapeMarkdown(user.username)}**\nTrạng thái: **Sẵn sàng**`).setThumbnail(avatarUrl).setImage(GIF_URL).addFields({ name: 'Danh sách Quest', value: truncateLinesSafe(desc, 1024) || 'Không có quest nào.' });
                    const dashMsg = await interaction.editReply({ embeds: [embed], components: [row] });
                    const timeoutId = setTimeout(async () => { const currentSession = sessions.get(sessionId); if (currentSession && !currentSession.interval) { sessions.delete(sessionId); try { await dashMsg.delete(); } catch (e) {} } }, 3600000);
                    sessions.set(sessionId, { interaction, dashMsg, interval: null, completers: [completer], usernames: [user.username], avatars: [avatarUrl], timeoutId, userId: interaction.user.id, isDeleted: false });
                } catch (e) { try { await interaction.editReply(`❌ Lỗi: ${e.message}`); } catch (err) {} }
                return;
            }
            if (modalId === 'sword_modal') {
                const token = interaction.fields.getTextInputValue('token').trim(); const guildId = interaction.fields.getTextInputValue('guild_id').trim(); const channelId = interaction.fields.getTextInputValue('channel_id').trim();
                if (!token || !guildId || !channelId) return interaction.reply({ content: '❌ Điền đầy đủ thông tin.', ephemeral: true });
                await interaction.deferReply({ ephemeral: true }); const userInfo = await checkUserToken(token, false); if (!userInfo) return interaction.editReply('❌ Token không hợp lệ.');
                const userId = interaction.user.id; const connId = `${userId}_sword_${Date.now()}`;
                const connection = runVoiceConnection(token, userInfo, guildId, channelId, `${guildId}/${channelId}`);
                if (!userConnections.has(userId)) userConnections.set(userId, []); userConnections.get(userId).push({ id: connId, cancel: connection.cancel, token, name: userInfo, guildId, channelId, userId, type: 'sword' });
                await interaction.editReply(`✅ Đã bắt đầu treo voice + Spotify cho **${userInfo}** tại <#${channelId}>.`); return;
            }
            if (modalId === 'treo_bot_modal') {
                const guildId = interaction.fields.getTextInputValue('guild_id'); const channelId = interaction.fields.getTextInputValue('channel_id');
                if (botVoiceConnection) return interaction.reply({ content: '⚠️ Bot đang treo room rồi!' });
                try {
                    const guild = client.guilds.cache.get(guildId); if (!guild) return interaction.reply({ content: '❌ Không tìm thấy Guild ID.' });
                    const channel = guild.channels.cache.get(channelId); if (!channel || channel.type !== 2) return interaction.reply({ content: '❌ Không tìm thấy Voice Channel hợp lệ.' });
                    const connection = joinVoiceChannel({ channelId: channelId, guildId: guildId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true, selfMute: true });
                    botVoiceConnection = connection;
                    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🚀 Bot Đã Treo Thành Công!').setDescription(`Bot **${client.user.tag}** đang treo tại room <#${channelId}>.`).setColor(0x00FF00)] });
                } catch (err) { await interaction.reply({ content: `❌ Lỗi: ${err.message}` }); } return;
            }
            if (modalId === 'add_tokens_modal') {
                const userId = interaction.user.id; const rawTokens = interaction.fields.getTextInputValue('tokens').split('\n').map(t => t.trim()).filter(t => t); const guildId = interaction.fields.getTextInputValue('guild_id'); const channelId = interaction.fields.getTextInputValue('channel_id');
                const validTokens = []; for (const tk of rawTokens) { const name = await checkUserToken(tk, false); if (name) validTokens.push({ token: tk, name }); }
                if (validTokens.length === 0) { await interaction.reply({ content: '❌ Không có Token User nào hợp lệ!' }); return; }
                await interaction.deferReply(); const addedConns = [];
                for (const { token, name } of validTokens) {
                    const conn = createUserConnection(token, name, guildId, channelId, userId);
                    if (!userConnections.has(userId)) userConnections.set(userId, []); userConnections.get(userId).push(conn); addedConns.push(conn);
                    if (!userHistory.has(userId)) userHistory.set(userId, []); userHistory.get(userId).push({ id: conn.id, name: name, token: token, guildId: guildId, channelId: channelId, timestamp: Date.now(), isActive: true });
                }
                if (addedConns.length === 1) { const conn = addedConns[0]; const message = await sendTokenEmbed(interaction, conn, true); conn.message = message; }
                else if (addedConns.length > 1) { const { embed, rows } = generateGroupedEmbed(addedConns); const message = await interaction.followUp({ embeds: [embed], components: rows }); userGroupMessages.set(userId, { message: message, connIds: addedConns.map(c => c.id) }); }
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🚀 Thêm Tokens Thành Công!').setDescription(`Đã kích hoạt **${addedConns.length}** tokens vào room <#${channelId}>.`).setColor(0x00FF00)] }); return;
            }
            if (modalId === 'add_bot_modal') {
                const userId = interaction.user.id; const botToken = interaction.fields.getTextInputValue('bot_token').trim(); const guildId = interaction.fields.getTextInputValue('guild_id'); const channelId = interaction.fields.getTextInputValue('channel_id');
                if (!botToken || botToken.length < 50) return interaction.reply({ content: '❌ Token không hợp lệ!' }); const name = await checkUserToken(botToken, true); if (!name) return interaction.reply({ content: '❌ Token bot không hợp lệ!' });
                await interaction.deferReply(); const conn = createUserConnection(botToken, name, guildId, channelId, userId);
                if (!userConnections.has(userId)) userConnections.set(userId, []); userConnections.get(userId).push(conn);
                if (!userHistory.has(userId)) userHistory.set(userId, []); userHistory.get(userId).push({ id: conn.id, name: name, token: botToken, guildId: guildId, channelId: channelId, timestamp: Date.now(), isActive: true });
                const message = await sendTokenEmbed(interaction, conn, true); conn.message = message;
                await interaction.editReply({ content: `✅ Đã thêm bot **${escapeMarkdown(name)}** vào room <#${channelId}>.` }); return;
            }
            if (modalId === 'tokeninfoModal') {
                const token = interaction.fields.getTextInputValue('tokenInput').trim(); await interaction.deferReply({ ephemeral: true });
                try { const bn = await fetchLatestBuildNumber(); const api = new DiscordApi(token, bn); const user = await api.validateToken(); if (!user) { await interaction.editReply('Token không hợp lệ.'); return; } const embed = new EmbedBuilder().setColor(0x57F287).setTitle('Thông tin tài khoản').addFields({ name: 'Tên', value: escapeMarkdown(`${user.username}#${user.discriminator || '0'}`), inline: true }, { name: 'ID', value: user.id, inline: true }, { name: 'Email', value: escapeMarkdown(user.email || 'Không có'), inline: true }, { name: 'Phone', value: user.phone || 'Không có', inline: true }, { name: 'Nitro', value: user.premium_type ? 'Có' : 'Không', inline: true }); await interaction.editReply({ embeds: [embed] }); } catch (e) { await interaction.editReply('Lỗi: ' + e.message); } return;
            }
            if (modalId === 'statusModal') {
                const token = interaction.fields.getTextInputValue('tokenInput').trim(); await interaction.deferReply({ ephemeral: true });
                try { const bn = await fetchLatestBuildNumber(); const api = new DiscordApi(token, bn); const user = await api.validateToken(); if (!user) { await interaction.editReply('Token không hợp lệ.'); return; } const completer = new QuestAutocompleter(api, interaction.user.id, client, 'status'); const quests = await completer.fetchQuests(); if (quests.length === 0) { await interaction.editReply('Không có quest nào.'); return; } let desc = ''; for (const q of quests) { const name = getQuestName(q); const type = getTaskType(q) || 'N/A'; const done = getSecondsDone(q) || 0; const total = getSecondsNeeded(q) || 0; const reward = getQuestReward(q); const completed = isCompleted(q) ? '<a:0295_whitetick:1511346285330960444>' : isEnrolled(q) ? '<a:emoji_16:1511386109484077198>' : '⬜'; desc += `${completed} **${escapeMarkdown(name)}** - ${type} (${done}/${total}s) - **${escapeMarkdown(reward)}**\n`; } const embed = new EmbedBuilder().setTitle(`Quests của ${escapeMarkdown(user.username)}`).setDescription(truncate(desc, 4096)).setColor(0x5865F2); await interaction.editReply({ embeds: [embed] }); } catch (e) { await interaction.editReply('Lỗi: ' + e.message); } return;
            }
            if (modalId === 'hypeModal') {
                const userId = interaction.user.id; const houseId = hypeHouseMap.get(userId); if (!houseId) { await interaction.reply({ content: 'Phiên đã hết hạn.' }); return; }
                const userToken = interaction.fields.getTextInputValue('userToken').trim(); if (userToken.length < 50) { await interaction.reply({ content: 'Token không hợp lệ!' }); return; }
                await interaction.deferReply({ ephemeral: true });
                try {
                    const res = await fetch('https://discord.com/api/v9/hypesquad/online', { method: 'POST', headers: { 'Authorization': userToken, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, body: JSON.stringify({ house_id: houseId }) });
                    if (res.status === 204) await interaction.editReply(`<a:pnv_legittick:1511377324246040629> Đổi thành công sang **${['','Bravery','Brilliance','Balance'][houseId]}**!`);
                    else await interaction.editReply(`<a:overlove:1511378249136078992> Đổi thất bại (HTTP ${res.status}). Token sai hoặc bị chặn.`);
                } catch (e) { await interaction.editReply('Lỗi kết nối: ' + e.message); } hypeHouseMap.delete(userId); return;
            }
        }
    } catch (error) { console.error('❌ Unhandled interaction error:', error); try { if (interaction.replied || interaction.deferred) await interaction.editReply({ content: '❌ Đã xảy ra lỗi không mong muốn.' }); else if (interaction.isRepliable()) await interaction.reply({ content: '❌ Đã xảy ra lỗi không mong muốn.' }); } catch (e) {} }
});

// ============================================================
// PROCESS HANDLING & LOGIN
// ============================================================
process.on('unhandledRejection', (reason, promise) => { console.error('Unhandled Rejection at:', promise, 'reason:', reason); });
process.on('uncaughtException', (error) => { console.error('Uncaught Exception:', error); });
process.on('SIGTERM', () => {
    console.log('Received SIGTERM signal. Shutting down gracefully...');
    for (const [userId, conns] of userConnections) { for (const conn of conns) { if (conn.cancel) conn.cancel(); } }
    process.exit(0);
});

client.login(BOT_TOKEN);