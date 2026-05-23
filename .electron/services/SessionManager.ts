import { session } from 'electron';
import { defaultRequestResponse, shouldAutoAllow } from './permissionPolicy';

export class SessionManager {
  private ses = session.defaultSession;

  initialize(): void {
    this.ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(defaultRequestResponse(permission));
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
