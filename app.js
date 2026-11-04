/* Aplikasi web persediaan FEFO. Semua perubahan data lewat fungsi di database (setup.sql).
   Hak akses sebenarnya dijaga oleh database, bukan oleh tampilan ini. */

var sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY);
var me = null;
var HR = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
var $ = function (i) { return document.getElementById(i); };
var rp = function (n) { return "Rp" + Math.round(n).toLocaleString("id-ID"); };
var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); };
var hariIni = function () { return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }); };
var selisihHari = function (a, b) { return Math.round((Date.parse(a) - Date.parse(b)) / 864e5); };
var tgl = function (s) { return new Date(s + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short" }); };
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
  if (nama === "laporan") isiTanggalLaporan();
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

$("sgo").onclick = async function () {
  var q = Math.floor(+$("sq").value);
  var r = await sb.rpc("catat_penjualan", { p_product: +$("sp").value, p_jumlah: q });
  if (r.error) return say(r.error.message, false);
  var rinci = r.data.rincian.map(function (x) { return x.jumlah + " unit dari batch " + tgl(x.tanggal_produksi); }).join(", ");
  say("Penjualan " + q + " unit " + $("sp").selectedOptions[0].text + " dicatat dengan urutan FEFO: " + rinci + ". Pendapatan " + rp(r.data.pendapatan) + ".", true);
};

// ---------- Laporan (owner) ----------
function isiTanggalLaporan() {
  if ($("sd").value) return;
  var s = hariIni(), d = new Date(Date.parse(s) - 13 * 864e5).toISOString().slice(0, 10);
  $("sd").value = s; $("dr").value = d;
}

$("lgo").onclick = async function () {
  var r = await sb.rpc("laporan_harian", { p_dari: $("dr").value, p_sampai: $("sd").value });
  if (r.error) return say(r.error.message, false);
  var rows = r.data || [], prod = 0, sold = 0, wq = 0, rev = 0, cost = 0, loss = 0;
  var ws = [0,0,0,0,0,0,0], ww = [0,0,0,0,0,0,0];
  rows.forEach(function (x) {
    prod += x.diproduksi; sold += x.terjual; wq += x.kedaluwarsa; rev += +x.pendapatan; cost += +x.biaya_produksi; loss += +x.kerugian;
    var d = new Date(x.tanggal + "T00:00:00").getDay(); ws[d] += x.terjual; ww[d] += x.kedaluwarsa;
  });
  var laba = rev - cost, pct = function (a, b) { return b ? Math.round(a / b * 100) : 0; };
  $("kpis").innerHTML =
    '<div class="kpi"><span>Total biaya produksi</span><b>' + rp(cost) + "</b></div>" +
    '<div class="kpi"><span>Total pendapatan</span><b>' + rp(rev) + "</b></div>" +
    '<div class="kpi bad"><span>Kerugian produk kedaluwarsa</span><b>' + rp(loss) + "</b></div>" +
    '<div class="kpi ' + (laba >= 0 ? "good" : "bad") + '"><span>Laba bersih</span><b>' + rp(laba) + "</b></div>";
  var mx = Math.max.apply(null, ws.concat(ww).concat([1])), bs = 0, bw = 0, h = "";
  for (var d = 1; d < 7; d++) { if (ws[d] > ws[bs]) bs = d; if (ww[d] > ww[bw]) bw = d; }
  [1,2,3,4,5,6,0].forEach(function (d) {
    h += '<div class="wd"><span>' + HR[d] + '</span><div class="tr"><i class="s" style="width:' + ws[d] / mx * 100 + '%"></i><i class="w" style="width:' + ww[d] / mx * 100 + '%"></i></div><span class="meta">' + ws[d] + " / " + ww[d] + "</span></div>";
  });
  $("wd").innerHTML = h;
  $("narasi").hidden = false;
  $("narasi").textContent = "Pada periode " + rows.length + " hari, tercatat " + prod + " unit diproduksi dan " + sold + " unit terjual (" + pct(sold, prod) + "%). Sebanyak " + wq + " unit (" + pct(wq, prod) + "%) kedaluwarsa dengan kerugian " + rp(loss) + ", sekitar " + pct(loss, cost) + "% dari total biaya produksi. Penjualan tertinggi terjadi pada hari " + HR[bs] + ", sedangkan produk kedaluwarsa paling banyak pada hari " + HR[bw] + ". Laba bersih periode ini " + rp(laba) + ".";
  $("wk").innerHTML = rows.slice().reverse().map(function (x) {
    return "<tr><td>" + tgl(x.tanggal) + "</td><td>" + x.diproduksi + "</td><td>" + x.terjual + "</td><td>" + x.kedaluwarsa + "</td><td>" + rp(x.pendapatan) + "</td><td>" + rp(x.kerugian) + "</td></tr>";
  }).join("");
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
