const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static('public'));

const odadakiKullanicilar = {}; 

io.on('connection', (socket) => {
  const ODA_ADI = "genel-ses-kanali";

  socket.emit('kullanici-listesi', odadakiKullanicilar);

  socket.on('kanala-katil', (kullaniciAdi) => {
    socket.join(ODA_ADI);
    odadakiKullanicilar[socket.id] = kullaniciAdi;
    socket.to(ODA_ADI).emit('yeni-kullanici-geldi', socket.id);
    io.to(ODA_ADI).emit('kullanici-listesi', odadakiKullanicilar);
  });

  socket.on('chat-mesaji', (data) => socket.to(ODA_ADI).emit('yeni-mesaj', data));
  socket.on('ses-efekti', (url) => socket.to(ODA_ADI).emit('ses-oynat', url));
  socket.on('dosya-gonder', (data) => socket.to(ODA_ADI).emit('yeni-dosya', data));
  socket.on('konusuyor-mu', (durum) => socket.to(ODA_ADI).emit('konusma-durumu-geldi', { id: socket.id, durum: durum }));

  socket.on('kontrol-iste', (data) => socket.to(data.kime).emit('kontrol-istegi-geldi', { kimden: socket.id, ad: odadakiKullanicilar[socket.id] }));
  socket.on('kontrol-cevap', (data) => socket.to(data.kime).emit('kontrol-cevabi-geldi', data));
  socket.on('fare-hareketi', (data) => socket.to(data.kime).emit('karsi-fare-hareketi', data));

  socket.on('webrtc-teklif', (data) => socket.to(data.kime).emit('webrtc-teklif-geldi', { kimden: socket.id, teklif: data.teklif }));
  socket.on('webrtc-cevap', (data) => socket.to(data.kime).emit('webrtc-cevap-geldi', { kimden: socket.id, cevap: data.cevap }));
  socket.on('ice-adayi', (data) => socket.to(data.kime).emit('ice-adayi-geldi', { kimden: socket.id, aday: data.aday }));
  socket.on('medya-durumu', (data) => socket.to(data.kime).emit('medya-durumu-geldi', data));

  socket.on('disconnect', () => {
    delete odadakiKullanicilar[socket.id];
    io.to(ODA_ADI).emit('kullanici-listesi', odadakiKullanicilar);
    socket.to(ODA_ADI).emit('kullanici-ayrildi', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Bascord Premium v10 Aktif! 🚀 Port: ${PORT}`));