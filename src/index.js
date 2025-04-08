const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const axios = require('axios');
const qs = require('querystring');
require('dotenv').config();

const store = new Store();

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
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: 'http://localhost',
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
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: 'http://localhost',
            grant_type: 'authorization_code'
          }),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          }
        );

        const accessToken = tokenRes.data.access_token;
        const idToken = tokenRes.data.id_token;
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
        ipcMain.emit('login-success', null, token);

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
