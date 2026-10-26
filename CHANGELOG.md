# Changelog

All notable changes to Traccia are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Orange unresolved-blocker badges in the issues list and an editable right-side issue peek that preserves the list context.
- Optional metadata columns and quieter, compact labels in the issues list.

- Personal dashboard backgrounds, with the original image bytes preserved and raster effects rendered at the element size and device pixel ratio.
- A Documentation tab on the project page, listing the project's memories and documents.
- CI image builds published to GHCR and pulled when the build host is unavailable.

### Changed

- The issues list gained nested sub-issues and a phone layout.
- The MCP `get_project` tool now returns each milestone's full description, so agents can read milestone rules.
