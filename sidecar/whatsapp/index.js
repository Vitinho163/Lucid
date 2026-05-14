const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

const appDataPath = process.argv[2];

if (!appDataPath) {
    console.log(JSON.stringify({ type: 'error', data: 'No AppData path provided' }));
    process.exit(1);
}

const authPath = path.join(appDataPath, '.wwebjs_auth');

function wipeAuthFolder() {
    try {
        fs.rmSync(authPath, { recursive: true, force: true });
    } catch (_) {}
}

function createClient() {
    return new Client({
        authStrategy: new LocalAuth({ dataPath: authPath }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            protocolTimeout: 0 // Prevent Runtime.callFunctionOn timeouts
        }
    });
}

let client = createClient();
let isClientReady = false;
let isReinitializing = false;
let monitorInterval = null;

async function reinitialize(wipe = false) {
    if (isReinitializing) return;
    isReinitializing = true;
    isClientReady = false;
    
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }

    // Give stdout a tiny moment to flush before tearing down the browser
    await new Promise(r => setTimeout(r, 100));

    // 1. Hard-kill the headless Chrome process to instantly drop file locks
    try {
        if (client && client.pupBrowser && client.pupBrowser.process()) {
            client.pupBrowser.process().kill('SIGKILL');
        }
    } catch (_) {}

    // 2. Await destroy with a strict 2-second timeout to prevent deadlocks
    try {
        await Promise.race([
            client.destroy(),
            new Promise(resolve => setTimeout(resolve, 2000))
        ]);
    } catch (_) {}

    // 3. Now that the process is dead, the file locks are gone, so we can wipe
    if (wipe) wipeAuthFolder();
    
    setTimeout(() => {
        client = createClient();
        attachEvents();
        isReinitializing = false;
        client.initialize().catch(err => handleInitError(err));
    }, 3000);
}

function isFatalError(msg) {
    if (msg.includes('timed out')) return false;
    return msg.includes('Execution context was destroyed') || 
           msg.includes('Target closed') || 
           msg.includes('Session closed');
}

function handleInitError(err) {
    const msg = err.message || err.toString();
    console.log(JSON.stringify({ type: 'error', data: msg }));
    if (isFatalError(msg)) {
        console.log(JSON.stringify({ type: 'disconnected', data: 'init-context-destroyed' }));
        reinitialize(true);
    } else {
        reinitialize(false);
    }
}

function startPuppeteerWatchdog() {
    if (monitorInterval) clearInterval(monitorInterval);
    
    monitorInterval = setInterval(async () => {
        try {
            if (!client.pupPage || client.pupPage.isClosed()) {
                throw new Error('Page closed');
            }
            const isLoggedOut = await client.pupPage.evaluate(() => {
                return !!document.querySelector('[data-ref]');
            });
            if (isLoggedOut) {
                throw new Error('QR code detected on active session');
            }
        } catch (error) {
            if (monitorInterval) clearInterval(monitorInterval);
            monitorInterval = null;
            
            const msg = error.message || '';
            const shouldWipe = isFatalError(msg);
            console.log(JSON.stringify({ type: 'disconnected', data: msg }));
            await reinitialize(shouldWipe);
        }
    }, 3000);
}

function attachEvents() {
    client.on('qr', (qr) => {
        console.log(JSON.stringify({ type: 'qr', data: qr }));
    });

    client.on('ready', () => {
        if (!isClientReady) {
            isClientReady = true;
            console.log(JSON.stringify({ type: 'ready' }));
            startPuppeteerWatchdog();
        }
    });

    client.on('disconnected', async (reason) => {
        if (isClientReady) {
            console.log(JSON.stringify({ type: 'disconnected', data: reason }));
            await reinitialize(true);
        }
    });

    client.on('auth_failure', async (msg) => {
        console.log(JSON.stringify({ type: 'error', data: 'Auth failure: ' + msg }));
        await reinitialize(true);
    });

    const processIncomingMessage = async (msg) => {
        let mediaData = null;
        if (msg.hasMedia && (msg.type === 'image' || msg.type === 'sticker')) {
            try {
                const media = await msg.downloadMedia();
                if (media) mediaData = `data:${media.mimetype};base64,${media.data}`;
            } catch (e) {}
        }
        return { 
            id: msg.id.id, 
            body: msg.body || '', 
            fromMe: msg.fromMe, 
            timestamp: msg.timestamp, 
            chatId: msg.fromMe ? msg.to : msg.from,
            type: msg.type,
            mediaData
        };
    };

    client.on('message', async (msg) => {
        if (!isClientReady) return;
        const data = await processIncomingMessage(msg);
        console.log(JSON.stringify({ type: 'incoming_message', data }));
    });

    client.on('message_create', async (msg) => {
        if (!isClientReady || !msg.fromMe) return;
        const data = await processIncomingMessage(msg);
        console.log(JSON.stringify({ type: 'incoming_message', data }));
    });
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', async (data) => {
    if (!isClientReady || !client) return;
    const lines = data.split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const cmd = JSON.parse(line.trim());
            
            const retryEval = async (fn, retries = 3) => {
                for (let i = 0; i < retries; i++) {
                    try { return await fn(); }
                    catch (e) {
                        if (e.message.includes('Execution context was destroyed') && i < retries - 1) {
                            await new Promise(r => setTimeout(r, 1500));
                            continue;
                        }
                        throw e;
                    }
                }
            };

            if (cmd.action === 'get_chats') {
                const allChats = await retryEval(() => client.getChats());
                const topChats = allChats.slice(0, 30); // Limit to top 30 to keep it fast
                const simpleChats = await Promise.all(topChats.map(async c => {
                    let picUrl = null;
                    try { picUrl = await retryEval(() => client.getProfilePicUrl(c.id._serialized), 1); } catch (e) {}
                    return { 
                        id: c.id._serialized, 
                        name: c.name || (c.id && c.id.user) || 'Unknown Chat', 
                        unreadCount: c.unreadCount || 0,
                        picUrl: picUrl || null
                    };
                }));
                console.log(JSON.stringify({ type: 'chats', data: simpleChats }));
            } else if (cmd.action === 'get_messages' && cmd.chatId) {
                const chat = await retryEval(() => client.getChatById(cmd.chatId));
                const msgs = await retryEval(() => chat.fetchMessages({ limit: 50 }));
                const simpleMsgs = await Promise.all(msgs.map(async m => {
                    let mediaData = null;
                    if (m.hasMedia && (m.type === 'image' || m.type === 'sticker')) {
                        try {
                            const media = await retryEval(() => m.downloadMedia(), 1);
                            if (media) mediaData = `data:${media.mimetype};base64,${media.data}`;
                        } catch (e) {}
                    }
                    return { 
                        id: m.id?.id || Math.random().toString(), 
                        body: m.body || '', 
                        fromMe: m.fromMe || false, 
                        timestamp: m.timestamp || Date.now() / 1000,
                        type: m.type,
                        mediaData
                    };
                }));
                console.log(JSON.stringify({ type: 'messages', chatId: cmd.chatId, data: simpleMsgs }));
            } else if (cmd.action === 'send_message' && cmd.chatId && cmd.text) {
                const sent = await retryEval(() => client.sendMessage(cmd.chatId, cmd.text));
                console.log(JSON.stringify({ 
                    type: 'message_sent', 
                    data: { 
                        id: sent.id?.id || Math.random().toString(), 
                        body: sent.body || cmd.text, 
                        fromMe: true, 
                        timestamp: sent.timestamp || Date.now() / 1000, 
                        chatId: cmd.chatId,
                        type: 'chat'
                    } 
                }));
            }
        } catch (e) {
            console.log(JSON.stringify({ type: 'error', data: 'IPC Error: ' + e.message }));
        }
    }
});

// Global guards against silent Node crashes during teardown
process.on('uncaughtException', err => {
    // We ignore it so the sidecar doesn't die silently
});
process.on('unhandledRejection', (reason, promise) => {
    // Puppeteer throws lots of these when its underlying browser is killed
});

// Ensure Puppeteer instances are killed if the Node sidecar is abruptly terminated
['SIGINT', 'SIGTERM', 'SIGQUIT', 'exit'].forEach(signal => {
    process.on(signal, async () => {
        try {
            if (client) await client.destroy();
        } catch (_) {}
        process.exit(0);
    });
});

attachEvents();
client.initialize().catch(err => handleInitError(err));
