/* Aplikasi web persediaan FEFO (v2). Semua perubahan data lewat fungsi di database.
   Hak akses sebenarnya dijaga oleh database, bukan oleh tampilan ini. */

var sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY);
var me = null;

// Nama, slogan, dan logo diatur di tema.js
var TEMA = window.TEMA || { nama: "StokManis", tagline: "Catatan stok dessert", logo: "\uD83C\uDF61" };
document.title = TEMA.nama;
document.querySelectorAll(".nama-app").forEach(function (e) { e.textContent = TEMA.nama; });
document.querySelectorAll(".tagline-app").forEach(function (e) { e.textContent = TEMA.tagline; });
document.querySelectorAll(".logo-app").forEach(function (e) { e.textContent = TEMA.logo; });

var HR = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
var $ = function (i) { return document.getElementById(i); };
var rp = function (n) { return "Rp" + Math.round(n).toLocaleString("id-ID"); };
var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); };
var hariIni = function () { return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }); };
var tambahHari = function (s, n) { return new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10); };
var selisihHari = function (a, b) { return Math.round((Date.parse(a) - Date.parse(b)) / 864e5); };
var tgl = function (s) { return new Date(s + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short" }); };
var jam = function (s) { return new Date(s).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }); };
var pct = function (a, b) { return b ? Math.round(a / b * 100) : 0; };
function say(t, ok) { var m = $("msg"); m.textContent = t; m.className = ok ? "ok" : "err"; }

// ---------- Login ----------
async function mulai() {
  var s = await sb.auth.getSession();
  if (s.data && s.data.session) return tampilApp(s.data.session.user);
  $("login").hidden = false; $("app").hidden = true;
}

$("masuk").onclick = async function () {
  var r = await sb.auth.signInWithPassword({ email: $("em").value.trim(), password: $("pw").value });
  if (r.error) {
    var m = r.error.message || "";
    return say(/invalid login/i.test(m) ? "Email atau kata sandi salah."
      : /not confirmed/i.test(m) ? "Akun belum dikonfirmasi. Hubungi owner."
      : "Login gagal: " + m, false);
  }
  say("", true); tampilApp(r.data.user);
};
$("keluar").onclick = async function () { await sb.auth.signOut(); location.reload(); };

async function tampilApp(user) {
  var p = await sb.from("profiles").select("id,nama,role").eq("id", user.id).single();
  if (p.error || !p.data) { await sb.auth.signOut(); $("login").hidden = false; return say("Akun belum terdaftar di sistem. Hubungi owner.", false); }
  me = p.data;
  $("login").hidden = true; $("app").hidden = false;
  $("siapa").textContent = me.nama + " (" + me.role + ")";
  document.querySelectorAll("[data-owner]").forEach(function (b) { b.hidden = me.role !== "owner"; });
  await muatProduk();
  buka("stok");
}

// ---------- Menu ----------
document.querySelectorAll("#tabs button").forEach(function (b) { b.onclick = function () { buka(b.dataset.p); }; });
function buka(nama) {
  document.querySelectorAll(".panel").forEach(function (p) { p.hidden = p.id !== nama; });
  document.querySelectorAll("#tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.p === nama); });
  say("", true);
  if (nama === "stok") tampilStok();
  if (nama === "penjualan") tampilHariIni();
  if (nama === "laporan" && !$("sd").value) { setRentang(13); }
  if (nama === "koreksi") { if (!$("kd").value) $("kd").value = hariIni(); muatKoreksi(); muatAudit(); }
  if (nama === "qris" && !$("qs").value) { $("qs").value = hariIni(); $("qd").value = tambahHari(hariIni(), -6); }
  if (nama === "produk") tampilProduk();
}

// ---------- Produk (pilihan di formulir) ----------
async function muatProduk() {
  var r = await sb.from("products").select("id,nama,harga_jual,masa_jual_hari").eq("aktif", true).order("id");
  var opsi = (r.data || []).map(function (p) { return '<option value="' + p.id + '">' + esc(p.nama) + "</option>"; }).join("");
  $("pp").innerHTML = $("sp").innerHTML = opsi;
}

// ---------- Stok FEFO ----------
async function tampilStok() {
  await sb.rpc("tutup_kedaluwarsa");
  var r = await sb.from("batches").select("id,tanggal_produksi,expires_on,sisa,product_id,products(nama,masa_jual_hari)")
    .gt("sisa", 0).order("expires_on").order("tanggal_produksi");
  if (r.error) return say("Stok gagal dimuat: " + r.error.message, false);
  var h = "", seen = {}, today = hariIni();
  (r.data || []).forEach(function (b) {
    var rem = selisihHari(b.expires_on, today);
    if (rem < 1) return;
    var masa = b.products.masa_jual_hari, age = masa - rem, last = rem === 1, first = !seen[b.product_id];
    seen[b.product_id] = 1;
    var segs = ""; for (var k = 0; k < masa; k++) segs += '<i class="' + (k < age ? "used" : "") + '"></i>';
    h += '<div class="batch"><div><b>' + esc(b.products.nama) + "</b>" +
      (first ? '<span class="tag t-first">Prioritas keluar (FEFO)</span>' : "") +
      (last ? '<span class="tag t-last">Batas akhir penjualan hari ini</span>' : "") +
      '<div class="meta">Diproduksi ' + tgl(b.tanggal_produksi) + (last ? "" : ", sisa masa jual " + rem + " hari") + "</div></div>" +
      '<div class="qty">' + b.sisa + '</div><div class="shelf' + (last ? " last" : "") + '" aria-hidden="true">' + segs + "</div></div>";
  });
  $("stokList").innerHTML = h || '<p class="meta">Belum terdapat stok. Silakan catat produksi terlebih dahulu.</p>';
}

// ---------- Produksi dan penjualan ----------
$("pgo").onclick = async function () {
  var q = Math.floor(+$("pq").value);
  var r = await sb.rpc("catat_produksi", { p_product: +$("pp").value, p_jumlah: q });
  if (r.error) return say(r.error.message, false);
  say("Data produksi " + q + " unit " + $("pp").selectedOptions[0].text + " berhasil disimpan.", true);
};

$("sm").onchange = function () { $("refBox").hidden = $("sm").value !== "qris"; };

$("sgo").onclick = async function () {
  var q = Math.floor(+$("sq").value), qris = $("sm").value === "qris";
  var r = await sb.rpc("catat_penjualan", { p_product: +$("sp").value, p_jumlah: q, p_metode: $("sm").value, p_ref: qris ? $("sref").value : null });
  if (r.error) return say(r.error.message, false);
  var rinci = r.data.rincian.map(function (x) { return x.jumlah + " unit dari batch " + tgl(x.tanggal_produksi); }).join(", ");
  say("Penjualan " + q + " unit " + $("sp").selectedOptions[0].text + " dicatat dengan urutan FEFO: " + rinci + ". Pendapatan " + rp(r.data.pendapatan) + ".", true);
  $("sref").value = "";
  tampilHariIni();
};

// Karyawan hanya bisa melihat penjualan hari ini (dibatasi oleh database).
async function tampilHariIni() {
  var r = await sb.from("sales").select("id,jumlah,harga_per_unit,metode_bayar,ref_qris,created_at,products(nama)")
    .eq("tanggal", hariIni()).order("created_at", { ascending: false });
  if (r.error) return say("Daftar hari ini gagal dimuat: " + r.error.message, false);
  var u = 0, t = 0;
  $("hariIniList").innerHTML = (r.data || []).map(function (x) {
    u += x.jumlah; t += x.jumlah * x.harga_per_unit;
    return "<tr><td>" + jam(x.created_at) + "</td><td>" + esc(x.products.nama) + "</td><td>" + x.jumlah + "</td><td>" +
      (x.metode_bayar === "qris" ? "QRIS " + esc(x.ref_qris || "") : "Tunai") + "</td><td>" + rp(x.jumlah * x.harga_per_unit) + "</td></tr>";
  }).join("");
  $("hariIniTot").textContent = u ? "Total hari ini: " + u + " unit, " + rp(t) : "Belum ada penjualan hari ini.";
}

// ---------- Laporan (owner) ----------
function setRentang(n) { var s = hariIni(); $("sd").value = s; $("dr").value = tambahHari(s, -n); }
document.querySelectorAll("[data-rentang]").forEach(function (b) {
  b.onclick = function () {
    var v = b.dataset.rentang, s = hariIni();
    if (v === "bulan") { $("sd").value = s; $("dr").value = s.slice(0, 8) + "01"; } else setRentang(+v - 1);
    $("lgo").click();
  };
});

function ringkas(rows) {
  var o = { prod: 0, sold: 0, wq: 0, rev: 0, cost: 0, loss: 0, ru: 0, rn: 0,
    wd: [0,1,2,3,4,5,6].map(function () { return { n: 0, u: 0, r: 0, w: 0 }; }) };
  rows.forEach(function (x) {
    o.prod += x.diproduksi; o.sold += x.terjual; o.wq += x.kedaluwarsa; o.rev += +x.pendapatan;
    o.cost += +x.biaya_produksi; o.loss += +x.kerugian; o.ru += x.refund_unit; o.rn += +x.refund_nilai;
    if (x.diproduksi > 0 || x.terjual > 0) {
      var w = o.wd[new Date(x.tanggal + "T00:00:00").getDay()];
      w.n++; w.u += x.terjual; w.r += +x.pendapatan; w.w += x.kedaluwarsa;
    }
  });
  return o;
}

function arah(a, b, nama) {
  if (!b) return null;
  var p = Math.round((a - b) / Math.abs(b) * 100);
  if (p === 0) return nama + " tidak berubah";
  return nama + (p > 0 ? " naik " : " turun ") + Math.abs(p) + "%";
}

$("lgo").onclick = async function () {
  var dari = $("dr").value, sampai = $("sd").value;
  if (!dari || !sampai || dari > sampai) return say("Rentang tanggal tidak valid.", false);
  var len = selisihHari(sampai, dari) + 1;
  var r = await sb.rpc("laporan_harian", { p_dari: dari, p_sampai: sampai });
  if (r.error) return say(r.error.message, false);
  var r2 = await sb.rpc("laporan_harian", { p_dari: tambahHari(dari, -len), p_sampai: tambahHari(dari, -1) });
  var rows = r.data || [], a = ringkas(rows), b = ringkas(r2.data || []);
  var laba = a.rev - a.cost;

  $("kpis").innerHTML =
    '<div class="kpi"><span>Total biaya produksi</span><b>' + rp(a.cost) + "</b></div>" +
    '<div class="kpi"><span>Pendapatan bersih</span><b>' + rp(a.rev) + "</b></div>" +
    '<div class="kpi bad"><span>Kerugian kedaluwarsa dan rusak</span><b>' + rp(a.loss) + "</b></div>" +
    '<div class="kpi bad"><span>Refund</span><b>' + rp(a.rn) + " (" + a.ru + " unit)</b></div>" +
    '<div class="kpi ' + (laba >= 0 ? "good" : "bad") + '"><span>Laba bersih</span><b>' + rp(laba) + "</b></div>";

  var bandingan = [arah(a.rev, b.rev, "pendapatan"), arah(a.sold, b.sold, "unit terjual"), arah(a.loss, b.loss, "kerugian")].filter(Boolean);
  $("banding").textContent = bandingan.length
    ? "Dibanding " + len + " hari sebelumnya: " + bandingan.join(", ") + "."
    : "Belum ada data pada " + len + " hari sebelumnya untuk dibandingkan.";

  // Perbandingan hari dalam seminggu (rata-rata per hari tercatat)
  var hari = [];
  a.wd.forEach(function (w, d) { if (w.n) hari.push({ d: d, n: w.n, u: w.u / w.n, r: w.r / w.n, w: w.w / w.n }); });
  var urut = hari.slice().sort(function (x, y) { return y.r - x.r; });
  $("cmp").innerHTML = urut.map(function (x, i) {
    var lab = i === 0 ? '<span class="lab best">Paling laku</span>' : (i === urut.length - 1 && urut.length > 1 ? '<span class="lab worst">Paling sepi</span>' : "");
    return "<tr><td>" + HR[x.d] + "</td><td>" + x.n + "</td><td>" + x.u.toFixed(1) + " unit</td><td>" + rp(x.r) + "</td><td>" + x.w.toFixed(1) + " unit</td><td>" + lab + "</td></tr>";
  }).join("") || '<tr><td colspan="6">Belum ada data.</td></tr>';
  var mx = Math.max.apply(null, hari.map(function (x) { return Math.max(x.u, x.w); }).concat([1]));
  $("wd").innerHTML = [1,2,3,4,5,6,0].map(function (d) {
    var x = hari.filter(function (y) { return y.d === d; })[0] || { u: 0, w: 0 };
    return '<div class="wd"><span>' + HR[d] + '</span><div class="tr"><i class="s" style="width:' + x.u / mx * 100 + '%"></i><i class="w" style="width:' + x.w / mx * 100 + '%"></i></div><span class="meta">' + x.u.toFixed(1) + " / " + x.w.toFixed(1) + "</span></div>";
  }).join("");

  var teks = "Pada periode " + len + " hari, tercatat " + a.prod + " unit diproduksi dan " + a.sold + " unit terjual (" + pct(a.sold, a.prod) + "%). Sebanyak " + a.wq + " unit kedaluwarsa dan total kerugian produk (termasuk rusak) sebesar " + rp(a.loss) + ", sekitar " + pct(a.loss, a.cost) + "% dari biaya produksi.";
  if (urut.length > 1) teks += " Hari paling laku adalah " + HR[urut[0].d] + " dan hari paling sepi adalah " + HR[urut[urut.length - 1].d] + ".";
  teks += " Laba bersih periode ini " + rp(laba) + ".";
  $("narasi").hidden = false; $("narasi").textContent = teks;

  $("wk").innerHTML = rows.slice().reverse().map(function (x) {
    return "<tr><td>" + tgl(x.tanggal) + "</td><td>" + x.diproduksi + "</td><td>" + x.terjual + "</td><td>" + x.kedaluwarsa + "</td><td>" + rp(x.pendapatan) + "</td><td>" + (x.refund_unit ? x.refund_unit + " unit, " + rp(x.refund_nilai) : "-") + "</td></tr>";
  }).join("");
};

// ---------- Koreksi, refund, reset (owner) ----------
var barisKoreksi = [];
$("kgo").onclick = function () { muatKoreksi(); };

async function muatKoreksi() {
  var r = await sb.rpc("daftar_penjualan", { p_tanggal: $("kd").value });
  if (r.error) return say(r.error.message, false);
  barisKoreksi = r.data || [];
  $("kList").innerHTML = barisKoreksi.map(function (x, i) {
    return "<tr><td>" + jam(x.dibuat) + "</td><td>" + esc(x.produk) + (x.dikoreksi ? ' <span class="lab worst">dikoreksi</span>' : "") + "</td><td>" + x.jumlah + "</td><td>" + rp(x.harga_per_unit) + "</td><td>" +
      (x.metode_bayar === "qris" ? "QRIS " + esc(x.ref_qris || "") : "Tunai") + "</td><td>" + (x.refund_unit ? x.refund_unit + " unit, " + rp(x.refund_nilai) : "-") +
      '</td><td><button class="mini" data-a="refund" data-i="' + i + '">Refund</button> <button class="mini alt" data-a="koreksi" data-i="' + i + '">Koreksi</button></td></tr>';
  }).join("") || '<tr><td colspan="7">Tidak ada penjualan pada tanggal ini.</td></tr>';
  $("kList").querySelectorAll("button").forEach(function (b) {
    b.onclick = function () { (b.dataset.a === "refund" ? refund : koreksi)(barisKoreksi[+b.dataset.i]); };
  });
}

async function refund(x) {
  var maks = x.jumlah - x.refund_unit;
  if (maks < 1) return say("Penjualan ini sudah di-refund seluruhnya.", false);
  var j = prompt("Jumlah unit yang di-refund (maksimal " + maks + ")", "1"); if (!j) return;
  var alasan = prompt("Alasan refund (wajib diisi)"); if (!alasan) return say("Refund dibatalkan karena alasan kosong.", false);
  var stok = confirm("Barang masih layak jual dan dikembalikan ke stok?\n\nOK = kembali ke stok\nBatal = barang rusak atau dibuang, dicatat sebagai kerugian");
  var r = await sb.rpc("refund_penjualan", { p_sale: x.id, p_jumlah: Math.floor(+j), p_alasan: alasan, p_kembalikan_stok: stok });
  if (r.error) return say(r.error.message, false);
  say("Refund " + rp(r.data.nilai) + " tercatat. " + r.data.ke_stok + " unit kembali ke stok, " + r.data.dibuang + " unit dicatat sebagai kerugian.", true);
  muatKoreksi(); muatAudit();
}

async function koreksi(x) {
  var j = prompt("Jumlah unit yang benar", x.jumlah); if (!j) return;
  var h = prompt("Harga per unit yang benar", x.harga_per_unit); if (h === null || h === "") return;
  var alasan = prompt("Alasan koreksi (wajib diisi)"); if (!alasan) return say("Koreksi dibatalkan karena alasan kosong.", false);
  var r = await sb.rpc("koreksi_penjualan", { p_sale: x.id, p_jumlah_baru: Math.floor(+j), p_harga_baru: Math.floor(+h), p_alasan: alasan });
  if (r.error) return say(r.error.message, false);
  say("Penjualan berhasil dikoreksi. Stok tidak berubah.", true);
  muatKoreksi(); muatAudit();
}

$("kreset").onclick = async function () {
  if (!confirm("Reset semua penjualan dan produksi yang tercatat HARI INI?\n\nStok dikembalikan seperti sebelum hari ini. Tindakan ini tidak bisa dibatalkan.")) return;
  if (prompt("Ketik RESET untuk melanjutkan") !== "RESET") return say("Reset dibatalkan.", false);
  var r = await sb.rpc("reset_hari_ini");
  if (r.error) return say(r.error.message, false);
  say("Reset selesai. " + r.data.penjualan_dihapus + " penjualan dan " + r.data.produksi_dihapus + " produksi hari ini dihapus.", true);
  muatKoreksi(); muatAudit();
};

function uraiAudit(a) {
  var d = a.detail || {};
  if (a.aksi === "refund") return "Penjualan #" + d.sale_id + ", " + d.jumlah + " unit, " + rp(d.nilai) + ". Alasan: " + (d.alasan || "-");
  if (a.aksi === "koreksi_penjualan") return "Penjualan #" + d.sale_id + " (" + d.tanggal + "): jumlah " + d.lama.jumlah + " menjadi " + d.baru.jumlah + ", harga " + d.lama.harga + " menjadi " + d.baru.harga + ". Alasan: " + (d.alasan || "-");
  if (a.aksi === "reset_hari_ini") return d.penjualan_dihapus + " penjualan dan " + d.produksi_dihapus + " produksi dihapus (" + d.tanggal + ")";
  return "";
}

async function muatAudit() {
  var r = await sb.rpc("riwayat_audit", { p_limit: 30 });
  if (r.error) return say(r.error.message, false);
  $("aud").innerHTML = (r.data || []).map(function (a) {
    return "<tr><td>" + new Date(a.waktu).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" }) + "</td><td>" + esc(a.pelaku) + "</td><td>" + esc(a.aksi) + "</td><td>" + esc(uraiAudit(a)) + "</td></tr>";
  }).join("") || '<tr><td colspan="4">Belum ada perubahan tercatat.</td></tr>';
}

// ---------- Pencocokan QRIS (owner) ----------
$("qgo").onclick = async function () {
  var r = await sb.rpc("daftar_qris", { p_dari: $("qd").value, p_sampai: $("qs").value });
  if (r.error) return say(r.error.message, false);
  var app = Object.create(null), sis = Object.create(null);
  $("qdata").value.split(/\r?\n/).forEach(function (l) {
    var p = l.split(/[,;\t]/); if (p.length < 2) return;
    var ref = p[0].trim(), n = parseInt(p[1].replace(/\D/g, ""), 10);
    if (ref && !isNaN(n)) app[ref] = n;
  });
  var sistem = r.data || [], cocok = [], beda = [], hanyaSistem = [], hanyaApp = [];
  sistem.forEach(function (x) { sis[x.ref_qris] = +x.nilai; });
  sistem.forEach(function (x) {
    if (!(x.ref_qris in app)) hanyaSistem.push(x);
    else if (app[x.ref_qris] === +x.nilai) cocok.push(x);
    else beda.push(x);
  });
  Object.keys(app).forEach(function (ref) { if (!(ref in sis)) hanyaApp.push({ ref: ref, nilai: app[ref] }); });
  function blok(judul, kelas, baris) {
    return '<h3>' + judul + " (" + baris.length + ")</h3>" + (baris.length ? '<div class="scroll"><table><tbody>' + baris.join("") + "</tbody></table></div>" : '<p class="meta">Tidak ada.</p>');
  }
  var sRow = function (x) { return "<tr><td>" + esc(x.ref_qris) + "</td><td>" + tgl(x.tanggal) + "</td><td>" + esc(x.produk) + "</td><td>" + rp(x.nilai) + "</td></tr>"; };
  $("qHasil").innerHTML =
    blok("Cocok", "ok", cocok.map(sRow)) +
    blok("Nilai berbeda antara sistem dan aplikasi QRIS", "beda", beda.map(function (x) { return "<tr><td>" + esc(x.ref_qris) + "</td><td>" + tgl(x.tanggal) + "</td><td>Sistem " + rp(x.nilai) + "</td><td>Aplikasi " + rp(app[x.ref_qris]) + "</td></tr>"; })) +
    blok("Ada di sistem, tidak ada di daftar aplikasi QRIS", "sis", hanyaSistem.map(sRow)) +
    blok("Ada di aplikasi QRIS, belum tercatat di sistem", "app", hanyaApp.map(function (x) { return "<tr><td>" + esc(x.ref) + "</td><td>" + rp(x.nilai) + "</td></tr>"; }));
};

// ---------- Kelola produk (owner) ----------
async function tampilProduk() {
  var r = await sb.rpc("daftar_produk_owner");
  if (r.error) return say(r.error.message, false);
  var baris = (r.data || []).concat([{ id: null, nama: "", harga_jual: "", biaya_produksi: "", masa_jual_hari: "", aktif: true }]);
  $("prodList").innerHTML = baris.map(function (p, i) {
    return '<tr data-i="' + i + '"><td><input aria-label="Nama" value="' + esc(p.nama) + '" placeholder="Produk baru"></td>' +
      '<td><input aria-label="Harga jual" type="number" min="0" value="' + p.harga_jual + '"></td>' +
      '<td><input aria-label="Biaya produksi" type="number" min="0" value="' + p.biaya_produksi + '"></td>' +
      '<td><input aria-label="Masa jual" type="number" min="1" value="' + p.masa_jual_hari + '"></td>' +
      '<td><input aria-label="Aktif" type="checkbox"' + (p.aktif ? " checked" : "") + '></td>' +
      '<td><button data-id="' + (p.id === null ? "" : p.id) + '">' + (p.id === null ? "Tambah" : "Simpan") + "</button></td></tr>";
  }).join("");
  $("prodList").querySelectorAll("button").forEach(function (b) {
    b.onclick = async function () {
      var c = b.closest("tr").querySelectorAll("input");
      var r2 = await sb.rpc("kelola_produk", {
        p_id: b.dataset.id ? +b.dataset.id : null, p_nama: c[0].value.trim(),
        p_harga: +c[1].value, p_biaya: +c[2].value, p_masa: +c[3].value, p_aktif: c[4].checked
      });
      if (r2.error) return say("Produk gagal disimpan: " + r2.error.message, false);
      say("Data produk berhasil disimpan.", true); await muatProduk(); tampilProduk();
    };
  });
}

mulai();
