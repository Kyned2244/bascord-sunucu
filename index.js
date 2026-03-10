const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static('public'));

const ODA_ADI = "genel-ses-kanali";
const odadakiKullanicilar = {}; 
const kullaniciDurumlari = {}; // YENİ: { socketId: { mikrofon, kamera, ekran, kulaklik } }

io.on('connection', (socket) => {

  // Odaya yeni biri katıldığında
  socket.on('kanala-katil', (kullaniciAdi) => {
    socket.join(ODA_ADI);
    odadakiKullanicilar[socket.id] = kullaniciAdi;
    kullaniciDurumlari[socket.id] = { mikrofon: false, kamera: false, ekran: false, kulaklik: false };
    
    // YENİ: Sadece bir kişiye değil, odadaki HERKESE yeni kullanıcının geldiğini bildir
    socket.to(ODA_ADI).emit('yeni-kullanici-geldi', { id: socket.id, ad: kullaniciAdi });
    
    // Tüm listeyi ve güncel durum ikonlarını herkese gönder
    io.to(ODA_ADI).emit('kullanici-listesi', { kullanicilar: odadakiKullanicilar, durumlar: kullaniciDurumlari });
  });

  socket.on('chat-mesaji', (data) => socket.to(ODA_ADI).emit('yeni-mesaj', data));
  socket.on('ses-efekti', (url) => socket.to(ODA_ADI).emit('ses-oynat', url));
  socket.on('dosya-gonder', (data) => socket.to(ODA_ADI).emit('yeni-dosya', data));
  
  // BUGFIX: Konuşma durumunu odaya broadcast yapıyoruz
  socket.on('konusuyor-mu', (durum) => {
      socket.to(ODA_ADI).emit('konusma-durumu-geldi', { id: socket.id, durum: durum, ad: odadakiKullanicilar[socket.id] });
  });

  // TEAMS: Uzaktan Kontrol
  socket.on('kontrol-iste', (data) => socket.to(data.kime).emit('kontrol-istegi-geldi', { kimden: socket.id, ad: odadakiKullanicilar[socket.id] }));
  socket.on('kontrol-cevap', (data) => socket.to(data.kime).emit('kontrol-cevabi-geldi', data));
  socket.on('fare-hareketi', (data) => socket.to(data.kime).emit('karsi-fare-hareketi', data));

  // MULTI-USER WEBRTC SİNYALİZASYONU
  socket.on('webrtc-teklif', (data) => socket.to(data.kime).emit('webrtc-teklif-geldi', { kimden: socket.id, teklif: data.teklif }));
  socket.on('webrtc-cevap', (data) => socket.to(data.kime).emit('webrtc-cevap-geldi', { kimden: socket.id, cevap: data.cevap }));
  socket.on('ice-adayi', (data) => socket.to(data.kime).emit('ice-adayi-geldi', { kimden: socket.id, aday: data.aday }));

  // YENİ: Medya Durum Yönetimi (İkonlar İçin)
  socket.on('medya-durumu', (data) => {
    if (kullaniciDurumlari[socket.id]) {
        if (data.tur === 'mik-ac') kullaniciDurumlari[socket.id].mikrofon = true;
        if (data.tur === 'mik-kap') kullaniciDurumlari[socket.id].mikrofon = false;
        if (data.tur === 'kam-ac') kullaniciDurumlari[socket.id].kamera = true;
        if (data.tur === 'kam-kap') kullaniciDurumlari[socket.id].kamera = false;
        if (data.tur === 'ekr-ac') kullaniciDurumlari[socket.id].ekran = true;
        if (data.tur === 'ekr-kap') kullaniciDurumlari[socket.id].ekran = false;
        if (data.tur === 'kulak-ac') kullaniciDurumlari[socket.id].kulaklik = false;
        if (data.tur === 'kulak-kap') kullaniciDurumlari[socket.id].kulaklik = true;
    }

    if (data.broadcast) {
        socket.to(ODA_ADI).emit('medya-durumu-geldi', { kimden: socket.id, tur: data.tur, streamId: data.id, durumlar: kullaniciDurumlari });
    } else if (data.kime) {
        socket.to(data.kime).emit('medya-durumu-geldi', { kimden: socket.id, tur: data.tur, streamId: data.id });
    }
  });

  socket.on('disconnect', () => {
    delete odadakiKullanicilar[socket.id];
    delete kullaniciDurumlari[socket.id];
    io.to(ODA_ADI).emit('kullanici-ayrildi', socket.id);
    io.to(ODA_ADI).emit('kullanici-listesi', { kullanicilar: odadakiKullanicilar, durumlar: kullaniciDurumlari });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor`));