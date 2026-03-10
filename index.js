const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static('public'));

const ODA_ADI = "genel-ses-kanali";
const odadakiKullanicilar = {};
const kullaniciDurumlari = {}; // { socketId: { mikrofon, kamera, ekran, kulaklik } }

io.on('connection', (socket) => {

    // Bağlanan kullanıcıya mevcut listeyi gönder (odaya katılmadan önce)
    socket.emit('kullanici-listesi', { kullanicilar: odadakiKullanicilar, durumlar: kullaniciDurumlari });

    // --- ODAYA KATILIM ---
    socket.on('kanala-katil', (kullaniciAdi) => {
        socket.join(ODA_ADI);
        odadakiKullanicilar[socket.id] = kullaniciAdi;
        kullaniciDurumlari[socket.id] = { mikrofon: false, kamera: false, ekran: false, kulaklik: false };

        // Odadaki herkese yeni kullanıcının geldiğini bildir
        socket.to(ODA_ADI).emit('yeni-kullanici-geldi', { id: socket.id, ad: kullaniciAdi });

        // Güncel listeyi herkese gönder
        io.to(ODA_ADI).emit('kullanici-listesi', { kullanicilar: odadakiKullanicilar, durumlar: kullaniciDurumlari });
    });

    // --- İSİM DEĞİŞTİRME (reload olmadan) ---
    socket.on('isim-degistir', (yeniIsim) => {
        if (yeniIsim && yeniIsim.trim() !== '') {
            odadakiKullanicilar[socket.id] = yeniIsim.trim();
            io.to(ODA_ADI).emit('kullanici-listesi', { kullanicilar: odadakiKullanicilar, durumlar: kullaniciDurumlari });
        }
    });

    // --- SOHBET ---
    socket.on('chat-mesaji', (data) => socket.to(ODA_ADI).emit('yeni-mesaj', data));
    socket.on('ses-efekti', (url) => socket.to(ODA_ADI).emit('ses-oynat', url));
    socket.on('dosya-gonder', (data) => socket.to(ODA_ADI).emit('yeni-dosya', data));

    // --- KONUŞMA DURUMU (tüm odaya broadcast) ---
    socket.on('konusuyor-mu', (durum) => {
        socket.to(ODA_ADI).emit('konusma-durumu-geldi', {
            id: socket.id,
            durum: durum,
            ad: odadakiKullanicilar[socket.id]
        });
    });

    // --- UZAKTAN KONTROL ---
    socket.on('kontrol-iste', (data) => {
        socket.to(data.kime).emit('kontrol-istegi-geldi', {
            kimden: socket.id,
            ad: odadakiKullanicilar[socket.id]
        });
    });
    socket.on('kontrol-cevap', (data) => socket.to(data.kime).emit('kontrol-cevabi-geldi', { ...data, kimden: socket.id }));
    socket.on('fare-hareketi', (data) => socket.to(data.kime).emit('karsi-fare-hareketi', data));

    // --- WEBRTC SİNYALİZASYON (MULTI-USER) ---
    socket.on('webrtc-teklif', (data) => {
        socket.to(data.kime).emit('webrtc-teklif-geldi', { kimden: socket.id, teklif: data.teklif });
    });
    socket.on('webrtc-cevap', (data) => {
        socket.to(data.kime).emit('webrtc-cevap-geldi', { kimden: socket.id, cevap: data.cevap });
    });
    socket.on('ice-adayi', (data) => {
        socket.to(data.kime).emit('ice-adayi-geldi', { kimden: socket.id, aday: data.aday });
    });

    // --- MEDYA DURUM YÖNETİMİ ---
    socket.on('medya-durumu', (data) => {
        if (kullaniciDurumlari[socket.id]) {
            if (data.tur === 'mik-ac')      kullaniciDurumlari[socket.id].mikrofon = true;
            if (data.tur === 'mik-kap')     kullaniciDurumlari[socket.id].mikrofon = false;
            if (data.tur === 'kam-ac')      kullaniciDurumlari[socket.id].kamera = true;
            if (data.tur === 'kam-kap')     kullaniciDurumlari[socket.id].kamera = false;
            if (data.tur === 'ekr-ac')      kullaniciDurumlari[socket.id].ekran = true;
            if (data.tur === 'ekr-kap')     kullaniciDurumlari[socket.id].ekran = false;
            if (data.tur === 'kulak-ac')    kullaniciDurumlari[socket.id].kulaklik = false;
            if (data.tur === 'kulak-kap')   kullaniciDurumlari[socket.id].kulaklik = true;
        }

        if (data.broadcast) {
            // Tüm odaya yayınla + listeyi güncelle
            socket.to(ODA_ADI).emit('medya-durumu-geldi', {
                kimden: socket.id,
                tur: data.tur,
                streamId: data.id,
                durumlar: kullaniciDurumlari
            });
            // Durum ikonlarını güncellemek için listeyi de yenile
            io.to(ODA_ADI).emit('kullanici-listesi', { kullanicilar: odadakiKullanicilar, durumlar: kullaniciDurumlari });
        } else if (data.kime) {
            socket.to(data.kime).emit('medya-durumu-geldi', {
                kimden: socket.id,
                tur: data.tur,
                streamId: data.id
            });
        }
    });

    // --- BAĞLANTI KESİLDİ ---
    socket.on('disconnect', () => {
        delete odadakiKullanicilar[socket.id];
        delete kullaniciDurumlari[socket.id];
        io.to(ODA_ADI).emit('kullanici-ayrildi', socket.id);
        io.to(ODA_ADI).emit('kullanici-listesi', { kullanicilar: odadakiKullanicilar, durumlar: kullaniciDurumlari });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Bascord v3 aktif! Port: ${PORT}`));