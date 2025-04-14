const { ipcRenderer } = require('electron');
const { io } = require("socket.io-client");
const socket = io("http://localhost:3001"); 



let webview = null;
let currentSite = 'home';

socket.on("connect", () => {
    console.log("Conectado ao WebSocket:", socket.id);
  });

socket.on("notification", (data) => {
    if (Notification.permission === "granted") {
      new Notification(data.title, {
        body: data.body,
        icon: "../assets/icon.png", // opcional
      });
    } else {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          new Notification(data.title, {
            body: data.body,
          });
        }
      });
    }
  });
  

document.addEventListener('DOMContentLoaded', () => {
    webview = document.getElementById('webview');
    webview ? setupWebView() : createWebView();
    setupNavigationButtons();
    displayAppVersion();
});

function setupWebView() {
    if (!webview) return;

    webview.addEventListener('did-start-loading', () => {
        document.getElementById('loading-indicator')?.classList.remove('hidden');
    });

    webview.addEventListener('did-finish-load', () => {
        document.getElementById('loading-indicator')?.classList.add('hidden');
    });

    webview.addEventListener('did-fail-load', (event) => {
        console.error('Erro ao carregar página:', event);
        document.getElementById('loading-indicator')?.classList.add('hidden');
        document.getElementById('error-container')?.classList.remove('hidden');
        document.getElementById('error-message').textContent =
            `Erro ao carregar: ${event.errorDescription || 'Falha no carregamento'}`;
    });

    webview.addEventListener('new-window', (e) => {
        e.preventDefault();
        const isInternalSite = Object.values(getSitesList()).some(siteUrl =>
            e.url.startsWith(siteUrl) || isRelatedDomain(e.url, currentSite)
        );

        if (isInternalSite) webview.src = e.url;
        else ipcRenderer.send('open-external', e.url);
    });

    webview.addEventListener('dom-ready', () => {
        webview.executeJavaScript(`
            document.addEventListener('click', (e) => {
                let target = e.target;
                while (target && target.tagName !== 'A') {
                    target = target.parentElement;
                }
                if (target && target.tagName === 'A' && target.getAttribute('target') === '_blank') {
                    e.preventDefault();
                    e.stopPropagation();
                    window.postMessage({ type: 'link-clicked', url: target.href }, '*');
                    return false;
                }
            }, true);

            window.addEventListener('message', (event) => {
                if (event.data?.type === 'link-clicked') {
                    window.postMessage({ type: 'electron-link-clicked', url: event.data.url }, '*');
                }
            });
        `).catch(err => console.error('Erro ao injetar JavaScript:', err));
    });

    webview.addEventListener('ipc-message', (event) => {
        if (event.channel === 'link-clicked') {
            handleLinkClick(event.args[0]);
        }
    });
}

function createWebView() {
    const container = document.getElementById('content-container');
    if (!container) return;

    if (!webview || !document.body.contains(webview)) {
        webview = document.createElement('webview');
        webview.id = 'webview';
        webview.classList.add('w-full', 'h-full');
        webview.setAttribute('allowpopups', 'false');
        webview.setAttribute('webpreferences', 'contextIsolation=false, nodeIntegration=false, nativeWindowOpen=false');
        container.innerHTML = '';
        container.appendChild(webview);
        setupWebView();
    }
}

function handleLinkClick(url) {
    if (isRelatedDomain(url, currentSite)) {
        navigateWebViewTo(url);
    } else {
        ipcRenderer.send('open-external', url);
    }
}

function setupNavigationButtons() {
    const navButtons = document.querySelectorAll('[data-nav]');
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            const siteKey = button.getAttribute('data-nav');
            currentSite = siteKey;

            if (siteKey === 'home') {
                ipcRenderer.send('navigate', 'home');
            } else {
                if (!webview) createWebView();
                ipcRenderer.send('navigate-webview', siteKey);
            }

            navButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
        });
    });
}

function isRelatedDomain(url, currentSite) {
    const relatedDomains = {
        whatsapp: ['web.whatsapp.com', 'whatsapp.com'],
        telegram: ['web.telegram.org', 'telegram.org'],
        gmail: ['mail.google.com', 'accounts.google.com'],
        outlook: ['outlook.live.com', 'login.live.com', 'outlook.office.com'],
        linkedin: ['linkedin.com'],
        discord: ['discord.com', 'discordapp.com']
    };
    return relatedDomains[currentSite]?.some(domain => url.includes(domain)) || false;
}

function normalizeUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.origin + parsed.pathname;
    } catch {
        return url;
    }
}

function navigateWebViewTo(url) {
    if (!webview) createWebView();

    const currentURL = webview.getURL();
    if (normalizeUrl(currentURL) !== normalizeUrl(url)) {
        webview.src = url;
    }
}

async function displayAppVersion() {
    try {
        const version = await ipcRenderer.invoke('get-app-version');
        const versionElement = document.getElementById('app-version');
        if (versionElement) versionElement.textContent = `Versão: ${version}`;
    } catch (err) {
        console.error('Erro ao obter versão do app:', err);
    }
}


ipcRenderer.on('load-url', (event, data) => {
    if (!webview) createWebView();

    if (data.title && document.getElementById('page-title')) {
        document.getElementById('page-title').textContent =
            data.title.charAt(0).toUpperCase() + data.title.slice(1);
    }

    if (data.partition) {
        webview.setAttribute('partition', data.partition);
    }

    webview.style.display = 'block';
    navigateWebViewTo(data.url);
    document.getElementById('error-container')?.classList.add('hidden');
    currentSite = data.title || 'unknown';
});

ipcRenderer.on('open-external', (event, url) => {
    ipcRenderer.send('open-external', url);
});

ipcRenderer.on('load-error', (event, data) => {
    console.error(`Erro ao carregar ${data.site}:`, data.error);
    document.getElementById('error-container')?.classList.remove('hidden');
    document.getElementById('error-message').textContent =
        `Erro ao carregar ${data.site}: ${data.error}`;
});

setTimeout(() => {
    socket.emit("nova-mensagem", { texto: "Olá do cliente!" });
  }, 1000);

ipcRenderer.on('site-loading', (event, data) => {
    if (data.title && document.getElementById('page-title')) {
        document.getElementById('page-title').textContent =
            data.title.charAt(0).toUpperCase() + data.title.slice(1);
    }

    document.getElementById('loading-indicator')?.classList.remove('hidden');
});

ipcRenderer.on('set-token', (event, token) => {
    if (token) {
        localStorage.setItem('token', token);
        getApplications();
    } else {
        console.warn('Token inválido recebido');
    }
});
