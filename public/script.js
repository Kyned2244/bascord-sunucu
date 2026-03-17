// ============================================================
// BASCORD v9 — script.js  @ C:\Bascord\public\script.js
// ============================================================

const socket = io({ reconnection: true, reconnectionAttempts: Infinity });

// ── 1. GLOBALS ───────────────────────────────────────────────
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

let peerConnections    = {};
let beklemedekiYayinlar = {};
let sonGelenStream      = {};
let globalAudioCtx      = null;

let kameraYayini   = null;
let ekranYayini    = null;
let mikrofonYayini = null;
let onKameraMi     = true;

let isPttActive    = false;
let isPttKeyPressed = false;
let isDeafened     = false;
let wasMicEnabledBeforeDeafen = false;

let okunmamisMesajSayisi = 0;
let dmUnreadCount        = 0;
let aktifDmKisiId        = null;
let dmMesajlariCache     = {};
let dmKullanicilarCache  = {};
let benimDurumum         = 'online';

let testMeterStream   = null;
let testMeterInterval = null;
let yaziyorTimer      = null;
let sonMesajIsim      = null;  // Mesaj gruplama için

let seciliMikrofon = localStorage.getItem('bascord_mic') || 'default';
let seciliKamera   = localStorage.getItem('bascord_cam') || 'default';

// ── 2. KULLANICI ADIN ────────────────────────────────────────
let kullaniciAdi = localStorage.getItem('bascord_isim');
if (!kullaniciAdi) {
    try { kullaniciAdi = prompt("Bascord'a hoş geldin! İsmini belirle:") || "Anonim"; }
    catch (e) { kullaniciAdi = "Gamer_" + Math.floor(Math.random() * 1000); }
    localStorage.setItem('bascord_isim', kullaniciAdi);
}
document.getElementById('benimAdimGosterge').innerText = kullaniciAdi;
document.getElementById('benimAvatarim').innerText = kullaniciAdi.charAt(0).toUpperCase();

// ── 3. HTML SEÇİCİLER ────────────────────────────────────────
const kanalaKatilBtn = document.getElementById('kanalaKatilBtn');
const mikrofonBtn    = document.getElementById('mikrofonBtn');
const kulaklikBtn    = document.getElementById('kulaklikBtn');
const kameraBtn      = document.getElementById('kameraBtn');
const kameraCevirBtn = document.getElementById('kameraCevirBtn');
const ekranBtn       = document.getElementById('ekranBtn');
const pttToggleBtn   = document.getElementById('pttToggleBtn');
const gamerModBtn    = document.getElementById('gamerModBtn');
const mesajKutusu    = document.getElementById('mesajKutusu');
const mesajGonderBtn = document.getElementById('mesajGonderBtn');
const mesajGecmisi   = document.getElementById('mesajGecmisi');
const dosyaSecici    = document.getElementById('dosyaSecici');

// ICE konfigürasyonu
const stunSunuculari = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
};

// ── 4. TOAST ─────────────────────────────────────────────────
function showToast(mesaj, tur = 'basari') {
    const container = document.getElementById('toast-container');
    const toast     = document.createElement('div');
    toast.className = 'toast' + (tur !== 'basari' ? ' ' + tur : '');
    const ikonMap   = { basari: 'fa-check-circle', uyari: 'fa-exclamation-triangle', hata: 'fa-times-circle', bilgi: 'fa-info-circle' };
    toast.innerHTML = `<i class="fas ${ikonMap[tur] || 'fa-bell'}"></i> ${mesaj}`;
    container.appendChild(toast);
    setTimeout(() => { if (container.contains(toast)) container.removeChild(toast); }, 3500);
}

// ── 5. EMOJİ ─────────────────────────────────────────────────
const EMOJILER = ['😀','😂','😍','😎','😢','😡','👍','👎','🔥','🎉','❤️','🤔','🙄','😴','😷','👽','🤖','👻','💩','👀','🎮','💯','✨','🏆','💪'];
const emojiPanel = document.getElementById('emojiPickerPanel');
EMOJILER.forEach(emo => {
    const btn   = document.createElement('button');
    btn.className = 'emoji-btn';
    btn.innerText = emo;
    btn.onclick   = () => { mesajKutusu.value += emo; emojiPanel.style.display = 'none'; mesajKutusu.focus(); };
    emojiPanel.appendChild(btn);
});
document.getElementById('emojiAcBtn').onclick = () =>
    emojiPanel.style.display = emojiPanel.style.display === 'grid' ? 'none' : 'grid';
document.addEventListener('click', (e) => {
    if (!e.target.closest('.chat-input-area') && !e.target.closest('.emoji-picker')) emojiPanel.style.display = 'none';
});

// ── 6. CHAT SEKMELERİ ────────────────────────────────────────
window.chatSekmeDegistir = function(sekme) {
    document.getElementById('genelChatPanel').style.display = sekme === 'genel' ? 'flex' : 'none';
    document.getElementById('dmChatPanel').style.display    = sekme === 'dm'    ? 'flex' : 'none';
    document.getElementById('sekme-genel').classList.toggle('aktif', sekme === 'genel');
    document.getElementById('sekme-dm').classList.toggle('aktif',    sekme === 'dm');
    if (sekme === 'dm') {
        dmUnreadCount = 0;
        const b = document.getElementById('dmUnreadBadge');
        b.style.display = 'none';
        dmKisiListesiniGuncelle();
    }
};

// ── 7. PİNG & KALİTE ─────────────────────────────────────────
function pingSolc() { socket.emit('ping-olc', Date.now()); }
socket.on('pong-olc', (t) => {
    const ms    = Date.now() - t;
    const badge = document.getElementById('pingMs');
    const cubuk = document.getElementById('kaliteCubuk');
    const kap   = document.getElementById('pingGosterge');
    badge.innerText  = ms + 'ms';
    badge.className  = 'ping-badge ' + (ms < 80 ? 'ping-iyi' : ms < 200 ? 'ping-orta' : 'ping-kotu');
    cubuk.className  = 'kalite-cubuk ' + (ms < 80 ? 'kalite-iyi' : ms < 200 ? 'kalite-orta' : 'kalite-kotu');
});
setInterval(pingSolc, 5000);

// ── 8. VİDEO WRAPPER ─────────────────────────────────────────
window.tamEkranYap = function(videoId) {
    const el = document.getElementById(videoId);
    if (!el) return;
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
};

function getOrCreateVideoWrapper(kullaniciId, tip, isim) {
    const wrapperId = `kutu-${kullaniciId}-${tip}`;
    let el = document.getElementById(wrapperId);
    if (!el) {
        el = document.createElement('div');
        el.className = 'video-wrapper';
        el.id        = wrapperId;
        const videoId   = `vid-${kullaniciId}-${tip}`;
        const isMuted   = kullaniciId === 'yerel' ? 'muted' : '';
        const flipStyle = tip === 'kamera' ? 'transform:scaleX(-1);' : '';
        const label     = kullaniciId === 'yerel'
            ? (tip === 'ekran' ? 'Senin Ekranın' : 'Sen')
            : `${isim} ${tip === 'ekran' ? 'Ekranı' : ''}`;

        const kontrolHtml = tip === 'ekran' && kullaniciId !== 'yerel' && !isMobile
            ? `<button class="overlay-btn" id="kontrolBtn-${kullaniciId}" style="background:var(--renk-basari);" onclick="kontrolIstegiYolla('${kullaniciId}')"><i class="fas fa-hand-pointer"></i> Kontrol Et</button>` : '';

        el.innerHTML = `
            <video id="${videoId}" autoplay playsinline ${isMuted} style="width:100%;height:100%;object-fit:contain;${flipStyle}"></video>
            <div class="video-label">${label}</div>
            <div class="video-overlay">
                ${kontrolHtml}
                <button class="overlay-btn" onclick="tamEkranYap('${videoId}')"><i class="fas fa-expand"></i> Büyüt</button>
            </div>
            <div class="ses-seviyesi-bar" id="bar-${kullaniciId}-${tip}"></div>
        `;
        document.getElementById('mainVideoGrid').appendChild(el);

        if (tip === 'ekran' && kullaniciId !== 'yerel' && !isMobile) {
            el.querySelector('video').addEventListener('click', (e) => {
                const v = e.currentTarget;
                if (v.getAttribute('data-kontrol-aktif') !== 'true') return;
                const r  = v.getBoundingClientRect();
                socket.emit('fare-hareketi', {
                    kime: kullaniciId,
                    x: ((e.clientX - r.left) / r.width) * 100,
                    y: ((e.clientY - r.top)  / r.height) * 100
                });
            });
        }
    }
    return el;
}

// ── 9. KONTROL ───────────────────────────────────────────────
window.kontrolIstegiYolla = function(kimeId) {
    socket.emit('kontrol-iste', { kime: kimeId });
    const btn = document.getElementById(`kontrolBtn-${kimeId}`);
    if (btn) { btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Bekleniyor..."; btn.disabled = true; }
};
socket.on('kontrol-istegi-geldi', (data) => {
    const onay = confirm(`⚠️ ${data.ad} ekranınızı kontrol etmek istiyor. İzin veriyor musunuz?`);
    socket.emit('kontrol-cevap', { kime: data.kimden, onay });
});
socket.on('kontrol-cevabi-geldi', (data) => {
    const btn = document.getElementById(`kontrolBtn-${data.kimden}`);
    const vid = document.getElementById(`vid-${data.kimden}-ekran`);
    if (data.onay) {
        if (btn) { btn.innerHTML = "<i class='fas fa-check-circle'></i> Kontrol Aktif"; btn.style.background = "var(--renk-tehlike)"; }
        if (vid) vid.setAttribute('data-kontrol-aktif', 'true');
    } else {
        if (btn) { btn.innerHTML = "<i class='fas fa-hand-pointer'></i> Kontrol Et"; btn.disabled = false; }
    }
});
socket.on('karsi-fare-hareketi', (data) => {
    const lazer = document.getElementById('remote-pointer');
    lazer.style.cssText = `display:block; left:${data.x}%; top:${data.y}%;`;
    setTimeout(() => { lazer.style.display = 'none'; }, 2000);
});

// ── 10. SES ANALİZİ ──────────────────────────────────────────
function sesAnaliziniBaslat(stream, wrapperId, isLocal = false) {
    try {
        if (!globalAudioCtx) globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (globalAudioCtx.state === 'suspended') globalAudioCtx.resume();
        const kaynak  = globalAudioCtx.createMediaStreamSource(stream);
        const analiz  = globalAudioCtx.createAnalyser();
        analiz.fftSize = 256;
        kaynak.connect(analiz);
        const veri = new Uint8Array(analiz.frequencyBinCount);
        let son = false;
        setInterval(() => {
            const bar = document.getElementById(`bar-${wrapperId}`);
            if (!stream.active || !stream.getAudioTracks()[0]?.enabled) {
                if (bar) bar.style.width = '0%';
                if (isLocal && son) { socket.emit('konusuyor-mu', false); son = false; }
                return;
            }
            analiz.getByteFrequencyData(veri);
            const ort = veri.reduce((a, b) => a + b, 0) / veri.length;
            if (bar) bar.style.width = Math.min(100, ort) + '%';
            if (isLocal) {
                const k = ort > 30;
                if (k !== son) { son = k; socket.emit('konusuyor-mu', k); parlamayiAyarla(socket.id, k); }
            }
        }, 150);
    } catch (e) { console.warn('Ses analizi hatası:', e); }
}

function parlamayiAyarla(id, durum) {
    const av = document.getElementById(`av-${id}`);
    const vw = document.getElementById(`kutu-${id}-kamera`);
    if (av) durum ? av.classList.add('speaking') : av.classList.remove('speaking');
    if (vw) durum ? vw.classList.add('speaking-border') : vw.classList.remove('speaking-border');
}

socket.on('konusma-durumu-geldi', (data) => {
    parlamayiAyarla(data.id, data.durum);
    const info = document.getElementById('aktifKonusanInfo');
    if (data.durum) info.innerHTML = `🎤 ${data.ad} konuşuyor`;
    else if (info.innerHTML.includes(data.ad)) info.innerHTML = '';
});

// ── 11. WEBRTC ───────────────────────────────────────────────
function trackleriEkle(track, stream) {
    Object.keys(peerConnections).forEach(id => {
        try {
            const pc  = peerConnections[id];
            const s   = pc.getSenders().find(x => x.track?.kind === track.kind);
            if (s) s.replaceTrack(track).catch(e => console.warn('replaceTrack:', e));
            else   pc.addTrack(track, stream);
        } catch (e) { console.warn('trackleriEkle:', e); }
    });
}

// [FIX-SES] Stream eşleştirme: önce streamId, sonra fallback
function remoteYayinEkle(streamId, id, tur) {
    const stream = beklemedekiYayinlar[streamId] || sonGelenStream[id];
    if (!stream) {
        setTimeout(() => remoteYayinEkle(streamId, id, tur), 600);
        return;
    }
    try {
        if (tur === 'kam-ac' || tur === 'ekr-ac') {
            const t  = tur === 'kam-ac' ? 'kamera' : 'ekran';
            const w  = getOrCreateVideoWrapper(id, t, 'Kullanıcı');
            const v  = w.querySelector('video');
            v.srcObject = stream;
            v.play().catch(e => e);
        } else if (tur === 'mik-ac' || tur === 'ekr-ses') {
            let a = document.getElementById(`audio-${id}`);
            if (!a) {
                a = Object.assign(document.createElement('audio'), {
                    id: `audio-${id}`, className: 'remote-audio', autoplay: true, playsInline: true, muted: isDeafened
                });
                document.getElementById('remoteAudioContainer').appendChild(a);
            }
            a.srcObject = stream;
            a.play().catch(e => console.log('Ses oynatma engellendi:', e));
            if (tur === 'mik-ac') {
                getOrCreateVideoWrapper(id, 'kamera', '');
                sesAnaliziniBaslat(stream, `${id}-kamera`, false);
            }
        }
    } catch (e) { showToast('Uzak yayın hatası', 'hata'); }
}

function baglantiKoprusuKur(hedefId, isInitiator) {
    peerConnections[hedefId]?.close();
    const pc = new RTCPeerConnection(stunSunuculari);
    peerConnections[hedefId] = pc;

    pc.oniceconnectionstatechange = () => {
        if (['disconnected','failed'].includes(pc.iceConnectionState)) {
            setTimeout(() => {
                if (peerConnections[hedefId]?.iceConnectionState !== 'connected')
                    baglantiKoprusuKur(hedefId, true);
            }, 2000);
        }
    };

    pc.ontrack = (e) => {
        const s = e.streams[0];
        if (s) { beklemedekiYayinlar[s.id] = s; sonGelenStream[hedefId] = s; }
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice-adayi', { kime: hedefId, aday: e.candidate });
    };

    if (isInitiator) {
        pc.onnegotiationneeded = async () => {
            try {
                const o = await pc.createOffer();
                await pc.setLocalDescription(o);
                socket.emit('webrtc-teklif', { kime: hedefId, teklif: pc.localDescription });
            } catch (e) { console.warn('Offer hatası:', e); }
        };
    }

    if (kameraYayini)   pc.addTrack(kameraYayini.getVideoTracks()[0], kameraYayini);
    if (mikrofonYayini) pc.addTrack(mikrofonYayini.getAudioTracks()[0], mikrofonYayini);
    if (ekranYayini)    ekranYayini.getTracks().forEach(t => pc.addTrack(t, ekranYayini));
}

socket.on('yeni-kullanici-geldi', (data) => {
    if (benimDurumum !== 'dnd') {
        showToast(`👋 ${data.ad} odaya katıldı`);
        seSesiniCal('giris');
    }
    baglantiKoprusuKur(data.id, true);
    dmKisiListesiniGuncelle();
});

socket.on('webrtc-teklif-geldi', async (data) => {
    if (!peerConnections[data.kimden]) baglantiKoprusuKur(data.kimden, false);
    const pc = peerConnections[data.kimden];
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.teklif));
        const c = await pc.createAnswer();
        await pc.setLocalDescription(c);
        socket.emit('webrtc-cevap', { kime: data.kimden, cevap: pc.localDescription });
    } catch (e) { console.error('Teklif işleme:', e); }
});

socket.on('webrtc-cevap-geldi',  async (d) => { try { await peerConnections[d.kimden]?.setRemoteDescription(new RTCSessionDescription(d.cevap)); } catch(e){} });
socket.on('ice-adayi-geldi',     async (d) => { try { await peerConnections[d.kimden]?.addIceCandidate(new RTCIceCandidate(d.aday)); } catch(e){} });

// ── 12. KULLANICI LİSTESİ ────────────────────────────────────
const DURUM_RENK  = { online: 'var(--renk-basari)', mesgul: 'var(--renk-uyari)', dnd: 'var(--renk-tehlike)', gorunmez: 'var(--renk-gri)' };
const DURUM_SINIF = { online: 'durum-online', mesgul: 'durum-mesgul', dnd: 'durum-dnd', gorunmez: 'durum-gorunmez' };
const DURUM_YAZI  = { online: 'Çevrimiçi', mesgul: 'Meşgul', dnd: 'Rahatsız Etme', gorunmez: 'Görünmez' };

window.kullaniciSesiniAyarla = function(id, v) {
    const a = document.getElementById(`audio-${id}`);
    if (a) a.volume = parseFloat(v);
};

socket.on('kullanici-listesi', (data) => {
    dmKullanicilarCache = data.kullanicilar;
    const liste = document.getElementById('aktifKullanicilarListesi');
    liste.innerHTML = '';
    const idler = Object.keys(data.kullanicilar);
    document.getElementById('kisiSayaci').innerText = idler.length;

    idler.forEach(id => {
        const d  = data.durumlar[id] || {};
        const dc = DURUM_SINIF[d.durum || 'online'] || 'durum-online';

        const volumeHtml = id !== socket.id ? `
            <div class="user-volume-container">
                <i class="fas fa-volume-up" style="color:var(--renk-gri);font-size:10px;"></i>
                <input type="range" min="0" max="1" step="0.05" value="1" onchange="kullaniciSesiniAyarla('${id}',this.value)" style="flex:1;">
                <button class="dm-btn" onclick="dmAc('${id}','${(data.kullanicilar[id]||'').replace(/'/g,'\\\'')}')" title="Özel Mesaj">
                    <i class="fas fa-envelope"></i>
                </button>
            </div>` : '';

        const ikonlar = `
            <div class="status-icons">
                <i class="fas fa-video"    title="Kamera"  style="color:${d.kamera   ? 'var(--renk-aktif)' : 'var(--renk-gri)'};"></i>
                <i class="fas fa-desktop"  title="Ekran"   style="color:${d.ekran    ? 'var(--renk-basari)' : 'var(--renk-gri)'};"></i>
                <i class="fas ${d.kulaklik ? 'fa-headphones-slash' : 'fa-headphones'}" style="color:${d.kulaklik ? 'var(--renk-tehlike)' : 'var(--renk-gri)'};"></i>
                <i class="fas ${d.mikrofon ? 'fa-microphone' : 'fa-microphone-slash'}" style="color:${d.mikrofon ? 'var(--renk-basari)' : 'var(--renk-tehlike)'};"></i>
                ${d.dnd ? '<i class="fas fa-moon" style="color:var(--renk-tehlike);font-size:10px;" title="Rahatsız Etme"></i>' : ''}
            </div>`;

        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <div class="list-item-top">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="avatar-wrapper">
                        <div class="list-avatar ${!d.mikrofon ? 'muted-avatar' : ''}" id="av-${id}">${data.kullanicilar[id][0].toUpperCase()}</div>
                        <div class="durum-nokta ${dc}"></div>
                    </div>
                    <span>${data.kullanicilar[id]}</span>
                </div>
                ${ikonlar}
            </div>
            ${volumeHtml}`;
        liste.appendChild(item);
    });

    dmKisiListesiniGuncelle(data.kullanicilar, data.durumlar);
});

socket.on('medya-durumu-geldi', (data) => {
    if (data.tur.includes('-ac')) remoteYayinEkle(data.streamId, data.kimden, data.tur);
    else if (data.tur === 'kam-kap') document.getElementById(`kutu-${data.kimden}-kamera`)?.remove();
    else if (data.tur === 'ekr-kap') document.getElementById(`kutu-${data.kimden}-ekran`)?.remove();
});

socket.on('kullanici-ayrildi', (id) => {
    if (benimDurumum !== 'dnd') seSesiniCal('cikis');
    document.querySelectorAll(`[id*="-${id}-"]`).forEach(el => el.remove());
    document.getElementById(`audio-${id}`)?.remove();
    peerConnections[id]?.close();
    delete peerConnections[id];
    delete sonGelenStream[id];
    Object.keys(beklemedekiYayinlar).forEach(sid => {
        if (!Object.values(peerConnections).some(pc => pc.getReceivers().some(r => beklemedekiYayinlar[sid]?.getTracks().includes(r.track))))
            delete beklemedekiYayinlar[sid];
    });
    dmKisiListesiniGuncelle();
});

// ── 13. GİRİŞ/ÇIKIŞ SESİ ────────────────────────────────────
function seSesiniCal(tip) {
    const url = tip === 'giris'
        ? 'https://www.myinstants.com/media/sounds/discord-join.mp3'
        : 'https://www.myinstants.com/media/sounds/discord-leave.mp3';
    const a = new Audio(url);
    a.volume = 0.4;
    a.play().catch(e => e);
}

// ── 14. DURUM YÖNETİMİ ───────────────────────────────────────
window.durumDegistir = function(yeni) {
    benimDurumum = yeni;
    socket.emit('durum-degistir', yeni);
    document.getElementById('durumMenu').classList.remove('acik');
    document.getElementById('benimDurumNokta').className = `durum-nokta ${DURUM_SINIF[yeni] || 'durum-online'}`;
    document.getElementById('benimDurumIkonu').style.color = DURUM_RENK[yeni] || 'var(--renk-basari)';
    document.getElementById('benimDurumYazisi').innerText  = DURUM_YAZI[yeni]  || 'Çevrimiçi';
    const ov = document.getElementById('dnd-overlay');
    const bg = document.getElementById('dnd-badge');
    if (yeni === 'dnd') {
        ov.style.display = 'block'; bg.style.display = 'block';
        showToast('🌙 Rahatsız Etme modu aktif', 'uyari');
    } else {
        ov.style.display = 'none'; bg.style.display = 'none';
    }
};

document.getElementById('durumDegistirBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('durumMenu').classList.toggle('acik');
});
document.addEventListener('click', () => document.getElementById('durumMenu').classList.remove('acik'));

// ── 15. DM SİSTEMİ ───────────────────────────────────────────
function dmKisiListesiniGuncelle(kullanicilar, durumlar) {
    if (kullanicilar) dmKullanicilarCache = kullanicilar;
    const liste = document.getElementById('dmKisiListesi');
    if (!liste) return;
    liste.innerHTML = '';
    Object.keys(dmKullanicilarCache).forEach(id => {
        if (id === socket.id) return;
        const unread = (dmMesajlariCache[id] || []).filter(m => !m.okundu && !m.benMi).length;
        const item   = document.createElement('div');
        item.className = `dm-kisi-item${aktifDmKisiId === id ? ' aktif' : ''}`;
        item.onclick   = () => dmKisiSec(id);
        item.innerHTML = `
            <div class="list-avatar" style="width:28px;height:28px;font-size:12px;flex-shrink:0;">${(dmKullanicilarCache[id]||'?')[0].toUpperCase()}</div>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dmKullanicilarCache[id]}</span>
            ${unread > 0 ? `<div class="dm-badge">${unread}</div>` : ''}`;
        liste.appendChild(item);
    });
}

function dmKisiSec(id) {
    aktifDmKisiId = id;
    const bolum   = document.getElementById('dmMesajBolumu');
    const inputBox = document.getElementById('dmInputBox');
    bolum.innerHTML = '';
    inputBox.style.display = 'block';
    document.getElementById('dmInput').placeholder = `${dmKullanicilarCache[id] || 'Kullanıcı'}'ya mesaj gönder...`;
    socket.emit('dm-gecmisi-iste', { kime: id });
    dmKisiListesiniGuncelle();
}

socket.on('dm-gecmisi', (data) => {
    if (!aktifDmKisiId) return;
    const bolum = document.getElementById('dmMesajBolumu');
    bolum.innerHTML = '';
    data.mesajlar.forEach(m => dmMesajEkle(m.isim, m.metin, m.kimden === socket.id, false));
    bolum.scrollTop = bolum.scrollHeight;
});

function dmMesajEkle(isim, metin, benMi, scroll = true) {
    const bolum = document.getElementById('dmMesajBolumu');
    const saat  = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const div   = document.createElement('div');
    div.style.cssText = `display:flex;flex-direction:column;max-width:90%;${benMi ? 'align-self:flex-end;' : ''}`;
    div.innerHTML = `
        <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:2px;${benMi ? 'flex-direction:row-reverse;' : ''}">
            <span style="font-size:13px;font-weight:700;color:${benMi ? 'var(--renk-aktif)' : 'var(--renk-tehlike)'};">${isim}</span>
            <span style="font-size:10px;color:var(--renk-gri);">${saat}</span>
        </div>
        <div style="background:${benMi ? 'rgba(88,101,242,0.12)' : '#2b2d31'};border:1px solid ${benMi ? 'rgba(88,101,242,0.2)' : '#1f2123'};padding:7px 10px;border-radius:${benMi ? '8px 8px 2px 8px' : '8px 8px 8px 2px'};font-size:13px;color:#dbdee1;line-height:1.5;">${metin}</div>`;
    bolum.appendChild(div);
    if (scroll) bolum.scrollTop = bolum.scrollHeight;
}

function dmGonder() {
    if (!aktifDmKisiId) return;
    const input = document.getElementById('dmInput');
    const metin = input.value.trim();
    if (!metin) return;
    socket.emit('dm-gonder', { kime: aktifDmKisiId, metin });
    if (!dmMesajlariCache[aktifDmKisiId]) dmMesajlariCache[aktifDmKisiId] = [];
    dmMesajlariCache[aktifDmKisiId].push({ isim: kullaniciAdi, metin, benMi: true, okundu: true });
    dmMesajEkle(kullaniciAdi, metin, true);
    input.value = '';
}

document.getElementById('dmGonderBtnInline').addEventListener('click', dmGonder);
document.getElementById('dmInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') dmGonder(); });

socket.on('dm-geldi', (data) => {
    if (!dmMesajlariCache[data.kimden]) dmMesajlariCache[data.kimden] = [];
    const goruyorMu = aktifDmKisiId === data.kimden && document.getElementById('sekme-dm').classList.contains('aktif');
    dmMesajlariCache[data.kimden].push({ isim: data.isim, metin: data.metin, benMi: false, okundu: goruyorMu });
    if (goruyorMu) {
        dmMesajEkle(data.isim, data.metin, false);
    } else if (benimDurumum !== 'dnd') {
        showToast(`💬 ${data.isim}: ${data.metin.substring(0, 40)}${data.metin.length > 40 ? '…' : ''}`, 'bilgi');
        dmUnreadCount++;
        const b = document.getElementById('dmUnreadBadge');
        b.innerText = dmUnreadCount; b.style.display = 'inline-flex';
    }
    dmKisiListesiniGuncelle();
});

window.dmAc = function(id, isim) {
    chatSekmeDegistir('dm');
    dmKullanicilarCache[id] = isim;
    dmKisiSec(id);
};

// ── 16. GENEL CHAT ───────────────────────────────────────────
const URL_REGEX = /(https?:\/\/[^\s<>"]+)/g;
let mesajSayac  = 0;

// Discord tarzı mesaj gruplama
function ekranaMesajYaz(isim, metin, benMi, resimMi = false, zamandamgasi = null) {
    const gecici  = document.createElement('div');
    gecici.innerText = metin;
    const guvenli = gecici.innerHTML;
    const saat    = zamandamgasi
        ? new Date(zamandamgasi).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgId   = 'msg-' + (++mesajSayac);

    let icerik;
    if (resimMi) {
        icerik = `<img src="${metin}" style="max-width:100%;border-radius:6px;margin-top:4px;cursor:pointer;" onclick="window.open(this.src)">`;
    } else {
        URL_REGEX.lastIndex = 0;
        const linkli = guvenli.replace(URL_REGEX, url =>
            `<a href="${url}" target="_blank" rel="noopener" style="color:var(--renk-aktif);text-decoration:underline;word-break:break-all;">${url}</a>`);
        URL_REGEX.lastIndex = 0;
        const link = URL_REGEX.test(metin) ? metin.match(URL_REGEX)?.[0] : null;
        URL_REGEX.lastIndex = 0;
        const onizleme = link ? `<div class="link-onizleme"><div class="link-onizleme-title">${(() => { try { return new URL(link).hostname; } catch(e) { return link; } })()}</div><div class="link-onizleme-url">${link.length > 80 ? link.substring(0,80)+'…' : link}</div></div>` : '';
        icerik = linkli + onizleme;
    }

    const hizliReaks = ['👍','❤️','😂','🔥','😮'].map(e =>
        `<button class="msg-action-btn" onclick="reaksiyonGonder('${msgId}','${e}')" title="${e}">${e}</button>`
    ).join('');

    // Mesaj gruplama: aynı kişinin ardışık mesajlarını gruplayabiliriz
    const isGroupable = sonMesajIsim === isim && !resimMi;
    sonMesajIsim = isim;

    if (isGroupable) {
        // Mevcut gruba ekle
        const lastGroup = mesajGecmisi.querySelector('.msg-group:last-child');
        if (lastGroup && lastGroup.getAttribute('data-isim') === isim) {
            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'msg-body';
            bodyDiv.id = msgId;
            bodyDiv.innerHTML = `
                <div class="msg-actions">${hizliReaks}</div>
                <span>${icerik}</span>
                <div class="msg-reaksiyonlar" id="reaksiyon-${msgId}"></div>`;
            lastGroup.appendChild(bodyDiv);
            mesajGecmisi.scrollTop = mesajGecmisi.scrollHeight;
            return msgId;
        }
    }

    const group = document.createElement('div');
    group.className = 'msg-group';
    group.setAttribute('data-isim', isim);
    group.innerHTML = `
        <div class="msg-group-header">
            <div class="msg-avatar-small">${isim[0].toUpperCase()}</div>
            <div class="msg-meta">
                <span class="msg-isim ${benMi ? 'benim' : ''}">${isim}</span>
                <span class="msg-saat">${saat}</span>
            </div>
        </div>
        <div class="msg-body" id="${msgId}">
            <div class="msg-actions">${hizliReaks}</div>
            <span>${icerik}</span>
            <div class="msg-reaksiyonlar" id="reaksiyon-${msgId}"></div>
        </div>`;
    mesajGecmisi.appendChild(group);
    mesajGecmisi.scrollTop = mesajGecmisi.scrollHeight;
    return msgId;
}

// Geçmiş mesajları yükle
socket.on('kanal-gecmisi', (mesajlar) => {
    mesajlar.forEach(m => ekranaMesajYaz(m.ad, m.metin, m.ad === kullaniciAdi, false, m.zaman));
});

// Reaksiyon
const reaksiyonSayac = {};
window.reaksiyonGonder = function(msgId, emoji) {
    socket.emit('reaksiyon', { mesajId: msgId, emoji });
    reaksiyonEkle(msgId, emoji, kullaniciAdi);
};
function reaksiyonEkle(msgId, emoji, ad) {
    const kap = document.getElementById(`reaksiyon-${msgId}`);
    if (!kap) return;
    const key = `${msgId}-${emoji}`;
    reaksiyonSayac[key] = (reaksiyonSayac[key] || 0) + 1;
    const mevcut = kap.querySelector(`[data-emoji="${emoji}"]`);
    if (mevcut) mevcut.querySelector('.reaksiyon-sayi').innerText = reaksiyonSayac[key];
    else {
        const chip = document.createElement('div');
        chip.className = 'reaksiyon-chip';
        chip.setAttribute('data-emoji', emoji);
        chip.title = ad;
        chip.innerHTML = `${emoji} <span class="reaksiyon-sayi">${reaksiyonSayac[key]}</span>`;
        chip.onclick = () => reaksiyonGonder(msgId, emoji);
        kap.appendChild(chip);
    }
}
socket.on('reaksiyon-geldi', (data) => reaksiyonEkle(data.mesajId, data.emoji, data.ad));

// Mesaj gönderme
mesajGonderBtn.addEventListener('click', () => {
    const m = mesajKutusu.value.trim();
    if (!m) return;
    socket.emit('chat-mesaji', { ad: kullaniciAdi, metin: m });
    ekranaMesajYaz(kullaniciAdi, m, true);
    mesajKutusu.value = '';
    mesajKutusu.dispatchEvent(new Event('input'));
});
mesajKutusu.addEventListener('keypress', (e) => { if (e.key === 'Enter') mesajGonderBtn.click(); });

// Yazıyor göstergesi
mesajKutusu.addEventListener('input', () => {
    clearTimeout(yaziyorTimer);
    if (mesajKutusu.value.trim()) {
        socket.emit('yaziyor', { ad: kullaniciAdi, durum: true });
        yaziyorTimer = setTimeout(() => socket.emit('yaziyor', { ad: kullaniciAdi, durum: false }), 2000);
    } else {
        socket.emit('yaziyor', { ad: kullaniciAdi, durum: false });
    }
});
socket.on('yaziyor-geldi', (data) => {
    if (data.id === socket.id) return;
    const el = document.getElementById('yaziyorGosterge');
    if (!el) return;
    if (data.durum) {
        el.innerHTML = `<span class="yaziyor-nokta">●</span><span class="yaziyor-nokta">●</span><span class="yaziyor-nokta">●</span> <i>${data.ad} yazıyor...</i>`;
    } else {
        el.innerHTML = '';
    }
});

// Dosya boyutu limiti: 5 MB
dosyaSecici.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
        showToast('⚠️ Maksimum 5 MB dosya gönderilebilir', 'hata');
        dosyaSecici.value = ''; return;
    }
    const r = new FileReader();
    r.onload  = (ev) => {
        try { socket.emit('dosya-gonder', { ad: kullaniciAdi, data: ev.target.result }); ekranaMesajYaz(kullaniciAdi, ev.target.result, true, true); }
        catch (e) { showToast('Dosya gönderim hatası', 'hata'); }
    };
    r.onerror = () => showToast('Dosya okunamadı', 'hata');
    r.readAsDataURL(f);
    dosyaSecici.value = '';
});

socket.on('yeni-mesaj', (data) => {
    sonMesajIsim = null; // Gelen mesaj gruplamayı sıfırla
    ekranaMesajYaz(data.ad, data.metin, false, false, data.zaman);
    if (benimDurumum !== 'dnd' && window.innerWidth <= 850 && document.querySelector('.chat-panel')?.style.display !== 'flex') {
        okunmamisMesajSayisi++;
        const b = document.getElementById('chatGostergeBadge');
        b.innerText = okunmamisMesajSayisi; b.style.display = 'flex';
    }
});
socket.on('yeni-dosya', (data) => ekranaMesajYaz(data.ad, data.data, false, true));

window.sesGonder = function(url) {
    try { new Audio(url).play(); } catch(e){}
    socket.emit('ses-efekti', url);
};
socket.on('ses-oynat', (url) => {
    if (benimDurumum === 'dnd') return;
    try { new Audio(url).play().catch(e=>e); } catch(e){}
});

// Arama
document.getElementById('aramaKutusu')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.msg-group').forEach(g => {
        const text = g.innerText.toLowerCase();
        g.style.display = !q || text.includes(q) ? '' : 'none';
    });
});

// ── 17. CİHAZ AYARLARI ───────────────────────────────────────
async function cihazlariGetir() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        const cihazlar = await navigator.mediaDevices.enumerateDevices();
        const mic = document.getElementById('micSelect');
        const cam = document.getElementById('camSelect');
        mic.innerHTML = '<option value="default">Sistem Varsayılanı</option>';
        cam.innerHTML = '<option value="default">Sistem Varsayılanı</option>';
        cihazlar.forEach(c => {
            const o = document.createElement('option');
            o.value = c.deviceId; o.text = c.label || `Cihaz ${c.deviceId.substring(0,5)}`;
            if (c.kind === 'audioinput') { if (c.deviceId === seciliMikrofon) o.selected = true; mic.appendChild(o); }
            if (c.kind === 'videoinput') { if (c.deviceId === seciliKamera)   o.selected = true; cam.appendChild(o); }
        });
    } catch (e) { console.log('Cihaz tarama hatası:', e); }
}

window.mikrofonTestBaslat = async function() {
    try {
        testMeterStream?.getTracks().forEach(t => t.stop());
        clearInterval(testMeterInterval);
        const mic   = document.getElementById('micSelect').value;
        const ayar  = { echoCancellation: true, noiseSuppression: true, deviceId: mic !== 'default' ? { exact: mic } : undefined };
        testMeterStream = await navigator.mediaDevices.getUserMedia({ audio: ayar });
        const ctx   = new (window.AudioContext || window.webkitAudioContext)();
        const src   = ctx.createMediaStreamSource(testMeterStream);
        const anl   = ctx.createAnalyser();
        anl.fftSize = 256; src.connect(anl);
        const veri  = new Uint8Array(anl.frequencyBinCount);
        const fill  = document.getElementById('testMeterFill');
        testMeterInterval = setInterval(() => {
            anl.getByteFrequencyData(veri);
            fill.style.width = Math.min(100, veri.reduce((a,b)=>a+b,0)/veri.length*2) + '%';
        }, 100);
        setTimeout(() => {
            clearInterval(testMeterInterval);
            testMeterStream?.getTracks().forEach(t => t.stop());
            if (fill) fill.style.width = '0%';
        }, 8000);
    } catch (e) { showToast('Mikrofon test edilemedi: ' + e.message, 'hata'); }
};

document.getElementById('isimDegistirBtn').addEventListener('click', () => {
    const modal = document.getElementById('isimModal');
    const input = document.getElementById('yeniIsimInput');
    if (!modal || !input) return;
    input.value = kullaniciAdi;
    cihazlariGetir();
    modal.style.display = 'flex';
    input.focus();
    document.getElementById('isimKaydetBtn').onclick = () => {
        const y = input.value.trim();
        if (y) localStorage.setItem('bascord_isim', y);
        localStorage.setItem('bascord_mic', document.getElementById('micSelect').value);
        localStorage.setItem('bascord_cam', document.getElementById('camSelect').value);
        testMeterStream?.getTracks().forEach(t => t.stop());
        location.reload();
    };
});

// ── 18. MEDYA KONTROLLER ─────────────────────────────────────
kanalaKatilBtn.addEventListener('click', () => {
    kanalaKatilBtn.innerHTML = '<i class="fas fa-volume-up" style="font-size:14px;color:var(--renk-basari);"></i> <span>genel — Bağlandı</span>';
    kanalaKatilBtn.classList.add('active');
    [mikrofonBtn, kulaklikBtn, kameraBtn, ekranBtn].forEach(b => b.disabled = false);
    gamerModBtn.style.display = 'flex';
    seSesiniCal('giris');
    socket.emit('kanala-katil', kullaniciAdi);
    setTimeout(pingSolc, 500);
});

kulaklikBtn.addEventListener('click', () => {
    isDeafened = !isDeafened;
    const ikon = document.getElementById('kulak-icon');
    if (isDeafened) {
        ikon.className = 'fas fa-headphones-slash'; kulaklikBtn.classList.add('tehlike');
        document.querySelectorAll('.remote-audio').forEach(a => a.muted = true);
        if (mikrofonYayini?.getAudioTracks()[0].enabled) { wasMicEnabledBeforeDeafen = true; mikrofonBtn.click(); }
        socket.emit('medya-durumu', { tur: 'kulak-kap', broadcast: true });
    } else {
        ikon.className = 'fas fa-headphones'; kulaklikBtn.classList.remove('tehlike');
        document.querySelectorAll('.remote-audio').forEach(a => a.muted = false);
        if (wasMicEnabledBeforeDeafen) { wasMicEnabledBeforeDeafen = false; mikrofonBtn.click(); }
        socket.emit('medya-durumu', { tur: 'kulak-ac', broadcast: true });
    }
});

pttToggleBtn.addEventListener('click', () => {
    isPttActive = !isPttActive;
    const span = pttToggleBtn.querySelector('span');
    if (span) span.textContent = `Bas-Konuş: ${isPttActive ? 'AÇIK' : 'KAPALI'}`;
    pttToggleBtn.classList.toggle('active', isPttActive);
    pttToggleBtn.style.color = isPttActive ? '#fff' : 'var(--renk-gri)';
    if (isMobile) document.getElementById('mobilePttBtn').style.display = isPttActive ? 'block' : 'none';
    if (isPttActive && mikrofonYayini?.getAudioTracks()[0].enabled) {
        mikrofonYayini.getAudioTracks()[0].enabled = false;
        document.getElementById('mik-icon').className = 'fas fa-microphone-slash';
        mikrofonBtn.classList.remove('acik');
        socket.emit('medya-durumu', { tur: 'mik-kap', broadcast: true });
    }
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && isPttActive && document.activeElement !== mesajKutusu && !isPttKeyPressed) {
        isPttKeyPressed = true;
        if (mikrofonYayini) {
            mikrofonYayini.getAudioTracks()[0].enabled = true;
            document.getElementById('mik-icon').className = 'fas fa-microphone';
            mikrofonBtn.classList.add('acik');
            socket.emit('medya-durumu', { tur: 'mik-ac', broadcast: true });
        }
    }
});
window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && isPttActive && document.activeElement !== mesajKutusu) {
        isPttKeyPressed = false;
        if (mikrofonYayini) {
            mikrofonYayini.getAudioTracks()[0].enabled = false;
            document.getElementById('mik-icon').className = 'fas fa-microphone-slash';
            mikrofonBtn.classList.remove('acik');
            socket.emit('medya-durumu', { tur: 'mik-kap', broadcast: true });
        }
    }
});

const mobilePtt = document.getElementById('mobilePttBtn');
mobilePtt.addEventListener('touchstart', (e) => { e.preventDefault(); if (mikrofonYayini) { mikrofonYayini.getAudioTracks()[0].enabled = true; socket.emit('medya-durumu', { tur: 'mik-ac', broadcast: true }); } });
mobilePtt.addEventListener('touchend',   (e) => { e.preventDefault(); if (mikrofonYayini) { mikrofonYayini.getAudioTracks()[0].enabled = false; socket.emit('medya-durumu', { tur: 'mik-kap', broadcast: true }); } });

mikrofonBtn.addEventListener('click', async () => {
    if (isDeafened) { showToast('Sesi kestiniz (Deafen), önce açın.', 'uyari'); return; }
    const ikon = document.getElementById('mik-icon');
    if (!mikrofonYayini) {
        try {
            const ayar = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: seciliMikrofon !== 'default' ? { exact: seciliMikrofon } : undefined };
            mikrofonYayini = await navigator.mediaDevices.getUserMedia({ audio: ayar });
            ikon.className = 'fas fa-microphone'; mikrofonBtn.classList.add('acik');
            if (isPttActive) { mikrofonYayini.getAudioTracks()[0].enabled = false; ikon.className = 'fas fa-microphone-slash'; mikrofonBtn.classList.remove('acik'); }
            else socket.emit('medya-durumu', { tur: 'mik-ac', broadcast: true, id: mikrofonYayini.id });
            trackleriEkle(mikrofonYayini.getAudioTracks()[0], mikrofonYayini);
            sesAnaliziniBaslat(mikrofonYayini, 'yerel-kamera', true);
        } catch (e) { showToast('Mikrofon açılamadı! Ayarları kontrol edin.', 'hata'); }
    } else {
        const track = mikrofonYayini.getAudioTracks()[0];
        const en = track.enabled;
        track.enabled = !en;
        ikon.className = en ? 'fas fa-microphone-slash' : 'fas fa-microphone';
        en ? mikrofonBtn.classList.remove('acik') : mikrofonBtn.classList.add('acik');
        socket.emit('medya-durumu', { tur: en ? 'mik-kap' : 'mik-ac', broadcast: true, id: mikrofonYayini.id });
    }
});

kameraBtn.addEventListener('click', async () => {
    const ikon = document.getElementById('kam-icon');
    if (!kameraYayini) {
        try {
            const av = isMobile ? { facingMode: onKameraMi ? 'user' : 'environment' } : { width: { ideal: 1280 }, height: { ideal: 720 }, deviceId: seciliKamera !== 'default' ? { exact: seciliKamera } : undefined };
            kameraYayini = await navigator.mediaDevices.getUserMedia({ video: av });
            getOrCreateVideoWrapper('yerel', 'kamera', '').querySelector('video').srcObject = kameraYayini;
            ikon.className = 'fas fa-video'; kameraBtn.classList.add('acik');
            if (isMobile) kameraCevirBtn.style.display = 'block';
            trackleriEkle(kameraYayini.getVideoTracks()[0], kameraYayini);
            socket.emit('medya-durumu', { tur: 'kam-ac', broadcast: true, id: kameraYayini.id });
        } catch (e) { showToast('Kamera açılamadı!', 'hata'); }
    } else {
        kameraYayini.getTracks().forEach(t => t.stop()); kameraYayini = null;
        document.getElementById('kutu-yerel-kamera')?.remove();
        ikon.className = 'fas fa-video-slash'; kameraBtn.classList.remove('acik'); kameraCevirBtn.style.display = 'none';
        socket.emit('medya-durumu', { tur: 'kam-kap', broadcast: true });
    }
});

kameraCevirBtn.addEventListener('click', async () => {
    if (!kameraYayini) return;
    onKameraMi = !onKameraMi;
    kameraYayini.getTracks().forEach(t => t.stop());
    try {
        kameraYayini = await navigator.mediaDevices.getUserMedia({ video: { facingMode: onKameraMi ? 'user' : 'environment' } });
        document.getElementById('vid-yerel-kamera').srcObject = kameraYayini;
        trackleriEkle(kameraYayini.getVideoTracks()[0], kameraYayini);
    } catch (e) { showToast('Kamera çevrilemedi', 'hata'); }
});

ekranBtn.addEventListener('click', async () => {
    const ikon = document.getElementById('ekran-icon');
    if (!ekranYayini) {
        try {
            const ayar = isMobile ? { video: true, audio: false } : { video: { width: { ideal: 1920 }, frameRate: { ideal: 30 } }, audio: true };
            ekranYayini = await navigator.mediaDevices.getDisplayMedia(ayar);
            getOrCreateVideoWrapper('yerel', 'ekran', '').querySelector('video').srcObject = ekranYayini;
            ekranBtn.classList.add('acik'); ikon.style.color = 'var(--renk-basari)';
            ekranYayini.getTracks().forEach(t => {
                trackleriEkle(t, ekranYayini);
                socket.emit('medya-durumu', { tur: t.kind === 'video' ? 'ekr-ac' : 'ekr-ses', broadcast: true, id: ekranYayini.id });
            });
            ekranYayini.getVideoTracks()[0].onended = () => ekranBtn.click();
        } catch (e) { if (e.name !== 'NotAllowedError') showToast('Ekran paylaşımı başlatılamadı', 'hata'); }
    } else {
        ekranYayini.getTracks().forEach(t => t.stop()); ekranYayini = null;
        document.getElementById('kutu-yerel-ekran')?.remove();
        ekranBtn.classList.remove('acik'); ikon.style.color = 'var(--renk-gri)';
        socket.emit('medya-durumu', { tur: 'ekr-kap', broadcast: true });
    }
});

gamerModBtn.addEventListener('click', () => {
    const aktif = gamerModBtn.classList.contains('active');
    gamerModBtn.classList.toggle('active', !aktif);
    const span = gamerModBtn.querySelector('span');
    if (span) span.textContent = aktif ? 'Gamer Mod' : 'Gamer Mod: AÇIK';
    if (!aktif && kameraYayini) kameraBtn.click();
});

// ── 19. ELECTRON ─────────────────────────────────────────────
const titleBar = document.getElementById('bascord-title-bar');
if (!isMobile) {
    try {
        if (window.require) {
            const { ipcRenderer } = require('electron');
            document.getElementById('min-btn')?.addEventListener('click', () => ipcRenderer.send('window-minimize'));
            document.getElementById('close-btn')?.addEventListener('click', () => ipcRenderer.send('window-close'));
            ipcRenderer.on('ekran-seciciyi-ac', (event, kaynaklar) => {
                const modal = document.getElementById('ekranSeciciModal');
                const liste = document.getElementById('ekranListesi');
                liste.innerHTML = '';
                kaynaklar.forEach(k => {
                    const d = document.createElement('div');
                    d.style.cssText = 'width:160px;background:#1e1f22;border-radius:6px;padding:8px;cursor:pointer;text-align:center;border:2px solid transparent;transition:0.2s;';
                    d.onmouseover = () => d.style.borderColor = 'var(--renk-aktif)';
                    d.onmouseout  = () => d.style.borderColor = 'transparent';
                    d.onclick = () => { modal.style.display = 'none'; ipcRenderer.send('ekran-secildi', k.id); };
                    d.innerHTML = `<img src="${k.thumbnail}" style="width:100%;height:90px;object-fit:cover;border-radius:4px;margin-bottom:6px;background:#000;"><div style="color:#dbdee1;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${k.name}">${k.name}</div>`;
                    liste.appendChild(d);
                });
                modal.style.display = 'flex';
            });
            window.ekranPaylasiminiIptalEt = function() {
                document.getElementById('ekranSeciciModal').style.display = 'none';
                ipcRenderer.send('ekran-secildi', null);
            };
        } else { throw new Error('browser'); }
    } catch (e) {
        if (titleBar) titleBar.style.display = 'none';
        document.body.style.paddingTop = '0';
    }
} else {
    if (titleBar) titleBar.style.display = 'none';
    document.body.style.paddingTop = '0';
}

// ── 20. MOBİL NAV ─────────────────────────────────────────────
window.sekmeDegistir = function(sekme) {
    const sidebar   = document.querySelector('.sidebar');
    const chatPanel = document.querySelector('.chat-panel');
    const main      = document.querySelector('.main');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if (sekme === 'kameralar') {
        document.getElementById('nav-kameralar').classList.add('active');
        if (window.innerWidth <= 850) { sidebar.style.setProperty('display','none','important'); chatPanel.style.setProperty('display','none','important'); main.style.setProperty('display','flex','important'); }
    } else if (sekme === 'sohbet') {
        document.getElementById('nav-sohbet').classList.add('active');
        okunmamisMesajSayisi = 0;
        document.getElementById('chatGostergeBadge').style.display = 'none';
        if (window.innerWidth <= 850) { sidebar.style.setProperty('display','none','important'); main.style.setProperty('display','none','important'); chatPanel.style.setProperty('display','flex','important'); }
    } else if (sekme === 'ayarlar') {
        document.getElementById('nav-ayarlar').classList.add('active');
        if (window.innerWidth <= 850) { main.style.setProperty('display','none','important'); chatPanel.style.setProperty('display','none','important'); sidebar.style.setProperty('display','flex','important'); }
    }
};
