import Phaser from 'phaser';

// This scene runs first. If there's a ?token= in the URL from the OAuth
// callback, it stores the JWT and redirects to the hub cleanly.
export class AuthCallbackScene extends Phaser.Scene {
  constructor() {
    super({ key: 'AuthCallbackScene' });
  }

  create() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (token) {
      localStorage.setItem('jwt_token', token);
      // Clean the token from the URL without a page reload
      window.history.replaceState({}, document.title, '/');
    }

    this.scene.start('HubScene');
  }
}
