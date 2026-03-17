// BASCORD v10 — index.js  (C:\Bascord\index.js)
const express    = require('express');
const app        = express();
const http       = require('http');
const server     = http.createServer(app);
const { Server } = require('socket.io');

const io = new Server(server, {
    pingTimeout: 25000, pingInterval: 10000,
    transports: ['websocket','polling'],
    maxHttpBufferSize: 5e6
});

app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ status:'ok', online: Object.keys(kullanicilar).length }));

const kullanicilar = {};
const durumlar     = {};
const streamMap    = {};   // socketId -> { mik,kam,ekrVid,ekrSes }
const dmGecmisi    = {};
const kanalGecmisi = [];

let listeTimer = null;
const listeYay = (hemen=false) => {
    clearTimeout(listeTimer);
    if (hemen) return io.emit('kullanici-listesi', { kullanicilar, durumlar });
    listeTimer = setTimeout(() => io.emit('kullanici-listesi', { kullanicilar, durumlar }), 250);
};

io.on('connection', (socket) => {
    console.log(`[+] ${socket.id.slice(0,8)}`);
    socket.emit('kullanici-listesi', { kullanicilar, durumlar });
    socket.emit('kanal-gecmisi', kanalGecmisi.slice(-50));

    socket.on('kanala-katil', (data) => {
        const isim = typeof data==='string' ? data : (data?.isim||'Anonim');
        kullanicilar[socket.id] = isim;
        durumlar[socket.id]     = { mikrofon:false, kamera:false, ekran:false, kulaklik:false, dnd:false, durum:'online' };
        streamMap[socket.id]    = {};
        socket.broadcast.emit('yeni-kullanici-geldi', { id:socket.id, ad:isim });
        listeYay(true);
    });

    socket.on('isim-degistir', (y) => { if(y?.trim()) { kullanicilar[socket.id]=y.trim(); listeYay(); } });

    socket.on('chat-mesaji', (data) => {
        const msg = { ...data, id:`${Date.now()}_${Math.random().toString(36).slice(2)}`, zaman:new Date().toISOString() };
        kanalGecmisi.push(msg); if(kanalGecmisi.length>100) kanalGecmisi.shift();
        socket.broadcast.emit('yeni-mesaj', msg);
    });

    socket.on('ses-efekti',   (u)    => socket.broadcast.emit('ses-oynat', u));
    socket.on('dosya-gonder', (d)    => socket.broadcast.emit('yeni-dosya', d));
    socket.on('yaziyor',      (d)    => socket.broadcast.emit('yaziyor-geldi', { id:socket.id, ad:kullanicilar[socket.id]||'', durum:d.durum }));
    socket.on('reaksiyon',    (d)    => socket.broadcast.emit('reaksiyon-geldi', { kimden:socket.id, ad:kullanicilar[socket.id]||'', ...d }));
    socket.on('konusuyor-mu', (d)    => socket.broadcast.emit('konusma-durumu-geldi', { id:socket.id, durum:d, ad:kullanicilar[socket.id]||'' }));
    socket.on('ping-olc',     (t)    => socket.emit('pong-olc', t));

    socket.on('durum-degistir', (y) => {
        if(!durumlar[socket.id]) return;
        if(!['online','mesgul','dnd','gorunmez'].includes(y)) return;
        durumlar[socket.id].durum = y; durumlar[socket.id].dnd = y==='dnd'; listeYay();
    });

    socket.on('dm-gonder', (d) => {
        if(!d?.kime||!d?.metin?.trim()) return;
        const key = [socket.id,d.kime].sort().join('|');
        if(!dmGecmisi[key]) dmGecmisi[key]=[];
        const msg = { kimden:socket.id, isim:kullanicilar[socket.id]||'?', metin:d.metin.trim(), zaman:new Date().toISOString() };
        dmGecmisi[key].push(msg); if(dmGecmisi[key].length>200) dmGecmisi[key].shift();
        socket.to(d.kime).emit('dm-geldi', { ...msg, key });
        socket.emit('dm-gonderildi', { ...msg, key });
    });
    socket.on('dm-gecmisi-iste', (d) => {
        if(!d?.kime) return;
        const key = [socket.id,d.kime].sort().join('|');
        socket.emit('dm-gecmisi', { key, mesajlar:dmGecmisi[key]||[] });
    });

    socket.on('kontrol-iste',  (d) => socket.to(d.kime).emit('kontrol-istegi-geldi', { kimden:socket.id, ad:kullanicilar[socket.id]||'' }));
    socket.on('kontrol-cevap', (d) => socket.to(d.kime).emit('kontrol-cevabi-geldi', { ...d, kimden:socket.id }));
    socket.on('fare-hareketi', (d) => socket.to(d.kime).emit('karsi-fare-hareketi', d));

    socket.on('webrtc-teklif', (d) => socket.to(d.kime).emit('webrtc-teklif-geldi', { kimden:socket.id, teklif:d.teklif }));
    socket.on('webrtc-cevap',  (d) => socket.to(d.kime).emit('webrtc-cevap-geldi',  { kimden:socket.id, cevap:d.cevap }));
    socket.on('ice-adayi',     (d) => socket.to(d.kime).emit('ice-adayi-geldi',      { kimden:socket.id, aday:d.aday }));

    // [FIX] Her medya tipi için ayrı streamId + trackId takibi
    socket.on('medya-durumu', (data) => {
        const d  = durumlar[socket.id]; if(!d) return;
        const sm = streamMap[socket.id] = streamMap[socket.id]||{};
        switch(data.tur) {
            case 'mik-ac':    d.mikrofon=true;  sm.mik    =data.streamId; sm.mikTrack=data.trackId; break;
            case 'mik-kap':   d.mikrofon=false; sm.mik    =null; break;
            case 'kam-ac':    d.kamera  =true;  sm.kam    =data.streamId; sm.kamTrack=data.trackId; break;
            case 'kam-kap':   d.kamera  =false; sm.kam    =null; break;
            case 'ekr-ac':    d.ekran   =true;  sm.ekrVid =data.streamId; break;
            case 'ekr-kap':   d.ekran   =false; sm.ekrVid =null; sm.ekrSes=null; break;
            case 'ekr-ses':   sm.ekrSes =data.streamId; break;
            case 'kulak-ac':  d.kulaklik=false; break;
            case 'kulak-kap': d.kulaklik=true;  break;
        }
        const payload = { kimden:socket.id, tur:data.tur, streamId:data.streamId||null, trackId:data.trackId||null, streamMap:sm, durumlar };
        if(data.broadcast) { socket.broadcast.emit('medya-durumu-geldi', payload); listeYay(); }
        else if(data.kime)  { socket.to(data.kime).emit('medya-durumu-geldi', payload); }
    });

    socket.on('disconnect', (r) => {
        console.log(`[-] ${kullanicilar[socket.id]||socket.id.slice(0,8)} (${r})`);
        delete kullanicilar[socket.id]; delete durumlar[socket.id]; delete streamMap[socket.id];
        io.emit('kullanici-ayrildi', socket.id); listeYay();
    });
});

const PORT = process.env.PORT||3000;
server.listen(PORT, () => console.log(`\n🎮 Bascord v10 | port ${PORT}\n`));
