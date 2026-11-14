# LittleFS dependency (r12)

- Source: ESP Component Registry `joltwallet/littlefs`, version `1.22.3`.
- Upstream: https://github.com/joltwallet/esp_littlefs
- Integration: pinned in `idf_component.yml`; ESP-IDF downloads it into
  `managed_components/joltwallet__littlefs` during configure. No upstream
  source modifications. The managed directory is intentionally not committed.
- The generated `dependencies.lock` is ignored by this repository, so the
  exact `==1.22.3` constraint in the manifest is the reproducibility pin.
- Verified against the downloaded `include/esp_littlefs.h`: config contains
  `base_path`, `partition_label`, `partition`, `format_if_mount_failed`.
  `src/esp_littlefs.c` label lookup accepts any data subtype, while its default
  partition lookup uses LittleFS subtype `0x83`; partition table generator in
  ESP-IDF 5.5.5 recognizes `littlefs` as `0x83`. We set the storage partition
  subtype accordingly.
