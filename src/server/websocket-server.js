const { Server } = require("socket.io");
const http = require("http");

const server = http.createServer(); // pode trocar por seu app Express se usar um
const io = new Server(server, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("Usuário conectado:", socket.id);

  // Simulação: envia notificação a cada 10s
  setInterval(() => {
    socket.emit("notification", {
      title: "Nova notificação",
      body: "Mensagem recebida da aplicação",
    });
  }, 10000);
});

server.listen(3001, () => console.log("Servidor WebSocket (socket.io) ouvindo na porta 3001"));
