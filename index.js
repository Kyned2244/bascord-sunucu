// ============================================================
// BASCORD v6 - index.js (Server)
// ============================================================
// [YENİ] Oda kodu sistemi — her oda ayrı, URL hash ile
// [YENİ] /health keep-alive endpoint — Render.com uyku önleme
// [DÜZ] kanala-katil → { isim, oda } objesi (v5 ile uyumlu)
// [DÜZ] Server log iyileştirildi
// ============================================================

const express = require('express');
const app     = express();
const http    = require('http');
const server  = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
    pingTimeout:  30000,
    pingInterval: 10000
});

app.use(express.static('public'));

// [YENİ] Keep-alive endpoint — Render.com ücretsiz planda 15dk sonra uyuyor
// Dışarıdan (örn: cron-job.org) her 10 dakikada bir bu endpoint'i ping edin
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        time: new Date().toISOString(),
        odalar: Object.keys(odalar).length,
        toplamKullanici: Object.values(odalar).reduce((t, o) => t + Object.keys(o.kullanicilar).length, 0)
    });
});

// ============================================================
// BÖLÜM 1: ODA YÖNETİMİ
// odalar = { odaAdi: { kullanicilar: {}, durumlar: {} } }
// ============================================================
const odalar = {};

function odayiGetirVeyaOlustur(odaAdi) {
    if (!odalar[odaAdi]) {
        odalar[odaAdi] = { kullanicilar: {}, durumlar: {} };
        console.log(`[Oda] Oluşturuldu: ${odaAdi}`);
    }
    return odalar[odaAdi];
}

function odaTemizle(odaAdi) {
    const oda = odalar[odaAdi];
    if (oda && Object.keys(oda.kullanicilar).length === 0) {
        delete odalar[odaAdi];
        console.log(`[Oda] Temizlendi: ${odaAdi}`);
    }
}

// ============================================================
// BÖLÜM 2: SOCKEt.IO OLAYLARI
// ============================================================
io.on('connection', (socket) => {
    let mevcutOda = null;
    console.log(`[Bağlantı] ${socket.id} bağlandı`);

    // Bağlanan kullanıcıya boş liste gönder (henüz odaya katılmadı)
    socket.emit('kullanici-listesi', { kullanicilar: {}, durumlar: {} });

    // --------------------------------------------------------
    // ODAYA KATIL
    // v6: { isim, oda } formatında geliyor
    // v5 geriye uyumluluk: sadece string gelirse GENEL odası
    // --------------------------------------------------------
    socket.on('kanala-katil', (data) => {
        let kullaniciAdi, odaAdi;

        if (typeof data === 'string') {
            // v5 uyumluluğu
            kullaniciAdi = data;
            odaAdi       = 'oda-GENEL';
        } else {
            kullaniciAdi = data.isim  || 'Anonim';
            odaAdi       = data.oda   || 'oda-GENEL';
        }

        // Önceki odadan çıkar
        if (mevcutOda && mevcutOda !== odaAdi) {
            _odadanCik(socket, mevcutOda);
        }

        mevcutOda = odaAdi;
        const oda = odayiGetirVeyaOlustur(odaAdi);

        socket.join(odaAdi);
        oda.kullanicilar[socket.id] = kullaniciAdi;
        oda.durumlar[socket.id]     = { mikrofon: false, kamera: false, ekran: false, kulaklik: false };

        console.log(`[Katılım] ${kullaniciAdi} → ${odaAdi} (${Object.keys(oda.kullanicilar).length} kişi)`);

        // Diğerlerine bildir
        socket.to(odaAdi).emit('yeni-kullanici-geldi', { id: socket.id, ad: kullaniciAdi });

        // Güncel listeyi herkese gönder
        io.to(odaAdi).emit('kullanici-listesi', { kullanicilar: oda.kullanicilar, durumlar: oda.durumlar });
    });

    // --------------------------------------------------------
    // İSİM DEĞİŞTİR
    // --------------------------------------------------------
    socket.on('isim-degistir', (yeniIsim) => {
        if (!yeniIsim || !yeniIsim.trim() || !mevcutOda) return;
        const oda = odalar[mevcutOda];
        if (!oda) return;
        oda.kullanicilar[socket.id] = yeniIsim.trim();
        console.log(`[İsim] ${socket.id.substring(0,6)} → ${yeniIsim}`);
        io.to(mevcutOda).emit('kullanici-listesi', { kullanicilar: oda.kullanicilar, durumlar: oda.durumlar });
    });

    // --------------------------------------------------------
    // SOHBET
    // --------------------------------------------------------
    socket.on('chat-mesaji', (data) => {
        if (!mevcutOda) return;
        socket.to(mevcutOda).emit('yeni-mesaj', data);
    });
    socket.on('ses-efekti', (url) => {
        if (!mevcutOda) return;
        socket.to(mevcutOda).emit('ses-oynat', url);
    });
    socket.on('dosya-gonder', (data) => {
        if (!mevcutOda) return;
        socket.to(mevcutOda).emit('yeni-dosya', data);
    });

    // --------------------------------------------------------
    // KONUŞMA DURUMU
    // --------------------------------------------------------
    socket.on('konusuyor-mu', (durum) => {
        if (!mevcutOda) return;
        const oda = odalar[mevcutOda];
        if (!oda) return;
        socket.to(mevcutOda).emit('konusma-durumu-geldi', {
            id:    socket.id,
            durum: durum,
            ad:    oda.kullanicilar[socket.id]
        });
    });

    // --------------------------------------------------------
    // UZAKTAN KONTROL
    // --------------------------------------------------------
    socket.on('kontrol-iste', (data) => {
        if (!mevcutOda) return;
        const oda = odalar[mevcutOda];
        socket.to(data.kime).emit('kontrol-istegi-geldi', {
            kimden: socket.id,
            ad:     oda?.kullanicilar[socket.id] || 'Kullanıcı'
        });
    });
    socket.on('kontrol-cevap',  (data) => socket.to(data.kime).emit('kontrol-cevabi-geldi',  { ...data, kimden: socket.id }));
    socket.on('fare-hareketi',  (data) => socket.to(data.kime).emit('karsi-fare-hareketi',    data));

    // --------------------------------------------------------
    // WEBRTC SİNYALİZASYON
    // --------------------------------------------------------
    socket.on('webrtc-teklif', (data) => {
        socket.to(data.kime).emit('webrtc-teklif-geldi', { kimden: socket.id, teklif: data.teklif });
    });
    socket.on('webrtc-cevap', (data) => {
        socket.to(data.kime).emit('webrtc-cevap-geldi',  { kimden: socket.id, cevap: data.cevap });
    });
    socket.on('ice-adayi', (data) => {
        socket.to(data.kime).emit('ice-adayi-geldi', { kimden: socket.id, aday: data.aday });
    });

    // --------------------------------------------------------
    // MEDYA DURUM YÖNETİMİ
    // --------------------------------------------------------
    socket.on('medya-durumu', (data) => {
        if (!mevcutOda) return;
        const oda = odalar[mevcutOda];
        if (!oda) return;

        const d = oda.durumlar[socket.id];
        if (d) {
            if (data.tur === 'mik-ac')    d.mikrofon = true;
            if (data.tur === 'mik-kap')   d.mikrofon = false;
            if (data.tur === 'kam-ac')    d.kamera   = true;
            if (data.tur === 'kam-kap')   d.kamera   = false;
            if (data.tur === 'ekr-ac')    d.ekran    = true;
            if (data.tur === 'ekr-kap')   d.ekran    = false;
            if (data.tur === 'kulak-ac')  d.kulaklik = false;
            if (data.tur === 'kulak-kap') d.kulaklik = true;
        }

        const payload = {
            kimden:   socket.id,
            tur:      data.tur,
            streamId: data.id || null,
            durumlar: oda.durumlar
        };

        if (data.broadcast) {
            socket.to(mevcutOda).emit('medya-durumu-geldi', payload);
            io.to(mevcutOda).emit('kullanici-listesi', { kullanicilar: oda.kullanicilar, durumlar: oda.durumlar });
        } else if (data.kime) {
            socket.to(data.kime).emit('medya-durumu-geldi', payload);
        }
    });

    // --------------------------------------------------------
    // BAĞLANTI KESİLDİ
    // --------------------------------------------------------
    socket.on('disconnect', (reason) => {
        console.log(`[Ayrıldı] ${socket.id.substring(0,6)} — ${reason}`);
        if (mevcutOda) {
            _odadanCik(socket, mevcutOda);
        }
    });

    function _odadanCik(sock, odaAdi) {
        const oda = odalar[odaAdi];
        if (!oda) return;
        delete oda.kullanicilar[sock.id];
        delete oda.durumlar[sock.id];
        io.to(odaAdi).emit('kullanici-ayrildi', sock.id);
        io.to(odaAdi).emit('kullanici-listesi', { kullanicilar: oda.kullanicilar, durumlar: oda.durumlar });
        odaTemizle(odaAdi);
        mevcutOda = null;
    }
});

// ============================================================
// BÖLÜM 3: SUNUCU BAŞLAT
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🎮 Bascord v6 aktif! Port: ${PORT}`);
    console.log(`📡 Keep-alive: GET /health`);
    console.log(`🔗 Oda sistemi: URL#ODAKODU ile bağlanın\n`);
});