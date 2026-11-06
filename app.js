import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_KEY, EMAIL_DOMAIN } from "./config.js";
import { SPH_CONFIG, DAFTAR_KAB_BABEL, VARIABEL_RANGKUMAN } from "./sph-config.js";

// Sesi login disimpan di sessionStorage (per TAB), bukan localStorage.
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: window.sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});

// ============================================================
// State global
// ============================================================
const state = {
  profile: null,
  tabAktif: null,
  chartInstances: [],
  idTanamanUrutan: { sbs: {}, bst: {}, tbf: {}, th: {} },
  anomaliRows: [],
  anomaliSort: { kolom: "no_urut", arah: "asc" },
  kecamatanPerKab: {},
};

const TAHUN_AWAL = 2018;
const TAHUN_SEKARANG = new Date().getFullYear();
const KAB_ANOMALI_LIST = ["Bangka", "Belitung", "Bangka Barat", "Bangka Tengah", "Bangka Selatan", "Belitung Timur", "Kota Pangkal Pinang"];

// Pilihan "Rincian" anomali per jenis SPH (bisa ditambah lewat "Lainnya...").
const OPSI_RINCIAN = {
  sbs: ["Habis", "Belum Habis", "Harga"],
  tbf: ["Habis", "Belum Habis", "Harga"],
  th:  ["Habis", "Belum Habis", "Harga"],
  bst: ["Provitas", "Harga"],
};

// Label rincian otomatis dari tab provitas/harga (dipakai saat Generate Anomali)
function rincianDariTab(tab) {
  if (tab.key === "provitas_habis") return "Habis";
  if (tab.key === "provitas_belum") return "Belum Habis";
  if (tab.key === "harga") return "Harga";
  if (tab.key === "provitas") return "Provitas";
  return tab.label || "";
}

// ============================================================
// fetchAllRows() — pagination .range() sampai habis (batas 1000 baris/request)
// ============================================================
const SUPABASE_PAGE_SIZE = 1000;
async function fetchAllRows(queryFn) {
  let semua = [];
  let from = 0;
  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await queryFn(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    semua = semua.concat(data);
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return semua;
}

// ============================================================
// Util kecil
// ============================================================
const $ = (id) => document.getElementById(id);

function autoGrowTextarea(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

// Loading donut dengan persentase perkiraan (bukan progress asli).
function mulaiLoadingDonut(container, teks) {
  const id = "donut-" + Math.random().toString(36).slice(2);
  const circumference = 2 * Math.PI * 26;
  container.innerHTML = `
    <div class="loading-donut-wrap">
      <svg class="loading-donut" viewBox="0 0 64 64">
        <circle class="donut-bg" cx="32" cy="32" r="26"></circle>
        <circle class="donut-fg" id="${id}-circle" cx="32" cy="32" r="26"
          stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"></circle>
      </svg>
      <div class="loading-donut-pct" id="${id}-pct">0%</div>
      ${teks ? `<div class="loading-donut-teks">${teks}</div>` : ""}
    </div>`;

  let pct = 0;
  const timer = setInterval(() => {
    const circle = document.getElementById(`${id}-circle`);
    const pctEl = document.getElementById(`${id}-pct`);
    if (!circle || !pctEl) { clearInterval(timer); return; }
    const sisa = 90 - pct;
    pct += Math.max(0.4, sisa * 0.09);
    if (pct > 90) pct = 90;
    circle.style.strokeDashoffset = String(circumference * (1 - pct / 100));
    pctEl.textContent = Math.round(pct) + "%";
  }, 120);
  return timer;
}

function isiPilihanTahun(select, { withPilihSemua = false } = {}) {
  select.innerHTML = "";
  if (withPilihSemua) {
    const opt = document.createElement("option");
    opt.value = ""; opt.textContent = "— pilih —";
    select.appendChild(opt);
  }
  for (let y = TAHUN_SEKARANG; y >= TAHUN_AWAL; y--) {
    const opt = document.createElement("option");
    opt.value = String(y); opt.textContent = String(y);
    select.appendChild(opt);
  }
}

function isiPilihanTahunAnomali(select) {
  select.innerHTML = `<option value="semua">— Semua Tahun —</option>`;
  for (let y = TAHUN_SEKARANG; y >= TAHUN_AWAL; y--) {
    const opt = document.createElement("option");
    opt.value = String(y); opt.textContent = String(y);
    select.appendChild(opt);
  }
  select.value = String(TAHUN_SEKARANG);
}

function iqrBounds(values) {
  const arr = values.filter((v) => v && !Number.isNaN(v) && v !== 0).sort((a, b) => a - b);
  if (arr.length < 4) return [null, null];
  const q = (p) => {
    const idx = (arr.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return arr[lo];
    return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
  };
  const q1 = q(0.25), q3 = q(0.75);
  const iqr = q3 - q1;
  return [q1 - 1.5 * iqr, q3 + 1.5 * iqr];
}
function isOutlier(v, lo, hi) {
  if (v === null || v === undefined || Number.isNaN(v) || v === 0) return false;
  if (lo === null) return false;
  return v < lo || v > hi;
}
function fmt(v, desimal = 2) {
  if (v === null || v === undefined || v === 0) return "-";
  return v.toLocaleString("id-ID", { minimumFractionDigits: desimal, maximumFractionDigits: desimal });
}
function fmtPersen(v) {
  if (v === null || v === undefined || !isFinite(v)) return "-";
  return v.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtGrowthHtml(v, bold = false) {
  if (v === null || v === undefined || !isFinite(v)) {
    return bold ? `<strong>-</strong>` : `-`;
  }
  const teks = fmtPersen(v);
  let warna = "";
  if (v > 0) warna = `color:var(--hijau-muda);`;
  else if (v < 0) warna = `color:var(--merah);`;
  const inner = bold ? `<strong>${teks}</strong>` : teks;
  return warna ? `<span style="${warna}">${inner}</span>` : inner;
}
function normalisasiNamaTanaman(n) {
  return String(n ?? "").trim().toLowerCase();
}

// Baris "(Group)" tampil di Rangkuman tapi tidak ikut dijumlah ke TOTAL.
function isNamaGroup(nama) {
  return /\(group\)/i.test(String(nama ?? ""));
}

// ============================================================
// AUTH
// ============================================================
function tampilkanApp(masuk) {
  $("login-screen").classList.toggle("hidden", masuk);
  $("app-shell").classList.toggle("hidden", !masuk);
}

async function cekSesiAwal() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await masukKeApp();
  }
}

async function masukKeApp() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { return; }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, username, role, kab_id, nama_tampil, akses_terbatas")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    $("login-error").textContent = "Akun ditemukan tapi profil belum terdaftar. Hubungi admin.";
    await supabase.auth.signOut();
    return;
  }

  state.profile = profile;

  let labelUser;
  if (profile.role === "prov") {
    labelUser = profile.akses_terbatas ? "Admin Provinsi" : "Super Admin Provinsi";
  } else {
    const namaKabBersih = String(profile.kab_id || "").replace(/^Kota\s+/i, "");
    labelUser = `Admin ${namaKabBersih}`;
  }
  $("lbl-user").textContent = labelUser;
  $("lbl-user").classList.remove("hidden");
  $("btn-logout").classList.remove("hidden");
  $("info-terakhir").classList.remove("hidden");

  tampilkanApp(true);

  isiPilihanTahun($("sel-tahun-download"));
  if (profile.role === "prov") {
    $("wrap-kab-download").classList.remove("hidden");
    $("sel-kab-download").innerHTML =
      `<option value="semua">— Semua Kabupaten/Kota —</option>` +
      DAFTAR_KAB_BABEL.map((k) => `<option value="${k.id}">${k.nama}</option>`).join("");
  } else {
    $("wrap-kab-download").classList.add("hidden");
  }
  $("btn-download").disabled = false;
  $("btn-download-rangkuman").disabled = false;

  isiPilihanTahun($("sel-tahun-rekon"));

  $("wrap-referensi").classList.toggle("hidden", profile.role !== "prov" || profile.akses_terbatas === true);

  isiPilihanTahun($("sel-tahun-rangkuman"));
  if (profile.role === "kabkot") {
    const namakabDB = profile.kab_id;
    const kabEntryRangkuman = DAFTAR_KAB_BABEL.find((k) => k.id === namakabDB);
    const labelKabRangkuman = kabEntryRangkuman ? kabEntryRangkuman.nama : namakabDB;
    $("sel-kab-rangkuman").innerHTML = `<option value="${namakabDB}">${labelKabRangkuman}</option>`;
    $("sel-kab-rangkuman").disabled = true;
  } else {
    $("sel-kab-rangkuman").disabled = false;
    $("sel-kab-rangkuman").innerHTML =
      `<option value="semua">— Semua Kabupaten/Kota (Provinsi) —</option>` +
      DAFTAR_KAB_BABEL.map((k) => `<option value="${k.id}">${k.nama}</option>`).join("");
  }

  isiVariabelRangkuman();
  await isiKecamatanRangkuman();
  $("rangkuman-area").innerHTML = `<div class="placeholder-kosong">Pilih filter lalu klik OK untuk menampilkan tabulasi.</div>`;

  isiPilihanTahunAnomali($("sel-tahun-anomali"));
  siapkanSlicerAnomali();

  await muatReferensiIdTanaman();
  await siapkanKabSelect();
  await muatUlangJenis();
  await muatData();

  mulaiRotasiInfo();
}

function keluarDariApp() {
  state.profile = null;
  $("lbl-user").classList.add("hidden");
  $("btn-logout").classList.add("hidden");
  $("info-terakhir").classList.add("hidden");
  berhentiRotasiInfo();

  tampilkanApp(false);

  $("btn-download").disabled = true;
  $("btn-download-rangkuman").disabled = true;
  $("log-download-rangkuman").textContent = "";
  $("wrap-kab-download").classList.add("hidden");
  $("wrap-referensi").classList.add("hidden");
  $("in-file-referensi").value = "";
  $("log-referensi").textContent = "";
  $("log-download").textContent = "";

  $("in-username").value = "";
  $("in-password").value = "";
  $("login-error").textContent = "";

  gantiView("rekon");
  $("rangkuman-area").innerHTML = `<div class="placeholder-kosong">Pilih filter lalu klik OK untuk menampilkan tabulasi.</div>`;
  $("anomali-area").innerHTML = `<div class="placeholder-kosong">Pilih jenis SPH & kabupaten untuk mulai.</div>`;
}

$("btn-login").addEventListener("click", login);
$("in-password").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

$("chk-show-pass").addEventListener("change", (e) => {
  $("in-password").type = e.target.checked ? "text" : "password";
});

async function login() {
  const username = $("in-username").value.trim().toLowerCase();
  const password = $("in-password").value;
  $("login-error").textContent = "";

  if (!username || !password) {
    $("login-error").textContent = "Username & password wajib diisi.";
    return;
  }

  $("btn-login").disabled = true;
  $("btn-login").textContent = "Menyambungkan...";

  const email = username + EMAIL_DOMAIN;
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  $("btn-login").disabled = false;
  $("btn-login").textContent = "Sambungkan";

  if (error) {
    $("login-error").textContent = "Username atau password salah.";
    return;
  }
  await masukKeApp();
}

$("btn-logout").addEventListener("click", async () => {
  await supabase.auth.signOut({ scope: "local" });
  keluarDariApp();
});

// ============================================================
// TOGGLE PANEL KANAN
// ============================================================
function gantiView(view) {
  // Simpan posisi scroll Konfirmasi Anomali sebelum pindah menu.
  const areaAnomali = $("anomali-area");
  if (!$("view-anomali").classList.contains("hidden") && view !== "anomali") {
    state.scrollAnomali = { top: areaAnomali.scrollTop, left: areaAnomali.scrollLeft };
  }
  $("view-rekon").classList.toggle("hidden", view !== "rekon");
  $("view-rangkuman").classList.toggle("hidden", view !== "rangkuman");
  $("view-anomali").classList.toggle("hidden", view !== "anomali");
  $("btn-view-rekon").classList.toggle("aktif", view === "rekon");
  $("btn-view-anomali").classList.toggle("aktif", view === "anomali");
  $("btn-view-rangkuman").classList.toggle("aktif", view === "rangkuman");
  $("toggle-aksi-rekon").classList.toggle("hidden", view !== "rekon");
  if (view === "anomali" && state.profile) {
    const pos = state.scrollAnomali;
    muatAnomali().then(() => {
      if (pos) { areaAnomali.scrollTop = pos.top; areaAnomali.scrollLeft = pos.left; }
    });
  }
}
$("btn-view-rekon").addEventListener("click", () => gantiView("rekon"));
$("btn-view-anomali").addEventListener("click", () => gantiView("anomali"));
$("btn-view-rangkuman").addEventListener("click", () => gantiView("rangkuman"));

// ============================================================
// DOWNLOAD RAW DATA (baca dari database, export ke Excel)
// ============================================================
$("btn-download").addEventListener("click", downloadData);

function bukaModalDownload() {
  $("modal-download").classList.remove("hidden");
}
function tutupModalDownload() {
  $("modal-download").classList.add("hidden");
}
$("btn-buka-download").addEventListener("click", bukaModalDownload);
$("btn-tutup-download").addEventListener("click", tutupModalDownload);
$("modal-download").addEventListener("click", (e) => {
  if (e.target.id === "modal-download") tutupModalDownload();
});

async function ambilRowsMentah(jenis, tahun, kabNama) {
  const cfg = SPH_CONFIG[jenis];
  return await fetchAllRows((from, to) => {
    let query = supabase.from(cfg.table).select("*").eq("tahun", tahun);
    if (kabNama) query = query.eq("nama_kab", kabNama);
    return query
      .order(cfg.periodeCol, { ascending: true })
      .order("kab", { ascending: true })
      .order("urutkec", { ascending: true })
      .order("idtanaman", { ascending: true, nullsFirst: false })
      .range(from, to);
  });
}

function buatRowsExcelMentah(cfg, rows) {
  return rows.map((r) => {
    const out = {
      idtanaman: r.idtanaman,
      namatanaman: r.namatanaman,
      kab: r.kab,
      nama_kab: r.nama_kab,
      urutkec: r.urutkec,
      kec: r.kec,
      nama_kec: r.nama_kec,
      tahun: r.tahun,
      [cfg.periodeCol]: r[cfg.periodeCol],
    };
    for (const [dbCol, headerExcel] of Object.entries(cfg.excelCols)) {
      out[headerExcel] = r[dbCol] ?? 0;
    }
    return out;
  });
}

function tulisSheetDataMentah(wb, sheetName, rowsExcel) {
  if (!rowsExcel || rowsExcel.length === 0) return;
  const headers = Object.keys(rowsExcel[0]);
  const nCol = headers.length;
  const ws = {};
  const range = { s: { r: 0, c: 0 }, e: { r: 0, c: nCol - 1 } };

  const setCell = (r, c, cell) => {
    ws[XLSX.utils.encode_cell({ r, c })] = cell;
    if (r > range.e.r) range.e.r = r;
    if (c > range.e.c) range.e.c = c;
  };

  headers.forEach((h, c) => {
    setCell(0, c, xlCell(h, { bold: true, bgColor: XL_HIJAU_HEADER, color: XL_PUTIH, align: "left" }));
  });

  rowsExcel.forEach((row, i) => {
    const stripeBg = i % 2 === 1 ? XL_ABU_STRIPE : undefined;
    headers.forEach((h, c) => {
      const v = row[h];
      const isNum = typeof v === "number";
      setCell(i + 1, c, xlCell(v, {
        bgColor: stripeBg,
        align: isNum ? "center" : "left",
        numFmt: isNum ? "#,##0.00" : undefined,
      }));
    });
  });

  ws["!ref"] = XLSX.utils.encode_range(range);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

async function downloadData() {
  if (!state.profile) return;

  const jenisPilihan = $("sel-jenis-download").value;
  const tahun = Number($("sel-tahun-download").value);
  const logBox = $("log-download");
  const btn = $("btn-download");

  let kabNama = null;
  if (state.profile.role === "kabkot") {
    kabNama = state.profile.kab_id;
  } else {
    const pilihan = $("sel-kab-download").value;
    kabNama = pilihan === "semua" ? null : pilihan;
  }

  btn.disabled = true;
  btn.textContent = "⏳ Mengambil data...";

  const jenisList = jenisPilihan === "semua" ? ["sbs", "tbf", "th", "bst"] : [jenisPilihan];
  const labelKabFile = (kabNama ?? "SemuaKab").replace(/\s+/g, "");

  try {
    const wb = XLSX.utils.book_new();
    let totalRows = 0;
    const ringkasan = [];

    for (const jenis of jenisList) {
      const cfg = SPH_CONFIG[jenis];
      logBox.textContent = `Mengambil data ${cfg.label} tahun ${tahun} dari database...`;

      const rows = await ambilRowsMentah(jenis, tahun, kabNama);
      if (!rows || rows.length === 0) {
        ringkasan.push(`${cfg.label}: tidak ada data`);
        continue;
      }

      const rowsExcel = buatRowsExcelMentah(cfg, rows);
      const sheetName = jenisPilihan === "semua" ? cfg.label : "Sheet1";
      tulisSheetDataMentah(wb, sheetName, rowsExcel);
      totalRows += rows.length;
      ringkasan.push(`${cfg.label}: ${rows.length} baris`);
    }

    if (wb.SheetNames.length === 0) {
      logBox.textContent =
        `Tidak ada data tahun ${tahun}` +
        `${kabNama ? "" : " untuk seluruh kabupaten"}.\n` +
        `(Kemungkinan belum ada sinkronisasi dari aplikasi desktop.)`;
      return;
    }

    const namaFile = jenisPilihan === "semua"
      ? `SemuaSPH_${labelKabFile}_${tahun}.xlsx`
      : `${SPH_CONFIG[jenisPilihan].label}_${labelKabFile}_${tahun}.xlsx`;

    XLSX.writeFile(wb, namaFile, { cellStyles: true });

    const catatanDesktop = state.profile.role === "prov"
      ? `\nFile ini bisa langsung dipakai di aplikasi desktop FetSipedas ` +
        `(menu "3. Rekonsiliasi" → Pilih File Raw) untuk membuat Excel ` +
        `rekon dinamis (dengan dropdown & grafik).`
      : "";

    logBox.textContent =
      `✓ Selesai! ${totalRows} baris diexport ke "${namaFile}".\n` +
      `${ringkasan.join("\n")}` +
      catatanDesktop;
  } catch (e) {
    logBox.textContent = `✗ Gagal mengambil/export data: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "⬇ Download Raw Data (Excel)";
  }
}

// Info "terakhir diperbarui" bergilir tiap 5 detik untuk semua jenis SPH.
const JENIS_ROTASI_INFO = ["sbs", "tbf", "th", "bst"];
let infoRotasiIdx = 0;
let infoRotasiTimer = null;

async function muatInfoTerakhirUntuk(jenis, tahun) {
  const { data } = await supabase
    .from("sync_meta")
    .select("tahun, last_synced_at, status")
    .eq("jenis", jenis)
    .eq("tahun", tahun)
    .order("last_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    $("info-terakhir").innerHTML =
      `Belum ada data <strong>${jenis.toUpperCase()}</strong> tahun <strong>${tahun}</strong> yang pernah disinkronkan.`;
    return;
  }
  const tgl = new Date(data.last_synced_at);
  const teks = tgl.toLocaleString("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
  });
  $("info-terakhir").innerHTML =
    `Data <strong>${jenis.toUpperCase()}</strong> (tahun ${data.tahun}) terakhir diperbarui: <strong>${teks} WIB</strong> — status: ${data.status}`;
}

async function tampilkanInfoRotasiBerikutnya() {
  const jenis = JENIS_ROTASI_INFO[infoRotasiIdx % JENIS_ROTASI_INFO.length];
  infoRotasiIdx++;
  await muatInfoTerakhirUntuk(jenis, TAHUN_SEKARANG);
}

function mulaiRotasiInfo() {
  berhentiRotasiInfo();
  infoRotasiIdx = 0;
  tampilkanInfoRotasiBerikutnya();
  infoRotasiTimer = setInterval(tampilkanInfoRotasiBerikutnya, 5000);
}

function berhentiRotasiInfo() {
  if (infoRotasiTimer) { clearInterval(infoRotasiTimer); infoRotasiTimer = null; }
}

// ============================================================
// PANEL KANAN — VIEW: REKON
// ============================================================
$("sel-jenis").addEventListener("change", muatUlangJenis);
$("sel-tahun-rekon").addEventListener("change", async () => { await siapkanKabSelect(); await muatData(); });
$("sel-kab").addEventListener("change", async () => { await siapkanKomoditiSelect(); await muatData(); });
$("sel-komoditi").addEventListener("change", muatData);

async function muatUlangJenis() {
  if (!state.profile) return;
  siapkanTabBar();
  await siapkanKabSelect();
  await muatData();
}

function siapkanTabBar() {
  const jenis = $("sel-jenis").value;
  const cfg = SPH_CONFIG[jenis];
  const bar = $("tab-bar");
  bar.innerHTML = "";
  cfg.tabs.forEach((tab, i) => {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (i === 0 ? " aktif" : "");
    btn.textContent = tab.label;
    btn.addEventListener("click", () => {
      state.tabAktif = tab.key;
      Array.from(bar.children).forEach((c) => c.classList.remove("aktif"));
      btn.classList.add("aktif");
      muatData();
    });
    bar.appendChild(btn);
  });
  state.tabAktif = cfg.tabs[0].key;
}

async function siapkanKabSelect() {
  if (!state.profile) return;
  const selKab = $("sel-kab");

  if (state.profile.role === "kabkot") {
    const namakabDB = state.profile.kab_id;
    const kabEntry = DAFTAR_KAB_BABEL.find((k) => k.id === namakabDB);
    const labelKab = kabEntry ? kabEntry.nama : namakabDB;
    selKab.innerHTML = `<option value="${namakabDB}">${labelKab}</option>`;
    selKab.disabled = true;
    await siapkanKomoditiSelect();
    return;
  }

  selKab.disabled = false;
  selKab.innerHTML = DAFTAR_KAB_BABEL
    .map((k) => `<option value="${k.id}">${k.nama}</option>`)
    .join("");
  await siapkanKomoditiSelect();
}

async function siapkanKomoditiSelect() {
  const jenis = $("sel-jenis").value;
  const cfg = SPH_CONFIG[jenis];
  const tahun = Number($("sel-tahun-rekon").value);
  const kabNama = $("sel-kab").value;
  const selKom = $("sel-komoditi");

  selKom.innerHTML = `<option value="">Memuat...</option>`;

  let data;
  try {
    data = await fetchAllRows((from, to) =>
      supabase
        .from(cfg.table)
        .select("namatanaman")
        .eq("tahun", tahun)
        .eq("nama_kab", kabNama)
        .range(from, to)
    );
  } catch (e) {
    selKom.innerHTML = `<option value="">(gagal memuat)</option>`;
    return;
  }
  const unik = Array.from(new Set(data.map((r) => r.namatanaman)));

  const urutanMap = state.idTanamanUrutan[jenis] || {};
  unik.sort((a, b) => {
    const ua = urutanMap[normalisasiNamaTanaman(a)];
    const ub = urutanMap[normalisasiNamaTanaman(b)];
    if (ua !== undefined && ub !== undefined) return ua - ub;
    if (ua !== undefined) return -1;
    if (ub !== undefined) return 1;
    return a.localeCompare(b, "id");
  });

  selKom.innerHTML = unik.length
    ? unik.map((n) => `<option value="${n}">${n}</option>`).join("")
    : `<option value="">(tidak ada komoditi)</option>`;
}

// ============================================================
// REFERENSI ID TANAMAN (khusus role "prov")
// ============================================================
async function muatReferensiIdTanaman() {
  let data = [];
  try {
    data = await fetchAllRows((from, to) =>
      supabase.from("id_tanaman").select("jenis, namatanaman, urutan").range(from, to)
    );
  } catch (e) {
    data = [];
  }
  const map = { sbs: {}, bst: {}, tbf: {}, th: {} };
  const namaAsli = { sbs: [], bst: [], tbf: [], th: {} };

  const perJenis = { sbs: [], bst: [], tbf: [], th: [] };
  if (data) {
    for (const row of data) {
      if (!map[row.jenis]) map[row.jenis] = {};
      map[row.jenis][normalisasiNamaTanaman(row.namatanaman)] = row.urutan;
      if (perJenis[row.jenis]) perJenis[row.jenis].push({ nama: row.namatanaman, urutan: row.urutan });
    }
  }
  for (const jenis of ["sbs", "bst", "tbf", "th"]) {
    perJenis[jenis].sort((a, b) => a.urutan - b.urutan);
    namaAsli[jenis] = perJenis[jenis].map((r) => r.nama);
  }

  state.idTanamanUrutan = map;
  state.idTanamanNamaAsli = namaAsli;
}

$("in-file-referensi")?.addEventListener("change", uploadReferensiIdTanaman);

async function uploadReferensiIdTanaman() {
  const fileInput = $("in-file-referensi");
  const logBox = $("log-referensi");
  const file = fileInput.files[0];

  if (!file) return;

  logBox.textContent = "Membaca file...";

  const jenisValid = ["sbs", "bst", "tbf", "th"];

  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const hasil = [];

    for (const sheetName of wb.SheetNames) {
      const jenis = sheetName.trim().toLowerCase();
      if (!jenisValid.includes(jenis)) continue;

      const rowsSheet = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
      const daftar = [];
      let urutan = 0;
      for (const row of rowsSheet) {
        const nama = String(row.namatanaman ?? row.Namatanaman ?? row.NamaTanaman ?? "").trim();
        if (!nama) continue;
        urutan += 1;
        const idRaw = row.idtanaman ?? row.Idtanaman ?? row.IdTanaman ?? "";
        daftar.push({
          jenis,
          namatanaman: nama,
          idtanaman: idRaw === "" ? null : String(idRaw),
          urutan,
        });
      }
      if (daftar.length === 0) continue;

      logBox.textContent = `Mengupload ${daftar.length} komoditi untuk jenis ${jenis.toUpperCase()}...`;

      const { error: errDel } = await supabase.from("id_tanaman").delete().eq("jenis", jenis);
      if (errDel) throw new Error(`Gagal hapus referensi lama (${jenis.toUpperCase()}): ${errDel.message}`);

      const { error: errIns } = await supabase.from("id_tanaman").insert(daftar);
      if (errIns) throw new Error(`Gagal upload referensi (${jenis.toUpperCase()}): ${errIns.message}`);

      hasil.push(`${jenis.toUpperCase()}: ${daftar.length} komoditi`);
    }

    if (hasil.length === 0) {
      logBox.textContent =
        "Tidak ada sheet valid ditemukan.\n" +
        "Nama sheet di file Excel harus persis: sbs, bst, tbf, atau th.";
    } else {
      logBox.textContent = `✓ Referensi berhasil diupdate!\n${hasil.join("\n")}`;
      await muatReferensiIdTanaman();
      if ($("sel-kab").value) await siapkanKomoditiSelect();
    }
  } catch (e) {
    logBox.textContent = `✗ Gagal: ${e.message}`;
  } finally {
    fileInput.value = "";
  }
}

async function muatData() {
  if (!state.profile) return;
  const jenis = $("sel-jenis").value;
  const cfg = SPH_CONFIG[jenis];
  const tahun = Number($("sel-tahun-rekon").value);
  const kabNama = $("sel-kab").value;
  const komoditi = $("sel-komoditi").value;
  const area = $("rekon-area");

  if (!kabNama || !komoditi) {
    area.innerHTML = `<div class="placeholder-kosong">Pilih kabupaten & komoditi untuk mulai.</div>`;
    return;
  }

  mulaiLoadingDonut(area);

  let rowsKab;
  try {
    rowsKab = await fetchAllRows((from, to) =>
      supabase
        .from(cfg.table)
        .select("*")
        .eq("tahun", tahun)
        .eq("nama_kab", kabNama)
        .eq("namatanaman", komoditi)
        .order("urutkec", { ascending: true })
        .range(from, to)
    );
  } catch (error) {
    area.innerHTML = `<div class="placeholder-kosong">Gagal memuat data: ${error.message}</div>`;
    return;
  }
  if (!rowsKab || rowsKab.length === 0) {
    area.innerHTML = `<div class="placeholder-kosong">Tidak ada data untuk kombinasi ini.</div>`;
    return;
  }

  let rowsSemua = [];
  try {
    rowsSemua = await fetchAllRows((from, to) =>
      supabase
        .from(cfg.table)
        .select("*")
        .eq("tahun", tahun)
        .eq("namatanaman", komoditi)
        .range(from, to)
    );
  } catch (e) {
    rowsSemua = [];
  }

  renderRekon(cfg, rowsKab, rowsSemua, komoditi);
}

// ---- Helper umum ----

function nilaiFromRow(r, tab) {
  if (tab.single) return Number(r[tab.single]) || 0;
  const numer = (Number(r[tab.numer]) || 0) * (tab.numerFactor ?? 1);
  const denom = Number(r[tab.denom]) || 0;
  return denom !== 0 ? numer / denom : 0;
}

function pivotKec(rows) {
  const kecMap = new Map();
  for (const r of rows) {
    if (!kecMap.has(r.kec)) kecMap.set(r.kec, { kode: r.kec, nama: r.nama_kec, urut: r.urutkec ?? 0 });
  }
  return Array.from(kecMap.values()).sort((a, b) => a.urut - b.urut);
}

function buatTabelKecPeriode({ judul, satuan, kecRows, matrix, nPeriode, headerLabels, desimal = 2 }) {
  const semuaNilai = [];
  for (const k of kecRows) for (let p = 1; p <= nPeriode; p++) semuaNilai.push(matrix.get(`${k.kode}|${p}`) ?? 0);
  const [lo, hi] = iqrBounds(semuaNilai);

  const blok = document.createElement("div");
  blok.className = "tabel-blok";

  const scrollAtas = document.createElement("div");
  scrollAtas.className = "scroll-atas";
  scrollAtas.innerHTML = `<div class="scroll-atas-dummy"></div>`;
  blok.appendChild(scrollAtas);

  const tabelScroll = document.createElement("div");
  tabelScroll.className = "tabel-scroll";
  blok.appendChild(tabelScroll);

  const konten = document.createElement("div");
  konten.className = "tabel-konten";
  konten.innerHTML = `<div class="tabel-judul"><span>${judul}</span><span class="satuan">${satuan}</span></div>`;
  tabelScroll.appendChild(konten);

  const table = document.createElement("table");
  table.className = "tabel-rekon";
  const theadCols = ["No", "Kode", "Kecamatan", ...headerLabels, "Mean"];
  table.innerHTML = `<thead><tr>${theadCols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>`;

  const tbody = document.createElement("tbody");
  kecRows.forEach((k, i) => {
    const tr = document.createElement("tr");
    let tds = `<td>${i + 1}</td><td>${k.kode}</td><td class="nama">${k.nama}</td>`;
    const rowVals = [];
    for (let p = 1; p <= nPeriode; p++) {
      const v = matrix.get(`${k.kode}|${p}`) ?? 0;
      rowVals.push(v);
      const outlierCls = isOutlier(v, lo, hi) ? " outlier" : "";
      tds += `<td class="${outlierCls}">${fmt(v, desimal)}</td>`;
    }
    const nz = rowVals.filter((v) => v !== 0);
    const mean = nz.length ? nz.reduce((a, b) => a + b, 0) / nz.length : 0;
    tds += `<td>${fmt(mean, desimal)}</td>`;
    tr.innerHTML = tds;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  konten.appendChild(table);
  return blok;
}

function buatTabelRata2PerKab({ judul, tab, cfg, rowsSemua, nPeriode, headerLabels, desimal = 2 }) {
  const labelAxis = cfg.periodeCol === "triwulan" ? "Triwulan" : "Bulan";
  const blok = document.createElement("div");
  blok.className = "tabel-blok";

  const scrollAtas = document.createElement("div");
  scrollAtas.className = "scroll-atas";
  scrollAtas.innerHTML = `<div class="scroll-atas-dummy"></div>`;
  blok.appendChild(scrollAtas);

  const tabelScroll = document.createElement("div");
  tabelScroll.className = "tabel-scroll";
  blok.appendChild(tabelScroll);

  const konten = document.createElement("div");
  konten.className = "tabel-konten";
  konten.innerHTML = `<div class="tabel-judul"><span>Rata-Rata ${judul} menurut Kabupaten &amp; ${labelAxis}</span></div>`;
  tabelScroll.appendChild(konten);

  const table = document.createElement("table");
  table.className = "tabel-rekon tabel-rata2";
  table.innerHTML = `<thead><tr>${["Kabupaten", ...headerLabels].map((c) => `<th>${c}</th>`).join("")}</tr></thead>`;
  const tbody = document.createElement("tbody");

  const perKabAvg = {};
  const semuaNilai = [];

  for (const kab of DAFTAR_KAB_BABEL) {
    const rowsKabIni = rowsSemua.filter((r) => r.nama_kab === kab.id);
    const kecKeys = Array.from(new Set(rowsKabIni.map((r) => r.kec)));
    const matrix = new Map();
    for (const r of rowsKabIni) {
      const per = Number(r[cfg.periodeCol]);
      matrix.set(`${r.kec}|${per}`, nilaiFromRow(r, tab));
    }

    const rataPerPeriode = [];
    for (let p = 1; p <= nPeriode; p++) {
      const vals = kecKeys.map((kid) => matrix.get(`${kid}|${p}`) ?? 0);
      const nz = vals.filter((v) => v !== 0);
      const rata = nz.length ? nz.reduce((a, b) => a + b, 0) / nz.length : null;
      rataPerPeriode.push(rata);
      if (rata !== null) semuaNilai.push(rata);
    }
    perKabAvg[kab.id] = rataPerPeriode;
  }

  const [lo, hi] = iqrBounds(semuaNilai);

  for (const kab of DAFTAR_KAB_BABEL) {
    const rataPerPeriode = perKabAvg[kab.id];
    const tr = document.createElement("tr");
    let tds = `<td class="nama">${kab.nama}</td>`;
    rataPerPeriode.forEach((v) => {
      if (v === null) {
        tds += `<td>-</td>`;
      } else {
        const outlierCls = isOutlier(v, lo, hi) ? " outlier" : "";
        tds += `<td class="${outlierCls}">${fmt(v, desimal)}</td>`;
      }
    });
    tr.innerHTML = tds;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  konten.appendChild(table);
  return { blok, perKabAvg };
}

// Palet kontras tinggi (warna berjauhan) + bentuk titik berbeda per garis
const PALET_WARNA = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#00b3b3", "#f032e6", "#9a6324", "#111111", "#bcbd22",
  "#808000", "#ff1493", "#1e90ff", "#7f7f7f", "#800000",
];
const STYLE_TITIK = ["circle", "rect", "triangle", "rectRot", "star", "cross", "crossRot", "dash"];

function tambahkanGrafik(area, judul, labelsX, series, yTitle) {
  const wrap = document.createElement("div");
  wrap.className = "chart-wrap";
  const canvasId = "canvas-chart-" + Math.random().toString(36).slice(2);
  wrap.innerHTML = `<h4>${judul}</h4><canvas id="${canvasId}"></canvas>`;
  area.appendChild(wrap);

  const ctx = document.getElementById(canvasId).getContext("2d");
  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labelsX,
      datasets: series.map((s, i) => ({
        label: s.label,
        data: s.data,
        borderColor: PALET_WARNA[i % PALET_WARNA.length],
        backgroundColor: PALET_WARNA[i % PALET_WARNA.length],
        spanGaps: true,
        tension: 0,
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointStyle: STYLE_TITIK[i % STYLE_TITIK.length],
        tipe: s.tipe, key: s.key, kabId: s.kabId,
        warnaAsli: PALET_WARNA[i % PALET_WARNA.length],
      })),
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "right",
          labels: { boxWidth: 12, font: { size: 10 } },
          // Klik legend = fokus ke garis itu (bukan sembunyikan); klik lagi = reset.
          onClick: (e, item, legend) => {
            const ds = legend.chart.data.datasets[item.datasetIndex];
            if (!state.fokusGrafik) state.fokusGrafik = { kec: new Map(), kab: new Set() };
            const f = state.fokusGrafik;
            if (ds.tipe === "kec") {
              if (f.kec.has(ds.key)) f.kec.delete(ds.key); else f.kec.set(ds.key, ds.kabId);
            } else {
              if (f.kab.has(ds.key)) f.kab.delete(ds.key); else f.kab.add(ds.key);
            }
            if (f.kec.size === 0 && f.kab.size === 0) state.fokusGrafik = null;
            terapkanFokusGrafik();
          },
        },
      },
      scales: { y: { beginAtZero: true, title: { display: true, text: yTitle } } },
    },
  });
  state.chartInstances.push(chart);
}

// Fokus tersinkron antar semua grafik: kec -> kabnya, kab -> kec2 di kab itu.
function terapkanFokusGrafik() {
  const f = state.fokusGrafik;
  const kabDariKec = f ? new Set(f.kec.values()) : null;
  for (const chart of state.chartInstances) {
    chart.data.datasets.forEach((ds) => {
      let aktif = true;
      if (f) {
        if (ds.tipe === "kec") aktif = f.kec.has(ds.key) || f.kab.has(ds.kabId);
        else aktif = f.kab.has(ds.key) || kabDariKec.has(ds.key);
      }
      const warna = aktif ? ds.warnaAsli : "rgba(190,190,190,0.4)";
      ds.borderColor = warna;
      ds.backgroundColor = warna;
      ds.pointBackgroundColor = warna;
      ds.pointBorderColor = warna;
      ds.pointHoverBackgroundColor = warna;
      ds.pointHoverBorderColor = warna;
      ds.borderWidth = f && aktif ? 3.5 : f ? 1.5 : 2.5;
      ds.pointRadius = f && !aktif ? 2 : 4;
      ds.order = aktif ? 0 : 2;
    });
    chart.update("none");
  }
}

function renderRekon(cfg, rowsKab, rowsSemua, komoditi) {
  const tab = cfg.tabs.find((t) => t.key === state.tabAktif) ?? cfg.tabs[0];
  const periodeCol = cfg.periodeCol;
  const nPeriode = cfg.periodeLabels.length;
  const headerLabels = cfg.periodeLabels.map((p) => (periodeCol === "triwulan" ? `Tw${p}` : p));
  const desimalUtama = tab.single === "harga_jual_petani" ? 0 : 2;

  const kecRows = pivotKec(rowsKab);
  const matrixUtama = new Map();
  for (const r of rowsKab) {
    const per = Number(r[periodeCol]);
    matrixUtama.set(`${r.kec}|${per}`, nilaiFromRow(r, tab));
  }

  const area = $("rekon-area");
  area.innerHTML = "";
  state.chartInstances.forEach((c) => c.destroy());
  state.chartInstances = [];
  state.fokusGrafik = null;

  area.appendChild(buatTabelKecPeriode({
    judul: `${tab.label} — ${komoditi}`, satuan: tab.satuan,
    kecRows, matrix: matrixUtama, nPeriode, headerLabels, desimal: desimalUtama,
  }));

  if (!tab.single && tab.rawNumer) {
    const matrixNumer = new Map();
    for (const r of rowsKab) {
      const per = Number(r[periodeCol]);
      matrixNumer.set(`${r.kec}|${per}`, (Number(r[tab.numer]) || 0) * (tab.rawNumer.factor ?? 1));
    }
    area.appendChild(buatTabelKecPeriode({
      judul: `${tab.rawNumer.label} — ${komoditi}`, satuan: tab.rawNumer.satuan,
      kecRows, matrix: matrixNumer, nPeriode, headerLabels, desimal: 2,
    }));
  }
  if (!tab.single && tab.rawDenom) {
    const matrixDenom = new Map();
    for (const r of rowsKab) {
      const per = Number(r[periodeCol]);
      matrixDenom.set(`${r.kec}|${per}`, (Number(r[tab.denom]) || 0) * (tab.rawDenom.factor ?? 1));
    }
    area.appendChild(buatTabelKecPeriode({
      judul: `${tab.rawDenom.label} — ${komoditi}`, satuan: tab.rawDenom.satuan,
      kecRows, matrix: matrixDenom, nPeriode, headerLabels, desimal: 2,
    }));
  }

  const { perKabAvg } = (() => {
    const r = buatTabelRata2PerKab({
      judul: `${tab.label} — ${komoditi}`, tab, cfg, rowsSemua, nPeriode, headerLabels, desimal: desimalUtama,
    });
    area.appendChild(r.blok);
    return r;
  })();

  tambahkanGrafik(
    area,
    `Grafik ${tab.label} per Kecamatan — ${komoditi}`,
    headerLabels,
    kecRows.map((k) => ({
      tipe: "kec", key: k.kode, kabId: $("sel-kab").value,
      label: k.nama,
      data: Array.from({ length: nPeriode }, (_, idx) => {
        const v = matrixUtama.get(`${k.kode}|${idx + 1}`) ?? null;
        return v === 0 ? null : v;
      }),
    })),
    tab.satuan
  );

  tambahkanGrafik(
    area,
    `Grafik Rata-Rata ${tab.label} per Kabupaten — ${komoditi}`,
    headerLabels,
    DAFTAR_KAB_BABEL.map((kab) => ({ tipe: "kab", key: kab.id, kabId: kab.id, label: kab.nama, data: perKabAvg[kab.id] })),
    tab.satuan
  );

  initScrollAtas(area);
}

function initScrollAtas(container) {
  container.querySelectorAll(".tabel-blok").forEach((blok) => {
    const atas = blok.querySelector(".scroll-atas");
    const dummy = blok.querySelector(".scroll-atas-dummy");
    const scroll = blok.querySelector(".tabel-scroll");
    if (!atas || !dummy || !scroll || atas.dataset.terpasang) return;
    atas.dataset.terpasang = "1";
    dummy.style.width = scroll.scrollWidth + "px";
    atas.addEventListener("scroll", () => { scroll.scrollLeft = atas.scrollLeft; });
    scroll.addEventListener("scroll", () => { atas.scrollLeft = scroll.scrollLeft; });
  });
}

// ============================================================
// PANEL KANAN — VIEW: RANGKUMAN DATA
// ============================================================
const BULAN_NAMA = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function isiVariabelRangkuman() {
  const jenis = $("sel-jenis-rangkuman").value;
  $("sel-variabel-rangkuman").innerHTML = VARIABEL_RANGKUMAN[jenis]
    .map((v) => `<option value="${v.key}">${v.label}</option>`).join("");
}
function varRangkumanAktif(jenis) {
  const daftar = VARIABEL_RANGKUMAN[jenis];
  return daftar.find((v) => v.key === $("sel-variabel-rangkuman").value) || daftar[0];
}
async function isiKecamatanRangkuman() {
  const sel = $("sel-kec-rangkuman");
  const kab = $("sel-kab-rangkuman").value;
  sel.innerHTML = `<option value="semua">— Semua Kecamatan —</option>`;
  if (!kab || kab === "semua") { sel.disabled = true; return; }
  sel.disabled = true;
  try {
    const list = await muatKecamatanKab(kab);
    sel.innerHTML += list.map((n) => `<option value="${n.replace(/"/g, "&quot;")}">${n}</option>`).join("");
  } catch (e) { /* biarkan cuma "Semua Kecamatan" */ }
  sel.disabled = false;
}

$("sel-jenis-rangkuman").addEventListener("change", isiVariabelRangkuman);
$("sel-kab-rangkuman").addEventListener("change", isiKecamatanRangkuman);
$("btn-ok-rangkuman").addEventListener("click", muatRangkuman);

async function ambilRowsRangkuman(cfg, v, thn, kabPilihan, kecPilihan) {
  const kolom = ["namatanaman", "idtanaman", "nama_kec", cfg.periodeCol, ...v.cols].join(", ");
  let rows = await fetchAllRows((from, to) => {
    let q = supabase.from(cfg.table).select(kolom).eq("tahun", thn);
    if (kabPilihan !== "semua") q = q.eq("nama_kab", kabPilihan);
    return q.range(from, to);
  });
  if (kecPilihan && kecPilihan !== "semua") {
    const k = keyKecamatan(kecPilihan);
    rows = rows.filter((r) => keyKecamatan(r.nama_kec) === k);
  }
  return rows;
}

async function muatRangkuman() {
  if (!state.profile) return;
  const jenis = $("sel-jenis-rangkuman").value;
  const cfg = SPH_CONFIG[jenis];
  const v = varRangkumanAktif(jenis);
  const tahun = Number($("sel-tahun-rangkuman").value);
  const kabPilihan = $("sel-kab-rangkuman").value;
  const kecPilihan = $("sel-kec-rangkuman").value;
  const area = $("rangkuman-area");
  const btnOk = $("btn-ok-rangkuman");

  btnOk.disabled = true;
  mulaiLoadingDonut(area);
  try {
    const [rowsIni, rowsLalu] = await Promise.all([
      ambilRowsRangkuman(cfg, v, tahun, kabPilihan, kecPilihan),
      ambilRowsRangkuman(cfg, v, tahun - 1, kabPilihan, kecPilihan),
    ]);
    renderRangkuman(cfg, v, rowsIni, rowsLalu, jenis, tahun, kabPilihan, kecPilihan);
  } catch (e) {
    area.innerHTML = `<div class="placeholder-kosong">Gagal memuat data: ${e.message}</div>`;
  } finally {
    btnOk.disabled = false;
  }
}

function objRangkumanKosong() {
  return {
    idtanaman: "", bulan: {}, bulanS: {}, bulanN: {},
    tw: { 1: 0, 2: 0, 3: 0, 4: 0 }, twS: { 1: 0, 2: 0, 3: 0, 4: 0 }, twN: { 1: 0, 2: 0, 3: 0, 4: 0 },
  };
}
function nilaiVarRow(r, v) {
  let s = 0;
  for (const c of v.cols) s += Number(r[c]) || 0;
  return s * (v.factor ?? 1);
}

function agregasiRangkuman(cfg, v, rows) {
  const map = new Map();
  for (const r of rows) {
    const nama = r.namatanaman;
    if (!nama) continue;
    if (!map.has(nama)) map.set(nama, objRangkumanKosong());
    const o = map.get(nama);
    if (!o.idtanaman && r.idtanaman) o.idtanaman = r.idtanaman;

    const nilai = nilaiVarRow(r, v);
    if (v.mode === "avg" && nilai === 0) continue;

    let b = null, tw = null;
    if (cfg.periodeCol === "bulan") {
      const bb = Number(r.bulan);
      if (bb >= 1 && bb <= 12) { b = bb; tw = Math.ceil(bb / 3); }
    } else {
      const t = Number(r.triwulan);
      if (t >= 1 && t <= 4) tw = t;
    }
    if (tw === null) continue;
    if (b !== null) {
      o.bulanS[b] = (o.bulanS[b] || 0) + nilai;
      o.bulanN[b] = (o.bulanN[b] || 0) + 1;
    }
    o.twS[tw] += nilai;
    o.twN[tw] += 1;
  }
  const avg = v.mode === "avg";
  for (const o of map.values()) {
    for (const b in o.bulanS) o.bulan[b] = avg ? o.bulanS[b] / o.bulanN[b] : o.bulanS[b];
    for (let t = 1; t <= 4; t++) o.tw[t] = avg ? (o.twN[t] ? o.twS[t] / o.twN[t] : 0) : o.twS[t];
  }
  return map;
}

function twTerakhirAdaData(twObj) {
  for (let t = 4; t >= 1; t--) if ((twObj[t] || 0) !== 0) return t;
  return null;
}

function hitungSatuGrowth(valNow, valBase) {
  if (valBase !== 0) return ((valNow - valBase) / valBase) * 100;
  if (valNow !== 0) return 100;
  return null;
}

function kumulRangkuman(o, upto, mode) {
  if (mode === "stok") return o.tw[upto] || 0;
  if (mode === "avg") {
    let s = 0, n = 0;
    for (let t = 1; t <= upto; t++) { s += o.twS[t]; n += o.twN[t]; }
    return n ? s / n : 0;
  }
  let s = 0;
  for (let t = 1; t <= upto; t++) s += o.tw[t] || 0;
  return s;
}

function hitungBarisRangkuman(v, d, dLalu) {
  const twNow = twTerakhirAdaData(d.tw);
  let jumlah = 0, qtoq = null, yoy = null, ctoc = null;
  if (twNow !== null) {
    jumlah = v.mode === "stok" ? (d.tw[twNow] || 0) : kumulRangkuman(d, 4, v.mode);
    const valNow = d.tw[twNow] || 0;
    const valPrevQ = twNow === 1 ? (dLalu.tw[4] || 0) : (d.tw[twNow - 1] || 0);
    const valYoy = dLalu.tw[twNow] || 0;
    qtoq = hitungSatuGrowth(valNow, valPrevQ);
    yoy = hitungSatuGrowth(valNow, valYoy);
    ctoc = hitungSatuGrowth(kumulRangkuman(d, twNow, v.mode), kumulRangkuman(dLalu, twNow, v.mode));
  }
  return { jumlah, qtoq, yoy, ctoc };
}

function susunDataRangkuman(cfg, v, rowsIni, rowsLalu, jenis) {
  const mapIni = agregasiRangkuman(cfg, v, rowsIni);
  const mapLalu = agregasiRangkuman(cfg, v, rowsLalu);
  const urutanMap = state.idTanamanUrutan[jenis] || {};
  const namaList = Array.from(mapIni.keys()).sort((a, b) => {
    const ua = urutanMap[normalisasiNamaTanaman(a)];
    const ub = urutanMap[normalisasiNamaTanaman(b)];
    if (ua !== undefined && ub !== undefined) return ua - ub;
    if (ua !== undefined) return -1;
    if (ub !== undefined) return 1;
    return a.localeCompare(b, "id");
  });

  const totalBulan = {}; for (let b = 1; b <= 12; b++) totalBulan[b] = 0;
  const totalTw = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const totalTwLalu = { 1: 0, 2: 0, 3: 0, 4: 0 };

  const baris = namaList.map((nama) => {
    const d = mapIni.get(nama);
    const dLalu = mapLalu.get(nama) || objRangkumanKosong();
    const isGroup = isNamaGroup(nama);
    if (!isGroup) {
      for (let b = 1; b <= 12; b++) totalBulan[b] += d.bulan[b] || 0;
      for (let t = 1; t <= 4; t++) { totalTw[t] += d.tw[t] || 0; totalTwLalu[t] += dLalu.tw[t] || 0; }
    }
    return { nama, d, isGroup, hasil: hitungBarisRangkuman(v, d, dLalu) };
  });

  let total = null;
  if (v.mode !== "avg") {
    const dT = objRangkumanKosong(); dT.tw = totalTw; dT.bulan = totalBulan;
    const dL = objRangkumanKosong(); dL.tw = totalTwLalu;
    total = { d: dT, hasil: hitungBarisRangkuman(v, dT, dL) };
  }
  return { baris, total };
}

function labelJumlahRangkuman(v) {
  return v.mode === "avg" ? "Rata-rata" : v.mode === "stok" ? "TW Terakhir" : "Jumlah";
}
function labelWilayahRangkuman(kabPilihan, kecPilihan) {
  const kabEntry = DAFTAR_KAB_BABEL.find((k) => k.id === kabPilihan);
  let label = kabPilihan === "semua" ? "Semua Kabupaten/Kota (Provinsi)" : (kabEntry ? kabEntry.nama : kabPilihan);
  if (kecPilihan && kecPilihan !== "semua") label += ` — Kec. ${kecPilihan}`;
  return label;
}

function renderRangkuman(cfg, v, rowsIni, rowsLalu, jenis, tahun, kabPilihan, kecPilihan) {
  const area = $("rangkuman-area");
  const { baris, total } = susunDataRangkuman(cfg, v, rowsIni, rowsLalu, jenis);
  const labelWilayah = labelWilayahRangkuman(kabPilihan, kecPilihan);

  if (baris.length === 0) {
    area.innerHTML = `<div class="placeholder-kosong">Tidak ada data ${cfg.label} tahun ${tahun} untuk ${labelWilayah}.</div>`;
    return;
  }

  const pakaiBulan = cfg.periodeCol === "bulan";
  const dec = v.mode === "avg" ? 0 : 2;
  const BULAN_SINGKAT = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  let kolomHead = `<th>Kode</th><th>Nama</th><th>Satuan</th>`;
  if (pakaiBulan) kolomHead += BULAN_SINGKAT.map((b) => `<th>${b}</th>`).join("");
  kolomHead += `<th>TW 1</th><th>TW 2</th><th>TW 3</th><th>TW 4</th><th>${labelJumlahRangkuman(v)}</th><th>q-to-q</th><th>y-on-y</th><th>c-to-c</th>`;

  const buatBaris = (kode, nama, d, hasil, tebal) => {
    const T = (x) => (tebal ? `<strong>${x}</strong>` : x);
    let tds = `<td>${kode}</td><td class="nama">${T(nama)}</td><td>${tebal ? "" : v.satuan}</td>`;
    if (pakaiBulan) for (let b = 1; b <= 12; b++) tds += `<td>${T(fmt(d.bulan[b] || 0, dec))}</td>`;
    for (let t = 1; t <= 4; t++) tds += `<td>${T(fmt(d.tw[t] || 0, dec))}</td>`;
    tds += `<td>${T(fmt(hasil.jumlah, dec))}</td>`;
    tds += `<td>${fmtGrowthHtml(hasil.qtoq, tebal)}</td><td>${fmtGrowthHtml(hasil.yoy, tebal)}</td><td>${fmtGrowthHtml(hasil.ctoc, tebal)}</td>`;
    return `<tr>${tds}</tr>`;
  };

  let bodyRows = baris.map((x) => buatBaris(x.d.idtanaman || "-", x.nama, x.d, x.hasil, false)).join("");
  if (total) bodyRows += buatBaris("", "TOTAL", total.d, total.hasil, true);

  area.innerHTML = `
    <div class="tabel-blok">
      <div class="scroll-atas"><div class="scroll-atas-dummy"></div></div>
      <div class="tabel-scroll">
        <div class="tabel-konten">
          <div class="tabel-judul">
            <span>Tabulasi ${v.label} ${cfg.label} — ${labelWilayah} — Tahun ${tahun}</span>
            <span class="satuan">q-to-q, y-on-y &amp; c-to-c dalam %</span>
          </div>
          <table class="tabel-rekon tabel-rangkuman">
            <thead><tr>${kolomHead}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  initScrollAtas(area);
}

// ============================================================
// DOWNLOAD RANGKUMAN EXCEL
// ============================================================
const XL_HIJAU_HEADER = "FF1f9d6e";
const XL_KUNING_JUDUL = "FFFFF176";
const XL_HIJAU_GROWTH = "FF1f9d6e";
const XL_MERAH_GROWTH = "FFc0392b";
const XL_TOTAL_BG     = "FFe8ede9";
const XL_ABU_STRIPE   = "FFf8f8f8";
const XL_PUTIH        = "FFFFFFFF";

function xlBorder() {
  const s = { style: "thin", color: { rgb: "FFCCCCCC" } };
  return { top: s, bottom: s, left: s, right: s };
}

function xlCell(v, opts = {}) {
  const cell = { v: v ?? "", t: typeof v === "number" ? "n" : "s" };
  if (v === null || v === undefined) { cell.v = ""; cell.t = "s"; }
  const s = { border: xlBorder(), alignment: { horizontal: opts.align ?? "center", vertical: "center", wrapText: false } };
  if (opts.bold || opts.bgColor || opts.color) {
    s.font = {};
    if (opts.bold) s.font.bold = true;
    if (opts.color) s.font.color = { rgb: opts.color };
    if (opts.bgColor) { s.fill = { patternType: "solid", fgColor: { rgb: opts.bgColor } }; }
  }
  if (opts.numFmt) s.numFmt = opts.numFmt;
  cell.s = s;
  return cell;
}

function tulisSheetRangkuman(wb, sheetName, cfg, v, data, tahun, labelWilayah) {
  const pakaiBulan = cfg.periodeCol === "bulan";
  const BULAN_SINGKAT_XL = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  const headers = ["Kode", "Nama", "Satuan"];
  if (pakaiBulan) BULAN_SINGKAT_XL.forEach((b) => headers.push(b));
  headers.push("TW 1", "TW 2", "TW 3", "TW 4", labelJumlahRangkuman(v), "q-to-q (%)", "y-on-y (%)", "c-to-c (%)");

  const nCol = headers.length;
  const ws = {};
  const range = { s: { r: 0, c: 0 }, e: { r: 0, c: nCol - 1 } };
  const setCell = (r, c, cell) => {
    ws[XLSX.utils.encode_cell({ r, c })] = cell;
    if (r > range.e.r) range.e.r = r;
    if (c > range.e.c) range.e.c = c;
  };

  const judulTeks = `Tabulasi ${v.label} ${cfg.label} — ${labelWilayah} — Tahun ${tahun}  |  q-to-q, y-on-y, c-to-c dalam %`;
  setCell(0, 0, xlCell(judulTeks, { bold: true, bgColor: XL_KUNING_JUDUL, align: "left" }));
  for (let c = 1; c < nCol; c++) setCell(0, c, xlCell("", { bgColor: XL_KUNING_JUDUL }));
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: nCol - 1 } }];

  headers.forEach((h, c) => {
    setCell(1, c, xlCell(h, { bold: true, bgColor: XL_HIJAU_HEADER, color: XL_PUTIH, align: c <= 2 ? "left" : "center" }));
  });

  let r = 2;
  const tulisBaris = (kode, nama, satuan, d, hasil, bold, bg) => {
    let c = 0;
    const num = (x) => xlCell(x === 0 ? null : x, { numFmt: "#,##0.00", bgColor: bg, bold });
    const growth = (x) => {
      if (x === null) return xlCell("-", { bgColor: bg, bold });
      const color = x > 0 ? XL_HIJAU_GROWTH : x < 0 ? XL_MERAH_GROWTH : undefined;
      return xlCell(x, { numFmt: "#,##0.00", color, bgColor: bg, bold });
    };
    setCell(r, c++, xlCell(kode, { align: "left", bgColor: bg, bold }));
    setCell(r, c++, xlCell(nama, { align: "left", bgColor: bg, bold }));
    setCell(r, c++, xlCell(satuan, { align: "left", bgColor: bg, bold }));
    if (pakaiBulan) for (let b = 1; b <= 12; b++) setCell(r, c++, num(d.bulan[b] || 0));
    for (let t = 1; t <= 4; t++) setCell(r, c++, num(d.tw[t] || 0));
    setCell(r, c++, num(hasil.jumlah));
    setCell(r, c++, growth(hasil.qtoq));
    setCell(r, c++, growth(hasil.yoy));
    setCell(r, c++, growth(hasil.ctoc));
    r++;
  };

  data.baris.forEach((x, i) => {
    tulisBaris(x.d.idtanaman || "-", x.nama, v.satuan, x.d, x.hasil, false, i % 2 === 1 ? XL_ABU_STRIPE : undefined);
  });
  if (data.total) tulisBaris("", "TOTAL", "", data.total.d, data.total.hasil, true, XL_TOTAL_BG);

  ws["!ref"] = XLSX.utils.encode_range(range);
  ws["!cols"] = headers.map((h, i) => (i === 1 ? { wch: 28 } : i === 2 ? { wch: 12 } : i === 0 ? { wch: 14 } : { wch: 11 }));
  XLSX.utils.book_append_sheet(wb, ws, sheetName.replace(/[:\\/?*[\]]/g, "").slice(0, 31));
}

async function downloadRangkumanExcel() {
  if (!state.profile) return;
  const jenis = $("sel-jenis-rangkuman").value;
  const cfg = SPH_CONFIG[jenis];
  const v = varRangkumanAktif(jenis);
  const tahun = Number($("sel-tahun-rangkuman").value);
  const kabPilihan = $("sel-kab-rangkuman").value;
  const kecPilihan = $("sel-kec-rangkuman").value;
  const btn = $("btn-download-rangkuman");
  const log = $("log-download-rangkuman");

  btn.disabled = true;
  btn.textContent = "⏳ Mengambil data...";
  log.textContent = "Memuat data...";
  try {
    const [rowsIni, rowsLalu] = await Promise.all([
      ambilRowsRangkuman(cfg, v, tahun, kabPilihan, kecPilihan),
      ambilRowsRangkuman(cfg, v, tahun - 1, kabPilihan, kecPilihan),
    ]);
    if (rowsIni.length === 0) { log.textContent = `Tidak ada data ${cfg.label} tahun ${tahun} untuk pilihan ini.`; return; }

    const data = susunDataRangkuman(cfg, v, rowsIni, rowsLalu, jenis);
    const wb = XLSX.utils.book_new();
    tulisSheetRangkuman(wb, v.label, cfg, v, data, tahun, labelWilayahRangkuman(kabPilihan, kecPilihan));

    const kabEntry = DAFTAR_KAB_BABEL.find((k) => k.id === kabPilihan);
    let labelFile = kabPilihan === "semua" ? "SemuaKab" : (kabEntry ? kabEntry.nama : kabPilihan).replace(/\s+/g, "");
    if (kecPilihan !== "semua") labelFile += "_" + kecPilihan.replace(/\s+/g, "");
    const namaFile = `Tabulasi_${cfg.label}_${v.label.replace(/[^A-Za-z0-9]+/g, "")}_${labelFile}_${tahun}.xlsx`;
    XLSX.writeFile(wb, namaFile, { bookSST: false, cellStyles: true });
    log.textContent = `✓ Selesai! → "${namaFile}"`;
    setTimeout(() => { if (log.textContent.startsWith("✓ Selesai!")) log.textContent = ""; }, 6000);
  } catch (e) {
    log.textContent = `✗ Gagal: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "⬇ Download Tabulasi Data SPH";
  }
}

$("btn-download-rangkuman").addEventListener("click", downloadRangkumanExcel);

// ============================================================
// PANEL KANAN — VIEW: KONFIRMASI ANOMALI
// ============================================================
$("sel-jenis-anomali").addEventListener("change", () => { isiFilterPeriodeAnomali(); muatAnomali(); });
$("sel-kab-anomali").addEventListener("change", muatAnomali);
$("sel-tahun-anomali").addEventListener("change", muatAnomali);
$("sel-triwulan-anomali").addEventListener("change", muatAnomali);

function tahunAnomaliAktif() {
  const v = $("sel-tahun-anomali").value;
  return v === "semua" || v === "" ? null : Number(v);
}

function triwulanAnomaliAktif() {
  const v = $("sel-triwulan-anomali").value;
  return v === "semua" || v === "" ? null : Number(v);
}

function modePeriodeAnomali() {
  return $("sel-jenis-anomali").value === "sbs" ? "bulan" : "tw";
}

// SPH-SBS = filter BULAN (1-12). SPH lain = filter TRIWULAN (1-4).
function terapkanFilterTriwulan(q, jenis) {
  const v = triwulanAnomaliAktif();
  if (v === null) return q;
  const mode = modePeriodeAnomali();
  if (jenis === "sbs") {
    if (mode === "bulan") return q.eq("bulan", v);
    return q.gte("bulan", (v - 1) * 3 + 1).lte("bulan", v * 3);
  }
  const tw = mode === "bulan" ? Math.ceil(v / 3) : v;
  return q.eq("bulan", tw);
}

function terapkanFilterTriwulanSemuaJenis(q) {
  const v = triwulanAnomaliAktif();
  if (v === null) return q;
  let sbsCond, tw;
  if (modePeriodeAnomali() === "bulan") {
    sbsCond = `and(jenis.eq.sbs,bulan.eq.${v})`;
    tw = Math.ceil(v / 3);
  } else {
    sbsCond = `and(jenis.eq.sbs,bulan.gte.${(v - 1) * 3 + 1},bulan.lte.${v * 3})`;
    tw = v;
  }
  return q.or(`${sbsCond},and(jenis.neq.sbs,bulan.eq.${tw})`);
}

function isiFilterPeriodeAnomali() {
  const sel = $("sel-triwulan-anomali");
  const mode = modePeriodeAnomali();
  if (sel.dataset.mode === mode) return;
  sel.dataset.mode = mode;
  const lbl = $("lbl-periode-anomali");
  if (mode === "bulan") {
    if (lbl) lbl.textContent = "Bulan";
    sel.innerHTML = `<option value="semua">— Semua Bulan —</option>` +
      NAMA_BULAN.slice(1).map((n, i) => `<option value="${i + 1}">${n}</option>`).join("");
  } else {
    if (lbl) lbl.textContent = "Triwulan";
    sel.innerHTML = `<option value="semua">— Semua Triwulan —</option>` +
      [1, 2, 3, 4].map((t) => `<option value="${t}">Triwulan ${t}</option>`).join("");
  }
  sel.value = "semua";
}

function isProv() { return state.profile?.role === "prov"; }

// Akun provinsi "terbatas" (mis. sph1900): tidak boleh tambah baris / upload massal / hapus.
function isProvTerbatas() { return isProv() && state.profile?.akses_terbatas === true; }

function twSekarang() {
  return Math.ceil((new Date().getMonth() + 1) / 3);
}

function bulanDalamTw(tw) {
  const start = (tw - 1) * 3 + 1;
  return [start, start + 1, start + 2];
}

const NAMA_BULAN = [
  "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function labelPeriodeDefault() {
  return `TW${twSekarang()} ${new Date().getFullYear()}`;
}

function daftarKomoditiAnomali() {
  const jenis = $("sel-jenis-anomali").value;
  const namaAsli = state.idTanamanNamaAsli?.[jenis] || [];
  return namaAsli;
}

// Daftar kecamatan 1 kabupaten (gabungan semua jenis SPH), di-cache per kab_id.
async function muatKecamatanKab(kabId) {
  if (state.kecamatanPerKab[kabId]) return state.kecamatanPerKab[kabId];
  const tabel = ["data_sbs", "data_bst", "data_tbf", "data_th"];
  let semua = [];
  for (const t of tabel) {
    try {
      const rows = await fetchAllRows((from, to) =>
        supabase.from(t).select("nama_kec, urutkec").eq("nama_kab", kabId).range(from, to)
      );
      semua = semua.concat(rows || []);
    } catch (e) { /* lewati */ }
  }
  // Ejaan yang ditampilkan = varian yang PALING SERING muncul di data asli.
  const keyKec = (n) => normalisasiNamaTanaman(n).replace(/\s+/g, "");
  const grup = new Map();
  for (const r of semua) {
    if (!r.nama_kec) continue;
    const key = keyKec(r.nama_kec);
    if (!grup.has(key)) grup.set(key, { urutan: r.urutkec ?? 0, varian: new Map() });
    const g = grup.get(key);
    g.varian.set(r.nama_kec, (g.varian.get(r.nama_kec) || 0) + 1);
  }
  const list = Array.from(grup.values())
    .sort((a, b) => a.urutan - b.urutan)
    .map((g) => {
      let namaTerbanyak = null, jumlahTerbanyak = -1;
      for (const [nama, jumlah] of g.varian.entries()) {
        if (jumlah > jumlahTerbanyak) { namaTerbanyak = nama; jumlahTerbanyak = jumlah; }
      }
      return namaTerbanyak;
    });
  state.kecamatanPerKab[kabId] = list;
  return list;
}

function siapkanSlicerAnomali() {
  // Urutan dropdown: Jenis SPH, Tahun, Bulan/Triwulan, Wilayah
  const slicerAnomali = $("view-anomali").querySelector(".rekon-slicer");
  const fieldJenis = $("sel-jenis-anomali").closest(".field");
  if (slicerAnomali && fieldJenis && slicerAnomali.firstElementChild !== fieldJenis) {
    slicerAnomali.insertBefore(fieldJenis, slicerAnomali.firstElementChild);
  }
  isiFilterPeriodeAnomali();
  const selKab = $("sel-kab-anomali");
  if (isProv()) {
    selKab.disabled = false;
    selKab.innerHTML =
      `<option value="semua">— Semua Kabupaten/Kota —</option>` +
      KAB_ANOMALI_LIST.map((k) => {
        const entry = DAFTAR_KAB_BABEL.find((d) => d.id === k);
        return `<option value="${k}">${entry ? entry.nama : k}</option>`;
      }).join("");
  } else {
    const namakabDB = state.profile.kab_id;
    const entry = DAFTAR_KAB_BABEL.find((d) => d.id === namakabDB);
    selKab.innerHTML = `<option value="${namakabDB}">${entry ? entry.nama : namakabDB}</option>`;
    selKab.disabled = true;
  }
  $("anomali-toolbar-prov").classList.toggle("hidden", !isProv());
  $("anomali-toolbar-kabkot").classList.toggle("hidden", isProv());

  if (isProv()) {
    const terbatas = isProvTerbatas();
    $("btn-buka-tambah-anomali").classList.toggle("hidden", terbatas);
    $("btn-buka-generate-anomali").classList.toggle("hidden", terbatas);
    $("lbl-upload-anomali").classList.toggle("hidden", terbatas);
    $("btn-hapus-terpilih-anomali").classList.toggle("hidden", terbatas);
    $("btn-buka-hapus-anomali").classList.toggle("hidden", terbatas);
  }
}

async function muatAnomali() {
  if (!state.profile) return;
  state.dashboardAnomaliAktif = false;
  perbaruiTombolDashboardAnomali();
  const jenis = $("sel-jenis-anomali").value;
  const kabId = $("sel-kab-anomali").value;
  const area = $("anomali-area");
  if (!kabId) return;

  const modeSemua = kabId === "semua";

  if (isProv() && !isProvTerbatas()) {
    const btnTambah = $("btn-buka-tambah-anomali");
    if (btnTambah) {
      btnTambah.disabled = false;
      btnTambah.title = "";
    }
  }

  mulaiLoadingDonut(area);

  const tahunAktif = tahunAnomaliAktif();

  let rows;
  try {
    if (modeSemua) {
      const hasilPerKab = await Promise.all(
        KAB_ANOMALI_LIST.map((kab) =>
          fetchAllRows((from, to) => {
            let q = supabase.from("konfirmasi_anomali").select("*").eq("jenis", jenis).eq("kab_id", kab);
            if (tahunAktif !== null) q = q.eq("tahun", tahunAktif);
            q = terapkanFilterTriwulan(q, jenis);
            return q.order("no_urut", { ascending: true }).range(from, to);
          })
        )
      );
      rows = hasilPerKab.flat();
    } else {
      rows = await fetchAllRows((from, to) => {
        let q = supabase.from("konfirmasi_anomali").select("*").eq("jenis", jenis).eq("kab_id", kabId);
        if (tahunAktif !== null) q = q.eq("tahun", tahunAktif);
        q = terapkanFilterTriwulan(q, jenis);
        return q.order("no_urut", { ascending: true }).range(from, to);
      });
    }
  } catch (e) {
    area.innerHTML = `<div class="placeholder-kosong">Gagal memuat data: ${e.message}</div>`;
    return;
  }
  state.anomaliRows = rows || [];

  if (modeSemua) {
    const daftarPerKab = await Promise.all(KAB_ANOMALI_LIST.map((kab) => muatKecamatanKab(kab)));
    const daftarKecGabung = daftarPerKab.flat();
    const seen = new Set();
    state.daftarKecAktif = daftarKecGabung.filter((n) => {
      const key = normalisasiNamaTanaman(n).replace(/\s+/g, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } else {
    state.daftarKecAktif = await muatKecamatanKab(kabId);
  }

  renderAnomaliSorted();
}

// ---- Sorting tabel Konfirmasi Anomali ----
const KOLOM_ANOMALI_SORTABLE = [
  { key: "no_urut", label: "No", tipe: "angka" },
  { key: "kecamatan", label: "Kecamatan", tipe: "teks" },
  { key: "nama_komoditi", label: "Nama Komoditi", tipe: "teks" },
  { key: "bulan", label: "Bulan", tipe: "angka" },
  { key: "rincian", label: "Rincian", tipe: "teks" },
  { key: "kalimat_anomali", label: "Anomali", tipe: "teks" },
  { key: "tindak_lanjut", label: "Tindak Lanjut", tipe: "teks" },
  { key: "konfirmasi_kabkot", label: null, tipe: "teks" },
  { key: "approval_provinsi", label: "Approval", tipe: "teks" },
];

function bandingkanDefaultAnomali(a, b) {
  const jenis = $("sel-jenis-anomali").value;
  const urutanMap = state.idTanamanUrutan[jenis] || {};

  const ika = KAB_ANOMALI_LIST.indexOf(a.kab_id);
  const ikb = KAB_ANOMALI_LIST.indexOf(b.kab_id);
  const kaba = ika === -1 ? 999 : ika;
  const kabb = ikb === -1 ? 999 : ikb;
  if (kaba !== kabb) return kaba - kabb;

  const ua = urutanMap[normalisasiNamaTanaman(a.nama_komoditi)];
  const ub = urutanMap[normalisasiNamaTanaman(b.nama_komoditi)];
  if (ua !== undefined && ub !== undefined && ua !== ub) return ua - ub;
  if (ua !== undefined && ub === undefined) return -1;
  if (ua === undefined && ub !== undefined) return 1;
  if (ua === undefined && ub === undefined) {
    const cmpNama = String(a.nama_komoditi ?? "").toLowerCase()
      .localeCompare(String(b.nama_komoditi ?? "").toLowerCase(), "id");
    if (cmpNama !== 0) return cmpNama;
  }

  const ba = a.bulan ?? 999;
  const bb = b.bulan ?? 999;
  if (ba !== bb) return ba - bb;

  return (a.no_urut ?? 0) - (b.no_urut ?? 0);
}

function bandingkanAnomali(a, b, kolom, tipe, arah) {
  if (kolom === "no_urut") {
    const cmp = bandingkanDefaultAnomali(a, b);
    return arah === "asc" ? cmp : -cmp;
  }
  let va = a[kolom];
  let vb = b[kolom];
  if (tipe === "angka") {
    const na = va === null || va === undefined;
    const nb = vb === null || vb === undefined;
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    va = Number(va); vb = Number(vb);
    return arah === "asc" ? va - vb : vb - va;
  }
  va = String(va ?? "").toLowerCase();
  vb = String(vb ?? "").toLowerCase();
  const cmp = va.localeCompare(vb, "id");
  return arah === "asc" ? cmp : -cmp;
}

function renderAnomaliSorted() {
  const { kolom, arah } = state.anomaliSort;
  const info = KOLOM_ANOMALI_SORTABLE.find((k) => k.key === kolom);
  const tipe = info ? info.tipe : "teks";
  const rowsSorted = [...state.anomaliRows].sort((a, b) => bandingkanAnomali(a, b, kolom, tipe, arah));
  renderAnomali(rowsSorted);
}

// Baca nilai kolom langsung dari DOM (bukan cache) supaya sort akurat.
function nilaiKolomDariBarisAnomali(tr, kolom) {
  const tds = tr.children;
  const adaChk = !!tr.querySelector(".chk-anomali");
  const adaKabKol = $("sel-kab-anomali")?.value === "semua";
  // Urutan: [chk?] [No] [Kabupaten?] [Kecamatan] [Komoditi] [Bulan] [Rincian] [Kalimat] [TindakLanjut] [Kabkot] [Approval]
  const offsetNo = adaChk ? 1 : 0;
  const offset = offsetNo + (adaKabKol ? 1 : 0);

  if (kolom === "_kab") {
    return tr.dataset.kabId || "";
  }

  switch (kolom) {
    case "no_urut": {
      const txt = (tds[offsetNo]?.textContent || "").trim();
      return txt === "" ? null : Number(txt);
    }
    case "kecamatan": {
      const input = tds[0 + offset]?.querySelector(".combo-input, .combo-input-wrap");
      return (input ? input.value : tds[0 + offset]?.textContent || "").trim();
    }
    case "nama_komoditi": {
      const input = tds[1 + offset]?.querySelector(".combo-input, .combo-input-wrap");
      return (input ? input.value : tds[1 + offset]?.textContent || "").trim();
    }
    case "bulan": {
      const input = tds[2 + offset]?.querySelector(".combo-input");
      const txt = (input ? input.value : tds[2 + offset]?.textContent || "").trim();
      const jenisAktif = $("sel-jenis-anomali").value;
      const idx = daftarPeriodeAnomali(jenisAktif).indexOf(txt);
      return idx >= 0 ? idx + 1 : null;
    }
    case "rincian": {
      const sel = tds[3 + offset]?.querySelector("select");
      return (sel ? sel.value : tds[3 + offset]?.textContent || "").trim();
    }
    case "kalimat_anomali": {
      const teksEl = tds[4 + offset]?.querySelector(".kalimat-teks");
      return (teksEl ? teksEl.textContent : tds[4 + offset]?.textContent || "").trim();
    }
    case "tindak_lanjut": {
      const sel = tds[5 + offset]?.querySelector("select");
      return (sel ? sel.value : tds[5 + offset]?.textContent || "").trim();
    }
    case "konfirmasi_kabkot":
      return (tds[6 + offset]?.textContent || "").trim();
    case "approval_provinsi": {
      const sel = tds[7 + offset]?.querySelector("select");
      return (sel ? sel.value : tds[7 + offset]?.textContent || "").trim();
    }
    default:
      return "";
  }
}

function bandingkanNilaiAnomali(va, vb, tipe, arah) {
  if (tipe === "angka") {
    const na = va === null || va === undefined;
    const nb = vb === null || vb === undefined;
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    return arah === "asc" ? va - vb : vb - va;
  }
  if (tipe === "kab") {
    const ia = KAB_ANOMALI_LIST.indexOf(va);
    const ib = KAB_ANOMALI_LIST.indexOf(vb);
    const na = ia === -1, nb = ib === -1;
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    return arah === "asc" ? ia - ib : ib - ia;
  }
  const sa = String(va ?? "").toLowerCase();
  const sb = String(vb ?? "").toLowerCase();
  const cmp = sa.localeCompare(sb, "id");
  return arah === "asc" ? cmp : -cmp;
}

function urutkanBarisAnomaliDiDom(kolom, arah) {
  const tbody = document.querySelector("#anomali-area table.tabel-anomali tbody");
  if (!tbody) return;
  const info = KOLOM_ANOMALI_SORTABLE.find((k) => k.key === kolom);
  const tipe = info ? info.tipe : "teks";
  const trs = Array.from(tbody.children);
  trs.sort((ta, tb) => {
    const va = nilaiKolomDariBarisAnomali(ta, kolom);
    const vb = nilaiKolomDariBarisAnomali(tb, kolom);
    return bandingkanNilaiAnomali(va, vb, kolom === "_kab" ? "kab" : tipe, arah);
  });
  trs.forEach((tr) => tbody.appendChild(tr));

  if ($("sel-kab-anomali")?.value === "semua") {
    const trsBaru = Array.from(tbody.children);
    trsBaru.forEach((tr, idx) => {
      const adaChk = !!tr.querySelector(".chk-anomali");
      const tdNo = tr.children[adaChk ? 1 : 0];
      if (tdNo) tdNo.textContent = String(idx + 1);
    });
  }
}

function perbaruiLabelHeaderAnomali() {
  const table = document.querySelector("#anomali-area table.tabel-anomali");
  if (!table) return;
  const { kolom: kolomAktif, arah: arahAktif } = state.anomaliSort;
  const modeSemua = $("sel-kab-anomali")?.value === "semua";
  const jenisAktif = $("sel-jenis-anomali").value;
  const labelKonfirmasiKol = modeSemua ? "Konfirmasi Kabkot" : `Konfirmasi ${labelKabAnomaliAktif()}`;
  const labelKolom = { _kab: "Kabupaten", no_urut: "No", kecamatan: "Kecamatan", bulan: labelKolomPeriodeAnomali(jenisAktif), nama_komoditi: "Nama Komoditi", rincian: "Rincian", kalimat_anomali: "Anomali", tindak_lanjut: "Tindak Lanjut", konfirmasi_kabkot: labelKonfirmasiKol, approval_provinsi: "Approval" };
  table.querySelectorAll("thead th.th-sortable").forEach((th) => {
    const key = th.dataset.kolom;
    const panah = kolomAktif === key ? (arahAktif === "asc" ? " ▲" : " ▼") : "";
    th.textContent = (labelKolom[key] ?? "") + panah;
  });
}

const BULAN_SINGKAT_ANOMALI = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
const TRIWULAN_LABEL_ANOMALI = ["Tw1", "Tw2", "Tw3", "Tw4"];

// SBS = Bulan (1-12), BST/TBF/TH = Triwulan (1-4). Kolom DB tetap "bulan".
function daftarPeriodeAnomali(jenis) {
  return jenis === "sbs" ? BULAN_SINGKAT_ANOMALI : TRIWULAN_LABEL_ANOMALI;
}
function labelKolomPeriodeAnomali(jenis) {
  return jenis === "sbs" ? "Bulan" : "Triwulan";
}

function buatTdBulan(rowId, bulanSaatIni, editable, jenis) {
  const daftarPeriode = daftarPeriodeAnomali(jenis);
  const td = document.createElement("td");

  if (!editable) {
    td.classList.add("terkunci");
    td.textContent = bulanSaatIni ? (daftarPeriode[bulanSaatIni - 1] || "") : "";
    return td;
  }

  const labelSaatIni = bulanSaatIni ? daftarPeriode[bulanSaatIni - 1] : "";

  const wrap = document.createElement("div");
  wrap.className = "combo-wrap";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "combo-input";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = jenis === "sbs" ? "Cari bulan..." : "Cari triwulan...";
  input.value = labelSaatIni;

  const list = document.createElement("div");
  list.className = "combo-list combo-list-sempit hidden";

  let labelTersimpan = labelSaatIni;

  function renderList(filterTeks) {
    const q = normalisasiNamaTanaman(filterTeks || "");
    const hasil = q
      ? daftarPeriode.filter((n) => normalisasiNamaTanaman(n).includes(q))
      : daftarPeriode;
    list.innerHTML = hasil.length
      ? hasil.map((n) => `<div class="combo-option" data-nama="${n}">${n}</div>`).join("")
      : `<div class="combo-empty">(tidak ada yang cocok)</div>`;
    list.classList.remove("hidden");
  }

  async function pilihBulan(labelBulan) {
    input.value = labelBulan;
    labelTersimpan = labelBulan;
    list.classList.add("hidden");
    const nomor = daftarPeriode.indexOf(labelBulan) + 1;
    await simpanKolomAnomali(rowId, "bulan", nomor || null);
  }

  input.addEventListener("focus", () => { renderList(""); input.select(); });
  input.addEventListener("input", () => renderList(input.value));

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const opsiPertama = list.querySelector(".combo-option");
      if (opsiPertama) {
        pilihBulan(opsiPertama.dataset.nama);
      } else {
        input.value = labelTersimpan;
        list.classList.add("hidden");
      }
      input.blur();
    } else if (e.key === "Escape") {
      input.value = labelTersimpan;
      list.classList.add("hidden");
      input.blur();
    }
  });

  list.addEventListener("mousedown", (e) => {
    const opt = e.target.closest(".combo-option");
    if (!opt) return;
    e.preventDefault();
    pilihBulan(opt.dataset.nama);
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      list.classList.add("hidden");
      const ketikan = input.value.trim();
      if (ketikan === labelTersimpan) return;
      const cocok = daftarPeriode.find((n) => normalisasiNamaTanaman(n) === normalisasiNamaTanaman(ketikan));
      if (cocok) {
        pilihBulan(cocok);
      } else {
        input.value = labelTersimpan;
      }
    }, 150);
  });

  wrap.appendChild(input);
  wrap.appendChild(list);
  td.appendChild(wrap);
  return td;
}

// Combobox Komoditi (ketik + cari, dropdown selalu di bawah input)
function buatTdKomoditi(rowId, nilaiSaatIni, editable) {
  const td = document.createElement("td");

  if (!editable) {
    td.classList.add("terkunci");
    td.textContent = nilaiSaatIni || "";
    return td;
  }

  const namaList = daftarKomoditiAnomali();

  if (namaList.length === 0) {
    td.contentEditable = "true";
    td.spellcheck = false;
    td.textContent = nilaiSaatIni || "";
    td.addEventListener("blur", async () => {
      await simpanKolomAnomali(rowId, "nama_komoditi", td.textContent.trim());
    });
    return td;
  }

  const wrap = document.createElement("div");
  wrap.className = "combo-wrap";

  const input = document.createElement("textarea");
  input.spellcheck = false;
  input.rows = 1;
  input.className = "combo-input-wrap";
  input.autocomplete = "off";
  input.placeholder = "Ketik utk cari...";
  input.value = nilaiSaatIni || "";
  input.addEventListener("input", () => autoGrowTextarea(input));

  const list = document.createElement("div");
  list.className = "combo-list hidden";

  let nilaiTersimpan = nilaiSaatIni || "";

  function renderList(filterTeks) {
    const q = normalisasiNamaTanaman(filterTeks || "");
    const hasil = q
      ? namaList.filter((n) => normalisasiNamaTanaman(n).includes(q))
      : namaList;
    if (hasil.length === 0) {
      list.innerHTML = `<div class="combo-empty">(tidak ada yang cocok)</div>`;
    } else {
      list.innerHTML = hasil.map((n) =>
        `<div class="combo-option" data-nama="${n.replace(/"/g, "&quot;")}">${n}</div>`
      ).join("");
    }
    list.classList.remove("hidden");
  }

  async function pilihNama(nama) {
    input.value = nama;
    nilaiTersimpan = nama;
    list.classList.add("hidden");
    autoGrowTextarea(input);
    await simpanKolomAnomali(rowId, "nama_komoditi", nama);
  }

  input.addEventListener("focus", () => { renderList(""); input.select(); });
  input.addEventListener("input", () => renderList(input.value));

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const opsiPertama = list.querySelector(".combo-option");
      if (opsiPertama) {
        pilihNama(opsiPertama.dataset.nama);
      } else {
        input.value = nilaiTersimpan;
        list.classList.add("hidden");
      }
      input.blur();
    } else if (e.key === "Escape") {
      input.value = nilaiTersimpan;
      list.classList.add("hidden");
      input.blur();
    }
  });

  list.addEventListener("mousedown", (e) => {
    const opt = e.target.closest(".combo-option");
    if (!opt) return;
    e.preventDefault();
    pilihNama(opt.dataset.nama);
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      list.classList.add("hidden");
      const ketikan = input.value.trim();
      if (ketikan === nilaiTersimpan) return;
      const cocok = namaList.find((n) => normalisasiNamaTanaman(n) === normalisasiNamaTanaman(ketikan));
      if (cocok) {
        pilihNama(cocok);
      } else {
        input.value = nilaiTersimpan;
      }
    }, 150);
  });

  wrap.appendChild(input);
  wrap.appendChild(list);
  td.appendChild(wrap);
  requestAnimationFrame(() => autoGrowTextarea(input));
  return td;
}

// Combobox Kecamatan (pola sama dengan Komoditi)
function buatTdKecamatan(rowId, nilaiSaatIni, editable, daftarKec) {
  const td = document.createElement("td");

  if (!editable) {
    td.classList.add("terkunci");
    td.textContent = nilaiSaatIni || "";
    return td;
  }

  if (!daftarKec || daftarKec.length === 0) {
    td.contentEditable = "true";
    td.spellcheck = false;
    td.textContent = nilaiSaatIni || "";
    td.addEventListener("blur", async () => {
      await simpanKolomAnomali(rowId, "kecamatan", td.textContent.trim());
    });
    return td;
  }

  const wrap = document.createElement("div");
  wrap.className = "combo-wrap";

  const input = document.createElement("textarea");
  input.spellcheck = false;
  input.rows = 1;
  input.className = "combo-input-wrap";
  input.autocomplete = "off";
  input.placeholder = "Ketik utk cari...";
  input.value = nilaiSaatIni || "";
  input.addEventListener("input", () => autoGrowTextarea(input));

  const list = document.createElement("div");
  list.className = "combo-list hidden";

  let nilaiTersimpan = nilaiSaatIni || "";

  function renderList(filterTeks) {
    const q = normalisasiNamaTanaman(filterTeks || "");
    const hasil = q ? daftarKec.filter((n) => normalisasiNamaTanaman(n).includes(q)) : daftarKec;
    list.innerHTML = hasil.length
      ? hasil.map((n) => `<div class="combo-option" data-nama="${n.replace(/"/g, "&quot;")}">${n}</div>`).join("")
      : `<div class="combo-empty">(tidak ada yang cocok)</div>`;
    list.classList.remove("hidden");
  }

  async function pilihNama(nama) {
    input.value = nama;
    nilaiTersimpan = nama;
    list.classList.add("hidden");
    autoGrowTextarea(input);
    await simpanKolomAnomali(rowId, "kecamatan", nama);
  }

  input.addEventListener("focus", () => { renderList(""); input.select(); });
  input.addEventListener("input", () => renderList(input.value));

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const opsiPertama = list.querySelector(".combo-option");
      if (opsiPertama) {
        pilihNama(opsiPertama.dataset.nama);
      } else {
        input.value = nilaiTersimpan;
        list.classList.add("hidden");
      }
      input.blur();
    } else if (e.key === "Escape") {
      input.value = nilaiTersimpan;
      list.classList.add("hidden");
      input.blur();
    }
  });

  list.addEventListener("mousedown", (e) => {
    const opt = e.target.closest(".combo-option");
    if (!opt) return;
    e.preventDefault();
    pilihNama(opt.dataset.nama);
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      list.classList.add("hidden");
      const ketikan = input.value.trim();
      if (ketikan === nilaiTersimpan) return;
      const cocok = daftarKec.find((n) => normalisasiNamaTanaman(n) === normalisasiNamaTanaman(ketikan));
      if (cocok) {
        pilihNama(cocok);
      } else {
        input.value = nilaiTersimpan;
      }
    }, 150);
  });

  wrap.appendChild(input);
  wrap.appendChild(list);
  td.appendChild(wrap);
  requestAnimationFrame(() => autoGrowTextarea(input));
  return td;
}

// Kolom Label (G/M): G = hasil Generate, M = manual. Read-only.
function buatTdLabelSumber(sumber) {
  const td = document.createElement("td");
  td.className = "col-label terkunci";
  const nilai = sumber === "G" ? "G" : "M";
  const judul = nilai === "G" ? "Generated (otomatis dari outlier)" : "Manual (input langsung)";
  td.innerHTML = `<span class="label-sumber label-sumber-${nilai.toLowerCase()}" title="${judul}">${nilai}</span>`;
  return td;
}

// ---- Kolom Rincian: dropdown pilihan sesuai jenis SPH + "Lainnya..." utk custom ----
function buatTdRincian(rowId, nilaiSaatIni, editable, jenis) {
  const td = document.createElement("td");
  td.classList.add("col-rincian");
  if (!editable) {
    td.classList.add("terkunci");
    td.textContent = nilaiSaatIni || "";
    return td;
  }

  const opsi = [...(OPSI_RINCIAN[jenis] || [])];
  if (nilaiSaatIni && !opsi.includes(nilaiSaatIni)) opsi.push(nilaiSaatIni); // nilai custom lama tetap tampil

  const sel = document.createElement("select");
  sel.className = "sel-rincian";

  const tambahOpsi = (value, label, sebelum) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    if (sebelum) sel.insertBefore(o, sebelum); else sel.appendChild(o);
    return o;
  };

  // Opsi kosong HANYA muncul sbg placeholder utk baris yang rinciannya belum
  // diisi, dan tidak bisa dipilih lagi dari daftar (hidden + disabled).
  if (!nilaiSaatIni) {
    const optKosong = tambahOpsi("", "— Pilih —");
    optKosong.hidden = true;
    optKosong.disabled = true;
  }
  opsi.forEach((n) => tambahOpsi(n, n));
  const optLain = tambahOpsi("__lain__", "Lainnya...");
  sel.value = nilaiSaatIni || "";

  let nilaiTersimpan = nilaiSaatIni || "";

  const tampil = document.createElement("div");
  tampil.className = "rincian-tampil";
  const setTampil = () => {
    const v = sel.value === "__lain__" ? nilaiTersimpan : sel.value;
    tampil.textContent = v === "Belum Habis" ? "Belum\nHabis" : (v || "— Pilih —");
  };
  setTampil();

  sel.addEventListener("change", async () => {
    if (sel.value === "__lain__") {
      const teks = (prompt("Tulis rincian anomali (custom):") || "").trim();
      if (!teks) { sel.value = nilaiTersimpan; return; }
      const sudahAda = Array.from(sel.options).find((o) => o.value === teks);
      if (!sudahAda) tambahOpsi(teks, teks, optLain);
      sel.value = teks;
    }
    nilaiTersimpan = sel.value;
    setTampil();
    await simpanKolomAnomali(rowId, "rincian", sel.value);
  });

  const wrapR = document.createElement("div");
  wrapR.className = "rincian-wrap";
  wrapR.appendChild(tampil);
  wrapR.appendChild(sel);
  td.appendChild(wrapR);
  return td;
}

function buatTdTindakLanjut(rowId, nilaiSaatIni, editable) {
  const td = document.createElement("td");
  if (!editable) {
    td.classList.add("terkunci");
    td.textContent = nilaiSaatIni === "wajar" ? "Wajar" : nilaiSaatIni === "perbaikan" ? "Perbaikan" : "";
    return td;
  }
  const sel = document.createElement("select");
  sel.className = "sel-tindak-lanjut";
  sel.innerHTML = `
    <option value="" ${!nilaiSaatIni ? "selected" : ""}>Belum</option>
    <option value="wajar" ${nilaiSaatIni === "wajar" ? "selected" : ""}>Wajar</option>
    <option value="perbaikan" ${nilaiSaatIni === "perbaikan" ? "selected" : ""}>Perbaikan</option>`;
  sel.addEventListener("change", async () => {
    await simpanKolomAnomali(rowId, "tindak_lanjut", sel.value);
  });
  td.appendChild(sel);
  return td;
}

function labelKabAnomaliAktif() {
  const kabId = $("sel-kab-anomali").value;
  if (kabId === "semua") return "Semua Kabupaten/Kota";
  const entry = DAFTAR_KAB_BABEL.find((d) => d.id === kabId);
  return entry ? entry.nama : (kabId || "Kabkot");
}

function renderAnomali(rows) {
  const area = $("anomali-area");
  const prov = isProv();
  const provFull = prov && !isProvTerbatas();
  const bisaIsiKonfirmasi = provFull || !prov;
  const kabIdAktif = $("sel-kab-anomali").value;
  const modeSemua = kabIdAktif === "semua";
  const labelKab = labelKabAnomaliAktif();
  const jenisAktif = $("sel-jenis-anomali").value;

  if (prov && !isProvTerbatas()) {
    const btnTambah = $("btn-buka-tambah-anomali");
    if (btnTambah) {
      btnTambah.disabled = false;
      btnTambah.title = "";
    }
  }

  if (rows.length === 0 && !prov) {
    area.innerHTML = `<div class="placeholder-kosong">Belum ada anomali yang ditandai Provinsi untuk kombinasi ini.</div>`;
    return;
  }
  if (rows.length === 0 && prov) {
    area.innerHTML = `<div class="placeholder-kosong">Belum ada data anomali untuk pilihan ini.</div>`;
    return;
  }

  const tbl = document.createElement("table");
  tbl.className = "tabel-anomali";

  const { kolom: kolomAktif, arah: arahAktif } = state.anomaliSort;
  const labelKonfirmasiKol = modeSemua ? "Konfirmasi Kabkot" : `Konfirmasi ${labelKab}`;
  const labelKolom = { no_urut: "No", kecamatan: "Kecamatan", bulan: labelKolomPeriodeAnomali(jenisAktif), nama_komoditi: "Nama Komoditi", rincian: "Rincian", kalimat_anomali: "Anomali", tindak_lanjut: "Tindak Lanjut", konfirmasi_kabkot: labelKonfirmasiKol, approval_provinsi: "Approval" };
  const clsExtra = {
    no_urut: "col-no",
    kecamatan: "col-kecamatan",
    bulan: "col-bulan",
    nama_komoditi: "col-komoditi",
    rincian: "col-rincian",
    kalimat_anomali: "col-anomali",
    tindak_lanjut: "col-tindak-lanjut",
    konfirmasi_kabkot: "col-kabkot",
    approval_provinsi: "col-approval",
  };

  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  if (provFull) {
    const thChk = document.createElement("th");
    thChk.className = "col-chk";
    const chkSemua = document.createElement("input");
    chkSemua.type = "checkbox";
    chkSemua.id = "chk-semua-anomali";
    chkSemua.title = "Pilih/batalkan semua baris";
    chkSemua.addEventListener("change", () => {
      document.querySelectorAll("#anomali-area .chk-anomali").forEach((c) => { c.checked = chkSemua.checked; });
    });
    thChk.appendChild(chkSemua);
    trHead.appendChild(thChk);
  }
  KOLOM_ANOMALI_SORTABLE.forEach(({ key, tipe }) => {
    const th = document.createElement("th");
    th.className = "th-sortable" + (clsExtra[key] ? " " + clsExtra[key] : "");
    th.dataset.kolom = key;
    const panah = kolomAktif === key ? (arahAktif === "asc" ? " ▲" : " ▼") : "";
    th.textContent = labelKolom[key] + panah;
    th.addEventListener("click", () => {
      if (state.anomaliSort.kolom === key) {
        state.anomaliSort.arah = state.anomaliSort.arah === "asc" ? "desc" : "asc";
      } else {
        state.anomaliSort = { kolom: key, arah: "asc" };
      }
      urutkanBarisAnomaliDiDom(state.anomaliSort.kolom, state.anomaliSort.arah);
      perbaruiLabelHeaderAnomali();
    });
    trHead.appendChild(th);
    if (modeSemua && key === "no_urut") {
      const thKab = document.createElement("th");
      thKab.className = "th-sortable col-kecamatan";
      thKab.textContent = "Kabupaten";
      thKab.dataset.kolom = "_kab";
      thKab.addEventListener("click", () => {
        if (state.anomaliSort.kolom === "_kab") {
          state.anomaliSort.arah = state.anomaliSort.arah === "asc" ? "desc" : "asc";
        } else {
          state.anomaliSort = { kolom: "_kab", arah: "asc" };
        }
        urutkanBarisAnomaliDiDom(state.anomaliSort.kolom, state.anomaliSort.arah);
        perbaruiLabelHeaderAnomali();
      });
      trHead.appendChild(thKab);
    }
  });
  if (provFull) {
    const thLabel = document.createElement("th");
    thLabel.className = "col-label";
    thLabel.textContent = "Label";
    trHead.appendChild(thLabel);
  }
  if (provFull) {
    const thHapus = document.createElement("th");
    thHapus.className = "col-hapus";
    trHead.appendChild(thHapus);
  }
  thead.appendChild(trHead);
  tbl.appendChild(thead);
  const tbody = document.createElement("tbody");

  rows.forEach((r, idxBaris) => {
    const tr = document.createElement("tr");
    tr.dataset.id = r.id;
    tr.dataset.kabId = r.kab_id || "";
    tr.dataset.tahun = r.tahun ?? "";

    const nilaiNo = modeSemua ? (idxBaris + 1) : (r.no_urut ?? "");
    const tdNo = editableTd(nilaiNo, "no_urut", provFull && !modeSemua, true);
    tdNo.classList.add("col-no");

    const tdKecamatan = buatTdKecamatan(r.id, r.kecamatan ?? "", provFull, state.kecamatanPerKab[r.kab_id] || state.daftarKecAktif);
    tdKecamatan.classList.add("col-kecamatan");

    const tdKomoditi = buatTdKomoditi(r.id, r.nama_komoditi ?? "", provFull);
    tdKomoditi.classList.add("col-komoditi");

    const tdBulan = buatTdBulan(r.id, r.bulan, provFull, jenisAktif);
    tdBulan.classList.add("td-bulan", "col-bulan");

    const tdRincian = buatTdRincian(r.id, r.rincian ?? "", provFull, jenisAktif);

    const tdKalimat = buatTdKalimat(r, provFull);
    tdKalimat.classList.add("col-anomali");

    const tdTindakLanjut = buatTdTindakLanjut(r.id, r.tindak_lanjut ?? "", bisaIsiKonfirmasi);
    tdTindakLanjut.classList.add("col-tindak-lanjut");

    const tdKabkot = editableTd(r.konfirmasi_kabkot ?? "", "konfirmasi_kabkot", bisaIsiKonfirmasi, false);
    tdKabkot.classList.add("col-kabkot");

    const tdApproval = document.createElement("td");
    tdApproval.classList.add("col-approval");
    if (provFull) {
      const sel = document.createElement("select");
      sel.className = "sel-approval approval-" + (r.approval_provinsi || "kosong");
      sel.innerHTML = `
        <option value="" ${!r.approval_provinsi ? "selected" : ""}>Belum</option>
        <option value="ya" ${r.approval_provinsi === "ya" ? "selected" : ""}>Ya</option>
        <option value="tidak" ${r.approval_provinsi === "tidak" ? "selected" : ""}>Tidak</option>`;
      sel.addEventListener("change", async () => {
        sel.className = "sel-approval approval-" + (sel.value || "kosong");
        await simpanKolomAnomali(r.id, "approval_provinsi", sel.value);
      });
      tdApproval.appendChild(sel);
    } else {
      tdApproval.textContent = r.approval_provinsi === "ya" ? "Ya" : r.approval_provinsi === "tidak" ? "Tidak" : "Belum";
      tdApproval.classList.add("terkunci");
    }

    tr.appendChild(tdNo);
    tr.appendChild(tdKecamatan);
    tr.appendChild(tdKomoditi);
    tr.appendChild(tdBulan);
    tr.appendChild(tdRincian);
    tr.appendChild(tdKalimat);
    tr.appendChild(tdTindakLanjut);
    tr.appendChild(tdKabkot);
    tr.appendChild(tdApproval);

    if (provFull) {
      tr.appendChild(buatTdLabelSumber(r.sumber));
    }

    if (modeSemua) {
      const tdKabNama = document.createElement("td");
      tdKabNama.className = "col-kecamatan terkunci";
      const kabE = DAFTAR_KAB_BABEL.find((k) => k.id === r.kab_id);
      tdKabNama.textContent = kabE ? kabE.nama.replace(/^Kab\.\s+/i, "") : (r.kab_id || "");
      tr.insertBefore(tdKabNama, tdNo.nextSibling);
    }

    if (provFull) {
      const tdChk = document.createElement("td");
      tdChk.className = "col-chk";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "chk-anomali";
      chk.dataset.id = r.id;
      tdChk.appendChild(chk);
      tr.insertBefore(tdChk, tr.firstChild);
    }

    if (provFull) {
      const tdHapus = document.createElement("td");
      tdHapus.className = "col-hapus";
      tdHapus.innerHTML = `<button class="btn-hapus-baris" title="Hapus baris">✕</button>`;
      tdHapus.querySelector("button").addEventListener("click", () => hapusBarisAnomali(r.id, tr));
      tr.appendChild(tdHapus);
    }

    tbody.appendChild(tr);
  });

  tbl.appendChild(tbody);
  area.innerHTML = "";
  area.appendChild(tbl);
}

// ---- Style tambahan (tombol "i" rentang wajar + kolom Rincian) ----
(function pasangStyleInfoRentang() {
  const st = document.createElement("style");
  st.textContent = `
    .kalimat-teks { display: inline; }
    .kalimat-teks[contenteditable="true"] { cursor: text; }
    .kalimat-teks[contenteditable="true"]:focus { outline: 2px solid var(--hijau-muda); outline-offset: 2px; background: #eafaf1; }
    .info-rentang-wrap { position: relative; display: inline-block; margin-left: 6px; vertical-align: middle; }
    .btn-info-rentang {
      width: 18px; height: 18px; padding: 0; border-radius: 50%;
      border: 1px solid var(--hijau-muda); background: #fff; color: var(--hijau-tua);
      font: italic bold 12px Georgia, serif; line-height: 1; cursor: pointer;
    }
    .btn-info-rentang:hover { background: #eafaf1; }
    .popup-rentang {
      position: absolute; left: 24px; top: -4px; z-index: 60;
      background: #fff; border: 1px solid #ccc; border-radius: 6px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.18);
      padding: 6px 10px; font-size: 12px; line-height: 1.4;
      white-space: nowrap; color: var(--teks-gelap);
    }
    .popup-rentang strong { color: var(--hijau-tua); }
    table.tabel-anomali td.col-rincian, table.tabel-anomali th.col-rincian {
      width: 96px; min-width: 90px; text-align: center;
    }
    .rincian-wrap { position: relative; width: 100%; }
    .rincian-tampil {
      border: 1px solid #ccc; border-radius: 4px; background: #fff;
      padding: 4px 18px 4px 6px; font-size: 12px; line-height: 1.3;
      text-align: left; white-space: pre-line; min-height: 26px;
      display: flex; align-items: center;
    }
    .rincian-tampil::after { content: "▾"; position: absolute; right: 6px; top: 50%; transform: translateY(-50%); color: #555; }
    table.tabel-anomali .rincian-wrap select.sel-rincian {
      position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer;
    }
    table.tabel-dashboard-anomali tr.baris-mulai-kec td { border-top: 1px solid var(--hijau-muda); }
    table.tabel-anomali select.sel-rincian {
      width: 100%; padding: 4px 6px; font-size: 12px; border: 1px solid #ccc; border-radius: 4px;
      font-family: inherit;
    }
  `;
  document.head.appendChild(st);
  document.addEventListener("click", (e) => {
    if (e.target.closest(".info-rentang-wrap")) return;
    document.querySelectorAll(".popup-rentang").forEach((p) => p.remove());
  });
})();

function buatTdKalimat(r, editable) {
  const td = document.createElement("td");
  const teks = document.createElement("div");
  teks.className = "kalimat-teks";
  teks.textContent = r.kalimat_anomali ?? "";
  if (editable) {
    teks.contentEditable = "true";
    teks.spellcheck = false;
    teks.addEventListener("blur", async () => {
      await simpanKolomAnomali(r.id, "kalimat_anomali", teks.textContent.trim());
    });
  } else {
    td.classList.add("terkunci");
  }
  td.appendChild(teks);

  if (r.rentang_wajar) {
    const wrap = document.createElement("span");
    wrap.className = "info-rentang-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-info-rentang";
    btn.textContent = "i";
    btn.title = "Lihat rentang wajar";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const ada = wrap.querySelector(".popup-rentang");
      document.querySelectorAll(".popup-rentang").forEach((p) => p.remove());
      if (ada) return;
      const pop = document.createElement("div");
      pop.className = "popup-rentang";
      pop.innerHTML = `Rentang wajar: <strong></strong>`;
      pop.querySelector("strong").textContent = r.rentang_wajar;
      wrap.appendChild(pop);
    });
    wrap.appendChild(btn);
    td.appendChild(wrap);
  }
  return td;
}

function editableTd(value, field, editable, isNumber) {
  const td = document.createElement("td");
  td.textContent = value;
  if (!editable) {
    td.classList.add("terkunci");
    return td;
  }
  td.contentEditable = "true";
  td.spellcheck = false;
  td.addEventListener("blur", async () => {
    let v = td.textContent.trim();
    if (isNumber) v = Number(v) || 0;
    const tr = td.closest("tr");
    await simpanKolomAnomali(Number(tr.dataset.id), field, v);
  });
  return td;
}

async function simpanKolomAnomali(id, field, value) {
  try {
    const { error } = await supabase.from("konfirmasi_anomali").update({ [field]: value }).eq("id", id);
    if (error) throw error;
    // Sinkronkan cache lokal supaya sort tidak me-render data lama.
    const row = state.anomaliRows.find((r) => r.id === id);
    if (row) row[field] = value;
  } catch (e) {
    alert("Gagal menyimpan: " + e.message);
  }
}

async function hapusBarisAnomali(id, trEl) {
  const btnHapus = trEl?.querySelector(".btn-hapus-baris");
  const chkBaris = trEl?.querySelector(".chk-anomali");
  if (btnHapus) {
    btnHapus.disabled = true;
    btnHapus.classList.add("loading");
    btnHapus.innerHTML = `<span class="mini-spinner"></span>`;
  }
  if (chkBaris) chkBaris.disabled = true;
  if (trEl) trEl.classList.add("baris-sedang-proses");

  try {
    const jenis = $("sel-jenis-anomali").value;
    const kabIdDropdown = $("sel-kab-anomali").value;
    const kabId = kabIdDropdown === "semua" ? (trEl?.dataset.kabId || "") : kabIdDropdown;
    const tahunBaris = trEl?.dataset.tahun ? Number(trEl.dataset.tahun) : null;

    const { error } = await supabase.from("konfirmasi_anomali").delete().eq("id", id);
    if (error) throw error;

    if (kabId) {
      const sisa = await fetchAllRows((from, to) => {
        let q = supabase.from("konfirmasi_anomali").select("id, no_urut").eq("jenis", jenis).eq("kab_id", kabId);
        if (tahunBaris !== null) q = q.eq("tahun", tahunBaris);
        return q.order("no_urut", { ascending: true }).range(from, to);
      });
      for (let i = 0; i < sisa.length; i++) {
        const nomorBaru = i + 1;
        if (sisa[i].no_urut !== nomorBaru) {
          await supabase.from("konfirmasi_anomali").update({ no_urut: nomorBaru }).eq("id", sisa[i].id);
        }
      }
    }

    await muatAnomali();
  } catch (e) {
    if (btnHapus) {
      btnHapus.disabled = false;
      btnHapus.classList.remove("loading");
      btnHapus.innerHTML = "✕";
    }
    if (chkBaris) chkBaris.disabled = false;
    if (trEl) trEl.classList.remove("baris-sedang-proses");
    alert("Gagal menghapus: " + e.message);
  }
}

$("btn-hapus-terpilih-anomali")?.addEventListener("click", hapusTerpilihAnomali);

async function hapusTerpilihAnomali() {
  const checked = Array.from(document.querySelectorAll("#anomali-area .chk-anomali:checked"));
  if (checked.length === 0) {
    alert("Belum ada baris yang dipilih (centang dulu di kolom sebelah No).");
    return;
  }

  const ids = checked.map((c) => Number(c.dataset.id));
  const jenis = $("sel-jenis-anomali").value;
  const kabId = $("sel-kab-anomali").value;

  const btn = $("btn-hapus-terpilih-anomali");
  const teksAsli = btn.textContent;
  btn.disabled = true;
  btn.textContent = `⏳ Menghapus ${ids.length} baris...`;

  try {
    const { error } = await supabase.from("konfirmasi_anomali").delete().in("id", ids);
    if (error) throw error;

    const tahunAktif = tahunAnomaliAktif();
    const sisa = await fetchAllRows((from, to) => {
      let q = supabase.from("konfirmasi_anomali").select("id, no_urut").eq("jenis", jenis).eq("kab_id", kabId);
      if (tahunAktif !== null) q = q.eq("tahun", tahunAktif);
      return q.order("no_urut", { ascending: true }).range(from, to);
    });
    for (let i = 0; i < sisa.length; i++) {
      const nomorBaru = i + 1;
      if (sisa[i].no_urut !== nomorBaru) {
        await supabase.from("konfirmasi_anomali").update({ no_urut: nomorBaru }).eq("id", sisa[i].id);
      }
    }

    await muatAnomali();
  } catch (e) {
    alert("Gagal menghapus baris terpilih: " + e.message);
    btn.disabled = false;
    btn.textContent = teksAsli;
  }
}

// ---- Tambah Baris ----
$("btn-buka-tambah-anomali")?.addEventListener("click", () => {
  const kabId = $("sel-kab-anomali").value;
  if (kabId === "semua") {
    $("sel-kab-tambah").innerHTML = KAB_ANOMALI_LIST.map((k) => {
      const e = DAFTAR_KAB_BABEL.find((d) => d.id === k);
      return `<option value="${k}">${e ? e.nama : k}</option>`;
    }).join("");
    $("modal-tambah-anomali").classList.remove("hidden");
  } else {
    tambahBarisAnomali(kabId);
  }
});
function tutupModalTambahAnomali() { $("modal-tambah-anomali").classList.add("hidden"); }
$("btn-tutup-tambah-anomali")?.addEventListener("click", tutupModalTambahAnomali);
$("btn-batal-tambah-anomali")?.addEventListener("click", tutupModalTambahAnomali);
$("modal-tambah-anomali")?.addEventListener("click", (e) => {
  if (e.target.id === "modal-tambah-anomali") tutupModalTambahAnomali();
});
$("btn-konfirmasi-tambah-anomali")?.addEventListener("click", async () => {
  const kab = $("sel-kab-tambah").value;
  tutupModalTambahAnomali();
  await tambahBarisAnomali(kab);
});

async function tambahBarisAnomali(kabId) {
  const jenis = $("sel-jenis-anomali").value;
  const tahun = tahunAnomaliAktif() ?? TAHUN_SEKARANG;
  const v = triwulanAnomaliAktif();
  let bulanVal, labelPeriode;
  if (jenis === "sbs") {
    bulanVal = v ?? (new Date().getMonth() + 1);
    labelPeriode = BULAN_SINGKAT_ANOMALI[bulanVal - 1];
  } else {
    bulanVal = v ?? twSekarang();
    labelPeriode = `Tw${bulanVal}`;
  }

  try {
    const rowsSaatIni = await fetchAllRows((from, to) =>
      supabase.from("konfirmasi_anomali").select("id")
        .eq("jenis", jenis).eq("kab_id", kabId).eq("tahun", tahun)
        .range(from, to)
    );
    const noUrutBaru = (rowsSaatIni?.length || 0) + 1;

    const { error } = await supabase.from("konfirmasi_anomali").insert({
      jenis, kab_id: kabId, tahun,
      no_urut: noUrutBaru,
      bulan: bulanVal,
      periode_teks: `${labelPeriode} ${tahun}`,
      kecamatan: "", nama_komoditi: "", rincian: "", kalimat_anomali: "", tindak_lanjut: "",
      sumber: "M",
    });
    if (error) throw error;
    await muatAnomali();
  } catch (e) {
    alert("Gagal menambah baris: " + e.message);
  }
}

// ---- Popup Hapus Semua Anomali (GLOBAL: semua SPH & kabupaten) ----
async function bukaModalHapusAnomali() {
  let totalSemua = 0;
  try {
    const semua = await fetchAllRows((from, to) =>
      supabase.from("konfirmasi_anomali").select("id").range(from, to)
    );
    totalSemua = semua.length;
  } catch (e) {
    alert("Gagal mengecek jumlah data: " + e.message);
    return;
  }
  if (totalSemua === 0) {
    alert("Tidak ada data anomali sama sekali di seluruh kabupaten & jenis SPH.");
    return;
  }
  $("teks-konfirmasi-hapus-anomali").textContent =
    `Akan menghapus SEMUA ${totalSemua} baris data anomali dari SEMUA jenis SPH (SBS/BST/TBF/TH) ` +
    `dan SEMUA kabupaten/kota sekaligus. Tindakan ini tidak bisa dibatalkan.`;
  $("modal-hapus-anomali").classList.remove("hidden");
}
function tutupModalHapusAnomali() {
  $("modal-hapus-anomali").classList.add("hidden");
}
$("btn-buka-hapus-anomali")?.addEventListener("click", bukaModalHapusAnomali);
$("btn-tutup-hapus-anomali")?.addEventListener("click", tutupModalHapusAnomali);
$("btn-batal-hapus-anomali")?.addEventListener("click", tutupModalHapusAnomali);
$("modal-hapus-anomali")?.addEventListener("click", (e) => {
  if (e.target.id === "modal-hapus-anomali") tutupModalHapusAnomali();
});

async function hapusSemuaAnomali() {
  const btn = $("btn-konfirmasi-hapus-anomali");
  const teksAsli = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ Menghapus semua...";
  $("btn-backup-lalu-hapus-anomali").disabled = true;
  $("btn-batal-hapus-anomali").disabled = true;
  try {
    const { error } = await supabase.from("konfirmasi_anomali").delete().not("id", "is", null);
    if (error) throw error;
    tutupModalHapusAnomali();
    await muatAnomali();
  } catch (e) {
    alert("Gagal menghapus semua data: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = teksAsli;
    $("btn-backup-lalu-hapus-anomali").disabled = false;
    $("btn-batal-hapus-anomali").disabled = false;
  }
}

$("btn-konfirmasi-hapus-anomali")?.addEventListener("click", hapusSemuaAnomali);

$("btn-backup-lalu-hapus-anomali")?.addEventListener("click", async () => {
  const btn = $("btn-backup-lalu-hapus-anomali");
  btn.disabled = true;
  btn.textContent = "⏳ Mengunduh backup...";
  try {
    const berhasil = await downloadBackupSemuaAnomali();
    if (berhasil) {
      await hapusSemuaAnomali();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "⬇ Download Backup Excel, lalu Hapus";
  }
});

// ============================================================
// GENERATE ANOMALI DARI OUTLIER (khusus prov PENUH)
// ============================================================
function bukaModalGenerateAnomali() {
  const kabId = $("sel-kab-anomali").value;
  if (kabId === "semua") {
    $("txt-kab-generate").textContent = "Semua Kabupaten/Kota";
  } else {
    const kabEntry = DAFTAR_KAB_BABEL.find((k) => k.id === kabId);
    $("txt-kab-generate").textContent = kabEntry ? kabEntry.nama : kabId;
  }
  $("txt-tahun-generate").textContent = $("sel-tahun-anomali").value;
  $("log-generate-anomali").textContent = "";
  $("modal-generate-anomali").classList.remove("hidden");
}
function tutupModalGenerateAnomali() {
  $("modal-generate-anomali").classList.add("hidden");
}
$("btn-buka-generate-anomali")?.addEventListener("click", bukaModalGenerateAnomali);
$("btn-tutup-generate-anomali")?.addEventListener("click", tutupModalGenerateAnomali);
$("modal-generate-anomali")?.addEventListener("click", (e) => {
  if (e.target.id === "modal-generate-anomali") tutupModalGenerateAnomali();
});

function keyKecamatan(n) {
  return normalisasiNamaTanaman(n).replace(/\s+/g, "");
}
function cariNamaKecKanonik(namaAsli, daftarKec) {
  const key = keyKecamatan(namaAsli);
  const cocok = (daftarKec || []).find((n) => keyKecamatan(n) === key);
  return cocok || namaAsli;
}

async function generateAnomaliUntukSatuKab(kabId, tahun, log) {
  const daftarKecKanonik = await muatKecamatanKab(kabId);
  const kabEntry = DAFTAR_KAB_BABEL.find((k) => k.id === kabId);
  const labelKab = kabEntry ? kabEntry.nama : kabId;
  const ringkasan = [];
  let totalDitambah = 0;

  for (const jenis of JENIS_LIST_DASHBOARD) {
    log.textContent = `[${labelKab}] Memindai ${SPH_CONFIG[jenis].label}...`;

    const cfg = SPH_CONFIG[jenis];
    const tabUtama = cfg.tabs.find((t) => !t.single) || cfg.tabs[0];
    const rincianOtomatis = rincianDariTab(tabUtama); // mis. "Habis" / "Provitas"

    const rows = await fetchAllRows((from, to) =>
      supabase.from(cfg.table).select("*").eq("tahun", tahun).eq("nama_kab", kabId).range(from, to)
    );
    if (!rows || rows.length === 0) {
      ringkasan.push(`${labelKab} · ${cfg.label}: tidak ada data`);
      continue;
    }

    const existing = await fetchAllRows((from, to) =>
      supabase.from("konfirmasi_anomali").select("kecamatan, nama_komoditi, bulan, rincian")
        .eq("jenis", jenis).eq("kab_id", kabId).eq("tahun", tahun).range(from, to)
    );
    // Dedup: kombinasi kec+komoditi+periode+rincian. Baris lama yang rinciannya
    // masih kosong dianggap cocok utk rincian apa pun (supaya tidak dobel).
    const keyDasar = (e) => `${normalisasiNamaTanaman(e.kecamatan)}|${normalisasiNamaTanaman(e.nama_komoditi)}|${e.bulan}`;
    const existSet = new Set();
    const existKosong = new Set();
    for (const e of existing || []) {
      if (e.rincian) existSet.add(`${keyDasar(e)}|${normalisasiNamaTanaman(e.rincian)}`);
      else existKosong.add(keyDasar(e));
    }
    let noUrut = existing?.length || 0;

    const perKomoditi = new Map();
    for (const r of rows) {
      const nama = r.namatanaman;
      if (!nama) continue;
      if (isNamaGroup(nama)) continue;
      if (!perKomoditi.has(nama)) perKomoditi.set(nama, []);
      perKomoditi.get(nama).push(r);
    }

    const periodeCol = cfg.periodeCol;
    const barisBaru = [];

    for (const [komoditi, rowsKom] of perKomoditi.entries()) {
      const matrix = new Map();
      const kecInfo = new Map();
      for (const r of rowsKom) {
        const per = Number(r[periodeCol]);
        matrix.set(`${r.kec}|${per}`, nilaiFromRow(r, tabUtama));
        if (!kecInfo.has(r.kec)) kecInfo.set(r.kec, r.nama_kec);
      }

      const [lo, hi] = iqrBounds(Array.from(matrix.values()));
      if (lo === null) continue;

      for (const [key, v] of matrix.entries()) {
        if (!isOutlier(v, lo, hi)) continue;
        const [kecKode, perStr] = key.split("|");
        const per = Number(perStr);
        const namaKecAsli = kecInfo.get(kecKode) || kecKode;
        const namaKec = cariNamaKecKanonik(namaKecAsli, daftarKecKanonik);

        const dasar = `${normalisasiNamaTanaman(namaKec)}|${normalisasiNamaTanaman(komoditi)}|${per}`;
        const dupKey = `${dasar}|${normalisasiNamaTanaman(rincianOtomatis)}`;
        if (existSet.has(dupKey) || existKosong.has(dasar)) continue;
        existSet.add(dupKey);

        noUrut += 1;
        const labelPeriode = periodeCol === "triwulan" ? `Tw${per}` : (cfg.periodeLabels[per - 1] || per);

        barisBaru.push({
          jenis, kab_id: kabId, tahun,
          no_urut: noUrut,
          periode_teks: `${labelPeriode} ${tahun}`,
          kecamatan: namaKec,
          nama_komoditi: komoditi,
          bulan: per,
          rincian: rincianOtomatis,
          kalimat_anomali:
            `Nilai ${tabUtama.label} sebesar ${fmt(v, 2)} ${tabUtama.satuan} terdeteksi di luar rentang wajar.`,
          rentang_wajar: `${fmt(lo, 2)} s.d. ${fmt(hi, 2)} ${tabUtama.satuan}`,
          tindak_lanjut: "",
          sumber: "G",
        });
      }
    }

    if (barisBaru.length === 0) {
      ringkasan.push(`${labelKab} · ${cfg.label}: tidak ada outlier baru`);
      continue;
    }

    const { error } = await supabase.from("konfirmasi_anomali").insert(barisBaru);
    if (error) throw new Error(`${labelKab} · ${cfg.label}: ${error.message}`);

    totalDitambah += barisBaru.length;
    ringkasan.push(`${labelKab} · ${cfg.label}: ${barisBaru.length} baris baru`);
  }

  return { totalDitambah, ringkasan };
}

async function generateAnomaliDariOutlier() {
  const kabId = $("sel-kab-anomali").value;
  const tahun = Number($("sel-tahun-anomali").value);
  const btn = $("btn-generate-anomali");
  const log = $("log-generate-anomali");
  const modeSemua = kabId === "semua";

  btn.disabled = true;
  btn.textContent = "⏳ Memproses...";

  const ringkasan = [];
  let totalDitambah = 0;

  try {
    const kabList = modeSemua ? KAB_ANOMALI_LIST : [kabId];

    for (const kab of kabList) {
      const hasil = await generateAnomaliUntukSatuKab(kab, tahun, log);
      totalDitambah += hasil.totalDitambah;
      ringkasan.push(...hasil.ringkasan);
    }

    console.log("Generate Anomali:", ringkasan.join(" | "));
    log.textContent = totalDitambah > 0
      ? `✓ Selesai! ${totalDitambah} baris anomali baru ditambahkan (tahun ${tahun}).`
      : `Tidak ada outlier baru ditemukan (tahun ${tahun}).`;

    if (totalDitambah > 0) {
      setTimeout(() => tutupModalGenerateAnomali(), 1200);
      await muatAnomali();
    }
  } catch (e) {
    console.log("Generate Anomali gagal, ringkasan sejauh ini:", ringkasan.join(" | "));
    log.textContent = `✗ Gagal: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "⚡ Generate Anomali";
  }
}
$("btn-generate-anomali")?.addEventListener("click", generateAnomaliDariOutlier);

// Cocokkan label kabupaten (dari kolom "Kabupaten/Kota" di Excel) ke id internal.
function cariKabIdDariLabel(label) {
  const s = String(label ?? "").trim().toLowerCase();
  if (!s) return null;
  const entry = DAFTAR_KAB_BABEL.find(
    (k) => k.nama.toLowerCase() === s || k.id.toLowerCase() === s
  );
  return entry ? entry.id : null;
}

// ---- Upload Excel (khusus prov penuh): 1-4 tab sheet, satu per Jenis SPH ----
$("in-file-anomali")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const kabDropdown = $("sel-kab-anomali").value;
  const tahunDropdown = tahunAnomaliAktif();

  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });

    const grupBaris = new Map();
    const sheetTakDikenali = [];
    let dilewatiTanpaKab = 0;
    let dilewatiTanpaTahun = 0;

    for (const sheetName of wb.SheetNames) {
      const kunci = sheetName.trim().toLowerCase();
      let jenis = JENIS_LIST_DASHBOARD.find(
        (j) => SPH_CONFIG[j].label.toLowerCase() === kunci || j === kunci
      );
      if (!jenis) {
        const prefix = kunci.split("_")[0];
        jenis = JENIS_LIST_DASHBOARD.find(
          (j) => SPH_CONFIG[j].label.toLowerCase() === prefix || j === prefix
        );
      }
      if (!jenis) { sheetTakDikenali.push(sheetName); continue; }

      const rowsSheet = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
      const jenisAdalahBulan = jenis === "sbs";
      const daftarPeriodeSheet = daftarPeriodeAnomali(jenis);

      for (const row of rowsSheet) {
        const periodeRaw = String(
          (jenisAdalahBulan ? (row["Bulan"] ?? row.bulan) : (row["Triwulan"] ?? row.triwulan ?? row["Bulan"] ?? row.bulan)) ?? ""
        ).trim();
        const maxVal = jenisAdalahBulan ? 12 : 4;
        let bulanVal = null;
        if (periodeRaw !== "") {
          const angkaMurni = /^[0-9]+$/.test(periodeRaw) ? Number(periodeRaw) : NaN;
          if (!Number.isNaN(angkaMurni) && angkaMurni >= 1 && angkaMurni <= maxVal) {
            bulanVal = angkaMurni;
          } else if (jenisAdalahBulan) {
            const idxPenuh = NAMA_BULAN.findIndex((n) => n.toLowerCase() === periodeRaw.toLowerCase());
            const idxSingkat = daftarPeriodeSheet.findIndex((n) => n.toLowerCase() === periodeRaw.toLowerCase());
            if (idxPenuh > 0) bulanVal = idxPenuh;
            else if (idxSingkat >= 0) bulanVal = idxSingkat + 1;
          } else {
            const idxSingkat = daftarPeriodeSheet.findIndex((n) => n.toLowerCase() === periodeRaw.toLowerCase());
            if (idxSingkat >= 0) {
              bulanVal = idxSingkat + 1;
            } else {
              const angkaDalamTeks = Number((periodeRaw.match(/[0-9]+/) || [])[0]);
              if (!Number.isNaN(angkaDalamTeks) && angkaDalamTeks >= 1 && angkaDalamTeks <= maxVal) bulanVal = angkaDalamTeks;
            }
          }
        }
        const tindakRaw = String(row["Tindak Lanjut"] ?? row.tindak_lanjut ?? "").trim().toLowerCase();
        const tindakVal = tindakRaw === "wajar" ? "wajar" : tindakRaw === "perbaikan" ? "perbaikan" : "";

        const kecamatan = String(row["Kecamatan"] ?? row.kecamatan ?? "").trim();
        const namaKomoditi = String(row["Nama Komoditi"] ?? row.nama_komoditi ?? "").trim();
        const rincian = String(row["Rincian"] ?? row.rincian ?? "").trim();
        const kalimatAnomali = String(row["Kalimat Anomali"] ?? row.kalimat_anomali ?? "").trim();
        if (!namaKomoditi && !kalimatAnomali) continue;

        const kabDariKolom = cariKabIdDariLabel(row["Kabupaten/Kota"] ?? row.kabupaten ?? "");
        const kabId = kabDariKolom || (kabDropdown !== "semua" ? kabDropdown : null);
        if (!kabId) { dilewatiTanpaKab++; continue; }

        const tahunRaw = Number(row["Tahun"] ?? row.tahun ?? "");
        const tahunBaris = Number.isFinite(tahunRaw) && tahunRaw >= TAHUN_AWAL ? tahunRaw : tahunDropdown;
        if (!tahunBaris) { dilewatiTanpaTahun++; continue; }

        const baris = {
          jenis, kab_id: kabId, tahun: tahunBaris,
          kecamatan, bulan: bulanVal, nama_komoditi: namaKomoditi, rincian,
          kalimat_anomali: kalimatAnomali, tindak_lanjut: tindakVal,
          sumber: "M",
        };
        const key = `${jenis}|${kabId}|${tahunBaris}`;
        if (!grupBaris.has(key)) grupBaris.set(key, []);
        grupBaris.get(key).push(baris);
      }
    }

    if (grupBaris.size === 0) {
      let pesan =
        "Tidak ada baris valid utk diupload.\n" +
        "Pastikan nama tab sheet sesuai Jenis SPH (SPH-SBS/SPH-BST/SPH-TBF/SPH-TH, " +
        "atau singkatannya sbs/bst/tbf/th), dan tiap baris ada isi Nama Komoditi / Kalimat Anomali.";
      if (dilewatiTanpaKab > 0) {
        pesan += `\n\n${dilewatiTanpaKab} baris dilewati karena kabupatennya tidak diketahui ` +
          `(kolom "Kabupaten/Kota" kosong/tidak dikenali, dan dropdown Wilayah sedang "Semua Kabupaten/Kota"). ` +
          `Pilih kabupaten spesifik di dropdown Wilayah dulu, atau pastikan kolom "Kabupaten/Kota" terisi benar.`;
      }
      if (dilewatiTanpaTahun > 0) {
        pesan += `\n\n${dilewatiTanpaTahun} baris dilewati karena tahunnya tidak diketahui ` +
          `(kolom "Tahun" kosong, dan dropdown Tahun sedang "Semua Tahun"). ` +
          `Pilih tahun spesifik di dropdown Tahun dulu, atau pastikan kolom "Tahun" terisi benar.`;
      }
      alert(pesan);
      return;
    }

    let semuaBaris = [];
    const ringkasan = [];
    for (const [key, daftarBaris] of grupBaris.entries()) {
      const [jenis, kabIdGrup, tahunGrupStr] = key.split("|");
      const tahunGrup = Number(tahunGrupStr);
      const rowsSaatIni = await fetchAllRows((from, to) =>
        supabase.from("konfirmasi_anomali").select("id")
          .eq("jenis", jenis).eq("kab_id", kabIdGrup).eq("tahun", tahunGrup)
          .range(from, to)
      );
      let noUrut = rowsSaatIni?.length || 0;
      const daftar = daftarBaris.map((r) => {
        noUrut += 1;
        return { ...r, no_urut: noUrut };
      });
      semuaBaris = semuaBaris.concat(daftar);
      const kabEntry = DAFTAR_KAB_BABEL.find((k) => k.id === kabIdGrup);
      ringkasan.push(`${SPH_CONFIG[jenis].label} · ${kabEntry ? kabEntry.nama : kabIdGrup} · ${tahunGrup}: ${daftar.length} baris`);
    }

    const { error } = await supabase.from("konfirmasi_anomali").insert(semuaBaris);
    if (error) throw error;

    console.log("Upload Anomali:", ringkasan.join(" | "));
    let pesan = `✓ Berhasil menambah ${semuaBaris.length} baris anomali.`;
    if (sheetTakDikenali.length > 0) pesan += ` (${sheetTakDikenali.length} tab dilewati, nama tak dikenali.)`;
    if (dilewatiTanpaKab > 0) pesan += ` (${dilewatiTanpaKab} baris dilewati, kab tak diketahui.)`;
    if (dilewatiTanpaTahun > 0) pesan += ` (${dilewatiTanpaTahun} baris dilewati, tahun tak diketahui.)`;
    alert(pesan);

    await muatAnomali();
  } catch (err) {
    alert("Gagal upload Excel: " + err.message);
  } finally {
    e.target.value = "";
  }
});

// ---- Download Excel anomali ----
$("btn-download-anomali")?.addEventListener("click", downloadAnomaliExcel);
$("btn-download-anomali-kabkot")?.addEventListener("click", downloadAnomaliExcel);

// Kolom "ID" WAJIB di posisi pertama (dipakai kabkot saat upload balik konfirmasi).
const ANOMALI_HEADERS = ["ID", "No", "Tahun", "Kabupaten/Kota", "Kecamatan", "Bulan", "Nama Komoditi", "Rincian", "Kalimat Anomali", "Tindak Lanjut", "Konfirmasi Kabkot", "Approval"];
const ANOMALI_COL_WIDTHS = [{ wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 24 }, { wch: 14 }, { wch: 40 }, { wch: 14 }, { wch: 30 }, { wch: 16 }];

function tulisSheetAnomaliDariRows(wb, sheetName, rows, jenis) {
  const ws = {};
  const headers = [...ANOMALI_HEADERS];
  headers[5] = labelKolomPeriodeAnomali(jenis);
  const range = { s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } };
  const setCell = (r, c, cell) => { ws[XLSX.utils.encode_cell({ r, c })] = cell; };

  headers.forEach((h, c) => setCell(0, c, xlCell(h, { bold: true, bgColor: XL_HIJAU_HEADER, color: XL_PUTIH, align: "left" })));
  const daftarPeriode = daftarPeriodeAnomali(jenis);
  const labelTindak = (v) => (v === "wajar" ? "Wajar" : v === "perbaikan" ? "Perbaikan" : "");
  rows.forEach((r, i) => {
    const stripeBg = i % 2 === 1 ? XL_ABU_STRIPE : undefined;
    const bulanLabel = r.bulan ? (daftarPeriode[r.bulan - 1] || r.bulan) : "";
    const kabEntryRow = DAFTAR_KAB_BABEL.find((k) => k.id === r.kab_id);
    const labelKabRow = kabEntryRow ? kabEntryRow.nama : (r.kab_id || "");
    const vals = [
      r.id, r.no_urut, r.tahun ?? "", labelKabRow, r.kecamatan || "", bulanLabel, r.nama_komoditi, r.rincian || "", r.kalimat_anomali,
      labelTindak(r.tindak_lanjut), r.konfirmasi_kabkot,
      r.approval_provinsi === "ya" ? "Ya" : r.approval_provinsi === "tidak" ? "Tidak" : "",
    ];
    vals.forEach((v, c) => setCell(i + 1, c, xlCell(v, { align: c <= 2 ? "center" : "left", bgColor: stripeBg })));
  });

  ws["!ref"] = XLSX.utils.encode_range(range);
  ws["!cols"] = ANOMALI_COL_WIDTHS;
  const namaAman = sheetName.replace(/[:\\/?*[\]]/g, "").slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, namaAman);
}

async function downloadAnomaliExcel() {
  const kabId = $("sel-kab-anomali").value;
  const modeSemua = kabId === "semua";
  const tahunAktif = tahunAnomaliAktif();
  const twAktif = triwulanAnomaliAktif();
  const kabList = modeSemua ? KAB_ANOMALI_LIST : [kabId];
  const labelTahunFile = tahunAktif === null ? "SemuaTahun" : String(tahunAktif);
  const labelTwFile = twAktif === null ? "" : (modePeriodeAnomali() === "bulan" ? `_Bln${twAktif}` : `_TW${twAktif}`);
  const labelKabFile = modeSemua ? "SemuaKab" : (DAFTAR_KAB_BABEL.find((k) => k.id === kabId)?.nama || kabId).replace(/\s+/g, "");

  const wb = XLSX.utils.book_new();
  let adaData = false;

  try {
    for (const kab of kabList) {
      for (const jenis of JENIS_LIST_DASHBOARD) {
        const rows = await fetchAllRows((from, to) => {
          let q = supabase.from("konfirmasi_anomali").select("*").eq("jenis", jenis).eq("kab_id", kab);
          if (tahunAktif !== null) q = q.eq("tahun", tahunAktif);
          q = terapkanFilterTriwulan(q, jenis);
          return q.order("no_urut", { ascending: true }).range(from, to);
        });
        if (!rows || rows.length === 0) continue;
        adaData = true;
        const kabEntry = DAFTAR_KAB_BABEL.find((k) => k.id === kab);
        const sheetName = modeSemua
          ? `${SPH_CONFIG[jenis].label}_${(kabEntry?.nama || kab).replace(/\s+/g, "")}`
          : SPH_CONFIG[jenis].label;
        tulisSheetAnomaliDariRows(wb, sheetName, rows, jenis);
      }
    }
  } catch (e) {
    alert("Gagal mengambil data: " + e.message);
    return false;
  }

  if (!adaData) {
    alert("Tidak ada data anomali untuk didownload.");
    return false;
  }

  XLSX.writeFile(wb, `KonfirmasiAnomali_${labelKabFile}_${labelTahunFile}${labelTwFile}.xlsx`, { cellStyles: true });
  return true;
}

// ---- Upload Konfirmasi Excel (kabkot): pencocokan baris pakai kolom "ID" ----
async function uploadKonfirmasiKabkotExcel(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });

    let totalDicoba = 0, diupdate = 0, dilewati = 0;

    for (const sheetName of wb.SheetNames) {
      const kunciSheet = sheetName.trim().toLowerCase();
      const jenis = JENIS_LIST_DASHBOARD.find(
        (j) => SPH_CONFIG[j].label.toLowerCase() === kunciSheet || j === kunciSheet
      );
      if (!jenis) continue;

      const rowsSheet = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
      for (const row of rowsSheet) {
        const idRaw = row["ID"] ?? row["Id"] ?? row.id ?? "";
        const id = Number(idRaw);
        if (!idRaw || Number.isNaN(id)) continue;

        totalDicoba++;
        const konfirmasiBaru = String(row["Konfirmasi Kabkot"] ?? "").trim();

        const { data, error } = await supabase
          .from("konfirmasi_anomali")
          .update({ konfirmasi_kabkot: konfirmasiBaru })
          .eq("id", id)
          .select("id");

        if (error || !data || data.length === 0) {
          dilewati++;
          continue;
        }
        diupdate++;
      }
    }

    if (totalDicoba === 0) {
      alert(
        "Tidak ada baris dengan kolom ID yang bisa diproses.\n" +
        "Pastikan file yang diupload adalah hasil download dari tombol " +
        "\"Download Anomali SPH\" (kolom ID jangan dihapus/diubah)."
      );
      return;
    }

    let pesan = `✓ Upload konfirmasi selesai.\n${diupdate} baris berhasil diupdate.`;
    if (dilewati > 0) {
      pesan += `\n${dilewati} baris dilewati (kemungkinan anomali itu sudah dihapus Provinsi, jadi diabaikan -- tidak perlu dimasukkan lagi).`;
    }
    alert(pesan);

    await muatAnomali();
  } catch (err) {
    alert("Gagal upload Excel: " + err.message);
  } finally {
    e.target.value = "";
  }
}
$("in-file-konfirmasi-kabkot")?.addEventListener("change", uploadKonfirmasiKabkotExcel);

// ---- Backup Global (sebelum "Hapus Semua Anomali") ----
async function downloadBackupSemuaAnomali() {
  let rows;
  try {
    rows = await fetchAllRows((from, to) =>
      supabase.from("konfirmasi_anomali").select("*")
        .order("jenis", { ascending: true })
        .order("kab_id", { ascending: true })
        .order("no_urut", { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    alert("Gagal mengambil data: " + e.message);
    return false;
  }
  if (!rows || rows.length === 0) {
    alert("Tidak ada data untuk didownload.");
    return false;
  }

  const grup = new Map();
  for (const r of rows) {
    const key = `${r.jenis}|${r.kab_id}`;
    if (!grup.has(key)) grup.set(key, []);
    grup.get(key).push(r);
  }

  const wb = XLSX.utils.book_new();
  for (const [key, groupRows] of grup.entries()) {
    const [jenis, kabId] = key.split("|");
    const kabEntry = DAFTAR_KAB_BABEL.find((k) => k.id === kabId);
    const labelKab = kabEntry ? kabEntry.nama : kabId;
    const sheetLabel = (SPH_CONFIG[jenis]?.label || jenis.toUpperCase()) + "_" + labelKab;
    tulisSheetAnomaliDariRows(wb, sheetLabel, groupRows, jenis);
  }

  const tanggal = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Backup_Semua_Anomali_${tanggal}.xlsx`, { cellStyles: true });
  return true;
}

// ============================================================
// DASHBOARD ANOMALI
// ============================================================
const JENIS_LIST_DASHBOARD = ["sbs", "bst", "tbf", "th"];

function perbaruiTombolDashboardAnomali() {
  const aktif = !!state.dashboardAnomaliAktif;
  document.querySelectorAll("#btn-buka-dashboard-anomali, #btn-buka-dashboard-anomali-kabkot").forEach((btn) => {
    btn.textContent = aktif ? "← Kembali ke Daftar Anomali" : "📊 Dashboard Anomali";
    btn.classList.toggle("btn-oranye", aktif);
  });
}

async function toggleDashboardAnomali() {
  if (state.dashboardAnomaliAktif) {
    await muatAnomali();
  } else {
    await bukaDashboardAnomali();
  }
}

$("btn-buka-dashboard-anomali")?.addEventListener("click", toggleDashboardAnomali);
$("btn-buka-dashboard-anomali-kabkot")?.addEventListener("click", toggleDashboardAnomali);

async function bukaDashboardAnomali() {
  const area = $("anomali-area");
  mulaiLoadingDonut(area, "Memuat data dashboard...");

  const kabList = isProv() ? KAB_ANOMALI_LIST : [state.profile.kab_id];
  const tahunAktif = tahunAnomaliAktif();

  let rows;
  try {
    rows = await fetchAllRows((from, to) => {
      let q = supabase
        .from("konfirmasi_anomali")
        .select("jenis, kab_id, kecamatan, konfirmasi_kabkot, approval_provinsi");
      if (!isProv()) q = q.eq("kab_id", state.profile.kab_id);
      if (tahunAktif !== null) q = q.eq("tahun", tahunAktif);
      q = terapkanFilterTriwulanSemuaJenis(q);
      return q.range(from, to);
    });
  } catch (e) {
    area.innerHTML = `<div class="placeholder-kosong">Gagal memuat data: ${e.message}</div>`;
    return;
  }

  await Promise.all(kabList.map((k) => muatKecamatanKab(k).catch(() => [])));
  state.dashboardAnomaliAktif = true;
  perbaruiTombolDashboardAnomali();
  renderDashboardAnomali(rows, kabList, tahunAktif, triwulanAnomaliAktif());
}

function fmtCountPct(count, total) {
  const pctVal = total > 0 ? Math.round((count / total) * 100) : 0;
  const warna = pctVal >= 100 ? "color:var(--hijau-muda);" : "color:var(--merah);";
  return `${count}<span class="pct" style="${warna}">(${pctVal}%)</span>`;
}

function renderDashboardAnomali(rows, kabList, tahunAktif, twAktif) {
  const area = $("anomali-area");
  const statKosong = () => ({ total: 0, sudahKonfirmasi: 0, belumKonfirmasi: 0, approvalYa: 0, approvalTidak: 0, approvalBelum: 0 });
  const tambahStat = (t, s) => { for (const k in t) t[k] += s[k]; };

  // kab -> kecKey -> { nama, jenis: { sbs: stat, ... } }
  const perKab = new Map(kabList.map((k) => [k, new Map()]));
  for (const r of rows) {
    const kabMap = perKab.get(r.kab_id);
    if (!kabMap) continue;
    const kecKey = keyKecamatan(r.kecamatan) || "_kosong";
    if (!kabMap.has(kecKey)) {
      const nama = r.kecamatan && String(r.kecamatan).trim()
        ? cariNamaKecKanonik(String(r.kecamatan).trim(), state.kecamatanPerKab[r.kab_id])
        : "(Belum diisi)";
      kabMap.set(kecKey, { nama, jenis: {} });
    }
    const kec = kabMap.get(kecKey);
    if (!kec.jenis[r.jenis]) kec.jenis[r.jenis] = statKosong();
    const s = kec.jenis[r.jenis];
    s.total++;
    const sudah = r.konfirmasi_kabkot && String(r.konfirmasi_kabkot).trim() !== "";
    if (sudah) s.sudahKonfirmasi++; else s.belumKonfirmasi++;
    if (r.approval_provinsi === "ya") s.approvalYa++;
    else if (r.approval_provinsi === "tidak") s.approvalTidak++;
    else s.approvalBelum++;
  }

  const barisHtml = (tdAwal, label, s, cls) => `<tr class="${cls}">
        ${tdAwal}
        <td class="sph-cell">${label}</td>
        <td>${s.total}</td>
        <td>${fmtCountPct(s.sudahKonfirmasi, s.total)}</td>
        <td>${s.belumKonfirmasi}</td>
        <td>${s.approvalYa}</td>
        <td>${s.approvalTidak}</td>
        <td>${s.approvalBelum}</td>
      </tr>`;

  const totalRow = statKosong();
  let bodyRows = "";
  let grupKeIdx = 0;

  for (const kab of kabList) {
    const kabEntry = DAFTAR_KAB_BABEL.find((k) => k.id === kab);
    const labelKab = kabEntry ? kabEntry.nama : kab;
    const kabMap = perKab.get(kab);
    if (!kabMap || kabMap.size === 0) continue;

    const urutKec = state.kecamatanPerKab[kab] || [];
    const kecList = Array.from(kabMap.entries()).map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => {
        const ia = urutKec.findIndex((n) => keyKecamatan(n) === a.key);
        const ib = urutKec.findIndex((n) => keyKecamatan(n) === b.key);
        const va = ia === -1 ? 9999 : ia, vb = ib === -1 ? 9999 : ib;
        if (va !== vb) return va - vb;
        return a.nama.localeCompare(b.nama, "id");
      });

    const jenisPerKec = kecList.map((k) => JENIS_LIST_DASHBOARD.filter((j) => k.jenis[j] && k.jenis[j].total > 0));
    const totalBarisKab = jenisPerKec.reduce((n, arr) => n + arr.length, 0);
    if (totalBarisKab === 0) continue;

    const clsGrup = grupKeIdx % 2 === 1 ? " grup-abu" : "";
    grupKeIdx++;
    const subTotalKab = statKosong();
    let barisKeKab = 0;

    kecList.forEach((kec, ki) => {
      const jenisTerisi = jenisPerKec[ki];
      jenisTerisi.forEach((jenis, idx) => {
        const s = kec.jenis[jenis];
        tambahStat(totalRow, s);
        tambahStat(subTotalKab, s);

        let tdAwal = "";
        if (barisKeKab === 0) tdAwal += `<td class="nama" rowspan="${totalBarisKab}">${labelKab}</td>`;
        if (idx === 0) tdAwal += `<td class="sph-cell" rowspan="${jenisTerisi.length}">${kec.nama}</td>`;

        let cls = clsGrup.trim();
        if (barisKeKab === 0) cls += " baris-mulai-kab";
        else if (idx === 0) cls += " baris-mulai-kec";
        bodyRows += barisHtml(tdAwal, SPH_CONFIG[jenis].label, s, cls);
        barisKeKab++;
      });
    });

    if (totalBarisKab > 1) {
      bodyRows += `<tr class="${clsGrup.trim()} baris-subtotal-kab">
        <td colspan="3">Subtotal ${labelKab}</td>
        <td>${subTotalKab.total}</td>
        <td>${fmtCountPct(subTotalKab.sudahKonfirmasi, subTotalKab.total)}</td>
        <td>${subTotalKab.belumKonfirmasi}</td>
        <td>${subTotalKab.approvalYa}</td>
        <td>${subTotalKab.approvalTidak}</td>
        <td>${subTotalKab.approvalBelum}</td>
      </tr>`;
    }
  }

  const labelTahunDash = tahunAktif !== null ? `— Tahun ${tahunAktif}` : "— Semua Tahun";
  const labelTwDash = twAktif ? (modePeriodeAnomali() === "bulan" ? ` — Bulan ${NAMA_BULAN[twAktif]}` : ` — Triwulan ${twAktif}`) : "";
  const headerDashboard = `
    <div class="dashboard-anomali-header">
      <h3>📊 Dashboard Anomali — Semua Jenis SPH ${labelTahunDash}${labelTwDash}</h3>
    </div>`;

  if (bodyRows === "") {
    area.innerHTML = headerDashboard + `<div class="placeholder-kosong">Belum ada data anomali sama sekali.</div>`;
    return;
  }

  area.innerHTML = `
    ${headerDashboard}
    <div class="dashboard-anomali-scroll">
      <table class="tabel-dashboard-anomali">
        <thead>
          <tr>
            <th>Kabupaten</th><th>Kecamatan</th><th>SPH</th><th>Total Anomali</th>
            <th>Sudah Konfirmasi</th><th>Belum Konfirmasi</th>
            <th>Approval: Ya</th><th>Approval: Tidak</th><th>Approval: Belum</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="baris-total-dashboard">
            <td colspan="3">TOTAL</td>
            <td>${totalRow.total}</td>
            <td>${fmtCountPct(totalRow.sudahKonfirmasi, totalRow.total)}</td>
            <td>${totalRow.belumKonfirmasi}</td>
            <td>${totalRow.approvalYa}</td>
            <td>${totalRow.approvalTidak}</td>
            <td>${totalRow.approvalBelum}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

// ============================================================
// Mulai
// ============================================================
cekSesiAwal();
