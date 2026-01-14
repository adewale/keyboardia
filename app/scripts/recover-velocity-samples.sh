#!/bin/bash
#
# Recover Original Velocity Layer Dynamics
#
# This script downloads original samples from source repositories and
# converts them to MP3 WITHOUT peak normalization, preserving natural dynamics.
#
# ROOT CAUSE: Previous processing normalized all samples to same peak level,
# destroying the natural volume differences between pp/mf/ff samples.
#
# Usage: ./scripts/recover-velocity-samples.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

TEMP_DIR=$(mktemp -d)
echo -e "${CYAN}Using temp directory: $TEMP_DIR${NC}"

cleanup() {
    echo -e "${YELLOW}Cleaning up temp directory...${NC}"
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

# Check dependencies
for cmd in ffmpeg curl unzip; do
    if ! command -v $cmd &> /dev/null; then
        echo -e "${RED}Error: $cmd is required but not installed.${NC}"
        exit 1
    fi
done

echo -e "\n${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  VELOCITY SAMPLE RECOVERY - Restoring Original Dynamics${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"

# ============================================================================
# RHODES-EP: jRhodes3d (5 velocity layers per note)
# ============================================================================
echo -e "${GREEN}▶ Downloading jRhodes3d samples...${NC}"

RHODES_URL="https://github.com/sfzinstruments/jlearman.jRhodes3d/archive/refs/heads/master.zip"
curl -sL "$RHODES_URL" -o "$TEMP_DIR/rhodes.zip"
unzip -q "$TEMP_DIR/rhodes.zip" -d "$TEMP_DIR"
RHODES_SRC="$TEMP_DIR/jlearman.jRhodes3d-master/jRhodes3d-mono"

echo -e "${GREEN}  Converting Rhodes samples (preserving dynamics)...${NC}"

# Rhodes: E2=MIDI40, G3=MIDI55, F4=MIDI65
# Velocity layers: _1 (pp), _3 (mf), _5 (ff)
convert_rhodes() {
    local note=$1 midi=$2
    local src_base="$RHODES_SRC/A_${midi}__${note}"

    for vel_pair in "pp:1" "mf:3" "ff:5"; do
        local vel="${vel_pair%%:*}"
        local suffix="${vel_pair##*:}"
        local src_file="${src_base}_${suffix}.flac"
        local dst_file="public/instruments/rhodes-ep/${note}-${vel}.mp3"

        if [[ -f "$src_file" ]]; then
            ffmpeg -y -i "$src_file" -ar 44100 -b:a 128k "$dst_file" 2>/dev/null
            echo -e "    ${GREEN}✓${NC} ${note}-${vel}.mp3"
        else
            echo -e "    ${RED}✗${NC} Source not found: $src_file"
        fi
    done
}

convert_rhodes "E2" "040"
convert_rhodes "G3" "055"
convert_rhodes "F4" "065"

# ============================================================================
# STEEL DRUMS: jSteelDrum (4 velocity layers per note)
# Branch is 'main' not 'master'
# ============================================================================
echo -e "\n${GREEN}▶ Downloading jSteelDrum samples...${NC}"

STEEL_URL="https://github.com/sfzinstruments/jlearman.SteelDrum/archive/refs/heads/main.zip"
curl -sL "$STEEL_URL" -o "$TEMP_DIR/steel.zip"
unzip -q "$TEMP_DIR/steel.zip" -d "$TEMP_DIR"
STEEL_SRC="$TEMP_DIR/jlearman.SteelDrum-main/jSteelDrum-flac-sfz"

echo -e "${GREEN}  Converting Steel Drum samples (preserving dynamics)...${NC}"

# Steel drums file naming varies:
# - C4/G4 layers 1-3: jsdb_060__C4_1.flac (soft), jsdb_060__C4_2.flac (medium soft), etc.
# - C4/G4 layer 4: SteelDrum_060__C4_4.flac (hard)
# - C5/G5 all layers: SteelDrum_072__C5_1.flac through SteelDrum_072__C5_4.flac
# We'll use: _1 (soft), _2 (medium), _4 (hard)

convert_steel_c4_g4() {
    local note_lower=$1 midi=$2 note_upper=$3

    # Soft: jsdb prefix, layer 1
    local src_soft="$STEEL_SRC/jsdb_${midi}__${note_upper}_1.flac"
    local dst_soft="public/instruments/steel-drums/steel-${note_lower}-soft.mp3"
    if [[ -f "$src_soft" ]]; then
        ffmpeg -y -i "$src_soft" -ar 44100 -b:a 128k "$dst_soft" 2>/dev/null
        echo -e "    ${GREEN}✓${NC} steel-${note_lower}-soft.mp3"
    else
        echo -e "    ${RED}✗${NC} Source not found: $src_soft"
    fi

    # Medium: jsdb prefix, layer 2
    local src_med="$STEEL_SRC/jsdb_${midi}__${note_upper}_2.flac"
    local dst_med="public/instruments/steel-drums/steel-${note_lower}-medium.mp3"
    if [[ -f "$src_med" ]]; then
        ffmpeg -y -i "$src_med" -ar 44100 -b:a 128k "$dst_med" 2>/dev/null
        echo -e "    ${GREEN}✓${NC} steel-${note_lower}-medium.mp3"
    else
        echo -e "    ${RED}✗${NC} Source not found: $src_med"
    fi

    # Hard: SteelDrum prefix, layer 4
    local src_hard="$STEEL_SRC/SteelDrum_${midi}__${note_upper}_4.flac"
    local dst_hard="public/instruments/steel-drums/steel-${note_lower}-hard.mp3"
    if [[ -f "$src_hard" ]]; then
        ffmpeg -y -i "$src_hard" -ar 44100 -b:a 128k "$dst_hard" 2>/dev/null
        echo -e "    ${GREEN}✓${NC} steel-${note_lower}-hard.mp3"
    else
        echo -e "    ${RED}✗${NC} Source not found: $src_hard"
    fi
}

convert_steel_c5_g5() {
    local note_lower=$1 midi=$2 note_upper=$3

    # All use SteelDrum_ prefix
    for vel_pair in "soft:1" "medium:2" "hard:4"; do
        local vel="${vel_pair%%:*}"
        local layer="${vel_pair##*:}"
        local src_file="$STEEL_SRC/SteelDrum_${midi}__${note_upper}_${layer}.flac"
        local dst_file="public/instruments/steel-drums/steel-${note_lower}-${vel}.mp3"

        if [[ -f "$src_file" ]]; then
            ffmpeg -y -i "$src_file" -ar 44100 -b:a 128k "$dst_file" 2>/dev/null
            echo -e "    ${GREEN}✓${NC} steel-${note_lower}-${vel}.mp3"
        else
            echo -e "    ${RED}✗${NC} Source not found: $src_file"
        fi
    done
}

convert_steel_c4_g4 "c4" "060" "C4"
convert_steel_c4_g4 "g4" "067" "G4"
convert_steel_c5_g5 "c5" "072" "C5"
convert_steel_c5_g5 "g5" "079" "G5"

# ============================================================================
# ACOUSTIC CRASH: Virtuosity Drums
# Files: room_crash_crash_vl1_rr1.flac through room_crash_crash_vl3_rr4.flac
# vl1 = soft, vl2 = medium, vl3 = hard
# ============================================================================
echo -e "\n${GREEN}▶ Downloading Virtuosity Drums samples...${NC}"

CRASH_URL="https://github.com/sfzinstruments/virtuosity_drums/archive/refs/heads/master.zip"
curl -sL "$CRASH_URL" -o "$TEMP_DIR/crash.zip"
unzip -q "$TEMP_DIR/crash.zip" -d "$TEMP_DIR"
CRASH_SRC="$TEMP_DIR/virtuosity_drums-master/Samples/room/crash"

echo -e "${GREEN}  Converting crash cymbal samples (preserving dynamics)...${NC}"

# Use round robin 1 for each velocity layer
for vel_pair in "soft:vl1" "medium:vl2" "hard:vl3"; do
    vel="${vel_pair%%:*}"
    layer="${vel_pair##*:}"
    src_file="$CRASH_SRC/room_crash_crash_${layer}_rr1.flac"
    dst_file="public/instruments/acoustic-crash/crash-${vel}.mp3"

    if [[ -f "$src_file" ]]; then
        ffmpeg -y -i "$src_file" -ar 44100 -b:a 128k "$dst_file" 2>/dev/null
        echo -e "    ${GREEN}✓${NC} crash-${vel}.mp3"
    else
        echo -e "    ${RED}✗${NC} Source not found: $src_file"
    fi
done

# ============================================================================
# PIANO: University of Iowa Electronic Music Studios
# URL format: http://theremin.music.uiowa.edu/sound%20files/MIS/Piano_Other/piano/Piano.[dynamic].[note].aiff
# ============================================================================
echo -e "\n${GREEN}▶ Downloading University of Iowa piano samples...${NC}"

PIANO_BASE="http://theremin.music.uiowa.edu/sound%20files/MIS/Piano_Other/piano"

echo -e "${GREEN}  Converting Piano samples (preserving dynamics)...${NC}"

# Piano notes: F2, F3, F4
for note in F2 F3 F4; do
    for vel_pair in "pp:pp" "mf:mf" "ff:ff"; do
        vel="${vel_pair%%:*}"
        dyn="${vel_pair##*:}"
        src_url="${PIANO_BASE}/Piano.${dyn}.${note}.aiff"
        tmp_file="$TEMP_DIR/Piano.${dyn}.${note}.aiff"
        dst_file="public/instruments/piano/${note}-${vel}.mp3"

        curl -sL "$src_url" -o "$tmp_file"
        if [[ -f "$tmp_file" ]] && file "$tmp_file" | grep -q "AIFF"; then
            ffmpeg -y -i "$tmp_file" -ar 44100 -b:a 128k "$dst_file" 2>/dev/null
            echo -e "    ${GREEN}✓${NC} ${note}-${vel}.mp3"
        else
            echo -e "    ${RED}✗${NC} Failed to download: $src_url"
        fi
    done
done

# ============================================================================
# VERIFICATION
# ============================================================================
echo -e "\n${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  VERIFICATION - Checking recovered samples${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"

echo -e "${GREEN}Rhodes-EP samples:${NC}"
for f in public/instruments/rhodes-ep/E2-pp.mp3 public/instruments/rhodes-ep/E2-mf.mp3 public/instruments/rhodes-ep/E2-ff.mp3 \
         public/instruments/rhodes-ep/G3-pp.mp3 public/instruments/rhodes-ep/G3-mf.mp3 public/instruments/rhodes-ep/G3-ff.mp3 \
         public/instruments/rhodes-ep/F4-pp.mp3 public/instruments/rhodes-ep/F4-mf.mp3 public/instruments/rhodes-ep/F4-ff.mp3; do
    if [[ -f "$f" ]]; then
        vol=$(ffmpeg -i "$f" -af volumedetect -f null - 2>&1 | grep mean_volume | sed 's/.*mean_volume: //')
        printf "  %-25s %s\n" "$(basename $f)" "$vol"
    fi
done

echo -e "\n${GREEN}Piano samples:${NC}"
for note in F2 F3 F4; do
    for vel in pp mf ff; do
        f="public/instruments/piano/${note}-${vel}.mp3"
        if [[ -f "$f" ]]; then
            vol=$(ffmpeg -i "$f" -af volumedetect -f null - 2>&1 | grep mean_volume | sed 's/.*mean_volume: //')
            printf "  %-25s %s\n" "$(basename $f)" "$vol"
        fi
    done
done

echo -e "\n${GREEN}Steel Drum samples:${NC}"
for note in c4 g4 c5 g5; do
    for vel in soft medium hard; do
        f="public/instruments/steel-drums/steel-${note}-${vel}.mp3"
        if [[ -f "$f" ]]; then
            vol=$(ffmpeg -i "$f" -af volumedetect -f null - 2>&1 | grep mean_volume | sed 's/.*mean_volume: //')
            printf "  %-25s %s\n" "$(basename $f)" "$vol"
        fi
    done
done

echo -e "\n${GREEN}Acoustic Crash samples:${NC}"
for vel in soft medium hard; do
    f="public/instruments/acoustic-crash/crash-${vel}.mp3"
    if [[ -f "$f" ]]; then
        vol=$(ffmpeg -i "$f" -af volumedetect -f null - 2>&1 | grep mean_volume | sed 's/.*mean_volume: //')
        printf "  %-25s %s\n" "$(basename $f)" "$vol"
    fi
done

echo -e "\n${GREEN}Done! Run 'npm run validate:velocity' to verify.${NC}"
