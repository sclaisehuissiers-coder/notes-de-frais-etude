/* NOTES DE FRAIS ETUDE — prise de vue et envoi automatique vers Google Drive */
'use strict';

// Lien par défaut (laisser vide si l'application est hébergée publiquement : il sera saisi dans les Réglages)
const LIEN_PAR_DEFAUT = '';
const COTE_MAX = 2400;      // px, côté le plus long après réduction
const QUALITE_JPEG = 0.85;

const $ = (id) => document.getElementById(id);
const etat = (txt, cls) => { const e = $('etat'); e.textContent = txt; e.className = cls || ''; };

/* ---------- Configuration ---------- */
function lien() { try { return localStorage.getItem('ndf_lien') || LIEN_PAR_DEFAUT; } catch { return LIEN_PAR_DEFAUT; } }
function enregistrerLien(v) { try { localStorage.setItem('ndf_lien', v); } catch {} }
(function lireLienDansAdresse() {
  const m = /[#?&]cfg=([^&]+)/.exec(location.href);
  if (m) { enregistrerLien(decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname); }
})();

/* ---------- File d'attente persistante (IndexedDB) ---------- */
let dbP = null;
function db() {
  if (!dbP) dbP = new Promise((ok, ko) => {
    const r = indexedDB.open('ndf', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('attente', { keyPath: 'filename' });
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
  return dbP;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((ok, ko) => {
    const t = d.transaction('attente', mode); const s = t.objectStore('attente');
    const res = fn(s); t.oncomplete = () => ok(res && res.result); t.onerror = () => ko(t.error);
  });
}
const ajouter = (item) => tx('readwrite', (s) => s.put(item));
const retirer = (k) => tx('readwrite', (s) => s.delete(k));
const tous = () => tx('readonly', (s) => s.getAll());

async function majCompteur() {
  const n = (await tous()).length; const b = $('nbAttente');
  b.textContent = n; b.style.display = n ? 'block' : 'none';
  return n;
}

/* ---------- Envoi ---------- */
let envoiEnCours = false;
function enBase64(blob) {
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => ko(r.error);
    r.readAsDataURL(blob);
  });
}
async function envoyerTout() {
  if (envoiEnCours) return; envoiEnCours = true;
  try {
    const url = lien();
    const liste = await tous();
    if (!liste.length) { etat('Prêt — touchez le bouton rouge', 'vert'); return; }
    if (!url) { etat(`${liste.length} photo(s) en attente — configurez le lien dans ⚙︎`, 'rouge'); return; }
    if (!navigator.onLine) { etat(`${liste.length} photo(s) en attente — hors connexion, envoi automatique au retour du réseau`, 'rouge'); return; }
    let i = 0;
    for (const it of liste) {
      i++; etat(`Envoi vers Google Drive… ${i}/${liste.length}`);
      const corps = JSON.stringify({ filename: it.filename, mimeType: it.blob.type || 'image/jpeg',
        prisLe: it.prisLe, appareil: navigator.userAgent.slice(0, 120), data: await enBase64(it.blob) });
      const rep = await fetch(url, { method: 'POST', body: corps, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
      const j = await rep.json();
      if (!j.ok) throw new Error(j.error || 'refus du serveur');
      await retirer(it.filename); await majCompteur();
    }
    etat(`✓ Enregistré dans Google Drive (${liste.length})`, 'vert');
  } catch (e) {
    const n = await majCompteur();
    etat(`Envoi interrompu (${e.message}) — ${n} en attente, nouvel essai automatique`, 'rouge');
    setTimeout(envoyerTout, 20000);
  } finally { envoiEnCours = false; }
}

/* ---------- Photographie ---------- */
function horodatage() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return { nom: `NDF_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}m${p(d.getSeconds())}_${Math.random().toString(36).slice(2, 6)}.jpg`,
           lisible: d.toLocaleString('fr-FR') };
}
function versJpeg(source, w, h) {
  const r = Math.min(1, COTE_MAX / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * r); c.height = Math.round(h * r);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, 'image/jpeg', QUALITE_JPEG));
}
async function stocker(blob) {
  const h = horodatage();
  await ajouter({ filename: h.nom, blob, prisLe: h.lisible });
  if (navigator.vibrate) navigator.vibrate(60);
  await majCompteur(); envoyerTout();
}
function flash() { const f = $('flash'); f.style.opacity = .85; setTimeout(() => (f.style.opacity = 0), 120); }

const video = $('viseur');
let flux = null;
async function demarrerCamera() {
  try {
    flux = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } } });
    video.srcObject = flux; await video.play(); $('accueil').style.display = 'none';
  } catch (e) {
    flux = null;
    const a = $('accueil'); a.style.display = 'flex';
    a.textContent = 'Viseur indisponible (autorisation caméra refusée). Touchez le bouton rouge pour utiliser l’appareil photo du téléphone.';
  }
}
async function declencher() {
  if (!flux || !video.videoWidth) { $('fichier').click(); return; }
  flash();
  await stocker(await versJpeg(video, video.videoWidth, video.videoHeight));
}
async function depuisFichier(f) {
  if (!f) return;
  const img = await createImageBitmap(f).catch(() => null);
  await stocker(img ? await versJpeg(img, img.width, img.height) : f);
}

/* ---------- Réglages ---------- */
async function tester() {
  const v = $('lien').value.trim(); const info = $('infoReglages');
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\?.*k=/.test(v)) { info.innerHTML = '<span class="rouge">Lien non reconnu.</span>'; return; }
  enregistrerLien(v); info.textContent = 'Test de la liaison…';
  try {
    const j = await (await fetch(v)).json();
    info.innerHTML = j.ok ? `<span class="vert">✓ Liaison établie avec le Drive de ${j.compte}</span>` : `<span class="rouge">Refus : ${j.error}</span>`;
    if (j.ok) envoyerTout();
  } catch (e) { info.innerHTML = `<span class="rouge">Échec du test : ${e.message}</span>`; }
}

/* ---------- Démarrage ---------- */
$('declencheur').onclick = declencher;
$('btnSysteme').onclick = () => $('fichier').click();
$('fichier').onchange = (e) => { depuisFichier(e.target.files[0]); e.target.value = ''; };
$('compteur').onclick = envoyerTout;
$('btnReglages').onclick = () => { $('lien').value = lien(); $('infoReglages').textContent = ''; $('reglages').style.display = 'block'; };
$('btnFermer').onclick = () => { $('reglages').style.display = 'none'; envoyerTout(); };
$('btnEnregistrer').onclick = tester;
addEventListener('online', envoyerTout);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { if (!flux || !flux.active) demarrerCamera(); envoyerTout(); }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

demarrerCamera();
majCompteur().then(() => { if (!lien()) { $('btnReglages').click(); } envoyerTout(); });
