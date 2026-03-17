// ============================================================
// BASCORD v9 — index.js (Server) @ C:\Bascord\index.js
// ============================================================
const express    = require('express');
const app        = express();
const http       = require('http');
const server     = http.createServer(app);
const { Server } = require('socket.io');

const io = new Server(server, {
    pingTimeout:  20000,
    pingInterval: 8000,
    transports:   ['websocket', 'polling']
});

app.use(express.static('public'));

app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), kullanicilar: Object.keys(kullanicilar).length });
});

// ── GLOBAL STATE ─────────────────────────────────────────────
const kullanicilar = {};
const durumlar     = {};
const dmGecmisi    = {};     // "id1-id2" -> [mesajlar]
const mesajGecmisi = [];     // Genel kanal geçmişi (son 100)

// Debounce: hızlı ard arda emit'leri birleştir
let listeEmitTimer = null;
function debouncedListeEmit(ms = 300) {
    clearTimeout(listeEmitTimer);
    listeEmitTimer = setTimeout(() => {
        io.emit('kullanici-listesi', { kullanicilar, durumlar });
    }, ms);
}

// ── SOCKET EVENTS ─────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[+] ${socket.id.substring(0,8)} bağlandı`);
    socket.emit('kullanici-listesi', { kullanicilar, durumlar });
    // Yeni bağlanan kişiye genel kanal geçmişini gönder
    socket.emit('kanal-gecmisi', mesajGecmisi.slice(-50));

    // ── Kanala Katıl ──────────────────────────────────────────
    socket.on('kanala-katil', (data) => {
        const isim = (typeof data === 'string') ? data : (data?.isim || 'Anonim');
        kullanicilar[socket.id] = isim;
        durumlar[socket.id] = {
            mikrofon: false, kamera: false, ekran: false,
            kulaklik: false, dnd: false, durum: 'online'
        };
        console.log(`[>] ${isim} katıldı (${Object.keys(kullanicilar).length} kişi)`);
        socket.broadcast.emit('yeni-kullanici-geldi', { id: socket.id, ad: isim });
        io.emit('kullanici-listesi', { kullanicilar, durumlar });
    });

    socket.on('isim-degistir', (yeniIsim) => {
        if (!yeniIsim?.trim()) return;
        kullanicilar[socket.id] = yeniIsim.trim();
        debouncedListeEmit(100);
    });

    // ── Chat & Dosya ──────────────────────────────────────────
    socket.on('chat-mesaji', (data) => {
        const msg = { ...data, zaman: new Date().toISOString(), id: Date.now() + Math.random() };
        mesajGecmisi.push(msg);
        if (mesajGecmisi.length > 100) mesajGecmisi.shift();
        socket.broadcast.emit('yeni-mesaj', msg);
    });

    socket.on('ses-efekti',   (url)  => socket.broadcast.emit('ses-oynat',   url));
    socket.on('dosya-gonder', (data) => socket.broadcast.emit('yeni-dosya',  data));

    // ── DM ─────────────────────────────────────────────────────
    socket.on('dm-gonder', (data) => {
        if (!data?.kime || !data?.metin?.trim()) return;
        const odaKey = [socket.id, data.kime].sort().join('-');
        if (!dmGecmisi[odaKey]) dmGecmisi[odaKey] = [];
        const msg = {
            kimden: socket.id,
            isim:   kullanicilar[socket.id] || 'Bilinmiyor',
            metin:  data.metin.trim(),
            zaman:  new Date().toISOString()
        };
        dmGecmisi[odaKey].push(msg);
        if (dmGecmisi[odaKey].length > 200) dmGecmisi[odaKey].shift();
        socket.to(data.kime).emit('dm-geldi', { ...msg, odaKey });
        socket.emit('dm-gonderildi', { ...msg, odaKey });
    });

    socket.on('dm-gecmisi-iste', (data) => {
        if (!data?.kime) return;
        const odaKey = [socket.id, data.kime].sort().join('-');
        socket.emit('dm-gecmisi', { odaKey, mesajlar: dmGecmisi[odaKey] || [] });
    });

    // ── Emoji Tepki ────────────────────────────────────────────
    socket.on('reaksiyon', (data) => {
        socket.broadcast.emit('reaksiyon-geldi', {
            kimden: socket.id, ad: kullanicilar[socket.id] || '', ...data
        });
    });

    // ── Ping ───────────────────────────────────────────────────
    socket.on('ping-olc', (t) => socket.emit('pong-olc', t));

    // ── Yazıyor göstergesi ─────────────────────────────────────
    socket.on('yaziyor', (data) => {
        socket.broadcast.emit('yaziyor-geldi', { id: socket.id, ad: kullanicilar[socket.id] || '', durum: data.durum });
    });

    // ── Konuşma ────────────────────────────────────────────────
    socket.on('konusuyor-mu', (durum) => {
        socket.broadcast.emit('konusma-durumu-geldi', {
            id: socket.id, durum, ad: kullanicilar[socket.id] || ''
        });
    });

    // ── Kullanıcı Durumu ───────────────────────────────────────
    socket.on('durum-degistir', (yeniDurum) => {
        if (!durumlar[socket.id]) return;
        const gecerli = ['online', 'mesgul', 'dnd', 'gorunmez'];
        if (!gecerli.includes(yeniDurum)) return;
        durumlar[socket.id].durum = yeniDurum;
        durumlar[socket.id].dnd  = (yeniDurum === 'dnd');
        debouncedListeEmit(200);
    });

    // ── Kontrol ────────────────────────────────────────────────
    socket.on('kontrol-iste',  (d) => socket.to(d.kime).emit('kontrol-istegi-geldi', { kimden: socket.id, ad: kullanicilar[socket.id] || 'Kullanıcı' }));
    socket.on('kontrol-cevap', (d) => socket.to(d.kime).emit('kontrol-cevabi-geldi', { ...d, kimden: socket.id }));
    socket.on('fare-hareketi', (d) => socket.to(d.kime).emit('karsi-fare-hareketi',  d));

    // ── WebRTC ─────────────────────────────────────────────────
    socket.on('webrtc-teklif', (d) => socket.to(d.kime).emit('webrtc-teklif-geldi', { kimden: socket.id, teklif: d.teklif }));
    socket.on('webrtc-cevap',  (d) => socket.to(d.kime).emit('webrtc-cevap-geldi',  { kimden: socket.id, cevap:  d.cevap  }));
    socket.on('ice-adayi',     (d) => socket.to(d.kime).emit('ice-adayi-geldi',     { kimden: socket.id, aday:   d.aday   }));

    // ── Medya Durumu ───────────────────────────────────────────
    socket.on('medya-durumu', (data) => {
        const d = durumlar[socket.id];
        if (!d) return;
        switch (data.tur) {
            case 'mik-ac':    d.mikrofon = true;  break;
            case 'mik-kap':   d.mikrofon = false; break;
            case 'kam-ac':    d.kamera   = true;  break;
            case 'kam-kap':   d.kamera   = false; break;
            case 'ekr-ac':    d.ekran    = true;  break;
            case 'ekr-kap':   d.ekran    = false; break;
            case 'kulak-ac':  d.kulaklik = false; break;
            case 'kulak-kap': d.kulaklik = true;  break;
        }
        const payload = { kimden: socket.id, tur: data.tur, streamId: data.id || null, durumlar };
        if (data.broadcast) {
            socket.broadcast.emit('medya-durumu-geldi', payload);
            debouncedListeEmit(300);
        } else if (data.kime) {
            socket.to(data.kime).emit('medya-durumu-geldi', payload);
        }
    });

    // ── Ayrılma ────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
        const isim = kullanicilar[socket.id] || socket.id.substring(0,8);
        console.log(`[-] ${isim} ayrıldı — ${reason}`);
        delete kullanicilar[socket.id];
        delete durumlar[socket.id];
        io.emit('kullanici-ayrildi', socket.id);
        debouncedListeEmit(100);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n🎮 Bascord v9 — port ${PORT}\n`));
