-- Add optional attachment URL column for izin_tukar_hari
ALTER TABLE `izin_tukar_hari`
  ADD COLUMN `lampiran_izin_tukar_hari_url` LONGTEXT NULL;
