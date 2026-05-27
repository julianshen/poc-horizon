import { session } from "electron";
import { shouldAutoAllow } from "./permissionPolicy";
import type { PermissionBroker } from "./PermissionBroker";

export class SessionManager {
  private ses = session.defaultSession;

  constructor(private readonly broker?: PermissionBroker) {}

  initialize(): void {
    this.ses.setPermissionRequestHandler((wc, permission, callback) => {
      if (shouldAutoAllow(permission)) {
        callback(true);
        return;
      }
      if (this.broker) {
        const origin = safeOrigin(wc.getURL());
        this.broker.request(permission, origin, callback);
        return;
      }
      callback(false);
    });

    this.ses.setPermissionCheckHandler((_wc, permission) => {
      return shouldAutoAllow(permission);
    });

    this.ses.setCertificateVerifyProc((_request, callback) => {
      callback(0); // Use Chromium's default verification
    });
  }

  getSession() {
    return this.ses;
  }
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
