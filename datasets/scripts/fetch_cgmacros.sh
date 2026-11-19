#!/usr/bin/env bash
#
# Fetch the CGMacros dataset (Texas A&M, 2025) from PhysioNet for the
# AHAAR project. CGMacros is 45 subjects × 10 days of CGM + logged meals
# with macronutrient composition — the dataset that paper 10 in the
# AHAAR IEEE report (Huo et al., BHI 2019) extends.
#
#   Scientific Data, 2025. CC-BY licensed.
#   https://physionet.org/content/cgmacros/1.0.0/
#
# PhysioNet requires a free credentialed account (DUA). Create one at
# https://physionet.org/register/ first, then run this script with your
# username — you'll be prompted for the password.
#
#   bash datasets/scripts/fetch_cgmacros.sh <physionet-user>
#
# Downloads into datasets/raw/cgm/cgmacros/ (git-ignored by default).

set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "usage: bash datasets/scripts/fetch_cgmacros.sh <physionet-user>"
  echo "  See the top of this file for details on registering."
  exit 2
fi

USER="$1"
OUT_DIR="$(cd "$(dirname "$0")/../.." && pwd)/datasets/raw/cgm/cgmacros"
mkdir -p "$OUT_DIR"

echo "Fetching CGMacros v1.0.0 into $OUT_DIR ..."
wget --user="$USER" --ask-password \
  --recursive --no-parent --no-host-directories \
  --cut-dirs=3 --accept='*.csv,*.pdf,*.md,*.txt' \
  --directory-prefix="$OUT_DIR" \
  https://physionet.org/files/cgmacros/1.0.0/

echo
echo "Done. Cite as:"
echo "  Gutierrez-Osuna, R. et al. CGMacros: Continuous Glucose Monitoring"
echo "  and Macronutrient Dataset. Scientific Data 12 (2025). CC-BY 4.0."
