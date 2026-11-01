#!/bin/bash
# Compatibility entry point for the former MP3-only peak checker.
# The canonical validator is manifest-driven, codec-agnostic, measures decoded
# active RMS/K-weighted loudness, honors manifest trims, and keeps perceptual
# review flags separate from hard failures.

set -e
exec node --import tsx scripts/validate-sample-quality.ts
