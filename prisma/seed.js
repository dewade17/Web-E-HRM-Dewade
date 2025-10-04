const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Daftar template notifikasi default
const notificationTemplates = [
  // --- Absensi ---
  {
    eventTrigger: 'REMINDER_CHECK_IN',
    description: 'Pengingat 15 menit sebelum jam masuk',
    titleTemplate: '⏰ Jangan Lupa Absen Masuk!',
    bodyTemplate: 'Shift kerja Anda akan dimulai pukul {jam_masuk}. Segera lakukan absensi check-in.',
    placeholders: '{nama_karyawan}, {jam_masuk}',
  },
  {
    eventTrigger: 'SUCCESS_CHECK_IN',
    description: 'Konfirmasi saat berhasil check-in',
    titleTemplate: '✅ Absen Masuk Berhasil',
    bodyTemplate: 'Anda berhasil check-in pada pukul {waktu_checkin}. Selamat bekerja, {nama_karyawan}!',
    placeholders: '{nama_karyawan}, {waktu_checkin}',
  },
  {
    eventTrigger: 'LATE_CHECK_IN',
    description: 'Notifikasi saat karyawan check-in terlambat',
    titleTemplate: '⚠️ Anda Terlambat Masuk',
    bodyTemplate: 'Anda tercatat check-in pada pukul {waktu_checkin}, melewati jadwal masuk Anda pukul {jam_masuk}.',
    placeholders: '{nama_karyawan}, {waktu_checkin}, {jam_masuk}',
  },
  {
    eventTrigger: 'REMINDER_CHECK_OUT',
    description: 'Pengingat 15 menit sebelum jam pulang',
    titleTemplate: '⏰ Waktunya Absen Pulang',
    bodyTemplate: 'Shift kerja Anda akan berakhir pukul {jam_pulang}. Jangan lupa lakukan absensi check-out.',
    placeholders: '{nama_karyawan}, {jam_pulang}',
  },
  {
    eventTrigger: 'SUCCESS_CHECK_OUT',
    description: 'Konfirmasi saat berhasil check-out',
    titleTemplate: '✅ Absen Pulang Berhasil',
    bodyTemplate: 'Anda berhasil melakukan check-out pada pukul {waktu_checkout}. Terima kasih untuk hari ini.',
    placeholders: '{nama_karyawan}, {waktu_checkout}',
  },
  {
    eventTrigger: 'MISSED_CHECK_IN',
    description: 'Notifikasi jika karyawan tidak melakukan check-in',
    titleTemplate: '❗ Anda Belum Absen Masuk',
    bodyTemplate: 'Sistem mencatat Anda belum melakukan check-in untuk shift hari ini. Mohon konfirmasi ke atasan Anda.',
    placeholders: '{nama_karyawan}',
  },

  // --- Shift Kerja ---
  {
    eventTrigger: 'NEW_SHIFT_PUBLISHED',
    description: 'Info saat jadwal shift baru diterbitkan untuk karyawan',
    titleTemplate: '📄 Jadwal Shift Baru Telah Terbit',
    bodyTemplate: 'Jadwal shift kerja Anda untuk periode {periode_mulai} - {periode_selesai} telah tersedia. Silakan periksa.',
    placeholders: '{nama_karyawan}, {periode_mulai}, {periode_selesai}',
  },
  {
    eventTrigger: 'SHIFT_UPDATED',
    description: 'Info saat ada perubahan pada jadwal shift karyawan',
    titleTemplate: '🔄 Perubahan Jadwal Shift',
    bodyTemplate: 'Perhatian, shift Anda pada tanggal {tanggal_shift} diubah menjadi {nama_shift} ({jam_masuk} - {jam_pulang}).',
    placeholders: '{nama_karyawan}, {tanggal_shift}, {nama_shift}, {jam_masuk}, {jam_pulang}',
  },
  {
    eventTrigger: 'SHIFT_REMINDER_H1',
    description: 'Pengingat H-1 sebelum jadwal shift karyawan',
    titleTemplate: '📢 Pengingat Shift Besok',
    bodyTemplate: 'Jangan lupa, besok Anda masuk kerja pada shift {nama_shift} pukul {jam_masuk}.',
    placeholders: '{nama_karyawan}, {nama_shift}, {jam_masuk}',
  },

  // --- Agenda Kerja ---
  {
    eventTrigger: 'NEW_AGENDA_ASSIGNED',
    description: 'Notifikasi saat karyawan diberikan agenda kerja baru',
    titleTemplate: '✍️ Agenda Kerja Baru',
    bodyTemplate: 'Anda mendapatkan tugas baru: "{judul_agenda}". Batas waktu pengerjaan hingga {tanggal_deadline}.',
    placeholders: '{nama_karyawan}, {judul_agenda}, {tanggal_deadline}, {pemberi_tugas}',
  },
  {
    eventTrigger: 'AGENDA_REMINDER_H1',
    description: 'Pengingat H-1 sebelum deadline agenda kerja',
    titleTemplate: '🔔 Pengingat Agenda Kerja',
    bodyTemplate: 'Jangan lupa, agenda "{judul_agenda}" akan jatuh tempo besok. Segera perbarui statusnya.',
    placeholders: '{nama_karyawan}, {judul_agenda}',
  },
  {
    eventTrigger: 'AGENDA_OVERDUE',
    description: 'Notifikasi saat agenda kerja melewati batas waktu',
    titleTemplate: ' overdue',
    bodyTemplate: 'Perhatian, agenda kerja "{judul_agenda}" telah melewati batas waktu pengerjaan.',
    placeholders: '{nama_karyawan}, {judul_agenda}',
  },
  {
    eventTrigger: 'AGENDA_COMMENTED',
    description: 'Notifikasi saat atasan/rekan memberi komentar pada agenda',
    titleTemplate: '💬 Komentar Baru pada Agenda',
    bodyTemplate: '{nama_komentator} memberikan komentar pada agenda "{judul_agenda}". Silakan periksa detailnya.',
    placeholders: '{nama_karyawan}, {judul_agenda}, {nama_komentator}',
  },

  // --- Istirahat (BARU DITAMBAHKAN) ---
  {
    eventTrigger: 'SUCCESS_START_BREAK',
    description: 'Konfirmasi saat karyawan memulai istirahat',
    titleTemplate: '☕ Istirahat Dimulai',
    bodyTemplate: 'Anda memulai istirahat pada pukul {waktu_mulai_istirahat}. Selamat menikmati waktu istirahat Anda!',
    placeholders: '{nama_karyawan}, {waktu_mulai_istirahat}',
  },
  {
    eventTrigger: 'SUCCESS_END_BREAK',
    description: 'Konfirmasi saat karyawan mengakhiri istirahat',
    titleTemplate: '✅ Istirahat Selesai',
    bodyTemplate: 'Anda telah mengakhiri istirahat pada pukul {waktu_selesai_istirahat}. Selamat melanjutkan pekerjaan!',
    placeholders: '{nama_karyawan}, {waktu_selesai_istirahat}',
  },
  {
    eventTrigger: 'BREAK_TIME_EXCEEDED',
    description: 'Notifikasi jika durasi istirahat melebihi batas',
    titleTemplate: '❗ Waktu Istirahat Berlebih',
    bodyTemplate: 'Perhatian, durasi istirahat Anda telah melebihi batas maksimal {maks_jam_istirahat} menit yang ditentukan.',
    placeholders: '{nama_karyawan}, {maks_jam_istirahat}',
  },
];

async function main() {
  console.log(`Mulai proses seeding...`);

  for (const template of notificationTemplates) {
    // `upsert` akan membuat data jika belum ada, dan tidak melakukan apa-apa jika sudah ada.
    // Ini membuat script aman untuk dijalankan berkali-kali tanpa duplikasi data.
    await prisma.notificationTemplate.upsert({
      where: { eventTrigger: template.eventTrigger },
      update: {}, // Jangan update data yang sudah diubah oleh HR
      create: template,
    });
    console.log(`Template dibuat/ditemukan: ${template.eventTrigger}`);
  }

  console.log(`Seeding selesai.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
