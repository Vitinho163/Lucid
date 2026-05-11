const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');

const appDataPath = process.argv[2];

if (!appDataPath) {
    console.log(JSON.stringify({ type: 'error', data: 'No AppData path provided' }));
    process.exit(1);
}

const authPath = path.join(appDataPath, '.wwebjs_auth');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: authPath }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log(JSON.stringify({ type: 'qr', data: qr }));
});

client.on('authenticated', () => {
    console.log(JSON.stringify({ type: 'ready' }));
});

client.on('ready', () => {
    console.log(JSON.stringify({ type: 'ready' }));
    setTimeout(() => console.log(JSON.stringify({ type: 'ready' })), 2000);
    setTimeout(() => console.log(JSON.stringify({ type: 'ready' })), 5000);
});

client.on('auth_failure', msg => {
    console.log(JSON.stringify({ type: 'error', data: 'Auth failure: ' + msg }));
});

client.initialize().catch(err => {
    console.log(JSON.stringify({ type: 'error', data: err.toString() }));
});
