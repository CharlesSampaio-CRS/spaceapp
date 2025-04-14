const { io } = require("socket.io-client");

let currentFavicon = null;
const webview = document.getElementById("webview");

// Captura o favicon da webview
webview.addEventListener("page-favicon-updated", (event) => {
  if (event.favicons && event.favicons.length > 0) {
    currentFavicon = event.favicons[0];
    console.log("Favicon capturado:", currentFavicon);
  }
});

// Requisição de permissão de notificação
if (Notification.permission !== "granted") {
  Notification.requestPermission();
}

// Conexão com o servidor socket.io
const socket = io("http://localhost:3001");

socket.on("connect", () => {
  console.log("Conectado ao servidor de notificações", socket.id);
});

socket.on("notification", (data) => {
  console.log("Notificação recebida:", data);

  // Captura o nome da webview
  const webviewName = webview.getAttribute("data-name");

  // Exibe a notificação
  new Notification(`${data.title} - ${webviewName}`, {
    body: data.body,
    icon: currentFavicon || "../src/assets/spaceaap.png", // Ícone personalizado
  });
});
