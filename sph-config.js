// sph-config.js
// Mirror dari logic fitur_rekon.py: struktur kolom & tab provitas/harga
// beda-beda per jenis SPH. Dipakai panel Rekon utk tahu kolom mana yang
// jadi pembilang/penyebut provitas, dan tab apa saja yang tersedia.

export const SPH_CONFIG = {
  sbs: {
    label: "SPH-SBS",
    table: "data_sbs",
    periodeCol: "bulan",
    periodeLabels: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
    judulPeriode: "Bulan",
    tabs: [
      { key: "provitas_habis", label: "Provitas Habis", satuan: "Kw/Ha",
        numer: "produksi_habis", denom: "luas_panen_habis" },
      { key: "provitas_belum", label: "Provitas Belum Habis", satuan: "Kw/Ha",
        numer: "produksi_belum_habis", denom: "luas_panen_belum_habis" },
      { key: "harga", label: "Harga Jual Petani", satuan: "Rp/Kg", single: "harga_jual_petani" },
    ],
  },
  tbf: {
    label: "SPH-TBF",
    table: "data_tbf",
    periodeCol: "triwulan",
    periodeLabels: ["1", "2", "3", "4"],
    judulPeriode: "Triwulan",
    tabs: [
      { key: "provitas_habis", label: "Provitas Habis", satuan: "Kw/Ha",
        numer: "produksi_habis", denom: "luas_panen_habis" },
      { key: "provitas_belum", label: "Provitas Belum Habis", satuan: "Kw/Ha",
        numer: "produksi_belum_habis", denom: "luas_panen_belum_habis" },
      { key: "harga", label: "Harga Jual Petani", satuan: "Rp/Kg", single: "harga_jual_petani" },
    ],
  },
  th: {
    label: "SPH-TH",
    table: "data_th",
    periodeCol: "triwulan",
    periodeLabels: ["1", "2", "3", "4"],
    judulPeriode: "Triwulan",
    tabs: [
      { key: "provitas_habis", label: "Provitas Habis", satuan: "Kw/Ha",
        numer: "produksi_habis", denom: "luas_panen_habis" },
      { key: "harga", label: "Harga Jual Petani", satuan: "Rp/Kg", single: "harga_jual_petani" },
    ],
  },
  bst: {
    label: "SPH-BST",
    table: "data_bst",
    periodeCol: "triwulan",
    periodeLabels: ["1", "2", "3", "4"],
    judulPeriode: "Triwulan",
    tabs: [
      { key: "provitas", label: "Provitas", satuan: "Kg/Pohon",
        numer: "produksi", numerFactor: 100, denom: "tanaman_produktif_hasil" },
      { key: "harga", label: "Harga Jual Petani", satuan: "Rp/Kg", single: "harga_jual_petani" },
    ],
  },
};

export const DAFTAR_KAB_BABEL = [
  { id: "1901", nama: "Kab. Bangka" },
  { id: "1902", nama: "Kab. Belitung" },
  { id: "1903", nama: "Kab. Bangka Barat" },
  { id: "1904", nama: "Kab. Bangka Tengah" },
  { id: "1905", nama: "Kab. Bangka Selatan" },
  { id: "1906", nama: "Kab. Belitung Timur" },
  { id: "1971", nama: "Kota Pangkal Pinang" },
];
