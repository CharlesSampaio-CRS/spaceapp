const path = require('path');
const { app, BrowserWindow, ipcMain, session, shell, dialog } = require('electron');
const Store = require('electron-store');
const axios = require('axios');
const qs = require('querystring');
const { autoUpdater } = require('electron-updater');
require('dotenv').config();
const config = require(path.join(__dirname, '../config'));
const { fork } = require("child_process");

const store = new Store();

const wsServerPath = path.join(__dirname, "server", "websocket-server.js");
const wsServer = fork(wsServerPath);


global.sharedObject = {
  env: {
    GOOGLE_CLIENT_ID: config.GOOGLE_CLIENT_ID,
    GOOGLE_REDIRECT_URI: config.GOOGLE_REDIRECT_URI,
    GOOGLE_CLIENT_SECRET: config.GOOGLE_CLIENT_SECRET
  }
};

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // ⚠️ apenas para debug/teste

let mainWindow = null;
let loginWindow = null;
let registerWindow = null;
let authWindow = null;


function closeWindow(winRef) {
  if (winRef && !winRef.isDestroyed()) winRef.close();
  return null;
}

function closeAllWindowsExcept(except) {
  if (except !== 'main') mainWindow = closeWindow(mainWindow);
  if (except !== 'login') loginWindow = closeWindow(loginWindow);
  if (except !== 'register') registerWindow = closeWindow(registerWindow);
  if (except !== 'auth') authWindow = closeWindow(authWindow);
}

function createMainWindow() {
  closeAllWindowsExcept('main');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, './assets/spaceapp.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      partition: 'persist:mainSession'
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'pages/index/index.html'));
  mainWindow.maximize();
  mainWindow.setMenu(null)
  // mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
  //   webContents.openDevTools(); // abre DevTools da webview
  // });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createLoginWindow() {
  closeAllWindowsExcept('login');
  loginWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, './assets/spaceapp.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  loginWindow.setMenu(null)
  loginWindow.loadFile(path.join(__dirname, 'pages/login/login.html'));
  loginWindow.on('closed', () => { loginWindow = null; });
}

function createRegisterWindow(userData) {
  closeAllWindowsExcept('register');
  registerWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    resizable: false,
    icon: path.join(__dirname, './assets/spaceapp.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  registerWindow.setMenu(null)
  registerWindow.loadFile(path.join(__dirname, 'pages/register/register.html'));
  registerWindow.center();
  registerWindow.webContents.on('did-finish-load', () => {
    if (userData) {
      registerWindow.webContents.send('google-user-data', userData);
    }
  });

  registerWindow.on('closed', () => { registerWindow = null; });
}

function handleLogout() {
  mainWindow = closeWindow(mainWindow);
  createLoginWindow();
}

function generateFakePassword(email) {
  return email + '_googleAuth!';
}

ipcMain.on('check-for-updates', () => {
  autoUpdater.checkForUpdates();
  autoUpdater.on('update-available', () => {
    mainWindow.webContents.send('update-available', 'Uma nova versão está disponível!');
  });
  autoUpdater.on('update-not-available', () => {
    mainWindow.webContents.send('update-not-available', `O aplicativo já está na versão ${app.getVersion()}`);
  });

  autoUpdater.on('error', (err) => {
    console.error('Erro ao verificar atualizações:', err);
    mainWindow.webContents.send('update-error', 'Erro ao verificar atualizações.');
  });
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.on('login-success', (event, token) => {
  store.set('token', token);
  loginWindow = closeWindow(loginWindow);
  createMainWindow();
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('set-token', token);
  });
});

ipcMain.on('show-register', () => createRegisterWindow());
ipcMain.on('show-login', createLoginWindow);
ipcMain.on('logout-success', handleLogout);


ipcMain.on('clear-sessions', async (event) => {
  try {
    await session.defaultSession.clearStorageData();
    event.reply('sessions-cleared', 'Sessões limpas com sucesso');
  } catch (error) {
    event.reply('sessions-cleared', 'Erro: ' + error.message);
  }
});

ipcMain.on('open-external', (event, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

ipcMain.on('start-google-login', () => {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.focus();
    return;
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${qs.stringify({
    client_id: global.sharedObject.env.GOOGLE_CLIENT_ID,
    redirect_uri: global.sharedObject.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'profile email openid',
    access_type: 'offline',
    prompt: 'consent'
  })}`;

  authWindow = new BrowserWindow({
    width: 500,
    height: 600,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  authWindow.setMenu(null)
  authWindow.loadURL(authUrl);

  authWindow.on('closed', () => {
    authWindow = null;
  });

  authWindow.webContents.on('will-redirect', async (event, url) => {
    if (url.startsWith('http://localhost')) {
      event.preventDefault();

      try {
        const code = new URL(url).searchParams.get('code');

        const tokenRes = await axios.post(
          'https://oauth2.googleapis.com/token',
          qs.stringify({
            code,
            client_id: global.sharedObject.env.GOOGLE_CLIENT_ID,
            redirect_uri: global.sharedObject.env.GOOGLE_REDIRECT_URI,
            client_secret: global.sharedObject.env.GOOGLE_CLIENT_SECRET,
            grant_type: 'authorization_code'
          }),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          }
        );

        const accessToken = tokenRes.data.access_token;
        const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        const { id: googleId, name, email } = userRes.data;
        const fakePassword = generateFakePassword(email);

        try {
          await axios.post('https://spaceapp-digital-api.onrender.com/register', {
            name,
            email,
            password: fakePassword,
            googleId
          });
        } catch (err) {
          if (err.response?.status !== 409) {
            const msg = err.response?.status === 500
              ? 'Erro ao realizar login com o Google. Tente novamente.'
              : 'Erro inesperado ao registrar com o Google.';
            
            loginWindow.webContents.executeJavaScript(`alert("${msg}");`);
            loginWindow = closeWindow(loginWindow);
            createLoginWindow();
            return;
          }
        }

        const loginRes = await axios.post('https://spaceapp-digital-api.onrender.com/login', {
          email,
          password: fakePassword
        });
        const token = loginRes.data.token;
        ipcMain.emit('login-success', null, token );

      } catch (error) {
        console.error('Erro no login com o Google:', error);
        loginWindow?.webContents.send('google-login-failed', error.message);
        loginWindow = closeWindow(loginWindow);
        createLoginWindow();
      } finally {
        authWindow = closeWindow(authWindow);
      }
    }
  });
});

app.whenReady().then(() => {
  createLoginWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

autoUpdater.on('update-available', () => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Atualização',
    message: 'Uma nova versão do SpaceApp está disponível. Ela será baixada em segundo plano.',
    buttons: ['OK']
  });
});

autoUpdater.on('update-downloaded', () => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Atualização',
    message: 'A nova versão foi baixada. O aplicativo será reiniciado para instalar a atualização.',
    buttons: ['Reiniciar agora']
  }).then(() => {
    autoUpdater.quitAndInstall(); 
  });
});