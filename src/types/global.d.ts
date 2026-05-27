import type { HorizonAPI } from "../../.electron/preload";

declare global {
  interface Window {
    horizonAPI: HorizonAPI;
  }
}
