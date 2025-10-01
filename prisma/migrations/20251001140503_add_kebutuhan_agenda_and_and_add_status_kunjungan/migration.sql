-- AlterTable
ALTER TABLE `agenda_kerja` ADD COLUMN `kebutuhan_agenda` ENUM('PENTING_MENDESAK', 'TIDAK_PENTING_TAPI_MENDESAK', 'PENTING_TAK_MENDESAK', 'TIDAK_PENTING_TIDAK_MENDESAK') NULL;

-- AlterTable
ALTER TABLE `kunjungan` ADD COLUMN `jam_checkin` DATETIME(0) NULL,
    ADD COLUMN `jam_checkout` DATETIME(0) NULL,
    ADD COLUMN `status_kunjungan` ENUM('diproses', 'berlangsung', 'selesai') NOT NULL DEFAULT 'diproses';
