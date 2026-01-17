export const TF_MAP = {
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h"
};

export function isValidTF(tf) {
  return Boolean(TF_MAP[tf]);
}
