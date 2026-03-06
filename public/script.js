const socket = io();

// --- 1. CİHAZ TESPİTİ ---
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

// --- 2. HAFIZA VE İSİM (ÇÖKME HATASI DÜZELTİLDİ) ---
let kullaniciAdi = localStorage.getItem('bascord_isim');
if (!kullaniciAdi) {
    try {
        // Telefonlar ve tarayıcılar için isim sorma kutusu
        kullaniciAdi = prompt("Bascord'a hoş geldin! İsmini belirle:") || "Anonim";
    } catch (e) {
        // Electron (PC) prompt desteklemediği için çökmesin diye otomatik isim atanır
        kullaniciAdi = "Gamer_" + Math.floor(Math.random() * 1000);
    }
    localStorage.setItem('bascord_isim', kullaniciAdi);
}
document.getElementById('benimAdimGosterge').innerText = kullaniciAdi;
document.getElementById('benimAvatarim').innerText = kullaniciAdi.charAt(0);

// İSİM DEĞİŞTİRME - YENİ MODAL SİSTEMİ
document.getElementById('isimDegistirBtn').addEventListener('click', () => {
    const isimModal = document.getElementById('isimModal');
    const input = document.getElementById('yeniIsimInput');
    
    if (isimModal && input) {
        input.value = kullaniciAdi;
        isimModal.style.display = 'flex';
        input.focus();
        
        document.getElementById('isimKaydetBtn').onclick = () => {
            let yeniIsim = input.value.trim();
            if (yeniIsim !== "") {
                localStorage.setItem('bascord_isim', yeniIsim);
                location.reload();
            }
        };
        
        // Enter tuşuna basınca da kaydetsin
        input.onkeypress = (e) => {
            if (e.key === 'Enter') document.getElementById('isimKaydetBtn').click();
        };
    }
});

// --- 3. HTML SEÇİCİLERİ ---
const kanalaKatilBtn = document.getElementById('kanalaKatilBtn');
const mikrofonBtn = document.getElementById('mikrofonBtn');
const kameraBtn = document.getElementById('kameraBtn');
const kameraCevirBtn = document.getElementById('kameraCevirBtn'); 
const ekranBtn = document.getElementById('ekranBtn');
const gamerModBtn = document.getElementById('gamerModBtn');
const mesajKutusu = document.getElementById('mesajKutusu');
const mesajGonderBtn = document.getElementById('mesajGonderBtn');
const mesajGecmisi = document.getElementById('mesajGecmisi');
const dosyaSecici = document.getElementById('dosyaSecici');

const karsiEkranVideo = document.getElementById('karsiEkran');
const kontrolIsteBtn = document.getElementById('kontrolIsteBtn');
const lazerIsaretci = document.getElementById('remote-pointer');

let kameraYayini = null; let ekranYayini = null; let mikrofonYayini = null;
let peerConnection; let karsiKullaniciId = null;
let kimlikler = { kamera: null, ekran: null, mikrofon: null };
let uzaktanKontrolIzniVerildi = false;
let onKameraMi = true;

let senders = { kamera: null, ekran: null, mikrofon: null };
let beklemedekiYayinlar = {}; 

const stunSunuculari = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
};

// --- 4. VİDEO BÜYÜTME (TAM EKRAN) ---
window.tamEkranYap = function(elementId) {
    const videoElementi = document.getElementById(elementId);
    if (videoElementi.requestFullscreen) videoElementi.requestFullscreen();
    else if (videoElementi.webkitRequestFullscreen) videoElementi.webkitRequestFullscreen();
};

// --- 5. TEAMS UZAKTAN KONTROL ---
if (!isMobile) {
    kontrolIsteBtn.addEventListener('click', () => {
        if (karsiKullaniciId) {
            socket.emit('kontrol-iste', { kime: karsiKullaniciId });
            kontrolIsteBtn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Bekleniyor...";
            kontrolIsteBtn.disabled = true;
        }
    });

    karsiEkranVideo.addEventListener('click', (event) => {
        if (!uzaktanKontrolIzniVerildi) return;
        const rect = karsiEkranVideo.getBoundingClientRect();
        const yuzdeX = ((event.clientX - rect.left) / rect.width) * 100;
        const yuzdeY = ((event.clientY - rect.top) / rect.height) * 100;
        socket.emit('fare-hareketi', { kime: karsiKullaniciId, x: yuzdeX, y: yuzdeY });
    });
}

socket.on('kontrol-istegi-geldi', (data) => {
    const onay = confirm(`⚠️ ${data.ad} ekranınızı işaretleyerek kontrol etmek istiyor. İzin veriyor musunuz?`);
    socket.emit('kontrol-cevap', { kime: data.kimden, onay: onay });
});

socket.on('kontrol-cevabi-geldi', (data) => {
    if (data.onay) {
        uzaktanKontrolIzniVerildi = true;
        kontrolIsteBtn.innerHTML = "<i class='fas fa-check-circle'></i> Kontrol Aktif";
        kontrolIsteBtn.style.background = "#ed4245";
        kontrolIsteBtn.style.borderColor = "#ed4245";
    } else {
        kontrolIsteBtn.innerHTML = "<i class='fas fa-hand-pointer'></i> İzin İste";
        kontrolIsteBtn.disabled = false;
    }
});

socket.on('karsi-fare-hareketi', (data) => {
    lazerIsaretci.style.display = "block";
    lazerIsaretci.style.left = data.x + "%";
    lazerIsaretci.style.top = data.y + "%";
    setTimeout(() => { lazerIsaretci.style.display = "none"; }, 2000);
});

// --- 6. SOHBET VE DOSYA ---
function ekranaMesajYaz(isim, metin, benMi, resimMi = false) {
    const div = document.createElement('div');
    div.className = benMi ? 'msg-container benim' : 'msg-container';
    const renk = benMi ? '#fff' : '#ed4245';
    const saat = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let icerik = resimMi ? `<img src="${metin}" style="max-width:100%; border-radius:8px; margin-top:8px; cursor:pointer;" onclick="window.open(this.src)">` : metin;
    
    div.innerHTML = `<div style="margin-bottom:6px;"><span style="color:${renk}; font-weight:800; font-size:14px;">${isim}</span> <span style="color:#80848e; font-size:11px; margin-left:8px;">${saat}</span></div><div style="color:#dbdee1; line-height:1.5; font-size:14px;">${icerik}</div>`;
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

socket.on('yeni-mesaj', (data) => ekranaMesajYaz(data.ad, data.metin, false));
socket.on('yeni-dosya', (data) => ekranaMesajYaz(data.ad, data.data, false, true));

// --- 7. EFEKT PANOSU VE YEŞİL PARLAMA ---
window.sesGonder = function(url) {
    new Audio(url).play();
    socket.emit('ses-efekti', url);
};
socket.on('ses-oynat', (url) => { new Audio(url).play().catch(e => e); });

function sesAnaliziniBaslat(stream) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const kaynak = audioContext.createMediaStreamSource(stream);
    const analizor = audioContext.createAnalyser();
    analizor.fftSize = 256;
    kaynak.connect(analizor);
    
    const veriDizisi = new Uint8Array(analizor.frequencyBinCount);
    let suAnKonusuyorMu = false;

    setInterval(() => {
        analizor.getByteFrequencyData(veriDizisi);
        let toplam = veriDizisi.reduce((a, b) => a + b, 0);
        let ortalamaSes = toplam / veriDizisi.length;
        
        let yeniDurum = ortalamaSes > 30;
        if (yeniDurum !== suAnKonusuyorMu) {
            suAnKonusuyorMu = yeniDurum;
            socket.emit('konusuyor-mu', suAnKonusuyorMu);
            parlamayiAyarla(socket.id, suAnKonusuyorMu);
        }
    }, 200);
}

function parlamayiAyarla(id, durum) {
    const avatar = document.getElementById(`av-${id}`);
    if (avatar) {
        if (durum) avatar.classList.add('speaking');
        else avatar.classList.remove('speaking');
    }
}
socket.on('konusma-durumu-geldi', (data) => parlamayiAyarla(data.id, data.durum));

// --- 8. WEBRTC MÜHENDİSLİĞİ ---
function trackEkleVeOptimizeEt(track, stream) {
    if (!peerConnection) return;
    try {
        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === track.kind);
        if (sender) sender.replaceTrack(track);
        else {
            peerConnection.addTrack(track, stream);
            if (track.kind === 'video' && !isMobile) track.contentHint = 'detail'; 
        }
    } catch(err) { console.log("Track hatası:", err); }
}

function yerlestirBekleyenYayin(streamId) {
    const stream = beklemedekiYayinlar[streamId];
    if (!stream) return; 
    
    if (streamId === kimlikler.ekran) {
        const ekranVid = document.getElementById('karsiEkran');
        ekranVid.srcObject = stream;
        document.getElementById('kutu-karsiEkran').style.display = "block";
        ekranVid.load(); 
        ekranVid.play().catch(e=>e); 
        if (!isMobile) kontrolIsteBtn.style.display = "flex"; 
    } else if (streamId === kimlikler.kamera) {
        const karsiKamera = document.getElementById('karsiKamera');
        karsiKamera.srcObject = stream;
        document.getElementById('kutu-karsiKamera').style.display = "block";
        karsiKamera.load();
        karsiKamera.play().catch(e=>e);
    } else if (streamId === kimlikler.mikrofon) {
        const karsiSes = document.getElementById('karsiSes');
        karsiSes.srcObject = stream;
        karsiSes.play().catch(e=>e);
    }
}

function baglantiKoprusuKur(hedefId) {
    karsiKullaniciId = hedefId;
    if(peerConnection) peerConnection.close(); 
    peerConnection = new RTCPeerConnection(stunSunuculari);
    
    senders = { kamera: null, ekran: null, mikrofon: null };

    peerConnection.ontrack = (event) => {
        const stream = event.streams[0];
        if(stream) {
            beklemedekiYayinlar[stream.id] = stream; 
            yerlestirBekleyenYayin(stream.id); 
        }
    };

    peerConnection.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice-adayi', { kime: karsiKullaniciId, aday: e.candidate });
    };

    peerConnection.onnegotiationneeded = async () => {
        try {
            const teklif = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(teklif);
            socket.emit('webrtc-teklif', { kime: karsiKullaniciId, teklif: peerConnection.localDescription });
        } catch (err) {}
    };

    if (kameraYayini) yayiniKarsiyaGonder(kameraYayini, 'kam-ac');
    if (mikrofonYayini) yayiniKarsiyaGonder(mikrofonYayini, 'mik-ac');
    if (ekranYayini) yayiniKarsiyaGonder(ekranYayini, 'ekr-ac');
}

function yayiniKarsiyaGonder(stream, tur) {
    if (!peerConnection || !stream) return;
    const track = stream.getTracks()[0]; 

    try {
        if (tur === 'mik-ac') {
            if (senders.mikrofon) senders.mikrofon.replaceTrack(track); 
            else senders.mikrofon = peerConnection.addTrack(track, stream); 
        } 
        else if (tur === 'kam-ac') {
            if (senders.kamera) senders.kamera.replaceTrack(track);
            else senders.kamera = peerConnection.addTrack(track, stream);
        } 
        else if (tur === 'ekr-ac') {
            if (senders.ekran) senders.ekran.replaceTrack(track);
            else {
                senders.ekran = peerConnection.addTrack(track, stream);
                if (!isMobile) track.contentHint = 'detail'; 
            }
        }
        socket.emit('medya-durumu', { kime: karsiKullaniciId, tur: tur, id: stream.id });
    } catch(err) { console.log("Track hatası:", err); }
}

// --- 9. ANA BUTONLAR ---
kanalaKatilBtn.addEventListener('click', () => {
    kanalaKatilBtn.innerHTML = "<i class='fas fa-plug' style='font-size:16px;'></i> Bağlanıldı";
    kanalaKatilBtn.classList.add('active');
    mikrofonBtn.disabled = false;
    kameraBtn.disabled = false;
    ekranBtn.disabled = false;
    gamerModBtn.style.display = "flex";
    
    document.getElementById('karsiSes').play().catch(()=>{});
    socket.emit('kanala-katil', kullaniciAdi);
});

mikrofonBtn.addEventListener('click', async () => {
    const ikon = document.getElementById('mik-icon');
    if (!mikrofonYayini) {
        try {
            const sesAyarlari = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
            mikrofonYayini = await navigator.mediaDevices.getUserMedia({ audio: sesAyarlari });
            ikon.className = "fas fa-microphone";
            mikrofonBtn.classList.add("acik");
            yayiniKarsiyaGonder(mikrofonYayini, 'mik-ac');
            sesAnaliziniBaslat(mikrofonYayini);
        } catch (e) { alert("Mikrofon açılamadı!"); }
    } else {
        mikrofonYayini.getTracks().forEach(t => t.stop());
        mikrofonYayini = null;
        if (senders.mikrofon) senders.mikrofon.replaceTrack(null);
        ikon.className = "fas fa-microphone-slash";
        mikrofonBtn.classList.remove("acik");
        if (karsiKullaniciId) socket.emit('medya-durumu', { kime: karsiKullaniciId, tur: 'mik-kap' });
    }
});

kameraBtn.addEventListener('click', async () => {
    const ikon = document.getElementById('kam-icon');
    if (!kameraYayini) {
        try {
            const videoAyar = isMobile ? { facingMode: onKameraMi ? "user" : "environment" } : { width: { ideal: 1280 }, height: { ideal: 720 } };
            kameraYayini = await navigator.mediaDevices.getUserMedia({ video: videoAyar });
            document.getElementById('yerelKamera').srcObject = kameraYayini;
            document.getElementById('kutu-yerelKamera').style.display = "block";
            ikon.className = "fas fa-video";
            kameraBtn.classList.add("acik");
            if (isMobile) kameraCevirBtn.style.display = "block";
            yayiniKarsiyaGonder(kameraYayini, 'kam-ac');
        } catch (e) { alert("Kamera açılamadı!"); }
    } else {
        kameraYayini.getTracks().forEach(t => t.stop());
        kameraYayini = null;
        if (senders.kamera) senders.kamera.replaceTrack(null); 
        document.getElementById('kutu-yerelKamera').style.display = "none";
        ikon.className = "fas fa-video-slash";
        kameraBtn.classList.remove("acik");
        kameraCevirBtn.style.display = "none";
        if (karsiKullaniciId) socket.emit('medya-durumu', { kime: karsiKullaniciId, tur: 'kam-kap' });
    }
});

kameraCevirBtn.addEventListener('click', async () => {
    if (!kameraYayini) return;
    onKameraMi = !onKameraMi; 
    kameraYayini.getTracks().forEach(t => t.stop());
    try {
        kameraYayini = await navigator.mediaDevices.getUserMedia({ video: { facingMode: onKameraMi ? "user" : "environment" } });
        document.getElementById('yerelKamera').srcObject = kameraYayini;
        if (senders.kamera) senders.kamera.replaceTrack(kameraYayini.getVideoTracks()[0]);
    } catch (e) { console.error("Kamera döndürme hatası:", e); }
});

ekranBtn.addEventListener('click', async () => {
    const ikon = document.getElementById('ekran-icon');
    if (!ekranYayini) {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                alert("📱 UYARI: Cihazınız ekran paylaşımını desteklemiyor."); return;
            }
            let medyaAyarlari;
            if (isMobile) { medyaAyarlari = { video: true, audio: false }; } 
            else {
                const kaliteSecim = document.getElementById('kaliteSecici').value;
                const videoAyarlari = kaliteSecim === "1080" ? 
                    { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } } : 
                    { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
                medyaAyarlari = { video: videoAyarlari, audio: false };
            }
            ekranYayini = await navigator.mediaDevices.getDisplayMedia(medyaAyarlari);
            if(ekranYayini.getVideoTracks().length > 0 && !isMobile) ekranYayini.getVideoTracks()[0].contentHint = "detail";
            const yerelEkran = document.getElementById('yerelEkran');
            yerelEkran.srcObject = ekranYayini;
            document.getElementById('kutu-yerelEkran').style.display = "block";
            yerelEkran.load(); 
            ekranBtn.classList.add("acik");
            ikon.style.color = "#23a559";
            yayiniKarsiyaGonder(ekranYayini, 'ekr-ac');
            ekranYayini.getVideoTracks()[0].onended = () => ekranBtn.click();
        } catch (e) { 
            if (e.name !== 'NotAllowedError') alert("Ekran paylaşılamadı.");
        }
    } else {
        ekranYayini.getTracks().forEach(t => t.stop());
        ekranYayini = null;
        if (senders.ekran) senders.ekran.replaceTrack(null); 
        document.getElementById('kutu-yerelEkran').style.display = "none";
        ekranBtn.classList.remove("acik");
        ikon.style.color = "#ed4245";
        if (karsiKullaniciId) socket.emit('medya-durumu', { kime: karsiKullaniciId, tur: 'ekr-kap' });
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

// --- 10. SİNYALLER VE LİSTELEME ---
socket.on('kullanici-listesi', (liste) => {
    const listeKutusu = document.getElementById('aktifKullanicilarListesi');
    listeKutusu.innerHTML = "";
    const idLer = Object.keys(liste);
    document.getElementById('kisiSayaci').innerText = `${idLer.length} Online`;
    idLer.forEach(id => {
        listeKutusu.innerHTML += `<div class="list-item"><div class="list-avatar" id="av-${id}">${liste[id][0]}</div><span style="color:#dbdee1;">${liste[id]}</span></div>`;
    });
});

socket.on('yeni-kullanici-geldi', (id) => baglantiKoprusuKur(id));

socket.on('webrtc-teklif-geldi', async (data) => {
    if (!peerConnection) baglantiKoprusuKur(data.kimden);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.teklif));
    const cevap = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(cevap);
    socket.emit('webrtc-cevap', { kime: data.kimden, cevap: peerConnection.localDescription });
});

socket.on('webrtc-cevap-geldi', async (data) => await peerConnection.setRemoteDescription(new RTCSessionDescription(data.cevap)));
socket.on('ice-adayi-geldi', async (data) => peerConnection && await peerConnection.addIceCandidate(new RTCIceCandidate(data.aday)));

socket.on('medya-durumu-geldi', (data) => {
    if (data.tur === 'kam-ac') { kimlikler.kamera = data.id; yerlestirBekleyenYayin(data.id); }
    else if (data.tur === 'ekr-ac') { kimlikler.ekran = data.id; yerlestirBekleyenYayin(data.id); }
    else if (data.tur === 'mik-ac') { kimlikler.mikrofon = data.id; yerlestirBekleyenYayin(data.id); }
    else if (data.tur === 'kam-kap') { document.getElementById('karsiKamera').srcObject = null; document.getElementById('kutu-karsiKamera').style.display = "none"; }
    else if (data.tur === 'ekr-kap') { karsiEkranVideo.srcObject = null; document.getElementById('kutu-karsiEkran').style.display = "none"; kontrolIsteBtn.style.display = "none"; uzaktanKontrolIzniVerildi = false; }
    else if (data.tur === 'mik-kap') { document.getElementById('karsiSes').srcObject = null; }
});

socket.on('kullanici-ayrildi', () => {
    document.getElementById('karsiKamera').srcObject = null;
    document.getElementById('kutu-karsiKamera').style.display = "none";
    karsiEkranVideo.srcObject = null;
    document.getElementById('kutu-karsiEkran').style.display = "none";
    kontrolIsteBtn.style.display = "none";
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
});

// --- 11. MASAÜSTÜ (ELECTRON) PENCERE KONTROLLERİ (HATA KORUMALI) ---
const minBtn = document.getElementById('min-btn');
const closeBtn = document.getElementById('close-btn');
const titleBar = document.getElementById('bascord-title-bar');

if (!isMobile) {
    // Bilgisayardaysak siyah çubuk kalsın ve tuşları aktif edelim
    if (minBtn) {
        minBtn.addEventListener('click', () => {
            try { require('electron').ipcRenderer.send('window-minimize'); } catch(e) {}
        });
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            try { require('electron').ipcRenderer.send('window-close'); } catch(e) { window.close(); }
        });
    }
} else {
    // Eğer telefondan giriliyorsa bu siyah çubuğu tamamen gizle
    if (titleBar) titleBar.style.display = 'none';
    document.body.style.paddingTop = '0';
}

// --- 12. MOBİL ALT MENÜ KONTROLLERİ ---
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