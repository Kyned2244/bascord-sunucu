const socket = io();

// --- 1. CİHAZ VE DEĞİŞKEN TESPİTİ ---
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
let peerConnections = {}; // ÇOKLU KULLANICI İÇİN: { socketId: RTCPeerConnection }
let beklemedekiYayinlar = {}; 
let globalAudioCtx = null; // BUGFIX 3: Bellek sızıntısını önleyen global AudioContext

let kameraYayini = null; 
let ekranYayini = null; 
let mikrofonYayini = null;
let onKameraMi = true;

// ÖZELLİK: PTT & Deafen
let isPttActive = false;
let isPttKeyPressed = false;
let isDeafened = false;
let wasMicEnabledBeforeDeafen = false;
let okunmamisMesajSayisi = 0;

// --- 2. HAFIZA VE İSİM (BUGFIX: Electron Try-Catch Eklendi) ---
let kullaniciAdi = localStorage.getItem('bascord_isim');
if (!kullaniciAdi) {
    try {
        kullaniciAdi = prompt("Bascord'a hoş geldin! İsmini belirle:") || "Anonim";
    } catch (e) {
        kullaniciAdi = "Gamer_" + Math.floor(Math.random() * 1000);
    }
    localStorage.setItem('bascord_isim', kullaniciAdi);
}
document.getElementById('benimAdimGosterge').innerText = kullaniciAdi;
document.getElementById('benimAvatarim').innerText = kullaniciAdi.charAt(0);

document.getElementById('isimDegistirBtn').addEventListener('click', () => {
    const isimModal = document.getElementById('isimModal');
    const input = document.getElementById('yeniIsimInput');
    if (isimModal && input) {
        input.value = kullaniciAdi;
        isimModal.style.display = 'flex';
        input.focus();
        document.getElementById('isimKaydetBtn').onclick = () => {
            let yeniIsim = input.value.trim();
            if (yeniIsim !== "") { localStorage.setItem('bascord_isim', yeniIsim); location.reload(); }
        };
        input.onkeypress = (e) => { if (e.key === 'Enter') document.getElementById('isimKaydetBtn').click(); };
    }
});

// --- 3. HTML SEÇİCİLERİ ---
const kanalaKatilBtn = document.getElementById('kanalaKatilBtn');
const mikrofonBtn = document.getElementById('mikrofonBtn');
const kulaklikBtn = document.getElementById('kulaklikBtn');
const kameraBtn = document.getElementById('kameraBtn');
const kameraCevirBtn = document.getElementById('kameraCevirBtn'); 
const ekranBtn = document.getElementById('ekranBtn');
const pttToggleBtn = document.getElementById('pttToggleBtn');
const gamerModBtn = document.getElementById('gamerModBtn');
const mesajKutusu = document.getElementById('mesajKutusu');
const mesajGonderBtn = document.getElementById('mesajGonderBtn');
const mesajGecmisi = document.getElementById('mesajGecmisi');
const dosyaSecici = document.getElementById('dosyaSecici');

const stunSunuculari = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
};

// --- YENİ BİLDİRİM & EMOJİ SİSTEMİ ---
function showToast(mesaj) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fas fa-bell"></i> ${mesaj}`;
    container.appendChild(toast);
    setTimeout(() => { if(container.contains(toast)) container.removeChild(toast); }, 3000);
}

const emojiler = ['😀','😂','😍','😎','😢','😡','👍','👎','🔥','🎉','❤️','🤔','🙄','😴','😷','👽','🤖','👻','💩','👀'];
const emojiPanel = document.getElementById('emojiPickerPanel');
emojiler.forEach(emo => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn';
    btn.innerText = emo;
    btn.onclick = () => { mesajKutusu.value += emo; emojiPanel.style.display = 'none'; mesajKutusu.focus(); };
    emojiPanel.appendChild(btn);
});
document.getElementById('emojiAcBtn').onclick = () => emojiPanel.style.display = emojiPanel.style.display === 'grid' ? 'none' : 'grid';

// --- 4. DİNAMİK VİDEO YERLEŞTİRME (MULTI-USER MİMARİSİ) ---
window.tamEkranYap = function(elementId) {
    const videoElementi = document.getElementById(elementId);
    if (videoElementi && videoElementi.requestFullscreen) videoElementi.requestFullscreen();
    else if (videoElementi && videoElementi.webkitRequestFullscreen) videoElementi.webkitRequestFullscreen();
};

function getOrCreateVideoWrapper(kullaniciId, tip, isim) {
    const wrapperId = `kutu-${kullaniciId}-${tip}`;
    let el = document.getElementById(wrapperId);
    
    if (!el) {
        el = document.createElement('div');
        el.className = 'video-wrapper';
        el.id = wrapperId;
        
        const videoId = `vid-${kullaniciId}-${tip}`;
        const isMuted = (kullaniciId === 'yerel') ? 'muted' : '';
        const flipStyle = (tip === 'kamera') ? 'transform: scaleX(-1);' : '';
        const labelText = (kullaniciId === 'yerel') ? (tip === 'ekran' ? 'Senin Ekranın' : 'Sen') : `${isim} ${tip === 'ekran' ? 'Ekranı' : ''}`;
        
        // Ekran Paylaşımı Kontrol Butonu
        const kontrolBtnHtml = (tip === 'ekran' && kullaniciId !== 'yerel' && !isMobile) ? 
            `<button class="overlay-btn" id="kontrolBtn-${kullaniciId}" style="background:var(--renk-basari); border-color:var(--renk-basari);" onclick="kontrolIstegiYolla('${kullaniciId}')"><i class="fas fa-hand-pointer"></i> Kontrol Et</button>` : '';

        el.innerHTML = `
            <video id="${videoId}" autoplay playsinline ${isMuted} style="width:100%; height:100%; object-fit:contain; ${flipStyle}"></video>
            <div class="video-label">${labelText}</div>
            <div class="video-overlay">
                ${kontrolBtnHtml}
                <button class="overlay-btn" onclick="tamEkranYap('${videoId}')"><i class="fas fa-expand"></i> Büyüt</button>
            </div>
            <div class="ses-seviyesi-bar" id="bar-${kullaniciId}-${tip}"></div>
        `;
        document.getElementById('mainVideoGrid').appendChild(el);

        // Teams Benzeri Kontrol Tıklaması
        if (tip === 'ekran' && kullaniciId !== 'yerel' && !isMobile) {
            const videoEl = el.querySelector('video');
            videoEl.addEventListener('click', (event) => {
                if(videoEl.getAttribute('data-kontrol-aktif') === 'true') {
                    const rect = videoEl.getBoundingClientRect();
                    const yuzdeX = ((event.clientX - rect.left) / rect.width) * 100;
                    const yuzdeY = ((event.clientY - rect.top) / rect.height) * 100;
                    socket.emit('fare-hareketi', { kime: kullaniciId, x: yuzdeX, y: yuzdeY });
                }
            });
        }
    }
    return el;
}

window.kontrolIstegiYolla = function(kimeId) {
    socket.emit('kontrol-iste', { kime: kimeId });
    const btn = document.getElementById(`kontrolBtn-${kimeId}`);
    if(btn) { btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Bekleniyor..."; btn.disabled = true; }
};

socket.on('kontrol-istegi-geldi', (data) => {
    const onay = confirm(`⚠️ ${data.ad} ekranınızı işaretleyerek kontrol etmek istiyor. İzin veriyor musunuz?`);
    socket.emit('kontrol-cevap', { kime: data.kimden, onay: onay });
});

socket.on('kontrol-cevabi-geldi', (data) => {
    const btn = document.getElementById(`kontrolBtn-${data.kimden}`);
    const videoEl = document.getElementById(`vid-${data.kimden}-ekran`);
    if (data.onay) {
        if(btn) { btn.innerHTML = "<i class='fas fa-check-circle'></i> Kontrol Aktif"; btn.style.background = "var(--renk-tehlike)"; }
        if(videoEl) videoEl.setAttribute('data-kontrol-aktif', 'true');
    } else {
        if(btn) { btn.innerHTML = "<i class='fas fa-hand-pointer'></i> Kontrol Et"; btn.disabled = false; }
    }
});

socket.on('karsi-fare-hareketi', (data) => {
    const lazer = document.getElementById('remote-pointer');
    lazer.style.display = "block";
    lazer.style.left = data.x + "%";
    lazer.style.top = data.y + "%";
    setTimeout(() => { lazer.style.display = "none"; }, 2000);
});

// --- 5. SES SEVİYESİ VE ANALİZ SİSTEMİ ---
function sesAnaliziniBaslat(stream, wrapperId, isLocalMic = false) {
    if (!globalAudioCtx) globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const kaynak = globalAudioCtx.createMediaStreamSource(stream);
    const analizor = globalAudioCtx.createAnalyser();
    analizor.fftSize = 256;
    kaynak.connect(analizor);
    const veriDizisi = new Uint8Array(analizor.frequencyBinCount);
    
    let sonDurum = false;

    const interval = setInterval(() => {
        if (!stream.active || (stream.getAudioTracks().length > 0 && !stream.getAudioTracks()[0].enabled)) {
            const bar = document.getElementById(`bar-${wrapperId}`);
            if(bar) bar.style.width = '0%';
            if(isLocalMic && sonDurum) { socket.emit('konusuyor-mu', false); sonDurum = false; }
            return;
        }

        analizor.getByteFrequencyData(veriDizisi);
        let ortalamaSes = veriDizisi.reduce((a, b) => a + b, 0) / veriDizisi.length;
        
        const bar = document.getElementById(`bar-${wrapperId}`);
        if(bar) bar.style.width = Math.min(100, ortalamaSes) + '%';

        // BUGFIX 2: Sadece yerel mikrofonsa tüm odaya yayınla
        if (isLocalMic) {
            let konusuyorMu = ortalamaSes > 30;
            if (konusuyorMu !== sonDurum) {
                sonDurum = konusuyorMu;
                socket.emit('konusuyor-mu', sonDurum);
                parlamayiAyarla(socket.id, sonDurum);
            }
        }
    }, 150);
}

function parlamayiAyarla(id, durum) {
    const avatar = document.getElementById(`av-${id}`);
    if (avatar) durum ? avatar.classList.add('speaking') : avatar.classList.remove('speaking');
}

socket.on('konusma-durumu-geldi', (data) => {
    parlamayiAyarla(data.id, data.durum);
    const topBarInfo = document.getElementById('aktifKonusanInfo');
    if (data.durum) topBarInfo.innerHTML = `🎤 ${data.ad} konuşuyor...`;
    else if (topBarInfo.innerHTML.includes(data.ad)) topBarInfo.innerHTML = "";
});

// --- 6. WEBRTC MULTI-USER SİNYALİZASYON SİSTEMİ ---
function trackleriTümBaglantilaraEkle(track, stream) {
    Object.keys(peerConnections).forEach(hedefId => {
        try {
            const pc = peerConnections[hedefId];
            const sender = pc.getSenders().find(s => s.track && s.track.kind === track.kind);
            if (sender) sender.replaceTrack(track);
            else {
                pc.addTrack(track, stream);
                if (track.kind === 'video' && !isMobile) track.contentHint = 'detail';
            }
        } catch(e) {}
    });
}

function remoteYayinEkle(streamId, id, tur) {
    const stream = beklemedekiYayinlar[streamId];
    if (!stream) return;

    if (tur === 'kam-ac' || tur === 'ekr-ac') {
        const typeStr = tur === 'kam-ac' ? 'kamera' : 'ekran';
        const wrapper = getOrCreateVideoWrapper(id, typeStr, 'Kullanıcı');
        const video = wrapper.querySelector('video');
        video.srcObject = stream;
        video.play().catch(e=>e);
    } else if (tur === 'mik-ac' || tur === 'ekr-ses') {
        const audioId = `audio-${id}-${streamId}`;
        let audioEl = document.getElementById(audioId);
        if(!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = audioId;
            audioEl.className = 'remote-audio';
            audioEl.autoplay = true;
            audioEl.muted = isDeafened; // Eğer kulaklık kapalıysa otomatik sessiz
            document.getElementById('remoteAudioContainer').appendChild(audioEl);
        }
        audioEl.srcObject = stream;
        audioEl.play().catch(e=>e);
        
        // Uzak kullanıcının ses seviyesini bar üzerinde göster
        if(tur === 'mik-ac') {
            const wrap = getOrCreateVideoWrapper(id, 'kamera', '');
            sesAnaliziniBaslat(stream, `${id}-kamera`, false);
        }
    }
}

function baglantiKoprusuKur(hedefId, isInitiator) {
    if(peerConnections[hedefId]) peerConnections[hedefId].close(); 
    const pc = new RTCPeerConnection(stunSunuculari);
    peerConnections[hedefId] = pc;

    pc.ontrack = (event) => {
        const stream = event.streams[0];
        if(stream) beklemedekiYayinlar[stream.id] = stream; 
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice-adayi', { kime: hedefId, aday: e.candidate });
    };

    if (isInitiator) {
        pc.onnegotiationneeded = async () => {
            try {
                const teklif = await pc.createOffer();
                await pc.setLocalDescription(teklif);
                socket.emit('webrtc-teklif', { kime: hedefId, teklif: pc.localDescription });
            } catch (err) {}
        };
    }

    // Var olan aktif yayınları yeni gelene direkt gönder
    if (kameraYayini) pc.addTrack(kameraYayini.getVideoTracks()[0], kameraYayini);
    if (mikrofonYayini) pc.addTrack(mikrofonYayini.getAudioTracks()[0], mikrofonYayini);
    if (ekranYayini) {
        ekranYayini.getTracks().forEach(track => pc.addTrack(track, ekranYayini));
    }
}

socket.on('yeni-kullanici-geldi', (data) => {
    showToast(`👋 ${data.ad} odaya katıldı`);
    baglantiKoprusuKur(data.id, true); // Olan kişi teklifi hazırlar
});

socket.on('webrtc-teklif-geldi', async (data) => {
    if (!peerConnections[data.kimden]) baglantiKoprusuKur(data.kimden, false);
    const pc = peerConnections[data.kimden];
    await pc.setRemoteDescription(new RTCSessionDescription(data.teklif));
    const cevap = await pc.createAnswer();
    await pc.setLocalDescription(cevap);
    socket.emit('webrtc-cevap', { kime: data.kimden, cevap: pc.localDescription });
});

socket.on('webrtc-cevap-geldi', async (data) => await peerConnections[data.kimden].setRemoteDescription(new RTCSessionDescription(data.cevap)));
socket.on('ice-adayi-geldi', async (data) => { if(peerConnections[data.kimden]) await peerConnections[data.kimden].addIceCandidate(new RTCIceCandidate(data.aday)); });

// YENİ: Durum Göstergeleri (İkonlar)
socket.on('kullanici-listesi', (data) => {
    const listeKutusu = document.getElementById('aktifKullanicilarListesi');
    listeKutusu.innerHTML = "";
    const idLer = Object.keys(data.kullanicilar);
    document.getElementById('kisiSayaci').innerText = `${idLer.length} Online`;
    
    idLer.forEach(id => {
        const d = data.durumlar[id];
        const isMuted = !d.mikrofon ? 'muted-avatar' : '';
        const ikonlar = `
            <div class="status-icons">
                <i class="fas fa-video" style="color:${d.kamera ? 'var(--renk-aktif)' : 'var(--renk-gri)'};"></i>
                <i class="fas fa-desktop" style="color:${d.ekran ? 'var(--renk-basari)' : 'var(--renk-gri)'};"></i>
                <i class="fas ${d.kulaklik ? 'fa-headphones-slash' : 'fa-headphones'}" style="color:${d.kulaklik ? 'var(--renk-tehlike)' : 'var(--renk-gri)'};"></i>
                <i class="fas ${d.mikrofon ? 'fa-microphone' : 'fa-microphone-slash'}" style="color:${d.mikrofon ? 'var(--renk-basari)' : 'var(--renk-tehlike)'};"></i>
            </div>
        `;
        listeKutusu.innerHTML += `
            <div class="list-item">
                <div style="display:flex; align-items:center; gap:12px;">
                    <div class="list-avatar ${isMuted}" id="av-${id}">${data.kullanicilar[id][0]}</div>
                    <span style="color:#dbdee1;">${data.kullanicilar[id]}</span>
                </div>
                ${ikonlar}
            </div>`;
    });
});

socket.on('medya-durumu-geldi', (data) => {
    // Sinyalize Gelen Yayınları Eşleştir
    if (data.tur.includes('-ac')) {
        remoteYayinEkle(data.streamId, data.kimden, data.tur);
    } else if (data.tur === 'kam-kap') { 
        const w = document.getElementById(`kutu-${data.kimden}-kamera`); if(w) w.remove();
    } else if (data.tur === 'ekr-kap') { 
        const w = document.getElementById(`kutu-${data.kimden}-ekran`); if(w) w.remove();
    } else if (data.tur === 'mik-kap' || data.tur === 'ekr-ses-kap') { 
        document.querySelectorAll(`audio[id^="audio-${data.kimden}"]`).forEach(a => a.remove()); 
    }
});

// BUGFIX 4: Çıkan kullanıcının kalıntılarını tamamen temizle
socket.on('kullanici-ayrildi', (id) => {
    document.querySelectorAll(`[id*="-${id}-"]`).forEach(el => el.remove());
    if (peerConnections[id]) { peerConnections[id].close(); delete peerConnections[id]; }
    
    // beklemedekiYayinlar temizliği (Hafıza dostu)
    Object.keys(beklemedekiYayinlar).forEach(streamId => {
        // stream'i tutan aktif bir peer var mı kontrol et, yoksa sil
        let isUsed = false;
        Object.values(peerConnections).forEach(pc => {
            if(pc.getReceivers().some(r => r.track && beklemedekiYayinlar[streamId].getTracks().includes(r.track))) isUsed = true;
        });
        if(!isUsed) delete beklemedekiYayinlar[streamId];
    });
});

// --- 7. ALT KONTROLLER VE ÖZELLİKLER (DEAFEN, PTT, BUTONLAR) ---
kanalaKatilBtn.addEventListener('click', () => {
    kanalaKatilBtn.innerHTML = "<i class='fas fa-plug' style='font-size:16px;'></i> Bağlanıldı";
    kanalaKatilBtn.classList.add('active');
    mikrofonBtn.disabled = false; kulaklikBtn.disabled = false;
    kameraBtn.disabled = false; ekranBtn.disabled = false;
    gamerModBtn.style.display = "flex";
    
    socket.emit('kanala-katil', kullaniciAdi);
});

// DEAFEN (KULAKLIK) MANTIĞI
kulaklikBtn.addEventListener('click', () => {
    isDeafened = !isDeafened;
    const ikon = document.getElementById('kulak-icon');
    
    if (isDeafened) {
        ikon.className = "fas fa-headphones-slash";
        kulaklikBtn.classList.add('tehlike');
        document.querySelectorAll('.remote-audio').forEach(a => a.muted = true);
        
        // Kulaklık kapanırsa mikrofon da sussun
        if (mikrofonYayini && mikrofonYayini.getAudioTracks()[0].enabled) {
            wasMicEnabledBeforeDeafen = true;
            mikrofonBtn.click(); // Mikrofonu kapat
        }
        socket.emit('medya-durumu', { tur: 'kulak-kap', broadcast: true });
    } else {
        ikon.className = "fas fa-headphones";
        kulaklikBtn.classList.remove('tehlike');
        document.querySelectorAll('.remote-audio').forEach(a => a.muted = false);
        
        // Geri açıldığında mikrofon daha önce açıksa onu da aç
        if (wasMicEnabledBeforeDeafen) {
            wasMicEnabledBeforeDeafen = false;
            mikrofonBtn.click();
        }
        socket.emit('medya-durumu', { tur: 'kulak-ac', broadcast: true });
    }
});

// PUSH TO TALK (BAS KONUŞ)
pttToggleBtn.addEventListener('click', () => {
    isPttActive = !isPttActive;
    pttToggleBtn.innerHTML = `<i class="fas fa-keyboard" style="font-size:16px;"></i> Bas-Konuş: ${isPttActive ? 'AÇIK' : 'KAPALI'}`;
    pttToggleBtn.style.background = isPttActive ? "var(--renk-aktif)" : "transparent";
    pttToggleBtn.style.color = isPttActive ? "#fff" : "var(--renk-gri)";
    
    if(isMobile) document.getElementById('mobilePttBtn').style.display = isPttActive ? "block" : "none";
    
    // PTT açıldığında mikrofon varsa sustur
    if (isPttActive && mikrofonYayini && mikrofonYayini.getAudioTracks()[0].enabled) {
        mikrofonYayini.getAudioTracks()[0].enabled = false;
        document.getElementById('mik-icon').className = "fas fa-microphone-slash";
        mikrofonBtn.classList.remove('acik');
        socket.emit('medya-durumu', { tur: 'mik-kap', broadcast: true });
    }
});

// Masaüstü Space Tuşu Eventleri
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && isPttActive && document.activeElement !== mesajKutusu && !isPttKeyPressed) {
        isPttKeyPressed = true;
        if (mikrofonYayini) {
            mikrofonYayini.getAudioTracks()[0].enabled = true;
            document.getElementById('mik-icon').className = "fas fa-microphone";
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
            document.getElementById('mik-icon').className = "fas fa-microphone-slash";
            mikrofonBtn.classList.remove('acik');
            socket.emit('medya-durumu', { tur: 'mik-kap', broadcast: true });
        }
    }
});

// Mobil Bas-Konuş Dokunmatik
const mobilePtt = document.getElementById('mobilePttBtn');
mobilePtt.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if(mikrofonYayini) { mikrofonYayini.getAudioTracks()[0].enabled = true; socket.emit('medya-durumu', { tur: 'mik-ac', broadcast: true }); }
});
mobilePtt.addEventListener('touchend', (e) => {
    e.preventDefault();
    if(mikrofonYayini) { mikrofonYayini.getAudioTracks()[0].enabled = false; socket.emit('medya-durumu', { tur: 'mik-kap', broadcast: true }); }
});


// MİKROFON, KAMERA, EKRAN BUTONLARI
mikrofonBtn.addEventListener('click', async () => {
    if(isDeafened) { alert("Sesi tamamen kapattınız (Deafen), önce onu açmalısınız."); return; }
    
    const ikon = document.getElementById('mik-icon');
    if (!mikrofonYayini) {
        try {
            mikrofonYayini = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
            ikon.className = "fas fa-microphone";
            mikrofonBtn.classList.add("acik");
            
            // Eğer PTT aktifse kapalı başlat
            if(isPttActive) {
                mikrofonYayini.getAudioTracks()[0].enabled = false;
                ikon.className = "fas fa-microphone-slash";
                mikrofonBtn.classList.remove("acik");
            } else {
                socket.emit('medya-durumu', { tur: 'mik-ac', broadcast: true, id: mikrofonYayini.id });
            }
            
            trackleriTümBaglantilaraEkle(mikrofonYayini.getAudioTracks()[0], mikrofonYayini);
            sesAnaliziniBaslat(mikrofonYayini, 'yerel-kamera', true);
        } catch (e) { alert("Mikrofon açılamadı!"); }
    } else {
        const isEnabled = mikrofonYayini.getAudioTracks()[0].enabled;
        if(isEnabled) {
            mikrofonYayini.getAudioTracks()[0].enabled = false;
            ikon.className = "fas fa-microphone-slash";
            mikrofonBtn.classList.remove("acik");
            socket.emit('medya-durumu', { tur: 'mik-kap', broadcast: true });
        } else {
            mikrofonYayini.getAudioTracks()[0].enabled = true;
            ikon.className = "fas fa-microphone";
            mikrofonBtn.classList.add("acik");
            socket.emit('medya-durumu', { tur: 'mik-ac', broadcast: true, id: mikrofonYayini.id });
        }
    }
});

kameraBtn.addEventListener('click', async () => {
    const ikon = document.getElementById('kam-icon');
    if (!kameraYayini) {
        try {
            const videoAyar = isMobile ? { facingMode: onKameraMi ? "user" : "environment" } : { width: { ideal: 1280 }, height: { ideal: 720 } };
            kameraYayini = await navigator.mediaDevices.getUserMedia({ video: videoAyar });
            
            const wrapper = getOrCreateVideoWrapper('yerel', 'kamera', '');
            wrapper.querySelector('video').srcObject = kameraYayini;
            
            ikon.className = "fas fa-video";
            kameraBtn.classList.add("acik");
            if (isMobile) kameraCevirBtn.style.display = "block";
            
            trackleriTümBaglantilaraEkle(kameraYayini.getVideoTracks()[0], kameraYayini);
            socket.emit('medya-durumu', { tur: 'kam-ac', broadcast: true, id: kameraYayini.id });
        } catch (e) { alert("Kamera açılamadı!"); }
    } else {
        kameraYayini.getTracks().forEach(t => t.stop());
        kameraYayini = null;
        
        const w = document.getElementById('kutu-yerel-kamera'); if(w) w.remove();
        ikon.className = "fas fa-video-slash";
        kameraBtn.classList.remove("acik");
        kameraCevirBtn.style.display = "none";
        socket.emit('medya-durumu', { tur: 'kam-kap', broadcast: true });
    }
});

kameraCevirBtn.addEventListener('click', async () => {
    if (!kameraYayini) return;
    onKameraMi = !onKameraMi; 
    kameraYayini.getTracks().forEach(t => t.stop());
    try {
        kameraYayini = await navigator.mediaDevices.getUserMedia({ video: { facingMode: onKameraMi ? "user" : "environment" } });
        document.getElementById('vid-yerel-kamera').srcObject = kameraYayini;
        trackleriTümBaglantilaraEkle(kameraYayini.getVideoTracks()[0], kameraYayini);
    } catch (e) { }
});

ekranBtn.addEventListener('click', async () => {
    const ikon = document.getElementById('ekran-icon');
    if (!ekranYayini) {
        try {
            let medyaAyarlari = isMobile ? { video: true, audio: false } : { video: { width: { ideal: 1920 }, frameRate: { ideal: 30 } }, audio: true };
            ekranYayini = await navigator.mediaDevices.getDisplayMedia(medyaAyarlari);
            
            const wrapper = getOrCreateVideoWrapper('yerel', 'ekran', '');
            wrapper.querySelector('video').srcObject = ekranYayini;
            
            ekranBtn.classList.add("acik");
            ikon.style.color = "var(--renk-basari)";
            
            ekranYayini.getTracks().forEach(track => {
                trackleriTümBaglantilaraEkle(track, ekranYayini);
                const tip = track.kind === 'video' ? 'ekr-ac' : 'ekr-ses';
                socket.emit('medya-durumu', { tur: tip, broadcast: true, id: ekranYayini.id });
            });
            
            ekranYayini.getVideoTracks()[0].onended = () => ekranBtn.click();
        } catch (e) { }
    } else {
        ekranYayini.getTracks().forEach(t => t.stop());
        ekranYayini = null;
        
        const w = document.getElementById('kutu-yerel-ekran'); if(w) w.remove();
        ekranBtn.classList.remove("acik");
        ikon.style.color = "var(--renk-gri)";
        socket.emit('medya-durumu', { tur: 'ekr-kap', broadcast: true });
        socket.emit('medya-durumu', { tur: 'ekr-ses-kap', broadcast: true });
    }
});

gamerModBtn.addEventListener('click', () => {
    const aktifMi = gamerModBtn.classList.contains('active');
    if (!aktifMi) {
        gamerModBtn.classList.add('active');
        gamerModBtn.innerHTML = "<i class='fas fa-gamepad' style='font-size:16px;'></i> Gamer Mod: AÇIK";
        if (kameraYayini) kameraBtn.click(); 
    } else {
        gamerModBtn.classList.remove('active');
        gamerModBtn.innerHTML = "<i class='fas fa-gamepad' style='font-size:16px;'></i> Gamer Mod";
        gamerModBtn.style.background = "linear-gradient(135deg, #faa61a, #e68d00)";
    }
});


// --- 8. SOHBET VE ÇOKLU DOSYA SİSTEMİ ---
function ekranaMesajYaz(isim, metin, benMi, resimMi = false) {
    const div = document.createElement('div');
    div.className = benMi ? 'msg-container benim' : 'msg-container';
    const renk = benMi ? '#fff' : 'var(--renk-tehlike)';
    const saat = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let icerik = resimMi ? `<img src="${metin}" style="max-width:100%; border-radius:8px; margin-top:8px; cursor:pointer;" onclick="window.open(this.src)">` : metin;
    
    div.innerHTML = `<div style="margin-bottom:6px;"><span style="color:${renk}; font-weight:800; font-size:14px;">${isim}</span> <span style="color:var(--renk-gri); font-size:11px; margin-left:8px;">${saat}</span></div><div style="color:#dbdee1; line-height:1.5; font-size:14px;">${icerik}</div>`;
    mesajGecmisi.appendChild(div);
    mesajGecmisi.scrollTop = mesajGecmisi.scrollHeight;
}

mesajGonderBtn.addEventListener('click', () => {
    const mesaj = mesajKutusu.value.trim();
    if (mesaj !== "") {
        socket.emit('chat-mesaji', { ad: kullaniciAdi, metin: mesaj });
        ekranaMesajYaz(kullaniciAdi, mesaj, true);
        mesajKutusu.value = "";
    }
});

mesajKutusu.addEventListener('keypress', (e) => { if (e.key === 'Enter') mesajGonderBtn.click(); });

dosyaSecici.addEventListener('change', (e) => {
    const dosya = e.target.files[0];
    if (!dosya) return;
    const okuyucu = new FileReader();
    okuyucu.onload = function(event) {
        socket.emit('dosya-gonder', { ad: kullaniciAdi, data: event.target.result });
        ekranaMesajYaz(kullaniciAdi, event.target.result, true, true);
    };
    okuyucu.readAsDataURL(dosya);
});

socket.on('yeni-mesaj', (data) => {
    ekranaMesajYaz(data.ad, data.metin, false);
    // YENİ: Mobilde Chat Paneli Kapalıysa Badge Bildirimi
    if (window.innerWidth <= 850 && document.querySelector('.chat-panel').style.display !== 'flex') {
        okunmamisMesajSayisi++;
        const badge = document.getElementById('chatGostergeBadge');
        badge.innerText = okunmamisMesajSayisi;
        badge.style.display = "flex";
    }
});
socket.on('yeni-dosya', (data) => ekranaMesajYaz(data.ad, data.data, false, true));


// --- 9. ELECTRON (MASAÜSTÜ) EKRAN SEÇİCİ VE PENCERE ---
// BUGFIX 1: Try-Catch ile Electron güvenliği eklendi
const minBtn = document.getElementById('min-btn');
const closeBtn = document.getElementById('close-btn');
const titleBar = document.getElementById('bascord-title-bar');

if (!isMobile) {
    try {
        if (window.require) {
            const { ipcRenderer } = require('electron');
            
            if (minBtn) minBtn.addEventListener('click', () => ipcRenderer.send('window-minimize'));
            if (closeBtn) closeBtn.addEventListener('click', () => ipcRenderer.send('window-close'));

            ipcRenderer.on('ekran-seciciyi-ac', (event, kaynaklar) => {
                const modal = document.getElementById('ekranSeciciModal');
                const liste = document.getElementById('ekranListesi');
                liste.innerHTML = ""; 
                
                kaynaklar.forEach(kaynak => {
                    const div = document.createElement('div');
                    div.style = "width: 180px; background: var(--renk-zemin); border-radius: 8px; padding: 10px; cursor: pointer; text-align: center; border: 2px solid transparent; transition: 0.2s;";
                    div.onmouseover = () => div.style.borderColor = "var(--renk-aktif)";
                    div.onmouseout = () => div.style.borderColor = "transparent";
                    div.onclick = () => {
                        modal.style.display = "none";
                        ipcRenderer.send('ekran-secildi', kaynak.id);
                    };
                    
                    div.innerHTML = `
                        <img src="${kaynak.thumbnail}" style="width: 100%; height: 100px; object-fit: cover; border-radius: 4px; margin-bottom: 8px; background: black;">
                        <div style="color: #dbdee1; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${kaynak.name}">${kaynak.name}</div>
                    `;
                    liste.appendChild(div);
                });
                modal.style.display = "flex";
            });

            window.ekranPaylasiminiIptalEt = function() {
                document.getElementById('ekranSeciciModal').style.display = "none";
                ipcRenderer.send('ekran-secildi', null); 
            };
        } else {
            throw new Error("Tarayıcıdayız");
        }
    } catch(e) {
        if (titleBar) titleBar.style.display = 'none';
        document.body.style.paddingTop = '0';
    }
} else {
    if (titleBar) titleBar.style.display = 'none';
    document.body.style.paddingTop = '0';
}

// --- 10. MOBİL ALT MENÜ ---
window.sekmeDegistir = function(sekme) {
    const sidebar = document.querySelector('.sidebar');
    const chatPanel = document.querySelector('.chat-panel');
    const main = document.querySelector('.main');
    
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    
    if (sekme === 'kameralar') {
        document.getElementById('nav-kameralar').classList.add('active');
        if (window.innerWidth <= 850) {
            sidebar.style.setProperty('display', 'none', 'important');
            chatPanel.style.setProperty('display', 'none', 'important');
            main.style.setProperty('display', 'flex', 'important');
        }
    } else if (sekme === 'sohbet') {
        document.getElementById('nav-sohbet').classList.add('active');
        okunmamisMesajSayisi = 0;
        document.getElementById('chatGostergeBadge').style.display = "none"; // Sayacı gizle
        if (window.innerWidth <= 850) {
            sidebar.style.setProperty('display', 'none', 'important');
            main.style.setProperty('display', 'none', 'important');
            chatPanel.style.setProperty('display', 'flex', 'important');
        }
    } else if (sekme === 'ayarlar') {
        document.getElementById('nav-ayarlar').classList.add('active');
        if (window.innerWidth <= 850) {
            main.style.setProperty('display', 'none', 'important');
            chatPanel.style.setProperty('display', 'none', 'important');
            sidebar.style.setProperty('display', 'flex', 'important');
        }
    }
};