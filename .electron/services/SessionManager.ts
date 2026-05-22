import { session } from 'electron';

export class SessionManager {
  private ses = session.defaultSession;

  initialize(): void {
    this.ses.setPermissionRequestHandler((_webContents, permission, callback) => {
      // Default deny; renderer will show prompt
      callback(false);
    });

    this.ses.setPermissionCheckHandler((_webContents, permission) => {
      // Default allow for fullscreen only
      return permission === 'fullscreen';
    });
  }

  getSession() {
    return this.ses;
  }
}
