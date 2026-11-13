# QuickJS-NG vendored for Lume (ESP-IDF component)

Upstream: https://github.com/quickjs-ng/quickjs (cloned at HEAD on 2026-11-13)
Not vendored: tests/, examples/, .github/, docs/ — trimmed for repo size.

ESP-IDF build entry is this component's CMakeLists.txt (wraps the upstream
sources as a static lib); upstream CMakeLists/Makefile/meson are kept for
reference but unused by the firmware build.
