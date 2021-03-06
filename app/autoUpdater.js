var _ = require('underscore');
var app = require('electron').app;
var autoUpdater = require('electron').autoUpdater;
var dialog = require('electron').dialog;
const request = require('request');
const util = require('util');
const fs = require('original-fs');
const sudo = require('electron-sudo');
const path = require('path');
const exec = require('child_process').exec;

// Daily.
var SCHEDULED_CHECK_INTERVAL = 24 * 60 * 60 * 1000;

/**
 * Initializes `meson:electron` auto-updater and binds its methods to the
 * Electron autoUpdater events.
 *
 * @constructor
 * @summary Initializes `meson:electron` auto-updater.
 */
var Updater = function() {
  /**
   * Enum for the possible events emitted by Electorn autoUpdater.
   *
   * @enum
   * @public
   * @readonly
   * @see {@link http://electron.atom.io/docs/api/auto-updater/#events|Electron autoUpdater Events API docs}
   * @since 0.1.4
   * @version 1.0.0
   */
  this.Event = {
    CHECKING_FOR_UPDATE: 'checking-for-update',
    ERROR: 'error', // when there is an error while updating
    UPDATE_AVAILABLE: 'update-available',
    UPDATE_DOWNLOADED: 'update-downloaded',
    UPDATE_NOT_AVAILABLE: 'update-not-available'
  };

  autoUpdater.on(this.Event.ERROR, this._onUpdateError.bind(this));
  autoUpdater.on(this.Event.UPDATE_NOT_AVAILABLE, this._onUpdateNotAvailable.bind(this));
  autoUpdater.on(this.Event.UPDATE_DOWNLOADED, this._onUpdateDownloaded.bind(this));

  if (process.platform === 'linux') {
    /**
     * Config JSON for Linux updates.
     *
     * @public
     * @since 0.1.4
     * @type {Object}
     * @version 1.0.0
     */
    this.config = {
      feedUrl: null,
      format: null,
      name: 'electron-app',
      platform: null,
      productName: 'Electron app',
      requestOptions: {},
      tmpUpdate: null,
      version: null,
    };

    /**
     * Defaults for HTTP requests.
     *
     * @private
     * @readonly
     * @since 0.1.4
     * @type {Object}
     * @version 1.0.0
     */
    this._requestDefaults = {
      method: 'GET',
      timeout: 5000,
      followRedirect: false,
      maxRedirects: 0
    };

    /**
     * Mime types for supported Linux formats. AppImages are managed with its
     * own embedded autoupdater, so it's not included here.
     *
     * @private
     * @readonly
     * @since 0.1.4
     * @type {Object}
     * @version 1.0.0
     */
    this._mimeTypes = {
      'deb': [
        'application/x-debian-package',
        'application/vnd.debian.binary-package',
      ],
      'rpm': [
        'application/x-rpm',
        'application/octet-stream',
      ]
    };
  }
};

_.extend(Updater.prototype, {
  /**
   * Configures the Linux autoUpdater.
   *
   * @param {Object} settings - The configuration for the Linux autoUpdater.
   * @since 0.1.4
   * @version 1.0.0
   */
  setup: function(settings) {
    _.extend(this.config, settings);
    if (!this.config.tmpUpdate) {
      this.config.tmpUpdate = util.format('/tmp/%s.%s', this.config.name, this.config.format);
    }
  },

  setFeedURL: function(url) {
    autoUpdater.setFeedURL(url);
  },

  checkForUpdates: function(userTriggered /* optional */) {
    // Asking the updater to check while it's already checking may result in an error.
    if (this._checkPending) return;

    this._clearScheduledCheck();
    if (this._updatePending) {
      this._askToApplyUpdate();
      return;
    }

    this._checkPending = true;
    if (userTriggered) this._userCheckPending = true;

    if (process.platform === 'linux') {
      this._checkForLinuxUpdates();
    } else {
      autoUpdater.checkForUpdates();
    }
  },

  _onUpdateError: function() {
    this._checkPending = false;
    if (this._userCheckPending) {
      this._userCheckPending = false;

      dialog.showMessageBox({
        type: 'error',
        message: 'An error occurred while checking for updates.',
        buttons: ['Ok']
      });
    }

    this._scheduleCheck();
  },

  _onUpdateNotAvailable: function() {
    this._checkPending = false;
    if (this._userCheckPending) {
      this._userCheckPending = false;

      dialog.showMessageBox({
        type: 'info',
        message: 'An update is not available.',
        buttons: ['Ok']
      });
    }

    this._scheduleCheck();
  },

  _onUpdateDownloaded: function() {
    this._checkPending = false;
    this._userCheckPending = false;
    this._updatePending = true;
    this._askToApplyUpdate();
  },

  /**
   * Asks the user whether to apply the download update or not.
   *
   * @emits app#before-quit
   */
  _askToApplyUpdate: function() {
    var self = this;

    dialog.showMessageBox({
      type: 'question',
      message: 'An update is available! Would you like to quit to install it? The application will then restart.',
      buttons: ['Ask me later', 'Quit and install']
    }, function(result) {
      if (result > 0) {
        // Emit the 'before-quit' event since the app won't quit otherwise
        // (https://app.asana.com/0/19141607276671/74169390751974) and the app won't:
        // https://github.com/atom/electron/issues/3837
        var event = {
          _defaultPrevented: false,
          isDefaultPrevented: function() {
            return this._defaultPrevented;
          },
          preventDefault: function() {
            this._defaultPrevented = true;
          }
        };

        app.emit('before-quit', event);
        if (event.isDefaultPrevented()) return;

        // Relaunch the app after installing updates. Only available since electron v1.2.2. See:
        // - https://github.com/electron/electron/pull/5837
        // - http://electron.atom.io/releases/#httpsgithubcomelectronelectronreleasestagv122-june-08-2016
        if (app.relaunch) {
          app.relaunch();
        } else {
          autoUpdater.quitAndInstall();
        }
      } else {
        self._scheduleCheck();
      }
    });
  },

  _clearScheduledCheck: function() {
    if (this._scheduledCheck) {
      clearTimeout(this._scheduledCheck);
      this._scheduledCheck = null;
    }
  },

  _scheduleCheck: function() {
    this._clearScheduledCheck();
    this._scheduledCheck = setTimeout(this.checkForUpdates.bind(this), SCHEDULED_CHECK_INTERVAL);
  },

  /**
   * Checks for Linux updates. Electron autoUpdater does not support
   * {@link http://electron.atom.io/docs/api/auto-updater/#linux|Linux} natively,
   * so we leverage its events and implements this feature manually.
   *
   * @emits autoUpdater#error
   * @emits autoUpdater#update-not-available
   * @private
   * @since 0.1.4
   * @summary Checks for Linux updates of formats {deb|rpm|AppImage}.
   * @version 1.0.0
   */
  _checkForLinuxUpdates: function() {
    var self = this;
    if (self.config.format === 'AppImage') {
      this._updateAppImage();
    } else {
      var options = {
        uri: this.config.feedUrl,
        qs: _.pick(this.config, 'format', 'platform', 'version')
      };
      _.defaults(options, this.config.requestOptions, this._requestDefaults);

      request(options, function(error, response, body) {
        if (response.statusCode === 400) { // bad request (missing params)
          autoUpdater.emit(self.Event.ERROR);
          return false;
        }
        if (error) { // error
          return self.emitError('Checking updates',
            'There was an error while checking for new updates', error);
        }

        // Handle the response
        if (response.statusCode === 204) {
          autoUpdater.emit(self.Event.UPDATE_NOT_AVAILABLE);
          return false;
        } else if (response.statusCode === 200 && body) {
          try {
            body = JSON.parse(body);
          } catch(error) {
            return self.emitError('Checking updates', 'Malformed response', body);
          }
          if (typeof body === 'object' && body.url) {
            self._downloadLinuxUpdate(body.url);
          } else {
            return self.emitError('Checking updates', 'Bad response',
              JSON.stringify(body, {indent: true}));
          }
        }
      });
    }
  },

  /**
   * Checks and updates (if any available) an AppImage executable. The AppImage
   * update relies on the embedded `appimageupdate` script and the `zsync_curl`
   * binary.
   *
   * @emits autoUpdater#update-downloaded
   * @emits autoUpdater#update-not-available
   * @private
   * @since 0.1.4
   * @summary Checks (and updates if available) for updates of an AppImage app.
   * @version 1.0.0
   */
  _updateAppImage: function() {
    var self = this;
    const binDir = path.join(process.cwd(), 'bin');
    process.env.PATH += ':' + binDir;
    exec('appimageupdate ' + process.env.APPIMAGE, {}, function(error, stdout, stderr) {
      if (error) {
        return self.emitError('Updating', 'Failed to download', error);
      } else {
        const bytesFetched = parseInt(_.last(/used [0-9]+ local, fetched ([0-9]+)/.exec(stdout)))
        autoUpdater.emit((bytesFetched > 0) ? self.Event.UPDATE_DOWNLOADED : self.Event.UPDATE_NOT_AVAILABLE);
      }
    });
  },

  /**
   * Downnloads an update for a Linux app into a temporary location and the applies it.
   *
   * @emits autoUpdater#error
   * @param {string} url - The URL to download the installer/package.
   * @private
   * @since 0.1.4
   * @version 1.0.0
   */
  _downloadLinuxUpdate: function(url) {
    var self = this;
    var options = {
      url: url,
      encoding: null
    };
    _.defaults(options, this.config.requestOptions, this._requestDefaults);

    request(options, function(error, response, body) {
      if (error) {
        return self.emitError('Updating', 'Could not download the update file', error);
      }

      if (_.indexOf(self._mimeTypes[self.config.format], response.headers['content-type']) === -1) {
        return self.emitError('Updating', 'Unexpected content type', response.headers['content-type']);
      }

      // Create the file
      fs.writeFile(self.config.tmpUpdate, body, null, function(error) {
        if (error) {
          return self.emitError('Updating', 'Failed to download', error);
        }

        self._applyLinuxUpdate();
      });
    });
  },

  /**
   * Applies an update for a Linux app and removes the package/installer after
   * applied. Prompt for user permissions to apply the update using the default
   * system package manager (`dpkg` for debian-based distros; `rpm` for
   * redhat-based distros).
   *
   * @emits autoUpdater#update-downloaded
   * @private
   * @since 0.1.4
   * @version 1.0.0
   */
  _applyLinuxUpdate: function() {
    var self = this, cmd = '';
    switch (this.config.format) {
      case 'deb':
        cmd = 'dpkg -i ' + this.config.tmpUpdate;
        break;
      case 'rpm':
        cmd = 'rpm -i ' + this.config.tmpUpdate;
        break;
    }
    var options = {
      name: this.config.productName,
      stdio: 'ignore'
    };
    sudo.exec(cmd, options, function(error) {
      if (error) {
        return self.emitError('Updating', 'Failed to apply update', error);
      }
      fs.unlink(self.config.tmpUpdate);
      autoUpdater.emit(self.Event.UPDATE_DOWNLOADED);
    });
  },

  /**
   * Opens an error box dialog and emits an error event.
   *
   * @emits autoUpdater#error
   * @param {string} title - A short string for the dialog title.
   * @param {string} msg - A short title of the error.
   * @param {Error|string} error - The Error object or a descriptive string (error details).
   * @return {boolean} false
   * @version 1.0.0
   */
  emitError: function(title, msg, error) {
    var details = '';
    if (error !== undefined && error.message) {
      details = ': ' + error.message;
    } else if (error) {
      details = ': ' + error;
    }
    autoUpdater.emit(this.Event.ERROR);
    dialog.showErrorBox(title, msg + details);
    return false;
  }
});

module.exports = new Updater();
