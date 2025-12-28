#!/bin/bash
# Generate placeholder samples for Phase 29A instruments
# These are simple synthesized sounds - replace with real CC0 samples later

set -e

cd "$(dirname "$0")/.."
INSTRUMENTS_DIR="public/instruments"

echo "Generating placeholder samples for Phase 29A instruments..."

# 808 Kick - Low sine sweep (typical 808 character)
echo "  808-kick..."
ffmpeg -y -f lavfi -i "sine=frequency=150:duration=0.5" \
  -af "volume=0.8" \
  -ar 44100 -ac 1 "$INSTRUMENTS_DIR/808-kick/kick.mp3" 2>/dev/null

# 808 Snare - Noise burst with tone
echo "  808-snare..."
ffmpeg -y -f lavfi -i "anoisesrc=d=0.3:c=white:a=0.5" \
  -af "highpass=f=500,lowpass=f=8000,volume=0.6" \
  -ar 44100 -ac 1 "$INSTRUMENTS_DIR/808-snare/snare.mp3" 2>/dev/null

# 808 Hi-Hat - High frequency noise
echo "  808-hihat..."
ffmpeg -y -f lavfi -i "anoisesrc=d=0.1:c=white:a=0.3" \
  -af "highpass=f=6000,volume=0.5" \
  -ar 44100 -ac 1 "$INSTRUMENTS_DIR/808-hihat/hihat.mp3" 2>/dev/null

# 808 Clap - Filtered noise burst
echo "  808-clap..."
ffmpeg -y -f lavfi -i "anoisesrc=d=0.2:c=pink:a=0.4" \
  -af "highpass=f=1000,lowpass=f=6000,volume=0.5" \
  -ar 44100 -ac 1 "$INSTRUMENTS_DIR/808-clap/clap.mp3" 2>/dev/null

# Acoustic Kick - Lower, more body
echo "  acoustic-kick..."
ffmpeg -y -f lavfi -i "sine=frequency=80:duration=0.4" \
  -af "volume=0.9" \
  -ar 44100 -ac 1 "$INSTRUMENTS_DIR/acoustic-kick/kick.mp3" 2>/dev/null

# Acoustic Snare - Noise + tone mix
echo "  acoustic-snare..."
ffmpeg -y -f lavfi -i "anoisesrc=d=0.25:c=white:a=0.4" \
  -af "highpass=f=200,lowpass=f=10000,volume=0.5" \
  -ar 44100 -ac 1 "$INSTRUMENTS_DIR/acoustic-snare/snare.mp3" 2>/dev/null

# Acoustic Hi-Hat Closed - Short high noise
echo "  acoustic-hihat-closed..."
ffmpeg -y -f lavfi -i "anoisesrc=d=0.05:c=white:a=0.3" \
  -af "highpass=f=8000,volume=0.4" \
  -ar 44100 -ac 1 "$INSTRUMENTS_DIR/acoustic-hihat-closed/hihat-closed.mp3" 2>/dev/null

# Acoustic Hi-Hat Open - Longer high noise
echo "  acoustic-hihat-open..."
ffmpeg -y -f lavfi -i "anoisesrc=d=0.3:c=white:a=0.3" \
  -af "highpass=f=6000,volume=0.4" \
  -ar 44100 -ac 1 "$INSTRUMENTS_DIR/acoustic-hihat-open/hihat-open.mp3" 2>/dev/null

# Acoustic Ride - Long sustain cymbal
echo "  acoustic-ride..."
ffmpeg -y -f lavfi -i "anoisesrc=d=0.8:c=white:a=0.2" \
  -af "highpass=f=4000,lowpass=f=12000,volume=0.4" \
  -ar 44100 -ac 1 "$INSTRUMENTS_DIR/acoustic-ride/ride.mp3" 2>/dev/null

# Finger Bass - Multiple octaves (C1, C2, C3, C4)
echo "  finger-bass (4 samples)..."
ffmpeg -y -f lavfi -i "sine=frequency=32.7:duration=1.0" -af "volume=0.7" -ar 44100 -ac 1 "$INSTRUMENTS_DIR/finger-bass/C1.mp3" 2>/dev/null
ffmpeg -y -f lavfi -i "sine=frequency=65.4:duration=1.0" -af "volume=0.7" -ar 44100 -ac 1 "$INSTRUMENTS_DIR/finger-bass/C2.mp3" 2>/dev/null
ffmpeg -y -f lavfi -i "sine=frequency=130.8:duration=1.0" -af "volume=0.7" -ar 44100 -ac 1 "$INSTRUMENTS_DIR/finger-bass/C3.mp3" 2>/dev/null
ffmpeg -y -f lavfi -i "sine=frequency=261.6:duration=1.0" -af "volume=0.7" -ar 44100 -ac 1 "$INSTRUMENTS_DIR/finger-bass/C4.mp3" 2>/dev/null

# Vinyl Crackle - Low level noise
echo "  vinyl-crackle..."
ffmpeg -y -f lavfi -i "anoisesrc=d=2.0:c=brown:a=0.1" \
  -af "highpass=f=100,lowpass=f=5000,volume=0.3" \
  -ar 44100 -ac 1 "$INSTRUMENTS_DIR/vinyl-crackle/crackle.mp3" 2>/dev/null

echo ""
echo "Done! Generated placeholder samples for all Phase 29A instruments."
echo ""
echo "Files created:"
find "$INSTRUMENTS_DIR" -name "*.mp3" -newer "$INSTRUMENTS_DIR/piano/C4.mp3" -exec ls -lh {} \;
