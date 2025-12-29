#!/bin/bash
#
# Sample Volume Validation Script
#
# Validates that all sampled instruments have consistent volume levels
# by comparing them against the piano reference sample.
#
# Reference: Piano C3 (Peak: -1.4 dB)
# Tolerance: ±2 dB for peak levels
#
# Usage: npm run validate:samples
#

set -e

# Configuration
REFERENCE_SAMPLE="public/instruments/piano/C3.mp3"
REFERENCE_PEAK=-1.4
PEAK_TOLERANCE=2.0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Check for ffmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo -e "${RED}Error: ffmpeg is required but not installed.${NC}"
    echo "Install with: brew install ffmpeg"
    exit 1
fi

# Verify reference sample exists
if [ ! -f "$REFERENCE_SAMPLE" ]; then
    echo -e "${RED}Error: Reference sample not found: $REFERENCE_SAMPLE${NC}"
    exit 1
fi

# Get reference peak (verify it matches expected)
ACTUAL_REF_PEAK=$(ffmpeg -i "$REFERENCE_SAMPLE" -af volumedetect -f null - 2>&1 | grep max_volume | sed 's/.*max_volume: //;s/ dB//')
echo "Reference: Piano C3"
echo "  Expected peak: ${REFERENCE_PEAK} dB"
echo "  Actual peak:   ${ACTUAL_REF_PEAK} dB"
echo ""

# Track results
PASS_COUNT=0
FAIL_COUNT=0
FAILED_SAMPLES=""

echo "Validating samples (tolerance: ±${PEAK_TOLERANCE} dB)..."
echo "=============================================="

# Find all sample MP3s (excluding piano which is the reference)
for mp3 in public/instruments/*/*.mp3; do
    # Skip piano samples (they are the reference)
    if [[ "$mp3" == *"/piano/"* ]]; then
        continue
    fi

    # Get instrument and file name
    INST=$(dirname "$mp3" | xargs basename)
    FILE=$(basename "$mp3")

    # Measure peak
    PEAK=$(ffmpeg -i "$mp3" -af volumedetect -f null - 2>&1 | grep max_volume | sed 's/.*max_volume: //;s/ dB//')

    # Calculate difference from reference
    DIFF=$(echo "$PEAK - $REFERENCE_PEAK" | bc)
    ABS_DIFF=$(echo "$DIFF" | sed 's/-//')

    # Check if within tolerance
    if (( $(echo "$ABS_DIFF <= $PEAK_TOLERANCE" | bc -l) )); then
        STATUS="${GREEN}PASS${NC}"
        ((PASS_COUNT++))
    else
        STATUS="${RED}FAIL${NC}"
        ((FAIL_COUNT++))
        FAILED_SAMPLES="$FAILED_SAMPLES\n  - $INST/$FILE (peak: ${PEAK} dB, diff: ${DIFF} dB)"
    fi

    printf "  %-35s Peak: %6s dB  Diff: %+6s dB  [%b]\n" "$INST/$FILE" "$PEAK" "$DIFF" "$STATUS"
done

echo ""
echo "=============================================="
echo -e "Results: ${GREEN}${PASS_COUNT} passed${NC}, ${RED}${FAIL_COUNT} failed${NC}"

if [ $FAIL_COUNT -gt 0 ]; then
    echo ""
    echo -e "${RED}Failed samples:${NC}"
    echo -e "$FAILED_SAMPLES"
    echo ""
    echo "To fix, normalize with:"
    echo '  ffmpeg -i input.mp3 -af "volume=XdB" -ar 44100 -b:a 128k output.mp3'
    echo "  where X = ${REFERENCE_PEAK} - current_peak"
    exit 1
fi

echo ""
echo -e "${GREEN}All samples validated successfully!${NC}"
exit 0
